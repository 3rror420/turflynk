/**
 * Terrain Calculator — entry point for the terrain/elevation difficulty system.
 *
 * TERRAIN_MODE controls behavior:
 *   "off"             → returns a disabled stub; no provider calls, zero cost impact
 *   "display_only"    → calls provider, returns terrain object, NO pricing effect
 *   "pricing_enabled" → calls provider + applies multiplier when available
 *
 * Provider routing is handled by terrainProviders/index.js.
 * Results are cached in terrainCache.js (TTL from TERRAIN_CACHE_TTL_HOURS).
 * Fails gracefully: any provider error returns available:false, never blocks quotes.
 *
 * Usage:
 *   import { calculateTerrain } from './server/services/terrain/terrainCalculator.js';
 *   const terrain = await calculateTerrain({ lat, lng, parcelGeoJson, mowableGeoJson, address });
 */

import { fetchElevationData, currentProviderName } from "./terrainProviders/index.js";
import { generateSamplePoints }                    from "./terrainSampling.js";
import { scoreFromElevationData, categoryFromScore, priceMultiplierFromScore, terrainDirection as inferDirection }
  from "./terrainScoring.js";
import { horizonStyle, slopeMeterPercent, buildCustomerExplanation }
  from "./terrainVisualization.js";
import { buildCacheKey, cacheGet, cacheSet }       from "./terrainCache.js";

/** Read terrain config from process.env (or admin settings override). */
function readConfig(adminOverrides = {}) {
  const rawMode = (adminOverrides.mode || process.env.TERRAIN_MODE || "off").toLowerCase().trim();
  const mode =
    rawMode === "display_only"    ? "display_only"    :
    rawMode === "pricing_enabled" ? "pricing_enabled" : "off";

  const providerName = (adminOverrides.provider || process.env.TERRAIN_ELEVATION_PROVIDER || "usgs_epqs")
    .toLowerCase().trim();

  return {
    mode,
    enabled: mode !== "off",
    providerName,
    debug:            (process.env.TERRAIN_DEBUG || "false").toLowerCase() === "true",
    maxMultiplier:    Math.max(1.0, parseFloat(process.env.TERRAIN_PRICE_MULTIPLIER_MAX || "2.0") || 2.0),
    customerUIEnabled: (process.env.TERRAIN_ENABLE_CUSTOMER_UI || "true").toLowerCase() !== "false",
  };
}

/** Safe disabled stub returned when mode=off. */
function disabledStub(config) {
  return {
    enabled:    false,
    mode:       "off",
    available:  false,
    source:     "none",
    provider:   config.providerName || "none",

    elevationMinFt:            null,
    elevationMaxFt:            null,
    elevationChangeFt:         null,
    averageGradePercent:       null,
    maxGradePercent:           null,
    terrainFragmentationScore: null,

    difficultyScore:    0,
    difficultyCategory: "Flat",
    terrainDirection:   "flat",
    priceMultiplier:    1.0,

    customerExplanation: null,

    indicators: {
      horizonStyle:      "━━━━━━━━━━",
      slopeMeterPercent: 0,
    },

    debug: config.debug ? { mode: "off", reason: "TERRAIN_MODE=off" } : {},
  };
}

/**
 * Calculate terrain object for a given quote input.
 *
 * @param {{
 *   parcelGeoJson?:   object,
 *   mowableGeoJson?:  object,
 *   lat?:    number,
 *   lng?:    number,
 *   address?: string,
 *   _adminOverrides?: { mode?: string, provider?: string },
 * }} input
 * @returns {Promise<object>}  Normalized terrain object (never throws).
 */
export async function calculateTerrain(input = {}) {
  const config = readConfig(input._adminOverrides || {});

  if (!config.enabled) return disabledStub(config);

  let rawData       = { available: false, source: "none" };
  let providerError = null;
  let cacheHit      = false;

  try {
    // Build cache key from sample points
    const { points } = generateSamplePoints(input);
    const cacheKey = points.length > 0
      ? buildCacheKey(config.providerName, points)
      : null;

    if (cacheKey) {
      const cached = cacheGet(cacheKey);
      if (cached) {
        rawData  = cached;
        cacheHit = true;
      }
    }

    if (!cacheHit) {
      rawData = await fetchElevationData(input, config.providerName);
      if (cacheKey && rawData?.available) {
        cacheSet(cacheKey, rawData);
      }
    }
  } catch (err) {
    providerError = err.message;
    rawData = { available: false, source: "none" };
  }

  const available = Boolean(rawData && rawData.available);
  const source    = rawData?.source || "none";

  const elevMinFt  = available ? (rawData.elevationMinFt  ?? null) : null;
  const elevMaxFt  = available ? (rawData.elevationMaxFt  ?? null) : null;
  const elevChgFt  = (elevMinFt !== null && elevMaxFt !== null)
    ? Math.abs(elevMaxFt - elevMinFt) : null;

  const avgGrade = available ? (rawData.averageGradePercent ?? null) : null;
  const maxGrade = available ? (rawData.maxGradePercent     ?? null) : null;

  const score    = available ? scoreFromElevationData(rawData) : 0;
  const category = categoryFromScore(score);
  const direction = inferDirection(rawData);

  const multiplier =
    (config.mode === "pricing_enabled" && available)
      ? priceMultiplierFromScore(score, config.maxMultiplier)
      : 1.0;

  const showCustomerUI =
    config.customerUIEnabled &&
    available &&
    (config.mode === "display_only" || config.mode === "pricing_enabled");

  const terrain = {
    enabled:  true,
    mode:     config.mode,
    provider: config.providerName,

    available,
    source,

    elevationMinFt:            elevMinFt,
    elevationMaxFt:            elevMaxFt,
    elevationChangeFt:         elevChgFt,
    averageGradePercent:       avgGrade,
    maxGradePercent:           maxGrade,
    terrainFragmentationScore: null,

    difficultyScore:    score,
    difficultyCategory: category,
    terrainDirection:   direction,

    priceMultiplier: multiplier,

    customerExplanation: showCustomerUI
      ? buildCustomerExplanation({ difficultyCategory: category, elevationChangeFt: elevChgFt, averageGradePercent: avgGrade, mode: config.mode })
      : null,

    indicators: {
      horizonStyle:      horizonStyle(score),
      slopeMeterPercent: slopeMeterPercent(score),
    },

    debug: config.debug ? {
      mode:          config.mode,
      providerName:  config.providerName,
      maxMultiplier: config.maxMultiplier,
      cacheHit,
      providerError: providerError || null,
      rawData,
    } : {},
  };

  return terrain;
}
