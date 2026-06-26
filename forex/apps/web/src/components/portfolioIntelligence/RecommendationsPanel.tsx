import { useState } from "react";
import type { PortfolioRecommendation, RecommendationSeverity, RecommendationStatus } from "../../api/client.js";
import { apiClient } from "../../api/client.js";

interface Props {
  recommendations: PortfolioRecommendation[];
  onResolved?: () => void;
}

const SEVERITY_COLOR: Record<RecommendationSeverity, string> = {
  CRITICAL: "#ef4444",
  WARNING: "#f59e0b",
  INFO: "#60a5fa",
};

const STATUS_FILTERS: Array<{ label: string; value: RecommendationStatus | "ALL" }> = [
  { label: "Open", value: "OPEN" },
  { label: "Dismissed", value: "DISMISSED" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "All", value: "ALL" },
];

export function RecommendationsPanel({ recommendations, onResolved }: Props) {
  const [statusFilter, setStatusFilter] = useState<RecommendationStatus | "ALL">("OPEN");
  const [resolving, setResolving] = useState<string | null>(null);

  const filtered =
    statusFilter === "ALL" ? recommendations : recommendations.filter((r) => r.status === statusFilter);

  async function handleResolve(id: string, action: "DISMISSED" | "RESOLVED") {
    setResolving(id);
    try {
      await apiClient.resolvePortfolioRecommendation(id, action);
      onResolved?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to resolve");
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Recommendations</h3>
        <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}>
          {recommendations.filter((r) => r.status === "OPEN").length} open
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={statusFilter === f.value ? "btn-primary" : "btn-secondary"}
            style={{ fontSize: 12, padding: "2px 10px" }}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No {statusFilter === "ALL" ? "" : statusFilter.toLowerCase()} recommendations.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((r) => (
            <div
              key={r.id}
              style={{
                border: `1px solid ${SEVERITY_COLOR[r.severity]}44`,
                borderLeft: `3px solid ${SEVERITY_COLOR[r.severity]}`,
                borderRadius: 6,
                padding: "8px 12px",
                background: `${SEVERITY_COLOR[r.severity]}08`,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: SEVERITY_COLOR[r.severity],
                        textTransform: "uppercase",
                      }}
                    >
                      {r.severity}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-dim)" }}>· {r.type.replace(/_/g, " ")}</span>
                    {r.status !== "OPEN" && (
                      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>· {r.status}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{r.message}</div>
                  {r.reasons.length > 0 && (
                    <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: 11, color: "var(--text-dim)" }}>
                      {r.reasons.map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  )}
                  {r.resolutionNote && (
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, fontStyle: "italic" }}>
                      Note: {r.resolutionNote}
                    </div>
                  )}
                </div>
                {r.status === "OPEN" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 90 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      disabled={resolving === r.id}
                      onClick={() => void handleResolve(r.id, "DISMISSED")}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      disabled={resolving === r.id}
                      onClick={() => void handleResolve(r.id, "RESOLVED")}
                    >
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
