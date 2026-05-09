ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_status TEXT DEFAULT 'not_required';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_code TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_sent_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verified_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_provider TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_message_sid TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cod_verification_attempts INTEGER DEFAULT 0;
