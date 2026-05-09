/**
 * Lightweight in-memory terrain elevation cache.
 *
 * Cache key: provider + rounded sample coordinates (1 decimal place ≈ 11 km grid)
 * TTL: TERRAIN_CACHE_TTL_HOURS (default 168 = 1 week)
 *
 * Failures during cache lookup/store NEVER break the calling flow.
 */

/** @type {Map<string, { data: object, expiresAt: number }>} */
const _cache = new Map();

function ttlMs() {
  const hours = parseFloat(process.env.TERRAIN_CACHE_TTL_HOURS || "168");
  return (isNaN(hours) ? 168 : Math.max(0.01, hours)) * 60 * 60 * 1000;
}

/**
 * Build a cache key from provider name and sample points.
 * Rounds coordinates to 4 decimal places (≈ 11 m precision) for cache stability.
 *
 * @param {string} provider
 * @param {Array<{ lat: number, lng: number }>} points
 * @returns {string}
 */
export function buildCacheKey(provider, points) {
  const rounded = [...points]
    .sort((a, b) => a.lat - b.lat || a.lng - b.lng)
    .map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`)
    .join("|");
  return `${provider}:${rounded}`;
}

/**
 * Retrieve a cached elevation result, or null if absent/expired.
 * @param {string} key
 * @returns {object|null}
 */
export function cacheGet(key) {
  try {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      _cache.delete(key);
      return null;
    }
    return entry.data;
  } catch (_) {
    return null;
  }
}

/**
 * Store an elevation result in the cache.
 * @param {string} key
 * @param {object} data
 */
export function cacheSet(key, data) {
  try {
    _cache.set(key, { data, expiresAt: Date.now() + ttlMs() });

    // Evict expired entries when cache grows large (simple GC)
    if (_cache.size > 500) {
      const now = Date.now();
      for (const [k, v] of _cache) {
        if (now > v.expiresAt) _cache.delete(k);
      }
    }
  } catch (_) {
    // cache failure is silent
  }
}

/** Return current cache size (for admin diagnostics). */
export function cacheSize() {
  return _cache.size;
}

/** Clear the entire cache (admin test endpoint). */
export function cacheClear() {
  _cache.clear();
}
