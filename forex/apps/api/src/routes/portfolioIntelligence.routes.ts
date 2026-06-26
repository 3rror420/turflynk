/**
 * Phase 18 — Portfolio Intelligence API Routes.
 *
 * All routes are read-only except:
 *   POST /run-analysis  — triggers a fresh analysis pipeline (no broker/trade mutation)
 *   POST /recommendations/:id/resolve — dismiss or resolve a recommendation (human-action only)
 *
 * Route prefix: /api/portfolio-intelligence
 */
import { Router } from "express";
import { runPhase18Analysis, getLatestAnalysisState } from "../portfolioIntelligence/analysis.service.js";
import { listCurrentRegimes, listRegimeHistory, getLatestRegime } from "../portfolioIntelligence/regimeEngine.service.js";
import { listLatestHealthSnapshots, getLatestHealth } from "../portfolioIntelligence/healthEngine.service.js";
import { listLatestCorrelations } from "../portfolioIntelligence/correlationEngine.service.js";
import { listLatestAllocations } from "../portfolioIntelligence/allocationEngine.service.js";
import { getLatestPortfolioSnapshot, listPortfolioSnapshots } from "../portfolioIntelligence/portfolioSnapshot.service.js";
import { listRecommendations, resolveRecommendation, type RecommendationStatus } from "../portfolioIntelligence/recommendationEngine.service.js";
import { recordAudit } from "../audit/audit.store.js";

export const portfolioIntelligenceRoutes = Router();

/** GET /api/portfolio-intelligence/status — latest analysis state (no re-run). */
portfolioIntelligenceRoutes.get("/status", (_req, res) => {
  res.json(getLatestAnalysisState());
});

/** POST /api/portfolio-intelligence/run-analysis — trigger a fresh analysis run. */
portfolioIntelligenceRoutes.post("/run-analysis", (req, res) => {
  const username = (req.session as { user?: { username: string } })?.user?.username ?? "unknown";
  recordAudit({
    username,
    role: (req.session as { user?: { role: string } })?.user?.role ?? null,
    action: "PHASE18_RUN_ANALYSIS",
    route: req.path,
    method: req.method,
    ip: req.ip,
    success: true,
    metadata: { triggeredBy: username },
  });
  try {
    const result = runPhase18Analysis(username);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Analysis failed" });
  }
});

/** GET /api/portfolio-intelligence/regimes — current regime per symbol/timeframe. */
portfolioIntelligenceRoutes.get("/regimes", (_req, res) => {
  res.json(listCurrentRegimes());
});

/** GET /api/portfolio-intelligence/regimes/:symbol/:granularity/history */
portfolioIntelligenceRoutes.get("/regimes/:symbol/:granularity/history", (req, res) => {
  const { symbol, granularity } = req.params;
  const limit = Number(req.query.limit) || 50;
  res.json(listRegimeHistory(symbol, granularity, limit));
});

/** GET /api/portfolio-intelligence/regimes/:symbol/:granularity/latest */
portfolioIntelligenceRoutes.get("/regimes/:symbol/:granularity/latest", (req, res) => {
  const { symbol, granularity } = req.params;
  const snap = getLatestRegime(symbol, granularity);
  if (!snap) return res.status(404).json({ error: "No regime snapshot found" });
  return res.json(snap);
});

/** GET /api/portfolio-intelligence/health — all deployment health snapshots. */
portfolioIntelligenceRoutes.get("/health", (_req, res) => {
  res.json(listLatestHealthSnapshots());
});

/** GET /api/portfolio-intelligence/health/:deploymentId */
portfolioIntelligenceRoutes.get("/health/:deploymentId", (req, res) => {
  const snap = getLatestHealth(req.params.deploymentId);
  if (!snap) return res.status(404).json({ error: "No health snapshot found" });
  return res.json(snap);
});

/** GET /api/portfolio-intelligence/correlations — latest correlation matrix. */
portfolioIntelligenceRoutes.get("/correlations", (_req, res) => {
  res.json(listLatestCorrelations());
});

/** GET /api/portfolio-intelligence/allocations — latest allocation recommendations. */
portfolioIntelligenceRoutes.get("/allocations", (_req, res) => {
  res.json(listLatestAllocations());
});

/** GET /api/portfolio-intelligence/snapshot/latest */
portfolioIntelligenceRoutes.get("/snapshot/latest", (_req, res) => {
  const snap = getLatestPortfolioSnapshot();
  if (!snap) return res.status(404).json({ error: "No portfolio snapshot found" });
  return res.json(snap);
});

/** GET /api/portfolio-intelligence/snapshots */
portfolioIntelligenceRoutes.get("/snapshots", (req, res) => {
  const limit = Number(req.query.limit) || 20;
  res.json(listPortfolioSnapshots(limit));
});

/** GET /api/portfolio-intelligence/recommendations */
portfolioIntelligenceRoutes.get("/recommendations", (req, res) => {
  const status = typeof req.query.status === "string" ? (req.query.status as RecommendationStatus) : undefined;
  const limit = Number(req.query.limit) || 100;
  res.json(listRecommendations(status, limit));
});

/** POST /api/portfolio-intelligence/recommendations/:id/resolve */
portfolioIntelligenceRoutes.post("/recommendations/:id/resolve", (req, res) => {
  const { id } = req.params;
  const { action, note } = req.body as { action?: string; note?: string };
  if (action !== "DISMISSED" && action !== "RESOLVED") {
    return res.status(400).json({ error: 'action must be "DISMISSED" or "RESOLVED"' });
  }
  const username = (req.session as { user?: { username: string } })?.user?.username ?? "unknown";
  recordAudit({
    username,
    role: (req.session as { user?: { role: string } })?.user?.role ?? null,
    action: "PHASE18_RECOMMENDATION_RESOLVE",
    route: req.path,
    method: req.method,
    ip: req.ip,
    success: true,
    metadata: { recommendationId: id, action, note },
  });
  const updated = resolveRecommendation(id, action as "DISMISSED" | "RESOLVED", note);
  if (!updated) return res.status(404).json({ error: "Recommendation not found or already resolved" });
  return res.json(updated);
});
