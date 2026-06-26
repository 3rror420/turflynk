import type { AllocationRecommendation } from "../../api/client.js";

interface Props {
  allocations: AllocationRecommendation[];
  deploymentNames?: Map<string, string>;
}

export function AllocationTable({ allocations, deploymentNames }: Props) {
  if (allocations.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Allocation Recommendations</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No allocation data. Run analysis to generate recommendations.
        </p>
      </div>
    );
  }

  const total = allocations.reduce((s, a) => s + a.recommendedWeight, 0);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>Allocation Recommendations</h3>
      <p style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 12 }}>
        Recommendation only — does not move money or modify broker settings.
        Total allocated: {(total * 100).toFixed(1)}%
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Deployment</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Rec. Weight</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Raw Score</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Reasons</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => {
              const name = deploymentNames?.get(a.deploymentId) ?? a.deploymentId.slice(0, 8);
              const pct = (a.recommendedWeight * 100).toFixed(1);
              return (
                <tr key={a.id} style={{ borderBottom: "1px solid var(--border-dim)" }}>
                  <td style={{ padding: "4px 8px", fontWeight: 500 }} title={a.deploymentId}>
                    {name}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700 }}>
                    {pct}%
                    <span
                      style={{
                        display: "inline-block",
                        marginLeft: 6,
                        width: `${Math.max(4, a.recommendedWeight * 80)}px`,
                        height: 8,
                        background: "#3b82f6",
                        borderRadius: 2,
                        verticalAlign: "middle",
                      }}
                    />
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {(a.rawScore * 100).toFixed(1)}
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--text-dim)", fontSize: 11 }}>
                    {a.reasons.slice(0, 2).join(" · ")}
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
