/**
 * Future provider stub — ESRI ArcGIS Elevation Service.
 *
 * TODO: Wire this provider when an ESRI API key is available.
 *
 * Expected endpoint:
 *   https://elevation.arcgis.com/arcgis/rest/services/WorldElevation/MapServer/exts/ElevationSync/ElevationSync
 *
 * Expected return format (match all providers):
 * {
 *   available: true,
 *   source: "future_esri",
 *   samples: [{ lat, lng, elevationFt }],
 *   elevationMinFt: number,
 *   elevationMaxFt: number,
 *   elevationChangeFt: number,
 *   averageGradePercent: number|null,
 *   maxGradePercent: number|null,
 * }
 *
 * Notes:
 *   - Requires an ArcGIS Online subscription or token
 *   - Supports batch point queries for efficiency
 *   - Returns meters — convert to feet (* 3.28084)
 */

export async function fetchElevationData(_input) {
  return { available: false, source: "future_esri", reason: "not_implemented" };
}
