import "./config/env.js";

import { app } from "./app.js";
import { seedAccountsIfEmpty } from "./db/seed.js";
import { seedStrategyConfigsIfEmpty } from "./services/strategyConfig.service.js";
import { syncStrategiesFromRegistry } from "./services/strategyRegistry.service.js";
import { startStrategyEngine, stopStrategyEngine } from "./strategyEngine/index.js";
import {
  recoverStaleOptimizerJobs,
  startOptimizerWorker,
  stopOptimizerWorker,
} from "./services/optimizerWorker.service.js";
import {
  recoverStaleValidationJobs,
  startValidationWorker,
  stopValidationWorker,
} from "./services/validationWorker.service.js";
import { startPaperTradingWorker, stopPaperTradingWorker } from "./paperTradingEngine/index.js";
import { portfolioScheduler } from "./portfolioIntelligence/scheduler.service.js";
import { hasConfiguredAdmin } from "./auth/users.js";
import { seedDefaultRankingProfileIfMissing } from "./services/rankingProfile.service.js";
import { countEnabledAdmins, seedUsersFromEnvIfEmpty } from "./services/user.service.js";

const port = Number(process.env.PORT ?? 4000);

seedAccountsIfEmpty();
seedStrategyConfigsIfEmpty();
// Auto-discovery: mirror the code-level strategy registry into the strategies table.
syncStrategiesFromRegistry();
// Phase 15.7 — ensure the default "Balanced Robustness" ranking profile exists.
seedDefaultRankingProfileIfMissing();

// Phase 16.0 — bridge the env auth model into the DB user manager on first boot (no-op if
// any DB users already exist). Reuses the env bcrypt hashes; never stores plaintext.
seedUsersFromEnvIfEmpty();

if (!hasConfiguredAdmin() && countEnabledAdmins() === 0) {
  console.warn(
    "[auth] No admin account configured. Set AUTH_ADMIN_USERNAME and AUTH_ADMIN_PASSWORD_HASH " +
      "in .env, or run the recovery CLI (npm run admin:user -w @forex/api -- create --username admin) " +
      "— the dashboard and trading controls are unreachable until an enabled admin exists."
  );
}
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.warn("[auth] SESSION_SECRET is not set; the API will refuse to start sessions in production.");
}

// Live strategy engine is opt-in. Practice account only; autopilot is additionally
// gated per-deployment, so starting the engine alone never places orders.
if (process.env.STRATEGY_ENGINE_ENABLED === "true") {
  startStrategyEngine();
  console.log("[strategy-engine] started (STRATEGY_ENGINE_ENABLED=true).");
} else {
  console.log("[strategy-engine] not started (set STRATEGY_ENGINE_ENABLED=true to enable).");
}

// Phase 15.5 — background optimizer worker (pure simulation; never touches a broker).
// 1) Recover any jobs left RUNNING by a previous (crashed/restarted) process: mark
//    them FAILED-stale, never auto-resume. 2) Start the embedded worker unless
//    explicitly disabled (default ON — the job queue is inert without it).
recoverStaleOptimizerJobs();
if (process.env.OPTIMIZER_WORKER_ENABLED === "false") {
  console.log("[optimizer-worker] disabled (OPTIMIZER_WORKER_ENABLED=false); jobs will stay QUEUED.");
} else {
  startOptimizerWorker();
  console.log("[optimizer-worker] started (set OPTIMIZER_WORKER_ENABLED=false to disable).");
}

// Phase 15.6 — background validation worker (out-of-sample + walk-forward; pure simulation,
// never touches a broker). Same lifecycle as the optimizer worker: recover stale jobs, then
// start unless explicitly disabled (default ON — the validation queue is inert without it).
recoverStaleValidationJobs();
if (process.env.VALIDATION_WORKER_ENABLED === "false") {
  console.log("[validation-worker] disabled (VALIDATION_WORKER_ENABLED=false); jobs will stay QUEUED.");
} else {
  startValidationWorker();
  console.log("[validation-worker] started (set VALIDATION_WORKER_ENABLED=false to disable).");
}

// Phase 17.0 — background paper-trading worker (ticks ACTIVE forward/paper runs forward;
// pure simulation, never touches a broker, never places an order). Default ON, same
// opt-out shape as the optimizer/validation workers — with no ACTIVE runs it is a no-op.
if (process.env.PAPER_TRADING_WORKER_ENABLED === "false") {
  console.log("[paper-trading-worker] disabled (PAPER_TRADING_WORKER_ENABLED=false); ACTIVE runs will not advance.");
} else {
  startPaperTradingWorker();
  console.log("[paper-trading-worker] started (set PAPER_TRADING_WORKER_ENABLED=false to disable).");
}

// Phase 18.2 — Portfolio Intelligence background scheduler (analysis only; no trades,
// no broker calls, no deployment mutations). Off by default — opt in with env flag.
portfolioScheduler.start();
if (portfolioScheduler.enabled) {
  console.log(`[portfolio-scheduler] started (interval ${portfolioScheduler.intervalMinutes}m). Set PORTFOLIO_INTELLIGENCE_SCHEDULER_ENABLED=false to disable.`);
} else {
  console.log("[portfolio-scheduler] not started (set PORTFOLIO_INTELLIGENCE_SCHEDULER_ENABLED=true to enable).");
}

function shutdown(signal: string): void {
  console.log(`[shutdown] ${signal} received — stopping engine + optimizer/validation/paper-trading workers.`);
  stopStrategyEngine();
  stopOptimizerWorker();
  stopValidationWorker();
  stopPaperTradingWorker();
  portfolioScheduler.stop();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

app.listen(port, "127.0.0.1", () => {
  console.log(`Forex API listening on http://localhost:${port}`);
});