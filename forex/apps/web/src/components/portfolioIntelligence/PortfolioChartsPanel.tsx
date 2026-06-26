import type { PortfolioSnapshot } from "../../api/client.js";

interface Props {
  snapshots: PortfolioSnapshot[];
}

const W = 600;
const H = 120;
const PAD = { top: 8, right: 8, bottom: 24, left: 52 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function toPoints(values: number[], min: number, max: number): string {
  if (values.length === 0) return "";
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = PAD.left + (i / Math.max(values.length - 1, 1)) * INNER_W;
      const y = PAD.top + INNER_H - ((v - min) / range) * INNER_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function yLabel(v: number, decimals = 0): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(decimals);
}

interface MiniChartProps {
  label: string;
  values: number[];
  color: string;
  format?: (v: number) => string;
  invertColors?: boolean;
}

function MiniChart({ label, values, color, format, invertColors }: MiniChartProps) {
  if (values.length === 0) {
    return (
      <div className="card" style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>No data yet</div>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = toPoints(values, min, max);
  const areaBottom = PAD.top + INNER_H;
  const firstX = PAD.left;
  const lastX = PAD.left + INNER_W;
  const firstY = PAD.top + INNER_H - ((values[0] - min) / (max - min || 1)) * INNER_H;
  const lastY = PAD.top + INNER_H - ((values[values.length - 1] - min) / (max - min || 1)) * INNER_H;
  const area = `M ${firstX},${areaBottom} L ${pts.replace(/,/g, " L ").split(" ").slice(0).join(" ")} L ${lastX},${areaBottom} Z`;

  const latest = values[values.length - 1];
  const prev = values.length > 1 ? values[values.length - 2] : latest;
  const up = latest >= prev;
  const trendColor = invertColors ? (up ? "#ef4444" : "#22c55e") : (up ? "#22c55e" : "#ef4444");
  const displayColor = values.length > 1 && latest !== prev ? trendColor : color;

  return (
    <div className="card" style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: displayColor }}>
          {format ? format(latest) : yLabel(latest, 2)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }}>
        <path d={area} fill={color} fillOpacity={0.12} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize={9} fill="var(--text-dim)">
          {format ? format(max) : yLabel(max, 2)}
        </text>
        <text x={PAD.left - 4} y={areaBottom} textAnchor="end" fontSize={9} fill="var(--text-dim)">
          {format ? format(min) : yLabel(min, 2)}
        </text>
        <line x1={PAD.left} y1={areaBottom} x2={lastX} y2={areaBottom} stroke="var(--border)" strokeWidth={0.5} />
        {values.length > 1 && (
          <circle cx={lastX} cy={lastY} r={3} fill={displayColor} />
        )}
        {values.length === 1 && (
          <circle cx={firstX} cy={firstY} r={3} fill={color} />
        )}
      </svg>
      <div style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "right" }}>
        {values.length} data point{values.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export function PortfolioChartsPanel({ snapshots }: Props) {
  const ordered = [...snapshots].reverse();

  const equity = ordered.map((s) => s.equity ?? 0);
  const drawdown = ordered.map((s) => (s.drawdown ?? 0) * 100);
  const activeDeps = ordered.map((s) => s.activeDeploymentCount);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Portfolio History Charts</h3>
      {snapshots.length === 0 ? (
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No snapshot history yet. Run analysis to start building historical data.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <MiniChart
            label="Portfolio Equity"
            values={equity}
            color="#3b82f6"
            format={(v) => `$${yLabel(v, 0)}`}
          />
          <MiniChart
            label="Drawdown %"
            values={drawdown}
            color="#ef4444"
            format={(v) => `${v.toFixed(1)}%`}
            invertColors
          />
          <MiniChart
            label="Active Deployments"
            values={activeDeps}
            color="#a855f7"
            format={(v) => String(Math.round(v))}
          />
        </div>
      )}
    </div>
  );
}
