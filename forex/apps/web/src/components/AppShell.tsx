import { NavLink, Outlet } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.js";
import type { SystemMode } from "../state/AppStateContext.js";
import { useAuth } from "../state/AuthContext.js";
import { AccountSelector } from "./AccountSelector.js";
import { ModeBadge } from "./ModeBadge.js";
import { LiveWarningBanner } from "./LiveWarningBanner.js";

// `adminOnly` items are hidden from viewers. Viewers still see (read-only) pages;
// mutating actions on those pages are rejected by the API with 403.
const navItems: Array<{ to: string; label: string; adminOnly?: boolean }> = [
  { to: "/", label: "Dashboard" },
  { to: "/accounts", label: "Accounts" },
  { to: "/broker-connection", label: "Broker Connection" },
  { to: "/manual-demo-order", label: "Manual Demo Order", adminOnly: true },
  { to: "/practice-position-manager", label: "Practice Position Manager", adminOnly: true },
  { to: "/paper-trading", label: "Paper Trading" },
  { to: "/paper-trading/wizard", label: "Paper Portfolio Wizard" },
  { to: "/paper-trading/leaderboard", label: "Paper Leaderboard" },
  { to: "/strategies", label: "Strategies" },
  { to: "/strategy-manager", label: "Strategy Manager" },
  { to: "/backtester", label: "Backtester" },
  { to: "/backtest-history", label: "Backtest History" },
  { to: "/backtest-comparison", label: "Backtest Comparison" },
  { to: "/optimizer", label: "Optimizer" },
  { to: "/validation", label: "Validation" },
  { to: "/research", label: "Research Dashboard" },
  { to: "/research/leaderboard", label: "Validation Leaderboard" },
  { to: "/research/candidates", label: "Candidates" },
  { to: "/research/compare", label: "Compare Validations" },
  { to: "/ranking", label: "Ranking" },
  { to: "/research-review", label: "Research Review" },
  { to: "/risk-controls", label: "Risk Controls" },
  { to: "/market-data", label: "Market Data" },
  { to: "/indicator-library", label: "Analysis Library" },
  { to: "/portfolio-intelligence", label: "Portfolio Intelligence" },
  { to: "/logs", label: "Logs" },
  { to: "/users", label: "Users", adminOnly: true },
  { to: "/audit-logs", label: "Audit Log", adminOnly: true },
];

const modes: SystemMode[] = ["BACKTEST", "DEMO", "LIVE"];

export function AppShell() {
  const { mode, setMode } = useAppState();
  const { user, isAdmin, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <p className="sidebar-title">Forex System</p>
        {navItems
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
      </aside>
      <div className="main-area">
        <header className="topbar">
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as SystemMode)}>
            {modes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <ModeBadge />
          <div className="topbar-spacer" />
          <AccountSelector />
          <span style={{ fontSize: 12, color: "var(--text-dim)", marginLeft: 12 }}>
            {user?.username} ({user?.role})
          </span>
          <button className="btn-primary" type="button" onClick={() => void logout()} style={{ marginLeft: 8 }}>
            Logout
          </button>
        </header>
        <LiveWarningBanner />
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
