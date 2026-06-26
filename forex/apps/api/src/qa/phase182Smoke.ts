/**
 * Phase 18.2 smoke test — Background Portfolio Intelligence.
 *
 * Verifies:
 * - Job table exists and has the correct schema
 * - Scheduler is disabled by default (no env flag set)
 * - Manual run creates a MANUAL COMPLETED job
 * - Job record fields are correct after a run
 * - Overlapping run is correctly SKIPPED (not FAILED)
 * - Stale lock (> 30 min old RUNNING job) is marked FAILED and next run proceeds
 * - FAILED job is created correctly via simulated stale lock cleanup
 * - getLatestJob returns the most recent job
 * - listJobs returns ordered results
 * - Scheduler status endpoint returns correct shape
 * - Phase 18 safety invariants are unbroken (no broker/trade mutations)
 */
import { db } from "../db/db.js";
import { runAnalysisJob, getLatestJob, listJobs, getLatestCompletedJob } from "../portfolioIntelligence/jobStore.service.js";
import { portfolioScheduler } from "../portfolioIntelligence/scheduler.service.js";
import { strategyEngine } from "../strategyEngine/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[phase182 FAIL] ${message}`);
}

const count = (sql: string, ...params: unknown[]): number =>
  (db.prepare(sql).get(...(params as Parameters<typeof db.prepare>["0"][])) as { c: number }).c;

const countManualOrders = () => count("SELECT COUNT(*) AS c FROM manual_order_executions");
const countManualCloses = () => count("SELECT COUNT(*) AS c FROM manual_close_executions");
const countAutopilot = () => count("SELECT COUNT(*) AS c FROM strategy_deployments WHERE autopilot = 1");

assert(process.env.STRATEGY_ENGINE_ENABLED !== "true", "STRATEGY_ENGINE_ENABLED must not be true for phase182 QA");
assert(strategyEngine.status().running === false, "Strategy engine must not be running");
assert(process.env.PORTFOLIO_INTELLIGENCE_SCHEDULER_ENABLED !== "true",
  "PORTFOLIO_INTELLIGENCE_SCHEDULER_ENABLED must not be true for phase182 QA (tests default-off behavior)");

console.log(`[phase182] DATABASE_FILE=${process.env.DATABASE_FILE ?? "(default)"}`);

const manualOrdersBefore = countManualOrders();
const manualClosesBefore = countManualCloses();
const autopilotBefore = countAutopilot();

// ── 1. Table exists ───────────────────────────────────────────────────────────
const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_intelligence_jobs'`).get();
assert(tableExists, "portfolio_intelligence_jobs table must exist");

const cols = db.prepare("PRAGMA table_info(portfolio_intelligence_jobs)").all() as Array<{ name: string }>;
const colNames = cols.map((c) => c.name);
for (const col of ["id", "started_at", "finished_at", "status", "trigger", "duration_ms", "error_message", "summary_json", "created_at"]) {
  assert(colNames.includes(col), `Column "${col}" must exist in portfolio_intelligence_jobs`);
}
console.log("[phase182] Table schema ok");

// ── 2. Scheduler disabled by default ─────────────────────────────────────────
const sched = portfolioScheduler.status();
assert(sched.enabled === false, "Scheduler must be disabled by default");
assert(sched.isRunning === false, "Scheduler timer must not be running");
assert(typeof sched.intervalMinutes === "number", "intervalMinutes must be a number");
assert(typeof sched.freshnessThresholdMinutes === "number", "freshnessThresholdMinutes must be a number");
assert(sched.freshnessThresholdMinutes === sched.intervalMinutes * 2, "freshnessThreshold must be 2× interval");
console.log(`[phase182] Scheduler disabled by default ok (interval=${sched.intervalMinutes}m, threshold=${sched.freshnessThresholdMinutes}m)`);

// ── 3. No jobs yet — freshness is UNKNOWN ─────────────────────────────────────
assert(sched.freshness === "UNKNOWN", "Freshness must be UNKNOWN when no completed jobs exist");
assert(sched.latestCompletedJob === null, "latestCompletedJob must be null when no jobs exist");
assert(getLatestJob() === null, "getLatestJob must return null when no jobs exist");
assert(listJobs().length === 0, "listJobs must return empty array initially");
console.log("[phase182] Initial freshness UNKNOWN ok");

// ── 4. Manual run creates COMPLETED MANUAL job ────────────────────────────────
const job1 = runAnalysisJob("MANUAL", "qa-phase182");
assert(job1.id && typeof job1.id === "string", "Job must have a string id");
assert(job1.trigger === "MANUAL", "trigger must be MANUAL");
assert(job1.status === "COMPLETED", `job1 status must be COMPLETED (got ${job1.status}${job1.errorMessage ? ": " + job1.errorMessage : ""})`);
assert(job1.startedAt && typeof job1.startedAt === "string", "startedAt must be a string");
assert(job1.finishedAt !== null, "finishedAt must be set after completion");
assert(typeof job1.durationMs === "number" && job1.durationMs >= 0, "durationMs must be a non-negative number");
assert(job1.errorMessage === null, "errorMessage must be null for a successful job");
assert(typeof job1.summary === "object", "summary must be an object");
console.log(`[phase182] MANUAL COMPLETED job ok (id=${job1.id}, duration=${job1.durationMs}ms)`);

// ── 5. getLatestJob / listJobs reflect the new job ───────────────────────────
const latest = getLatestJob();
assert(latest !== null, "getLatestJob must return the job after a run");
assert(latest!.id === job1.id, "getLatestJob must return the latest job");

