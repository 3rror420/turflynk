-- Phase 18.1 — Composite index additions for portfolio intelligence tables.
--
-- The original Phase 18 migration created single-column indexes. The "latest per X"
-- queries (listLatestHealthSnapshots, listCurrentRegimes, listLatestCorrelations,
-- listLatestAllocations) run correlated subqueries with MAX(calculated_at) GROUP BY
-- on large result sets. These composite covering indexes remove full-table scans.

CREATE INDEX IF NOT EXISTS idx_market_regimes_symbol_gran_detected
  ON market_regimes (symbol, granularity, detected_at);

CREATE INDEX IF NOT EXISTS idx_strategy_health_dep_calculated
  ON strategy_health (deployment_id, calculated_at);

CREATE INDEX IF NOT EXISTS idx_deployment_correlations_pair_calculated
  ON deployment_correlations (deployment_a_id, deployment_b_id, calculated_at);

CREATE INDEX IF NOT EXISTS idx_strategy_allocations_dep_calculated
  ON strategy_allocations (deployment_id, calculated_at);
