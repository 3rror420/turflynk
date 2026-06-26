import type { HealthSnapshot } from "../../api/client.js";

interface Props {
  snapshots: HealthSnapshot[];
  deploymentNames?: Map<string, string>;
}

function healthColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 45) return "#f59e0b";
  return "#ef4444";
}

export function HealthTable({ snapshots, deploymentNames }: Props) {
  if (snapshots.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Deployment Health</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No health snapshots. Run analysis to score deployments.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Deployment Health</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Deployment</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Health</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Win%</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>PF</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Max DD</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Recent DD</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Regime Match</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Val Score</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Trades</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((h) => {
              const name = deploymentNames?.get(h.deploymentId) ?? h.deploymentId.slice(0, 8);
              const color = healthColor(h.healthScore);
              return (
                <tr key={h.id} style={{ borderBottom: "1px solid var(--border-dim)" }}>
                  <td style={{ padding: "4px 8px", fontWeight: 500 }} title={h.deploymentId}>
                    {name}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <span style={{ color, fontWeight: 700 }}>{h.healthScore.toFixed(0)}</span>
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {h.winRate !== null ? `${(h.winRate * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {h.profitFactor !== null ? h.profitFactor.toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {h.maxDrawdown !== null ? `${(h.maxDrawdown * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td
                    style={{
                      padding: "4px 8px",
                      textAlign: "right",
                      color: h.recentDrawdown !== null && h.recentDrawdown > 0.15 ? "#ef4444" : undefined,
                    }}
                  >
                    {h.recentDrawdown !== null ? `${(h.recentDrawdown * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {h.regimeMatchScore !== null ? h.regimeMatchScore.toFixed(0) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {h.validationScore !== null ? h.validationScore.toFixed(1) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{h.recentTradeCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
