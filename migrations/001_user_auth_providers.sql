DO $$
DECLARE
  user_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO user_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'users'
    AND n.nspname = current_schema()
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped
  LIMIT 1;

  IF user_id_type IS NULL THEN
    RAISE EXCEPTION 'users.id column is required before creating user_auth_providers';
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS user_auth_providers (
      id SERIAL PRIMARY KEY,
      user_id %s NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(provider, provider_user_id)
    )',
    user_id_type
  );
END $$;
