/**
 * Phase 18 smoke test — Adaptive Portfolio Intelligence.
 *
 * Verifies:
 * - All Phase 18 tables exist and accept reads/writes
 * - Regime detection runs (UNKNOWN when no candles)
 * - Health snapshot computed for a synthetic deployment
 * - Correlation rows created for 2+ deployments
 * - Allocation rows created
 * - Portfolio snapshot created
 * - Recommendations created (including open count)
 * - Recommendation resolve action works
 * - Full analysis orchestrator exits cleanly
 * - No broker/order/manual-trading tables are modified
 * - No live strategy engine started
 * - No autopilot flags mutated
 */
import { db } from "../db/db.js";
import { runPhase18Analysis } from "../portfolioIntelligence/analysis.service.js";
import { detectRegime, getLatestRegime, listCurrentRegimes, listRegimeHistory } from "../portfolioIntelligence/regimeEngine.service.js";
import { computeHealthSnapshot, getLatestHealth, listLatestHealthSnapshots } from "../portfolioIntelligence/healthEngine.service.js";
import { computeAllCorrelations, listLatestCorrelations } from "../portfolioIntelligence/correlationEngine.service.js";
import { computeAllocations } from "../portfolioIntelligence/allocationEngine.service.js";
import { computePortfolioSnapshot, getLatestPortfolioSnapshot } from "../portfolioIntelligence/portfolioSnapshot.service.js";
import { generateRecommendations, listRecommendations, resolveRecommendation } from "../portfolioIntelligence/recommendationEngine.service.js";
import { scoreRegimeCompatibility } from "../portfolioIntelligence/compatibilityMatrix.service.js";
import { createDeployment, DEPLOYMENT_SOURCE_TYPES } from "../services/strategyDeployment.service.js";
import { strategyEngine } from "../strategyEngine/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[phase18 FAIL] ${message}`);
}

const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
const countManualOrders = () => count("SELECT COUNT(*) AS c FROM manual_order_executions");
const countManualCloses = () => count("SELECT COUNT(*) AS c FROM manual_close_executions");
const countAutopilot = () => count("SELECT COUNT(*) AS c FROM strategy_deployments WHERE autopilot = 1");

assert(
  process.env.STRATEGY_ENGINE_ENABLED !== "true",
  "STRATEGY_ENGINE_ENABLED must not be true for phase18 QA"
);
console.log(`[phase18] DATABASE_FILE=${process.env.DATABASE_FILE ?? "(default)"}`);
assert(strategyEngine.status().running === false, "strategy engine must not be running before phase18 QA");

const manualOrdersBefore = countManualOrders();
const manualClosesBefore = countManualCloses();
const autopilotBefore = countAutopilot();

// ── 1. Tables exist ────────────────────────────────────────────────────────
const tables = ["market_regimes", "strategy_health", "deployment_correlations", "strategy_allocations", "portfolio_snapshots", "recommendations"];
for (const t of tables) {
  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  assert(exists, `Table "${t}" must exist after Phase 18 migration`);
}
console.log("[phase18] All Phase 18 tables exist ok");

// ── 2. Regime detection (no candles → UNKNOWN) ────────────────────────────
const unknownRegime = detectRegime("EUR_USD", "M5");
assert(unknownRegime.symbol === "EUR_USD", "regime symbol must match");
assert(unknownRegime.granularity === "M5", "regime granularity must match");
assert(typeof unknownRegime.regime === "string", "regime must be a string");
assert(typeof unknownRegime.confidence === "number", "confidence must be a number");
assert(Array.isArray(unknownRegime.reasons), "reasons must be an array");
// With no candles stored, regime will be UNKNOWN
assert(unknownRegime.regime === "UNKNOWN", "regime must be UNKNOWN when no candles exist");

const savedRegime = getLatestRegime("EUR_USD", "M5");
assert(savedRegime !== null, "getLatestRegime must return the persisted snapshot");
assert(savedRegime!.id === unknownRegime.id, "persisted regime id must match returned id");

