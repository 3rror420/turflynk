import type { RecommendationAnalytics, PortfolioRecommendation } from "../../api/client.js";

interface Props {
  analytics: RecommendationAnalytics | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  WARNING: "#f59e0b",
  INFO: "#3b82f6",
};

const TYPE_LABELS: Record<string, string> = {
  PAUSE_DEPLOYMENT: "Pause Deployment",
  RESUME_DEPLOYMENT: "Resume Deployment",
  REDUCE_ALLOCATION: "Reduce Allocation",
  INCREASE_ALLOCATION: "Increase Allocation",
  RERUN_OPTIMIZER: "Rerun Optimizer",
  RERUN_VALIDATION: "Rerun Validation",
  AVOID_REGIME: "Avoid Regime",
  HIGH_CORRELATION: "High Correlation",
  DRAWDOWN_WARNING: "Drawdown Warning",
  REGIME_CHANGE: "Regime Change",
  LOW_HEALTH: "Low Health",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function RecentRow({ rec }: { rec: PortfolioRecommendation }) {
  const color = SEVERITY_COLORS[rec.severity] ?? "#6b7280";
  return (
    <tr style={{ borderBottom: "1px solid var(--border-dim)" }}>
      <td style={{ padding: "4px 8px" }}>
        <span style={{ color, fontSize: 11, fontWeight: 600 }}>{rec.severity}</span>
      </td>
      <td style={{ padding: "4px 8px", fontSize: 12 }}>
        {TYPE_LABELS[rec.type] ?? rec.type}
      </td>
      <td style={{ padding: "4px 8px", fontSize: 12 }}>{rec.title}</td>
      <td style={{ padding: "4px 8px", fontSize: 11, color: "var(--text-dim)" }}>
        <span
          style={{
            background: rec.status === "OPEN" ? "#3b82f622" : "#6b728022",
            color: rec.status === "OPEN" ? "#3b82f6" : "#6b7280",
            border: `1px solid ${rec.status === "OPEN" ? "#3b82f655" : "#6b728055"}`,
            borderRadius: 4,
            padding: "1px 5px",
          }}
        >
          {rec.status}
        </span>
      </td>
      <td style={{ padding: "4px 8px", textAlign: "right", fontSize: 11, color: "var(--text-dim)" }}>
        {fmtDate(rec.createdAt)}
      </td>
    </tr>
  );
}

export function RecommendationAnalyticsPanel({ analytics }: Props) {
  if (!analytics) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Recommendation Analytics</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading analytics…</p>
      </div>
    );
  }

  const { openBySeverity, openByType, totalOpen, totalResolved, totalDismissed, recentHistory } = analytics;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Recommendation Analytics</h3>

      {/* Summary row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {(["CRITICAL", "WARNING", "INFO"] as const).map((sev) => (
          <div
            key={sev}
            style={{
              background: `${SEVERITY_COLORS[sev]}22`,
              border: `1px solid ${SEVERITY_COLORS[sev]}55`,
              borderRadius: 6,
              padding: "8px 14px",
              minWidth: 90,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: SEVERITY_COLORS[sev] }}>
              {openBySeverity[sev]}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Open {sev}</div>
          </div>
        ))}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 14px", minWidth: 90, textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{totalResolved}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Resolved</div>
        </div>
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 14px", minWidth: 90, textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-dim)" }}>{totalDismissed}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Dismissed</div>
        </div>
      </div>

      {/* Open by type */}
      {totalOpen > 0 && Object.keys(openByType).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-dim)" }}>
            Open by Type
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(openByType).map(([type, count]) => (
              <span
                key={type}
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 11,
                }}
              >
                {TYPE_LABELS[type] ?? type}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent history table */}
      {recentHistory.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-dim)" }}>
            Recent Recommendation History
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Severity</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Type</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Title</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "4px 8px" }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentHistory.slice(0, 20).map((r) => (
                  <RecentRow key={r.id} rec={r} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {totalOpen === 0 && recentHistory.length === 0 && (
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No recommendations generated yet. Run analysis to generate recommendations.
        </p>
      )}
    </div>
  );
}