const history = listJobs(20);
assert(history.length >= 1, "listJobs must return at least 1 job");
assert(history[0].id === job1.id, "listJobs must be ordered newest-first");
console.log("[phase182] getLatestJob / listJobs ok");

// ── 6. getLatestCompletedJob reflects the completed job ──────────────────────
const latestCompleted = getLatestCompletedJob();
assert(latestCompleted !== null, "getLatestCompletedJob must return a job after successful run");
assert(latestCompleted!.id === job1.id, "getLatestCompletedJob must return job1");
console.log("[phase182] getLatestCompletedJob ok");

// ── 7. Freshness — after a COMPLETED job ─────────────────────────────────────
// After completing a job, freshness should be FRESH (just ran)
const freshStatus = portfolioScheduler.status();
assert(freshStatus.freshness === "FRESH", `Freshness must be FRESH after a completed job (got ${freshStatus.freshness})`);
assert(freshStatus.latestCompletedJob !== null, "latestCompletedJob must be populated after a run");
console.log("[phase182] Freshness FRESH after run ok");

// ── 8. SKIPPED — overlapping run ─────────────────────────────────────────────
// Insert a RUNNING job manually to simulate an in-progress lock
const lockId = `qa-lock-${Date.now()}`;
const lockStartedAt = new Date().toISOString();
db.prepare(
  `INSERT INTO portfolio_intelligence_jobs (id, started_at, finished_at, status, trigger, duration_ms, error_message, summary_json, created_at)
   VALUES (?, ?, NULL, 'RUNNING', 'SCHEDULED', NULL, NULL, '{}', ?)`
).run(lockId, lockStartedAt, lockStartedAt);

// Now try to run — must be SKIPPED because the lock is held
const skippedJob = runAnalysisJob("MANUAL", "qa-phase182");
assert(skippedJob.status === "SKIPPED", `Expected SKIPPED when a RUNNING lock exists (got ${skippedJob.status})`);
assert(skippedJob.trigger === "MANUAL", "SKIPPED job trigger must be MANUAL");
assert(skippedJob.durationMs === 0, "SKIPPED job durationMs must be 0");

// Clean up the fake lock
db.prepare(`DELETE FROM portfolio_intelligence_jobs WHERE id = ?`).run(lockId);
console.log(`[phase182] SKIPPED overlapping run ok (skipped job id=${skippedJob.id})`);

// ── 9. FAILED — stale lock cleanup + next run succeeds ───────────────────────
// Insert a RUNNING job with started_at > 30 min ago
const staleId = `qa-stale-${Date.now()}`;
const staleStartedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min ago
db.prepare(
  `INSERT INTO portfolio_intelligence_jobs (id, started_at, finished_at, status, trigger, duration_ms, error_message, summary_json, created_at)
   VALUES (?, ?, NULL, 'RUNNING', 'SCHEDULED', NULL, NULL, '{}', ?)`
).run(staleId, staleStartedAt, staleStartedAt);

// Run should detect stale lock → mark it FAILED → proceed with new COMPLETED job
const afterStaleJob = runAnalysisJob("MANUAL", "qa-phase182");

// The stale lock must now be FAILED
const staleRow = db.prepare(`SELECT status, error_message FROM portfolio_intelligence_jobs WHERE id = ?`).get(staleId) as { status: string; error_message: string } | undefined;
assert(staleRow !== undefined, "Stale lock row must still exist in DB");
assert(staleRow!.status === "FAILED", `Stale lock must be marked FAILED (got ${staleRow!.status})`);
assert(staleRow!.error_message !== null, "Stale lock must have an error_message");

// And the new run after stale cleanup should succeed
assert(afterStaleJob.status === "COMPLETED", `New run after stale cleanup must be COMPLETED (got ${afterStaleJob.status})`);
console.log(`[phase182] Stale lock FAILED + subsequent run COMPLETED ok`);

// ── 10. listJobs limit ───────────────────────────────────────────────────────
const allJobs = listJobs(100);
assert(allJobs.length >= 2, "Must have at least 2 jobs in history");
const listOne = listJobs(1);
assert(listOne.length === 1, "listJobs(1) must return exactly 1 job");
assert(listOne[0].id === allJobs[0].id, "listJobs(1) must return the newest job");
console.log(`[phase182] listJobs limit ok (total recorded: ${allJobs.length})`);

// ── 11. Scheduler status shape ───────────────────────────────────────────────
const finalStatus = portfolioScheduler.status();
assert(typeof finalStatus.enabled === "boolean", "enabled must be boolean");
assert(typeof finalStatus.intervalMinutes === "number", "intervalMinutes must be number");
assert(typeof finalStatus.freshnessThresholdMinutes === "number", "freshnessThresholdMinutes must be number");
assert(typeof finalStatus.isRunning === "boolean", "isRunning must be boolean");
assert(["FRESH", "STALE", "UNKNOWN"].includes(finalStatus.freshness), "freshness must be FRESH/STALE/UNKNOWN");
assert(finalStatus.enabled === false, "Scheduler must remain disabled (no env flag)");
assert(finalStatus.isRunning === false, "Scheduler timer must remain stopped");
console.log("[phase182] Scheduler status shape ok");

// ── 12. Safety invariants ─────────────────────────────────────────────────────
assert(countManualOrders() === manualOrdersBefore, "manual_order_executions must be unchanged");
assert(countManualCloses() === manualClosesBefore, "manual_close_executions must be unchanged");
assert(countAutopilot() === autopilotBefore, "autopilot deployment count must be unchanged");
assert(strategyEngine.status().running === false, "strategy engine must not have been started");
console.log("[phase182] Safety invariants ok: no broker/manual/autopilot mutation, no engine start");

console.log("phase 18.2 smoke ok");