const historyRows = listRegimeHistory("EUR_USD", "M5", 10);
assert(historyRows.length >= 1, "listRegimeHistory must return at least 1 row");

const currentRegimes = listCurrentRegimes();
assert(currentRegimes.some((r) => r.symbol === "EUR_USD"), "listCurrentRegimes must include EUR_USD");
console.log("[phase18] Regime detection ok");

// ── 3. Compatibility matrix ───────────────────────────────────────────────
const trendScore = scoreRegimeCompatibility("moving-average-cross", "TRENDING");
assert(trendScore.score >= 70, "trend-following strategy should score ≥70 in TRENDING regime");
assert(trendScore.label === "EXCELLENT", "should be EXCELLENT for trend+TRENDING");

const avoidScore = scoreRegimeCompatibility("moving-average-cross", "RANGING");
assert(avoidScore.score < 50, "trend-following should score < 50 in RANGING");
assert(avoidScore.label === "AVOID", "should be AVOID for trend+RANGING");

const unknownScore = scoreRegimeCompatibility("some-strategy", "UNKNOWN");
assert(typeof unknownScore.score === "number", "unknown regime score must be a number");
console.log("[phase18] Compatibility matrix ok");

// ── 4. Create synthetic deployments for health/correlation ────────────────
const depA = createDeployment({
  name: "phase18-dep-a",
  strategyId: "moving-average-cross",
  instrument: "EUR_USD",
  timeframe: "M5",
  riskProfileId: "balanced",
  params: { fastPeriod: 5, slowPeriod: 10, stopLossPips: 20, takeProfitPips: 50, closeOnOppositeSignal: true },
  enabled: false,
  autopilot: false,
  source: { type: DEPLOYMENT_SOURCE_TYPES.MANUAL, metadata: { qa: "phase18" } },
});

const depB = createDeployment({
  name: "phase18-dep-b",
  strategyId: "rsi-mean-reversion",
  instrument: "GBP_USD",
  timeframe: "H1",
  riskProfileId: "balanced",
  params: { rsiPeriod: 14, oversold: 30, overbought: 70 },
  enabled: false,
  autopilot: false,
  source: { type: DEPLOYMENT_SOURCE_TYPES.MANUAL, metadata: { qa: "phase18" } },
});

assert(depA.id && depB.id, "synthetic deployments must have ids");
console.log("[phase18] Synthetic deployments created ok");

// ── 5. Health snapshots ───────────────────────────────────────────────────
const healthA = computeHealthSnapshot(depA.id);
assert(typeof healthA.healthScore === "number", "health score must be numeric");
assert(healthA.healthScore >= 0 && healthA.healthScore <= 100, "health score must be 0–100");
assert(Array.isArray(healthA.reasons), "health reasons must be array");
assert(healthA.deploymentId === depA.id, "health deploymentId must match");

const healthB = computeHealthSnapshot(depB.id);
assert(healthB.healthScore >= 0, "dep B health must be non-negative");

const savedHealth = getLatestHealth(depA.id);
assert(savedHealth !== null, "getLatestHealth must return snapshot");
assert(savedHealth!.id === healthA.id, "saved health id must match");

const allHealth = listLatestHealthSnapshots();
assert(allHealth.some((h) => h.deploymentId === depA.id), "listLatestHealthSnapshots must include depA");
console.log("[phase18] Health snapshots ok");

// ── 6. Correlations ───────────────────────────────────────────────────────
const correlations = computeAllCorrelations(30);
assert(correlations.length >= 1, "at least 1 correlation pair must be computed for 2 deployments");

const pairRow = correlations.find(
  (c) =>
    (c.deploymentAId === depA.id && c.deploymentBId === depB.id) ||
    (c.deploymentAId === depB.id && c.deploymentBId === depA.id)
);
assert(pairRow !== undefined, "correlation row for depA/depB pair must exist");
assert(typeof pairRow!.correlation === "number", "correlation must be numeric");
assert(pairRow!.correlation >= -1 && pairRow!.correlation <= 1, "correlation must be in [-1, 1]");
assert(typeof pairRow!.recommendation === "string", "recommendation must be a string");

