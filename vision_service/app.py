# vision_service/app.py
# TurfLynk mowable-area vision service
# v7 woods-aware simple yard draft

import base64
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from shapely.geometry import Polygon, MultiPolygon, shape, mapping
from shapely.ops import unary_union, transform
from pyproj import Transformer

app = FastAPI(title="TurfLynk Vision Grass Detector", version="yard-guess-v7")


class DetectOptions(BaseModel):
    minAreaSqFt: float = 900.0
    simplifyToleranceFeet: float = 12.0


class DetectGrassRequest(BaseModel):
    parcelGeometry: Dict[str, Any]
    lat: Optional[float] = None
    lng: Optional[float] = None
    imageBase64: str
    imageMime: str = "image/png"
    imageBbox: List[float] = Field(..., min_length=4, max_length=4)
    imageWidth: int
    imageHeight: int
    options: DetectOptions = DetectOptions()


def decode_image(image_b64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(image_b64)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {exc}")

    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")
    return img


def lonlat_to_pixel(lng: float, lat: float, bbox: List[float], width: int, height: int) -> Tuple[int, int]:
    min_lng, min_lat, max_lng, max_lat = bbox
    x = (lng - min_lng) / (max_lng - min_lng) * width
    y = (max_lat - lat) / (max_lat - min_lat) * height
    return int(round(x)), int(round(y))


def pixel_to_lonlat(x: float, y: float, bbox: List[float], width: int, height: int) -> Tuple[float, float]:
    min_lng, min_lat, max_lng, max_lat = bbox
    lng = min_lng + (x / width) * (max_lng - min_lng)
    lat = max_lat - (y / height) * (max_lat - min_lat)
    return float(lng), float(lat)


def draw_geometry_mask(geometry: Dict[str, Any], bbox: List[float], width: int, height: int) -> np.ndarray:
    mask = np.zeros((height, width), dtype=np.uint8)
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")

    if geom_type == "Polygon":
        polygons = [coords]
    elif geom_type == "MultiPolygon":
        polygons = [poly for poly in coords]
    else:
        raise HTTPException(status_code=400, detail="parcelGeometry must be Polygon or MultiPolygon.")

    for poly in polygons:
        if not poly:
            continue

        exterior = np.array(
            [lonlat_to_pixel(lng, lat, bbox, width, height) for lng, lat in poly[0]],
            dtype=np.int32,
        )

        if len(exterior) >= 3:
            cv2.fillPoly(mask, [exterior], 255)

        for ring in poly[1:]:
            interior = np.array(
                [lonlat_to_pixel(lng, lat, bbox, width, height) for lng, lat in ring],
                dtype=np.int32,
            )
            if len(interior) >= 3:
                cv2.fillPoly(mask, [interior], 0)

    return mask


def estimate_utm_crs(lng: float, lat: float) -> str:
    zone = int((lng + 180) // 6) + 1
    epsg = 32600 + zone if lat >= 0 else 32700 + zone
    return f"EPSG:{epsg}"


def area_sqft(geom: Any) -> float:
    if geom.is_empty:
        return 0.0
    centroid = geom.centroid
    utm = estimate_utm_crs(centroid.x, centroid.y)
    transformer = Transformer.from_crs("EPSG:4326", utm, always_xy=True)
    projected = transform(transformer.transform, geom)
    return float(projected.area * 10.76391041671)


def feet_to_degrees_rough(feet: float) -> float:
    return (feet * 0.3048) / 111_320.0


def polygon_parts(geom: Any) -> List[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def build_grass_mask(img_bgr: np.ndarray, parcel_mask: np.ndarray) -> Tuple[np.ndarray, Dict[str, Any]]:
    img_blur = cv2.GaussianBlur(img_bgr, (5, 5), 0)

    hsv = cv2.cvtColor(img_blur, cv2.COLOR_BGR2HSV)
    _h, s, v = cv2.split(hsv)

    # Broad vegetation / lawn candidates.
    hsv_green = cv2.inRange(hsv, np.array([28, 22, 45]), np.array([100, 245, 248]))

    b, g, r = cv2.split(img_blur.astype(np.float32))
    exg = 2 * g - r - b
    exg_norm = cv2.normalize(exg, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    _, exg_mask = cv2.threshold(exg_norm, 104, 255, cv2.THRESH_BINARY)

    brightness_ok = cv2.inRange(v, 45, 245)
    saturation_ok = cv2.inRange(s, 18, 245)

    mask = cv2.bitwise_and(hsv_green, exg_mask)
    mask = cv2.bitwise_and(mask, brightness_ok)
    mask = cv2.bitwise_and(mask, saturation_ok)
    mask = cv2.bitwise_and(mask, parcel_mask)

    # --- STRONG WOODS REJECTION ---
    gray = cv2.cvtColor(img_blur, cv2.COLOR_BGR2GRAY)
    texture = cv2.Laplacian(gray, cv2.CV_64F)
    texture_abs = cv2.convertScaleAbs(texture)

    # Dense woods usually have rough/noisy texture.
    _, high_texture = cv2.threshold(texture_abs, 35, 255, cv2.THRESH_BINARY)

    # Dark saturated green/brown-green usually means canopy/woods.
    dark_canopy = cv2.inRange(hsv, np.array([35, 60, 20]), np.array([100, 255, 140]))

    # Reject woods if either strong texture or dark canopy hits.
    canopy_reject = cv2.bitwise_or(high_texture, dark_canopy)

    # But only reject big continuous canopy/woods areas, not tiny scattered trees.
    canopy_reject = cv2.morphologyEx(
        canopy_reject,
        cv2.MORPH_OPEN,
        np.ones((9, 9), np.uint8),
        iterations=1,
    )
    canopy_reject = cv2.morphologyEx(
        canopy_reject,
        cv2.MORPH_CLOSE,
        np.ones((21, 21), np.uint8),
        iterations=2,
    )
    canopy_reject = cv2.dilate(canopy_reject, np.ones((15, 15), np.uint8), iterations=1)

    mask = cv2.bitwise_and(mask, cv2.bitwise_not(canopy_reject))

    # Clean and merge only modestly. Do not grow to full parcel.
    open_kernel = np.ones((7, 7), np.uint8)
    close_kernel = np.ones((31, 31), np.uint8)

    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    mask = cv2.bitwise_and(mask, parcel_mask)

    diagnostics = {
        "parcelPixels": int(np.count_nonzero(parcel_mask)),
        "grassPixelsRaw": int(np.count_nonzero(mask)),
        "method": "yard_guess_v7_woods_aware_simple_mask",
    }
    return mask, diagnostics


def contours_to_polygons(mask: np.ndarray, bbox: List[float], width: int, height: int) -> List[Polygon]:
    contours, _hierarchy = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons: List[Polygon] = []

    for contour in contours:
        if len(contour) < 4:
            continue

        area_px = cv2.contourArea(contour)
        if area_px < 900:
            continue

        epsilon = max(6.0, 0.014 * cv2.arcLength(contour, True))
        approx = cv2.approxPolyDP(contour, epsilon, True)

        ring = []
        for pt in approx.reshape(-1, 2):
            x, y = float(pt[0]), float(pt[1])
            ring.append(pixel_to_lonlat(x, y, bbox, width, height))

        if len(ring) < 3:
            continue

        if ring[0] != ring[-1]:
            ring.append(ring[0])

        poly = Polygon(ring)
        if not poly.is_valid:
            poly = poly.buffer(0)

        if not poly.is_empty and poly.area > 0:
            polygons.append(poly)

    return polygons


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "service": "turflynk-vision-grass", "version": "yard-guess-v7"}


@app.post("/detect-grass")
def detect_grass(req: DetectGrassRequest) -> Dict[str, Any]:
    img = decode_image(req.imageBase64)
    height, width = img.shape[:2]

    try:
        parcel_geom = shape(req.parcelGeometry)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid parcelGeometry: {exc}")

    if parcel_geom.is_empty:
        raise HTTPException(status_code=400, detail="Parcel geometry is empty.")

    parcel_mask = draw_geometry_mask(req.parcelGeometry, req.imageBbox, width, height)
    grass_mask, diagnostics = build_grass_mask(img, parcel_mask)
    raw_polys = contours_to_polygons(grass_mask, req.imageBbox, width, height)

    if not raw_polys:
        return {
            "ok": True,
            "mowableAreaSqFt": 0,
            "polygons": [],
            "diagnostics": {**diagnostics, "keptPolygons": 0},
        }

    clipped = []
    for poly in raw_polys:
        try:
            g = poly.intersection(parcel_geom)
            if not g.is_empty:
                clipped.append(g)
        except Exception:
            continue

    if not clipped:
        return {
            "ok": True,
            "mowableAreaSqFt": 0,
            "polygons": [],
            "diagnostics": {**diagnostics, "keptPolygons": 0},
        }

    merged = unary_union(clipped)
    if not merged.is_valid:
        merged = merged.buffer(0)

    min_area = max(0.0, float(req.options.minAreaSqFt or 900.0))
    simplify = feet_to_degrees_rough(req.options.simplifyToleranceFeet or 12.0)

    candidates = []
    for geom in polygon_parts(merged):
        sqft = area_sqft(geom)
        if sqft >= min_area:
            candidates.append((sqft, geom))

    if not candidates:
        return {
            "ok": True,
            "mowableAreaSqFt": 0,
            "polygons": [],
            "diagnostics": {**diagnostics, "keptPolygons": 0},
        }

    parcel_center = parcel_geom.centroid

    def score(item: Tuple[float, Polygon]) -> float:
        sqft, geom = item
        dist = geom.centroid.distance(parcel_center)
        return dist - (sqft / 1_000_000_000.0)

    candidates.sort(key=score)

    # Keep only a few good yard candidates, not every woods fragment.
    selected = [geom for _sqft, geom in candidates[:3]]
    draft = unary_union(selected).intersection(parcel_geom)

    if not draft.is_valid:
        draft = draft.buffer(0)

    # Small smoothing only. This is not a parcel shrink.
    smooth = feet_to_degrees_rough(4.0)
    draft = draft.buffer(smooth).buffer(-smooth).intersection(parcel_geom)

    if not draft.is_valid:
        draft = draft.buffer(0)

    parts = polygon_parts(draft)
    parts.sort(key=area_sqft, reverse=True)

    output = []
    total_sqft = 0.0

    for geom in parts[:2]:
        if geom.is_empty:
            continue

        simplified = geom.simplify(simplify, preserve_topology=True)
        if simplified.is_empty:
            simplified = geom

        if not simplified.is_valid:
            simplified = simplified.buffer(0)

        sqft = area_sqft(simplified)
        if sqft < min_area:
            continue

        total_sqft += sqft
        output.append(mapping(simplified))

    return {
        "ok": True,
        "mowableAreaSqFt": round(total_sqft, 2),
        "polygons": output,
        "diagnostics": {
            **diagnostics,
            "keptPolygons": len(output),
            "minAreaSqFt": min_area,
            "simplifyToleranceFeet": req.options.simplifyToleranceFeet,
            "mode": "woods_aware_simple_yard_draft",
        },
    }