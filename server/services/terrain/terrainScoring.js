/**
 * Terrain difficulty scoring — pure functions, no I/O.
 *
 * Difficulty thresholds (conservative):
 *   Flat     (score 0–2):  elevChange < 10 ft,  avgGrade < 4%
 *   Moderate (score 3–5):  elevChange 10–30 ft, avgGrade 4–8%
 *   High     (score 6–8):  elevChange 30–70 ft, avgGrade 8–15%
 *   Extreme  (score 9–10): elevChange 70+ ft,   avgGrade 15%+
 *
 * Returns 0 (Flat) when elevation data is unavailable — safe default.
 */

/** @param {number} score */
export function categoryFromScore(score) {
  if (score <= 2) return "Flat";
  if (score <= 5) return "Moderate";
  if (score <= 8) return "High";
  return "Extreme";
}

/**
 * Derive a 0–10 difficulty score from raw elevation data.
 *
 * Scoring components:
 *   Elevation change (0–4 pts):  70 ft = max (conservative — 100 ft raw cap)
 *   Average grade   (0–3 pts):  15% = max
 *   Max grade       (0–3 pts):  30% = max
 *
 * @param {{
 *   elevationMinFt?: number|null,
 *   elevationMaxFt?: number|null,
 *   averageGradePercent?: number|null,
 *   maxGradePercent?: number|null,
 * }} data
 */
export function scoreFromElevationData(data) {
  if (!data || data.elevationMinFt == null || data.elevationMaxFt == null) return 0;

  const changeFt = Math.abs((data.elevationMaxFt || 0) - (data.elevationMinFt || 0));
  const avgGrade = Math.min(data.averageGradePercent || 0, 100);
  const maxGrade = Math.min(data.maxGradePercent     || 0, 100);

  // Elevation-change component (0–4 pts): 70 ft → max (conservative cap)
  // 0–10 ft ≈ 0–0.57,  10–30 ft ≈ 0.57–1.71,  30–70 ft ≈ 1.71–4
  const changeScore = Math.min(4, changeFt / 17.5);

  // Average grade component (0–3 pts): 15% → max
  const avgGradeScore = Math.min(3, avgGrade / 5);

  // Max grade component (0–3 pts): 30% → max
  const maxGradeScore = Math.min(3, maxGrade / 10);

  const raw = changeScore + avgGradeScore + maxGradeScore;
  return Math.min(10, Math.max(0, Math.round(raw * 10) / 10));
}

/**
 * Convert difficulty score to a normalized price multiplier.
 * Flat (0) → 1.0x  |  Extreme (10) → up to TERRAIN_PRICE_MULTIPLIER_MAX.
 *
 * @param {number} score  0–10
 * @param {number} maxMultiplier  from config, default 2.0
 */
export function priceMultiplierFromScore(score, maxMultiplier = 2.0) {
  if (score <= 0) return 1.0;
  const range = maxMultiplier - 1.0;
  const multiplier = 1.0 + (score / 10) * range;
  return Math.round(multiplier * 1000) / 1000;
}

/**
 * Infer terrain direction from elevation data.
 * @returns {"flat"|"uphill"|"downhill"|"mixed"}
 */
export function terrainDirection(data) {
  if (!data || data.elevationMinFt == null || data.elevationMaxFt == null) return "flat";
  const change = Math.abs((data.elevationMaxFt || 0) - (data.elevationMinFt || 0));
  if (change < 5) return "flat";
  return "mixed";
}
