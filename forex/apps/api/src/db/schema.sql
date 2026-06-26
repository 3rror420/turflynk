CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  broker TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('DEMO', 'LIVE')),
  environment TEXT NOT NULL CHECK (environment IN ('demo', 'live')),
  base_currency TEXT NOT NULL,
  account_number TEXT,
  trading_enabled INTEGER NOT NULL DEFAULT 0,
  live_trading_armed INTEGER NOT NULL DEFAULT 0,
  max_daily_loss REAL NOT NULL,
  max_risk_per_trade_percent REAL NOT NULL,
  max_open_trades INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  time TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume INTEGER,
  bid_open REAL,
  bid_high REAL,
  bid_low REAL,
  bid_close REAL,
  ask_open REAL,
  ask_high REAL,
  ask_low REAL,
  ask_close REAL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_candles_source_instrument_timeframe_time
  ON candles (source, instrument, timeframe, time);

CREATE TABLE IF NOT EXISTS historical_imports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  candle_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  first_candle_time TEXT,
  last_candle_time TEXT,
  request_mode TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS strategy_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  description TEXT,
  params_json TEXT NOT NULL,
  risk_profile_id TEXT NOT NULL,
  instrument TEXT,
  timeframe TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_configs_strategy_id ON strategy_configs (strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_configs_instrument_timeframe ON strategy_configs (instrument, timeframe);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  strategy_config_id TEXT,
  deployment_id TEXT,
  strategy_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  starting_balance REAL NOT NULL,
  ending_balance REAL,
  net_profit REAL,
  net_profit_percent REAL,
  max_drawdown REAL,
  win_rate REAL,
  profit_factor REAL,
  total_trades INTEGER,
  config_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  trades_json TEXT NOT NULL,
  equity_curve_json TEXT NOT NULL,
  logs_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy_config_id ON backtest_runs (strategy_config_id);
-- idx_backtest_runs_deployment_id is created in db.ts applyColumnMigrations() so it runs
-- after the deployment_id column is ensured on databases that predate Phase 14.
CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy_id ON backtest_runs (strategy_id);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_instrument_timeframe ON backtest_runs (instrument, timeframe);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at ON backtest_runs (created_at);

CREATE TABLE IF NOT EXISTS optimizer_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strategy_config_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  starting_balance REAL NOT NULL,
  risk_profile_id TEXT NOT NULL,
  parameter_grid_json TEXT NOT NULL,
  scoring_weights_json TEXT NOT NULL,
  -- Phase 15.4: optional link to the deployment this session was seeded from (NULL for config-based sessions).
  deployment_id TEXT,
  -- Phase 15.4: metric the results are ranked by ('SCORE' = composite default).
  metric_primary TEXT NOT NULL DEFAULT 'SCORE',
  -- Phase 15.4: base strategy params the grid is layered on, snapshotted for reproducible re-runs.
  base_params_json TEXT NOT NULL DEFAULT '{}',
  total_runs INTEGER NOT NULL,
  completed_runs INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  best_result_id TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
-- NOTE: idx_optimizer_sessions_deployment_id is created in db.ts applyColumnMigrations(), NOT here,
-- so boot succeeds on a pre-15.4 DB where deployment_id is added by migration after applySchema().

CREATE INDEX IF NOT EXISTS idx_optimizer_sessions_strategy_config_id ON optimizer_sessions (strategy_config_id);
CREATE INDEX IF NOT EXISTS idx_optimizer_sessions_status ON optimizer_sessions (status);
CREATE INDEX IF NOT EXISTS idx_optimizer_sessions_created_at ON optimizer_sessions (created_at);

CREATE TABLE IF NOT EXISTS optimizer_results (
  id TEXT PRIMARY KEY,
  optimizer_session_id TEXT NOT NULL,
  backtest_run_id TEXT,
  params_json TEXT NOT NULL,
  score REAL NOT NULL,
  rank INTEGER,
  net_profit REAL,
  net_profit_percent REAL,
  max_drawdown REAL,
  win_rate REAL,
  profit_factor REAL,
  expectancy REAL,
  total_trades INTEGER,
  -- Phase 15.4: richer per-result metrics surfaced in the optimizer UI.
  average_win REAL,
  average_loss REAL,
  risk_adjusted_score REAL,
  warning_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_optimizer_results_optimizer_session_id ON optimizer_results (optimizer_session_id);
CREATE INDEX IF NOT EXISTS idx_optimizer_results_score ON optimizer_results (score);
CREATE INDEX IF NOT EXISTS idx_optimizer_results_rank ON optimizer_results (rank);

-- Phase 15.5: background optimizer job queue. One job per enqueued run of a session.
-- The worker claims QUEUED jobs, runs the simulation off the request path, and records
-- progress here. Simulation-only — a job never places orders or touches a deployment.
-- This is a brand-new table, so its CREATE + indexes live here safely (no boot-order
-- trap: the trap only affects indexes on columns added by migration to pre-existing tables).
CREATE TABLE IF NOT EXISTS optimizer_jobs (
  id TEXT PRIMARY KEY,
  optimizer_session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  total_combinations INTEGER NOT NULL DEFAULT 0,
  completed_combinations INTEGER NOT NULL DEFAULT 0,
  current_params_json TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  last_heartbeat_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_optimizer_jobs_session_id ON optimizer_jobs (optimizer_session_id);
CREATE INDEX IF NOT EXISTS idx_optimizer_jobs_status ON optimizer_jobs (status);
-- Claim order: highest priority first, then oldest queued first.
CREATE INDEX IF NOT EXISTS idx_optimizer_jobs_claim ON optimizer_jobs (status, priority DESC, queued_at ASC);

CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('OUT_OF_SAMPLE', 'WALK_FORWARD')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED')),
  strategy_config_id TEXT,
  optimizer_session_id TEXT,
  source_backtest_run_id TEXT,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  train_start_date TEXT,
  train_end_date TEXT,
  test_start_date TEXT,
  test_end_date TEXT,
  start_date TEXT,
  end_date TEXT,
  starting_balance REAL NOT NULL,
  request_json TEXT NOT NULL,
  summary_json TEXT,
  message TEXT,
  -- Phase 15.6 — queued worker: progress + ranking metadata.
  metric_primary TEXT,
  total_segments INTEGER,
  completed_segments INTEGER,
  created_at TEXT NOT NULL,
  queued_at TEXT,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_validation_runs_mode ON validation_runs (mode);
CREATE INDEX IF NOT EXISTS idx_validation_runs_status ON validation_runs (status);
CREATE INDEX IF NOT EXISTS idx_validation_runs_created_at ON validation_runs (created_at);

-- Phase 15.6 — background validation job queue (mirrors optimizer_jobs). One row is the
-- unit of background work the validation worker claims and runs for a validation run.
-- Pure simulation: nothing here touches a broker, an order, or a deployment.
CREATE TABLE IF NOT EXISTS validation_jobs (
  id TEXT PRIMARY KEY,
  validation_run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  total_segments INTEGER NOT NULL DEFAULT 0,
  completed_segments INTEGER NOT NULL DEFAULT 0,
  current_segment_index INTEGER,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  last_heartbeat_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validation_jobs_run_id ON validation_jobs (validation_run_id);
CREATE INDEX IF NOT EXISTS idx_validation_jobs_status ON validation_jobs (status);
-- Claim order: highest priority first, then oldest queued first.
CREATE INDEX IF NOT EXISTS idx_validation_jobs_claim ON validation_jobs (status, priority DESC, queued_at ASC);

-- Phase 15.6 — one row per validation segment: a walk-forward window, or the single
-- train/test split of an out-of-sample run. validation_results.window_index ties a
-- result back to its segment_index.
CREATE TABLE IF NOT EXISTS validation_segments (
  id TEXT PRIMARY KEY,
  validation_run_id TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  train_start TEXT,
  train_end TEXT,
  validation_start TEXT,
  validation_end TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED')),
  selected_params_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_validation_segments_run_id ON validation_segments (validation_run_id);

CREATE TABLE IF NOT EXISTS validation_results (
  id TEXT PRIMARY KEY,
  validation_run_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('MANUAL', 'BACKTEST_RUN', 'OPTIMIZER_RESULT', 'WALK_FORWARD_WINDOW')),
  source_id TEXT,
  window_index INTEGER,
  train_backtest_run_id TEXT,
  test_backtest_run_id TEXT,
  params_json TEXT NOT NULL,
  train_metrics_json TEXT,
  test_metrics_json TEXT NOT NULL,
  score REAL,
  pass INTEGER NOT NULL,
  warning_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validation_results_validation_run_id ON validation_results (validation_run_id);
CREATE INDEX IF NOT EXISTS idx_validation_results_score ON validation_results (score);
CREATE INDEX IF NOT EXISTS idx_validation_results_pass ON validation_results (pass);

-- Phase 15.7 — research leaderboard, scorecards, candidates, tags, and notes.
CREATE TABLE IF NOT EXISTS validation_scorecards (
  id TEXT PRIMARY KEY,
  validation_run_id TEXT NOT NULL UNIQUE,
  score_total REAL NOT NULL,
  score_profit_factor REAL NOT NULL,
  score_sharpe REAL NOT NULL,
  score_drawdown REAL NOT NULL,
  score_win_rate REAL NOT NULL,
  score_consistency REAL NOT NULL,
  score_trade_count REAL NOT NULL,
  weights_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validation_scorecards_run_id ON validation_scorecards (validation_run_id);
CREATE INDEX IF NOT EXISTS idx_validation_scorecards_total ON validation_scorecards (score_total);

CREATE TABLE IF NOT EXISTS deployment_candidates (
  id TEXT PRIMARY KEY,
  validation_run_id TEXT NOT NULL,
  validation_result_id TEXT,
  scorecard_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('NEW', 'REVIEWED', 'APPROVED', 'REJECTED', 'DEPLOYED')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deployment_candidates_run_id ON deployment_candidates (validation_run_id);
CREATE INDEX IF NOT EXISTS idx_deployment_candidates_status ON deployment_candidates (status);

CREATE TABLE IF NOT EXISTS validation_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_run_tags (
  validation_run_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (validation_run_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_validation_run_tags_tag_id ON validation_run_tags (tag_id);

CREATE TABLE IF NOT EXISTS validation_notes (
  id TEXT PRIMARY KEY,
  validation_run_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validation_notes_run_id ON validation_notes (validation_run_id);

-- Phase 15.7: ranking pipeline. Scores and ranks optimizer/validation candidates into
-- reproducible snapshots. Pure recommendation/analysis — never touches a broker, never
-- places an order, never enables a deployment/autopilot.
CREATE TABLE IF NOT EXISTS ranking_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  weights_json TEXT NOT NULL,
  thresholds_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ranking_profiles_is_default ON ranking_profiles (is_default);

CREATE TABLE IF NOT EXISTS ranking_runs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('optimizer_session', 'validation_run', 'mixed')),
  source_id TEXT,
  ranking_profile_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'RUNNING', 'COMPLETED', 'FAILED')),
  summary_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ranking_runs_source ON ranking_runs (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ranking_runs_profile_id ON ranking_runs (ranking_profile_id);
CREATE INDEX IF NOT EXISTS idx_ranking_runs_created_at ON ranking_runs (created_at);

CREATE TABLE IF NOT EXISTS ranking_results (
  id TEXT PRIMARY KEY,
  ranking_run_id TEXT NOT NULL,
  candidate_type TEXT NOT NULL CHECK (candidate_type IN ('optimizer_result', 'validation_result', 'deployment_candidate')),
  candidate_id TEXT NOT NULL,
  candidate_label TEXT,
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  base_score REAL NOT NULL,
  total_penalty REAL NOT NULL,
  score_breakdown_json TEXT NOT NULL,
  metrics_snapshot_json TEXT NOT NULL,
  penalties_json TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ranking_results_run_id ON ranking_results (ranking_run_id);
CREATE INDEX IF NOT EXISTS idx_ranking_results_rank ON ranking_results (rank);

-- Phase 15.8: research-to-deployment review workflow. A guided, human-driven review
-- pipeline that snapshots the evidence behind a candidate (data → backtest → optimizer →
-- validation → ranking) into a reproducible checklist before a human approves it as a
-- deployment CANDIDATE. Pure review/recommendation — never touches a broker, never places
-- an order, never enables a deployment/autopilot. A review run snapshots its evidence and
-- checklist items so a review is reproducible and not recomputed from mutable source rows.
CREATE TABLE IF NOT EXISTS research_review_runs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('ranking_result', 'validation_result', 'optimizer_result', 'deployment_candidate')),
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED_FOR_DEPLOYMENT_CANDIDATE', 'REJECTED', 'NEEDS_MORE_DATA')),
  overall_grade TEXT CHECK (overall_grade IN ('PASS', 'WARN', 'FAIL')),
  summary_json TEXT,
  reviewer_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_review_runs_source ON research_review_runs (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_research_review_runs_status ON research_review_runs (status);
CREATE INDEX IF NOT EXISTS idx_research_review_runs_created_at ON research_review_runs (created_at);

CREATE TABLE IF NOT EXISTS research_review_items (
  id TEXT PRIMARY KEY,
  review_run_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('DATA', 'BACKTEST', 'OPTIMIZER', 'VALIDATION', 'RANKING', 'RISK', 'DEPLOYMENT_SAFETY', 'HUMAN_REVIEW')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS', 'WARN', 'FAIL', 'MISSING', 'INFO')),
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCKER')),
  details_json TEXT,
  explanation TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_review_items_run_id ON research_review_items (review_run_id);

CREATE TABLE IF NOT EXISTS research_review_decisions (
  id TEXT PRIMARY KEY,
  review_run_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE_DEPLOYMENT_CANDIDATE', 'REJECT', 'NEEDS_MORE_DATA', 'NOTE_ONLY')),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_review_decisions_run_id ON research_review_decisions (review_run_id);

-- Phase 9: manual demo order ticket (OANDA practice only). Never stores API keys/secrets.
CREATE TABLE IF NOT EXISTS manual_order_previews (
  id TEXT PRIMARY KEY,
  confirmation_token TEXT NOT NULL,
  account_id TEXT,
  broker TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('demo')),
  instrument TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  units REAL NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('MARKET')),
  estimated_price REAL,
  stop_loss_price REAL,
  take_profit_price REAL,
  notional_estimate REAL,
  margin_estimate REAL,
  risk_summary_json TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_order_previews_created_at ON manual_order_previews (created_at);
CREATE INDEX IF NOT EXISTS idx_manual_order_previews_expires_at ON manual_order_previews (expires_at);

CREATE TABLE IF NOT EXISTS manual_order_executions (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL,
  broker TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('demo')),
  instrument TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  units REAL NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('MARKET')),
  requested_price REAL,
  fill_price REAL,
  stop_loss_price REAL,
  take_profit_price REAL,
  broker_order_id TEXT,
  broker_transaction_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('FILLED', 'SUBMITTED', 'REJECTED', 'ERROR')),
  error_message TEXT,
  broker_response_summary_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_order_executions_preview_id ON manual_order_executions (preview_id);
CREATE INDEX IF NOT EXISTS idx_manual_order_executions_created_at ON manual_order_executions (created_at);

-- Phase 11 — OANDA practice-only position close / flatten previews and executions.
-- environment is locked to 'demo' by CHECK; there is no live close path anywhere.
CREATE TABLE IF NOT EXISTS manual_close_previews (
  id TEXT PRIMARY KEY,
  confirmation_token TEXT NOT NULL,
  broker TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('demo')),
  action_type TEXT NOT NULL CHECK (action_type IN ('CLOSE_TRADE', 'CLOSE_INSTRUMENT_POSITION', 'FLATTEN_ALL_PRACTICE_POSITIONS')),
  target_trade_id TEXT,
  target_instrument TEXT,
  target_side TEXT CHECK (target_side IS NULL OR target_side IN ('long', 'short', 'both')),
  requested_units TEXT,
  affected_summary_json TEXT NOT NULL,
  price_summary_json TEXT,
  warnings_json TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_close_previews_created_at ON manual_close_previews (created_at);
CREATE INDEX IF NOT EXISTS idx_manual_close_previews_expires_at ON manual_close_previews (expires_at);

CREATE TABLE IF NOT EXISTS manual_close_executions (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL,
  broker TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('demo')),
  action_type TEXT NOT NULL CHECK (action_type IN ('CLOSE_TRADE', 'CLOSE_INSTRUMENT_POSITION', 'FLATTEN_ALL_PRACTICE_POSITIONS')),
  target_trade_id TEXT,
  target_instrument TEXT,
  target_side TEXT CHECK (target_side IS NULL OR target_side IN ('long', 'short', 'both')),
  requested_units TEXT,
  status TEXT NOT NULL CHECK (status IN ('CLOSED', 'PARTIALLY_CLOSED', 'SUBMITTED', 'REJECTED', 'ERROR')),
  broker_transaction_ids_json TEXT,
  affected_summary_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_close_executions_preview_id ON manual_close_executions (preview_id);
CREATE INDEX IF NOT EXISTS idx_manual_close_executions_created_at ON manual_close_executions (created_at);

-- Phase 12 — application-level audit log for sensitive actions (auth + trading controls).
-- Never stores passwords, session secrets, OANDA tokens, or confirmation tokens. `metadata_json`
-- holds only safe, non-secret context (instrument, side, units, action type, error codes, etc.).
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  username TEXT,
  role TEXT,
  action TEXT NOT NULL,
  route TEXT,
  method TEXT,
  ip TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL,
  status_code INTEGER,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_username ON audit_log (username);

-- Phase 13 — modular strategy framework (live runtime). Practice account only; the live
-- execution engine is locked to environment 'demo' and routes through the existing manual
-- order path. Strategies never place orders directly.

-- Mirror of the code-level strategy registry. Upserted from @forex/engine on every boot
-- (auto-discovery sync), so `enabled` is the only operator-owned column here.
CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_schema_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- A live deployment = a strategy bound to an instrument/timeframe with its own params + risk
-- profile. `enabled` controls whether the engine evaluates it; `autopilot` controls whether
-- passed signals auto-place practice orders (default off = signal-only). Signals and
-- performance key on the deployment id.
CREATE TABLE IF NOT EXISTS strategy_deployments (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  strategy_config_id TEXT,
  name TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  account_id TEXT,
  params_json TEXT NOT NULL,
  risk_profile_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  autopilot INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'IDLE' CHECK (status IN ('IDLE', 'RUNNING', 'ERROR')),
  last_evaluated_at TEXT,
  last_signal_at TEXT,
  error_message TEXT,
  -- Phase 16.4 — persisted Deployment → Source Result link. Nullable; legacy rows are
  -- left NULL and fall back to heuristic intelligence matching. source_type is one of
  -- 'validation_result' | 'optimizer_result' | 'backtest_result' | 'manual' | 'unknown'.
  source_type TEXT,
  source_result_id TEXT,
  source_session_id TEXT,
  source_metadata_json TEXT,
  source_link_created_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_deployments_enabled ON strategy_deployments (enabled);
-- NOTE: idx_strategy_deployments_source is created in db.ts (applyColumnMigrations) after
-- ensureColumn adds the Phase 16.4 source_* columns, so it is safe on legacy DBs whose
-- pre-16.4 strategy_deployments table exists without those columns (CREATE TABLE IF NOT
-- EXISTS is a no-op there, leaving the columns to ensureColumn).
CREATE INDEX IF NOT EXISTS idx_strategy_deployments_strategy_id ON strategy_deployments (strategy_id);

-- One row per signal the engine generates (including HOLD). indicators_json carries the named
-- indicator readings; explanation is human-readable. risk_status records the risk-engine verdict;
-- executed/execution_id link to a manual_order_executions row when autopilot fired.
CREATE TABLE IF NOT EXISTS strategy_signals (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  candle_time TEXT,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('BUY', 'SELL', 'CLOSE', 'HOLD')),
  confidence REAL,
  indicators_json TEXT,
  explanation TEXT,
  stop_loss REAL,
  take_profit REAL,
  risk_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (risk_status IN ('PENDING', 'ALLOWED', 'REJECTED', 'SKIPPED')),
  risk_reason TEXT,
  size_units REAL,
  executed INTEGER NOT NULL DEFAULT 0,
  execution_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_strategy_signals_deployment_id ON strategy_signals (deployment_id);
CREATE INDEX IF NOT EXISTS idx_strategy_signals_created_at ON strategy_signals (created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_signals_signal_type ON strategy_signals (signal_type);

-- Running performance aggregate per deployment, updated when a strategy-initiated practice
-- trade closes. peak_equity/current_equity track the running max-drawdown denominator.
CREATE TABLE IF NOT EXISTS strategy_performance (
  deployment_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  trades INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  win_rate REAL NOT NULL DEFAULT 0,
  gross_profit REAL NOT NULL DEFAULT 0,
  gross_loss REAL NOT NULL DEFAULT 0,
  net_profit REAL NOT NULL DEFAULT 0,
  max_drawdown REAL NOT NULL DEFAULT 0,
  peak_equity REAL NOT NULL DEFAULT 0,
  current_equity REAL NOT NULL DEFAULT 0,
  last_trade_at TEXT,
  updated_at TEXT NOT NULL
);

-- Phase 16.0 — application user manager. Replaces the env-only auth model with a real
-- users table while keeping the env-configured admin as an emergency fallback (see
-- auth/users.ts). Password hashes are bcrypt; plaintext is never stored. Roles:
--   admin      — full access, including user management.
--   researcher — research/backtest/optimizer/validation/ranking/review (no user mgmt).
--   viewer     — read-only.
-- The "at least one enabled admin" invariant is enforced in code (user.service.ts).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'researcher', 'viewer')),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  password_changed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_is_enabled ON users (is_enabled);

-- Phase 17.0 — Forward/Paper Trading Ledger. Practice-only forward simulation of a
-- deployment's strategy: candle-driven signals run through the same risk engine as
-- live trading, but fills are simulated (simulateFillPrice/checkExit) and NO broker
-- order is ever placed, regardless of autopilot or live credentials. A run snapshots
-- its strategy/instrument/timeframe/params/risk profile from the deployment at start
-- time, so it stays reproducible even if the deployment is edited later.
CREATE TABLE IF NOT EXISTS paper_runs (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  params_json TEXT NOT NULL,
  risk_profile_id TEXT NOT NULL,
  candle_source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'STOPPED')),
  starting_balance REAL NOT NULL,
  realized_pl REAL NOT NULL DEFAULT 0,
  unrealized_pl REAL NOT NULL DEFAULT 0,
  current_equity REAL NOT NULL,
  peak_equity REAL NOT NULL,
  max_drawdown REAL NOT NULL DEFAULT 0,
  trades INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  win_rate REAL NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  allowed_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  -- Snapshot of the deployment's Phase 16.4 source link at run-creation time, for
  -- traceability back to the validation/optimizer result this strategy came from.
  source_type TEXT,
  source_result_id TEXT,
  last_candle_time TEXT,
  last_tick_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  stopped_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_runs_deployment_id ON paper_runs (deployment_id);
CREATE INDEX IF NOT EXISTS idx_paper_runs_status ON paper_runs (status);

-- One row per signal a paper run generates (including HOLD), mirroring strategy_signals
-- but scoped to a paper run. resulting_action records what the paper engine actually did
-- with the signal (OPENED/CLOSED/REVERSED/SKIPPED/NONE) for full traceability.
CREATE TABLE IF NOT EXISTS paper_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  candle_time TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('BUY', 'SELL', 'CLOSE', 'HOLD')),
  confidence REAL,
  indicators_json TEXT,
  explanation TEXT,
  stop_loss REAL,
  take_profit REAL,
  risk_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (risk_status IN ('PENDING', 'ALLOWED', 'REJECTED', 'SKIPPED')),
  risk_reason TEXT,
  size_units REAL,
  risk_explanation_json TEXT,
  resulting_action TEXT NOT NULL DEFAULT 'NONE' CHECK (resulting_action IN ('OPENED', 'CLOSED', 'REVERSED', 'SKIPPED', 'NONE')),
  position_id TEXT,
  trade_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_paper_decisions_run_id ON paper_decisions (run_id);
CREATE INDEX IF NOT EXISTS idx_paper_decisions_created_at ON paper_decisions (created_at);

-- The single open simulated position for a run, if any. Closing a position deletes its
-- row here and writes the corresponding history into paper_trades.
CREATE TABLE IF NOT EXISTS paper_positions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  entry_price REAL NOT NULL,
  entry_time TEXT NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  size_units REAL NOT NULL,
  unrealized_pl REAL NOT NULL DEFAULT 0,
  last_mark_price REAL,
  opened_decision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_positions_run_id ON paper_positions (run_id);

-- Closed simulated trade ledger. exit_reason mirrors the backtester's TradeExitReason
-- vocabulary (STOP_LOSS/TAKE_PROFIT/STRATEGY_CLOSE/OPPOSITE_SIGNAL/RUN_STOPPED).
CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  entry_price REAL NOT NULL,
  entry_time TEXT NOT NULL,
  exit_price REAL NOT NULL,
  exit_time TEXT NOT NULL,
  size_units REAL NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  realized_pl REAL NOT NULL,
  exit_reason TEXT NOT NULL,
  opened_decision_id TEXT,
  closed_decision_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_run_id ON paper_trades (run_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_created_at ON paper_trades (created_at);

-- Mark-to-market equity/drawdown snapshot, recorded once per processed candle per run.
CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  candle_time TEXT NOT NULL,
  equity REAL NOT NULL,
  realized_pl REAL NOT NULL,
  unrealized_pl REAL NOT NULL,
  drawdown REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_equity_snapshots_run_id ON paper_equity_snapshots (run_id);
CREATE INDEX IF NOT EXISTS idx_paper_equity_snapshots_created_at ON paper_equity_snapshots (created_at);

-- Phase 18.0 — Adaptive Portfolio Intelligence (read-only analytical layer).
-- All tables here are pure analysis/recommendation — nothing touches broker/order tables,
-- live trading, autopilot flags, or existing deployment rows.

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
CREATE INDEX IF NOT EXISTS idx_market_regimes_symbol_gran_detected ON market_regimes (symbol, granularity, detected_at);

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
CREATE INDEX IF NOT EXISTS idx_strategy_health_dep_calculated ON strategy_health (deployment_id, calculated_at);

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
CREATE INDEX IF NOT EXISTS idx_deployment_correlations_pair_calculated ON deployment_correlations (deployment_a_id, deployment_b_id, calculated_at);

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
CREATE INDEX IF NOT EXISTS idx_strategy_allocations_dep_calculated ON strategy_allocations (deployment_id, calculated_at);

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

-- Phase 18.2 — Portfolio Intelligence Job Tracking
CREATE TABLE IF NOT EXISTS portfolio_intelligence_jobs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  trigger TEXT NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULED')),
  duration_ms INTEGER,
  error_message TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pi_jobs_status ON portfolio_intelligence_jobs (status);
CREATE INDEX IF NOT EXISTS idx_pi_jobs_created_at ON portfolio_intelligence_jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_pi_jobs_trigger ON portfolio_intelligence_jobs (trigger);
