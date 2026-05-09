/**
 * Terrain provider selector.
 *
 * Reads TERRAIN_ELEVATION_PROVIDER and routes to the correct provider.
 * Falls back to placeholderProvider on unknown or future-stub providers.
 * NEVER throws into the quote flow.
 *
 * Supported values for TERRAIN_ELEVATION_PROVIDER:
 *   usgs_epqs             — USGS EPQS / 3DEP (live, national coverage)
 *   placeholder           — safe no-op, always returns available:false
 *   future_esri           — stub, returns available:false
 *   future_arkansas_gis   — stub, returns available:false
 *   future_benton_county_gis — stub, returns available:false
 */

import { fetchElevationData as usgsEpqsFetch }          from "./usgsEpqsProvider.js";
import { fetchElevationData as placeholderFetch }        from "./placeholderProvider.js";
import { fetchElevationData as futureEsriFetch }         from "./futureEsriProvider.js";
import { fetchElevationData as futureArkansasFetch }     from "./futureArkansasGisProvider.js";
import { fetchElevationData as futureBentonCountyFetch } from "./futureBentonCountyProvider.js";

const PROVIDERS = {
  usgs_epqs:                usgsEpqsFetch,
  placeholder:              placeholderFetch,
  future_esri:              futureEsriFetch,
  future_arkansas_gis:      futureArkansasFetch,
  future_benton_county_gis: futureBentonCountyFetch,
};

/** Read provider name from env (or admin override passed at runtime). */
function resolveProviderName(override) {
  const name = (override || process.env.TERRAIN_ELEVATION_PROVIDER || "usgs_epqs")
    .toLowerCase().trim();
  return PROVIDERS[name] ? name : "usgs_epqs";
}

/**
 * Fetch elevation data using the configured or overridden provider.
 *
 * @param {object} input  same shape as terrainCalculator input
 * @param {string} [providerOverride]  optional runtime override (admin test)
 * @returns {Promise<object>}  normalized elevation result, never throws
 */
export async function fetchElevationData(input, providerOverride) {
  const providerName = resolveProviderName(providerOverride);
  const fn = PROVIDERS[providerName] || placeholderFetch;

  try {
    const result = await fn(input);
    return result || { available: false, source: providerName, reason: "empty_response" };
  } catch (err) {
    return { available: false, source: providerName, reason: "provider_threw", detail: err?.message };
  }
}

/** Return the list of known provider names (for admin UI / validation). */
export function listProviders() {
  return Object.keys(PROVIDERS);
}

/** Return currently configured provider name. */
export function currentProviderName(override) {
  return resolveProviderName(override);
}
