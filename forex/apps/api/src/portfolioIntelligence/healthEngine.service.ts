/**
 * Phase 18 — Deployment Health Engine.
 *
 * Computes a 0–100 health score per deployment using paper trade data,
 * validation scores, candidate ranks, and regime match. Snapshots are
 * persisted and readable via the API. Pure analysis — no mutation of
 * deployments, paper runs, or broker tables.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/db.js";
import { scoreRegimeCompatibility } from "./compatibilityMatrix.service.js";
import { getLatestRegime } from "./regimeEngine.service.js";

export interface HealthSnapshot {
  id: string;
  deploymentId: string;
  calculatedAt: string;
  healthScore: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgReturn: number | null;
  maxDrawdown: number | null;
  recentDrawdown: number | null;
  recentTradeCount: number;
  regimeMatchScore: number | null;
  validationScore: number | null;
  candidateScore: number | null;
  reasons: string[];
  createdAt: string;
}

interface HealthRow {
  id: string;
  deployment_id: string;
  calculated_at: string;
  health_score: number;
  win_rate: number | null;
  profit_factor: number | null;
  expectancy: number | null;
  avg_return: number | null;
  max_drawdown: number | null;
  recent_drawdown: number | null;
  recent_trade_count: number;
  regime_match_score: number | null;
  validation_score: number | null;
  candidate_score: number | null;
  reasons_json: string;
  created_at: string;
}

function mapRow(r: HealthRow): HealthSnapshot {
  return {
    id: r.id,
    deploymentId: r.deployment_id,
    calculatedAt: r.calculated_at,
    healthScore: r.health_score,
    winRate: r.win_rate,
    profitFactor: r.profit_factor,
    expectancy: r.expectancy,
    avgReturn: r.avg_return,
    maxDrawdown: r.max_drawdown,
    recentDrawdown: r.recent_drawdown,
    recentTradeCount: r.recent_trade_count,
    regimeMatchScore: r.regime_match_score,
    validationScore: r.validation_score,
    candidateScore: r.candidate_score,
    reasons: JSON.parse(r.reasons_json) as string[],
    createdAt: r.created_at,
  };
}

interface PaperAgg {
  trade_count: number;
  win_count: number;
  gross_profit: number;
  gross_loss: number;
  avg_pl: number;
  max_drawdown: number;
  recent_drawdown: number;
  recent_trade_count: number;
}

/** Pull aggregated paper trade stats for a deployment's active/most-recent run. */
function getPaperStats(deploymentId: string): PaperAgg | null {
  // Find the most recent paper run for this deployment (prefer ACTIVE)
  const run = db
    .prepare(
      `SELECT id, max_drawdown, current_equity, starting_balance FROM paper_runs
       WHERE deployment_id = ?
       ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END,
                created_at DESC LIMIT 1`
    )
    .get(deploymentId) as { id: string; max_drawdown: number; current_equity: number; starting_balance: number } | undefined;

  if (!run) return null;

  const agg = db
    .prepare(
      `SELECT
        COUNT(*) AS trade_count,
        SUM(CASE WHEN realized_pl > 0 THEN 1 ELSE 0 END) AS win_count,
        COALESCE(SUM(CASE WHEN realized_pl > 0 THEN realized_pl ELSE 0 END), 0) AS gross_profit,
        COALESCE(SUM(CASE WHEN realized_pl <= 0 THEN ABS(realized_pl) ELSE 0 END), 0) AS gross_loss,
        AVG(realized_pl) AS avg_pl
       FROM paper_trades WHERE run_id = ?`
    )
    .get(run.id) as { trade_count: number; win_count: number; gross_profit: number; gross_loss: number; avg_pl: number };

  // Recent drawdown: current equity vs starting balance
  const recentDrawdown =
    run.starting_balance > 0
      ? Math.max(0, (run.starting_balance - run.current_equity) / run.starting_balance)
      : 0;

  // Recent (last 10) trades — subquery required; LIMIT inside COUNT(*) is a no-op
  const recentCount = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM (SELECT id FROM paper_trades WHERE run_id = ? ORDER BY created_at DESC LIMIT 10)`)
      .get(run.id) as { c: number }
  ).c;

  return {
    trade_count: agg.trade_count ?? 0,
    win_count: agg.win_count ?? 0,
    gross_profit: agg.gross_profit ?? 0,
    gross_loss: agg.gross_loss ?? 0,
    avg_pl: agg.avg_pl ?? 0,
    max_drawdown: run.max_drawdown,
    recent_drawdown: recentDrawdown,
    recent_trade_count: Math.min(recentCount, 10),
  };
}

/** Pull the best validation score linked to a deployment. */
function getValidationScore(deploymentId: string): number | null {
  const dep = db
    .prepare(`SELECT source_type, source_result_id FROM strategy_deployments WHERE id = ?`)
    .get(deploymentId) as { source_type: string | null; source_result_id: string | null } | undefined;

  if (!dep?.source_result_id) return null;

  if (dep.source_type === "validation_result") {
    const sc = db
      .prepare(
        `SELECT sc.score_total FROM validation_scorecards sc
         INNER JOIN validation_results vr ON vr.validation_run_id = sc.validation_run_id
         WHERE vr.id = ? LIMIT 1`
      )
      .get(dep.source_result_id) as { score_total: number } | undefined;
    return sc?.score_total ?? null;
  }

  if (dep.source_type === "optimizer_result") {
    const res = db
      .prepare(`SELECT score FROM optimizer_results WHERE id = ? LIMIT 1`)
      .get(dep.source_result_id) as { score: number } | undefined;
    return res ? Math.min(100, res.score * 100) : null;
  }

  return null;
}

/** Pull the best ranking result score for a deployment (via candidate chain). */
function getCandidateScore(deploymentId: string): number | null {
  const rr = db
    .prepare(
      `SELECT rr.score FROM ranking_results rr
       INNER JOIN deployment_candidates dc ON dc.id = rr.candidate_id
       INNER JOIN strategy_deployments sd ON sd.source_result_id = dc.validation_result_id
       WHERE sd.id = ?
       ORDER BY rr.score DESC LIMIT 1`
    )
    .get(deploymentId) as { score: number } | undefined;
  return rr ? Math.min(100, rr.score) : null;
}

/**
 * Compute and persist a health snapshot for a deployment.
 * Degrades gracefully when paper/validation data is unavailable.
 */
export function computeHealthSnapshot(deploymentId: string): HealthSnapshot {
  const now = new Date().toISOString();
  const reasons: string[] = [];

  const dep = db
    .prepare(`SELECT strategy_id, instrument, timeframe FROM strategy_deployments WHERE id = ?`)
    .get(deploymentId) as { strategy_id: string; instrument: string; timeframe: string } | undefined;

  if (!dep) {
    const snap: HealthSnapshot = {
      id: randomUUID(),
      deploymentId,
      calculatedAt: now,
      healthScore: 0,
      winRate: null,
      profitFactor: null,
      expectancy: null,
      avgReturn: null,
      maxDrawdown: null,
      recentDrawdown: null,
      recentTradeCount: 0,
      regimeMatchScore: null,
      validationScore: null,
      candidateScore: null,
      reasons: ["Deployment not found"],
      createdAt: now,
    };
    persistHealth(snap);
    return snap;
  }

  const paper = getPaperStats(deploymentId);
  const validationScore = getValidationScore(deploymentId);
  const candidateScore = getCandidateScore(deploymentId);

  // Regime match
  const latestRegime = getLatestRegime(dep.instrument, dep.timeframe);
  let regimeMatchScore: number | null = null;
  if (latestRegime) {
    const compat = scoreRegimeCompatibility(dep.strategy_id, latestRegime.regime);
    regimeMatchScore = compat.score;
    reasons.push(`Regime: ${latestRegime.regime} — ${compat.reason}`);
  } else {
    reasons.push("No regime snapshot available; run Phase 18 analysis first");
  }

  // Score components
  let score = 50; // base

  if (!paper || paper.trade_count === 0) {
    reasons.push("No paper trade data — using prior scores only");
    score = 40;
  } else {
    const winRate = paper.trade_count > 0 ? paper.win_count / paper.trade_count : 0;
    const profitFactor = paper.gross_loss > 0 ? paper.gross_profit / paper.gross_loss : paper.gross_profit > 0 ? 3 : 1;
    const expectancy = paper.avg_pl;

    // Win rate contribution (0–25 pts)
    const wrContrib = Math.min(25, winRate * 50);
    score = wrContrib;
    reasons.push(`Win rate ${(winRate * 100).toFixed(1)}% → ${wrContrib.toFixed(1)} pts`);

    // Profit factor (0–25 pts)
    const pfContrib = Math.min(25, (Math.min(profitFactor, 3) / 3) * 25);
    score += pfContrib;
    reasons.push(`Profit factor ${profitFactor.toFixed(2)} → ${pfContrib.toFixed(1)} pts`);

    // Drawdown penalty (−15 pts max)
    const ddPenalty = Math.min(15, paper.max_drawdown * 100);
    score -= ddPenalty;
    if (ddPenalty > 5) reasons.push(`Max drawdown ${(paper.max_drawdown * 100).toFixed(1)}% → −${ddPenalty.toFixed(1)} pts`);

    // Recent drawdown penalty (−10 pts max)
    const rddPenalty = Math.min(10, paper.recent_drawdown * 100);
    score -= rddPenalty;
    if (rddPenalty > 3) reasons.push(`Recent drawdown ${(paper.recent_drawdown * 100).toFixed(1)}% → −${rddPenalty.toFixed(1)} pts`);

    // Trade sample boost/penalty
    if (paper.trade_count < 5) {
      score -= 10;
      reasons.push("Fewer than 5 trades — small sample penalty");
    } else if (paper.trade_count >= 20) {
      score += 5;
      reasons.push("20+ trades — sufficient sample bonus");
    }
  }

  // Validation score contribution (0–20 pts)
  if (validationScore !== null) {
    const valContrib = (validationScore / 100) * 20;
    score += valContrib;
    reasons.push(`Validation score ${validationScore.toFixed(1)} → +${valContrib.toFixed(1)} pts`);
  }

  // Regime match contribution (0–15 pts)
  if (regimeMatchScore !== null) {
    const rmContrib = (regimeMatchScore / 100) * 15;
    score += rmContrib;
    reasons.push(`Regime match score ${regimeMatchScore.toFixed(0)} → +${rmContrib.toFixed(1)} pts`);
  }

  score = Math.max(0, Math.min(100, score));

  const paper2 = paper && paper.trade_count > 0 ? paper : null;
  const winRate = paper2 ? paper2.win_count / paper2.trade_count : null;
  const profitFactor =
    paper2 && paper2.gross_loss > 0
      ? paper2.gross_profit / paper2.gross_loss
      : paper2 && paper2.gross_profit > 0
        ? 3
        : null;

  const snap: HealthSnapshot = {
    id: randomUUID(),
    deploymentId,
    calculatedAt: now,
    healthScore: score,
    winRate: winRate,
    profitFactor,
    expectancy: paper2 ? paper2.avg_pl : null,
    avgReturn: paper2 ? paper2.avg_pl : null,
    maxDrawdown: paper2 ? paper2.max_drawdown : null,
    recentDrawdown: paper2 ? paper2.recent_drawdown : null,
    recentTradeCount: paper2 ? paper2.recent_trade_count : 0,
    regimeMatchScore,
    validationScore,
    candidateScore,
    reasons,
    createdAt: now,
  };

  persistHealth(snap);
  return snap;
}

function persistHealth(snap: HealthSnapshot): void {
  db.prepare(
    `INSERT INTO strategy_health
     (id, deployment_id, calculated_at, health_score, win_rate, profit_factor, expectancy,
      avg_return, max_drawdown, recent_drawdown, recent_trade_count, regime_match_score,
      validation_score, candidate_score, reasons_json, created_at)
     VALUES (@id, @deploymentId, @calculatedAt, @healthScore, @winRate, @profitFactor, @expectancy,
             @avgReturn, @maxDrawdown, @recentDrawdown, @recentTradeCount, @regimeMatchScore,
             @validationScore, @candidateScore, @reasonsJson, @createdAt)`
  ).run({
    id: snap.id,
    deploymentId: snap.deploymentId,
    calculatedAt: snap.calculatedAt,
    healthScore: snap.healthScore,
    winRate: snap.winRate,
    profitFactor: snap.profitFactor,
    expectancy: snap.expectancy,
    avgReturn: snap.avgReturn,
    maxDrawdown: snap.maxDrawdown,
    recentDrawdown: snap.recentDrawdown,
    recentTradeCount: snap.recentTradeCount,
    regimeMatchScore: snap.regimeMatchScore,
    validationScore: snap.validationScore,
    candidateScore: snap.candidateScore,
    reasonsJson: JSON.stringify(snap.reasons),
    createdAt: snap.createdAt,
  });
}

/** Latest health snapshot for a deployment, or null. */
export function getLatestHealth(deploymentId: string): HealthSnapshot | null {
  const row = db
    .prepare(`SELECT * FROM strategy_health WHERE deployment_id = ? ORDER BY calculated_at DESC LIMIT 1`)
    .get(deploymentId) as HealthRow | undefined;
  return row ? mapRow(row) : null;
}

/** Latest health snapshot for every deployment (one row per deployment). */
export function listLatestHealthSnapshots(): HealthSnapshot[] {
  const rows = db
    .prepare(
      `SELECT h.* FROM strategy_health h
       INNER JOIN (
         SELECT deployment_id, MAX(calculated_at) AS max_at FROM strategy_health GROUP BY deployment_id
       ) latest ON h.deployment_id = latest.deployment_id AND h.calculated_at = latest.max_at
       ORDER BY h.health_score DESC`
    )
    .all() as HealthRow[];
  return rows.map(mapRow);
}
