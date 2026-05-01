-- Migration 003: Payment tracking columns for jobs table
-- Safe ALTER TABLE — uses IF NOT EXISTS so it is idempotent.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_status          TEXT      DEFAULT 'unpaid';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stripe_payment_intent_id   TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paid_at                  TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimate_at_booking      NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pricing_breakdown_json   JSONB;
