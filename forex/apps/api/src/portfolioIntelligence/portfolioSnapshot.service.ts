/**
 * Phase 18 — Portfolio Snapshot Service.
 *
 * Aggregates paper-trading equity, exposure, regime summary, and allocation
 * summary into a portfolio-level snapshot. Uses paper run data when real
 * portfolio equity is unavailable.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/db.js";
import type { RegimeSnapshot } from "./regimeEngine.service.js";
import type { AllocationRecommendation } from "./allocationEngine.service.js";

export interface PortfolioSnapshot {
  id: string;
  calculatedAt: string;
  equity: number | null;
  realizedPL: number | null;
  unrealizedPL: number | null;
  drawdown: number | null;
  exposure: number | null;
  activeDeploymentCount: number;
  regimeSummary: Record<string, unknown>;
  allocationSummary: Record<string, unknown>;
  riskSummary: Record<string, unknown>;
  createdAt: string;
}

interface PortfolioSnapshotRow {
  id: string;
  calculated_at: string;
  equity: number | null;
  realized_pl: number | null;
  unrealized_pl: number | null;
  drawdown: number | null;
  exposure: number | null;
  active_deployment_count: number;
  regime_summary_json: string;
  allocation_summary_json: string;
  risk_summary_json: string;
  created_at: string;
}

function mapRow(r: PortfolioSnapshotRow): PortfolioSnapshot {
  return {
    id: r.id,
    calculatedAt: r.calculated_at,
    equity: r.equity,
    realizedPL: r.realized_pl,
    unrealizedPL: r.unrealized_pl,
    drawdown: r.drawdown,
    exposure: r.exposure,
    activeDeploymentCount: r.active_deployment_count,
    regimeSummary: JSON.parse(r.regime_summary_json) as Record<string, unknown>,
    allocationSummary: JSON.parse(r.allocation_summary_json) as Record<string, unknown>,
    riskSummary: JSON.parse(r.risk_summary_json) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

/**
 * Build a portfolio snapshot from current paper trading state + regime/allocation data.
 */
export function computePortfolioSnapshot(
  currentRegimes: RegimeSnapshot[],
  allocations: AllocationRecommendation[]
): PortfolioSnapshot {
  const now = new Date().toISOString();

  // Aggregate from active paper runs
  const paperAgg = db
    .prepare(
      `SELECT
        COUNT(*) AS run_count,
        SUM(current_equity) AS total_equity,
        SUM(realized_pl) AS total_realized_pl,
        SUM(unrealized_pl) AS total_unrealized_pl,
        MAX(max_drawdown) AS max_drawdown,
        starting_balance
       FROM paper_runs WHERE status = 'ACTIVE'`
    )
    .get() as {
    run_count: number;
    total_equity: number | null;
    total_realized_pl: number | null;
    total_unrealized_pl: number | null;
    max_drawdown: number | null;
    starting_balance: number | null;
  };

  // Active deployment count
  const activeDeploymentCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM strategy_deployments WHERE enabled = 1`).get() as { c: number }
  ).c;

  // Open positions count as exposure
  const openPositions = (
    db.prepare(`SELECT COUNT(*) AS c FROM paper_positions`).get() as { c: number }
  ).c;
  const exposure = activeDeploymentCount > 0 ? openPositions / activeDeploymentCount : 0;

  // Drawdown
  const drawdown =
    paperAgg.total_equity !== null && paperAgg.starting_balance !== null && paperAgg.starting_balance > 0
      ? Math.max(0, (paperAgg.starting_balance - paperAgg.total_equity) / paperAgg.starting_balance)
      : paperAgg.max_drawdown;

  // Regime summary
  const regimeCounts: Record<string, number> = {};
  for (const r of currentRegimes) {
    regimeCounts[r.regime] = (regimeCounts[r.regime] ?? 0) + 1;
  }
  const regimeSummary: Record<string, unknown> = {
    counts: regimeCounts,
    dominant: currentRegimes.length > 0
      ? Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN"
      : "UNKNOWN",
    total: currentRegimes.length,
  };

  // Allocation summary
  const allocationSummary: Record<string, unknown> = {
    deploymentCount: allocations.length,
    totalAllocated: Number(allocations.reduce((s, a) => s + a.recommendedWeight, 0).toFixed(4)),
    maxWeight: allocations.length > 0 ? Math.max(...allocations.map((a) => a.recommendedWeight)) : 0,
    minWeight: allocations.length > 0 ? Math.min(...allocations.map((a) => a.recommendedWeight)) : 0,
  };

  // Risk summary
  const riskSummary: Record<string, unknown> = {
    activeRuns: paperAgg.run_count ?? 0,
    openPositions,
    paperOnly: true,
    note: "All figures are paper/simulated. No real capital is at risk.",
    maxDrawdown: paperAgg.max_drawdown,
  };

  const snap: PortfolioSnapshot = {
    id: randomUUID(),
    calculatedAt: now,
    equity: paperAgg.total_equity,
    realizedPL: paperAgg.total_realized_pl,
    unrealizedPL: paperAgg.total_unrealized_pl,
    drawdown,
    exposure,
    activeDeploymentCount,
    regimeSummary,
    allocationSummary,
    riskSummary,
    createdAt: now,
  };

  db.prepare(
    `INSERT INTO portfolio_snapshots
     (id, calculated_at, equity, realized_pl, unrealized_pl, drawdown, exposure,
      active_deployment_count, regime_summary_json, allocation_summary_json, risk_summary_json, created_at)
     VALUES (@id, @calculatedAt, @equity, @realizedPL, @unrealizedPL, @drawdown, @exposure,
             @activeDeploymentCount, @regimeSummaryJson, @allocationSummaryJson, @riskSummaryJson, @createdAt)`
  ).run({
    id: snap.id,
    calculatedAt: snap.calculatedAt,
    equity: snap.equity,
    realizedPL: snap.realizedPL,
    unrealizedPL: snap.unrealizedPL,
    drawdown: snap.drawdown,
    exposure: snap.exposure,
    activeDeploymentCount: snap.activeDeploymentCount,
    regimeSummaryJson: JSON.stringify(snap.regimeSummary),
    allocationSummaryJson: JSON.stringify(snap.allocationSummary),
    riskSummaryJson: JSON.stringify(snap.riskSummary),
    createdAt: snap.createdAt,
  });

  return snap;
}

/** Most recent portfolio snapshot, or null. */
export function getLatestPortfolioSnapshot(): PortfolioSnapshot | null {
  const row = db
    .prepare(`SELECT * FROM portfolio_snapshots ORDER BY calculated_at DESC LIMIT 1`)
    .get() as PortfolioSnapshotRow | undefined;
  return row ? mapRow(row) : null;
}

/** Portfolio snapshot history, newest first. */
export function listPortfolioSnapshots(limit = 20): PortfolioSnapshot[] {
  const rows = db
    .prepare(`SELECT * FROM portfolio_snapshots ORDER BY calculated_at DESC LIMIT ?`)
    .all(Math.min(limit, 100)) as PortfolioSnapshotRow[];
  return rows.map(mapRow);
}
