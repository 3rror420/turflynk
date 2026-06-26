/**
 * Phase 18 — Market Regime Engine.
 *
 * Classifies current market conditions per symbol/timeframe using ADX, ATR,
 * realized volatility, MA slope, and range compression. Results are persisted
 * as market_regimes snapshots. Pure analysis — no broker/order/deployment mutation.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/db.js";

export type MarketRegime =
  | "TRENDING"
  | "STRONG_TREND"
  | "WEAK_TREND"
  | "RANGING"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "BREAKOUT"
  | "MEAN_REVERSION_FRIENDLY"
  | "UNKNOWN";

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

interface RegimeRow {
  id: string;
  symbol: string;
  granularity: string;
  candle_time: string;
  detected_at: string;
  regime: string;
  trend_strength: number | null;
  volatility_score: number | null;
  adx: number | null;
  atr: number | null;
  atr_percentile: number | null;
  confidence: number;
  reasons_json: string;
  created_at: string;
}

function mapRow(r: RegimeRow): RegimeSnapshot {
  return {
    id: r.id,
    symbol: r.symbol,
    granularity: r.granularity,
    candleTime: r.candle_time,
    detectedAt: r.detected_at,
    regime: r.regime as MarketRegime,
    trendStrength: r.trend_strength,
    volatilityScore: r.volatility_score,
    adx: r.adx,
    atr: r.atr,
    atrPercentile: r.atr_percentile,
    confidence: r.confidence,
    reasons: JSON.parse(r.reasons_json) as string[],
    createdAt: r.created_at,
  };
}

interface CandleRow {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Compute Simple Moving Average of the last `n` values in `arr`. */
function sma(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  const slice = arr.slice(arr.length - n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

/** True range at index k (k >= 1). */
function trueRange(highs: number[], lows: number[], closes: number[], k: number): number {
  return Math.max(highs[k] - lows[k], Math.abs(highs[k] - closes[k - 1]), Math.abs(lows[k] - closes[k - 1]));
}

/** ATR over last `period` bars. */
function computeAtr(highs: number[], lows: number[], closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let sum = 0;
  for (let k = closes.length - period; k < closes.length; k++) {
    sum += trueRange(highs, lows, closes, k);
  }
  return sum / period;
}

/** ADX via Wilder smoothing. Returns {adx, plusDI, minusDI} or null if insufficient data. */
function computeAdx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): { adx: number; plusDI: number; minusDI: number } | null {
  const need = 2 * period + 1;
  if (closes.length < need) return null;

  const n = closes.length;
  const dms: Array<{ plus: number; minus: number; tr: number }> = [];
  for (let k = 1; k < n; k++) {
    const upMove = highs[k] - highs[k - 1];
    const downMove = lows[k - 1] - lows[k];
    const plus = upMove > downMove && upMove > 0 ? upMove : 0;
    const minus = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = trueRange(highs, lows, closes, k);
    dms.push({ plus, minus, tr });
  }

  let trS = 0, plusS = 0, minusS = 0;
  for (let k = 0; k < period; k++) {
    trS += dms[k].tr;
    plusS += dms[k].plus;
    minusS += dms[k].minus;
  }

  const pdi = () => (trS === 0 ? 0 : (100 * plusS) / trS);
  const mdi = () => (trS === 0 ? 0 : (100 * minusS) / trS);
  const dx = (p: number, m: number) => (p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m));

  const dxVals: number[] = [dx(pdi(), mdi())];
  for (let k = period; k < dms.length; k++) {
    trS = trS - trS / period + dms[k].tr;
    plusS = plusS - plusS / period + dms[k].plus;
    minusS = minusS - minusS / period + dms[k].minus;
    dxVals.push(dx(pdi(), mdi()));
  }

  if (dxVals.length < period) return null;
  let adxVal = 0;
  for (let j = 0; j < period; j++) adxVal += dxVals[j];
  adxVal /= period;
  for (let j = period; j < dxVals.length; j++) {
    adxVal = (adxVal * (period - 1) + dxVals[j]) / period;
  }

  return { adx: adxVal, plusDI: pdi(), minusDI: mdi() };
}

/** Realized volatility: std dev of log returns over last `window` bars. */
function realizedVolatility(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null;
  const slice = closes.slice(closes.length - window - 1);
  const logReturns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0) logReturns.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (logReturns.length === 0) return null;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance);
}

/** ATR percentile: where current ATR sits within the last `lookback` ATR readings. */
function atrPercentile(currentAtr: number, historicalAtrs: number[]): number {
  if (historicalAtrs.length === 0) return 50;
  const below = historicalAtrs.filter((a) => a <= currentAtr).length;
  return (below / historicalAtrs.length) * 100;
}

