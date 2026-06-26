import type { CorrelationRow } from "../../api/client.js";

interface Props {
  current: CorrelationRow[];
  history: CorrelationRow[];
  deploymentNames?: Map<string, string>;
}

function corrColor(c: number): string {
  const abs = Math.abs(c);
  if (abs >= 0.85) return "#ef4444";
  if (abs >= 0.7) return "#f59e0b";
  if (abs >= 0.4) return "#3b82f6";
  return "#22c55e";
}

function corrLabel(c: number): string {
  const abs = Math.abs(c);
  if (abs >= 0.85) return "VERY HIGH";
  if (abs >= 0.7) return "HIGH";
  if (abs >= 0.4) return "MODERATE";
  if (c < -0.3) return "NEGATIVE";
  return "LOW";
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("||");
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function CorrelationHistoryPanel({ current, history, deploymentNames }: Props) {
  if (current.length === 0 && history.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Correlation History</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No correlation data yet. Requires at least 2 deployments with paper trade data.
        </p>
      </div>
    );
  }

  // Build previous correlation map from history (second-most-recent per pair)
  const prevByPair = new Map<string, number>();
  const seenPairs = new Set<string>();
  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.calculatedAt).getTime() - new Date(a.calculatedAt).getTime()
  );
  for (const h of sortedHistory) {
    const k = pairKey(h.deploymentAId, h.deploymentBId);
    if (!seenPairs.has(k)) {
      prevByPair.set(k, h.correlation);
      seenPairs.add(k);
    }
  }

  const highWarnings = current.filter((c) => Math.abs(c.correlation) >= 0.7);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 8 }}>Correlation History</h3>

      {highWarnings.length > 0 && (
        <div
          style={{
            background: "#f59e0b22",
            border: "1px solid #f59e0b55",
            borderRadius: 6,
            padding: "6px 10px",
            marginBottom: 12,
            fontSize: 12,
            color: "#f59e0b",
          }}
        >
          {highWarnings.length} high-correlation pair{highWarnings.length !== 1 ? "s" : ""} detected —
          diversification benefit may be limited.
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Pair</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Current</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Previous</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Δ</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Level</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>As of</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {current.map((c) => {
              const nameA = deploymentNames?.get(c.deploymentAId) ?? c.deploymentAId.slice(0, 8);
              const nameB = deploymentNames?.get(c.deploymentBId) ?? c.deploymentBId.slice(0, 8);
              const k = pairKey(c.deploymentAId, c.deploymentBId);
              const prev = prevByPair.get(k);
              const diff = prev !== undefined ? c.correlation - prev : null;
              const color = corrColor(c.correlation);

              return (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border-dim)" }}>
                  <td style={{ padding: "4px 8px", fontWeight: 500, fontSize: 12 }}>
                    {nameA} / {nameB}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color, fontWeight: 700 }}>
                    {c.correlation.toFixed(3)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {prev !== undefined ? prev.toFixed(3) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    {diff !== null ? (
                      <span style={{ color: diff > 0.05 ? "#ef4444" : diff < -0.05 ? "#22c55e" : "var(--text-dim)" }}>
                        {diff >= 0 ? "+" : ""}{diff.toFixed(3)}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <span style={{ color, fontSize: 11, fontWeight: 600 }}>{corrLabel(c.correlation)}</span>
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)", fontSize: 11 }}>
                    {fmtDate(c.calculatedAt)}
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--text-dim)", fontSize: 11, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.recommendation}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {history.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
          Based on {history.length} historical correlation record{history.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
