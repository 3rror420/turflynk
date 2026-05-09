/**
 * Terrain guardrail — determines whether instant booking should be blocked
 * based on terrain difficulty and admin-configured thresholds.
 *
 * Called after calculateTerrain() with the loaded terrain settings.
 * Never throws; always returns a safe guardrail object.
 *
 * terrainGuardrail shape:
 *   { instantBookingAllowed, manualReviewRequired, reasonCode, message }
 *
 * reasonCodes:
 *   terrain_ok               — all checks pass
 *   terrain_score_too_high   — difficultyScore > instantBookingMaxScore
 *   terrain_category_too_high — category above instantBookingMaxCategory threshold
 *   terrain_extreme_blocked  — blockExtremeInstantPay=true and category=Extreme
 *   terrain_unavailable      — terrain not enabled / not available (never blocks)
 */

export const DEFAULT_TERRAIN_MANUAL_REVIEW_MESSAGE =
  "Extreme terrain or steep slope was detected in the selected mowing area. " +
  "Online booking is paused for this property so we can manually verify safe access and accurate pricing. " +
  "If you believe this is incorrect, please contact us and we'll review it.";

const CATEGORY_ORDER = { Flat: 0, Moderate: 1, High: 2, Extreme: 3 };
const DEFAULT_MAX_CATEGORY = "High";
const DEFAULT_MAX_SCORE = 8.0;

/**
 * Compute the terrain guardrail for a terrain object + admin settings.
 *
 * @param {object} terrain   - Result from calculateTerrain()
 * @param {object} settings  - Terrain settings from loadTerrainSettings()
 * @returns {{ instantBookingAllowed: boolean, manualReviewRequired: boolean, reasonCode: string, message: string|null }}
 */
export function computeTerrainGuardrail(terrain, settings = {}) {
  if (!terrain || !terrain.enabled || !terrain.available || terrain.mode === "off") {
    return {
      instantBookingAllowed: true,
      manualReviewRequired: false,
      reasonCode: "terrain_unavailable",
      message: null,
    };
  }

  const maxCategory      = settings.instantBookingMaxCategory || DEFAULT_MAX_CATEGORY;
  const maxScore         = settings.instantBookingMaxScore != null
    ? Number(settings.instantBookingMaxScore) : DEFAULT_MAX_SCORE;
  const blockExtreme     = settings.blockExtremeInstantPay !== false;
  const reviewMessage    = settings.manualReviewMessage || DEFAULT_TERRAIN_MANUAL_REVIEW_MESSAGE;

  const category         = terrain.difficultyCategory || "Flat";
  const score            = Number(terrain.difficultyScore || 0);
  const categoryRank     = CATEGORY_ORDER[category]    ?? 0;
  const maxCategoryRank  = CATEGORY_ORDER[maxCategory] ?? CATEGORY_ORDER[DEFAULT_MAX_CATEGORY];

  let blocked    = false;
  let reasonCode = "terrain_ok";

  // Priority 1: explicit extreme block (admin checkbox overrides everything)
  if (blockExtreme && category === "Extreme") {
    blocked    = true;
    reasonCode = "terrain_extreme_blocked";
  }

  // Priority 2: score exceeds max
  if (!blocked && score > maxScore) {
    blocked    = true;
    reasonCode = "terrain_score_too_high";
  }

  // Priority 3: category above threshold
  if (!blocked && categoryRank > maxCategoryRank) {
    blocked    = true;
    reasonCode = "terrain_category_too_high";
  }

  return {
    instantBookingAllowed: !blocked,
    manualReviewRequired:  blocked,
    reasonCode,
    message: blocked ? reviewMessage : null,
  };
}
