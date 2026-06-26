-- Phase 18.0 — Adaptive Portfolio Intelligence.
--
-- Adds read-only analytical tables that support regime detection, deployment health
-- scoring, strategy-deployment correlation, allocation recommendations, portfolio
-- snapshots, and human-readable recommendation cards.
--
-- SAFETY: All tables here are purely analytical. Nothing in this migration or the
-- Phase 18 services touches broker/order tables, enables live trading, changes
-- autopilot flags, or modifies existing deployment rows. All outputs are
-- "recommendation only" — a human must take any follow-up action.
--
-- New tables (all brand-new; CREATE TABLE IF NOT EXISTS in schema.sql handles both
-- fresh and existing DBs, so no ALTER/ensureColumn step is required here):
--   market_regimes           — per-symbol/timeframe regime snapshots.
--   strategy_health          — per-deployment health score snapshots.
--   deployment_correlations  — pairwise rolling correlation between deployments.
--   strategy_allocations     — recommended portfolio weight per deployment.
--   portfolio_snapshots      — top-level portfolio equity/risk/regime summary.
--   recommendations          — human-readable action cards (dismiss/resolve only).

CREATE TABLE IF NOT EXISTS market_regimes (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  granularity TEXT NOT NULL,
  candle_time TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  regime TEXT NOT NULL,
  trend_strength REAL,
  volatility_score REAL,
  adx REAL,
  atr REAL,
  atr_percentile REAL,
  confidence REAL NOT NULL DEFAULT 0,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_regimes_symbol_granularity ON market_regimes (symbol, granularity);
CREATE INDEX IF NOT EXISTS idx_market_regimes_detected_at ON market_regimes (detected_at);
CREATE INDEX IF NOT EXISTS idx_market_regimes_regime ON market_regimes (regime);

CREATE TABLE IF NOT EXISTS strategy_health (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  health_score REAL NOT NULL,
  win_rate REAL,
  profit_factor REAL,
  expectancy REAL,
  avg_return REAL,
  max_drawdown REAL,
  recent_drawdown REAL,
  recent_trade_count INTEGER NOT NULL DEFAULT 0,
  regime_match_score REAL,
  validation_score REAL,
  candidate_score REAL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_health_deployment_id ON strategy_health (deployment_id);
CREATE INDEX IF NOT EXISTS idx_strategy_health_calculated_at ON strategy_health (calculated_at);
CREATE INDEX IF NOT EXISTS idx_strategy_health_health_score ON strategy_health (health_score);

CREATE TABLE IF NOT EXISTS deployment_correlations (
  id TEXT PRIMARY KEY,
  deployment_a_id TEXT NOT NULL,
  deployment_b_id TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  lookback_trades INTEGER NOT NULL DEFAULT 0,
  lookback_days INTEGER NOT NULL DEFAULT 30,
  correlation REAL NOT NULL,
  overlap_score REAL NOT NULL DEFAULT 0,
  recommendation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deployment_correlations_a ON deployment_correlations (deployment_a_id);
CREATE INDEX IF NOT EXISTS idx_deployment_correlations_b ON deployment_correlations (deployment_b_id);
CREATE INDEX IF NOT EXISTS idx_deployment_correlations_calculated_at ON deployment_correlations (calculated_at);

CREATE TABLE IF NOT EXISTS strategy_allocations (
  id TEXT PRIMARY KEY,
  calculated_at TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  recommended_weight REAL NOT NULL,
  raw_score REAL NOT NULL,
  capped_score REAL NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_allocations_deployment_id ON strategy_allocations (deployment_id);
CREATE INDEX IF NOT EXISTS idx_strategy_allocations_calculated_at ON strategy_allocations (calculated_at);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  calculated_at TEXT NOT NULL,
  equity REAL,
  realized_pl REAL,
  unrealized_pl REAL,
  drawdown REAL,
  exposure REAL,
  active_deployment_count INTEGER NOT NULL DEFAULT 0,
  regime_summary_json TEXT NOT NULL DEFAULT '{}',
  allocation_summary_json TEXT NOT NULL DEFAULT '{}',
  risk_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_calculated_at ON portfolio_snapshots (calculated_at);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  deployment_id TEXT,
  symbol TEXT,
  granularity TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DISMISSED', 'RESOLVED')),
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations (status);
CREATE INDEX IF NOT EXISTS idx_recommendations_deployment_id ON recommendations (deployment_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_created_at ON recommendations (created_at);
CREATE INDEX IF NOT EXISTS idx_recommendations_severity ON recommendations (severity);
