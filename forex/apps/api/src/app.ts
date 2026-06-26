import express from "express";
import cors from "cors";
import { healthRoutes } from "./routes/health.routes.js";
import { accountsRoutes } from "./routes/accounts.routes.js";
import { strategiesRoutes } from "./routes/strategies.routes.js";
import { backtestsRoutes } from "./routes/backtests.routes.js";
import { marketDataRoutes } from "./routes/marketData.routes.js";
import { riskRoutes } from "./routes/risk.routes.js";
import { strategyConfigsRoutes } from "./routes/strategyConfigs.routes.js";
import { strategyDeploymentsRoutes } from "./routes/strategyDeployments.routes.js";
import { strategyEngineRoutes } from "./routes/strategyEngine.routes.js";
import { optimizerRoutes } from "./routes/optimizer.routes.js";
import { validationRoutes } from "./routes/validation.routes.js";
import { researchRoutes } from "./routes/research.routes.js";
import { rankingRoutes } from "./routes/ranking.routes.js";
import { researchReviewRoutes } from "./routes/researchReview.routes.js";
import { brokerRoutes } from "./routes/broker.routes.js";
import { manualOrderRoutes } from "./routes/manualOrder.routes.js";
import { manualCloseRoutes } from "./routes/manualClose.routes.js";
import { analysisRoutes } from "./routes/analysis.routes.js";
import { paperTradingRoutes } from "./routes/paperTrading.routes.js";
import { portfolioIntelligenceRoutes } from "./routes/portfolioIntelligence.routes.js";
import { buildSessionMiddleware } from "./auth/session.js";
import { requireAuth, requireAdminForWrites } from "./auth/middleware.js";
import { authRoutes } from "./auth/auth.routes.js";
import { userRoutes } from "./routes/user.routes.js";
import { auditMiddleware } from "./audit/audit.middleware.js";
import { auditRoutes } from "./audit/audit.routes.js";

export const app = express();

// Behind Nginx + Cloudflare: trust the first proxy so req.ip / req.protocol reflect
// X-Forwarded-For / X-Forwarded-Proto. Required for Secure session cookies over HTTPS.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());
app.use(buildSessionMiddleware());

// Audit sensitive actions for every request (logs on response finish, even when a
// guard rejects the request). Mounted before the guards so blocked attempts are recorded.
app.use(auditMiddleware);

// --- Public routes (no application auth; Nginx Basic Auth is still the outer gate) ---
app.use("/api/health", healthRoutes);
// Auth router handles its own access control (login is public; logout/me require a session).
app.use("/api/auth", authRoutes);

// --- Everything below requires an authenticated session ---
app.use(requireAuth);

// Phase 16.0 — user manager. Mounted before the global write-admin gate so self-service
// routes (/me, /change-password) work for any authenticated role; the management routes
// apply their own requireAdmin guard internally.
app.use("/api/users", userRoutes);

// viewer = read-only: any mutating method requires the admin role.
app.use(requireAdminForWrites);

app.use("/api/audit", auditRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/strategies", strategiesRoutes);
app.use("/api/strategy-configs", strategyConfigsRoutes);
app.use("/api/strategy-deployments", strategyDeploymentsRoutes);
app.use("/api/strategy-engine", strategyEngineRoutes);
app.use("/api/backtests", backtestsRoutes);
app.use("/api/market-data", marketDataRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/optimizer", optimizerRoutes);
app.use("/api/validation", validationRoutes);
app.use("/api/research", researchRoutes);
app.use("/api/ranking", rankingRoutes);
app.use("/api/research-review", researchReviewRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/broker", brokerRoutes);
app.use("/api/broker/oanda/practice/orders", manualOrderRoutes);
app.use("/api/broker/oanda/practice/close", manualCloseRoutes);
app.use("/api/paper-trading", paperTradingRoutes);
app.use("/api/portfolio-intelligence", portfolioIntelligenceRoutes);
