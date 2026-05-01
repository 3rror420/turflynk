import io
import json
import math
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union
from shapely.prepared import prep


app = FastAPI(
    title="TurfLynk Vision Service",
    version="0.2.0",
    description="Satellite-imagery heuristic mowable-area detection clipped to parcel geometry.",
)

SQFT_PER_SQM = 10.76391041671
TILE_SIZE = 256
DEFAULT_ZOOM = 19
MIN_ZOOM = 17
MAX_ZOOM = 20
MAX_TILE_COUNT = 36
CELL_SIZE_PX = 10
MIN_VEGETATION_RATIO = 0.42
MIN_FEATURE_AREA_SQFT = 80.0
DEFAULT_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
DEFAULT_NAIP_EXPORT_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
NAIP_BBOX_PADDING_RATIO = 0.08
NAIP_MIN_PADDING_DEGREES = 0.00008
NAIP_MIN_IMAGE_SIZE = 256
NAIP_MAX_IMAGE_SIZE = 2200
NAIP_PIXEL_SIZE_METERS = 0.6


class DetectMowableRequest(BaseModel):
    parcelGeoJson: Dict[str, Any]
    parcelFeature: Optional[Dict[str, Any]] = None
    center: Optional[Dict[str, float]] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    zoom: Optional[float] = None
    source: Optional[str] = None
    imageSource: Optional[Dict[str, Any]] = None
    address: Optional[str] = None
    debugArtifacts: bool = False


def empty_feature_collection() -> Dict[str, Any]:
    return {"type": "FeatureCollection", "features": []}


def vision_log_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, default=str, separators=(",", ":"))
    return str(value)


def optional_env_float(name: str) -> Optional[float]:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return None
    return float(value)


def env_float(names: Tuple[str, ...], default: float) -> float:
    for name in names:
        value = os.environ.get(name)
        if value is not None and value.strip() != "":
            return float(value)
    return default


def log_naip_diagnostics(diagnostic: Dict[str, Any], reject_reason: str = "") -> None:
    print(f"[Vision] NAIP bbox={vision_log_value(diagnostic.get('bbox'))}", flush=True)
    print(f"[Vision] NAIP status={vision_log_value(diagnostic.get('status'))}", flush=True)
    print(f"[Vision] NAIP bytes={vision_log_value(diagnostic.get('bytes'))}", flush=True)
    print(f"[Vision] raster bands={vision_log_value(diagnostic.get('rasterBands'))}", flush=True)
    print(f"[Vision] raster size={vision_log_value([diagnostic.get('rasterWidth'), diagnostic.get('rasterHeight')])}", flush=True)
    print(f"[Vision] raster CRS={vision_log_value(diagnostic.get('rasterCrs'))}", flush=True)
    print(f"[Vision] usedNir={vision_log_value(diagnostic.get('usedNir'))}", flush=True)
    if diagnostic.get("naipNirWarning"):
        print(f"[Vision] {diagnostic.get('naipNirWarning')}", flush=True)
    print(f"[Vision] vegetationPixels={vision_log_value(diagnostic.get('vegetationPixels'))}", flush=True)
    print(f"[Vision] polygonCount={vision_log_value(diagnostic.get('polygonCount'))}", flush=True)
    print(f"[Vision] detectedAreaSqm={vision_log_value(diagnostic.get('detectedAreaSqm'))}", flush=True)
    print(f"[Vision] ndviThreshold={vision_log_value(diagnostic.get('ndviThreshold'))}", flush=True)
    print(f"[Vision] visibleThreshold={vision_log_value(diagnostic.get('visibleThreshold'))}", flush=True)
    print(f"[Vision] brightnessMin={vision_log_value(diagnostic.get('brightnessMin'))}", flush=True)
    print(f"[Vision] excessGreenMin={vision_log_value(diagnostic.get('excessGreenMin'))}", flush=True)
    print(f"[Vision] saturationMin={vision_log_value(diagnostic.get('saturationMin'))}", flush=True)
    print(f"[Vision] strictDetectedRatio={vision_log_value(diagnostic.get('strictDetectedRatio'))}", flush=True)
    print(f"[Vision] softDetectedRatio={vision_log_value(diagnostic.get('softDetectedRatio'))}", flush=True)
    print(f"[Vision] fallbackSoftMaskUsed={vision_log_value(diagnostic.get('fallbackSoftMaskUsed'))}", flush=True)
    print(f"[Vision] debugRunDir={vision_log_value(diagnostic.get('debugRunDir'))}", flush=True)
    print(f"[Vision] confidence={vision_log_value(diagnostic.get('confidence'))}", flush=True)
    print(f"[Vision] reject reason={reject_reason or diagnostic.get('reason') or 'none'}", flush=True)


def estimate_utm_epsg(lng: float, lat: float) -> str:
    zone = int((lng + 180.0) // 6.0) + 1
    epsg = 32600 + zone if lat >= 0 else 32700 + zone
    return f"EPSG:{epsg}"


def transform_geometry(geom: BaseGeometry, source_crs: str, target_crs: str) -> BaseGeometry:
    transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)
    return shapely_transform(transformer.transform, geom)


