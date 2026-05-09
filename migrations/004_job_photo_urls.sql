ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS before_photo_urls JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS after_photo_urls JSONB DEFAULT '[]'::jsonb;

UPDATE jobs
SET
  before_photo_urls = COALESCE(before_photo_urls, '[]'::jsonb),
  after_photo_urls = COALESCE(after_photo_urls, '[]'::jsonb);
