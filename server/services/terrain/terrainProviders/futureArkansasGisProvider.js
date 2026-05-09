/**
 * Future provider stub — Arkansas GIS Elevation Service.
 *
 * TODO: Wire this provider when the Arkansas GIS elevation endpoint is confirmed.
 *
 * Candidate endpoint (Arkansas GIS Office):
 *   https://gis.arkansas.gov/arcgis/rest/services/Elevation/...
 *
 * Expected return format (match all providers):
 * {
 *   available: true,
 *   source: "future_arkansas_gis",
 *   samples: [{ lat, lng, elevationFt }],
 *   elevationMinFt: number,
 *   elevationMaxFt: number,
 *   elevationChangeFt: number,
 *   averageGradePercent: number|null,
 *   maxGradePercent: number|null,
 * }
 *
 * Notes:
 *   - May require an Arkansas GIS portal account
 *   - Potentially higher resolution for AR than national USGS dataset
 *   - NWA region (Benton/Washington counties) may have LiDAR-quality data
 */

export async function fetchElevationData(_input) {
  return { available: false, source: "future_arkansas_gis", reason: "not_implemented" };
}
