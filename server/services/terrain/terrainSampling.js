/**
 * Terrain sampling — generate lat/lng sample points from a GeoJSON polygon.
 *
 * Prefers mowableGeoJson over parcelGeoJson.
 * Always includes the polygon centroid.
 * Uses a grid-inside-bbox approach with ray-cast point-in-polygon — no turf dep required.
 */

/**
 * @typedef {{ lat: number, lng: number }} SamplePoint
 */

/** How many sample points to generate (overridden by TERRAIN_SAMPLE_POINTS env). */
function samplePointCount() {
  const n = parseInt(process.env.TERRAIN_SAMPLE_POINTS || "9", 10);
  return (isNaN(n) || n < 1) ? 9 : Math.min(n, 50);
}

/**
 * Extract the first Polygon ring coords from a GeoJSON feature/collection/geometry.
 * Returns null if not found.
 *
 * @param {object} geo
 * @returns {Array<[number,number]>|null}  array of [lng, lat] pairs
 */
function extractRing(geo) {
  if (!geo) return null;

  const tryGeom = (g) => {
    if (!g) return null;
    if (g.type === "Polygon") return g.coordinates?.[0] || null;
    if (g.type === "MultiPolygon") return g.coordinates?.[0]?.[0] || null;
    return null;
  };

  if (geo.type === "Feature") return tryGeom(geo.geometry);
  if (geo.type === "FeatureCollection") {
    for (const f of (geo.features || [])) {
      const ring = tryGeom(f?.geometry);
      if (ring) return ring;
    }
    return null;
  }
  return tryGeom(geo);
}

/**
 * Ray-cast point-in-polygon test.
 * @param {number} px  longitude
 * @param {number} py  latitude
 * @param {Array<[number,number]>} ring  [lng,lat] pairs
 */
function pointInPolygon(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Compute centroid of a ring.
 * @param {Array<[number,number]>} ring
 * @returns {{ lng: number, lat: number }}
 */
function centroid(ring) {
  let sumLng = 0, sumLat = 0;
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  for (const [lng, lat] of pts) { sumLng += lng; sumLat += lat; }
  return { lng: sumLng / pts.length, lat: sumLat / pts.length };
}

/**
 * Generate up to `targetCount` points inside a ring using a grid.
 * Always includes the centroid.
 *
 * @param {Array<[number,number]>} ring
 * @param {number} targetCount
 * @returns {SamplePoint[]}
 */
function gridSampleRing(ring, targetCount) {
  if (!ring || ring.length < 3) return [];

  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);

  const cen = centroid(ring);
  const points = [{ lat: cen.lat, lng: cen.lng }];

  if (targetCount <= 1) return points;

  // Grid cells per axis — aim for targetCount-1 interior candidates
  const gridN = Math.ceil(Math.sqrt((targetCount - 1) * 4));
  const stepLng = (maxLng - minLng) / (gridN + 1);
  const stepLat = (maxLat - minLat) / (gridN + 1);

  for (let r = 1; r <= gridN && points.length < targetCount; r++) {
    for (let c = 1; c <= gridN && points.length < targetCount; c++) {
      const lng = minLng + c * stepLng;
      const lat = minLat + r * stepLat;
      if (pointInPolygon(lng, lat, ring)) {
        points.push({ lat, lng });
      }
    }
  }

  return points;
}

/**
 * Generate sample points for terrain analysis.
 *
 * @param {{
 *   mowableGeoJson?: object,
 *   parcelGeoJson?: object,
 *   lat?: number,
 *   lng?: number,
 * }} input
 * @returns {{ points: SamplePoint[], source: string }}
 */
export function generateSamplePoints(input = {}) {
  const count = samplePointCount();

  // Prefer mowable polygon, fall back to parcel
  let ring = null;
  let source = "none";

  if (input.mowableGeoJson) {
    ring = extractRing(input.mowableGeoJson);
    if (ring) source = "mowable";
  }
  if (!ring && input.parcelGeoJson) {
    ring = extractRing(input.parcelGeoJson);
    if (ring) source = "parcel";
  }

  if (ring) {
    const points = gridSampleRing(ring, count);
    if (points.length > 0) return { points, source };
  }

  // Final fallback: single center point from lat/lng
  if (input.lat != null && input.lng != null) {
    return { points: [{ lat: Number(input.lat), lng: Number(input.lng) }], source: "center" };
  }

  return { points: [], source: "none" };
}
