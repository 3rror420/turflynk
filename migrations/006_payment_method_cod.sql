-- Migration 006: onsite / COD payment metadata for jobs.
-- Idempotent so it is safe to run more than once.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
