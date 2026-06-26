import type { RegimeSnapshot } from "../../api/client.js";

const REGIME_COLORS: Record<string, string> = {
  STRONG_TREND: "#22c55e",
  TRENDING: "#4ade80",
  BREAKOUT: "#f59e0b",
  WEAK_TREND: "#a3e635",
  RANGING: "#60a5fa",
  MEAN_REVERSION_FRIENDLY: "#818cf8",
  HIGH_VOLATILITY: "#ef4444",
  LOW_VOLATILITY: "#94a3b8",
  UNKNOWN: "#6b7280",
};

interface Props {
  regimes: RegimeSnapshot[];
}

export function RegimePanel({ regimes }: Props) {
  if (regimes.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Market Regimes</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No regime snapshots yet. Run analysis to classify current market conditions.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Market Regimes</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Symbol</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>TF</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Regime</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>ADX</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>ATR%ile</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Confidence</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {regimes.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border-dim)" }}>
                <td style={{ padding: "4px 8px", fontWeight: 600 }}>{r.symbol}</td>
                <td style={{ padding: "4px 8px", color: "var(--text-dim)" }}>{r.granularity}</td>
                <td style={{ padding: "4px 8px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "1px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      background: (REGIME_COLORS[r.regime] ?? "#6b7280") + "33",
                      color: REGIME_COLORS[r.regime] ?? "#6b7280",
                      border: `1px solid ${REGIME_COLORS[r.regime] ?? "#6b7280"}55`,
                    }}
                  >
                    {r.regime}
                  </span>
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right" }}>
                  {r.adx !== null ? r.adx.toFixed(1) : "—"}
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right" }}>
                  {r.atrPercentile !== null ? `${r.atrPercentile.toFixed(0)}th` : "—"}
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right" }}>
                  {(r.confidence * 100).toFixed(0)}%
                </td>
                <td style={{ padding: "4px 8px", color: "var(--text-dim)", fontSize: 11 }}>
                  {r.reasons[0] ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