def geometry_from_geojson(parcel_geojson: Dict[str, Any]) -> BaseGeometry:
    if not parcel_geojson:
        raise HTTPException(status_code=400, detail="parcelGeoJson is required.")

    candidate = parcel_geojson
    if parcel_geojson.get("type") == "Feature":
        candidate = parcel_geojson.get("geometry") or {}
    elif parcel_geojson.get("type") == "FeatureCollection":
        geometries = [
            shape(feature.get("geometry"))
            for feature in parcel_geojson.get("features", [])
            if feature.get("geometry")
        ]
        if not geometries:
            raise HTTPException(status_code=400, detail="parcelGeoJson has no geometries.")
        return unary_union(geometries)

    try:
        return shape(candidate)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid parcelGeoJson: {exc}") from exc


def polygon_parts(geom: BaseGeometry) -> List[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [part for part in getattr(geom, "geoms", []) if isinstance(part, Polygon)]


def area_sqft(geom: BaseGeometry) -> float:
    if geom.is_empty:
        return 0.0
    centroid = geom.centroid
    projected = transform_geometry(geom, "EPSG:4326", estimate_utm_epsg(centroid.x, centroid.y))
    return projected.area * SQFT_PER_SQM


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def lng_lat_to_tile(lng: float, lat: float, zoom: int) -> Tuple[int, int]:
    lat = max(-85.05112878, min(85.05112878, lat))
    n = 2 ** zoom
    x = int((lng + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return clamp(x, 0, n - 1), clamp(y, 0, n - 1)


def lng_lat_to_global_pixel(lng: float, lat: float, zoom: int) -> Tuple[float, float]:
    lat = max(-85.05112878, min(85.05112878, lat))
    world = TILE_SIZE * (2 ** zoom)
    sin_lat = math.sin(math.radians(lat))
    x = (lng + 180.0) / 360.0 * world
    y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * world
    return x, y


def global_pixel_to_lng_lat(px: float, py: float, zoom: int) -> Tuple[float, float]:
    world = TILE_SIZE * (2 ** zoom)
    lng = px / world * 360.0 - 180.0
    n = math.pi - (2.0 * math.pi * py / world)
    lat = math.degrees(math.atan(math.sinh(n)))
    return lng, lat


def tile_count_for_bounds(bounds: Tuple[float, float, float, float], zoom: int) -> Tuple[int, int, int, int, int]:
    min_lng, min_lat, max_lng, max_lat = bounds
    x0, y1 = lng_lat_to_tile(min_lng, min_lat, zoom)
    x1, y0 = lng_lat_to_tile(max_lng, max_lat, zoom)
    min_x, max_x = sorted((x0, x1))
    min_y, max_y = sorted((y0, y1))
    return min_x, min_y, max_x, max_y, (max_x - min_x + 1) * (max_y - min_y + 1)


def choose_zoom(requested_zoom: Optional[float], bounds: Tuple[float, float, float, float]) -> int:
    zoom = int(round(requested_zoom or DEFAULT_ZOOM))
    zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    while zoom > MIN_ZOOM:
        *_, count = tile_count_for_bounds(bounds, zoom)
        if count <= MAX_TILE_COUNT:
            return zoom
        zoom -= 1
    return zoom


def tile_url_template(req: DetectMowableRequest) -> str:
    source = req.imageSource or {}
    template = str(source.get("tileUrl") or os.environ.get("VISION_TILE_URL") or DEFAULT_TILE_URL)
    if "{z}" in template and "{x}" in template and "{y}" in template:
        return template
    return DEFAULT_TILE_URL


def fetch_tile(template: str, zoom: int, x: int, y: int) -> Image.Image:
    url = template.format(z=zoom, x=x, y=y)
    response = requests.get(url, timeout=8, headers={"User-Agent": "TurfLynkVision/0.2"})
    response.raise_for_status()
    image = Image.open(io.BytesIO(response.content)).convert("RGB")
    return image.resize((TILE_SIZE, TILE_SIZE))


def fetch_mosaic(req: DetectMowableRequest, parcel_geom: BaseGeometry) -> Tuple[Image.Image, int, int, int, int]:
    bounds = parcel_geom.bounds
    zoom = choose_zoom(req.zoom, bounds)
    min_x, min_y, max_x, max_y, tile_count = tile_count_for_bounds(bounds, zoom)
    if tile_count > MAX_TILE_COUNT:
        raise HTTPException(status_code=422, detail="Parcel is too large for image detection.")

    template = tile_url_template(req)
    mosaic = Image.new("RGB", ((max_x - min_x + 1) * TILE_SIZE, (max_y - min_y + 1) * TILE_SIZE))
    for x in range(min_x, max_x + 1):
        for y in range(min_y, max_y + 1):
            tile = fetch_tile(template, zoom, x, y)
            mosaic.paste(tile, ((x - min_x) * TILE_SIZE, (y - min_y) * TILE_SIZE))
    return mosaic, zoom, min_x, min_y, tile_count


def vegetation_mask(image: Image.Image) -> np.ndarray:
    arr = np.asarray(image).astype(np.float32)
    red = arr[:, :, 0]
    green = arr[:, :, 1]
    blue = arr[:, :, 2]
    max_rgb = np.max(arr, axis=2)
    min_rgb = np.min(arr, axis=2)
    brightness = (red + green + blue) / 3.0
    saturation = max_rgb - min_rgb
    excess_green = 2.0 * green - red - blue

    diff_x = np.zeros_like(brightness)
    diff_y = np.zeros_like(brightness)
    diff_x[:, 1:] = np.abs(brightness[:, 1:] - brightness[:, :-1])
    diff_y[1:, :] = np.abs(brightness[1:, :] - brightness[:-1, :])
    texture = diff_x + diff_y

    green_dominant = (green > red + 6.0) & (green > blue + 2.0)
    likely_turf = (
        green_dominant
        & (excess_green > 12.0)
        & (brightness > 55.0)
        & (brightness < 210.0)
        & (saturation > 12.0)
        & (texture < 58.0)
    )

    very_dark_canopy = (brightness < 72.0) & (green > red + 3.0) & (texture > 26.0)
    pale_hard_surface = (brightness > 165.0) & (saturation < 24.0)
    blue_water_or_roof = (blue > green + 8.0) & (blue > red + 8.0)
    return likely_turf & ~very_dark_canopy & ~pale_hard_surface & ~blue_water_or_roof


def cell_polygon(pixel_x0: float, pixel_y0: float, pixel_x1: float, pixel_y1: float, zoom: int) -> Polygon:
    lng0, lat0 = global_pixel_to_lng_lat(pixel_x0, pixel_y0, zoom)
    lng1, lat1 = global_pixel_to_lng_lat(pixel_x1, pixel_y1, zoom)
    return box(min(lng0, lng1), min(lat0, lat1), max(lng0, lng1), max(lat0, lat1))


def geometry_from_mask(mask: np.ndarray, parcel_geom: BaseGeometry, zoom: int, min_tile_x: int, min_tile_y: int) -> BaseGeometry:
    height, width = mask.shape
    parcel_prepared = prep(parcel_geom)
    global_x0 = min_tile_x * TILE_SIZE
    global_y0 = min_tile_y * TILE_SIZE
    cells = []

    for y in range(0, height, CELL_SIZE_PX):
        for x in range(0, width, CELL_SIZE_PX):
            patch = mask[y:min(y + CELL_SIZE_PX, height), x:min(x + CELL_SIZE_PX, width)]
            if patch.size == 0 or float(np.mean(patch)) < MIN_VEGETATION_RATIO:
                continue

            px0 = global_x0 + x
            py0 = global_y0 + y
            px1 = global_x0 + min(x + CELL_SIZE_PX, width)
            py1 = global_y0 + min(y + CELL_SIZE_PX, height)
            lng, lat = global_pixel_to_lng_lat((px0 + px1) / 2.0, (py0 + py1) / 2.0, zoom)
            if not parcel_prepared.covers(Point(lng, lat)):
                continue
            cells.append(cell_polygon(px0, py0, px1, py1, zoom))

    if not cells:
        return parcel_geom.intersection(Polygon())

    geom = unary_union(cells).intersection(parcel_geom)
    if not geom.is_valid:
        geom = geom.buffer(0).intersection(parcel_geom)
    return geom


def filter_small_parts(geom: BaseGeometry) -> BaseGeometry:
    parts = [part for part in polygon_parts(geom) if area_sqft(part) >= MIN_FEATURE_AREA_SQFT]
    if not parts:
        return geom.intersection(Polygon())
    return unary_union(parts)


def feature_collection_from_geometry(geom: BaseGeometry, confidence: float) -> Dict[str, Any]:
    features = []
    for part in polygon_parts(geom):
        if part.is_empty or part.area <= 0:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "source": "vision_service",
                    "mode": "satellite-vegetation-heuristic",
                    "confidence": round(confidence, 3),
                },
                "geometry": mapping(part),
            }
        )
    return {"type": "FeatureCollection", "features": features}


