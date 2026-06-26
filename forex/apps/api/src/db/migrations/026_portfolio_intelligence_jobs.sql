-- Phase 18.2 — Portfolio Intelligence Job Tracking.
--
-- Records every analysis run (manual or scheduled) with full lifecycle state.
-- Status lifecycle: RUNNING → COMPLETED | FAILED | SKIPPED.
-- A RUNNING row acts as a distributed lock: at most one RUNNING job at a time.
-- Stale RUNNING jobs (> 30 min) are marked FAILED automatically on the next run attempt.
--
-- SAFETY: Records events only. No trades, no broker calls, no deployment mutations.

CREATE TABLE IF NOT EXISTS portfolio_intelligence_jobs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  trigger TEXT NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULED')),
  duration_ms INTEGER,
  error_message TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pi_jobs_status ON portfolio_intelligence_jobs (status);
CREATE INDEX IF NOT EXISTS idx_pi_jobs_created_at ON portfolio_intelligence_jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_pi_jobs_trigger ON portfolio_intelligence_jobs (trigger);
