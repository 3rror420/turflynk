import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { Login } from "./pages/Login.js";
import { AuditLogs } from "./pages/AuditLogs.js";
import { useAuth } from "./state/AuthContext.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Accounts } from "./pages/Accounts.js";
import { BrokerConnection } from "./pages/BrokerConnection.js";
import { ManualDemoOrder } from "./pages/ManualDemoOrder.js";
import { PracticePositionManager } from "./pages/PracticePositionManager.js";
import { PaperTrading } from "./pages/PaperTrading.js";
import { PaperPortfolioWizard } from "./pages/PaperPortfolioWizard.js";
import { PaperLeaderboard } from "./pages/PaperLeaderboard.js";
import { Strategies } from "./pages/Strategies.js";
import { StrategyManager } from "./pages/StrategyManager.js";
import { Backtester } from "./pages/Backtester.js";
import { BacktestHistory } from "./pages/BacktestHistory.js";
import { BacktestRunDetail } from "./pages/BacktestRunDetail.js";
import { BacktestComparison } from "./pages/BacktestComparison.js";
import { Optimizer } from "./pages/Optimizer.js";
import { Validation } from "./pages/Validation.js";
import { ResearchDashboard } from "./pages/ResearchDashboard.js";
import { ValidationLeaderboard } from "./pages/ValidationLeaderboard.js";
import { ResearchCandidates } from "./pages/ResearchCandidates.js";
import { ValidationCompare } from "./pages/ValidationCompare.js";
import { RankingPage } from "./pages/RankingPage.js";
import { ResearchReviewPage } from "./pages/ResearchReviewPage.js";
import { RiskControls } from "./pages/RiskControls.js";
import { MarketData } from "./pages/MarketData.js";
import { IndicatorLibrary } from "./pages/IndicatorLibrary.js";
import { Logs } from "./pages/Logs.js";
import { Users } from "./pages/Users.js";
import { PortfolioIntelligence } from "./pages/PortfolioIntelligence.js";

export function App() {
  const { user, loading, isAdmin } = useAuth();

  // Wait for the initial session check before deciding what to render.
  if (loading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Loading…</div>;
  }

  // No session → only the login screen is reachable.
  if (!user) {
    return <Login />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="broker-connection" element={<BrokerConnection />} />
        <Route path="manual-demo-order" element={<ManualDemoOrder />} />
        <Route path="practice-position-manager" element={<PracticePositionManager />} />
        <Route path="paper-trading" element={<PaperTrading />} />
        <Route path="paper-trading/wizard" element={<PaperPortfolioWizard />} />
        <Route path="paper-trading/leaderboard" element={<PaperLeaderboard />} />
        <Route path="strategies" element={<Strategies />} />
        <Route path="strategy-manager" element={<StrategyManager />} />
        <Route path="backtester" element={<Backtester />} />
        <Route path="backtest-history" element={<BacktestHistory />} />
        <Route path="backtest-runs/:id" element={<BacktestRunDetail />} />
        <Route path="backtest-comparison" element={<BacktestComparison />} />
        <Route path="optimizer" element={<Optimizer />} />
        <Route path="validation" element={<Validation />} />
        <Route path="research" element={<ResearchDashboard />} />
        <Route path="research/leaderboard" element={<ValidationLeaderboard />} />
        <Route path="research/candidates" element={<ResearchCandidates />} />
        <Route path="research/compare" element={<ValidationCompare />} />
        <Route path="ranking" element={<RankingPage />} />
        <Route path="research-review" element={<ResearchReviewPage />} />
        <Route path="risk-controls" element={<RiskControls />} />
        <Route path="market-data" element={<MarketData />} />
        <Route path="indicator-library" element={<IndicatorLibrary />} />
        <Route path="logs" element={<Logs />} />
        <Route path="portfolio-intelligence" element={<PortfolioIntelligence />} />
        {isAdmin && <Route path="users" element={<Users />} />}
        {isAdmin && <Route path="audit-logs" element={<AuditLogs />} />}
      </Route>
    </Routes>
  );
}
