import type { RegimeSnapshot } from "../../api/client.js";

interface Props {
  regimes: RegimeSnapshot[];
}

const REGIME_COLORS: Record<string, string> = {
  TRENDING: "#3b82f6",
  STRONG_TREND: "#1d4ed8",
  WEAK_TREND: "#93c5fd",
  RANGING: "#a855f7",
  HIGH_VOLATILITY: "#ef4444",
  LOW_VOLATILITY: "#22c55e",
  BREAKOUT: "#f59e0b",
  MEAN_REVERSION_FRIENDLY: "#10b981",
  UNKNOWN: "#6b7280",
};

function confidenceBadge(confidence: number): string {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "med";
  return "low";
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

export function RegimeTimeline({ regimes }: Props) {
  if (regimes.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Regime Timeline</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No regime data yet. Run analysis to detect market regimes.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Regime Timeline</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Symbol / TF</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Regime</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Conf</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Trend</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Vol</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Candle</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Detected</th>
            </tr>
          </thead>
          <tbody>
            {regimes.map((r) => {
              const color = REGIME_COLORS[r.regime] ?? "#6b7280";
              const badge = confidenceBadge(r.confidence);
              const badgeColor =
                badge === "high" ? "#22c55e" : badge === "med" ? "#f59e0b" : "#6b7280";
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border-dim)" }}>
                  <td style={{ padding: "4px 8px", fontWeight: 500 }}>
                    {r.symbol} <span style={{ color: "var(--text-dim)" }}>{r.granularity}</span>
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <span
                      style={{
                        background: `${color}22`,
                        color,
                        border: `1px solid ${color}55`,
                        borderRadius: 4,
                        padding: "1px 6px",
                        fontSize: 11,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.regime}
                    </span>
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <span style={{ color: badgeColor, fontSize: 11 }}>
                      {(r.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {r.trendStrength !== null ? r.trendStrength.toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {r.volatilityScore !== null ? r.volatilityScore.toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {fmtDate(r.candleTime)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--text-dim)" }}>
                    {fmtDate(r.detectedAt)}
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
