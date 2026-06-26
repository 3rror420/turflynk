/**
 * Phase 18 — Portfolio Intelligence Analysis Orchestrator.
 *
 * Coordinates the full Phase 18 analysis pipeline:
 *   1. Detect regimes for all active deployment symbols/timeframes
 *   2. Compute health snapshots for all deployments
 *   3. Compute deployment correlations
 *   4. Compute allocation recommendations
 *   5. Build portfolio snapshot
 *   6. Generate recommendations
 *
 * Returns a summary of everything computed. Safe to run any time — all
 * outputs are persisted snapshots. Never touches broker/order tables.
 */
import { db } from "../db/db.js";
import { detectRegime, listCurrentRegimes } from "./regimeEngine.service.js";
import { computeHealthSnapshot, listLatestHealthSnapshots } from "./healthEngine.service.js";
import { computeAllCorrelations, listLatestCorrelations } from "./correlationEngine.service.js";
import { computeAllocations, listLatestAllocations } from "./allocationEngine.service.js";
import { computePortfolioSnapshot, getLatestPortfolioSnapshot } from "./portfolioSnapshot.service.js";
import { generateRecommendations, listRecommendations } from "./recommendationEngine.service.js";
import type { RegimeSnapshot } from "./regimeEngine.service.js";
import type { HealthSnapshot } from "./healthEngine.service.js";
import type { CorrelationRow } from "./correlationEngine.service.js";
import type { AllocationRecommendation } from "./allocationEngine.service.js";
import type { PortfolioSnapshot } from "./portfolioSnapshot.service.js";
import type { Recommendation } from "./recommendationEngine.service.js";

export interface Phase18AnalysisResult {
  ranAt: string;
  regimes: RegimeSnapshot[];
  healthSnapshots: HealthSnapshot[];
  correlations: CorrelationRow[];
  allocations: AllocationRecommendation[];
  portfolioSnapshot: PortfolioSnapshot;
  recommendations: Recommendation[];
  summary: {
    symbolsAnalyzed: number;
    deploymentsScored: number;
    correlationPairsComputed: number;
    allocationsGenerated: number;
    recommendationsGenerated: number;
    openRecommendations: number;
    criticalRecommendations: number;
  };
}

/**
 * Run the full Phase 18 analysis pipeline.
 * @param triggeredBy - username or label for audit logging.
 */
export function runPhase18Analysis(triggeredBy = "system"): Phase18AnalysisResult {
  const ranAt = new Date().toISOString();
  console.log(`[phase18] Analysis triggered by "${triggeredBy}" at ${ranAt}`);

  // 1. Collect all active deployment symbols/timeframes
  const deployments = db
    .prepare(
      `SELECT id, instrument, timeframe, strategy_id, name FROM strategy_deployments ORDER BY created_at`
    )
    .all() as Array<{ id: string; instrument: string; timeframe: string; strategy_id: string; name: string }>;

  // Unique symbol+timeframe pairs
  const pairs = new Map<string, { symbol: string; granularity: string }>();
  for (const d of deployments) {
    const key = `${d.instrument}::${d.timeframe}`;
    if (!pairs.has(key)) pairs.set(key, { symbol: d.instrument, granularity: d.timeframe });
  }

  // 2. Detect regimes
  const regimes: RegimeSnapshot[] = [];
  for (const { symbol, granularity } of pairs.values()) {
    try {
      const snap = detectRegime(symbol, granularity);
      regimes.push(snap);
    } catch (err) {
      console.warn(`[phase18] Regime detection failed for ${symbol}/${granularity}:`, err instanceof Error ? err.message : err);
    }
  }

  // 3. Health snapshots for all deployments
  const healthSnapshots: HealthSnapshot[] = [];
  for (const d of deployments) {
    try {
      const snap = computeHealthSnapshot(d.id);
      healthSnapshots.push(snap);
    } catch (err) {
      console.warn(`[phase18] Health computation failed for ${d.name}:`, err instanceof Error ? err.message : err);
    }
  }

  // 4. Correlations
  let correlations: CorrelationRow[] = [];
  try {
    correlations = computeAllCorrelations(30);
  } catch (err) {
    console.warn("[phase18] Correlation computation failed:", err instanceof Error ? err.message : err);
    correlations = listLatestCorrelations();
  }

  // 5. Allocations
  let allocations: AllocationRecommendation[] = [];
  try {
    allocations = computeAllocations(healthSnapshots, correlations);
  } catch (err) {
    console.warn("[phase18] Allocation computation failed:", err instanceof Error ? err.message : err);
    allocations = listLatestAllocations();
  }

  // 6. Portfolio snapshot
  let portfolioSnapshot: PortfolioSnapshot;
  try {
    portfolioSnapshot = computePortfolioSnapshot(regimes, allocations);
  } catch (err) {
    console.warn("[phase18] Portfolio snapshot failed:", err instanceof Error ? err.message : err);
    portfolioSnapshot = getLatestPortfolioSnapshot() ?? {
      id: "none",
      calculatedAt: ranAt,
      equity: null,
      realizedPL: null,
      unrealizedPL: null,
      drawdown: null,
      exposure: null,
      activeDeploymentCount: 0,
      regimeSummary: {},
      allocationSummary: {},
      riskSummary: { paperOnly: true },
      createdAt: ranAt,
    };
  }

  // 7. Recommendations
  let recommendations: Recommendation[] = [];
  try {
    recommendations = generateRecommendations(healthSnapshots, regimes, correlations, allocations);
  } catch (err) {
    console.warn("[phase18] Recommendation generation failed:", err instanceof Error ? err.message : err);
  }

  const openRecs = recommendations.filter((r) => r.status === "OPEN");
  const criticalRecs = openRecs.filter((r) => r.severity === "CRITICAL");

  console.log(
    `[phase18] Analysis complete: ${regimes.length} regimes, ${healthSnapshots.length} health, ` +
      `${correlations.length} correlations, ${allocations.length} allocations, ` +
      `${recommendations.length} recommendations (${criticalRecs.length} critical)`
  );

  return {
    ranAt,
    regimes,
    healthSnapshots,
    correlations,
    allocations,
    portfolioSnapshot,
    recommendations,
    summary: {
      symbolsAnalyzed: pairs.size,
      deploymentsScored: healthSnapshots.length,
      correlationPairsComputed: correlations.length,
      allocationsGenerated: allocations.length,
      recommendationsGenerated: recommendations.length,
      openRecommendations: openRecs.length,
      criticalRecommendations: criticalRecs.length,
    },
  };
}

/** Return the latest analysis state without re-running the pipeline. */
export function getLatestAnalysisState() {
  return {
    regimes: listCurrentRegimes(),
    healthSnapshots: listLatestHealthSnapshots(),
    correlations: listLatestCorrelations(),
    allocations: listLatestAllocations(),
    portfolioSnapshot: getLatestPortfolioSnapshot(),
    recommendations: listRecommendations("OPEN"),
  };
}
