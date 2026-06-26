import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client.js";
import type {
  Phase18LatestState,
  PortfolioRecommendation,
  PortfolioSnapshot,
  HealthSnapshot,
  AllocationRecommendation,
  CorrelationRow,
  RegimeSnapshot,
  RecommendationAnalytics,
  StrategyDeployment,
  SchedulerStatus,
} from "../api/client.js";
import { RegimePanel } from "../components/portfolioIntelligence/RegimePanel.js";
import { HealthTable } from "../components/portfolioIntelligence/HealthTable.js";
import { AllocationTable } from "../components/portfolioIntelligence/AllocationTable.js";
import { CorrelationMatrix } from "../components/portfolioIntelligence/CorrelationMatrix.js";
import { RecommendationsPanel } from "../components/portfolioIntelligence/RecommendationsPanel.js";
import { PortfolioSnapshotCard } from "../components/portfolioIntelligence/PortfolioSnapshotCard.js";
import { JobStatusPanel } from "../components/portfolioIntelligence/JobStatusPanel.js";
import { PortfolioChartsPanel } from "../components/portfolioIntelligence/PortfolioChartsPanel.js";
import { RegimeTimeline } from "../components/portfolioIntelligence/RegimeTimeline.js";
import { HealthTrendPanel } from "../components/portfolioIntelligence/HealthTrendPanel.js";
import { AllocationHistoryPanel } from "../components/portfolioIntelligence/AllocationHistoryPanel.js";
import { CorrelationHistoryPanel } from "../components/portfolioIntelligence/CorrelationHistoryPanel.js";
import { RecommendationAnalyticsPanel } from "../components/portfolioIntelligence/RecommendationAnalyticsPanel.js";

type Tab = "current" | "history";

export function PortfolioIntelligence() {
  const [state, setState] = useState<Phase18LatestState | null>(null);
  const [allRecs, setAllRecs] = useState<PortfolioRecommendation[]>([]);
  const [deploymentNames, setDeploymentNames] = useState<Map<string, string>>(new Map());
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);

  // Phase 18.3 — history data
  const [snapshotHistory, setSnapshotHistory] = useState<PortfolioSnapshot[]>([]);
  const [regimeTimeline, setRegimeTimeline] = useState<RegimeSnapshot[]>([]);
  const [healthHistory, setHealthHistory] = useState<HealthSnapshot[]>([]);
  const [allocationHistory, setAllocationHistory] = useState<AllocationRecommendation[]>([]);
  const [correlationHistory, setCorrelationHistory] = useState<CorrelationRow[]>([]);
  const [recAnalytics, setRecAnalytics] = useState<RecommendationAnalytics | null>(null);

  const [tab, setTab] = useState<Tab>("current");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<Record<string, unknown> | null>(null);

  const loadState = useCallback(async () => {
    try {
      const [s, recs, deps, sched] = await Promise.all([
        apiClient.getPortfolioIntelligenceStatus(),
        apiClient.getPortfolioRecommendations(undefined, 200),
        apiClient.getDeployments(),
        apiClient.getPortfolioSchedulerStatus(),
      ]);
      setState(s);
      setAllRecs(recs);
      setSchedulerStatus(sched);
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

  const loadHistory = useCallback(async () => {
    try {
      const [snaps, timeline, health, alloc, corr, analytics] = await Promise.all([
        apiClient.getSnapshotHistory(100),
        apiClient.getRegimeTimeline(100),
        apiClient.getPortfolioHealth(),
        apiClient.getPortfolioAllocations(),
        apiClient.getCorrelationHistory(100),
        apiClient.getRecommendationAnalytics(50),
      ]);
      setSnapshotHistory(snaps);
      setRegimeTimeline(timeline);
      setHealthHistory(health);
      setAllocationHistory(alloc);
      setCorrelationHistory(corr);
      setRecAnalytics(analytics);
    } catch {
      // history errors are non-fatal
    }
  }, []);

  useEffect(() => {
    void loadState();
    void loadHistory();
  }, [loadState, loadHistory]);

  async function handleRunAnalysis() {
    setRunning(true);
    setError(null);
    try {
      const result = await apiClient.runPhase18Analysis();
      setRunSummary(result.summary as unknown as Record<string, unknown>);
      await Promise.all([loadState(), loadHistory()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
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
        {schedulerStatus && (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {schedulerStatus.enabled
              ? `Auto-refresh every ${schedulerStatus.intervalMinutes}m`
              : "Auto-refresh disabled"}
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

      {/* Tab navigation */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {(["current", "history"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === t ? "var(--accent)" : "var(--text-dim)",
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
              marginBottom: -1,
              textTransform: "capitalize",
            }}
          >
            {t === "current" ? "Current State" : "Historical View"}
          </button>
        ))}
      </div>

      {tab === "current" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <JobStatusPanel
            schedulerStatus={schedulerStatus}
            onRefresh={() => void loadState()}
          />

          <PortfolioSnapshotCard snapshot={state?.portfolioSnapshot ?? null} />

          <RecommendationsPanel
            recommendations={allRecs}
            onResolved={() => void loadState()}
          />

          <RegimePanel regimes={state?.regimes ?? []} />

          <HealthTable snapshots={state?.healthSnapshots ?? []} deploymentNames={deploymentNames} />

          <AllocationTable allocations={state?.allocations ?? []} deploymentNames={deploymentNames} />

          <CorrelationMatrix correlations={state?.correlations ?? []} deploymentNames={deploymentNames} />
        </div>
      )}

      {tab === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PortfolioChartsPanel snapshots={snapshotHistory} />

          <RecommendationAnalyticsPanel analytics={recAnalytics} />

          <RegimeTimeline regimes={regimeTimeline} />

          <HealthTrendPanel snapshots={healthHistory} deploymentNames={deploymentNames} />

          <AllocationHistoryPanel allocations={allocationHistory} deploymentNames={deploymentNames} />

          <CorrelationHistoryPanel
            current={state?.correlations ?? []}
            history={correlationHistory}
            deploymentNames={deploymentNames}
          />
        </div>
      )}
    </div>
  );
}
