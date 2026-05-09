/**
 * Placeholder terrain provider — safe no-op for Phase 1.
 *
 * Returns source:"none", available:false.  Never throws, never blocks quotes.
 * Replace / supplement with a real provider when elevation data is ready.
 *
 * Future provider hooks (plug in here when ready):
 *   - Arkansas GIS elevation service (gis.arkansas.gov)
 *   - Benton County GIS parcel elevation layers
 *   - USGS 3DEP / National Elevation Dataset (ned.usgs.gov)
 *   - OpenTopoData / ArcGIS elevation services
 *   - DEM raster tile sampling (GDAL / gdal2tiles)
 *   - LiDAR point-cloud processing
 *   - Contour dataset intersection (Turf.js)
 */

/**
 * @param {{
 *   parcelGeoJson?: object,
 *   mowableGeoJson?: object,
 *   lat?: number,
 *   lng?: number,
 *   address?: string
 * }} input
 * @returns {Promise<{available:false, source:"none"}>}
 */
export async function fetchElevationData(input) {
  // Phase-1: no live data source wired yet.
  // When a real provider is ready, return:
  // {
  //   available: true,
  //   source: "api",           // or "estimated"
  //   elevationMinFt: number,
  //   elevationMaxFt: number,
  //   sampledPoints: [...],    // raw elevation samples
  //   provider: "arkansas_gis" | "usgs_3dep" | ...
  // }
  return { available: false, source: "none" };
}
