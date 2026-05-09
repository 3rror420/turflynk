/**
 * Future provider stub — Benton County GIS Elevation.
 *
 * TODO: Wire this provider when Benton County parcel elevation layers are available.
 *
 * Candidate source:
 *   Benton County GIS open data portal (arcgis.com/bentonco)
 *   May expose elevation via parcel or contour layer.
 *
 * Expected return format (match all providers):
 * {
 *   available: true,
 *   source: "future_benton_county_gis",
 *   samples: [{ lat, lng, elevationFt }],
 *   elevationMinFt: number,
 *   elevationMaxFt: number,
 *   elevationChangeFt: number,
 *   averageGradePercent: number|null,
 *   maxGradePercent: number|null,
 * }
 *
 * Notes:
 *   - County-level data may cover only Benton County (Rogers, Bentonville, Bella Vista, etc.)
 *   - Potentially highest local accuracy for NWA hillside properties
 *   - May need bbox or parcel-ID lookup rather than point query
 */

export async function fetchElevationData(_input) {
  return { available: false, source: "future_benton_county_gis", reason: "not_implemented" };
}
