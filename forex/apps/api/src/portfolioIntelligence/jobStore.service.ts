/**
 * Phase 18.2 — Portfolio Intelligence Job Store.
 *
 * Tracks every analysis run (manual or scheduled) through a full lifecycle:
 *   RUNNING → COMPLETED | FAILED | SKIPPED
 *
 * A single RUNNING row acts as a mutex: at most one analysis runs at a time.
 * Stale RUNNING rows older than STALE_LOCK_MS are auto-failed on the next
 * acquire attempt, ensuring the lock never wedges permanently.
 *
 * SAFETY: Records events only — no trades, no broker calls, no deployment changes.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/db.js";
import { runPhase18Analysis } from "./analysis.service.js";
import { recordAudit } from "../audit/audit.store.js";

export type JobStatus = "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type JobTrigger = "MANUAL" | "SCHEDULED";

export interface IntelligenceJob {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobStatus;
  trigger: JobTrigger;
  durationMs: number | null;
  errorMessage: string | null;
  summary: Record<string, unknown>;
  createdAt: string;
}

interface JobRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  duration_ms: number | null;
  error_message: string | null;
  summary_json: string;
  created_at: string;
}

function mapRow(r: JobRow): IntelligenceJob {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status as JobStatus,
    trigger: r.trigger as JobTrigger,
    durationMs: r.duration_ms,
    errorMessage: r.error_message,
    summary: JSON.parse(r.summary_json) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

function insertJobRow(
  trigger: JobTrigger,
  status: JobStatus,
  startedAt: string,
  finishedAt: string | null,
  durationMs: number | null
): IntelligenceJob {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO portfolio_intelligence_jobs
     (id, started_at, finished_at, status, trigger, duration_ms, error_message, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', ?)`
  ).run(id, startedAt, finishedAt, status, trigger, durationMs, now);
  return getJob(id)!;
}

function updateJobRow(
  id: string,
  status: JobStatus,
  finishedAt: string,
  durationMs: number,
  summaryJson: string,
  errorMessage: string | null
): void {
  db.prepare(
    `UPDATE portfolio_intelligence_jobs
     SET status = ?, finished_at = ?, duration_ms = ?, summary_json = ?, error_message = ?
     WHERE id = ?`
  ).run(status, finishedAt, durationMs, summaryJson, errorMessage, id);
}

// After 30 minutes without completing, a RUNNING job is considered abandoned.
const STALE_LOCK_MS = 30 * 60 * 1000;

/**
 * Check for an active (non-stale) RUNNING job.
 * If a stale lock is found, marks it FAILED so the next run can proceed.
 */
function getActiveLock(): IntelligenceJob | null {
  const row = db
    .prepare(`SELECT * FROM portfolio_intelligence_jobs WHERE status = 'RUNNING' ORDER BY started_at DESC LIMIT 1`)
    .get() as JobRow | undefined;
  if (!row) return null;

  const ageMs = Date.now() - new Date(row.started_at).getTime();
  if (ageMs > STALE_LOCK_MS) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE portfolio_intelligence_jobs
       SET status = 'FAILED', finished_at = ?, duration_ms = ?, error_message = ?
       WHERE id = ?`
    ).run(now, ageMs, "Stale lock: job exceeded maximum run time (30 min) without completing", row.id);
    console.warn(`[portfolio-scheduler] Stale lock detected — job ${row.id} marked FAILED (age ${Math.round(ageMs / 60000)}m)`);
    return null;
  }

  return mapRow(row);
}

/**
 * Run a full Phase 18 analysis pipeline wrapped in a job lifecycle record.
 * Returns immediately with a SKIPPED job if another run is already active.
 * All database access is synchronous (better-sqlite3) — no async needed.
 */
export function runAnalysisJob(trigger: JobTrigger, requestedBy?: string): IntelligenceJob {
  const activeLock = getActiveLock();
  if (activeLock) {
    console.log(
      `[portfolio-scheduler] Skipping ${trigger} run — job ${activeLock.id} is already RUNNING (started ${activeLock.startedAt})`
    );
    const now = new Date().toISOString();
    return insertJobRow(trigger, "SKIPPED", now, now, 0);
  }

  const startedAt = new Date().toISOString();
  const job = insertJobRow(trigger, "RUNNING", startedAt, null, null);
  const startMs = Date.now();

  try {
    const result = runPhase18Analysis(requestedBy ?? trigger.toLowerCase());
    const durationMs = Date.now() - startMs;
    const finishedAt = new Date().toISOString();
    const summary: Record<string, unknown> = {
      ...(result.summary as Record<string, unknown>),
      ranAt: result.ranAt,
    };
    updateJobRow(job.id, "COMPLETED", finishedAt, durationMs, JSON.stringify(summary), null);

    if (trigger === "MANUAL") {
      recordAudit({
        username: requestedBy ?? "system",
        action: "PHASE18_RUN_ANALYSIS_JOB",
        success: true,
        metadata: { jobId: job.id, trigger, durationMs, summary },
      });
    }
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const finishedAt = new Date().toISOString();
    const errorMessage = err instanceof Error ? err.message : String(err);
    updateJobRow(job.id, "FAILED", finishedAt, durationMs, "{}", errorMessage);

    if (trigger === "SCHEDULED") {
      recordAudit({
        username: "scheduler",
        action: "PHASE18_SCHEDULED_JOB_FAILED",
        success: false,
        metadata: { jobId: job.id, errorMessage, durationMs },
      });
    }
    console.error(`[portfolio-intelligence] ${trigger} job ${job.id} failed:`, err);
  }

  return getJob(job.id) ?? job;
}

export function getJob(id: string): IntelligenceJob | null {
  const row = db
    .prepare(`SELECT * FROM portfolio_intelligence_jobs WHERE id = ?`)
    .get(id) as JobRow | undefined;
  return row ? mapRow(row) : null;
}

export function getLatestJob(): IntelligenceJob | null {
  const row = db
    .prepare(`SELECT * FROM portfolio_intelligence_jobs ORDER BY created_at DESC LIMIT 1`)
    .get() as JobRow | undefined;
  return row ? mapRow(row) : null;
}

export function getLatestCompletedJob(): IntelligenceJob | null {
  const row = db
    .prepare(
      `SELECT * FROM portfolio_intelligence_jobs WHERE status = 'COMPLETED' ORDER BY finished_at DESC LIMIT 1`
    )
    .get() as JobRow | undefined;
  return row ? mapRow(row) : null;
}

export function listJobs(limit = 20): IntelligenceJob[] {
  const safeLimit = Math.min(limit, 100);
  const rows = db
    .prepare(`SELECT * FROM portfolio_intelligence_jobs ORDER BY created_at DESC LIMIT ?`)
    .all(safeLimit) as JobRow[];
  return rows.map(mapRow);
}
