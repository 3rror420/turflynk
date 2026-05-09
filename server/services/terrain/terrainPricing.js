/**
 * Terrain pricing integration — applies terrain multiplier to an existing estimate.
 *
 * Only active when TERRAIN_MODE=pricing_enabled AND terrain.available=true.
 * Always a no-op otherwise.
 *
 * Future pricing hooks (TODO — do not implement yet):
 *   - Bella Vista rocky-terrain regional adjustment
 *   - Hillside minimum pricing floor
 *   - Provider-specific terrain tolerances
 *   - Admin-controlled per-terrain-category overrides
 *   - Steep mowable area % surcharge
 *   - Equipment deck-size surcharge
 */

/**
 * Apply terrain multiplier to estimate + breakdown.
 * Mutates breakdown in-place (consistent with existing engine pattern).
 *
 * @param {number} estimate  current estimate before terrain adj
 * @param {Array}  breakdown current breakdown array
 * @param {object} terrain   result from terrainCalculator
 * @param {object} settings  app settings (unused for now)
 * @returns {{ estimate: number, breakdown: Array }}
 */
export function applyTerrainPricing(estimate, breakdown, terrain, settings = {}) {
  if (!terrain || !terrain.enabled || terrain.mode !== "pricing_enabled") {
    return { estimate, breakdown };
  }
  if (!terrain.available) {
    return { estimate, breakdown };
  }
  const multiplier = terrain.priceMultiplier || 1.0;
  if (multiplier <= 1.0) {
    return { estimate, breakdown };
  }

  const adj = estimate * (multiplier - 1);
  const adjRounded = Math.round(adj * 100) / 100;
  if (adjRounded <= 0) return { estimate, breakdown };

  const pct = Math.round((multiplier - 1) * 100);
  estimate = estimate * multiplier;
  breakdown.push({
    label: `Terrain difficulty — ${terrain.difficultyCategory} (+${pct}%)`,
    amount: adjRounded
  });

  return { estimate, breakdown };
}
