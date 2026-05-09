/**
 * USGS EPQS / 3DEP elevation provider.
 *
 * Endpoint: https://epqs.nationalmap.gov/v1/json
 * Query:    ?x=<lng>&y=<lat>&units=Feet&wkid=4326&includeDate=false
 *
 * Supports: timeout, retries, partial failures, invalid/missing responses.
 * NEVER throws into the quote flow — always returns a safe result.
 */

import fetch from "node-fetch";
import { generateSamplePoints } from "../terrainSampling.js";
import { computeGradeStats } from "../terrainGradeCalc.js";

const USGS_BASE = "https://epqs.nationalmap.gov/v1/json";
const MAX_RETRIES = 2;

function providerTimeout() {
  const t = parseInt(process.env.TERRAIN_PROVIDER_TIMEOUT_MS || "8000", 10);
  return isNaN(t) ? 8000 : Math.max(1000, Math.min(t, 30000));
}

/**
 * Fetch elevation for a single point with timeout + retry.
 *
 * @param {{ lat: number, lng: number }} pt
 * @param {number} timeoutMs
 * @returns {Promise<number|null>}  elevation in feet, or null on failure
 */
async function fetchOnePoint(pt, timeoutMs) {
  const url = `${USGS_BASE}?x=${pt.lng}&y=${pt.lat}&units=Feet&wkid=4326&includeDate=false`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let controller;
    let timer;
    try {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) continue;

      const json = await res.json();

      // USGS EPQS v1 response shape: { value: "123.45" } or { value: -1000000 } for no-data
      const raw = json?.value ?? json?.elevation;
      const elev = parseFloat(raw);
      if (!isFinite(elev) || elev < -500 || elev > 30000) continue; // sanity bounds

      return elev;
    } catch (_) {
      clearTimeout(timer);
      // timeout or network error — try again
    }
  }
  return null;
}

/**
 * Fetch elevation data for all sample points in parallel.
 * Partial failures are tolerated — only valid points are used.
 *
 * @param {{
 *   parcelGeoJson?: object,
 *   mowableGeoJson?: object,
 *   lat?: number,
 *   lng?: number,
 *   address?: string,
 * }} input
 * @returns {Promise<object>}  Normalized provider result (never throws)
 */
export async function fetchElevationData(input) {
  try {
    const timeoutMs = providerTimeout();
    const { points, source: sampleSource } = generateSamplePoints(input);

    if (points.length === 0) {
      return { available: false, source: "usgs_epqs", reason: "no_sample_points" };
    }

    // Fetch all points in parallel
    const results = await Promise.all(
      points.map(async (pt) => {
        const elevationFt = await fetchOnePoint(pt, timeoutMs);
        return { lat: pt.lat, lng: pt.lng, elevationFt };
      })
    );

    // Only keep successful samples
    const valid = results.filter((r) => r.elevationFt !== null);

    if (valid.length === 0) {
      return { available: false, source: "usgs_epqs", reason: "all_points_failed" };
    }

    const elevations = valid.map((r) => r.elevationFt);
    const elevationMinFt = Math.min(...elevations);
    const elevationMaxFt = Math.max(...elevations);
    const elevationChangeFt = Math.abs(elevationMaxFt - elevationMinFt);

    const { averageGradePercent, maxGradePercent } = computeGradeStats(valid);

    return {
      available: true,
      source: "usgs_epqs",
      sampleSource,
      sampledCount: valid.length,
      requestedCount: points.length,

      samples: valid,

      elevationMinFt,
      elevationMaxFt,
      elevationChangeFt,
      averageGradePercent,
      maxGradePercent,
    };
  } catch (err) {
    // Never propagate — return safe fallback
    return { available: false, source: "usgs_epqs", reason: "provider_error", detail: err?.message };
  }
}
