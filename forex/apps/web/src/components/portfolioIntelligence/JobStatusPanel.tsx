import { useState, useEffect } from "react";
import type { SchedulerStatus, IntelligenceJob, JobStatus, Freshness } from "../../api/client.js";
import { apiClient } from "../../api/client.js";

interface Props {
  schedulerStatus: SchedulerStatus | null;
  onRefresh?: () => void;
}

const STATUS_COLOR: Record<JobStatus, string> = {
  COMPLETED: "#22c55e",
  RUNNING: "#60a5fa",
  FAILED: "#ef4444",
  SKIPPED: "#f59e0b",
};

const FRESHNESS_COLOR: Record<Freshness, string> = {
  FRESH: "#22c55e",
  STALE: "#f59e0b",
  UNKNOWN: "var(--text-dim)",
};

const FRESHNESS_LABEL: Record<Freshness, string> = {
  FRESH: "Fresh",
  STALE: "Stale",
  UNKNOWN: "Unknown",
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export function JobStatusPanel({ schedulerStatus, onRefresh }: Props) {
  const [jobs, setJobs] = useState<IntelligenceJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setLoadingJobs(true);
    apiClient
      .getIntelligenceJobHistory(10)
      .then(setJobs)
      .catch(() => setJobs([]))
      .finally(() => setLoadingJobs(false));
  }, [schedulerStatus]);

  const freshness = schedulerStatus?.freshness ?? "UNKNOWN";
  const latestJob = jobs[0] ?? null;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Analysis Status</h3>

        {/* Freshness badge */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: FRESHNESS_COLOR[freshness],
            background: `${FRESHNESS_COLOR[freshness]}22`,
            border: `1px solid ${FRESHNESS_COLOR[freshness]}44`,
            borderRadius: 4,
            padding: "1px 7px",
          }}
        >
          {FRESHNESS_LABEL[freshness]}
        </span>

        {/* Scheduler badge */}
        {schedulerStatus && (
          <span
            style={{
              fontSize: 11,
              color: schedulerStatus.enabled ? "#22c55e" : "var(--text-dim)",
              background: schedulerStatus.enabled ? "#22c55e22" : "var(--surface-raised)",
              border: `1px solid ${schedulerStatus.enabled ? "#22c55e44" : "var(--border)"}`,
              borderRadius: 4,
              padding: "1px 7px",
            }}
          >
            {schedulerStatus.enabled
              ? `Auto every ${schedulerStatus.intervalMinutes}m`
              : "Manual only"}
          </span>
        )}

        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: 11, padding: "1px 8px", marginLeft: "auto" }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide history" : "Show history"}
        </button>
        {onRefresh && (
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: 11, padding: "1px 8px" }}
            onClick={onRefresh}
          >
            Refresh
          </button>
        )}
      </div>

      {/* Latest job summary row */}
      <div style={{ display: "flex", gap: 24, fontSize: 12, color: "var(--text-dim)", flexWrap: "wrap" }}>
        {schedulerStatus?.latestCompletedJob ? (
          <>
            <span>
              Last completed:{" "}
              <span style={{ color: "var(--text)" }}>
                {timeAgo(schedulerStatus.latestCompletedJob.finishedAt)}
              </span>
            </span>
            <span>
              Trigger:{" "}
              <span style={{ color: "var(--text)" }}>
                {schedulerStatus.latestCompletedJob.trigger}
              </span>
            </span>
            <span>
              Duration:{" "}
              <span style={{ color: "var(--text)" }}>
                {formatDuration(schedulerStatus.latestCompletedJob.durationMs)}
              </span>
            </span>
          </>
        ) : (
          <span>No completed analysis run yet.</span>
        )}

        {schedulerStatus?.enabled && schedulerStatus.nextRunAt && (
          <span>
            Next auto-run:{" "}
            <span style={{ color: "var(--text)" }}>{timeAgo(schedulerStatus.nextRunAt).replace("ago", "from now")}</span>
          </span>
        )}

        {latestJob?.status === "RUNNING" && (
          <span style={{ color: "#60a5fa", fontWeight: 600 }}>Analysis running…</span>
        )}
      </div>

      {/* Latest job FAILED warning */}
      {latestJob?.status === "FAILED" && latestJob.errorMessage && (
        <div
          style={{
            marginTop: 8,
            background: "#ef444422",
            border: "1px solid #ef444466",
            borderRadius: 4,
            padding: "4px 10px",
            fontSize: 12,
            color: "#ef4444",
          }}
        >
          Last job failed: {latestJob.errorMessage}
        </div>
      )}

      {/* Expanded job history */}
      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
            Recent runs
          </div>
          {loadingJobs ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading…</div>
          ) : jobs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>No runs recorded yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
                  <th style={{ padding: "2px 8px 4px 0" }}>Status</th>
                  <th style={{ padding: "2px 8px 4px 0" }}>Trigger</th>
                  <th style={{ padding: "2px 8px 4px 0" }}>Started</th>
                  <th style={{ padding: "2px 8px 4px 0" }}>Duration</th>
                  <th style={{ padding: "2px 0 4px 0" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "3px 8px 3px 0" }}>
                      <span style={{ color: STATUS_COLOR[j.status], fontWeight: 600 }}>
                        {j.status}
                      </span>
                    </td>
                    <td style={{ padding: "3px 8px 3px 0", color: "var(--text-dim)" }}>{j.trigger}</td>
                    <td style={{ padding: "3px 8px 3px 0", color: "var(--text-dim)" }}>
                      {formatTime(j.startedAt)}
                    </td>
                    <td style={{ padding: "3px 8px 3px 0", color: "var(--text-dim)" }}>
                      {formatDuration(j.durationMs)}
                    </td>
                    <td style={{ padding: "3px 0", color: "var(--text-dim)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.errorMessage
                        ? <span style={{ color: "#ef4444" }}>{j.errorMessage}</span>
                        : j.status === "COMPLETED" && j.summary.deploymentsScored !== undefined
                        ? `${String(j.summary.deploymentsScored)} scored · ${String(j.summary.recommendationsGenerated ?? 0)} recs`
                        : j.status === "SKIPPED"
                        ? "Run already in progress"
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