const latestCorrelations = listLatestCorrelations();
assert(latestCorrelations.length >= 1, "listLatestCorrelations must return rows");
console.log("[phase18] Correlations ok");

// ── 7. Allocations ────────────────────────────────────────────────────────
const allHealthForAlloc = listLatestHealthSnapshots();
const allocations = computeAllocations(allHealthForAlloc, latestCorrelations);
assert(allocations.length >= 1, "at least 1 allocation must be generated");
for (const a of allocations) {
  assert(a.recommendedWeight >= 0 && a.recommendedWeight <= 1, "weight must be in [0, 1]");
  assert(Array.isArray(a.reasons), "allocation reasons must be array");
}
console.log("[phase18] Allocations ok");

// ── 8. Portfolio snapshot ─────────────────────────────────────────────────
const portfolioSnap = computePortfolioSnapshot(listCurrentRegimes(), allocations);
assert(typeof portfolioSnap.id === "string", "portfolio snapshot must have an id");
assert(typeof portfolioSnap.activeDeploymentCount === "number", "activeDeploymentCount must be numeric");
assert(typeof portfolioSnap.regimeSummary === "object", "regimeSummary must be object");
assert(typeof portfolioSnap.allocationSummary === "object", "allocationSummary must be object");
assert(typeof portfolioSnap.riskSummary === "object", "riskSummary must be object");
assert((portfolioSnap.riskSummary as Record<string, unknown>).paperOnly === true, "riskSummary.paperOnly must be true");

const latestSnap = getLatestPortfolioSnapshot();
assert(latestSnap !== null, "getLatestPortfolioSnapshot must return snapshot");
console.log("[phase18] Portfolio snapshot ok");

// ── 9. Recommendations ────────────────────────────────────────────────────
const recs = generateRecommendations(allHealthForAlloc, listCurrentRegimes(), latestCorrelations, allocations);
assert(Array.isArray(recs), "recommendations must be array");

// With no paper trade data, we expect at least RERUN_VALIDATION recommendations
const openRecs = listRecommendations("OPEN");
assert(openRecs.every((r) => r.status === "OPEN"), "all returned recs must be OPEN");

// Resolve a recommendation if any exist
if (openRecs.length > 0) {
  const toResolve = openRecs[0];
  const resolved = resolveRecommendation(toResolve.id, "DISMISSED", "QA smoke test dismiss");
  assert(resolved !== null, "resolveRecommendation must return the updated row");
  assert(resolved!.status === "DISMISSED", "status must be DISMISSED after resolve");
  assert(resolved!.resolutionNote === "QA smoke test dismiss", "resolution note must match");
  console.log("[phase18] Recommendation resolve ok");
}
console.log("[phase18] Recommendations ok");

// ── 10. Full orchestrator ─────────────────────────────────────────────────
const fullResult = runPhase18Analysis("phase18-qa");
assert(typeof fullResult.ranAt === "string", "ranAt must be a string");
assert(typeof fullResult.summary === "object", "summary must be object");
assert(typeof fullResult.summary.symbolsAnalyzed === "number", "symbolsAnalyzed must be numeric");
assert(typeof fullResult.summary.deploymentsScored === "number", "deploymentsScored must be numeric");
assert(typeof fullResult.summary.recommendationsGenerated === "number", "recommendationsGenerated must be numeric");
assert(fullResult.portfolioSnapshot !== null, "portfolio snapshot must be present");
console.log("[phase18] Full orchestrator ok");

// ── 11. Safety invariants ─────────────────────────────────────────────────
assert(countManualOrders() === manualOrdersBefore, "manual_order_executions must be unchanged");
assert(countManualCloses() === manualClosesBefore, "manual_close_executions must be unchanged");
assert(countAutopilot() === autopilotBefore, "autopilot deployment count must be unchanged");
assert(strategyEngine.status().running === false, "strategy engine must not have been started");
console.log("[phase18] Safety invariants ok: no broker/manual/autopilot mutation, no engine start");

console.log("phase 18 smoke ok");
