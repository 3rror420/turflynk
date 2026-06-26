const BASE_URL = "/api";

// Phase 12: when any API call returns 401 (session expired / logged out), notify the
// app so it can drop back to the login screen. AuthContext registers this handler.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}
function notifyIfUnauthorized(status: number): void {
  if (status === 401 && unauthorizedHandler) unauthorizedHandler();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    notifyIfUnauthorized(response.status);
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? body.error ?? `Request to ${path} failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export interface Account {
  id: string;
  name: string;
  broker: string;
  accountType: "DEMO" | "LIVE";
  environment: "demo" | "live";
  baseCurrency: string;
  accountNumber?: string;
  tradingEnabled: boolean;
  liveTradingArmed: boolean;
  maxDailyLoss: number;
  maxRiskPerTradePercent: number;
  maxOpenTrades: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigFieldSchema {
  type: "integer" | "number" | "boolean" | "enum";
  label?: string;
  description?: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<string | number>;
}

export interface StrategyConfigSchema {
  fields: Record<string, ConfigFieldSchema>;
}

export interface StrategySummary {
  id: string;
  name: string;
  description: string;
  defaultParams: Record<string, unknown>;
  /** Present on the DB-backed Phase 13 registry response; optional for back-compat. */
  version?: string;
  enabled?: boolean;
  configSchema?: StrategyConfigSchema;
}

export type SignalType = "BUY" | "SELL" | "CLOSE" | "HOLD";
export type SignalRiskStatus = "PENDING" | "ALLOWED" | "REJECTED" | "SKIPPED";
export type DeploymentStatus = "IDLE" | "RUNNING" | "ERROR";

export interface StrategyDeployment {
  id: string;
  strategyId: string;
  strategyConfigId?: string;
  name: string;
  instrument: string;
  timeframe: string;
  accountId?: string;
  params: Record<string, unknown>;
  riskProfileId: string;
  enabled: boolean;
  autopilot: boolean;
  status: DeploymentStatus;
  lastEvaluatedAt?: string;
  lastSignalAt?: string;
  errorMessage?: string;
  sourceType?: string;
  sourceResultId?: string;
  sourceSessionId?: string;
  sourceMetadata?: Record<string, unknown>;
  sourceLinkCreatedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Derived (read-only) — total signals recorded for this deployment, any type. */
  signalCount?: number;
  /** Derived (read-only) — timestamp of the most recent signal of any type (incl. HOLD). */
  lastSignalTime?: string;
}

export interface CreateStrategyDeploymentInput {
  strategyId?: string;
  strategyConfigId?: string;
  name: string;
  instrument?: string;
  timeframe?: string;
  accountId?: string;
  params?: Record<string, unknown>;
  riskProfileId?: string;
  enabled?: boolean;
  autopilot?: boolean;
}

export type UpdateStrategyDeploymentPatch = Partial<
  Pick<CreateStrategyDeploymentInput, "name" | "instrument" | "timeframe" | "accountId" | "params" | "riskProfileId">
>;

export interface StrategySignal {
  id: string;
  createdAt: string;
  deploymentId: string;
  strategyId: string;
  instrument: string;
  timeframe: string;
  candleTime?: string;
  signalType: SignalType;
  confidence?: number;
  indicators: Record<string, number>;
  explanation?: string;
  stopLoss?: number;
  takeProfit?: number;
  riskStatus: SignalRiskStatus;
  riskReason?: string;
  sizeUnits?: number;
  executed: boolean;
  executionId?: string;
}

export interface StrategyPerformance {
  deploymentId: string;
  strategyId: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  maxDrawdown: number;
  peakEquity: number;
  currentEquity: number;
  lastTradeAt?: string;
  updatedAt: string;
}

// --- Phase 17.0: Forward/Paper Trading Ledger (practice-only simulation) ---

export type PaperRunStatus = "ACTIVE" | "PAUSED" | "STOPPED";
export type PaperResultingAction = "OPENED" | "CLOSED" | "REVERSED" | "SKIPPED" | "NONE";
export type PaperTradeExitReason = "STOP_LOSS" | "TAKE_PROFIT" | "STRATEGY_CLOSE" | "OPPOSITE_SIGNAL" | "RUN_STOPPED";

export interface PaperRun {
  id: string;
  deploymentId: string;
  strategyId: string;
  instrument: string;
  timeframe: string;
  params: Record<string, unknown>;
  riskProfileId: string;
  candleSource: string;
  status: PaperRunStatus;
  startingBalance: number;
  realizedPL: number;
  unrealizedPL: number;
  currentEquity: number;
  peakEquity: number;
  maxDrawdown: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  signalCount: number;
  allowedCount: number;
  rejectedCount: number;
  sourceType?: string;
  sourceResultId?: string;
  lastCandleTime?: string;
  lastTickAt?: string;
  lastError?: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  updatedAt: string;
}

export interface CreatePaperRunInput {
  deploymentId: string;
  startingBalance?: number;
  allowDuplicateActive?: boolean;
}

export interface PaperPosition {
  id: string;
  runId: string;
  deploymentId: string;
  instrument: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  entryTime: string;
  stopLoss?: number;
  takeProfit?: number;
  sizeUnits: number;
  unrealizedPL: number;
  lastMarkPrice?: number;
  openedDecisionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaperTrade {
  id: string;
  runId: string;
  deploymentId: string;
  positionId: string;
  instrument: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  entryTime: string;
  exitPrice: number;
  exitTime: string;
  sizeUnits: number;
  stopLoss?: number;
  takeProfit?: number;
  realizedPL: number;
  exitReason: PaperTradeExitReason;
  openedDecisionId?: string;
  closedDecisionId?: string;
  createdAt: string;
}

export interface PaperRiskExplanation {
  accountBalanceUsed: number;
  riskProfileId: string;
  riskPercent: number;
  maxRiskAmount: number;
  sizingModel: "LEGACY_FIXED_FRACTIONAL" | "PAPER_FOREX_GUARDRAILS_V1";
  sizingDecision: "ALLOWED" | "CAPPED" | "REJECTED";
  instrument: string;
  side?: "BUY" | "SELL";
  pricingBasisPrice?: number;
  entryPrice?: number;
  stopLossPrice?: number;
  stopDistance?: number;
  stopDistancePips?: number;
  entryToStopDistance?: number;
  entryToStopDistancePips?: number;
  pipSize: number;
  pipValueAssumption: number;
  rawUnits?: number;
  rawRiskBasedUnits?: number;
  computedUnits?: number;
  minimumUnits?: number;
  minimumApplied: boolean;
  maxUnitsCap?: number;
  maxNotionalPct?: number;
  maxAllowedNotional?: number;
  rawNotionalEstimate?: number;
  notionalEstimate?: number;
  leverageAssumption?: number;
  estimatedMarginRequired?: number;
  maxAllowedMargin?: number;
  notionalUnitsCap?: number;
  marginUnitsCap?: number;
  minStopDistancePips?: number;
  maxStopDistancePips?: number;
  capApplied: boolean;
  capReason?: string;
  finalUnits?: number;
  riskEngineStatus: SignalRiskStatus;
  riskEngineReason?: string;
  formula: string;
  guardrails?: {
    maxUnits: number;
    maxLeverage: number;
    maxNotionalPct: number;
    minStopDistancePips: number;
    maxStopDistancePips: number;
    pipValueAssumption: number;
  };
  warnings: string[];
}

export interface PaperDecision {
  id: string;
  runId: string;
  deploymentId: string;
  createdAt: string;
  candleTime: string;
  signalType: SignalType;
  confidence?: number;
  indicators: Record<string, number>;
  explanation?: string;
  stopLoss?: number;
  takeProfit?: number;
  riskStatus: SignalRiskStatus;
  riskReason?: string;
  sizeUnits?: number;
  riskExplanation?: PaperRiskExplanation;
  resultingAction: PaperResultingAction;
  positionId?: string;
  tradeId?: string;
}

export interface PaperEquitySnapshot {
  id: string;
  runId: string;
  createdAt: string;
  candleTime: string;
  equity: number;
  realizedPL: number;
  unrealizedPL: number;
  drawdown: number;
}

export interface PaperTradingWorkerStatus {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  activeRuns: number;
  lastPollAt?: string;
  lastError?: string;
}

export interface PaperTickResult {
  runId: string;
  paperOnly: true;
  status: "ADVANCED" | "NO_NEW_CANDLE" | "SKIPPED" | "ERROR";
  message: string;
  processedCandleCount: number;
  advancedCandle: boolean;
  noNewerCandle: boolean;
  openedCount: number;
  closedCount: number;
  decisionCount: number;
  lastProcessedCandleTime?: string;
  lastTickAt?: string;
  runStatus?: PaperRunStatus;
  error?: string;
}

export interface PaperRunHealth {
  granularityMs?: number;
  lastTickAt?: string;
  lastProcessedCandleTime?: string;
  nextExpectedCandleTime?: string;
  waitingForNewCandle: boolean;
  tickLagMs?: number;
  staleThresholdMs: number;
  isTickStale: boolean;
  staleReason?: string;
  lastTickResult?: PaperTickResult;
}

export interface PaperRunDashboardSummary extends PaperRun {
  deploymentName?: string;
  deploymentEnabled?: boolean;
  deploymentAutopilot?: boolean;
  openPositionCount: number;
  closedTradeCount: number;
  latestDecision?: {
    id: string;
    signalType: SignalType;
    reason?: string;
    riskStatus: SignalRiskStatus;
    riskReason?: string;
    resultingAction: PaperResultingAction;
    candleTime: string;
    createdAt: string;
  };
  health: PaperRunHealth;
  practiceLabel: string;
}

export type PaperSizingPolicy = "LEGACY_FIXED_FRACTIONAL" | "PAPER_FOREX_GUARDRAILS_V1" | "UNKNOWN";

export interface PaperLeaderboardRow {
  runId: string;
  deploymentId: string;
  deploymentName?: string;
  deploymentEnabled?: boolean;
  deploymentAutopilot?: boolean;
  strategyId: string;
  instrument: string;
  timeframe: string;
  riskProfileId: string;
  status: PaperRunStatus;
  sizingPolicy: PaperSizingPolicy;
  sourceType?: string;
  sourceResultId?: string;
  startingBalance: number;
  currentEquity: number;
  realizedPL: number;
  unrealizedPL: number;
  totalPL: number;
  maxDrawdown: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin?: number;
  avgLoss?: number;
  profitFactor?: number;
  openPositionCount: number;
  closedTradeCount: number;
  latestDecisionAt?: string;
  lastCandleTime?: string;
  candlesProcessed: number;
  createdAt: string;
  startedAt?: string;
  ageMs: number;
  returnPct: number;
  drawdownPct: number;
  riskAdjustedScore: number;
  insufficientData: boolean;
  practiceLabel: string;
}

export interface PaperLeaderboardScoring {
  returnPct: string;
  drawdownPct: string;
  riskAdjustedScore: string;
  profitFactor: string;
}

export interface PaperLeaderboardResponse {
  rows: PaperLeaderboardRow[];
  scoring: PaperLeaderboardScoring;
}

export interface PaperLeaderboardFilters {
  status?: PaperRunStatus;
  strategyId?: string;
  instrument?: string;
  timeframe?: string;
  deploymentId?: string;
  sizingPolicy?: PaperSizingPolicy;
  hasOpenPosition?: boolean;
  hasClosedTrades?: boolean;
}

export interface PaperComparisonRow extends PaperLeaderboardRow {
  latestDecision?: {
    id: string;
    signalType: SignalType;
    reason?: string;
    riskStatus: SignalRiskStatus;
    riskReason?: string;
    resultingAction: PaperResultingAction;
    candleTime: string;
    createdAt: string;
  };
  openPositions: PaperPosition[];
  recentDecisions: PaperDecision[];
  sizingExplanationSummary: string;
}

export interface PaperComparisonResponse {
  rows: PaperComparisonRow[];
  scoring: PaperLeaderboardScoring;
}

export interface PaperRunDetail {
  run: PaperRun;
  deployment?: StrategyDeployment;
  decisions: PaperDecision[];
  openPositions: PaperPosition[];
  closedTrades: PaperTrade[];
  equitySnapshots: PaperEquitySnapshot[];
  plSummary: {
    startingBalance: number;
    currentEquity: number;
    realizedPL: number;
    unrealizedPL: number;
    totalPL: number;
    maxDrawdown: number;
    winRate: number;
    closedTradeCount: number;
    openPositionCount: number;
  };
  health: PaperRunHealth;
  supportedControls: Array<"pause" | "resume" | "stop">;
  practiceLabel: string;
}

// --- Phase 17.7: Paper Run Portfolio / Multi-Strategy Start Wizard (practice-only) ---

export const WIZARD_SIZING_POLICY = "PAPER_FOREX_GUARDRAILS_V1" as const;

export interface PaperRunCandidateActiveRun {
  id: string;
  status: PaperRunStatus;
  sizingPolicy: PaperSizingPolicy;
  currentEquity: number;
  totalPL: number;
  createdAt: string;
}

export interface PaperRunCandidate {
  deploymentId: string;
  deploymentName: string;
  strategyId: string;
  instrument: string;
  timeframe: string;
  enabled: boolean;
  autopilot: boolean;
  deploymentStatus: DeploymentStatus;
  sourceType?: string;
  sourceResultId?: string;
  sourceLinkCreatedAt?: string;
  activeRun?: PaperRunCandidateActiveRun;
  hasActiveRun: boolean;
  sizingPolicyForNewRun: typeof WIZARD_SIZING_POLICY;
}

export interface PaperRunCandidateFilters {
  strategyId?: string;
  instrument?: string;
  timeframe?: string;
  deploymentStatus?: DeploymentStatus;
  enabled?: boolean;
  autopilot?: boolean;
  sourceType?: string;
  hasActiveRun?: boolean;
}

export type BatchPaperRunResultStatus = "created" | "skipped_duplicate" | "skipped_invalid" | "error";

export interface BatchPaperRunResult {
  deploymentId: string;
  deploymentName?: string;
  status: BatchPaperRunResultStatus;
  run?: PaperRun;
  duplicateRunId?: string;
  message?: string;
}

export interface BatchCreatePaperRunInput {
  deploymentIds: string[];
  startingBalance?: number;
}

export interface BatchCreatePaperRunResponse {
  results: BatchPaperRunResult[];
}

export interface PaperPortfolioSummary {
  totalActiveRuns: number;
  totalOpenPositions: number;
  totalRealizedPL: number;
  totalUnrealizedPL: number;
  totalCurrentEquity: number;
  runsByStrategy: Record<string, number>;
  runsByInstrument: Record<string, number>;
  runsBySizingPolicy: Record<string, number>;
  staleCount: number;
  waitingCount: number;
  practiceLabel: string;
}

// --- Phase 18.0: Adaptive Portfolio Intelligence (read-only recommendation layer) ---

export type MarketRegime =
  | "TRENDING" | "STRONG_TREND" | "WEAK_TREND" | "RANGING" | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY" | "BREAKOUT" | "MEAN_REVERSION_FRIENDLY" | "UNKNOWN";

export interface RegimeSnapshot {
  id: string;
  symbol: string;
  granularity: string;
  candleTime: string;
  detectedAt: string;
  regime: MarketRegime;
  trendStrength: number | null;
  volatilityScore: number | null;
  adx: number | null;
  atr: number | null;
  atrPercentile: number | null;
  confidence: number;
  reasons: string[];
  createdAt: string;
}

export interface HealthSnapshot {
  id: string;
  deploymentId: string;
  calculatedAt: string;
  healthScore: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgReturn: number | null;
  maxDrawdown: number | null;
  recentDrawdown: number | null;
  recentTradeCount: number;
  regimeMatchScore: number | null;
  validationScore: number | null;
  candidateScore: number | null;
  reasons: string[];
  createdAt: string;
}

export interface CorrelationRow {
  id: string;
  deploymentAId: string;
  deploymentBId: string;
  calculatedAt: string;
  lookbackTrades: number;
  lookbackDays: number;
  correlation: number;
  overlapScore: number;
  recommendation: string;
  createdAt: string;
}

export interface AllocationRecommendation {
  id: string;
  calculatedAt: string;
  deploymentId: string;
  recommendedWeight: number;
  rawScore: number;
  cappedScore: number;
  reasons: string[];
  createdAt: string;
}

export interface PortfolioSnapshot {
  id: string;
  calculatedAt: string;
  equity: number | null;
  realizedPL: number | null;
  unrealizedPL: number | null;
  drawdown: number | null;
  exposure: number | null;
  activeDeploymentCount: number;
  regimeSummary: Record<string, unknown>;
  allocationSummary: Record<string, unknown>;
  riskSummary: Record<string, unknown>;
  createdAt: string;
}

export type RecommendationType =
  | "PAUSE_DEPLOYMENT" | "RESUME_DEPLOYMENT" | "REDUCE_ALLOCATION" | "INCREASE_ALLOCATION"
  | "RERUN_OPTIMIZER" | "RERUN_VALIDATION" | "AVOID_REGIME" | "HIGH_CORRELATION"
  | "DRAWDOWN_WARNING" | "REGIME_CHANGE" | "LOW_HEALTH";

export type RecommendationSeverity = "INFO" | "WARNING" | "CRITICAL";
export type RecommendationStatus = "OPEN" | "DISMISSED" | "RESOLVED";

export interface PortfolioRecommendation {
  id: string;
  createdAt: string;
  type: RecommendationType;
  severity: RecommendationSeverity;
  deploymentId: string | null;
  symbol: string | null;
  granularity: string | null;
  title: string;
  message: string;
  reasons: string[];
  status: RecommendationStatus;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface Phase18AnalysisSummary {
  symbolsAnalyzed: number;
  deploymentsScored: number;
  correlationPairsComputed: number;
  allocationsGenerated: number;
  recommendationsGenerated: number;
  openRecommendations: number;
  criticalRecommendations: number;
}

export interface Phase18AnalysisResult {
  ranAt: string;
  regimes: RegimeSnapshot[];
  healthSnapshots: HealthSnapshot[];
  correlations: CorrelationRow[];
  allocations: AllocationRecommendation[];
  portfolioSnapshot: PortfolioSnapshot;
  recommendations: PortfolioRecommendation[];
  summary: Phase18AnalysisSummary;
}

export interface Phase18LatestState {
  regimes: RegimeSnapshot[];
  healthSnapshots: HealthSnapshot[];
  correlations: CorrelationRow[];
  allocations: AllocationRecommendation[];
  portfolioSnapshot: PortfolioSnapshot | null;
  recommendations: PortfolioRecommendation[];
}

// Phase 18.2 — Job tracking + scheduler types
export type JobStatus = "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type JobTrigger = "MANUAL" | "SCHEDULED";
export type Freshness = "FRESH" | "STALE" | "UNKNOWN";

export interface IntelligenceJob {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobStatus;
  trigger: JobTrigger;
  durationMs: number | null;
  errorMessage: string | null;
  summary: Record<string, unknown>;
  createdAt: string;
}

export interface SchedulerStatus {
  enabled: boolean;
  intervalMinutes: number;
  freshnessThresholdMinutes: number;
  isRunning: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  freshness: Freshness;
  latestCompletedJob: IntelligenceJob | null;
}

export interface RecommendationAnalytics {
  openBySeverity: { CRITICAL: number; WARNING: number; INFO: number };
  openByType: Partial<Record<RecommendationType, number>>;
  totalOpen: number;
  totalResolved: number;
  totalDismissed: number;
  recentHistory: PortfolioRecommendation[];
  resolvedHistory: PortfolioRecommendation[];
}

export interface Phase18RunResult extends Phase18LatestState {
  ranAt: string;
  summary: Phase18AnalysisSummary;
  job: IntelligenceJob;
}

export interface EngineStatus {
  running: boolean;
  intervalMs: number;
  lastTickAt?: string;
  lastError?: string;
  enabledDeployments: number;
  queued: number;
}

export interface InstrumentSummary {
  symbol: string;
  displayName: string;
  pipSize: number;
}

export interface RiskProfile {
  id: string;
  name: string;
  description: string;
  maxRiskPerTradePercent: number;
  maxDailyLoss: number;
  maxOpenTrades: number;
}

export interface BacktestConfig {
  dataSource: string;
  instrument: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  strategyId: string;
  strategyParams: Record<string, unknown>;
  startingBalance: number;
  baseCurrency: string;
  riskProfile: string;
  spreadMode: "FIXED" | "HISTORICAL";
  fixedSpreadPips?: number;
  slippageMode: "NONE" | "FIXED";
  slippagePips?: number;
  allowMultipleOpenTrades?: boolean;
}

export type BacktestTradeStatus = "OPEN" | "CLOSED";

export type TradeExitReason =
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "STRATEGY_CLOSE"
  | "OPPOSITE_SIGNAL"
  | "END_OF_TEST"
  | "TIME_EXIT";

export interface BacktestTrade {
  id: string;
  strategyId: string;
  instrument: string;
  side: string;
  status: BacktestTradeStatus;
  entryTime: string;
  entryPrice: number;
  exitTime?: string;
  exitPrice?: number;
  units: number;
  stopLoss?: number;
  takeProfit?: number;
  profit?: number;
  profitPips?: number;
  exitReason?: TradeExitReason;
  reason: string;
}

/** Alias for chart components — same shape as BacktestTrade. */
export type Trade = BacktestTrade;

export interface BacktestMetrics {
  startingBalance: number;
  endingBalance: number;
  netProfit: number;
  netProfitPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  largestWin: number;
  largestLoss: number;
}

export interface EquityPoint {
  time: string;
  balance: number;
}

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  startedAt: string;
  finishedAt: string;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  logs: string[];
}

export interface MissingHistoricalDataError {
  error: "MISSING_HISTORICAL_DATA";
  message: string;
}

export type BacktestRunResponse = (BacktestResult & { backtestRunId: string }) | MissingHistoricalDataError;

export interface StrategyConfig {
  id: string;
  name: string;
  strategyId: string;
  description?: string;
  params: Record<string, unknown>;
  riskProfileId: string;
  instrument?: string;
  timeframe?: string;
  isFavorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateStrategyConfigInput {
  name: string;
  strategyId: string;
  description?: string;
  params: Record<string, unknown>;
  riskProfileId: string;
  instrument?: string;
  timeframe?: string;
  isFavorite?: boolean;
  tags?: string[];
}

export type UpdateStrategyConfigPatch = Partial<CreateStrategyConfigInput>;

export interface BacktestRunRequest extends Partial<BacktestConfig> {
  strategyConfigId?: string;
}

export interface BacktestRunSummary {
  id: string;
  strategyConfigId?: string;
  deploymentId?: string;
  strategyId: string;
  strategyName: string;
  instrument: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  endingBalance: number;
  netProfit: number;
  netProfitPercent: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  createdAt: string;
}

export interface BacktestRunDetail extends BacktestRunSummary {
  config: BacktestConfig;
  result: BacktestResult;
}

export interface BacktestRunComparison extends BacktestRunSummary {
  expectancy: number;
}

export interface BacktestRunFilters {
  strategyId?: string;
  strategyConfigId?: string;
  deploymentId?: string;
  instrument?: string;
  timeframe?: string;
  limit?: number;
}

/** Phase 14 — options for backtesting a deployment as configured. */
export interface DeploymentBacktestOptions {
  startDate?: string;
  endDate?: string;
  count?: number;
  startingBalance?: number;
  baseCurrency?: string;
}

export type HistoricalPriceMode = "M" | "B" | "A" | "MBA";

export interface Candle {
  source: string;
  instrument: string;
  timeframe: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bidOpen?: number;
  bidHigh?: number;
  bidLow?: number;
  bidClose?: number;
  askOpen?: number;
  askHigh?: number;
  askLow?: number;
  askClose?: number;
}

export interface CandleCoverage {
  source: string;
  instrument: string;
  timeframe: string;
  candleCount: number;
  firstCandleTime: string | null;
  lastCandleTime: string | null;
}

export interface ImportOandaRequest {
  instrument: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  priceMode?: HistoricalPriceMode;
}

export interface ImportByCountRequest {
  instrument: string;
  timeframe: string;
  count: number;
  priceMode?: HistoricalPriceMode;
}

export interface ImportSummary {
  importId: string;
  source: string;
  instrument: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  requestMode: "RANGE" | "COUNT";
  candleCount: number;
  firstCandleTime: string | null;
  lastCandleTime: string | null;
  status: "SUCCESS" | "FAILED";
  message: string;
}

export type ParameterGrid = Record<string, Array<string | number | boolean>>;

export interface ScoringWeights {
  netProfit: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdownPenalty: number;
  lowTradeCountPenalty: number;
}

export type OptimizerWarningCode =
  | "LOW_TRADE_COUNT"
  | "HIGH_DRAWDOWN"
  | "LOW_PROFIT_FACTOR"
  | "SUSPICIOUSLY_HIGH_WIN_RATE"
  | "NEGATIVE_EXPECTANCY";

export interface OptimizerWarning {
  code: OptimizerWarningCode;
  message: string;
}

export type OptimizerSessionStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

// Phase 15.5 — background job queue.
export type OptimizerJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";

export interface OptimizerJobSummary {
  id: string;
  optimizerSessionId: string;
  status: OptimizerJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  totalCombinations: number;
  completedCombinations: number;
  percentComplete: number;
  currentParams?: Record<string, unknown>;
  cancelRequested: boolean;
  workerId?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type OptimizerMetric =
  | "SCORE"
  | "NET_PROFIT"
  | "NET_PROFIT_PERCENT"
  | "WIN_RATE"
  | "PROFIT_FACTOR"
  | "EXPECTANCY"
  | "TRADE_COUNT"
  | "MAX_DRAWDOWN"
  | "RISK_ADJUSTED";

/** Human labels for the ranking-metric dropdown (Phase 15.4). */
export const OPTIMIZER_METRIC_LABELS: Record<OptimizerMetric, string> = {
  SCORE: "Composite score (default)",
  NET_PROFIT: "Net profit",
  NET_PROFIT_PERCENT: "Net profit %",
  WIN_RATE: "Win rate",
  PROFIT_FACTOR: "Profit factor",
  EXPECTANCY: "Expectancy",
  TRADE_COUNT: "Trade count",
  MAX_DRAWDOWN: "Smallest max drawdown",
  RISK_ADJUSTED: "Risk-adjusted (P/L ÷ drawdown)",
};

export interface OptimizerSession {
  id: string;
  name: string;
  strategyConfigId: string;
  deploymentId?: string;
  strategyId: string;
  instrument: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  riskProfileId: string;
  parameterGrid: ParameterGrid;
  scoringWeights: ScoringWeights;
  metricPrimary: OptimizerMetric;
  baseParams: Record<string, unknown>;
  totalRuns: number;
  completedRuns: number;
  status: OptimizerSessionStatus;
  bestResultId?: string;
  message?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Phase 15.5 — the session's most recent queue job (queue state + progress), when one exists. */
  job?: OptimizerJobSummary;
}

// Phase 16.2 — strategy result intelligence: a conservative, validation-aware
// recommendation layer on top of the robustness score, attached to optimizer and
// validation results by the API. Advice only — it never enables a deployment.
export type RecommendationLabel =
  | "REJECT"
  | "WATCHLIST"
  | "SIGNAL_ONLY"
  | "PAPER_ONLY"
  | "SMALL_RISK_ELIGIBLE";

export type RecommendationReasonSeverity = "positive" | "info" | "warning" | "critical";

export interface RecommendationReason {
  code: string;
  severity: RecommendationReasonSeverity;
  message: string;
}

export interface StrategyResultIntelligence {
  robustnessScore: number;
  recommendation: RecommendationLabel;
  reasons: RecommendationReason[];
  scoringVersion: string;
  validation: {
    hasValidation: boolean;
    outOfSamplePassed: boolean | null;
    walkForwardConsistency: number | null;
  };
}

// Phase 16.3 — latest available recommendation summary for a deployment, derived
// read-only from its linked optimizer/validation result history. Advice only — it
// never enables a deployment and never enables autopilot.
export type DeploymentIntelligenceSourceType = "optimizer" | "validation" | "backtest" | "unknown";
export type DeploymentIntelligenceMatch = "params" | "history";
// Phase 16.4 — how the source result was resolved: an exact persisted link, a heuristic
// reconstruction, or none (null summary).
export type DeploymentIntelligenceLinkMode = "exact" | "heuristic" | "none";

export interface DeploymentIntelligenceSummary {
  recommendation: RecommendationLabel;
  robustnessScore: number;
  scoringVersion: string;
  reasons: RecommendationReason[];
  sourceType: DeploymentIntelligenceSourceType;
  sourceResultId: string;
  sourceSessionId?: string;
  sourceLabel?: string;
  match: DeploymentIntelligenceMatch;
  linkMode: DeploymentIntelligenceLinkMode;
  hasPersistedSourceLink: boolean;
}

// Phase 16.7 — deployment provenance, independent of whether a Phase 16.2 scored
// recommendation exists for the source (e.g. a persisted backtest link is "exact" even
// though backtests are never scored). Lets the UI answer "where did this come from" even
// when `intelligence` above is null.
export type DeploymentSourceDisplayType = "validation" | "optimizer" | "backtest" | "manual" | "unknown" | null;

export interface DeploymentSourceDetail {
  sourceType: DeploymentSourceDisplayType;
  sourceResultId: string | null;
  sourceSessionId: string | null;
  sourceName: string | null;
  sourceMode: string | null;
  strategyId: string | null;
  instrument: string | null;
  granularity: string | null;
  createdAt: string | null;
  linkMode: DeploymentIntelligenceLinkMode;
  hasPersistedSourceLink: boolean;
}

// Phase 16.8 — opt-in legacy deployment source backfill. Read-only preview of candidate
// exact source links for a deployment with no persisted source_type/source_result_id,
// plus a deliberate apply step. Never backfills automatically.
export type SourceBackfillMatchConfidence = "high" | "medium" | "low";

export interface SourceBackfillCandidate {
  sourceType: DeploymentIntelligenceSourceType | "manual" | "unknown";
  sourceResultId: string;
  sourceSessionId: string | null;
  sourceName: string | null;
  sourceMode: string | null;
  strategyId: string;
  instrument: string;
  granularity: string;
  createdAt: string;
  recommendationLabel: RecommendationLabel | null;
  robustnessScore: number | null;
  matchConfidence: SourceBackfillMatchConfidence;
  matchReasons: string[];
  mismatchReasons: string[];
  wouldWrite: {
    source_type: string;
    source_result_id: string;
    source_session_id: string | null;
    source_metadata_json: string;
  };
}

export interface LegacyDeploymentSourceBackfillPreview {
  deploymentId: string;
  deploymentName: string;
  alreadyLinked: boolean;
  eligible: boolean;
  candidates: SourceBackfillCandidate[];
  recommendedCandidate: SourceBackfillCandidate | null;
  warnings: string[];
}

export interface ApplyLegacyDeploymentSourceLinkInput {
  sourceType: string;
  sourceResultId: string;
  sourceSessionId?: string | null;
  confirmText: string;
}

export interface OptimizerResult {
  id: string;
  optimizerSessionId: string;
  backtestRunId?: string;
  params: Record<string, unknown>;
  score: number;
  rank?: number;
  netProfit?: number;
  netProfitPercent?: number;
  maxDrawdown?: number;
  winRate?: number;
  profitFactor?: number;
  expectancy?: number;
  totalTrades?: number;
  averageWin?: number;
  averageLoss?: number;
  riskAdjustedScore?: number;
  warnings: OptimizerWarning[];
  /** Phase 16.2 — robustness score + conservative recommendation + reasons. */
  intelligence?: StrategyResultIntelligence;
  createdAt: string;
}

export interface CreateOptimizerSessionInput {
  name: string;
  strategyConfigId: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  parameterGrid: ParameterGrid;
  scoringWeights?: ScoringWeights;
  maxRuns?: number;
  metricPrimary?: OptimizerMetric;
}

export interface CreateOptimizerSessionFromDeploymentInput {
  deploymentId: string;
  name?: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  parameterGrid: ParameterGrid;
  scoringWeights?: ScoringWeights;
  maxRuns?: number;
  metricPrimary?: OptimizerMetric;
}

/** Phase 15.5 — running a session now enqueues a background job and returns it immediately. */
export interface RunOptimizerSessionResponse {
  session: OptimizerSession;
  job: OptimizerJobSummary;
}

/** 202 returns {session, job}; 409 (already an active job) / 404 carry an `error`. Inspect the body. */
export type RunOptimizerSessionOutcome = RunOptimizerSessionResponse | { error: string; message?: string };
export type CreateOptimizerSessionOutcome = OptimizerSession | { error: string };

export type ValidationMode = "OUT_OF_SAMPLE" | "WALK_FORWARD";

export type ValidationStatus = "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";

export type ValidationJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";

export type ValidationSegmentStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";

export interface ValidationJobSummary {
  id: string;
  validationRunId: string;
  status: ValidationJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  totalSegments: number;
  completedSegments: number;
  percentComplete: number;
  currentSegmentIndex?: number;
  cancelRequested: boolean;
  workerId?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationSegment {
  id: string;
  validationRunId: string;
  segmentIndex: number;
  trainStart?: string;
  trainEnd?: string;
  validationStart?: string;
  validationEnd?: string;
  status: ValidationSegmentStatus;
  selectedParams?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface OutOfSampleValidationRequest {
  name: string;
  sourceBacktestRunId?: string;
  optimizerSessionId?: string;
  optimizerResultIds?: string[];
  strategyConfigId?: string;
  strategyId: string;
  instrument: string;
  timeframe: string;
  trainStartDate: string;
  trainEndDate: string;
  testStartDate: string;
  testEndDate: string;
  startingBalance: number;
  strategyParams: Record<string, unknown>;
  riskProfileId: string;
}

export interface WalkForwardValidationRequest {
  name: string;
  strategyConfigId: string;
  instrument: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  trainWindowDays: number;
  testWindowDays: number;
  stepDays: number;
  parameterGrid: ParameterGrid;
  scoringWeights?: ScoringWeights;
  maxRunsPerWindow?: number;
}

export interface ValidationRun {
  id: string;
  name: string;
  mode: ValidationMode;
  status: ValidationStatus;
  strategyConfigId?: string;
  optimizerSessionId?: string;
  sourceBacktestRunId?: string;
  instrument: string;
  timeframe: string;
  trainStartDate?: string;
  trainEndDate?: string;
  testStartDate?: string;
  testEndDate?: string;
  startDate?: string;
  endDate?: string;
  startingBalance: number;
  request: OutOfSampleValidationRequest | WalkForwardValidationRequest;
  summary?: WalkForwardSummary;
  message?: string;
  totalSegments?: number;
  completedSegments?: number;
  createdAt: string;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  job?: ValidationJobSummary;
  segments?: ValidationSegment[];
}

export type ValidationResultSourceType = "MANUAL" | "BACKTEST_RUN" | "OPTIMIZER_RESULT" | "WALK_FORWARD_WINDOW";

export interface ValidationResult {
  id: string;
  validationRunId: string;
  sourceType: ValidationResultSourceType;
  sourceId?: string;
  windowIndex?: number;
  trainBacktestRunId?: string;
  testBacktestRunId?: string;
  params: Record<string, unknown>;
  trainMetrics?: BacktestMetrics;
  testMetrics: BacktestMetrics;
  score?: number;
  pass: boolean;
  warnings: ValidationWarning[];
  /** Phase 16.2 — robustness score + conservative recommendation + reasons. */
  intelligence?: StrategyResultIntelligence;
  createdAt: string;
}

export type ValidationWarningCode =
  | "OOS_NET_PROFIT_FLIP"
  | "OOS_NEGATIVE_EXPECTANCY"
  | "OOS_PROFIT_FACTOR_COLLAPSE"
  | "OOS_DRAWDOWN_EXPANSION"
  | "LOW_TEST_TRADE_COUNT"
  | "WALK_FORWARD_INCONSISTENT"
  | "WALK_FORWARD_TOO_FEW_WINDOWS";

export interface ValidationWarning {
  code: ValidationWarningCode;
  message: string;
}

export interface WalkForwardSummary {
  windowCount: number;
  passCount: number;
  passRate: number;
  averageTestProfitFactor: number;
  averageTestExpectancy: number;
  totalTestNetProfit: number;
  worstTestDrawdown: number;
  warnings: ValidationWarning[];
}

export interface OandaPracticeStatus {
  configured: boolean;
  hasApiKey: boolean;
  hasAccountId: boolean;
  baseUrl: string | null;
}

export interface OandaBrokerModeStatus {
  practiceConfigured: boolean;
  liveConfigured: boolean;
  liveAvailable: boolean;
  canPlacePracticeOrders: boolean;
  canPlaceLiveOrders: boolean;
}

export interface BrokerAccountSummary {
  accountId: string;
  broker: string;
  environment: "demo" | "live";
  currency: string;
  balance: number;
  nav?: number;
  unrealizedPL?: number;
  marginUsed?: number;
  marginAvailable?: number;
  openPositionCount: number;
  openTradeCount: number;
  lastTransactionId?: string;
}

export interface BrokerPosition {
  instrument: string;
  longUnits: number;
  longAveragePrice?: number;
  shortUnits: number;
  shortAveragePrice?: number;
  unrealizedPL?: number;
}

export interface BrokerTrade {
  id: string;
  instrument: string;
  side: "BUY" | "SELL";
  units: number;
  openPrice: number;
  openTime: string;
  unrealizedPL?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface BrokerInstrument {
  symbol: string;
  displayName: string;
  type: string;
  pipLocation: number;
  marginRate?: number;
}

export interface BrokerPriceSnapshot {
  instrument: string;
  time: string;
  tradeable: boolean;
  bid?: number;
  ask?: number;
}

export interface BrokerErrorResponse {
  error: string;
  message?: string;
  code?: string;
}

// Phase 9 — OANDA practice-only manual demo order ticket. No live trading exists anywhere in this client.
export type ManualOrderWarningSeverity = "INFO" | "WARNING" | "BLOCKING";

export interface ManualOrderRiskWarning {
  code: string;
  message: string;
  severity: ManualOrderWarningSeverity;
}

export interface ManualOrderPreviewSummary {
  instrument: string;
  side: "BUY" | "SELL";
  units: number;
  orderType: "MARKET";
  bid?: number;
  ask?: number;
  estimatedPrice?: number;
  pipValueEstimate?: number;
  notionalEstimate?: number;
  marginEstimate?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface ManualOrderPreviewRequest {
  instrument: string;
  side: "BUY" | "SELL";
  units: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  allowNoStops?: boolean;
}

export interface ManualOrderPreviewResponse {
  previewId: string;
  confirmationToken: string;
  expiresAt: string;
  blocked: boolean;
  warnings: ManualOrderRiskWarning[];
  summary: ManualOrderPreviewSummary;
}

export interface ManualOrderConfirmRequest {
  previewId: string;
  confirmationToken: string;
}

export interface ManualOrderConfirmResponse {
  status: "FILLED" | "SUBMITTED" | "REJECTED" | "ERROR";
  executionId: string;
  summary: ManualOrderPreviewSummary & { brokerOrderId?: string; brokerTransactionId?: string; errorMessage?: string };
}

export interface ManualOrderHistoryEntry {
  id: string;
  previewId: string;
  broker: string;
  environment: "demo";
  instrument: string;
  side: "BUY" | "SELL";
  units: number;
  orderType: "MARKET";
  requestedPrice?: number;
  fillPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  brokerOrderId?: string;
  brokerTransactionId?: string;
  status: "FILLED" | "SUBMITTED" | "REJECTED" | "ERROR";
  errorMessage?: string;
  createdAt: string;
}

// Phase 11 — OANDA practice-only position close / flatten. No live close exists in this client.
export type CloseActionType = "CLOSE_TRADE" | "CLOSE_INSTRUMENT_POSITION" | "FLATTEN_ALL_PRACTICE_POSITIONS";
export type ClosePositionSide = "long" | "short" | "both";
export type ManualCloseExecutionStatus = "CLOSED" | "PARTIALLY_CLOSED" | "SUBMITTED" | "REJECTED" | "ERROR";

export interface ManualCloseWarning {
  code: string;
  message: string;
  severity: ManualOrderWarningSeverity;
}

export interface AffectedTradeSummary {
  tradeId: string;
  instrument: string;
  side: "BUY" | "SELL";
  units: number;
  openPrice: number;
  unrealizedPL?: number;
  openTime: string;
}

export interface AffectedPositionSummary {
  instrument: string;
  longUnits: number;
  shortUnits: number;
  unrealizedPL?: number;
}

export interface CloseInstrumentPrice {
  instrument: string;
  bid?: number;
  ask?: number;
  estimatedClosePrice?: number;
}

export interface ManualClosePreview {
  previewId: string;
  confirmationToken: string;
  actionType: CloseActionType;
  environment: "demo";
  affectedTrades: AffectedTradeSummary[];
  affectedPositions: AffectedPositionSummary[];
  prices: CloseInstrumentPrice[];
  currentUnrealizedPL?: number;
  warnings: ManualCloseWarning[];
  blocked: boolean;
  expiresAt: string;
}

export interface ManualCloseExecution {
  executionId: string;
  previewId: string;
  actionType: CloseActionType;
  environment: "demo";
  status: ManualCloseExecutionStatus;
  brokerTransactionIds: string[];
  affectedTradeIds: string[];
  affectedInstruments: string[];
  errorMessage?: string;
  createdAt: string;
}

export interface ManualCloseHistoryEntry {
  id: string;
  previewId: string;
  broker: string;
  environment: "demo";
  actionType: CloseActionType;
  targetTradeId?: string;
  targetInstrument?: string;
  targetSide?: ClosePositionSide;
  requestedUnits?: string;
  status: ManualCloseExecutionStatus;
  brokerTransactionIds: string[];
  errorMessage?: string;
  createdAt: string;
}

export interface ManualCloseConfirmRequest {
  previewId: string;
  confirmationToken: string;
}

export type CreateValidationOutcome = ValidationRun | { error: string };
/** Phase 15.6 — enqueue returns the QUEUED run + its background job; the worker runs it. */
export type EnqueueValidationOutcome = { run: ValidationRun; job: ValidationJobSummary } | { error: string };

export interface ValidationRunFilters {
  mode?: ValidationMode;
  status?: ValidationStatus;
}

export interface FromOptimizerValidationInput {
  name?: string;
  testStartDate: string;
  testEndDate: string;
  trainStartDate?: string;
  trainEndDate?: string;
  startingBalance?: number;
  topN?: number;
}

export interface PreviewSplitsInput {
  mode: ValidationMode;
  startDate?: string;
  endDate?: string;
  splitPercent?: number;
  trainStartDate?: string;
  trainEndDate?: string;
  testStartDate?: string;
  testEndDate?: string;
  trainWindowDays?: number;
  testWindowDays?: number;
  stepDays?: number;
}

export interface PreviewSegment {
  index: number;
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
}

export interface PreviewSplitsResult {
  mode: ValidationMode;
  segments: PreviewSegment[];
  segmentCount: number;
  capExceeded: boolean;
  maxSegments: number;
}

export type PreviewSplitsOutcome = PreviewSplitsResult | { error: string };

export type CandidateStatus = "NEW" | "REVIEWED" | "APPROVED" | "REJECTED" | "DEPLOYED";

export interface ValidationScorecard {
  id: string;
  validationRunId: string;
  scoreTotal: number;
  scoreProfitFactor: number;
  scoreSharpe: number;
  scoreDrawdown: number;
  scoreWinRate: number;
  scoreConsistency: number;
  scoreTradeCount: number;
  weights: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentCandidate {
  id: string;
  validationRunId: string;
  validationResultId?: string;
  scorecardId?: string;
  name: string;
  status: CandidateStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationTag {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
}

export interface ValidationNote {
  id: string;
  validationRunId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaderboardRow {
  validationRunId: string;
  validationResultId?: string;
  name: string;
  strategyId?: string;
  symbol: string;
  timeframe: string;
  validationType: ValidationMode;
  status: string;
  createdAt: string;
  scorecard?: ValidationScorecard;
  profitFactor: number | null;
  sharpe: number | null;
  drawdown: number | null;
  netReturn: number | null;
  tradeCount: number | null;
  winRate: number | null;
  tags: ValidationTag[];
  candidate?: DeploymentCandidate;
}

export interface CompareValidationRow extends LeaderboardRow {
  equityCurve?: EquityPoint[];
}

export interface ResearchDashboard {
  summary: {
    totalValidations: number;
    topScore: number;
    topProfitFactor: number;
    topSharpe: number;
    approvedCandidates: number;
    deployedCandidates: number;
  };
  recentActivity: Array<{ action: string; createdAt: string; metadata: Record<string, unknown> | null }>;
}

export interface LeaderboardFilters {
  strategy?: string;
  symbol?: string;
  timeframe?: string;
  validationType?: ValidationMode;
  from?: string;
  to?: string;
  tag?: string;
  sort?: "score" | "profitFactor" | "sharpe" | "drawdown" | "netReturn" | "recent";
}

// Phase 15.7 — ranking pipeline. Types mirror @forex/engine + the API row layer.
export type RankingSourceType = "optimizer_session" | "validation_run" | "mixed";
export type RankingCandidateType = "optimizer_result" | "validation_result" | "deployment_candidate";
export type RankingRunStatus = "CREATED" | "RUNNING" | "COMPLETED" | "FAILED";

export type RankingDimensionKey =
  | "netReturn"
  | "profitFactor"
  | "drawdown"
  | "riskAdjusted"
  | "winRate"
  | "outOfSample"
  | "walkForwardConsistency"
  | "segmentRobustness";

export type RankingWeights = Record<RankingDimensionKey, number>;

export interface RankingThresholds {
  minTradeCount: number;
  maxDrawdownPercent: number;
  maxInSampleVariancePercent: number;
  inSampleOnlyPenalty: number;
  inSampleOnlyOverfitScale: number;
  maxInSampleOnlyPenalty: number;
  missingMetricPenalty: number;
  maxDrawdownPenalty: number;
  maxTradeCountPenalty: number;
  maxInSampleVariancePenalty: number;
  maxMissingMetricPenalty: number;
}

export interface RankingProfile {
  id: string;
  name: string;
  description?: string;
  weights: RankingWeights;
  thresholds: RankingThresholds;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RankingDimensionScore {
  key: RankingDimensionKey;
  weight: number;
  rawValue: number | null;
  normalized: number | null;
  contribution: number;
  missing: boolean;
  note: string;
}

export interface RankingPenalty {
  code: string;
  points: number;
  reason: string;
}

export interface RankingResult {
  id: string;
  rankingRunId: string;
  candidateType: RankingCandidateType;
  candidateId: string;
  candidateLabel?: string;
  rank: number;
  score: number;
  baseScore: number;
  totalPenalty: number;
  scoreBreakdown: RankingDimensionScore[];
  metricsSnapshot: Record<string, unknown>;
  penalties: RankingPenalty[];
  explanation: string;
  createdAt: string;
}

export interface RankingRunSummary {
  profileId: string;
  profileName: string;
  candidateCount: number;
  topScore: number;
  averageScore: number;
  top: Array<{ rank: number; candidateId: string; candidateType: RankingCandidateType; label: string; score: number }>;
}

export interface RankingRun {
  id: string;
  sourceType: RankingSourceType;
  sourceId?: string;
  rankingProfileId: string;
  status: RankingRunStatus;
  summary?: RankingRunSummary;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  results?: RankingResult[];
}

export const RANKING_DIMENSION_LABELS: Record<RankingDimensionKey, string> = {
  netReturn: "Net return",
  profitFactor: "Profit factor",
  drawdown: "Drawdown control",
  riskAdjusted: "Risk-adjusted",
  winRate: "Win rate",
  outOfSample: "Out-of-sample",
  walkForwardConsistency: "Walk-forward consistency",
  segmentRobustness: "Segment robustness",
};

// Phase 15.8 — research-to-deployment review workflow. Types mirror the API row layer.
export type ReviewSourceType = "ranking_result" | "validation_result" | "optimizer_result" | "deployment_candidate";
export type ReviewRunStatus =
  | "DRAFT"
  | "READY_FOR_REVIEW"
  | "APPROVED_FOR_DEPLOYMENT_CANDIDATE"
  | "REJECTED"
  | "NEEDS_MORE_DATA";
export type ReviewGrade = "PASS" | "WARN" | "FAIL";
export type ReviewItemStatus = "PASS" | "WARN" | "FAIL" | "MISSING" | "INFO";
export type ReviewSeverity = "LOW" | "MEDIUM" | "HIGH" | "BLOCKER";
export type ReviewCategory =
  | "DATA"
  | "BACKTEST"
  | "OPTIMIZER"
  | "VALIDATION"
  | "RANKING"
  | "RISK"
  | "DEPLOYMENT_SAFETY"
  | "HUMAN_REVIEW";
export type ReviewDecisionType = "APPROVE_DEPLOYMENT_CANDIDATE" | "REJECT" | "NEEDS_MORE_DATA" | "NOTE_ONLY";

export interface ReviewChecklistItem {
  category: ReviewCategory;
  key: string;
  label: string;
  status: ReviewItemStatus;
  severity: ReviewSeverity;
  details: Record<string, unknown>;
  explanation: string;
  sortOrder: number;
}

export interface ReviewChecklistSummary {
  grade: ReviewGrade;
  counts: Record<ReviewItemStatus, number>;
  blockers: Array<{ key: string; label: string; explanation: string }>;
  warnings: Array<{ key: string; label: string; explanation: string }>;
  missing: Array<{ key: string; label: string }>;
  inSampleOnly: boolean;
  hasOutOfSample: boolean;
  hasWalkForward: boolean;
  rankingScore: number | null;
  deployableViaValidatedResult: boolean;
  deployValidationResultId?: string;
}

export interface ReviewDecision {
  id: string;
  reviewRunId: string;
  decision: ReviewDecisionType;
  note?: string;
  createdAt: string;
}

export interface ResearchReviewRun {
  id: string;
  sourceType: ReviewSourceType;
  sourceId: string;
  status: ReviewRunStatus;
  overallGrade?: ReviewGrade;
  summary?: ReviewChecklistSummary;
  reviewerNote?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  items?: ReviewChecklistItem[];
  decisions?: ReviewDecision[];
}

export const REVIEW_CATEGORY_LABELS: Record<ReviewCategory, string> = {
  DATA: "Data readiness",
  BACKTEST: "Backtest evidence",
  OPTIMIZER: "Optimizer evidence",
  VALIDATION: "Validation evidence",
  RANKING: "Ranking evidence",
  RISK: "Risk",
  DEPLOYMENT_SAFETY: "Deployment safety",
  HUMAN_REVIEW: "Human review",
};

async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...init,
  });
  notifyIfUnauthorized(response.status);
  return response.json() as Promise<T>;
}

// Phase 12 — auth + audit types. Phase 16.0 added the `researcher` role.
export type Role = "admin" | "researcher" | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  researcher: "Researcher",
  viewer: "Viewer",
};

export interface AuthUser {
  username: string;
  role: Role;
}

// Phase 16.0 — user manager.
export interface CurrentUser {
  username: string;
  role: Role;
  email: string | null;
  isEnabled: boolean;
  lastLoginAt: string | null;
  /** false → env-fallback account; password is rotated via .env / recovery CLI, not the UI. */
  dbManaged: boolean;
}

export interface ManagedUser {
  id: string;
  username: string;
  email: string | null;
  role: Role;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: Role;
  email?: string;
}

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  username: string | null;
  role: string | null;
  action: string;
  route: string | null;
  method: string | null;
  ip: string | null;
  userAgent: string | null;
  success: boolean;
  statusCode: number | null;
  metadata: Record<string, unknown> | null;
}

// Phase 15.0 — analysis capability catalog (read-only). Mirrors the @forex/analysis
// CatalogEntry shape; redefined locally per this client's convention of not importing
// server packages.
export interface AnalysisCatalogOutput {
  key: string;
  label: string;
  role: string;
  unit: string;
  range?: { min?: number; max?: number };
  defaultLine?: boolean;
}

export interface AnalysisRepaintMeta {
  repaints: boolean;
  confirmationLag: number;
  confirmedOnly: boolean;
  reason?: string;
}

export interface AnalysisPatternMeta {
  span: number;
  directional: boolean;
  emitsStrength: boolean;
}

export interface AnalysisCatalogEntry {
  id: string;
  kind: string;
  name: string;
  description: string;
  version: string;
  category: string;
  tags: string[];
  outputs: AnalysisCatalogOutput[];
  dependencies: Array<{ id: string }>;
  warmupAtDefaults: number;
  repaints: AnalysisRepaintMeta;
  /** Present only for pattern entries (kind === "pattern"). */
  pattern?: AnalysisPatternMeta;
}

export const apiClient = {
  getHealth: () => request<{ status: string }>("/health"),

  // Phase 15.0 — read-only analysis catalog.
  getAnalysisCatalog: () => request<AnalysisCatalogEntry[]>("/analysis/catalog"),

  // Phase 12 — authentication + audit log.
  login: (username: string, password: string) =>
    request<AuthUser>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  getCurrentUser: () => request<AuthUser>("/auth/me"),
  getAuditLogs: (limit = 100, action?: string) => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (action) params.set("action", action);
    return request<AuditLogEntry[]>(`/audit/logs?${params.toString()}`);
  },

  // Phase 16.0 — user manager. Self-service routes work for any role; the rest require admin.
  getMe: () => request<CurrentUser>("/users/me"),
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/users/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  getUsers: () => request<ManagedUser[]>("/users"),
  createUser: (input: CreateUserInput) =>
    request<ManagedUser>("/users", { method: "POST", body: JSON.stringify(input) }),
  updateUser: (id: string, patch: { username?: string; email?: string | null; role?: Role }) =>
    request<ManagedUser>(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  resetUserPassword: (id: string, newPassword: string) =>
    request<{ ok: boolean }>(`/users/${encodeURIComponent(id)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    }),
  setUserEnabled: (id: string, enabled: boolean) =>
    request<ManagedUser>(`/users/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, { method: "POST" }),

  getAccounts: () => request<Account[]>("/accounts"),
  getStrategies: () => request<StrategySummary[]>("/strategies"),
  getInstruments: () => request<InstrumentSummary[]>("/market-data/instruments"),
  getRiskProfiles: () => request<RiskProfile[]>("/risk/profiles"),
  // Backtest results carry a useful MISSING_HISTORICAL_DATA error on 409; the caller inspects the body instead of catching.
  runBacktest: (config: BacktestRunRequest) =>
    rawRequest<BacktestRunResponse>("/backtests/run", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  getCoverage: (source: string, instrument: string, timeframe: string) =>
    request<CandleCoverage>(
      `/market-data/coverage?source=${encodeURIComponent(source)}&instrument=${encodeURIComponent(instrument)}&timeframe=${encodeURIComponent(timeframe)}`
    ),
  getCandles: (source: string, instrument: string, timeframe: string, startDate: string, endDate: string) =>
    request<Candle[]>(
      `/market-data/candles?source=${encodeURIComponent(source)}&instrument=${encodeURIComponent(instrument)}&timeframe=${encodeURIComponent(timeframe)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
    ),
  importOandaHistoricalData: (body: ImportOandaRequest) =>
    request<ImportSummary>("/market-data/import/oanda", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  importOandaHistoricalDataByCount: (body: ImportByCountRequest) =>
    request<ImportSummary>("/market-data/import/oanda/count", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getStrategyConfigs: () => request<StrategyConfig[]>("/strategy-configs"),
  getStrategyConfig: (id: string) => request<StrategyConfig>(`/strategy-configs/${encodeURIComponent(id)}`),
  createStrategyConfig: (input: CreateStrategyConfigInput) =>
    request<StrategyConfig>("/strategy-configs", { method: "POST", body: JSON.stringify(input) }),
  updateStrategyConfig: (id: string, patch: UpdateStrategyConfigPatch) =>
    request<StrategyConfig>(`/strategy-configs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteStrategyConfig: (id: string) =>
    fetch(`${BASE_URL}/strategy-configs/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`Failed to delete strategy config ${id}`);
    }),
  cloneStrategyConfig: (id: string, name?: string) =>
    request<StrategyConfig>(`/strategy-configs/${encodeURIComponent(id)}/clone`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  favoriteStrategyConfig: (id: string, isFavorite: boolean) =>
    request<StrategyConfig>(`/strategy-configs/${encodeURIComponent(id)}/favorite`, {
      method: "POST",
      body: JSON.stringify({ isFavorite }),
    }),

  // --- Phase 13: strategy modules, deployments, and live engine ---
  setStrategyEnabled: (id: string, enabled: boolean) =>
    request<StrategySummary>(`/strategies/${encodeURIComponent(id)}/enabled`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),

  getDeployments: () => request<StrategyDeployment[]>("/strategy-deployments"),
  getDeployment: (id: string) => request<StrategyDeployment>(`/strategy-deployments/${encodeURIComponent(id)}`),
  createDeployment: (input: CreateStrategyDeploymentInput) =>
    request<StrategyDeployment>("/strategy-deployments", { method: "POST", body: JSON.stringify(input) }),
  updateDeployment: (id: string, patch: UpdateStrategyDeploymentPatch) =>
    request<StrategyDeployment>(`/strategy-deployments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteDeployment: (id: string) =>
    fetch(`${BASE_URL}/strategy-deployments/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => {
      if (!r.ok) throw new Error(`Failed to delete deployment ${id}`);
    }),
  setDeploymentEnabled: (id: string, enabled: boolean) =>
    request<StrategyDeployment>(`/strategy-deployments/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, {
      method: "POST",
    }),
  setDeploymentAutopilot: (id: string, autopilot: boolean) =>
    request<StrategyDeployment>(`/strategy-deployments/${encodeURIComponent(id)}/autopilot`, {
      method: "PATCH",
      body: JSON.stringify({ autopilot }),
    }),
  // Bulk admin safety actions (audited server-side). Both leave deployments in place.
  pauseAllDeployments: () =>
    request<{ paused: number }>("/strategy-deployments/pause-all", { method: "POST" }),
  disableAllAutopilot: () =>
    request<{ disabled: number }>("/strategy-deployments/disable-all-autopilot", { method: "POST" }),
  getDeploymentSignals: (id: string, limit = 25) =>
    request<StrategySignal[]>(`/strategy-deployments/${encodeURIComponent(id)}/signals?limit=${limit}`),
  getDeploymentPerformance: (id: string) =>
    request<StrategyPerformance | null>(`/strategy-deployments/${encodeURIComponent(id)}/performance`),
  // Phase 16.3 — latest recommendation/score for a deployment (read-only; null when none).
  // Phase 16.7 — also returns sourceDetail (provenance), independent of intelligence.
  getDeploymentIntelligence: (id: string) =>
    request<{ intelligence: DeploymentIntelligenceSummary | null; sourceDetail: DeploymentSourceDetail }>(
      `/strategy-deployments/${encodeURIComponent(id)}/intelligence`
    ),

  // Phase 16.8 — legacy deployment source backfill: read-only preview + opt-in apply.
  previewDeploymentSourceBackfill: (id: string) =>
    request<LegacyDeploymentSourceBackfillPreview>(
      `/strategy-deployments/${encodeURIComponent(id)}/source-backfill/preview`
    ),
  applyDeploymentSourceBackfill: (id: string, input: ApplyLegacyDeploymentSourceLinkInput) =>
    request<{ deployment: StrategyDeployment; sourceDetail: DeploymentSourceDetail }>(
      `/strategy-deployments/${encodeURIComponent(id)}/source-backfill/apply`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  // Phase 14 — backtest a deployment as configured (simulation only; never places orders).
  // Carries MISSING_HISTORICAL_DATA on 409 — caller inspects the body instead of catching.
  runDeploymentBacktest: (id: string, options: DeploymentBacktestOptions = {}) =>
    rawRequest<BacktestRunResponse>(`/strategy-deployments/${encodeURIComponent(id)}/backtest`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
  getDeploymentBacktests: (id: string, limit = 25) =>
    request<BacktestRunSummary[]>(`/strategy-deployments/${encodeURIComponent(id)}/backtests?limit=${limit}`),
  getDeploymentLatestBacktest: (id: string) =>
    request<BacktestRunDetail | null>(`/strategy-deployments/${encodeURIComponent(id)}/backtests/latest`),

  getEngineStatus: () => request<EngineStatus>("/strategy-engine/status"),
  startEngine: () => request<EngineStatus>("/strategy-engine/start", { method: "POST" }),
  stopEngine: () => request<EngineStatus>("/strategy-engine/stop", { method: "POST" }),
  tickDeployment: (id: string) =>
    request<{ deployment: StrategyDeployment; signals: StrategySignal[] }>(
      `/strategy-engine/${encodeURIComponent(id)}/tick`,
      { method: "POST" }
    ),

  getBacktestRuns: (filters: BacktestRunFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.strategyId) params.set("strategyId", filters.strategyId);
    if (filters.strategyConfigId) params.set("strategyConfigId", filters.strategyConfigId);
    if (filters.deploymentId) params.set("deploymentId", filters.deploymentId);
    if (filters.instrument) params.set("instrument", filters.instrument);
    if (filters.timeframe) params.set("timeframe", filters.timeframe);
    if (filters.limit) params.set("limit", String(filters.limit));
    const query = params.toString();
    return request<BacktestRunSummary[]>(`/backtests/runs${query ? `?${query}` : ""}`);
  },
  getBacktestRun: (id: string) => request<BacktestRunDetail>(`/backtests/runs/${encodeURIComponent(id)}`),
  deleteBacktestRun: (id: string) =>
    fetch(`${BASE_URL}/backtests/runs/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`Failed to delete backtest run ${id}`);
    }),
  compareBacktestRuns: (ids: string[]) =>
    request<BacktestRunComparison[]>("/backtests/runs/compare", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  getOptimizerSessions: () => request<OptimizerSession[]>("/optimizer/sessions"),
  getOptimizerSession: (id: string) => request<OptimizerSession>(`/optimizer/sessions/${encodeURIComponent(id)}`),
  // Phase 15.5 — poll the session enriched with its queue job (status, progress, percent, error).
  getOptimizerSessionStatus: (id: string) =>
    request<OptimizerSession>(`/optimizer/sessions/${encodeURIComponent(id)}/status`),
  getOptimizerResults: (sessionId: string) =>
    request<OptimizerResult[]>(`/optimizer/sessions/${encodeURIComponent(sessionId)}/results`),
  // Validation errors (bad grid, too many combinations) carry a friendly `error` message on 400 — inspect the body.
  createOptimizerSession: (input: CreateOptimizerSessionInput) =>
    rawRequest<CreateOptimizerSessionOutcome>("/optimizer/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Phase 15.4 — seed an optimizer session from a deployment (simulation only; never touches the deployment).
  createOptimizerSessionFromDeployment: (input: CreateOptimizerSessionFromDeploymentInput) =>
    rawRequest<CreateOptimizerSessionOutcome>("/optimizer/sessions/from-deployment", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Phase 15.4 — promote a ranked result into a NEW deployment (always disabled + autopilot OFF).
  createDeploymentFromOptimizerResult: (resultId: string, name?: string) =>
    rawRequest<StrategyDeployment | { error: string }>(
      `/optimizer/results/${encodeURIComponent(resultId)}/create-deployment`,
      { method: "POST", body: JSON.stringify({ name }) }
    ),
  runOptimizerSession: (id: string) =>
    rawRequest<RunOptimizerSessionOutcome>(`/optimizer/sessions/${encodeURIComponent(id)}/run`, {
      method: "POST",
    }),
  cancelOptimizerSession: (id: string) =>
    request<OptimizerSession>(`/optimizer/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  deleteOptimizerSession: (id: string) =>
    fetch(`${BASE_URL}/optimizer/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`Failed to delete optimizer session ${id}`);
    }),

  getValidationRuns: (filters: ValidationRunFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.mode) params.set("mode", filters.mode);
    if (filters.status) params.set("status", filters.status);
    const query = params.toString();
    return request<ValidationRun[]>(`/validation/runs${query ? `?${query}` : ""}`);
  },
  getValidationRun: (id: string) => request<ValidationRun>(`/validation/runs/${encodeURIComponent(id)}`),
  // Run + latest job + per-segment detail; polled while a run is QUEUED/RUNNING.
  getValidationRunStatus: (id: string) => request<ValidationRun>(`/validation/runs/${encodeURIComponent(id)}/status`),
  getValidationSegments: (id: string) =>
    request<ValidationSegment[]>(`/validation/runs/${encodeURIComponent(id)}/segments`),
  getValidationResults: (validationRunId: string) =>
    request<ValidationResult[]>(`/validation/runs/${encodeURIComponent(validationRunId)}/results`),
  // Validation errors (missing config, bad grid, too many windows) carry a friendly `error` message on 400/404 — inspect the body.
  createOutOfSampleValidation: (input: OutOfSampleValidationRequest) =>
    rawRequest<CreateValidationOutcome>("/validation/out-of-sample", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createWalkForwardValidation: (input: WalkForwardValidationRequest) =>
    rawRequest<CreateValidationOutcome>("/validation/walk-forward", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Phase 15.6 — create an out-of-sample run that validates optimizer output on a held-out window.
  createValidationFromOptimizerResult: (resultId: string, input: FromOptimizerValidationInput) =>
    rawRequest<CreateValidationOutcome>(`/validation/from-optimizer-result/${encodeURIComponent(resultId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createValidationFromOptimizerSession: (sessionId: string, input: FromOptimizerValidationInput) =>
    rawRequest<CreateValidationOutcome>(`/validation/from-optimizer-session/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  previewValidationSplits: (input: PreviewSplitsInput) =>
    rawRequest<PreviewSplitsOutcome>("/validation/preview-splits", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Phase 15.6 — enqueue a validation run (202 {run, job}); the embedded worker executes it.
  runValidation: (id: string) =>
    rawRequest<EnqueueValidationOutcome>(`/validation/runs/${encodeURIComponent(id)}/run`, { method: "POST" }),
  cancelValidationRun: (id: string) =>
    request<ValidationRun>(`/validation/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  // Promote a validated result into a NEW deployment (always disabled + autopilot OFF — not overridable).
  createDeploymentFromValidationResult: (resultId: string, name?: string) =>
    rawRequest<StrategyDeployment | { error: string }>(
      `/validation/results/${encodeURIComponent(resultId)}/create-deployment`,
      { method: "POST", body: JSON.stringify({ name }) }
    ),
  deleteValidationRun: (id: string) =>
    fetch(`${BASE_URL}/validation/runs/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`Failed to delete validation run ${id}`);
    }),

  getResearchDashboard: () => request<ResearchDashboard>("/research/dashboard"),
  getResearchLeaderboard: (filters: LeaderboardFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.strategy) params.set("strategy", filters.strategy);
    if (filters.symbol) params.set("symbol", filters.symbol);
    if (filters.timeframe) params.set("timeframe", filters.timeframe);
    if (filters.validationType) params.set("validationType", filters.validationType);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.tag) params.set("tag", filters.tag);
    if (filters.sort) params.set("sort", filters.sort);
    const query = params.toString();
    return request<LeaderboardRow[]>(`/research/leaderboard${query ? `?${query}` : ""}`);
  },
  getResearchScorecards: () => request<ValidationScorecard[]>("/research/scorecards"),
  getResearchCandidates: () => request<DeploymentCandidate[]>("/research/candidates"),
  createResearchCandidate: (input: { validationRunId?: string; validationResultId?: string; name?: string; notes?: string }) =>
    request<DeploymentCandidate>("/research/candidates", { method: "POST", body: JSON.stringify(input) }),
  updateResearchCandidate: (id: string, patch: { status?: CandidateStatus; name?: string; notes?: string | null }) =>
    request<DeploymentCandidate>(`/research/candidates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deployResearchCandidate: (id: string, deploymentName?: string) =>
    rawRequest<StrategyDeployment | { error: string }>(`/research/candidates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ deploy: true, deploymentName }),
    }),
  compareValidationRuns: (ids: string[]) =>
    request<CompareValidationRow[]>(`/research/compare?ids=${encodeURIComponent(ids.join(","))}`),
  getValidationTags: () => request<ValidationTag[]>("/research/tags"),
  createValidationTag: (input: { name: string; color?: string | null; validationRunId?: string }) =>
    request<ValidationTag>("/research/tags", { method: "POST", body: JSON.stringify(input) }),
  assignValidationTag: (tagId: string, validationRunId: string) =>
    request<{ ok: boolean }>(`/research/tags/${encodeURIComponent(tagId)}/runs`, {
      method: "POST",
      body: JSON.stringify({ validationRunId }),
    }),
  removeValidationTag: (tagId: string, validationRunId: string) =>
    fetch(`${BASE_URL}/research/tags/${encodeURIComponent(tagId)}/runs/${encodeURIComponent(validationRunId)}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => {
      if (!r.ok) throw new Error("Failed to remove validation tag");
    }),
  deleteValidationTag: (tagId: string) =>
    fetch(`${BASE_URL}/research/tags/${encodeURIComponent(tagId)}`, { method: "DELETE", credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error("Failed to delete validation tag");
    }),
  getValidationNotes: (validationRunId?: string) =>
    request<ValidationNote[]>(`/research/notes${validationRunId ? `?validationRunId=${encodeURIComponent(validationRunId)}` : ""}`),
  createValidationNote: (input: { validationRunId: string; note: string }) =>
    request<ValidationNote>("/research/notes", { method: "POST", body: JSON.stringify(input) }),
  updateValidationNote: (id: string, note: string) =>
    request<ValidationNote>(`/research/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    }),
  deleteValidationNote: (id: string) =>
    fetch(`${BASE_URL}/research/notes/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error("Failed to delete validation note");
    }),

  // Phase 15.7 — ranking pipeline (scores/ranks optimizer + validation candidates).
  getRankingProfiles: () => request<RankingProfile[]>("/ranking/profiles"),
  createRankingProfile: (input: {
    name: string;
    description?: string;
    weights?: Partial<RankingWeights>;
    thresholds?: Partial<RankingThresholds>;
    isDefault?: boolean;
  }) => request<RankingProfile>("/ranking/profiles", { method: "POST", body: JSON.stringify(input) }),
  getRankingRuns: (filters: { sourceType?: RankingSourceType; sourceId?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.sourceType) params.set("sourceType", filters.sourceType);
    if (filters.sourceId) params.set("sourceId", filters.sourceId);
    const query = params.toString();
    return request<RankingRun[]>(`/ranking/runs${query ? `?${query}` : ""}`);
  },
  getRankingRun: (id: string) => request<RankingRun>(`/ranking/runs/${encodeURIComponent(id)}`),
  deleteRankingRun: (id: string) =>
    fetch(`${BASE_URL}/ranking/runs/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error("Failed to delete ranking run");
    }),
  rankOptimizerSession: (optimizerSessionId: string, profileId?: string) =>
    rawRequest<RankingRun | { error: string }>(`/ranking/from-optimizer-session/${encodeURIComponent(optimizerSessionId)}`, {
      method: "POST",
      body: JSON.stringify({ profileId }),
    }),
  rankValidationRun: (validationRunId: string, profileId?: string) =>
    rawRequest<RankingRun | { error: string }>(`/ranking/from-validation-run/${encodeURIComponent(validationRunId)}`, {
      method: "POST",
      body: JSON.stringify({ profileId }),
    }),

  // Phase 15.8 — research-to-deployment review workflow. Pure review/recommendation:
  // nothing here places an order, calls the broker, or enables a deployment/autopilot.
  getResearchReviewRuns: (filters: { sourceType?: ReviewSourceType; sourceId?: string; status?: ReviewRunStatus } = {}) => {
    const params = new URLSearchParams();
    if (filters.sourceType) params.set("sourceType", filters.sourceType);
    if (filters.sourceId) params.set("sourceId", filters.sourceId);
    if (filters.status) params.set("status", filters.status);
    const query = params.toString();
    return request<ResearchReviewRun[]>(`/research-review/runs${query ? `?${query}` : ""}`);
  },
  getResearchReviewRun: (id: string) => request<ResearchReviewRun>(`/research-review/runs/${encodeURIComponent(id)}`),
  deleteResearchReviewRun: (id: string) =>
    fetch(`${BASE_URL}/research-review/runs/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error("Failed to delete review run");
    }),
  reviewFromRankingResult: (rankingResultId: string) =>
    rawRequest<ResearchReviewRun | { error: string }>(`/research-review/from-ranking-result/${encodeURIComponent(rankingResultId)}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  reviewFromValidationResult: (validationResultId: string) =>
    rawRequest<ResearchReviewRun | { error: string }>(`/research-review/from-validation-result/${encodeURIComponent(validationResultId)}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  reviewFromOptimizerResult: (optimizerResultId: string) =>
    rawRequest<ResearchReviewRun | { error: string }>(`/research-review/from-optimizer-result/${encodeURIComponent(optimizerResultId)}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  recordReviewDecision: (id: string, decision: ReviewDecisionType, note: string) =>
    rawRequest<ResearchReviewRun | { error: string }>(`/research-review/runs/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }),
  createReviewDeploymentCandidate: (id: string, name?: string) =>
    rawRequest<StrategyDeployment | { error: string }>(`/research-review/runs/${encodeURIComponent(id)}/create-deployment-candidate`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  // OANDA practice/demo broker connection — read-only. No order placement exists.
  getOandaPracticeStatus: () => request<OandaPracticeStatus>("/broker/oanda/practice/status"),
  // Explicit practice/live boundary status — drives UI labeling, never inferred from account labels alone.
  getOandaBrokerModeStatus: () => request<OandaBrokerModeStatus>("/broker/oanda/mode-status"),
  // Broker reads can fail cleanly (not configured / OANDA error) — callers inspect the body instead of catching.
  getOandaPracticeAccountSummary: () =>
    rawRequest<BrokerAccountSummary | BrokerErrorResponse>("/broker/oanda/practice/account-summary"),
  getOandaPracticeAccountDetails: () =>
    rawRequest<BrokerAccountSummary | BrokerErrorResponse>("/broker/oanda/practice/account-details"),
  getOandaPracticePositions: () =>
    rawRequest<BrokerPosition[] | BrokerErrorResponse>("/broker/oanda/practice/positions"),
  getOandaPracticeTrades: () => rawRequest<BrokerTrade[] | BrokerErrorResponse>("/broker/oanda/practice/trades"),
  getOandaPracticeInstruments: () =>
    rawRequest<BrokerInstrument[] | BrokerErrorResponse>("/broker/oanda/practice/instruments"),
  getOandaPracticePricing: (instruments: string[]) =>
    rawRequest<BrokerPriceSnapshot[] | BrokerErrorResponse>(
      `/broker/oanda/practice/pricing?instruments=${encodeURIComponent(instruments.join(","))}`
    ),

  // Phase 9 — OANDA practice-only manual demo order ticket. previewManualOrder never places an
  // order; confirmManualOrder is the only call in this client that can. Errors carry a friendly
  // `error`/`message` body — callers inspect it instead of catching.
  previewManualOrder: (input: ManualOrderPreviewRequest) =>
    rawRequest<ManualOrderPreviewResponse | BrokerErrorResponse>("/broker/oanda/practice/orders/preview", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  confirmManualOrder: (input: ManualOrderConfirmRequest) =>
    rawRequest<ManualOrderConfirmResponse | BrokerErrorResponse>("/broker/oanda/practice/orders/confirm", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getManualOrderHistory: () => request<ManualOrderHistoryEntry[]>("/broker/oanda/practice/orders/history"),

  // Phase 11 — OANDA practice-only position close / flatten. The preview-* calls never mutate
  // broker state; only the confirm-* calls can, and only against practice/demo after a fresh,
  // unexpired, unblocked, token-matched preview. Errors carry a friendly `error`/`message` body.
  previewCloseTrade: (input: { tradeId: string; units?: string | number }) =>
    rawRequest<ManualClosePreview | BrokerErrorResponse>("/broker/oanda/practice/close/preview-trade", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  confirmCloseTrade: (input: ManualCloseConfirmRequest) =>
    rawRequest<ManualCloseExecution | BrokerErrorResponse>("/broker/oanda/practice/close/confirm-trade", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  previewClosePosition: (input: { instrument: string; side: ClosePositionSide; units?: string | number }) =>
    rawRequest<ManualClosePreview | BrokerErrorResponse>("/broker/oanda/practice/close/preview-position", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  confirmClosePosition: (input: ManualCloseConfirmRequest) =>
    rawRequest<ManualCloseExecution | BrokerErrorResponse>("/broker/oanda/practice/close/confirm-position", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  previewFlattenAll: (input: { allowFlattenAll: boolean }) =>
    rawRequest<ManualClosePreview | BrokerErrorResponse>("/broker/oanda/practice/close/preview-flatten-all", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  confirmFlattenAll: (input: ManualCloseConfirmRequest) =>
    rawRequest<ManualCloseExecution | BrokerErrorResponse>("/broker/oanda/practice/close/confirm-flatten-all", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getManualCloseHistory: () => request<ManualCloseHistoryEntry[]>("/broker/oanda/practice/close/history"),

  // --- Phase 17.0: Forward/Paper Trading Ledger (practice-only; no broker order path) ---
  getPaperTradingWorkerStatus: () => request<PaperTradingWorkerStatus>("/paper-trading/worker/status"),
  getOpenPaperPositions: () => request<PaperPosition[]>("/paper-trading/positions"),
  getPaperTradingDashboard: (status?: PaperRunStatus) => {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<PaperRunDashboardSummary[]>(`/paper-trading/dashboard${query}`);
  },
  // --- Phase 17.6: Paper Trading Forward Leaderboard + Comparison (read-only) ---
  getPaperLeaderboard: (filters: PaperLeaderboardFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.strategyId) params.set("strategyId", filters.strategyId);
    if (filters.instrument) params.set("instrument", filters.instrument);
    if (filters.timeframe) params.set("timeframe", filters.timeframe);
    if (filters.deploymentId) params.set("deploymentId", filters.deploymentId);
    if (filters.sizingPolicy) params.set("sizingPolicy", filters.sizingPolicy);
    if (filters.hasOpenPosition !== undefined) params.set("hasOpenPosition", String(filters.hasOpenPosition));
    if (filters.hasClosedTrades !== undefined) params.set("hasClosedTrades", String(filters.hasClosedTrades));
    const query = params.toString();
    return request<PaperLeaderboardResponse>(`/paper-trading/leaderboard${query ? `?${query}` : ""}`);
  },
  comparePaperRuns: (runIds: string[]) =>
    request<PaperComparisonResponse>(`/paper-trading/compare?runIds=${encodeURIComponent(runIds.join(","))}`),

  getPaperRuns: (deploymentId?: string, status?: PaperRunStatus) => {
    const params = new URLSearchParams();
    if (deploymentId) params.set("deploymentId", deploymentId);
    if (status) params.set("status", status);
    const query = params.toString();
    return request<PaperRun[]>(`/paper-trading/runs${query ? `?${query}` : ""}`);
  },
  createPaperRun: (input: CreatePaperRunInput) =>
    request<PaperRun>("/paper-trading/runs", { method: "POST", body: JSON.stringify(input) }),
  getPaperRun: (id: string) => request<PaperRun>(`/paper-trading/runs/${encodeURIComponent(id)}`),
  getPaperRunDetail: (id: string) => request<PaperRunDetail>(`/paper-trading/runs/${encodeURIComponent(id)}/detail`),
  pausePaperRun: (id: string) => request<PaperRun>(`/paper-trading/runs/${encodeURIComponent(id)}/pause`, { method: "POST" }),
  resumePaperRun: (id: string) =>
    request<PaperRun>(`/paper-trading/runs/${encodeURIComponent(id)}/resume`, { method: "POST" }),
  stopPaperRun: (id: string) => request<PaperRun>(`/paper-trading/runs/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  tickPaperRun: (id: string) =>
    request<{ result: PaperTickResult; run: PaperRun | null }>(`/paper-trading/runs/${encodeURIComponent(id)}/tick`, {
      method: "POST",
    }),
  getPaperRunPosition: (id: string) => request<PaperPosition | null>(`/paper-trading/runs/${encodeURIComponent(id)}/position`),
  getPaperRunTrades: (id: string, limit = 25) =>
    request<PaperTrade[]>(`/paper-trading/runs/${encodeURIComponent(id)}/trades?limit=${limit}`),
  getPaperRunDecisions: (id: string, limit = 25) =>
    request<PaperDecision[]>(`/paper-trading/runs/${encodeURIComponent(id)}/decisions?limit=${limit}`),
  getPaperRunEquity: (id: string, limit = 200) =>
    request<PaperEquitySnapshot[]>(`/paper-trading/runs/${encodeURIComponent(id)}/equity?limit=${limit}`),

  // --- Phase 17.7: Paper Run Portfolio / Multi-Strategy Start Wizard (read-only candidates + paper-only batch create) ---
  getPaperRunCandidates: (filters: PaperRunCandidateFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.strategyId) params.set("strategyId", filters.strategyId);
    if (filters.instrument) params.set("instrument", filters.instrument);
    if (filters.timeframe) params.set("timeframe", filters.timeframe);
    if (filters.deploymentStatus) params.set("deploymentStatus", filters.deploymentStatus);
    if (filters.enabled !== undefined) params.set("enabled", String(filters.enabled));
    if (filters.autopilot !== undefined) params.set("autopilot", String(filters.autopilot));
    if (filters.sourceType) params.set("sourceType", filters.sourceType);
    if (filters.hasActiveRun !== undefined) params.set("hasActiveRun", String(filters.hasActiveRun));
    const query = params.toString();
    return request<PaperRunCandidate[]>(`/paper-trading/candidates${query ? `?${query}` : ""}`);
  },
  getPaperPortfolioSummary: () => request<PaperPortfolioSummary>("/paper-trading/portfolio"),
  batchCreatePaperRuns: (input: BatchCreatePaperRunInput) =>
    request<BatchCreatePaperRunResponse>("/paper-trading/runs/batch", { method: "POST", body: JSON.stringify(input) }),

  // --- Phase 18.0: Portfolio Intelligence (read-only analytical layer) ---
  getPortfolioIntelligenceStatus: () =>
    request<Phase18LatestState>("/portfolio-intelligence/status"),
  runPhase18Analysis: () =>
    request<Phase18RunResult>("/portfolio-intelligence/run-analysis", { method: "POST" }),
  getPortfolioRegimes: () =>
    request<RegimeSnapshot[]>("/portfolio-intelligence/regimes"),
  getRegimeHistory: (symbol: string, granularity: string, limit = 50) =>
    request<RegimeSnapshot[]>(`/portfolio-intelligence/regimes/${encodeURIComponent(symbol)}/${encodeURIComponent(granularity)}/history?limit=${limit}`),
  getPortfolioHealth: () =>
    request<HealthSnapshot[]>("/portfolio-intelligence/health"),
  getDeploymentHealth: (deploymentId: string) =>
    request<HealthSnapshot>(`/portfolio-intelligence/health/${encodeURIComponent(deploymentId)}`),
  getPortfolioCorrelations: () =>
    request<CorrelationRow[]>("/portfolio-intelligence/correlations"),
  getPortfolioAllocations: () =>
    request<AllocationRecommendation[]>("/portfolio-intelligence/allocations"),
  getPortfolioSnapshot: () =>
    request<PortfolioSnapshot>("/portfolio-intelligence/snapshot/latest"),
  getPortfolioSnapshots: (limit = 20) =>
    request<PortfolioSnapshot[]>(`/portfolio-intelligence/snapshots?limit=${limit}`),
  getPortfolioRecommendations: (status?: RecommendationStatus, limit = 100) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("limit", String(limit));
    return request<PortfolioRecommendation[]>(`/portfolio-intelligence/recommendations?${params.toString()}`);
  },
  resolvePortfolioRecommendation: (id: string, action: "DISMISSED" | "RESOLVED", note?: string) =>
    request<PortfolioRecommendation>(`/portfolio-intelligence/recommendations/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, note }),
    }),

  // --- Phase 18.2: Job tracking + scheduler ---
  getLatestIntelligenceJob: () =>
    request<IntelligenceJob>("/portfolio-intelligence/jobs/latest"),
  getIntelligenceJobHistory: (limit = 20) =>
    request<IntelligenceJob[]>(`/portfolio-intelligence/jobs/history?limit=${limit}`),
  getPortfolioSchedulerStatus: () =>
    request<SchedulerStatus>("/portfolio-intelligence/scheduler/status"),

  // --- Phase 18.3: History / visualization ---
  getSnapshotHistory: (limit = 100) =>
    request<PortfolioSnapshot[]>(`/portfolio-intelligence/history/snapshots?limit=${limit}`),
  getRegimeTimeline: (limit = 100) =>
    request<RegimeSnapshot[]>(`/portfolio-intelligence/history/regimes/timeline?limit=${limit}`),
  getHealthHistory: (deploymentId: string, limit = 100) =>
    request<HealthSnapshot[]>(`/portfolio-intelligence/history/health/${encodeURIComponent(deploymentId)}?limit=${limit}`),
  getAllocationHistory: (deploymentId: string, limit = 100) =>
    request<AllocationRecommendation[]>(`/portfolio-intelligence/history/allocations/${encodeURIComponent(deploymentId)}?limit=${limit}`),
  getCorrelationHistory: (limit = 100) =>
    request<CorrelationRow[]>(`/portfolio-intelligence/history/correlations?limit=${limit}`),
  getRecommendationAnalytics: (limit = 50) =>
    request<RecommendationAnalytics>(`/portfolio-intelligence/recommendations/analytics?limit=${limit}`),
};
