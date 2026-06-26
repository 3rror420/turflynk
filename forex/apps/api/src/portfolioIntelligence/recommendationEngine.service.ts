/**
 * Phase 18 — Recommendation Engine.
 *
 * Generates human-readable recommendation cards (pause, rerun optimizer,
 * high-correlation warning, drawdown warning, etc.) from health, regime,
 * correlation, and allocation data. Persists to the recommendations table.
 *
 * Recommendations are advisory only — no autonomous action is taken.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/db.js";
import type { HealthSnapshot } from "./healthEngine.service.js";
import type { RegimeSnapshot } from "./regimeEngine.service.js";
import type { CorrelationRow } from "./correlationEngine.service.js";
import type { AllocationRecommendation } from "./allocationEngine.service.js";

export type RecommendationType =
  | "PAUSE_DEPLOYMENT"
  | "RESUME_DEPLOYMENT"
  | "REDUCE_ALLOCATION"
  | "INCREASE_ALLOCATION"
  | "RERUN_OPTIMIZER"
  | "RERUN_VALIDATION"
  | "AVOID_REGIME"
  | "HIGH_CORRELATION"
  | "DRAWDOWN_WARNING"
  | "REGIME_CHANGE"
  | "LOW_HEALTH";

export type RecommendationSeverity = "INFO" | "WARNING" | "CRITICAL";
export type RecommendationStatus = "OPEN" | "DISMISSED" | "RESOLVED";

export interface Recommendation {
  id: string;
  createdAt: string;
  type: RecommendationType;
  severity: RecommendationSeverity;
  deploymentId: string | null;
  symbol: string | null;
  granularity: string | null;
  title: string;
  message: string;
  reasons: string[];
  status: RecommendationStatus;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

interface RecommendationRow {
  id: string;
  created_at: string;
  type: string;
  severity: string;
  deployment_id: string | null;
  symbol: string | null;
  granularity: string | null;
  title: string;
  message: string;
  reasons_json: string;
  status: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

function mapRow(r: RecommendationRow): Recommendation {
  return {
    id: r.id,
    createdAt: r.created_at,
    type: r.type as RecommendationType,
    severity: r.severity as RecommendationSeverity,
    deploymentId: r.deployment_id,
    symbol: r.symbol,
    granularity: r.granularity,
    title: r.title,
    message: r.message,
    reasons: JSON.parse(r.reasons_json) as string[],
    status: r.status as RecommendationStatus,
    resolvedAt: r.resolved_at,
    resolutionNote: r.resolution_note,
  };
}

function insertRecommendation(rec: Omit<Recommendation, "id" | "createdAt" | "status" | "resolvedAt" | "resolutionNote">): Recommendation {
  const now = new Date().toISOString();
  const full: Recommendation = {
    id: randomUUID(),
    createdAt: now,
    status: "OPEN",
    resolvedAt: null,
    resolutionNote: null,
    ...rec,
  };
  db.prepare(
    `INSERT INTO recommendations
     (id, created_at, type, severity, deployment_id, symbol, granularity, title, message, reasons_json, status)
     VALUES (@id, @createdAt, @type, @severity, @deploymentId, @symbol, @granularity, @title, @message, @reasonsJson, 'OPEN')`
  ).run({
    id: full.id,
    createdAt: full.createdAt,
    type: full.type,
    severity: full.severity,
    deploymentId: full.deploymentId,
    symbol: full.symbol,
    granularity: full.granularity,
    title: full.title,
    message: full.message,
    reasonsJson: JSON.stringify(full.reasons),
  });
  return full;
}

/**
 * Generate recommendations from current health/regime/correlation/allocation data.
 * Clears existing OPEN recommendations before writing new ones (idempotent re-run).
 * Returns the new set of open recommendations.
 */