def confidence_for_detection(detected_geom: BaseGeometry, parcel_geom: BaseGeometry) -> float:
    parcel_area = area_sqft(parcel_geom)
    detected_area = area_sqft(detected_geom)
    if detected_area <= 0 or parcel_area <= 0:
        return 0.0
    ratio = detected_area / parcel_area
    if ratio > 0.95:
        return 0.25
    if ratio > 0.70:
        return 0.55
    if ratio < 0.02:
        return 0.35
    if ratio <= 0.55:
        return 0.72
    return 0.58


def padded_bbox(parcel_geom: BaseGeometry) -> Tuple[float, float, float, float]:
    min_lng, min_lat, max_lng, max_lat = parcel_geom.bounds
    width = max(max_lng - min_lng, NAIP_MIN_PADDING_DEGREES)
    height = max(max_lat - min_lat, NAIP_MIN_PADDING_DEGREES)
    pad_lng = max(width * NAIP_BBOX_PADDING_RATIO, NAIP_MIN_PADDING_DEGREES)
    pad_lat = max(height * NAIP_BBOX_PADDING_RATIO, NAIP_MIN_PADDING_DEGREES)
    return (
        max(-180.0, min_lng - pad_lng),
        max(-90.0, min_lat - pad_lat),
        min(180.0, max_lng + pad_lng),
        min(90.0, max_lat + pad_lat),
    )


