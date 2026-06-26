/**
 * Phase 18 — Strategy–Regime Compatibility Matrix.
 *
 * Config-based scoring of how well a deployment's strategy type matches the
 * current detected regime. Returns a 0–100 score with an explanation.
 * Pure read-only — never mutates any row.
 */
import type { MarketRegime } from "./regimeEngine.service.js";

export interface CompatibilityScore {
  score: number;
  label: "EXCELLENT" | "GOOD" | "NEUTRAL" | "POOR" | "AVOID";
  reason: string;
}

/** Preferred and avoided regimes per strategy family. Keyed by strategy id prefix or family tag. */
const STRATEGY_REGIME_PROFILES: Array<{
  match: (strategyId: string) => boolean;
  preferred: MarketRegime[];
  avoided: MarketRegime[];
  label: string;
}> = [
  {
    label: "trend-following",
    match: (id) => /trend|moving.average|ma.cross|breakout|momentum/i.test(id),
    preferred: ["TRENDING", "STRONG_TREND", "BREAKOUT"],
    avoided: ["RANGING", "MEAN_REVERSION_FRIENDLY", "LOW_VOLATILITY"],
  },
  {
    label: "mean-reversion",
    match: (id) => /mean.reversion|reversion|rsi|bollinger|oscillat|counter/i.test(id),
    preferred: ["RANGING", "MEAN_REVERSION_FRIENDLY", "LOW_VOLATILITY"],
    avoided: ["STRONG_TREND", "BREAKOUT", "HIGH_VOLATILITY"],
  },
  {
    label: "breakout",
    match: (id) => /breakout|range.break|channel/i.test(id),
    preferred: ["BREAKOUT", "HIGH_VOLATILITY", "TRENDING"],
    avoided: ["RANGING", "LOW_VOLATILITY"],
  },
  {
    label: "scalping",
    match: (id) => /scalp|pip|micro/i.test(id),
    preferred: ["RANGING", "WEAK_TREND", "MEAN_REVERSION_FRIENDLY"],
    avoided: ["HIGH_VOLATILITY", "STRONG_TREND"],
  },
];

const REGIME_SCORES: Record<string, number> = {
  preferred: 90,
  neutral: 50,
  avoided: 15,
};

/**
 * Score how well a deployment's strategy matches the given regime.
 * Returns 0–100 with an explanation label.
 */
export function scoreRegimeCompatibility(strategyId: string, regime: MarketRegime): CompatibilityScore {
  if (regime === "UNKNOWN") {
    return { score: 40, label: "NEUTRAL", reason: "Regime is UNKNOWN — cannot assess compatibility" };
  }

  const profile = STRATEGY_REGIME_PROFILES.find((p) => p.match(strategyId));

  if (!profile) {
    return { score: 50, label: "NEUTRAL", reason: `No regime profile for strategy "${strategyId}" — defaulting to neutral` };
  }

  if (profile.preferred.includes(regime)) {
    return {
      score: REGIME_SCORES.preferred,
      label: "EXCELLENT",
      reason: `${profile.label} strategy aligns well with ${regime} regime`,
    };
  }

  if (profile.avoided.includes(regime)) {
    return {
      score: REGIME_SCORES.avoided,
      label: "AVOID",
      reason: `${profile.label} strategy typically underperforms in ${regime} regime`,
    };
  }

  return {
    score: REGIME_SCORES.neutral,
    label: "NEUTRAL",
    reason: `${profile.label} strategy is compatible but not optimal for ${regime} regime`,
  };
}

/** Convert a 0–100 CompatibilityScore score to a 0–1 regime match weight. */
export function regimeMatchWeight(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}