export function generateRecommendations(
  healthSnapshots: HealthSnapshot[],
  regimes: RegimeSnapshot[],
  correlations: CorrelationRow[],
  allocations: AllocationRecommendation[]
): Recommendation[] {
  // Clear stale OPEN recommendations from previous analysis runs
  db.prepare(`UPDATE recommendations SET status = 'DISMISSED', resolved_at = ? WHERE status = 'OPEN'`).run(
    new Date().toISOString()
  );

  const results: Recommendation[] = [];

  // Build name lookup
  const depNames = new Map<string, string>();
  const depRows = db
    .prepare(`SELECT id, name, instrument, timeframe, strategy_id FROM strategy_deployments`)
    .all() as Array<{ id: string; name: string; instrument: string; timeframe: string; strategy_id: string }>;
  for (const d of depRows) depNames.set(d.id, d.name);

  // --- Health-based recommendations ---
  for (const h of healthSnapshots) {
    const name = depNames.get(h.deploymentId) ?? h.deploymentId.slice(0, 8);

    if (h.healthScore < 20) {
      results.push(
        insertRecommendation({
          type: "PAUSE_DEPLOYMENT",
          severity: "CRITICAL",
          deploymentId: h.deploymentId,
          symbol: null,
          granularity: null,
          title: `Pause recommended: ${name}`,
          message: `Deployment "${name}" has a health score of ${h.healthScore.toFixed(0)}/100. Consider pausing until conditions improve.`,
          reasons: h.reasons,
        })
      );
    } else if (h.healthScore < 40) {
      results.push(
        insertRecommendation({
          type: "LOW_HEALTH",
          severity: "WARNING",
          deploymentId: h.deploymentId,
          symbol: null,
          granularity: null,
          title: `Low health score: ${name}`,
          message: `Deployment "${name}" health score is ${h.healthScore.toFixed(0)}/100. Monitor closely and consider rerunning validation.`,
          reasons: h.reasons,
        })
      );
    }

    // Drawdown warning
    if (h.recentDrawdown !== null && h.recentDrawdown > 0.15) {
      results.push(
        insertRecommendation({
          type: "DRAWDOWN_WARNING",
          severity: h.recentDrawdown > 0.25 ? "CRITICAL" : "WARNING",
          deploymentId: h.deploymentId,
          symbol: null,
          granularity: null,
          title: `Drawdown alert: ${name}`,
          message: `Deployment "${name}" has a recent drawdown of ${(h.recentDrawdown * 100).toFixed(1)}%.`,
          reasons: [`Recent drawdown: ${(h.recentDrawdown * 100).toFixed(1)}%`],
        })
      );
    }

    // Regime mismatch
    if (h.regimeMatchScore !== null && h.regimeMatchScore < 20) {
      const depRow = depRows.find((d) => d.id === h.deploymentId);
      const regimeSnap = depRow ? regimes.find((r) => r.symbol === depRow.instrument && r.granularity === depRow.timeframe) : null;
      results.push(
        insertRecommendation({
          type: "AVOID_REGIME",
          severity: "WARNING",
          deploymentId: h.deploymentId,
          symbol: depRow?.instrument ?? null,
          granularity: depRow?.timeframe ?? null,
          title: `Regime mismatch: ${name}`,
          message: `Strategy "${name}" has low regime compatibility score (${h.regimeMatchScore.toFixed(0)}/100) for current ${regimeSnap?.regime ?? "unknown"} regime.`,
          reasons: [`Regime match score: ${h.regimeMatchScore.toFixed(0)}/100`, ...(regimeSnap ? [`Current regime: ${regimeSnap.regime}`] : [])],
        })
      );
    }

    // No validation score — suggest rerunning
    if (h.validationScore === null && h.recentTradeCount < 5) {
      results.push(
        insertRecommendation({
          type: "RERUN_VALIDATION",
          severity: "INFO",
          deploymentId: h.deploymentId,
          symbol: null,
          granularity: null,
          title: `No validation data: ${name}`,
          message: `Deployment "${name}" has no validation score and fewer than 5 paper trades. Consider running validation.`,
          reasons: ["No linked validation result", `Paper trades: ${h.recentTradeCount}`],
        })
      );
    }
  }

  // --- Correlation warnings ---
  for (const c of correlations) {
    if (c.correlation > 0.8) {
      const nameA = depNames.get(c.deploymentAId) ?? c.deploymentAId.slice(0, 8);
      const nameB = depNames.get(c.deploymentBId) ?? c.deploymentBId.slice(0, 8);
      results.push(
        insertRecommendation({
          type: "HIGH_CORRELATION",
          severity: "WARNING",
          deploymentId: c.deploymentAId,
          symbol: null,
          granularity: null,
          title: `High correlation: ${nameA} ↔ ${nameB}`,
          message: `Deployments "${nameA}" and "${nameB}" have correlation ${c.correlation.toFixed(2)}. Diversification benefit is limited.`,
          reasons: [
            `Correlation: ${c.correlation.toFixed(2)}`,
            `Overlap score: ${c.overlapScore.toFixed(2)}`,
            c.recommendation,
          ],
        })
      );
    }
  }

  // --- Allocation-based recommendations ---
  for (const a of allocations) {
    if (a.recommendedWeight < 0.03) {
      const name = depNames.get(a.deploymentId) ?? a.deploymentId.slice(0, 8);
      results.push(
        insertRecommendation({
          type: "REDUCE_ALLOCATION",
          severity: "INFO",
          deploymentId: a.deploymentId,
          symbol: null,
          granularity: null,
          title: `Low recommended allocation: ${name}`,
          message: `Deployment "${name}" scored a recommended weight of ${(a.recommendedWeight * 100).toFixed(1)}% — near minimum. Consider reviewing or deactivating.`,
          reasons: a.reasons,
        })
      );
    }
  }

  return results;
}

/** List recommendations with optional status filter. */
export function listRecommendations(status?: RecommendationStatus, limit = 100): Recommendation[] {
  const safeLimit = Math.min(limit, 500);
  const rows = status
    ? (db
        .prepare(`SELECT * FROM recommendations WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
        .all(status, safeLimit) as RecommendationRow[])
    : (db
        .prepare(`SELECT * FROM recommendations ORDER BY created_at DESC LIMIT ?`)
        .all(safeLimit) as RecommendationRow[]);
  return rows.map(mapRow);
}

/** Dismiss or resolve a recommendation. Safe human-action endpoint. */
export function resolveRecommendation(
  id: string,
  action: "DISMISSED" | "RESOLVED",
  note?: string
): Recommendation | null {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE recommendations SET status = ?, resolved_at = ?, resolution_note = ? WHERE id = ? AND status = 'OPEN'`
  ).run(action, now, note ?? null, id);

  const row = db.prepare(`SELECT * FROM recommendations WHERE id = ?`).get(id) as RecommendationRow | undefined;
  return row ? mapRow(row) : null;
}
