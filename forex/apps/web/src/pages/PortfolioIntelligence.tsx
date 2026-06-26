import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client.js";
import type {
  Phase18LatestState,
  PortfolioRecommendation,
  StrategyDeployment,
} from "../api/client.js";
import { RegimePanel } from "../components/portfolioIntelligence/RegimePanel.js";
import { HealthTable } from "../components/portfolioIntelligence/HealthTable.js";
import { AllocationTable } from "../components/portfolioIntelligence/AllocationTable.js";
import { CorrelationMatrix } from "../components/portfolioIntelligence/CorrelationMatrix.js";
import { RecommendationsPanel } from "../components/portfolioIntelligence/RecommendationsPanel.js";
import { PortfolioSnapshotCard } from "../components/portfolioIntelligence/PortfolioSnapshotCard.js";

export function PortfolioIntelligence() {
  const [state, setState] = useState<Phase18LatestState | null>(null);
  const [allRecs, setAllRecs] = useState<PortfolioRecommendation[]>([]);
  const [deploymentNames, setDeploymentNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<Record<string, unknown> | null>(null);

  const loadState = useCallback(async () => {
    try {
      const [s, recs, deps] = await Promise.all([
        apiClient.getPortfolioIntelligenceStatus(),
        apiClient.getPortfolioRecommendations(undefined, 200),
        apiClient.getDeployments(),
      ]);
      setState(s);
      setAllRecs(recs);
      const nameMap = new Map<string, string>();
      for (const d of deps as StrategyDeployment[]) {
        nameMap.set(d.id, d.name);
      }
      setDeploymentNames(nameMap);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio intelligence data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  async function handleRunAnalysis() {
    setRunning(true);
    setError(null);
    try {
      const result = await apiClient.runPhase18Analysis();
      setLastRunAt(result.ranAt);
      setRunSummary(result.summary as unknown as Record<string, unknown>);
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleRecResolved() {
    await loadState();
  }

  if (loading) {
    return (
      <div style={{ padding: 24, color: "var(--text-dim)" }}>Loading portfolio intelligence…</div>
    );
  }

  const openCritical = allRecs.filter((r) => r.status === "OPEN" && r.severity === "CRITICAL").length;
  const openWarning = allRecs.filter((r) => r.status === "OPEN" && r.severity === "WARNING").length;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Portfolio Intelligence</h2>
        {openCritical > 0 && (
          <span
            style={{
              background: "#ef444433",
              color: "#ef4444",
              border: "1px solid #ef444466",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {openCritical} CRITICAL
          </span>
        )}
        {openWarning > 0 && (
          <span
            style={{
              background: "#f59e0b33",
              color: "#f59e0b",
              border: "1px solid #f59e0b66",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 12,
            }}
          >
            {openWarning} WARNING
          </span>
        )}
      </div>

      <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 16 }}>
        Read-only portfolio analytical layer. All outputs are recommendations only — no autonomous
        trading or deployment changes occur.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleRunAnalysis()}
          disabled={running}
        >
          {running ? "Running analysis…" : "Run Analysis"}
        </button>
        {lastRunAt && (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Last run: {new Date(lastRunAt).toLocaleString()}
          </span>
        )}
        {runSummary && (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {String(runSummary.deploymentsScored ?? 0)} scored ·{" "}
            {String(runSummary.recommendationsGenerated ?? 0)} recommendations ·{" "}
            {String(runSummary.criticalRecommendations ?? 0)} critical
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            background: "#ef444422",
            border: "1px solid #ef4444",
            borderRadius: 6,
            padding: "8px 12px",
            color: "#ef4444",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <PortfolioSnapshotCard snapshot={state?.portfolioSnapshot ?? null} />

        <RecommendationsPanel recommendations={allRecs} onResolved={() => void handleRecResolved()} />

        <RegimePanel regimes={state?.regimes ?? []} />

        <HealthTable snapshots={state?.healthSnapshots ?? []} deploymentNames={deploymentNames} />

        <AllocationTable allocations={state?.allocations ?? []} deploymentNames={deploymentNames} />

        <CorrelationMatrix correlations={state?.correlations ?? []} deploymentNames={deploymentNames} />
      </div>
    </div>
  );
}
