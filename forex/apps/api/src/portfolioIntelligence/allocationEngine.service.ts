/**
 * Phase 18 — Allocation Recommendation Engine.
 *
 * Computes recommended portfolio weights for active/candidate deployments
 * using health score, regime match, validation score, drawdown penalties,
 * and correlation penalties. Persists to strategy_allocations.
 *
 * SAFETY: This is recommendation-only. It does NOT move money, change broker
 * settings, enable deployments, or modify autopilot flags.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/db.js";
import type { HealthSnapshot } from "./healthEngine.service.js";
import type { CorrelationRow } from "./correlationEngine.service.js";

export interface AllocationRecommendation {
  id: string;
  calculatedAt: string;
  deploymentId: string;
  recommendedWeight: number;
  rawScore: number;
  cappedScore: number;
  reasons: string[];
  createdAt: string;
}

interface AllocationRow {
  id: string;
  calculated_at: string;
  deployment_id: string;
  recommended_weight: number;
  raw_score: number;
  capped_score: number;
  reasons_json: string;
  created_at: string;
}

function mapRow(r: AllocationRow): AllocationRecommendation {
  return {
    id: r.id,
    calculatedAt: r.calculated_at,
    deploymentId: r.deployment_id,
    recommendedWeight: r.recommended_weight,
    rawScore: r.raw_score,
    cappedScore: r.capped_score,
    reasons: JSON.parse(r.reasons_json) as string[],
    createdAt: r.created_at,
  };
}

const MIN_WEIGHT = 0.02;
const MAX_WEIGHT = 0.40;

/**
 * Two-pass weight normalization: apply MAX cap and MIN floor iteratively until
 * convergence, then renormalize to exactly 1.0. This guarantees total allocated
 * weight equals 100% regardless of how many deployments are capped or floored.
 *
 * Infeasible when n * MIN_WEIGHT > 1.0 (> 50 deployments at 2% min). In that
 * case the floor is relaxed automatically by the final renormalization pass.
 */
function normalizeWeights(proportional: Map<string, number>): Map<string, number> {
  const ids = [...proportional.keys()];
  const weights = new Map(proportional);

  for (let iter = 0; iter < 30; iter++) {
    let changed = false;

    // Cap at MAX_WEIGHT and redistribute excess to uncapped
    let excessSum = 0;
    for (const [id, w] of weights) {
      if (w > MAX_WEIGHT + 1e-9) {
        excessSum += w - MAX_WEIGHT;
        weights.set(id, MAX_WEIGHT);
        changed = true;
      }
    }
    if (excessSum > 0) {
      const uncappedSum = ids.reduce((s, id) => s + (weights.get(id)! < MAX_WEIGHT - 1e-9 ? weights.get(id)! : 0), 0);
      if (uncappedSum > 0) {
        for (const id of ids) {
          const w = weights.get(id)!;
          if (w < MAX_WEIGHT - 1e-9) weights.set(id, w + (w / uncappedSum) * excessSum);
        }
      }
    }

    // Floor at MIN_WEIGHT and reclaim shortfall from those above floor
    let shortfallSum = 0;
    for (const [id, w] of weights) {
      if (w < MIN_WEIGHT - 1e-9) {
        shortfallSum += MIN_WEIGHT - w;
        weights.set(id, MIN_WEIGHT);
        changed = true;
      }
    }
    if (shortfallSum > 0) {
      const aboveFloorSum = ids.reduce((s, id) => s + (weights.get(id)! > MIN_WEIGHT + 1e-9 ? weights.get(id)! : 0), 0);
      if (aboveFloorSum > 0) {
        for (const id of ids) {
          const w = weights.get(id)!;
          if (w > MIN_WEIGHT + 1e-9) weights.set(id, Math.max(MIN_WEIGHT, w - (w / aboveFloorSum) * shortfallSum));
        }
      }
    }

    if (!changed) break;
  }

  // Final renormalize to exactly 1.0
  const totalFinal = ids.reduce((s, id) => s + weights.get(id)!, 0);
  if (totalFinal > 0) {
    for (const id of ids) weights.set(id, weights.get(id)! / totalFinal);
  }

  return weights;
}

/**
 * Compute correlation penalty for a deployment.
 * If it is highly correlated with any other deployment that has a higher score,
 * apply a reduction.
 */
function correlationPenalty(
  deploymentId: string,
  correlations: CorrelationRow[],
  scores: Map<string, number>
): number {
  const related = correlations.filter(
    (c) => c.deploymentAId === deploymentId || c.deploymentBId === deploymentId
  );

  let maxPenalty = 0;
  for (const c of related) {
    if (c.correlation < 0.6) continue;
    const otherId = c.deploymentAId === deploymentId ? c.deploymentBId : c.deploymentAId;
    const otherScore = scores.get(otherId) ?? 0;
    const myScore = scores.get(deploymentId) ?? 0;
    // Only penalise if we're the weaker one (or same) so the stronger stays intact
    if (myScore <= otherScore) {
      const penalty = (c.correlation - 0.6) * 0.5; // 0–0.2 penalty range
      maxPenalty = Math.max(maxPenalty, penalty);
    }
  }
  return maxPenalty;
}

/**
 * Compute allocation recommendations across all deployments.
 * Takes the latest health snapshots and correlation data as inputs.
 */