/**
 * Classify regime from computed indicators.
 * Returns a deterministic classification with a reasons array.
 */
function classifyRegime(inputs: {
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
  atrPctile: number | null;
  realizedVol: number | null;
  maSlope: number | null;
}): { regime: MarketRegime; confidence: number; reasons: string[] } {
  const reasons: string[] = [];

  if (inputs.adx === null) {
    return { regime: "UNKNOWN", confidence: 0, reasons: ["Insufficient candle data for ADX calculation"] };
  }

  const adx = inputs.adx;
  const atrPct = inputs.atrPctile ?? 50;

  // High volatility takes priority if ATR percentile is very high
  if (atrPct > 85) {
    reasons.push(`ATR at ${atrPct.toFixed(0)}th percentile — elevated volatility`);
    if (adx > 25) reasons.push(`ADX ${adx.toFixed(1)} confirms directional volatility`);
    return { regime: "HIGH_VOLATILITY", confidence: 0.7 + (atrPct - 85) / 100, reasons };
  }

  // Strong trend
  if (adx >= 40) {
    reasons.push(`ADX ${adx.toFixed(1)} — strong directional pressure`);
    if (inputs.maSlope !== null && inputs.maSlope > 0) reasons.push("MA slope positive — uptrend");
    else if (inputs.maSlope !== null && inputs.maSlope < 0) reasons.push("MA slope negative — downtrend");
    return { regime: "STRONG_TREND", confidence: Math.min(0.95, 0.7 + (adx - 40) / 100), reasons };
  }

  // Trending
  if (adx >= 25) {
    reasons.push(`ADX ${adx.toFixed(1)} — moderate trend`);
    // Check for breakout: recent high volatility spike
    if (atrPct > 65) {
      reasons.push(`ATR ${atrPct.toFixed(0)}th pct — range expansion consistent with breakout`);
      return { regime: "BREAKOUT", confidence: 0.65, reasons };
    }
    return { regime: "TRENDING", confidence: 0.6 + (adx - 25) / 100, reasons };
  }

  // Weak trend
  if (adx >= 15) {
    reasons.push(`ADX ${adx.toFixed(1)} — weak/nascent trend`);
    if (atrPct < 40) {
      reasons.push(`ATR at ${atrPct.toFixed(0)}th pct — compressed range`);
      return { regime: "MEAN_REVERSION_FRIENDLY", confidence: 0.55, reasons };
    }
    return { regime: "WEAK_TREND", confidence: 0.5, reasons };
  }

  // Ranging / low volatility
  if (atrPct < 25) {
    reasons.push(`ADX ${adx.toFixed(1)} — no trend; ATR ${atrPct.toFixed(0)}th pct — low volatility`);
    return { regime: "LOW_VOLATILITY", confidence: 0.65, reasons };
  }

  reasons.push(`ADX ${adx.toFixed(1)} — no significant trend; price range-bound`);
  return { regime: "RANGING", confidence: 0.6, reasons };
}

/**
 * Detect the current regime for a symbol/timeframe using stored candles.
 * Uses the most recent `lookback` candles. Persists the snapshot and returns it.
 */