def bbox_image_size(bounds: Tuple[float, float, float, float]) -> Tuple[int, int]:
    min_lng, min_lat, max_lng, max_lat = bounds
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    min_x, min_y = transformer.transform(min_lng, min_lat)
    max_x, max_y = transformer.transform(max_lng, max_lat)
    width_m = max(abs(max_x - min_x), NAIP_MIN_IMAGE_SIZE * NAIP_PIXEL_SIZE_METERS)
    height_m = max(abs(max_y - min_y), NAIP_MIN_IMAGE_SIZE * NAIP_PIXEL_SIZE_METERS)
    pixel_size = float(os.environ.get("VISION_NAIP_PIXEL_SIZE_METERS") or NAIP_PIXEL_SIZE_METERS)
    width = clamp(int(math.ceil(width_m / pixel_size)), NAIP_MIN_IMAGE_SIZE, NAIP_MAX_IMAGE_SIZE)
    height = clamp(int(math.ceil(height_m / pixel_size)), NAIP_MIN_IMAGE_SIZE, NAIP_MAX_IMAGE_SIZE)
    return width, height


def naip_export_url() -> str:
    return os.environ.get("VISION_NAIP_EXPORT_URL") or DEFAULT_NAIP_EXPORT_URL


def create_debug_run_dir(parcel_area_sqft: float = 0) -> Path:
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y%m%d")
    time_str = now.strftime("%H%M%S")
    label = "large-parcel" if parcel_area_sqft > 43560 else "parcel"
    base_name = f"{date_str}-{label}-{time_str}"
    root = Path(__file__).resolve().parent / "debug_runs"
    root.mkdir(parents=True, exist_ok=True)
    debug_dir = root / base_name
    counter = 1
    while debug_dir.exists():
        debug_dir = root / f"{base_name}-{counter}"
        counter += 1
    debug_dir.mkdir(parents=True, exist_ok=False)
    return debug_dir


def fetch_naip_geotiff(parcel_geom: BaseGeometry, output_path: Path) -> Dict[str, Any]:
    bounds = padded_bbox(parcel_geom)
    width, height = bbox_image_size(bounds)
    params = {
        "f": "image",
        "bbox": ",".join(f"{value:.8f}" for value in bounds),
        "bboxSR": "4326",
        "imageSR": "4326",
        "size": f"{width},{height}",
        "format": "tiff",
        "pixelType": "U8",
        "interpolation": "RSP_BilinearInterpolation",
    }
    band_ids = os.environ.get("VISION_NAIP_BAND_IDS", "0,1,2,3").strip()
    if band_ids:
        params["bandIds"] = band_ids

    response = requests.get(
        naip_export_url(),
        params=params,
        timeout=float(os.environ.get("VISION_NAIP_TIMEOUT_SECONDS") or 30),
        headers={"User-Agent": "TurfLynkVision/0.3"},
    )

    if response.status_code >= 400 and "bandIds" in params:
        retry_params = dict(params)
        retry_params.pop("bandIds", None)
        response = requests.get(
            naip_export_url(),
            params=retry_params,
            timeout=float(os.environ.get("VISION_NAIP_TIMEOUT_SECONDS") or 30),
            headers={"User-Agent": "TurfLynkVision/0.3"},
        )
        params = retry_params

    response.raise_for_status()
    content = response.content
    content_type = response.headers.get("content-type", "")
    if "json" in content_type or content[:1] in (b"{", b"["):
        try:
            payload = response.json()
        except ValueError:
            payload = response.text[:300]
        raise RuntimeError(f"NAIP exportImage returned metadata instead of GeoTIFF: {payload}")
    if len(content) < 1024:
        raise RuntimeError("NAIP exportImage returned an unexpectedly small response.")

    output_path.write_bytes(content)
    return {
        "bbox": bounds,
        "status": response.status_code,
        "bytes": len(content),
        "width": width,
        "height": height,
        "bandIds": params.get("bandIds", ""),
    }


def geospatial_args(
    parcel_path: Path,
    imagery_path: Path,
    output_path: Path,
    *,
    debug_dir: Optional[Path] = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        imagery=str(imagery_path),
        parcel=str(parcel_path),
        output=str(output_path),
        mask_output="",
        debug_dir=str(debug_dir or ""),
        sam_mask="",
        combine="intersect",
        parcel_crs="EPSG:4326",
        red_band=1,
        green_band=2,
        blue_band=3,
        nir_band=4,
        ndvi_threshold=env_float(("VISION_NDVI_THRESHOLD", "VISION_NAIP_NDVI_THRESHOLD"), 0.28),
        visible_threshold=env_float(("VISION_NAIP_VISIBLE_THRESHOLD", "VISION_VISIBLE_THRESHOLD"), 6.0),
        saturation_min=optional_env_float("VISION_RGB_SATURATION_MIN"),
        brightness_min=env_float(("VISION_BRIGHTNESS_MIN", "VISION_NAIP_BRIGHTNESS_MIN"), 40.0),
        opening_iterations=int(os.environ.get("VISION_NAIP_OPENING_ITERATIONS") or 1),
        max_component_ratio=float(os.environ.get("VISION_NAIP_MAX_COMPONENT_RATIO") or 0.9),
        sieve_size=int(os.environ.get("VISION_NAIP_SIEVE_SIZE") or 64),
        min_area_sqft=float(os.environ.get("VISION_NAIP_MIN_AREA_SQFT") or MIN_FEATURE_AREA_SQFT),
    )


