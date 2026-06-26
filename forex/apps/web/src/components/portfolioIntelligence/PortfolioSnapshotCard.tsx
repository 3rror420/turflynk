import type { PortfolioSnapshot } from "../../api/client.js";

interface Props {
  snapshot: PortfolioSnapshot | null;
}

function fmt(value: number | null | undefined, decimals = 2, suffix = ""): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(decimals)}${suffix}`;
}

export function PortfolioSnapshotCard({ snapshot }: Props) {
  if (!snapshot) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Portfolio Snapshot</h3>
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No snapshot yet. Run analysis to generate a portfolio overview.
        </p>
      </div>
    );
  }

  const regimeSummary = snapshot.regimeSummary as {
    counts?: Record<string, number>;
    dominant?: string;
    total?: number;
  };
  const allocationSummary = snapshot.allocationSummary as {
    deploymentCount?: number;
    totalAllocated?: number;
    maxWeight?: number;
  };
  const riskSummary = snapshot.riskSummary as {
    activeRuns?: number;
    openPositions?: number;
    paperOnly?: boolean;
    note?: string;
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12 }}>Portfolio Snapshot</h3>
      {riskSummary.paperOnly && (
        <p
          style={{
            fontSize: 11,
            color: "#f59e0b",
            border: "1px solid #f59e0b44",
            borderRadius: 4,
            padding: "4px 8px",
            marginBottom: 12,
          }}
        >
          PAPER · SIMULATED · PRACTICE ONLY — no real capital at risk
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Equity</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{fmt(snapshot.equity, 2, " USD")}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Realized P&L</div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              color:
                snapshot.realizedPL === null
                  ? undefined
                  : snapshot.realizedPL >= 0
                    ? "#22c55e"
                    : "#ef4444",
            }}
          >
            {fmt(snapshot.realizedPL, 2, " USD")}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Unrealized P&L</div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              color:
                snapshot.unrealizedPL === null
                  ? undefined
                  : snapshot.unrealizedPL >= 0
                    ? "#22c55e"
                    : "#ef4444",
            }}
          >
            {fmt(snapshot.unrealizedPL, 2, " USD")}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Max Drawdown</div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              color: snapshot.drawdown !== null && snapshot.drawdown > 0.1 ? "#ef4444" : undefined,
            }}
          >
            {snapshot.drawdown !== null ? `${(snapshot.drawdown * 100).toFixed(1)}%` : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Active Deployments</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{snapshot.activeDeploymentCount}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Active Runs</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{riskSummary.activeRuns ?? "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Open Positions</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{riskSummary.openPositions ?? "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Dominant Regime</div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{regimeSummary.dominant ?? "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Total Allocated</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {allocationSummary.totalAllocated !== undefined
              ? `${(allocationSummary.totalAllocated * 100).toFixed(1)}%`
              : "—"}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 12 }}>
        Calculated {new Date(snapshot.calculatedAt).toLocaleString()}
      </div>
    </div>
  );
}
