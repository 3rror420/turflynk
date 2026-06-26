/**
 * Phase 18.2 — Portfolio Intelligence Scheduler.
 *
 * Periodically runs the Phase 18 analysis pipeline so the dashboard always
 * shows fresh regime/health/correlation/allocation data without requiring
 * manual intervention.
 *
 * Disabled by default. Opt in via env:
 *   PORTFOLIO_INTELLIGENCE_SCHEDULER_ENABLED=true
 *   PORTFOLIO_INTELLIGENCE_INTERVAL_MINUTES=15   (default 15)
 *
 * SAFETY: Only calls read-only analysis functions. No broker calls, no trades,
 * no deployment state changes. The job store handles lock management so
 * overlapping runs are skipped automatically.
 */
import { runAnalysisJob, getLatestCompletedJob, type IntelligenceJob } from "./jobStore.service.js";

export type Freshness = "FRESH" | "STALE" | "UNKNOWN";

export interface SchedulerStatus {
  enabled: boolean;
  intervalMinutes: number;
  freshnessThresholdMinutes: number;
  isRunning: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  freshness: Freshness;
  latestCompletedJob: IntelligenceJob | null;
}

class PortfolioScheduler {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly intervalMs: number;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastRunAt: string | null = null;
  private nextRunAt: string | null = null;

  constructor() {
    this.enabled = process.env.PORTFOLIO_INTELLIGENCE_SCHEDULER_ENABLED === "true";
    const parsed = parseInt(process.env.PORTFOLIO_INTELLIGENCE_INTERVAL_MINUTES ?? "15", 10);
    this.intervalMinutes = Number.isFinite(parsed) && parsed >= 1 ? parsed : 15;
    this.intervalMs = this.intervalMinutes * 60 * 1000;
  }

  start(): void {
    if (!this.enabled || this.timer !== null) return;
    console.log(`[portfolio-scheduler] Starting — interval ${this.intervalMinutes}m, freshness threshold ${this.intervalMinutes * 2}m`);
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.nextRunAt = null;
    }
  }

  private scheduleNext(): void {
    this.nextRunAt = new Date(Date.now() + this.intervalMs).toISOString();
    this.timer = setTimeout(() => {
      this.runNow();
    }, this.intervalMs);
    // Unref so the timer doesn't keep the process alive if everything else exits
    if (typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as { unref(): void }).unref();
    }
  }

  private runNow(): void {
    this.timer = null;
    this.lastRunAt = new Date().toISOString();
    this.nextRunAt = null;
    console.log(`[portfolio-scheduler] Running scheduled analysis at ${this.lastRunAt}`);

    const job = runAnalysisJob("SCHEDULED");
    console.log(
      `[portfolio-scheduler] Job ${job.id} → ${job.status}` +
        (job.durationMs !== null ? ` (${job.durationMs}ms)` : "") +
        (job.errorMessage ? ` — ${job.errorMessage}` : "")
    );

    // Schedule the next run after this one completes
    this.scheduleNext();
  }

  getFreshness(): Freshness {
    const latest = getLatestCompletedJob();
    if (!latest?.finishedAt) return "UNKNOWN";
    const ageMs = Date.now() - new Date(latest.finishedAt).getTime();
    const thresholdMs = this.intervalMinutes * 2 * 60 * 1000;
    return ageMs < thresholdMs ? "FRESH" : "STALE";
  }

  status(): SchedulerStatus {
    return {
      enabled: this.enabled,
      intervalMinutes: this.intervalMinutes,
      freshnessThresholdMinutes: this.intervalMinutes * 2,
      isRunning: this.timer !== null,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      freshness: this.getFreshness(),
      latestCompletedJob: getLatestCompletedJob(),
    };
  }
}

export const portfolioScheduler = new PortfolioScheduler();
