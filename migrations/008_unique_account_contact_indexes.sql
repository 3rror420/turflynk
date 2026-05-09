-- Migration 008: harden manual account contact uniqueness when existing data is clean.
-- Placeholder guest emails such as phone-...@example.com are intentionally ignored.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_count
  FROM (
    SELECT LOWER(TRIM(email)) AS normalized_email
    FROM users
    WHERE COALESCE(TRIM(email), '') <> ''
      AND LOWER(TRIM(email)) !~ '^phone-[^@]+@example\.com$'
      AND deleted_at IS NULL
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS users_unique_account_email_norm_idx
      ON users (LOWER(TRIM(email)))
      WHERE COALESCE(TRIM(email), '') <> ''
        AND LOWER(TRIM(email)) !~ '^phone-[^@]+@example\.com$'
        AND deleted_at IS NULL;
  ELSE
    RAISE NOTICE 'Skipping users_unique_account_email_norm_idx; % duplicate normalized emails found', duplicate_count;
  END IF;
END $$;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_count
  FROM (
    SELECT
      CASE
        WHEN regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = '' THEN ''
        WHEN length(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')) = 10
          THEN '+1' || regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
        WHEN length(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')) = 11
          AND left(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 1) = '1'
          THEN '+' || regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
        ELSE '+' || regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
      END AS normalized_phone
    FROM users
    WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') <> ''
      AND LOWER(TRIM(COALESCE(email, ''))) !~ '^phone-[^@]+@example\.com$'
      AND deleted_at IS NULL
    GROUP BY normalized_phone
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS users_unique_account_phone_norm_idx
      ON users ((
        CASE
          WHEN regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = '' THEN ''
          WHEN length(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')) = 10
            THEN '+1' || regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
          WHEN length(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')) = 11
            AND left(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 1) = '1'
            THEN '+' || regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
          ELSE '+' || regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
        END
      ))
      WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') <> ''
        AND LOWER(TRIM(COALESCE(email, ''))) !~ '^phone-[^@]+@example\.com$'
        AND deleted_at IS NULL;
  ELSE
    RAISE NOTICE 'Skipping users_unique_account_phone_norm_idx; % duplicate normalized phones found', duplicate_count;
  END IF;
END $$;
