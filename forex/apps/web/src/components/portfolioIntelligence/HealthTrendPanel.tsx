import { useState } from "react";
import type { HealthSnapshot } from "../../api/client.js";

interface Props {
  snapshots: HealthSnapshot[];
  deploymentNames?: Map<string, string>;
  onSelectDeployment?: (deploymentId: string) => void;
}

function healthColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 45) return "#f59e0b";
  return "#ef4444";
}

function arrow(current: number, previous: number): string {
  const diff = current - previous;
  if (diff > 2) return "↑";
  if (diff < -2) return "↓";
  return "→";
}

function arrowColor(current: number, previous: number): string {
  const diff = current - previous;
  if (diff > 2) return "#22c55e";
  if (diff < -2) return "#ef4444";
  return "var(--text-dim)";
}

interface HistoryRowProps {
  deploymentId: string;
  name: string;
  history: HealthSnapshot[];
}

function HistoryRow({ name, history }: HistoryRowProps) {
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) return null;

  const latest = history[0];
  const previous = history[1];
  const latestScore = latest.healthScore;
  const prevScore = previous?.healthScore ?? latestScore;
  const diff = latestScore - prevScore;

  return (
    <>
      <tr
        style={{ borderBottom: "1px solid var(--border-dim)", cursor: "pointer" }}
        onClick={() => setExpanded((e) => !e)}
      >
        <td style={{ padding: "4px 8px", fontWeight: 500 }}>
          <span style={{ marginRight: 6, fontSize: 11, color: "var(--text-dim)" }}>
            {expanded ? "▾" : "▸"}
          </span>
          {name}
        </td>
        <td style={{ padding: "4px 8px", textAlign: "right" }}>
          <span style={{ color: healthColor(latestScore), fontWeight: 700 }}>
            {latestScore.toFixed(0)}
          </span>
        </td>
        <td style={{ padding: "4px 8px", textAlign: "right" }}>
          {previous && (
            <span style={{ color: arrowColor(latestScore, prevScore) }}>
              {arrow(latestScore, prevScore)} {diff > 0 ? "+" : ""}{diff.toFixed(0)}
            </span>
          )}
        </td>
        <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)", fontSize: 11 }}>
          {history.length} snapshot{history.length !== 1 ? "s" : ""}
        </td>
        <td style={{ padding: "4px 8px", fontSize: 11, color: "var(--text-dim)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {latest.reasons.slice(0, 2).join(" · ")}
        </td>
      </tr>
      {expanded && history.length > 1 && (
        <tr>
          <td colSpan={5} style={{ padding: "0 8px 8px 24px" }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-dim)" }}>
                  <th style={{ textAlign: "left", padding: "2px 6px" }}>Time</th>
                  <th style={{ textAlign: "right", padding: "2px 6px" }}>Health</th>
                  <th style={{ textAlign: "right", padding: "2px 6px" }}>Win%</th>
                  <th style={{ textAlign: "right", padding: "2px 6px" }}>PF</th>
                  <th style={{ textAlign: "right", padding: "2px 6px" }}>MaxDD</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map((h) => (
                  <tr key={h.id} style={{ borderBottom: "1px solid var(--border-dim)" }}>
                    <td style={{ padding: "2px 6px", color: "var(--text-dim)" }}>
                      {new Date(h.calculatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "2px 6px", textAlign: "right", color: healthColor(h.healthScore), fontWeight: 600 }}>
                      {h.healthScore.toFixed(0)}
                    </td>
                    <td style={{ padding: "2px 6px", textAlign: "right" }}>
                      {h.winRate !== null ? `${(h.winRate * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td style={{ padding: "2px 6px", textAlign: "right" }}>
                      {h.profitFactor !== null ? h.profitFactor.toFixed(2) : "—"}
                    </td>
                    <td style={{ padding: "2px 6px", textAlign: "right" }}>
                      {h.maxDrawdown !== null ? `${(h.maxDrawdown * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export function HealthTrendPanel({ snapshots, deploymentNames }: Props) {
  const byDeployment = new Map<string, HealthSnapshot[]>();
  for (const s of snapshots) {
    const existing = byDeployment.get(s.deploymentId) ?? [];
    existing.push(s);
    byDeployment.set(s.deploymentId, existing);
  }

  if (byDeployment.size === 0) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Health Trends</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No health history yet. Multiple analysis runs required to show trends.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Health Trends</h3>
      <p style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 8 }}>
        Click a row to expand snapshot history.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Deployment</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Latest</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Change</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Snapshots</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Recent Reasons</th>
            </tr>
          </thead>
          <tbody>
            {[...byDeployment.entries()].map(([deploymentId, history]) => {
              const name = deploymentNames?.get(deploymentId) ?? deploymentId.slice(0, 8);
              const sorted = [...history].sort(
                (a, b) => new Date(b.calculatedAt).getTime() - new Date(a.calculatedAt).getTime()
              );
              return (
                <HistoryRow key={deploymentId} deploymentId={deploymentId} name={name} history={sorted} />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