export function computeAllocations(
  healthSnapshots: HealthSnapshot[],
  correlations: CorrelationRow[]
): AllocationRecommendation[] {
  const now = new Date().toISOString();
  if (healthSnapshots.length === 0) return [];

  // Build raw scores per deployment
  const rawScores = new Map<string, number>();
  const reasonsMap = new Map<string, string[]>();

  for (const h of healthSnapshots) {
    const reasons: string[] = [];
    let score = h.healthScore / 100; // normalize to 0–1

    // Validation score boost
    if (h.validationScore !== null) {
      const valBonus = (h.validationScore / 100) * 0.1;
      score += valBonus;
      reasons.push(`Validation score ${h.validationScore.toFixed(1)} → +${(valBonus * 100).toFixed(1)}%`);
    }

    // Regime match boost
    if (h.regimeMatchScore !== null) {
      const rmBonus = (h.regimeMatchScore / 100) * 0.1;
      score += rmBonus;
      reasons.push(`Regime match ${h.regimeMatchScore.toFixed(0)} → +${(rmBonus * 100).toFixed(1)}%`);
    }

    // Recent drawdown penalty
    if (h.recentDrawdown !== null && h.recentDrawdown > 0.1) {
      const ddPenalty = Math.min(0.2, h.recentDrawdown);
      score -= ddPenalty;
      reasons.push(`Recent drawdown ${(h.recentDrawdown * 100).toFixed(1)}% → −${(ddPenalty * 100).toFixed(1)}%`);
    }

    score = Math.max(0, Math.min(1.2, score));
    rawScores.set(h.deploymentId, score);
    reasonsMap.set(h.deploymentId, reasons);
  }

  // Apply correlation penalties
  for (const h of healthSnapshots) {
    const penalty = correlationPenalty(h.deploymentId, correlations, rawScores);
    if (penalty > 0) {
      const cur = rawScores.get(h.deploymentId) ?? 0;
      rawScores.set(h.deploymentId, Math.max(0, cur - penalty));
      const r = reasonsMap.get(h.deploymentId) ?? [];
      r.push(`Correlation penalty −${(penalty * 100).toFixed(1)}% (overlapping deployment)`);
      reasonsMap.set(h.deploymentId, r);
    }
  }

  // Proportional weights from scores (sum to 1 before caps)
  const totalScore = [...rawScores.values()].reduce((a, b) => a + b, 0);
  const proportionalWeights = new Map<string, number>();
  for (const h of healthSnapshots) {
    const score = rawScores.get(h.deploymentId) ?? 0;
    proportionalWeights.set(h.deploymentId, totalScore > 0 ? score / totalScore : 1 / healthSnapshots.length);
  }

  // Two-pass normalization: apply MIN/MAX caps iteratively, renormalize to 100%
  const finalWeights = normalizeWeights(proportionalWeights);
  const results: AllocationRecommendation[] = [];

  for (const h of healthSnapshots) {
    const rawScore = rawScores.get(h.deploymentId) ?? 0;
    const rawWeight = proportionalWeights.get(h.deploymentId) ?? 0;
    const finalWeight = finalWeights.get(h.deploymentId) ?? MIN_WEIGHT;

    const reasons = reasonsMap.get(h.deploymentId) ?? [];
    if (rawWeight > MAX_WEIGHT + 1e-6) {
      reasons.push(`Raw weight ${(rawWeight * 100).toFixed(1)}% capped at ${(MAX_WEIGHT * 100).toFixed(0)}%`);
    } else if (rawWeight < MIN_WEIGHT - 1e-6) {
      reasons.push(`Raw weight ${(rawWeight * 100).toFixed(1)}% floored to ${(MIN_WEIGHT * 100).toFixed(0)}%`);
    }

    const rec: AllocationRecommendation = {
      id: randomUUID(),
      calculatedAt: now,
      deploymentId: h.deploymentId,
      recommendedWeight: Number(finalWeight.toFixed(4)),
      rawScore: Number(rawScore.toFixed(4)),
      cappedScore: Number(finalWeight.toFixed(4)),
      reasons,
      createdAt: now,
    };

    db.prepare(
      `INSERT INTO strategy_allocations
       (id, calculated_at, deployment_id, recommended_weight, raw_score, capped_score, reasons_json, created_at)
       VALUES (@id, @calculatedAt, @deploymentId, @recommendedWeight, @rawScore, @cappedScore, @reasonsJson, @createdAt)`
    ).run({
      id: rec.id,
      calculatedAt: rec.calculatedAt,
      deploymentId: rec.deploymentId,
      recommendedWeight: rec.recommendedWeight,
      rawScore: rec.rawScore,
      cappedScore: rec.cappedScore,
      reasonsJson: JSON.stringify(rec.reasons),
      createdAt: rec.createdAt,
    });

    results.push(rec);
  }

  return results;
}

/** Latest allocation for every deployment (one per deployment). */
export function listLatestAllocations(): AllocationRecommendation[] {
  const rows = db
    .prepare(
      `SELECT a.* FROM strategy_allocations a
       INNER JOIN (
         SELECT deployment_id, MAX(calculated_at) AS max_at
         FROM strategy_allocations GROUP BY deployment_id
       ) latest ON a.deployment_id = latest.deployment_id AND a.calculated_at = latest.max_at
       ORDER BY a.recommended_weight DESC`
    )
    .all() as AllocationRow[];
  return rows.map(mapRow);
}
