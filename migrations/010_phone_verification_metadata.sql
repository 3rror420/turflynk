ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phone_verified_provider TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phone_verified_number TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phone_verification_purpose TEXT;
