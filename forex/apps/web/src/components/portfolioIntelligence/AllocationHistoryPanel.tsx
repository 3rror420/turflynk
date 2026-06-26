import type { AllocationRecommendation } from "../../api/client.js";

interface Props {
  allocations: AllocationRecommendation[];
  deploymentNames?: Map<string, string>;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function diffColor(current: number, prev: number): string {
  const diff = current - prev;
  if (diff > 0.005) return "#22c55e";
  if (diff < -0.005) return "#ef4444";
  return "var(--text-dim)";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AllocationHistoryPanel({ allocations, deploymentNames }: Props) {
  if (allocations.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Allocation History</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No allocation history yet. Run analysis to generate recommendations.
        </p>
      </div>
    );
  }

  const byDeployment = new Map<string, AllocationRecommendation[]>();
  for (const a of allocations) {
    const arr = byDeployment.get(a.deploymentId) ?? [];
    arr.push(a);
    byDeployment.set(a.deploymentId, arr);
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>Allocation History</h3>
      <p style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 12 }}>
        Visualization only — no allocations are applied automatically.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Deployment</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Latest %</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Previous %</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Δ</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Snapshots</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>As of</th>
            </tr>
          </thead>
          <tbody>
            {[...byDeployment.entries()].map(([deploymentId, history]) => {
              const sorted = [...history].sort(
                (a, b) => new Date(b.calculatedAt).getTime() - new Date(a.calculatedAt).getTime()
              );
              const latest = sorted[0];
              const prev = sorted[1];
              const name = deploymentNames?.get(deploymentId) ?? deploymentId.slice(0, 8);
              const diff = prev ? latest.recommendedWeight - prev.recommendedWeight : null;
              return (
                <tr key={deploymentId} style={{ borderBottom: "1px solid var(--border-dim)" }}>
                  <td style={{ padding: "4px 8px", fontWeight: 500 }} title={deploymentId}>
                    {name}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600 }}>
                    {pct(latest.recommendedWeight)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {prev ? pct(prev.recommendedWeight) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {diff !== null ? (
                      <span style={{ color: diffColor(latest.recommendedWeight, prev!.recommendedWeight) }}>
                        {diff >= 0 ? "+" : ""}{pct(diff)}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)", fontSize: 12 }}>
                    {history.length}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)", fontSize: 11 }}>
                    {fmtDate(latest.calculatedAt)}
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
