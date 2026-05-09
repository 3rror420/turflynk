ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_scope_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS scope_snapshot JSONB;

UPDATE jobs
SET
  job_scope_snapshot = COALESCE(job_scope_snapshot, scope_snapshot),
  scope_snapshot = COALESCE(scope_snapshot, job_scope_snapshot)
WHERE job_scope_snapshot IS NULL
   OR scope_snapshot IS NULL;
