const { Pool } = require('pg');

function buildConfig() {
  const url = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
    };
  }

  return {
    host: process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || process.env.PGPORT || 5432),
    database: process.env.POSTGRES_DB || process.env.PGDATABASE || 'turflynk',
    user: process.env.POSTGRES_USER || process.env.PGUSER || 'postgres',
    password: String(process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || ''),
  };
}

const pool = new Pool(buildConfig());

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
