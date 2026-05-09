/**
 * Grade / slope calculations from elevation sample pairs.
 * Pure functions — no I/O.
 *
 * Uses haversine distance between points so grade is accurate
 * regardless of lat/lng degree spacing.
 */

const EARTH_RADIUS_FT = 20902231; // mean Earth radius in feet

/**
 * Haversine distance between two lat/lng points, in feet.
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @returns {number}
 */
function haversineDistFt(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Compute average and max grade percent from a set of elevation samples.
 * Compares each adjacent pair (sorted by lat then lng for reproducibility).
 * Clamps to physically plausible values (max 100%).
 *
 * @param {Array<{ lat: number, lng: number, elevationFt: number }>} samples
 * @returns {{ averageGradePercent: number|null, maxGradePercent: number|null }}
 */
export function computeGradeStats(samples) {
  if (!samples || samples.length < 2) {
    return { averageGradePercent: null, maxGradePercent: null };
  }

  // Sort for stable pair ordering
  const sorted = [...samples].sort((a, b) =>
    a.lat !== b.lat ? a.lat - b.lat : a.lng - b.lng
  );

  const grades = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const distFt = haversineDistFt(a, b);
    if (distFt < 1) continue; // skip duplicate/collocated points

    const elevDiff = Math.abs((b.elevationFt ?? 0) - (a.elevationFt ?? 0));
    const grade = (elevDiff / distFt) * 100;

    // Clamp: >100% grade is physically implausible for lawn terrain
    if (grade <= 100) grades.push(grade);
  }

  if (grades.length === 0) return { averageGradePercent: null, maxGradePercent: null };

  const avg = grades.reduce((s, g) => s + g, 0) / grades.length;
  const max = Math.max(...grades);

  return {
    averageGradePercent: Math.round(avg * 100) / 100,
    maxGradePercent:     Math.round(max * 100) / 100,
  };
}