export function detectRegime(symbol: string, granularity: string, lookback = 100): RegimeSnapshot {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT time, open, high, low, close FROM candles
       WHERE instrument = ? AND timeframe = ?
       ORDER BY time DESC LIMIT ?`
    )
    .all(symbol, granularity, lookback) as CandleRow[];

  if (rows.length < 30) {
    // Use the latest available candle time as the key, or a stable per-symbol
    // sentinel when there are no candles at all. This prevents duplicate rows
    // when detectRegime is called multiple times before new candles arrive.
    const candleTime = rows[0]?.time ?? `NO_DATA:${symbol}:${granularity}`;
    const existing = db
      .prepare(`SELECT * FROM market_regimes WHERE symbol = ? AND granularity = ? AND candle_time = ? LIMIT 1`)
      .get(symbol, granularity, candleTime) as RegimeRow | undefined;
    if (existing) return mapRow(existing);

    const snap: RegimeSnapshot = {
      id: randomUUID(),
      symbol,
      granularity,
      candleTime,
      detectedAt: now,
      regime: "UNKNOWN",
      trendStrength: null,
      volatilityScore: null,
      adx: null,
      atr: null,
      atrPercentile: null,
      confidence: 0,
      reasons: ["Insufficient candle data (need ≥ 30 bars)"],
      createdAt: now,
    };
    persistRegime(snap);
    return snap;
  }

  // Reverse so oldest-first for indicator math
  const candles = [...rows].reverse();
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const latestCandleTime = candles[candles.length - 1].time;

  const adxResult = computeAdx(highs, lows, closes, 14);
  const atrVal = computeAtr(highs, lows, closes, 14);

  // Compute ATR history for percentile (use windows of 14 over available data)
  const historicalAtrs: number[] = [];
  for (let i = 15; i < candles.length; i++) {
    const h = highs.slice(0, i);
    const l = lows.slice(0, i);
    const cl = closes.slice(0, i);
    const a = computeAtr(h, l, cl, 14);
    if (a !== null) historicalAtrs.push(a);
  }
  const atrPct = atrVal !== null && historicalAtrs.length > 0 ? atrPercentile(atrVal, historicalAtrs) : null;

  // MA slope: compare 20-period SMA now vs 5 bars ago
  const smaFull = sma(closes, 20);
  const smaPrev = sma(closes.slice(0, closes.length - 5), 20);
  const maSlope = smaFull !== null && smaPrev !== null ? smaFull - smaPrev : null;

  const realVol = realizedVolatility(closes, 20);
  const volScore = realVol !== null ? Math.min(1, realVol * 100) : null;

  const classified = classifyRegime({
    adx: adxResult?.adx ?? null,
    plusDI: adxResult?.plusDI ?? null,
    minusDI: adxResult?.minusDI ?? null,
    atrPctile: atrPct,
    realizedVol: realVol,
    maSlope,
  });

  const snap: RegimeSnapshot = {
    id: randomUUID(),
    symbol,
    granularity,
    candleTime: latestCandleTime,
    detectedAt: now,
    regime: classified.regime,
    trendStrength: adxResult?.adx ?? null,
    volatilityScore: volScore,
    adx: adxResult?.adx ?? null,
    atr: atrVal,
    atrPercentile: atrPct,
    confidence: classified.confidence,
    reasons: classified.reasons,
    createdAt: now,
  };

  persistRegime(snap);
  return snap;
}

function persistRegime(snap: RegimeSnapshot): void {
  // Skip insert when a snapshot for the same candle bar already exists — prevents
  // unbounded table growth when analysis is run repeatedly on the same candle data.
  const existing = db
    .prepare(`SELECT id FROM market_regimes WHERE symbol = ? AND granularity = ? AND candle_time = ? LIMIT 1`)
    .get(snap.symbol, snap.granularity, snap.candleTime);
  if (existing) return;

  db.prepare(
    `INSERT INTO market_regimes
     (id, symbol, granularity, candle_time, detected_at, regime, trend_strength, volatility_score,
      adx, atr, atr_percentile, confidence, reasons_json, created_at)
     VALUES (@id, @symbol, @granularity, @candleTime, @detectedAt, @regime, @trendStrength,
             @volatilityScore, @adx, @atr, @atrPercentile, @confidence, @reasonsJson, @createdAt)`
  ).run({
    id: snap.id,
    symbol: snap.symbol,
    granularity: snap.granularity,
    candleTime: snap.candleTime,
    detectedAt: snap.detectedAt,
    regime: snap.regime,
    trendStrength: snap.trendStrength,
    volatilityScore: snap.volatilityScore,
    adx: snap.adx,
    atr: snap.atr,
    atrPercentile: snap.atrPercentile,
    confidence: snap.confidence,
    reasonsJson: JSON.stringify(snap.reasons),
    createdAt: snap.createdAt,
  });
}

/** Latest regime snapshot for a given symbol/granularity, or null. */
export function getLatestRegime(symbol: string, granularity: string): RegimeSnapshot | null {
  const row = db
    .prepare(
      `SELECT * FROM market_regimes WHERE symbol = ? AND granularity = ?
       ORDER BY detected_at DESC LIMIT 1`
    )
    .get(symbol, granularity) as RegimeRow | undefined;
  return row ? mapRow(row) : null;
}

/** Regime history for a symbol/granularity, newest first. */
export function listRegimeHistory(symbol: string, granularity: string, limit = 50): RegimeSnapshot[] {
  const rows = db
    .prepare(
      `SELECT * FROM market_regimes WHERE symbol = ? AND granularity = ?
       ORDER BY detected_at DESC LIMIT ?`
    )
    .all(symbol, granularity, Math.min(limit, 200)) as RegimeRow[];
  return rows.map(mapRow);
}

/** All latest regime snapshots — one per symbol/granularity combination. */
export function listCurrentRegimes(): RegimeSnapshot[] {
  const rows = db
    .prepare(
      `SELECT r.* FROM market_regimes r
       INNER JOIN (
         SELECT symbol, granularity, MAX(detected_at) AS max_at
         FROM market_regimes GROUP BY symbol, granularity
       ) latest ON r.symbol = latest.symbol AND r.granularity = latest.granularity
                AND r.detected_at = latest.max_at
       ORDER BY r.symbol, r.granularity`
    )
    .all() as RegimeRow[];
  return rows.map(mapRow);
}
