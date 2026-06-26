import type { CorrelationRow } from "../../api/client.js";

interface Props {
  correlations: CorrelationRow[];
  deploymentNames?: Map<string, string>;
}

function corrColor(c: number): string {
  if (c > 0.8) return "#ef4444";
  if (c > 0.5) return "#f59e0b";
  if (c < -0.3) return "#22c55e";
  return "#60a5fa";
}

export function CorrelationMatrix({ correlations, deploymentNames }: Props) {
  if (correlations.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Correlation Matrix</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No correlation data. Need ≥ 2 deployments and run analysis.
        </p>
      </div>
    );
  }

  const highCorr = correlations.filter((c) => c.correlation > 0.7);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>Deployment Correlation</h3>
      {highCorr.length > 0 && (
        <p style={{ color: "#f59e0b", fontSize: 12, marginBottom: 8 }}>
          ⚠ {highCorr.length} high-correlation pair{highCorr.length > 1 ? "s" : ""} detected
        </p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Deployment A</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Deployment B</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Correlation</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Overlap</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Samples</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {correlations.map((c) => {
              const nameA = deploymentNames?.get(c.deploymentAId) ?? c.deploymentAId.slice(0, 8);
              const nameB = deploymentNames?.get(c.deploymentBId) ?? c.deploymentBId.slice(0, 8);
              const color = corrColor(c.correlation);
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border-dim)" }}>
                  <td style={{ padding: "4px 8px", fontWeight: 500 }} title={c.deploymentAId}>
                    {nameA}
                  </td>
                  <td style={{ padding: "4px 8px", fontWeight: 500 }} title={c.deploymentBId}>
                    {nameB}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <span style={{ color, fontWeight: 700 }}>{c.correlation.toFixed(3)}</span>
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {(c.overlapScore * 100).toFixed(0)}%
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {c.lookbackTrades}d
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--text-dim)", fontSize: 11 }}>
                    {c.recommendation.slice(0, 80)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