def feature_collection_area(features: List[Dict[str, Any]]) -> BaseGeometry:
    geoms = [shape(feature.get("geometry")) for feature in features if feature.get("geometry")]
    return unary_union(geoms) if geoms else Polygon()


def is_effectively_full_parcel(detected_geom: BaseGeometry, parcel_geom: BaseGeometry) -> bool:
    parcel_area = area_sqft(parcel_geom)
    detected_area = area_sqft(detected_geom)
    if parcel_area <= 0 or detected_area <= 0:
        return False
    ratio = detected_area / parcel_area
    if ratio >= 0.98:
        return True
    try:
        diff_ratio = area_sqft(parcel_geom.symmetric_difference(detected_geom)) / parcel_area
    except Exception:
        diff_ratio = 1.0
    return ratio >= 0.95 and diff_ratio <= 0.05


def naip_mode_from_geospatial(mode: str) -> str:
    value = str(mode or "").lower()
    if "manmade_exclusion_then_vegetation" in value:
        return "manmade_exclusion_then_vegetation"
    return "naip_ndvi" if "ndvi" in value else "naip_rgb_basic"


def naip_diagnostics(
    *,
    reason: str = "",
    mode: str = "naip_ndvi",
    image_meta: Optional[Dict[str, Any]] = None,
    result: Optional[Dict[str, Any]] = None,
    parcel_area_sqft: float = 0,
    detected_area_sqft: float = 0,
    confidence: float = 0,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    result = result or {}
    detected_ratio = detected_area_sqft / parcel_area_sqft if parcel_area_sqft > 0 else 0
    diagnostic = {
        "reason": reason,
        "detectedRatio": detected_ratio,
        "confidence": confidence,
        "confidenceScore": result.get("confidenceScore", confidence),
        "detection_mode": result.get("detection_mode") or result.get("detectionMode"),
        "mode": mode,
        "bbox": (image_meta or {}).get("bbox"),
        "status": (image_meta or {}).get("status"),
        "bytes": (image_meta or {}).get("bytes", 0),
        "rasterBands": result.get("rasterBands"),
        "usedNir": result.get("usedNir"),
        "vegetationPixels": result.get("vegetationPixels", 0),
        "polygonCount": result.get("polygonCount", result.get("features", 0)),
        "detectedAreaSqm": result.get("detectedAreaSqm", round(detected_area_sqft / SQFT_PER_SQM, 2) if detected_area_sqft else 0),
        "ndviThreshold": result.get("ndviThreshold"),
        "townLawnNdviThreshold": result.get("townLawnNdviThreshold"),
        "rgbFilterUsed": result.get("rgbFilterUsed"),
        "visibleThreshold": result.get("visibleThreshold"),
        "excessGreenMin": result.get("excessGreenMin"),
        "saturationMin": result.get("saturationMin"),
        "brightnessMin": result.get("brightnessMin"),
        "dynamicBrightnessMin": result.get("dynamicBrightnessMin"),
        "brightnessRange": result.get("brightnessRange"),
        "textureScore": result.get("textureScore"),
        "textureThreshold": result.get("textureThreshold"),
        "canopyRejectedPixels": result.get("canopyRejectedPixels", 0),
        "canopyHintPixels": result.get("canopyHintPixels", 0),
        "townLawnExtensionPixels": result.get("townLawnExtensionPixels", 0),
        "hardscapePixels": result.get("hardscapePixels", 0),
        "hardscapeSeedPixels": result.get("hardscapeSeedPixels", 0),
        "waterOrPoolPixels": result.get("waterOrPoolPixels", 0),
        "vegetationCandidatePixels": result.get("vegetationCandidatePixels", 0),
        "validPixels": result.get("validPixels", 0),
        "hardscapeExcludedAreaSqft": result.get("hardscapeExcludedAreaSqft", 0),
        "vegetationCandidateAreaSqft": result.get("vegetationCandidateAreaSqft", 0),
        "finalSelectedAreaSqft": result.get("finalSelectedAreaSqft", round(detected_area_sqft, 2)),
        "hardscapeRules": result.get("hardscapeRules", {}),
        "lowConfidenceCandidateReturned": result.get("lowConfidenceCandidateReturned", False),
        "keptComponentCount": result.get("keptComponentCount", result.get("polygonCount", result.get("features", 0))),
        "rejectedSmallComponents": result.get("rejectedSmallComponents", 0),
        "rejectedWoodsLikeComponents": result.get("rejectedWoodsLikeComponents", 0),
        "strictDetectedRatio": result.get("strictDetectedRatio"),
        "softDetectedRatio": result.get("softDetectedRatio"),
        "selectedCandidateScores": result.get("selectedCandidateScores", []),
        "fallbackSoftMaskUsed": result.get("fallbackSoftMaskUsed", False),
        "debugRunDir": result.get("debugRunDir"),
        "debugArtifacts": result.get("debugArtifacts"),
        "rasterWidth": result.get("rasterWidth"),
        "rasterHeight": result.get("rasterHeight"),
        "rasterCrs": result.get("rasterCrs"),
        "rasterTransform": result.get("rasterTransform"),
        "rasterBandCount": result.get("rasterBandCount", result.get("rasterBands")),
        "bandStats": result.get("bandStats", []),
        "bandOrderAssumption": result.get("bandOrderAssumption"),
        "ndviStats": result.get("ndviStats"),
        "maskPixelCountBeforeFiltering": result.get("maskPixelCountBeforeFiltering"),
        "maskPixelCountAfterFiltering": result.get("maskPixelCountAfterFiltering"),
        "polygonCountBeforeFiltering": result.get("polygonCountBeforeFiltering"),
        "polygonCountAfterFiltering": result.get("polygonCountAfterFiltering"),
        "naipNirWarning": result.get("naipNirWarning", ""),
        "componentAreas": result.get("componentAreas", []),
        "rejectedComponents": result.get("rejectedComponents", []),
        "candidateScores": result.get("candidateScores", []),
        "selectedCandidate": result.get("selectedCandidate", {}),
        "parcelAreaSqft": round(parcel_area_sqft, 2),
        "detectedAreaSqft": round(detected_area_sqft, 2),
    }
    if extra:
        diagnostic.update(extra)
    return diagnostic


def empty_naip_response(reason: str, *, mode: str = "naip_ndvi", diagnostic: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    details = naip_diagnostics(reason=reason, mode=mode, extra=diagnostic)
    log_naip_diagnostics(details, reason)
    return {
        "ok": True,
        "source": "naip",
        "mode": mode,
        "confidence": 0,
        "features": [],
        "featureCollection": empty_feature_collection(),
        "areaSqft": 0,
        "reason": reason,
        "diagnostic": details,
        "diagnostics": details,
    }


def run_naip_mowable_detection(req: DetectMowableRequest) -> Dict[str, Any]:
    parcel_geom = geometry_from_geojson(req.parcelGeoJson)
    if not parcel_geom.is_valid:
        parcel_geom = parcel_geom.buffer(0)

    if parcel_geom.is_empty:
        return empty_naip_response("empty parcel geometry")

    parcel_area_sqft = area_sqft(parcel_geom)
    parcel_bounds = list(parcel_geom.bounds)
    is_large_parcel = parcel_area_sqft > 43560.0
    image_bounds = padded_bbox(parcel_geom)
    requested_w, requested_h = bbox_image_size(image_bounds)
    pixel_size_m = float(os.environ.get("VISION_NAIP_PIXEL_SIZE_METERS") or NAIP_PIXEL_SIZE_METERS)
    print(f"[Vision] parcel_area_sqft={round(parcel_area_sqft, 1)} is_large_parcel={is_large_parcel}", flush=True)
    print(f"[Vision] parcel_bounds={parcel_bounds}", flush=True)
    print(f"[Vision] image_bounds={list(image_bounds)} requested_size={requested_w}x{requested_h} pixel_size_m={pixel_size_m}", flush=True)

    try:
        import mowable_geospatial
    except Exception as exc:
        return empty_naip_response(f"geospatial helper unavailable: {exc}")
    try:
        mowable_geospatial.require_rasterio()
    except SystemExit as exc:
        return empty_naip_response(str(exc) or "optional geospatial dependencies are missing")
    except ImportError as exc:
        return empty_naip_response(f"optional geospatial dependency missing: {exc}")
    except Exception as exc:
        return empty_naip_response(f"optional geospatial dependency unavailable: {exc}")

    _base_diag: Dict[str, Any] = {
        "parcelAreaSqft": round(parcel_area_sqft, 2),
        "parcelBounds": parcel_bounds,
        "imageBounds": list(image_bounds),
        "requestedImageWidth": requested_w,
        "requestedImageHeight": requested_h,
        "metersPerPixel": pixel_size_m,
        "isLargeParcel": is_large_parcel,
    }

    with tempfile.TemporaryDirectory(prefix="turflynk-naip-") as tmp_dir_name:
        tmp_dir = Path(tmp_dir_name)
        debug_dir = create_debug_run_dir(parcel_area_sqft=parcel_area_sqft) if req.debugArtifacts else None
        parcel_path = tmp_dir / "parcel.geojson"
        imagery_path = (debug_dir / "raw_naip.tif") if debug_dir else (tmp_dir / "naip.tif")
        output_path = (debug_dir / "polygon_output.geojson") if debug_dir else (tmp_dir / "mowable.geojson")
        parcel_path.write_text(json.dumps(req.parcelGeoJson), encoding="utf-8")
        if debug_dir:
            shutil.copyfile(parcel_path, debug_dir / "parcel.geojson")

        try:
            image_meta = fetch_naip_geotiff(parcel_geom, imagery_path)
            actual_w = image_meta.get("width", requested_w)
            actual_h = image_meta.get("height", requested_h)
            pixel_count = actual_w * actual_h
            print(f"[Vision] actual_image_size={actual_w}x{actual_h} pixel_count={pixel_count} bytes={image_meta.get('bytes', 0)}", flush=True)
            _base_diag.update({
                "actualImageWidth": actual_w,
                "actualImageHeight": actual_h,
                "pixelCount": pixel_count,
                "feetPerPixel": round(pixel_size_m * 3.28084, 3),
                "failureStage": "ok",
            })
        except Exception as exc:
            _base_diag["failureStage"] = "naip_fetch"
            print(f"[Vision] NAIP fetch failed: {exc}", flush=True)
            return empty_naip_response(
                f"NAIP imagery unavailable: {exc}",
                diagnostic={**_base_diag, "bbox": image_bounds},
            )

        try:
            result = mowable_geospatial.detect_mowable(
                geospatial_args(parcel_path, imagery_path, output_path, debug_dir=debug_dir)
            )
            print(f"[Vision] detection complete features={result.get('features', 0)} confidence={result.get('confidence')} rejectReason={result.get('selectedCandidate', {}).get('rejectReason', '')}", flush=True)
        except SystemExit as exc:
            _base_diag["failureStage"] = "geospatial_deps"
            return empty_naip_response(
                str(exc) or "optional geospatial dependencies are missing",
                diagnostic={**image_meta, **_base_diag},
            )
        except ImportError as exc:
            _base_diag["failureStage"] = "geospatial_import"
            return empty_naip_response(
                f"optional geospatial dependency missing: {exc}",
                diagnostic={**image_meta, **_base_diag},
            )
        except Exception as exc:
            _base_diag["failureStage"] = "geospatial_detection"
            print(f"[Vision] detection exception: {exc}", flush=True)
            return empty_naip_response(
                f"NAIP geospatial detection failed: {exc}",
                diagnostic={**image_meta, **_base_diag},
            )

        try:
            feature_collection = json.loads(output_path.read_text(encoding="utf-8"))
        except Exception as exc:
            return empty_naip_response(
                f"NAIP detection output could not be read: {exc}",
                mode=naip_mode_from_geospatial(result.get("mode", "")),
                diagnostic={
                    **image_meta,
                    "rasterBands": result.get("rasterBands"),
                    "usedNir": result.get("usedNir"),
                    "vegetationPixels": result.get("vegetationPixels", 0),
                    "polygonCount": result.get("polygonCount", result.get("features", 0)),
                    "detectedAreaSqm": result.get("detectedAreaSqm", 0),
                    "ndviThreshold": result.get("ndviThreshold"),
                    "rgbFilterUsed": result.get("rgbFilterUsed"),
                    "visibleThreshold": result.get("visibleThreshold"),
                    "excessGreenMin": result.get("excessGreenMin"),
                    "saturationMin": result.get("saturationMin"),
                    "brightnessMin": result.get("brightnessMin"),
                    "dynamicBrightnessMin": result.get("dynamicBrightnessMin"),
                    "brightnessRange": result.get("brightnessRange"),
                    "textureScore": result.get("textureScore"),
                    "textureThreshold": result.get("textureThreshold"),
                    "canopyRejectedPixels": result.get("canopyRejectedPixels", 0),
                    "canopyHintPixels": result.get("canopyHintPixels", 0),
                    "keptComponentCount": result.get("keptComponentCount", result.get("polygonCount", result.get("features", 0))),
                    "rejectedSmallComponents": result.get("rejectedSmallComponents", 0),
                    "rejectedWoodsLikeComponents": result.get("rejectedWoodsLikeComponents", 0),
                    "strictDetectedRatio": result.get("strictDetectedRatio"),
                    "softDetectedRatio": result.get("softDetectedRatio"),
                    "selectedCandidateScores": result.get("selectedCandidateScores", []),
                    "fallbackSoftMaskUsed": result.get("fallbackSoftMaskUsed", False),
                    "debugRunDir": result.get("debugRunDir"),
                    "debugArtifacts": result.get("debugArtifacts"),
                    "rasterWidth": result.get("rasterWidth"),
                    "rasterHeight": result.get("rasterHeight"),
                    "rasterCrs": result.get("rasterCrs"),
                    "rasterTransform": result.get("rasterTransform"),
                    "rasterBandCount": result.get("rasterBandCount", result.get("rasterBands")),
                    "bandStats": result.get("bandStats", []),
                    "bandOrderAssumption": result.get("bandOrderAssumption"),
                    "ndviStats": result.get("ndviStats"),
                    "maskPixelCountBeforeFiltering": result.get("maskPixelCountBeforeFiltering"),
                    "maskPixelCountAfterFiltering": result.get("maskPixelCountAfterFiltering"),
                    "polygonCountBeforeFiltering": result.get("polygonCountBeforeFiltering"),
                    "polygonCountAfterFiltering": result.get("polygonCountAfterFiltering"),
                    "naipNirWarning": result.get("naipNirWarning", ""),
                    "componentAreas": result.get("componentAreas", []),
                    "rejectedComponents": result.get("rejectedComponents", []),
                    "candidateScores": result.get("candidateScores", []),
                    "selectedCandidate": result.get("selectedCandidate", {}),
                    "parcelAreaSqft": round(parcel_area_sqft, 2),
                },
            )

    features = feature_collection.get("features") if isinstance(feature_collection, dict) else []
    if not isinstance(features, list):
        features = []
    detected_geom = feature_collection_area(features)
    detected_area_sqft = area_sqft(detected_geom) if features else 0
    mode = naip_mode_from_geospatial(result.get("mode", ""))
    result_confidence = result.get("confidence")
    result_confidence_score = result.get("confidenceScore")
    confidence_score = (
        float(result_confidence_score)
        if isinstance(result_confidence_score, (int, float))
        else confidence_for_detection(detected_geom, parcel_geom)
    )
    confidence = str(result_confidence) if isinstance(result_confidence, str) else (
        "beta_high" if confidence_score >= 0.68 else "beta_medium" if confidence_score >= 0.42 else "beta_low"
    )
    _base_diag["failureStage"] = "no_features" if not features else "ok"
    diagnostics = naip_diagnostics(
        mode=mode,
        image_meta=image_meta,
        result=result,
        parcel_area_sqft=parcel_area_sqft,
        detected_area_sqft=detected_area_sqft,
        confidence=confidence,
        extra=_base_diag,
    )
    if is_effectively_full_parcel(detected_geom, parcel_geom) and mode != "manmade_exclusion_then_vegetation":
        _base_diag["failureStage"] = "full_parcel_match"
        diagnostics["failureStage"] = "full_parcel_match"
        diagnostics["reason"] = "detected geometry matched the full parcel"
        return empty_naip_response(
            "detected geometry matched the full parcel",
            mode=mode,
            diagnostic=diagnostics,
        )

    diagnostics["reason"] = "no features" if not features else ""
    print(f"[Vision] final: features={len(features)} area_sqft={round(detected_area_sqft, 1)} confidence={confidence} reason={diagnostics['reason']}", flush=True)
    log_naip_diagnostics(diagnostics, diagnostics["reason"])
    area = round(detected_area_sqft, 2) if features else 0
    return {
        "ok": True,
        "source": "naip",
        "mode": mode,
        "detection_mode": "manmade_exclusion_then_vegetation",
        "confidence": confidence,
        "confidenceScore": confidence_score,
        "features": features,
        "featureCollection": {"type": "FeatureCollection", "features": features},
        "areaSqft": area,
        "image": {
            "provider": "usgs-naip",
            "source": req.source or "maplibre",
            "lat": req.lat,
            "lng": req.lng,
            "zoom": req.zoom,
            "export": image_meta,
        },
        "diagnostic": diagnostics,
        "diagnostics": diagnostics,
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "turflynk-vision-service",
        "mode": "satellite-vegetation-heuristic",
    }


def run_mowable_detection(req: DetectMowableRequest) -> Dict[str, Any]:
    parcel_geom = geometry_from_geojson(req.parcelGeoJson)
    if not parcel_geom.is_valid:
        parcel_geom = parcel_geom.buffer(0)

    if parcel_geom.is_empty:
        return {
            "ok": True,
            "featureCollection": empty_feature_collection(),
            "areaSqft": 0,
            "source": "vision_service",
            "mode": "satellite-vegetation-heuristic",
            "confidence": 0,
        }

    try:
        mosaic, zoom, min_tile_x, min_tile_y, tile_count = fetch_mosaic(req, parcel_geom)
        mask = vegetation_mask(mosaic)
        detected_geom = geometry_from_mask(mask, parcel_geom, zoom, min_tile_x, min_tile_y)
        detected_geom = filter_small_parts(detected_geom).intersection(parcel_geom)
        if not detected_geom.is_valid:
            detected_geom = detected_geom.buffer(0).intersection(parcel_geom)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Imagery detection unavailable: {exc}") from exc

    confidence = confidence_for_detection(detected_geom, parcel_geom)
    feature_collection = feature_collection_from_geometry(detected_geom, confidence)
    return {
        "ok": True,
        "featureCollection": feature_collection,
        "features": feature_collection["features"],
        "areaSqft": round(area_sqft(detected_geom), 2) if feature_collection["features"] else 0,
        "source": "vision_service",
        "mode": "satellite-vegetation-heuristic",
        "confidence": confidence,
        "image": {
            "provider": (req.imageSource or {}).get("provider") or "esri-world-imagery",
            "source": req.source or "maplibre",
            "zoom": zoom,
            "tiles": tile_count,
        },
    }


@app.post("/detect-mowable")
def detect_mowable(req: DetectMowableRequest) -> Dict[str, Any]:
    return run_naip_mowable_detection(req)


@app.post("/detect-grass")
def detect_grass(req: DetectMowableRequest) -> Dict[str, Any]:
    return run_naip_mowable_detection(req)
