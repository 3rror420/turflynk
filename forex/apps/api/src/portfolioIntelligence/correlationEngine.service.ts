/**
 * Phase 18 — Deployment Correlation Engine.
 *
 * Computes pairwise rolling correlation between deployments based on recent
 * paper trade P&L returns. Warns when deployments are highly correlated
 * (doing essentially the same thing). Pure analysis — no mutation of any
 * deployment, paper, or broker table.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/db.js";

export interface CorrelationRow {
  id: string;
  deploymentAId: string;
  deploymentBId: string;
  calculatedAt: string;
  lookbackTrades: number;
  lookbackDays: number;
  correlation: number;
  overlapScore: number;
  recommendation: string;
  createdAt: string;
}

interface CorrelationDbRow {
  id: string;
  deployment_a_id: string;
  deployment_b_id: string;
  calculated_at: string;
  lookback_trades: number;
  lookback_days: number;
  correlation: number;
  overlap_score: number;
  recommendation: string;
  created_at: string;
}

function mapRow(r: CorrelationDbRow): CorrelationRow {
  return {
    id: r.id,
    deploymentAId: r.deployment_a_id,
    deploymentBId: r.deployment_b_id,
    calculatedAt: r.calculated_at,
    lookbackTrades: r.lookback_trades,
    lookbackDays: r.lookback_days,
    correlation: r.correlation,
    overlapScore: r.overlap_score,
    recommendation: r.recommendation,
    createdAt: r.created_at,
  };
}

/** Pearson correlation of two equal-length numeric arrays. */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, denomA = 0, denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? 0 : num / denom;
}

interface PlRow {
  date_key: string;
  daily_pl: number;
}

/** Aggregate daily P&L for a deployment's paper trades over a lookback window. */
function getDailyPl(deploymentId: string, lookbackDays: number): Map<string, number> {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT substr(exit_time, 1, 10) AS date_key, SUM(realized_pl) AS daily_pl
       FROM paper_trades
       WHERE deployment_id = ? AND exit_time >= ?
       GROUP BY date_key`
    )
    .all(deploymentId, cutoff) as PlRow[];
  return new Map(rows.map((r) => [r.date_key, r.daily_pl]));
}

/** Instrument overlap: same base currency pair → high overlap. */
function instrumentOverlap(instrA: string, instrB: string): number {
  if (instrA === instrB) return 1;
  const [a1, a2] = instrA.replace("_", "/").split("/");
  const [b1, b2] = instrB.replace("_", "/").split("/");
  const aSet = new Set([a1, a2]);
  const bSet = new Set([b1, b2]);
  const shared = [...aSet].filter((c) => bSet.has(c)).length;
  return shared / 2;
}

/** Timeframe overlap score (1 for same, decreasing for distance). */
const TF_ORDER = ["M1", "M5", "M15", "M30", "H1", "H4", "D", "W", "M"];
function timeframeOverlap(tfA: string, tfB: string): number {
  if (tfA === tfB) return 1;
  const ia = TF_ORDER.indexOf(tfA);
  const ib = TF_ORDER.indexOf(tfB);
  if (ia < 0 || ib < 0) return 0;
  const dist = Math.abs(ia - ib);
  return Math.max(0, 1 - dist * 0.2);
}

/**
 * Compute pairwise correlations across all deployments with paper data.
 * Persists correlation rows. Returns all new correlation rows.
 */
export function computeAllCorrelations(lookbackDays = 30): CorrelationRow[] {
  const now = new Date().toISOString();

  const deployments = db
    .prepare(`SELECT id, instrument, timeframe, strategy_id FROM strategy_deployments ORDER BY created_at`)
    .all() as Array<{ id: string; instrument: string; timeframe: string; strategy_id: string }>;

  if (deployments.length < 2) return [];

  const results: CorrelationRow[] = [];

  for (let i = 0; i < deployments.length; i++) {
    for (let j = i + 1; j < deployments.length; j++) {
      const a = deployments[i];
      const b = deployments[j];

      const plA = getDailyPl(a.id, lookbackDays);
      const plB = getDailyPl(b.id, lookbackDays);

      // Align on common trading days
      const commonDays = [...plA.keys()].filter((d) => plB.has(d)).sort();

      let correlation = 0;
      let lookbackTrades = commonDays.length;

      if (commonDays.length >= 3) {
        const seriesA = commonDays.map((d) => plA.get(d)!);
        const seriesB = commonDays.map((d) => plB.get(d)!);
        correlation = pearsonCorrelation(seriesA, seriesB);
      }

      // Overlap score: combination of instrument similarity + timeframe + correlation
      const instrOvlp = instrumentOverlap(a.instrument, b.instrument);
      const tfOvlp = timeframeOverlap(a.timeframe, b.timeframe);
      const overlapScore = (instrOvlp * 0.5 + tfOvlp * 0.3 + Math.max(0, correlation) * 0.2);

      const recommendation = buildCorrelationRecommendation(correlation, overlapScore, lookbackTrades);

      const row: CorrelationRow = {
        id: randomUUID(),
        deploymentAId: a.id,
        deploymentBId: b.id,
        calculatedAt: now,
        lookbackTrades,
        lookbackDays,
        correlation: Number(correlation.toFixed(4)),
        overlapScore: Number(overlapScore.toFixed(4)),
        recommendation,
        createdAt: now,
      };

      db.prepare(
        `INSERT INTO deployment_correlations
         (id, deployment_a_id, deployment_b_id, calculated_at, lookback_trades, lookback_days,
          correlation, overlap_score, recommendation, created_at)
         VALUES (@id, @deploymentAId, @deploymentBId, @calculatedAt, @lookbackTrades, @lookbackDays,
                 @correlation, @overlapScore, @recommendation, @createdAt)`
      ).run(row);

      results.push(row);
    }
  }

  return results;
}

function buildCorrelationRecommendation(correlation: number, overlapScore: number, samples: number): string {
  if (samples < 3) return "Insufficient shared trading days for correlation — monitor after more data accumulates";
  if (correlation > 0.85 && overlapScore > 0.7)
    return "Very high correlation and overlap — these deployments are nearly redundant; consider removing one";
  if (correlation > 0.7)
    return "High correlation detected — diversification benefit is limited; review allocation";
  if (correlation > 0.4)
    return "Moderate correlation — some diversification benefit; acceptable";
  if (correlation < -0.3)
    return "Negative correlation — these deployments hedge each other well";
  return "Low correlation — good diversification";
}

/** Latest correlation matrix (one row per A/B pair). */
export function listLatestCorrelations(): CorrelationRow[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM deployment_correlations c
       INNER JOIN (
         SELECT deployment_a_id, deployment_b_id, MAX(calculated_at) AS max_at
         FROM deployment_correlations
         GROUP BY deployment_a_id, deployment_b_id
       ) latest ON c.deployment_a_id = latest.deployment_a_id
                AND c.deployment_b_id = latest.deployment_b_id
                AND c.calculated_at = latest.max_at
       ORDER BY c.correlation DESC`
    )
    .all() as CorrelationDbRow[];
  return rows.map(mapRow);
}
