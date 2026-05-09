#!/usr/bin/env python3
"""
Geospatial mowable-area starter pipeline.

Use this for high-resolution GeoTIFF imagery such as NAIP. It clips imagery to
the submitted parcel, builds a vegetation mask from NDVI when NIR is available
or from visible RGB cues otherwise, optionally intersects it with a SAMGeo mask,
and writes parcel-clipped mowable polygons as GeoJSON.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union


SQFT_PER_SQM = 10.76391041671
DEFAULT_NDVI_SWEEP = [0.25, 0.28, 0.30]
DEFAULT_VISIBLE_SWEEP = [4.0, 6.0, 8.0]
DEFAULT_BRIGHTNESS_SWEEP = [35.0, 40.0, 50.0]
DEFAULT_NDVI_UPPER_LIMIT = 0.72
DEFAULT_TEXTURE_PERCENTILE = 0.82
MAX_COMPONENTS_TO_KEEP = 6
SOFT_FALLBACK_RATIO = 0.02

DETECTION_PRESET_THRESHOLDS: Dict[str, Dict[str, Any]] = {
    "small_residential": {
        "detectionMode": "hardscape_exclusion_then_remainder",
        "ndviSweep": [0.32, 0.35, 0.38],
        "visibleSweep": [9.0, 11.0, 13.0],
        "brightnessSweep": [48.0, 56.0, 64.0],
        "maxDetectedRatio": 0.80,
        "hardDetectedRatio": 0.98,
        "strongExclusionRatio": 0.06,
        "minComponentAreaSqft": 120.0,
        "maxComponents": 4,
        "maxComponentRatio": 0.65,
        "gsdCloseCap": 8,
        "softFallback": False,
        "lowConfidenceCandidate": False,
        "hardscapeGrow": 2,
        "hardscapeRules": {
            "paleBrightnessMin": 128.0,
            "paleSaturationMax": 58.0,
            "neutralSaturationMax": 34.0,
            "graySaturationMax": 30.0,
            "darkShadowBrightnessMax": 42.0,
            "whiteBrightnessMin": 184.0,
        },
        "vegetation": {
            "saturationFloor": 8.0,
            "excessGreenFloor": 6.0,
            "greenRatioMin": 0.335,
            "variMin": 0.025,
            "brightnessMax": 205.0,
            "greenSlack": 4.0,
            "ndviDrop": 0.0,
            "ndviSoftDrop": 0.03,
            "ndviQuantile": 0.56,
            "ndviCap": 0.38,
            "townLawnDrop": 0.035,
        },
    },
    "medium_residential": {
        "detectionMode": "hybrid_hardscape_light_vegetation_sanity",
        "ndviSweep": [0.28, 0.30, 0.33],
        "visibleSweep": [6.0, 8.0, 10.0],
        "brightnessSweep": [40.0, 48.0, 56.0],
        # Stricter caps: residential lots with visible houses should not return 70%+
        "maxDetectedRatio": 0.68,
        "hardDetectedRatio": 0.85,
        "strongExclusionRatio": 0.04,
        "minComponentAreaSqft": 100.0,
        "maxComponents": MAX_COMPONENTS_TO_KEEP,
        "maxComponentRatio": 0.65,
        # Reduced from 10: fewer close-iters prevents bridging across house-width gaps
        "gsdCloseCap": 7,
        "softFallback": True,
        "lowConfidenceCandidate": False,
        # Grow 3px so roof edges + shadow pixels are fully covered by the barrier
        "hardscapeGrow": 3,
        "hardscapeRules": {
            # Lower brightness floor: catches medium-dark asphalt shingles (~108 lum)
            "paleBrightnessMin": 108.0,
            # Higher sat ceiling: catches tan/terracotta roofs and warm concrete
            "paleSaturationMax": 60.0,
            "neutralSaturationMax": 38.0,
            "graySaturationMax": 38.0,
            # Raised: catches dark roof-overhang shadow bands
            "darkShadowBrightnessMax": 52.0,
            # Lowered: catches more bright concrete/metal surfaces
            "whiteBrightnessMin": 162.0,
        },
        "vegetation": {
            # Require more colour signal to qualify as lawn; reduces roof/concrete bleed-through
            "saturationFloor": 7.0,
            "excessGreenFloor": 3.5,
            "greenRatioMin": 0.335,
            "variMin": 0.01,
            # Lower ceiling: very bright surfaces are more likely hardscape
            "brightnessMax": 206.0,
            "greenSlack": 6.0,
            "ndviDrop": 0.02,
            "ndviSoftDrop": 0.06,
            "ndviQuantile": 0.52,
            "ndviCap": 0.32,
            "townLawnDrop": 0.045,
        },
    },
    "large_rural": {
        "detectionMode": "vegetation_ndvi",
        "ndviSweep": DEFAULT_NDVI_SWEEP,
        "visibleSweep": DEFAULT_VISIBLE_SWEEP,
        "brightnessSweep": DEFAULT_BRIGHTNESS_SWEEP,
        "maxDetectedRatio": 0.93,
        "hardDetectedRatio": 0.97,
        "strongExclusionRatio": 0.015,
        "minComponentAreaSqft": 80.0,
        "maxComponents": 12,
        "maxComponentRatio": 0.90,
        "gsdCloseCap": 15,
        "softFallback": True,
        "lowConfidenceCandidate": True,
        "hardscapeGrow": 1,
        "hardscapeRules": {
            "paleBrightnessMin": 158.0,
            "paleSaturationMax": 36.0,
            "neutralSaturationMax": 20.0,
            "graySaturationMax": 26.0,
            "darkShadowBrightnessMax": 28.0,
            "whiteBrightnessMin": 205.0,
        },
        "vegetation": {
            "saturationFloor": 2.5,
            "excessGreenFloor": -2.0,
            "greenRatioMin": 0.31,
            "variMin": 0.0,
            "brightnessMax": 222.0,
            "greenSlack": 12.0,
            "ndviDrop": 0.08,
            "ndviSoftDrop": 0.12,
            "ndviQuantile": 0.48,
            "ndviCap": 0.22,
            "townLawnDrop": 0.06,
        },
    },
}


def detection_preset_for_area(parcel_area_sqft: float) -> str:
    if parcel_area_sqft > 0 and parcel_area_sqft < 12000.0:
        return "small_residential"
    if parcel_area_sqft > 0 and parcel_area_sqft < 43560.0:
        return "medium_residential"
    return "large_rural"


def normalize_detection_preset(value: Optional[str], parcel_area_sqft: float = 0.0) -> str:
    preset = str(value or "").strip()
    if preset in DETECTION_PRESET_THRESHOLDS:
        return preset
    return detection_preset_for_area(parcel_area_sqft)


def preset_thresholds(name: str) -> Dict[str, Any]:
    return DETECTION_PRESET_THRESHOLDS.get(name, DETECTION_PRESET_THRESHOLDS["large_rural"])


def require_rasterio() -> Any:
    try:
        import rasterio
    except ImportError as exc:  # pragma: no cover - depends on local env
        raise SystemExit(
            "mowable_geospatial.py requires rasterio. Install the optional "
            "geospatial dependencies from the README before running this script."
        ) from exc
    return rasterio


def estimate_utm_epsg(lng: float, lat: float) -> str:
    zone = int((lng + 180.0) // 6.0) + 1
    epsg = 32600 + zone if lat >= 0 else 32700 + zone
    return f"EPSG:{epsg}"


def transform_geometry(geom: BaseGeometry, source_crs: str, target_crs: str) -> BaseGeometry:
    if str(source_crs).lower() == str(target_crs).lower():
        return geom
    transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)
    return shapely_transform(transformer.transform, geom)


def polygon_parts(geom: BaseGeometry) -> List[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [part for part in getattr(geom, "geoms", []) if isinstance(part, Polygon)]


def load_geojson_geometry(path: Path) -> BaseGeometry:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    if data.get("type") == "FeatureCollection":
        geoms = [shape(feature["geometry"]) for feature in data.get("features", []) if feature.get("geometry")]
        if not geoms:
            raise ValueError(f"{path} has no feature geometries.")
        return unary_union(geoms)
    if data.get("type") == "Feature":
        return shape(data["geometry"])
    return shape(data)


def valid_data_mask(data: np.ma.MaskedArray) -> np.ndarray:
    mask_array = np.ma.getmaskarray(data)
    if mask_array.shape == ():
        return np.ones(data.shape[1:], dtype=bool)
    return ~np.any(mask_array, axis=0)


def selected_bands(red: int, green: int, blue: int, nir: Optional[int]) -> Tuple[List[int], Dict[int, int]]:
    indexes = []
    for band in (red, green, blue, nir):
        if band is not None and band not in indexes:
            indexes.append(band)
    return indexes, {band: idx for idx, band in enumerate(indexes)}


def shifted_sum(values: np.ndarray, radius: int = 1) -> np.ndarray:
    padded = np.pad(values, radius, mode="edge")
    height, width = values.shape
    total = np.zeros((height, width), dtype=np.float32)
    for y in range((radius * 2) + 1):
        for x in range((radius * 2) + 1):
            total += padded[y:y + height, x:x + width]
    return total


def local_mean(values: np.ndarray, radius: int = 1) -> np.ndarray:
    kernel_size = float(((radius * 2) + 1) ** 2)
    return shifted_sum(values.astype(np.float32), radius) / kernel_size


def local_variance(values: np.ndarray, radius: int = 1) -> np.ndarray:
    values = values.astype(np.float32)
    mean = local_mean(values, radius)
    mean_sq = local_mean(values * values, radius)
    return np.maximum(0.0, mean_sq - (mean * mean))


def local_edge_density(values: np.ndarray) -> np.ndarray:
    values = values.astype(np.float32)
    diff_x = np.zeros_like(values, dtype=np.float32)
    diff_y = np.zeros_like(values, dtype=np.float32)
    diff_x[:, 1:] = np.abs(values[:, 1:] - values[:, :-1])
    diff_y[1:, :] = np.abs(values[1:, :] - values[:-1, :])
    return local_mean(diff_x + diff_y, 1)


def finite_range(values: np.ndarray) -> List[float]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return [0.0, 0.0]
    return [round(float(np.min(finite)), 2), round(float(np.max(finite)), 2)]


def stats_for_values(values: np.ndarray) -> Dict[str, float]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {"min": 0.0, "max": 0.0, "mean": 0.0}
    return {
        "min": round(float(np.min(finite)), 4),
        "max": round(float(np.max(finite)), 4),
        "mean": round(float(np.mean(finite)), 4),
    }


def normalize_to_uint8(values: np.ndarray, valid: Optional[np.ndarray] = None) -> np.ndarray:
    values = values.astype(np.float32)
    finite = np.isfinite(values)
    if valid is not None:
        finite &= valid.astype(bool)
    out = np.zeros(values.shape, dtype=np.uint8)
    selected = values[finite]
    if selected.size == 0:
        return out
    low = float(np.min(selected))
    high = float(np.max(selected))
    if high <= low:
        out[finite] = 128
        return out
    scaled = (values - low) / (high - low)
    out[finite] = np.clip(scaled[finite] * 255.0, 0, 255).astype(np.uint8)
    return out


def ndvi_from_data(
    data: np.ma.MaskedArray,
    band_lookup: Dict[int, int],
    *,
    red_band: int,
    nir_band: Optional[int],
) -> Optional[np.ndarray]:
    if nir_band is None or nir_band not in band_lookup:
        return None
    red = np.asarray(data[band_lookup[red_band]].filled(0), dtype=np.float32)
    nir = np.asarray(data[band_lookup[nir_band]].filled(0), dtype=np.float32)
    denominator = nir + red
    ndvi = np.zeros_like(red, dtype=np.float32)
    np.divide(nir - red, denominator, out=ndvi, where=np.abs(denominator) > 1e-6)
    return ndvi


def band_statistics(data: np.ma.MaskedArray, band_indexes: Sequence[int]) -> List[Dict[str, Any]]:
    stats = []
    for offset, band_number in enumerate(band_indexes):
        band = np.ma.asarray(data[offset], dtype=np.float32).filled(np.nan)
        stats.append({"band": int(band_number), **stats_for_values(band)})
    return stats


def ratio_index(numerator: np.ndarray, denominator: np.ndarray) -> np.ndarray:
    out = np.zeros_like(numerator, dtype=np.float32)
    np.divide(numerator, denominator, out=out, where=np.abs(denominator) > 1e-6)
    return out


def beta_confidence_label(score: float) -> str:
    if score >= 0.68:
        return "beta_high"
    if score >= 0.42:
        return "beta_medium"
    return "beta_low"


def vegetation_from_bands(
    data: np.ma.MaskedArray,
    band_lookup: Dict[int, int],
    *,
    red_band: int,
    green_band: int,
    blue_band: int,
    nir_band: Optional[int],
    ndvi_threshold: float,
    visible_threshold: float,
    saturation_min: Optional[float],
    brightness_min: float,
    soft: bool = False,
    detection_preset: str = "large_rural",
) -> Tuple[np.ndarray, Dict[str, Any]]:
    preset_name = normalize_detection_preset(detection_preset)
    preset = preset_thresholds(preset_name)
    vegetation_rules = preset["vegetation"]
    hardscape_rules = preset["hardscapeRules"]
    valid = valid_data_mask(data)
    red = np.asarray(data[band_lookup[red_band]].filled(0), dtype=np.float32)
    green = np.asarray(data[band_lookup[green_band]].filled(0), dtype=np.float32)
    blue = np.asarray(data[band_lookup[blue_band]].filled(0), dtype=np.float32)

    max_rgb = np.maximum.reduce([red, green, blue])
    min_rgb = np.minimum.reduce([red, green, blue])
    brightness = (red + green + blue) / 3.0
    saturation = max_rgb - min_rgb
    excess_green = 2.0 * green - red - blue
    base_saturation_min = float(saturation_min) if saturation_min is not None else max(0.0, float(visible_threshold))
    effective_saturation_min = max(float(vegetation_rules["saturationFloor"]), base_saturation_min * (0.5 if soft else 0.75))
    green_slack = float(vegetation_rules["greenSlack"]) + (4.0 if soft and preset_name != "small_residential" else 0.0)
    green_balanced = (green >= red - green_slack) & (green >= blue - green_slack)
    greenish_valid = valid & green_balanced & (saturation > max(3.0, effective_saturation_min * 0.45))
    greenish_brightness = brightness[greenish_valid & np.isfinite(brightness)]
    if greenish_brightness.size:
        brightness_floor = max(24.0, float(brightness_min) - (12.0 if soft else 0.0))
        dynamic_brightness_min = max(brightness_floor, min(62.0, float(np.quantile(greenish_brightness, 0.14))))
    else:
        dynamic_brightness_min = max(24.0, float(brightness_min) - (12.0 if soft else 0.0))
    texture_map = np.sqrt(local_variance(brightness, 1)) + (local_edge_density(brightness) * 0.5)
    texture_values = texture_map[greenish_valid & np.isfinite(texture_map)]
    texture_threshold = max(10.0, float(np.quantile(texture_values, DEFAULT_TEXTURE_PERCENTILE))) if texture_values.size else 18.0

    abs_rg = np.abs(red - green)
    abs_gb = np.abs(green - blue)
    vari = ratio_index(green - red, green + red - blue)
    green_ratio = ratio_index(green, red + green + blue)
    pale_hard_surface = (brightness > float(hardscape_rules["paleBrightnessMin"])) & (saturation < float(hardscape_rules["paleSaturationMax"]))
    neutral_hard_surface = (
        (brightness > 76.0)
        & (brightness < 235.0)
        & (saturation < float(hardscape_rules["neutralSaturationMax"]))
        & (abs_rg < 20.0)
        & (abs_gb < 24.0)
    )
    strict_hardscape = preset_name != "large_rural"
    white_or_light_gray = strict_hardscape & (
        (brightness > float(hardscape_rules["whiteBrightnessMin"]))
        & (saturation < float(hardscape_rules["paleSaturationMax"]) + 8.0)
    )
    gray_hard_surface = strict_hardscape & (
        (brightness > 45.0)
        & (brightness < 238.0)
        & (saturation < float(hardscape_rules["graySaturationMax"]))
        & (abs_rg < 28.0)
        & (abs_gb < 30.0)
    )
    tan_gravel_or_roof = (
        (brightness > 88.0)
        & (brightness < 215.0)
        & (saturation < max(44.0, float(hardscape_rules["paleSaturationMax"])))
        & (red >= green - 6.0)
        & (green >= blue - 2.0)
        & (excess_green < 10.0)
    )
    blue_pool_or_water = (
        ((blue > green + 8.0) & (blue > red + 8.0) & (saturation > 14.0))
        | ((brightness < 42.0) & (saturation < 18.0) & (texture_map < texture_threshold * 0.45))
    )
    very_dark_hard_shadow = (
        (brightness < (max(22.0, float(hardscape_rules["darkShadowBrightnessMax"]) - 8.0) if soft else float(hardscape_rules["darkShadowBrightnessMax"])))
        & (saturation < max(22.0, float(hardscape_rules["graySaturationMax"])))
        & (texture_map < texture_threshold * 0.7)
    )
    textured_bare_gravel = (
        (brightness > 70.0)
        & (brightness < 190.0)
        & (saturation < 34.0)
        & (excess_green < 2.0)
        & (texture_map > texture_threshold * 0.55)
    )
    hardscape_seed = (
        pale_hard_surface
        | neutral_hard_surface
        | white_or_light_gray
        | gray_hard_surface
        | tan_gravel_or_roof
        | blue_pool_or_water
        | very_dark_hard_shadow
        | textured_bare_gravel
    ) & valid
    hardscape = binary_close(hardscape_seed, 1) & valid
    hardscape = grow_mask(hardscape, int(preset["hardscapeGrow"])) & valid
    soft_surface = valid & ~hardscape

    excess_green_min = max(float(vegetation_rules["excessGreenFloor"]) - (4.0 if soft else 0.0), float(visible_threshold) * (0.12 if soft else 0.2))
    rgb_residential_green = (
        green_balanced
        & (excess_green > excess_green_min)
        & (green_ratio > (float(vegetation_rules["greenRatioMin"]) - (0.01 if soft else 0.0)))
        & (brightness >= max(28.0, dynamic_brightness_min - (18.0 if soft else 14.0)))
        & (brightness < (float(vegetation_rules["brightnessMax"]) + (8.0 if soft else 0.0)))
        & (saturation > max(3.0, effective_saturation_min * 0.35))
    )
    vari_green = (
        (vari > (float(vegetation_rules["variMin"]) - (0.025 if soft else 0.0)))
        & green_balanced
        & (brightness > 32.0)
        & (brightness < (float(vegetation_rules["brightnessMax"]) + (6.0 if soft else 0.0)))
        & (saturation > max(3.0, effective_saturation_min * 0.25))
    )
    dark_tree_shadow = (
        (brightness < max(30.0, dynamic_brightness_min - 22.0))
        & (texture_map > texture_threshold * 1.05)
        & (green <= red + 4.0)
    )

    if nir_band is not None and nir_band in band_lookup:
        nir = np.asarray(data[band_lookup[nir_band]].filled(0), dtype=np.float32)
        ndvi = ratio_index(nir - red, nir + red)
        ndvi_values = ndvi[valid & np.isfinite(ndvi)]
        requested_ndvi_threshold = max(0.12, float(ndvi_threshold) - (float(vegetation_rules["ndviSoftDrop"]) if soft else float(vegetation_rules["ndviDrop"])))
        if ndvi_values.size:
            adaptive = float(np.quantile(ndvi_values, 0.42 if soft else float(vegetation_rules["ndviQuantile"])))
            effective_ndvi_threshold = max(0.10, min(max(requested_ndvi_threshold, adaptive), float(vegetation_rules["ndviCap"])))
        else:
            effective_ndvi_threshold = requested_ndvi_threshold
        town_lawn_ndvi_threshold = max(0.06, effective_ndvi_threshold - (float(vegetation_rules["townLawnDrop"]) + (0.025 if soft else 0.0)))
        ndvi_vegetation = (ndvi >= effective_ndvi_threshold) | ((ndvi >= town_lawn_ndvi_threshold) & (rgb_residential_green | vari_green))
        mask = (ndvi_vegetation | rgb_residential_green | vari_green) & soft_surface & ~dark_tree_shadow
        accepted_texture = texture_map[mask & np.isfinite(texture_map)]
        return mask, {
            "ndviThreshold": round(float(effective_ndvi_threshold), 3),
            "townLawnNdviThreshold": round(float(town_lawn_ndvi_threshold), 3),
            "ndviUpperLimit": None,
            "rgbFilterUsed": True,
            "visibleThreshold": float(visible_threshold),
            "excessGreenMin": excess_green_min,
            "saturationMin": effective_saturation_min,
            "brightnessMin": float(brightness_min),
            "dynamicBrightnessMin": round(float(dynamic_brightness_min), 2),
            "brightnessRange": finite_range(brightness[valid]),
            "textureScore": round(float(np.mean(accepted_texture)), 3) if accepted_texture.size else 0.0,
            "textureThreshold": round(float(texture_threshold), 3),
            "canopyRejectedPixels": int(np.count_nonzero(dark_tree_shadow & valid)),
            "canopyHintPixels": int(np.count_nonzero((brightness < dynamic_brightness_min + 12.0) & greenish_valid)),
            "townLawnExtensionPixels": int(np.count_nonzero(((ndvi >= town_lawn_ndvi_threshold) & (rgb_residential_green | vari_green)) & ~(ndvi >= effective_ndvi_threshold))),
            "hardscapePixels": int(np.count_nonzero(hardscape)),
            "hardscapeSeedPixels": int(np.count_nonzero(hardscape_seed)),
            "waterOrPoolPixels": int(np.count_nonzero(blue_pool_or_water & valid)),
            "vegetationCandidatePixels": int(np.count_nonzero(mask)),
            "validPixels": int(np.count_nonzero(valid)),
            "detectionMode": "manmade_exclusion_then_vegetation",
            "detectionPreset": preset_name,
            "hardscapeRules": hardscape_rules,
            "softMask": bool(soft),
        }

    mask = (rgb_residential_green | vari_green) & soft_surface & ~dark_tree_shadow
    accepted_texture = texture_map[mask & np.isfinite(texture_map)]
    return mask, {
        "ndviThreshold": None,
        "ndviUpperLimit": None,
        "rgbFilterUsed": True,
        "visibleThreshold": float(visible_threshold),
        "excessGreenMin": excess_green_min,
        "saturationMin": effective_saturation_min,
        "brightnessMin": float(brightness_min),
        "dynamicBrightnessMin": round(float(dynamic_brightness_min), 2),
        "brightnessRange": finite_range(brightness[valid]),
        "textureScore": round(float(np.mean(accepted_texture)), 3) if accepted_texture.size else 0.0,
        "textureThreshold": round(float(texture_threshold), 3),
        "canopyRejectedPixels": int(np.count_nonzero(dark_tree_shadow & valid)),
        "canopyHintPixels": int(np.count_nonzero((brightness < dynamic_brightness_min + 12.0) & greenish_valid)),
        "townLawnExtensionPixels": 0,
        "hardscapePixels": int(np.count_nonzero(hardscape)),
        "hardscapeSeedPixels": int(np.count_nonzero(hardscape_seed)),
        "waterOrPoolPixels": int(np.count_nonzero(blue_pool_or_water & valid)),
        "vegetationCandidatePixels": int(np.count_nonzero(mask)),
        "validPixels": int(np.count_nonzero(valid)),
        "detectionMode": "manmade_exclusion_then_vegetation",
        "detectionPreset": preset_name,
        "hardscapeRules": hardscape_rules,
        "softMask": bool(soft),
    }


def binary_erode(mask: np.ndarray) -> np.ndarray:
    padded = np.pad(mask.astype(bool), 1, mode="constant", constant_values=False)
    height, width = mask.shape
    out = np.ones((height, width), dtype=bool)
    for y in range(3):
        for x in range(3):
            out &= padded[y:y + height, x:x + width]
    return out


def binary_dilate(mask: np.ndarray) -> np.ndarray:
    padded = np.pad(mask.astype(bool), 1, mode="constant", constant_values=False)
    height, width = mask.shape
    out = np.zeros((height, width), dtype=bool)
    for y in range(3):
        for x in range(3):
            out |= padded[y:y + height, x:x + width]
    return out


def binary_open(mask: np.ndarray, iterations: int) -> np.ndarray:
    opened = mask.astype(bool)
    for _ in range(max(0, iterations)):
        opened = binary_erode(opened)
    for _ in range(max(0, iterations)):
        opened = binary_dilate(opened)
    return opened


def binary_close(mask: np.ndarray, iterations: int) -> np.ndarray:
    closed = mask.astype(bool)
    for _ in range(max(0, iterations)):
        closed = binary_dilate(closed)
    for _ in range(max(0, iterations)):
        closed = binary_erode(closed)
    return closed


def grow_mask(mask: np.ndarray, iterations: int) -> np.ndarray:
    grown = mask.astype(bool)
    for _ in range(max(0, iterations)):
        grown = binary_dilate(grown)
    return grown


def merge_nearby_components(
    geoms: List[BaseGeometry],
    *,
    merge_distance_m: float,
    source_crs: Any,
) -> Tuple[List[BaseGeometry], int]:
    """Merge polygons within merge_distance_m of each other using buffer+union in UTM."""
    if len(geoms) <= 1:
        return list(geoms), 0
    sample = next((g for g in geoms if not g.is_empty), None)
    if sample is None:
        return list(geoms), 0
    centroid_wgs84 = transform_geometry(sample.centroid, str(source_crs), "EPSG:4326")
    utm_crs = estimate_utm_epsg(centroid_wgs84.x, centroid_wgs84.y)
    half = merge_distance_m / 2.0
    projected = [transform_geometry(g, str(source_crs), utm_crs) for g in geoms if not g.is_empty]
    expanded = unary_union([g.buffer(half) for g in projected])
    shrunk = expanded.buffer(-half)
    parts = polygon_parts(shrunk)
    result = [transform_geometry(p, utm_crs, str(source_crs)) for p in parts if not p.is_empty]
    return result, max(0, len(geoms) - len(result))


def fill_polygon_holes(
    geoms: List[BaseGeometry],
    *,
    min_hole_sqft: float,
    source_crs: Any,
) -> Tuple[List[BaseGeometry], int]:
    """Remove interior rings smaller than min_hole_sqft from all polygons."""
    total_removed = 0
    result: List[BaseGeometry] = []
    for geom in geoms:
        if isinstance(geom, Polygon) and list(geom.interiors):
            kept = [ring for ring in geom.interiors if area_sqft(Polygon(ring), source_crs) >= min_hole_sqft]
            removed = len(list(geom.interiors)) - len(kept)
            total_removed += removed
            result.append(Polygon(geom.exterior, kept) if removed > 0 else geom)
        else:
            result.append(geom)
    return result, total_removed


def smooth_geoms(
    geoms: List[BaseGeometry],
    *,
    source_crs: Any,
    buffer_m: float = 1.5,
    simplify_m: float = 0.5,
) -> List[BaseGeometry]:
    """Morphological close (buffer+/−) and edge simplification to remove pixel artifacts."""
    if not geoms:
        return geoms
    sample = next((g for g in geoms if not g.is_empty), None)
    if sample is None:
        return geoms
    centroid_wgs84 = transform_geometry(sample.centroid, str(source_crs), "EPSG:4326")
    utm_crs = estimate_utm_epsg(centroid_wgs84.x, centroid_wgs84.y)
    result: List[BaseGeometry] = []
    for geom in geoms:
        if geom.is_empty:
            continue
        proj = transform_geometry(geom, str(source_crs), utm_crs)
        closed = proj.buffer(buffer_m).buffer(-buffer_m)
        smoothed = closed.simplify(simplify_m, preserve_topology=True)
        back = transform_geometry(smoothed, utm_crs, str(source_crs))
        if not back.is_empty:
            result.extend(p for p in polygon_parts(back) if not p.is_empty)
    return result


def analysis_context_from_bands(
    data: np.ma.MaskedArray,
    band_lookup: Dict[int, int],
    *,
    red_band: int,
    green_band: int,
    blue_band: int,
    nir_band: Optional[int],
    brightness_min: float,
) -> Dict[str, Any]:
    valid = valid_data_mask(data)
    red = np.asarray(data[band_lookup[red_band]].filled(0), dtype=np.float32)
    green = np.asarray(data[band_lookup[green_band]].filled(0), dtype=np.float32)
    blue = np.asarray(data[band_lookup[blue_band]].filled(0), dtype=np.float32)

    max_rgb = np.maximum.reduce([red, green, blue])
    min_rgb = np.minimum.reduce([red, green, blue])
    brightness = (red + green + blue) / 3.0
    saturation = max_rgb - min_rgb
    texture_map = np.sqrt(local_variance(brightness, 1)) + (local_edge_density(brightness) * 0.5)
    green_balanced = (green >= red - 8.0) & (green >= blue - 8.0)
    greenish_valid = valid & green_balanced & (saturation > 3.0)
    greenish_brightness = brightness[greenish_valid & np.isfinite(brightness)]
    if greenish_brightness.size:
        dynamic_brightness_min = max(float(brightness_min), min(62.0, float(np.quantile(greenish_brightness, 0.14))))
    else:
        dynamic_brightness_min = float(brightness_min)
    texture_values = texture_map[greenish_valid & np.isfinite(texture_map)]
    texture_threshold = max(10.0, float(np.quantile(texture_values, DEFAULT_TEXTURE_PERCENTILE))) if texture_values.size else 18.0

    pale_hard_surface = (brightness > 145.0) & (saturation < 34.0)
    neutral_hard_surface = (brightness > 82.0) & (brightness < 225.0) & (saturation < 18.0)
    blue_water_or_roof = (blue > green + 8.0) & (blue > red + 8.0)
    hard_surface = (pale_hard_surface | neutral_hard_surface) & ~blue_water_or_roof & valid

    dense_woods = (
        greenish_valid
        & (
            ((texture_map > texture_threshold * 1.05) & (brightness < dynamic_brightness_min + 45.0))
            | ((brightness < dynamic_brightness_min + 4.0) & (green > red + 2.0))
        )
        & ~hard_surface
        & ~blue_water_or_roof
    )
    if nir_band is not None and nir_band in band_lookup:
        nir = np.asarray(data[band_lookup[nir_band]].filled(0), dtype=np.float32)
        denominator = nir + red
        ndvi = np.zeros_like(red, dtype=np.float32)
        np.divide(nir - red, denominator, out=ndvi, where=np.abs(denominator) > 1e-6)
        dense_woods |= (
            (ndvi > DEFAULT_NDVI_UPPER_LIMIT)
            & greenish_valid
            & ((texture_map > texture_threshold * 0.75) | (brightness < dynamic_brightness_min + 42.0))
            & ~hard_surface
        )

    return {
        "valid": valid,
        "brightness": brightness,
        "textureMap": texture_map,
        "textureThreshold": float(texture_threshold),
        "denseWoods": dense_woods & valid,
        "denseWoodsZone": grow_mask(dense_woods & valid, 2),
        "hardSurface": hard_surface,
        "accessZone": grow_mask(hard_surface, 12),
        "hardSurfacePixels": int(np.count_nonzero(hard_surface)),
    }


def build_hardscape_subtract_mask(
    data: np.ma.MaskedArray,
    band_lookup: Dict[int, int],
    *,
    red_band: int,
    green_band: int,
    blue_band: int,
    nir_band: Optional[int],
    valid_pixels: np.ndarray,
    analysis_context: Dict[str, Any],
    detection_preset: str,
    preset: Dict[str, Any],
    relaxed: bool = False,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    red = np.asarray(data[band_lookup[red_band]].filled(0), dtype=np.float32)
    green = np.asarray(data[band_lookup[green_band]].filled(0), dtype=np.float32)
    blue = np.asarray(data[band_lookup[blue_band]].filled(0), dtype=np.float32)
    brightness = (red + green + blue) / 3.0
    saturation = np.maximum.reduce([red, green, blue]) - np.minimum.reduce([red, green, blue])
    excess_green = 2.0 * green - red - blue
    rules = preset["hardscapeRules"]

    small = detection_preset == "small_residential"
    is_medium = detection_preset == "medium_residential"
    # medium_residential: lower brightness floor to catch dark asphalt shingles (~100 lum);
    # lower asphalt/tan floors to catch shadowed driveways and dark gravel.
    roof_brightness_min = (150.0 if small else 142.0) if relaxed else (125.0 if small else (98.0 if is_medium else 135.0))
    asphalt_brightness_min = (58.0 if small else 62.0) if relaxed else (45.0 if small else (36.0 if is_medium else 58.0))
    tan_brightness_min = (90.0 if small else 88.0) if relaxed else (65.0 if small else (60.0 if is_medium else 80.0))
    pale_sat_limit = max(36.0 if relaxed else 44.0, float(rules["paleSaturationMax"]) - (12.0 if relaxed else 0.0))
    gray_sat_limit = max(20.0 if relaxed else 26.0, float(rules["graySaturationMax"]) - (8.0 if relaxed else 0.0))
    tan_sat_limit = max(34.0 if relaxed else 50.0, float(rules["paleSaturationMax"]) - (10.0 if relaxed else 0.0))
    excess_green_limit = 8.0 if relaxed and small else (16.0 if small else (5.0 if is_medium else 10.0))

    roof = (brightness > roof_brightness_min) & (saturation < pale_sat_limit) & valid_pixels
    asphalt = (
        (brightness > asphalt_brightness_min)
        & (brightness < (210.0 if relaxed else 218.0))
        & (saturation < gray_sat_limit)
        & (np.abs(red - green) < (18.0 if relaxed else 24.0))
        & (np.abs(green - blue) < (20.0 if relaxed else 28.0))
    ) & valid_pixels
    tan = (
        (brightness > tan_brightness_min)
        & (brightness < (214.0 if relaxed else 224.0))
        & (saturation < tan_sat_limit)
        & (excess_green < excess_green_limit)
        & (red >= green - (6.0 if relaxed else 10.0))
    ) & valid_pixels
    extreme = np.zeros_like(valid_pixels, dtype=bool)
    if detection_preset in {"small_residential", "medium_residential"}:
        extreme = (
            ((brightness > (float(rules["whiteBrightnessMin"]) + (10.0 if relaxed else 0.0))) & (saturation < pale_sat_limit + (4.0 if relaxed else 10.0)))
            | ((brightness < (float(rules["darkShadowBrightnessMax"]) - (4.0 if relaxed else 0.0))) & (saturation < gray_sat_limit + 4.0))
            | ((brightness > (55.0 if relaxed else 45.0)) & (brightness < (230.0 if relaxed else 238.0)) & (saturation < gray_sat_limit))
        ) & valid_pixels

    context_hard_surface = analysis_context["hardSurface"] & valid_pixels
    if relaxed:
        context_hard_surface = context_hard_surface & (
            (brightness > 92.0)
            & (brightness < 220.0)
            & (saturation < max(18.0, gray_sat_limit))
        )

    # medium_residential only: dedicated dark-shingle / compact structure detector.
    # Fills the brightness gap (42–170) between the pale_hard_surface ceiling and
    # very-dark shadow detection, targeting asphalt shingles, dark tile roofs, and
    # shadowed masonry that slip through the standard bright-surface rules.
    # Gated on excess_green < 4 so actively green surfaces (lawn, moss) are not caught.
    medium_res_dark_structure = np.zeros_like(valid_pixels, dtype=bool)
    if is_medium and not relaxed:
        medium_res_dark_structure = (
            (brightness > 42.0)
            & (brightness < 170.0)
            & (saturation < 58.0)
            & (excess_green < 4.0)
        ) & valid_pixels

    hardscape = (roof | asphalt | tan | extreme | context_hard_surface | medium_res_dark_structure) & valid_pixels
    if nir_band:
        nir = np.asarray(data[band_lookup[nir_band]].filled(0), dtype=np.float32)
        denominator = nir + red
        ndvi = np.zeros_like(red, dtype=np.float32)
        np.divide(nir - red, denominator, out=ndvi, where=np.abs(denominator) > 1e-6)
        if is_medium and not relaxed:
            # Stronger NIR-based structure exclusion: catches darker roofing with low NDVI.
            # NDVI < 0.12 safely excludes healthy lawn (NDVI > 0.20) and most stressed
            # lawn (NDVI > 0.10) while catching asphalt/tile/concrete (NDVI < 0.05–0.10).
            hardscape = (
                hardscape
                | ((ndvi < 0.12) & (brightness > 72.0) & (saturation < 68.0) & (excess_green < 8.0) & valid_pixels)
                | ((ndvi < 0.08) & (brightness > 38.0) & (saturation < 88.0) & (excess_green < 4.0) & valid_pixels)
            ) & valid_pixels
        else:
            hardscape = (
                hardscape
                | ((ndvi < (0.06 if relaxed else 0.10)) & (brightness > (145.0 if relaxed else 125.0)) & (saturation < (30.0 if relaxed else 38.0)) & valid_pixels)
                | ((ndvi < (0.08 if relaxed else 0.12)) & (brightness > (66.0 if relaxed else 52.0)) & (saturation < (22.0 if relaxed else 30.0)) & valid_pixels)
            ) & valid_pixels

    # medium_residential: close with 4 iterations to fill within-roof spectral gaps
    _hs_close_iters = (1 if relaxed else (4 if is_medium else 2))
    hardscape = binary_close(hardscape, _hs_close_iters) & valid_pixels
    hardscape = grow_mask(hardscape, max(0, int(preset["hardscapeGrow"]) - (1 if relaxed else 0))) & valid_pixels
    return hardscape, {
        "relaxed": bool(relaxed),
        "roofPixels": int(np.count_nonzero(roof)),
        "drivewaySidewalkPatioPixels": int(np.count_nonzero(asphalt | tan | context_hard_surface)),
        "extremeNeutralPixels": int(np.count_nonzero(extreme)),
        "darkStructurePixels": int(np.count_nonzero(medium_res_dark_structure)),
        "hardscapeRules": rules,
    }


def build_morphology_barrier_mask(
    data: np.ma.MaskedArray,
    band_lookup: Dict[int, int],
    *,
    red_band: int,
    green_band: int,
    blue_band: int,
    nir_band: Optional[int],
    valid_pixels: np.ndarray,
    analysis_context: Dict[str, Any],
    hardscape_subtract_mask: np.ndarray,
    parcel_area_sqft: float = 0.0,
    constrained_boundary_mode: bool = False,
    detection_preset: str = "",
) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    """Hard-barrier mask frozen during morphological close/merge operations.

    Prevents binary_close from bridging lawn regions across trailers, gravel,
    metal roofs, sheds, and other non-mowable objects.  Starts from the
    already-computed hardscape_subtract_mask and adds high-confidence-only rules
    for objects not fully caught by the standard hardscape rules.

    Returns a 3-tuple: (morphology_barrier_mask, hard_exclusion_mask, details).
    For medium_residential + constrained_boundary_mode:
      - morphology_barrier_mask: broader, used only during close to prevent bridging.
      - hard_exclusion_mask: tight high-confidence gate with green rescue applied;
        used for initial and final subtraction from mowable.
    For all other modes: both masks are identical (existing behaviour).

    Rules are conservative to avoid misclassifying valid lawn as barrier.
    Added barrier pixels (beyond hardscape_subtract_mask) are capped at 20% of
    valid pixels; if exceeded, the function falls back to hardscape-only and
    sets barrierRejectedAsTooBroad=True.
    """
    valid_pixels = np.asarray(valid_pixels, dtype=bool)
    hardscape_subtract_mask = np.asarray(hardscape_subtract_mask, dtype=bool)
    red   = np.asarray(data[band_lookup[red_band]].filled(0),   dtype=np.float32)
    green = np.asarray(data[band_lookup[green_band]].filled(0), dtype=np.float32)
    blue  = np.asarray(data[band_lookup[blue_band]].filled(0),  dtype=np.float32)
    brightness   = (red + green + blue) / 3.0
    saturation   = np.maximum.reduce([red, green, blue]) - np.minimum.reduce([red, green, blue])
    excess_green = 2.0 * green - red - blue
    abs_rg = np.abs(red - green)
    abs_gb = np.abs(green - blue)
    green_sum = red + green + blue
    green_ratio = np.zeros_like(green, dtype=np.float32)
    np.divide(green, green_sum, out=green_ratio, where=green_sum > 1e-6)

    texture_map: Optional[np.ndarray] = analysis_context.get("textureMap")
    texture_threshold = float(analysis_context.get("textureThreshold") or 18.0)

    # --- Gravel / crushed stone (high-confidence, tight gate) ---
    # Must be clearly neutral/low-saturation with no green character.
    gravel_base = (
        (brightness > 55.0)
        & (brightness < 200.0)
        & (saturation < 28.0)
        & (excess_green < 3.0)
        & (abs_rg < 18.0)
        & (abs_gb < 20.0)
    ) & valid_pixels
    if texture_map is not None:
        gravel_seed = gravel_base & (texture_map > texture_threshold * 0.50)
    else:
        # Without texture, require very tight spectral gate to stay conservative.
        gravel_seed = gravel_base & (saturation < 18.0) & (excess_green < 1.0)

    # --- Neutral gray surfaces (concrete, galvanized metal) ---
    # Must be nearly achromatic — tighter than before to avoid misclassifying
    # overcast-lit lawn or light green turf as barrier.
    neutral_gray = (
        (brightness > 70.0)
        & (brightness < 230.0)
        & (saturation < 14.0)
        & (abs_rg < 10.0)
        & (abs_gb < 12.0)
    ) & valid_pixels

    # --- Metal / rust / large objects (constrained mode, high-confidence only) ---
    # Must show clear red dominance and strictly non-positive excess green.
    # Avoids flagging dormant or dry green grass which can appear reddish.
    if constrained_boundary_mode:
        metal_or_rust = (
            (brightness > 50.0)
            & (brightness < 210.0)
            & (saturation < 50.0)
            & (excess_green < 0.0)        # strictly not green-dominant
            & (red >= green + 12.0)       # clear red dominance
            & (green_ratio < 0.33)        # well below vegetation range
        ) & valid_pixels
    else:
        metal_or_rust = np.zeros(valid_pixels.shape, dtype=bool)

    # --- Bare soil / dirt roads (constrained mode, high-confidence only) ---
    # Requires clearly negative excess_green and strong red dominance.
    if constrained_boundary_mode:
        bare_soil = (
            (brightness > 55.0)
            & (brightness < 185.0)
            & (saturation < 45.0)
            & (excess_green < -2.0)       # strictly negative
            & (red >= green + 8.0)        # clear red dominance
        ) & valid_pixels
    else:
        bare_soil = np.zeros(valid_pixels.shape, dtype=bool)

    # Build barrier seed from hardscape + high-confidence spectral additions.
    barrier_seed = (hardscape_subtract_mask | gravel_seed | neutral_gray) & valid_pixels
    if constrained_boundary_mode:
        barrier_seed = (barrier_seed | metal_or_rust | bare_soil) & valid_pixels

    # NIR: add barrier only for pixels with very clearly non-vegetation NDVI
    # combined with strongly non-green color. Low NDVI alone must NOT create a
    # broad barrier — dormant/dry grass has low NDVI but is still mowable lawn.
    if nir_band is not None and nir_band in band_lookup:
        nir = np.asarray(data[band_lookup[nir_band]].filled(0), dtype=np.float32)
        denom = nir + red
        ndvi_b = np.zeros_like(red, dtype=np.float32)
        np.divide(nir - red, denom, out=ndvi_b, where=np.abs(denom) > 1e-6)
        low_ndvi_nonveg = (
            (ndvi_b < 0.05)            # much stricter than 0.14
            & (brightness > 80.0)      # exclude shadows
            & (excess_green < -3.0)    # must be clearly non-green
        ) & valid_pixels
        barrier_seed = (barrier_seed | low_ndvi_nonveg) & valid_pixels

    is_medium_constrained = (detection_preset == "medium_residential" and constrained_boundary_mode)

    # --- Cap: added barrier beyond hardscape may not exceed 20% of valid pixels ---
    _ADD_CAP = 0.20
    valid_px = int(np.count_nonzero(valid_pixels))
    hardscape_px_count = int(np.count_nonzero(hardscape_subtract_mask & valid_pixels))
    added_barrier_mask = barrier_seed & ~hardscape_subtract_mask & valid_pixels
    added_barrier_px = int(np.count_nonzero(added_barrier_mask))
    added_barrier_ratio = added_barrier_px / valid_px if valid_px > 0 else 0.0

    barrier_rejected_as_too_broad = False
    barrier_capped = False
    if added_barrier_ratio > _ADD_CAP:
        # Too many pixels added beyond hardscape — fall back to hardscape-only
        # to avoid erasing most of the yard.
        barrier_seed = hardscape_subtract_mask & valid_pixels
        barrier_rejected_as_too_broad = True
        added_barrier_px = 0
        added_barrier_ratio = 0.0
        print(
            f"[Vision] morphology_barrier: barrierRejectedAsTooBroad=True"
            f" added_ratio={round(added_barrier_ratio, 3)} cap={_ADD_CAP}"
            f" — reverting to hardscape_subtract_mask only",
            flush=True,
        )

    if is_medium_constrained:
        # --- medium_residential + constrained: split barrier into two concepts ---
        #
        # morphology_barrier_mask (broad): used only during binary_close/open to
        #   prevent closing from bridging across gravel/trailer/hardscape. No moat
        #   so that adjacent real grass pixels are not eroded.
        #
        # hard_exclusion_mask (tight): high-confidence non-mowable pixels that are
        #   permanently removed from the final mowable output.  Green-dominant and
        #   high-NDVI pixels are rescued from this mask even if they matched barrier
        #   spectral rules.

        # Morphology barrier: existing barrier_seed, no moat.
        morphology_barrier = barrier_seed & valid_pixels

        # Strong green / vegetation evidence — these pixels must NOT be hard-excluded.
        # Grass-positive thresholds: include mixed grass/dirt/shadow when any
        # vegetation signal is present (lower than standard to bias toward inclusion).
        _eg = 2.0 * green - red - blue
        _gs = red + green + blue
        _gr = np.zeros_like(green, dtype=np.float32)
        np.divide(green, _gs, out=_gr, where=_gs > 1e-6)
        strong_green_evidence = np.asarray(((_eg > 2.0) | (_gr > 0.34)) & valid_pixels, dtype=bool)
        if nir_band is not None and nir_band in band_lookup:
            _nir = np.asarray(data[band_lookup[nir_band]].filled(0), dtype=np.float32)
            _nd_d = _nir + red
            _ndvi_he = np.zeros_like(red, dtype=np.float32)
            np.divide(_nir - red, _nd_d, out=_ndvi_he, where=np.abs(_nd_d) > 1e-6)
            strong_green_evidence = strong_green_evidence | ((_ndvi_he > 0.10) & valid_pixels)
        strong_green_evidence = np.asarray(strong_green_evidence, dtype=bool)

        # Hard exclusion: conservative spectral gate — only very high-confidence
        # non-mowable pixels are permanently removed.  Ambiguous gravel/neutral
        # pixels that might be mixed lawn are left for the morphology-barrier-only
        # zone so green rescue can recover them.
        tight_gravel = (
            (brightness > 70.0)
            & (brightness < 190.0)
            & (saturation < 12.0)
            & (excess_green < -5.0)
            & (abs_rg < 8.0)
            & (abs_gb < 10.0)
        ) & valid_pixels
        tight_neutral_gray = (
            (brightness > 80.0)
            & (brightness < 220.0)
            & (saturation < 6.0)
            & (abs_rg < 4.0)
            & (abs_gb < 6.0)
        ) & valid_pixels
        tight_metal = (
            (brightness > 50.0)
            & (brightness < 210.0)
            & (saturation < 40.0)
            & (excess_green < -8.0)
            & (red >= green + 25.0)
            & (_gr < 0.27)
        ) & valid_pixels
        hard_exclusion_seed = (
            hardscape_subtract_mask
            | tight_gravel
            | tight_neutral_gray
            | tight_metal
        ) & valid_pixels
        # Rescue: green-dominant pixels override all broad barrier rules.
        hard_exclusion_seed = hard_exclusion_seed & ~strong_green_evidence

        morphology_barrier = np.asarray(morphology_barrier, dtype=bool)
        hard_exclusion_seed = np.asarray(hard_exclusion_seed, dtype=bool)
        hard_excl_px = int(np.count_nonzero(hard_exclusion_seed))
        morph_only_px = int(np.count_nonzero(morphology_barrier & ~hard_exclusion_seed))
        gravel_px = int(np.count_nonzero(gravel_seed))
        large_obj_px = int(np.count_nonzero((metal_or_rust | bare_soil) & valid_pixels))
        area_per_px = parcel_area_sqft / valid_px if valid_px > 0 else 0.0

        return morphology_barrier, hard_exclusion_seed, {
            "gravelExcludedPixels": gravel_px,
            "gravelExcludedAreaSqft": round(gravel_px * area_per_px, 1),
            "largeObjectExcludedPixels": large_obj_px,
            "largeObjectExcludedAreaSqft": round(large_obj_px * area_per_px, 1),
            "frozenExclusionPixels": int(np.count_nonzero(morphology_barrier)),
            "morphologyBarrierPixels": int(np.count_nonzero(morphology_barrier)),
            "hardscapeBarrierPixels": hardscape_px_count,
            "addedBarrierPixels": added_barrier_px,
            "addedBarrierRatio": round(added_barrier_ratio, 4),
            "barrierCapped": barrier_capped,
            "barrierRejectedAsTooBroad": barrier_rejected_as_too_broad,
            "exclusionBarrierApplied": True,
            "hardExclusionPixels": hard_excl_px,
            "hardExclusionAreaSqft": round(hard_excl_px * area_per_px, 1),
            "morphologyOnlyBarrierPixels": morph_only_px,
            "morphologyOnlyBarrierAreaSqft": round(morph_only_px * area_per_px, 1),
            "mediumConstrainedBarrierMode": True,
            "grassPositiveMode": True,
            "objectExclusionConservative": True,
            "exclusionRules": {
                "gravelSatMax": 28.0,
                "gravelExcessGreenMax": 3.0,
                "gravelTextureThresholdFactor": 0.50,
                "neutralGraySatMax": 14.0,
                "metalRustConstrained": True,
                "bareSoilConstrained": True,
                "hardExclusionTightGravelSatMax": 12.0,
                "hardExclusionTightGravelExcessGreenMax": -5.0,
                "hardExclusionNeutralGraySatMax": 6.0,
                "hardExclusionMetalExcessGreenMax": -8.0,
                "greenRescueExcessGreenMin": 2.0,
                "greenRescueGreenRatioMin": 0.34,
                "greenRescueNdviMin": 0.10,
                "lowNdviBarrier": nir_band is not None,
                "lowNdviThreshold": 0.05,
                "barrierGrowPixels": 0,
                "addedBarrierCapRatio": _ADD_CAP,
            },
        }

    # --- Standard path (all other presets): single combined barrier with moat ---
    # medium_residential (non-constrained): grow 3px so the binary_close during
    # vegetation morphology cannot bridge across roof-width gaps next to structures.
    # All other presets keep the 1-px moat to avoid eroding narrow lawn strips.
    _barrier_grow_px = 3 if (detection_preset == "medium_residential" and not constrained_boundary_mode) else 1
    barrier = grow_mask(barrier_seed, _barrier_grow_px) & valid_pixels

    area_per_px = parcel_area_sqft / valid_px if valid_px > 0 else 0.0
    gravel_px = int(np.count_nonzero(gravel_seed))
    large_obj_px = int(np.count_nonzero((metal_or_rust | bare_soil) & valid_pixels)) if constrained_boundary_mode else 0
    frozen_px = int(np.count_nonzero(barrier))

    return barrier, barrier, {
        "gravelExcludedPixels": gravel_px,
        "gravelExcludedAreaSqft": round(gravel_px * area_per_px, 1),
        "largeObjectExcludedPixels": large_obj_px,
        "largeObjectExcludedAreaSqft": round(large_obj_px * area_per_px, 1),
        "frozenExclusionPixels": frozen_px,
        "morphologyBarrierPixels": frozen_px,
        "hardscapeBarrierPixels": hardscape_px_count,
        "addedBarrierPixels": added_barrier_px,
        "addedBarrierRatio": round(added_barrier_ratio, 4),
        "barrierCapped": barrier_capped,
        "barrierRejectedAsTooBroad": barrier_rejected_as_too_broad,
        "exclusionBarrierApplied": True,
        "hardExclusionPixels": frozen_px,
        "hardExclusionAreaSqft": round(frozen_px * area_per_px, 1),
        "morphologyOnlyBarrierPixels": 0,
        "morphologyOnlyBarrierAreaSqft": 0.0,
        "mediumConstrainedBarrierMode": False,
        "exclusionRules": {
            "gravelSatMax": 28.0,
            "gravelExcessGreenMax": 3.0,
            "gravelTextureThresholdFactor": 0.50,
            "neutralGraySatMax": 14.0,
            "metalRustConstrained": bool(constrained_boundary_mode),
            "bareSoilConstrained": bool(constrained_boundary_mode),
            "lowNdviBarrier": nir_band is not None,
            "lowNdviThreshold": 0.05,
            "barrierGrowPixels": _barrier_grow_px,
            "addedBarrierCapRatio": _ADD_CAP,
        },
    }


def detect_trailer_components_for_exclusion(
    data: np.ma.MaskedArray,
    band_lookup: Dict[int, int],
    *,
    red_band: int,
    green_band: int,
    blue_band: int,
    nir_band: Optional[int],
    valid_pixels: np.ndarray,
    strong_green_mask: np.ndarray,
    hard_exclusion_mask: np.ndarray,
    parcel_area_sqft: float,
    transform: Any,
    raster_crs: Any,
    parcel_raster: BaseGeometry,
    min_trailer_sqft: float = 30.0,
    max_trailer_sqft: float = 12000.0,
    max_green_fraction: float = 0.25,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Component-level trailer/RV/metal object detector for medium_residential constrained mode.

    Finds cohesive non-green objects (gray/silver trailers, RVs, rust-metal) in the size
    range typical of vehicles/equipment and adds them to hard_exclusion_mask.  Operates at
    the connected-component level so scattered non-green pixels don't trigger exclusion.

    Returns (trailer_exclusion_mask, diagnostics).
    Guard: only call when detection_preset=='medium_residential' and constrained_boundary_mode.
    """
    valid_pixels = np.asarray(valid_pixels, dtype=bool)
    strong_green_mask = np.asarray(strong_green_mask, dtype=bool)
    hard_exclusion_mask = np.asarray(hard_exclusion_mask, dtype=bool)

    red   = np.asarray(data[band_lookup[red_band]].filled(0),   dtype=np.float32)
    green = np.asarray(data[band_lookup[green_band]].filled(0), dtype=np.float32)
    blue  = np.asarray(data[band_lookup[blue_band]].filled(0),  dtype=np.float32)
    brightness   = (red + green + blue) / 3.0
    saturation   = np.maximum.reduce([red, green, blue]) - np.minimum.reduce([red, green, blue])
    excess_green = 2.0 * green - red - blue
    abs_rg = np.abs(red - green)
    abs_gb = np.abs(green - blue)
    green_sum = red + green + blue
    green_ratio = np.zeros_like(green, dtype=np.float32)
    np.divide(green, green_sum, out=green_ratio, where=green_sum > 1e-6)

    # NDVI array if NIR available (used for component-level verification)
    ndvi_arr: Optional[np.ndarray] = None
    if nir_band is not None and nir_band in band_lookup:
        nir = np.asarray(data[band_lookup[nir_band]].filled(0), dtype=np.float32)
        nd_denom = nir + red
        ndvi_arr = np.zeros_like(red, dtype=np.float32)
        np.divide(nir - red, nd_denom, out=ndvi_arr, where=np.abs(nd_denom) > 1e-6)

    # Gray/silver/white trailers and metal roofs — achromatic to near-achromatic
    trailer_gray = (
        (brightness > 70.0)
        & (brightness < 232.0)
        & (saturation < 38.0)
        & (excess_green < 3.0)
        & (abs_rg < 26.0)
        & (abs_gb < 26.0)
    ) & valid_pixels

    # Rust/orange/faded-red trailers and RV panels
    trailer_rust = (
        (brightness > 40.0)
        & (brightness < 200.0)
        & (saturation < 62.0)
        & (excess_green < -2.0)
        & (red >= green + 12.0)
        & (green_ratio < 0.32)
    ) & valid_pixels

    # Combined candidate: not strongly green, not already hard-excluded (avoids re-labeling driveways)
    trailer_candidate = (trailer_gray | trailer_rust) & ~strong_green_mask & ~hard_exclusion_mask & valid_pixels
    if ndvi_arr is not None:
        trailer_candidate = trailer_candidate & ~((ndvi_arr > 0.18) & valid_pixels)

    _empty_result: Dict[str, Any] = {
        "trailerExcludedPixels": 0,
        "trailerExcludedAreaSqft": 0.0,
        "trailerComponentCount": 0,
        "trailerExclusionApplied": False,
    }

    if not np.any(trailer_candidate):
        return np.zeros(valid_pixels.shape, dtype=bool), _empty_result

    raw_geoms = vectorize_mask(
        trailer_candidate,
        transform=transform,
        crs=raster_crs,
        parcel_geom=parcel_raster,
        min_area_sqft=max(5.0, min_trailer_sqft * 0.3),
    )

    if not raw_geoms:
        return np.zeros(valid_pixels.shape, dtype=bool), _empty_result

    valid_px_count = int(np.count_nonzero(valid_pixels))
    area_per_px = parcel_area_sqft / valid_px_count if valid_px_count > 0 else 0.0
    high_confidence_geoms: List[BaseGeometry] = []

    for geom in raw_geoms:
        comp_area = area_sqft(geom, raster_crs)
        if comp_area < min_trailer_sqft or comp_area > max_trailer_sqft:
            continue
        comp_mask = rasterize_geometries([geom], out_shape=valid_pixels.shape, transform=transform)
        comp_valid = comp_mask & valid_pixels
        comp_px = int(np.count_nonzero(comp_valid))
        if comp_px < 3:
            continue
        green_frac = float(np.count_nonzero(comp_valid & strong_green_mask)) / comp_px
        if green_frac > max_green_fraction:
            continue
        mean_eg = float(np.mean(excess_green[comp_valid]))
        mean_gr = float(np.mean(green_ratio[comp_valid]))
        if mean_eg > 2.0 or mean_gr > 0.36:
            continue
        if ndvi_arr is not None:
            mean_ndvi = float(np.mean(ndvi_arr[comp_valid]))
            if mean_ndvi > 0.12:
                continue
        high_confidence_geoms.append(geom)

    if not high_confidence_geoms:
        return np.zeros(valid_pixels.shape, dtype=bool), _empty_result

    trailer_mask = rasterize_geometries(high_confidence_geoms, out_shape=valid_pixels.shape, transform=transform)
    trailer_mask = np.asarray(trailer_mask & valid_pixels & ~strong_green_mask, dtype=bool)
    trailer_px = int(np.count_nonzero(trailer_mask))
    return trailer_mask, {
        "trailerExcludedPixels": trailer_px,
        "trailerExcludedAreaSqft": round(trailer_px * area_per_px, 1),
        "trailerComponentCount": len(high_confidence_geoms),
        "trailerExclusionApplied": trailer_px > 0,
    }


def unique_float_sequence(primary: Optional[float], defaults: Sequence[float]) -> List[float]:
    values: List[float] = []
    for value in ([primary] if primary is not None else []) + list(defaults):
        number = round(float(value), 4)
        if number not in values:
            values.append(number)
    return values


def read_sam_mask(
    sam_mask_path: Path,
    *,
    dst_shape: Tuple[int, int],
    dst_transform: Any,
    dst_crs: Any,
) -> np.ndarray:
    rasterio = require_rasterio()
    from rasterio.warp import Resampling, reproject

    with rasterio.open(sam_mask_path) as src:
        source = src.read(1)
        destination = np.zeros(dst_shape, dtype=np.uint8)
        reproject(
            source,
            destination,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=dst_transform,
            dst_crs=dst_crs,
            resampling=Resampling.nearest,
            src_nodata=0,
            dst_nodata=0,
        )
    return destination > 0


def area_sqft(geom: BaseGeometry, source_crs: Any) -> float:
    if geom.is_empty:
        return 0.0
    centroid_wgs84 = transform_geometry(geom.centroid, str(source_crs), "EPSG:4326")
    equalish_area_crs = estimate_utm_epsg(centroid_wgs84.x, centroid_wgs84.y)
    projected = transform_geometry(geom, str(source_crs), equalish_area_crs)
    return projected.area * SQFT_PER_SQM


def projected_geometry_for_metrics(geom: BaseGeometry, source_crs: Any) -> BaseGeometry:
    centroid_wgs84 = transform_geometry(geom.centroid, str(source_crs), "EPSG:4326")
    equalish_area_crs = estimate_utm_epsg(centroid_wgs84.x, centroid_wgs84.y)
    return transform_geometry(geom, str(source_crs), equalish_area_crs)


def component_shape_metrics(geom: BaseGeometry, source_crs: Any) -> Dict[str, float]:
    projected = projected_geometry_for_metrics(geom, source_crs)
    perimeter = float(projected.length or 0.0)
    area = float(projected.area or 0.0)
    compactness = (4.0 * np.pi * area / (perimeter * perimeter)) if perimeter > 0 and area > 0 else 0.0
    return {
        "compactness": round(float(max(0.0, min(1.0, compactness))), 4),
        "perimeterMeters": round(perimeter, 2),
    }


def vectorize_mask(
    mowable_mask: np.ndarray,
    *,
    transform: Any,
    crs: Any,
    parcel_geom: BaseGeometry,
    min_area_sqft: float,
) -> List[BaseGeometry]:
    from rasterio.features import shapes

    geoms = []
    for geom_json, value in shapes(mowable_mask.astype(np.uint8), mask=mowable_mask, transform=transform):
        if value != 1:
            continue
        clipped = shape(geom_json).intersection(parcel_geom)
        if clipped.is_empty:
            continue
        if not clipped.is_valid:
            clipped = clipped.buffer(0).intersection(parcel_geom)
        geoms.extend(part for part in polygon_parts(clipped) if area_sqft(part, crs) >= min_area_sqft)
    return geoms


def rasterize_geometries(
    geoms: Sequence[BaseGeometry],
    *,
    out_shape: Tuple[int, int],
    transform: Any,
) -> np.ndarray:
    if not geoms:
        return np.zeros(out_shape, dtype=bool)
    from rasterio.features import rasterize

    return rasterize(
        [(mapping(geom), 1) for geom in geoms if not geom.is_empty],
        out_shape=out_shape,
        transform=transform,
        fill=0,
        dtype=np.uint8,
    ).astype(bool)


def component_mask_metrics(component_mask: np.ndarray, context: Dict[str, Any]) -> Dict[str, float]:
    pixels = component_mask.astype(bool)
    pixel_count = int(np.count_nonzero(pixels))
    if pixel_count <= 0:
        return {
            "denseWoodsRatio": 0.0,
            "woodsAdjacencyRatio": 0.0,
            "accessProximityRatio": 0.0,
            "smoothInteriorRatio": 0.0,
            "noisyBoundaryRatio": 0.0,
        }

    eroded = binary_erode(pixels)
    boundary = pixels & ~eroded
    interior = eroded if np.any(eroded) else pixels
    texture_map = context["textureMap"]
    texture_threshold = max(1.0, float(context.get("textureThreshold") or 1.0))
    interior_texture = texture_map[interior & np.isfinite(texture_map)]
    boundary_texture = texture_map[boundary & np.isfinite(texture_map)]
    interior_mean = float(np.mean(interior_texture)) if interior_texture.size else texture_threshold
    smooth_interior_ratio = 1.0 - min(1.0, interior_mean / (texture_threshold * 1.2))
    noisy_boundary_ratio = float(np.mean(boundary_texture > texture_threshold)) if boundary_texture.size else 0.0

    return {
        "denseWoodsRatio": round(float(np.mean(context["denseWoods"][pixels])), 4),
        "woodsAdjacencyRatio": round(float(np.mean(context["denseWoodsZone"][pixels])), 4),
        "accessProximityRatio": round(float(np.mean(context["accessZone"][pixels])), 4),
        "smoothInteriorRatio": round(max(0.0, min(1.0, smooth_interior_ratio)), 4),
        "noisyBoundaryRatio": round(max(0.0, min(1.0, noisy_boundary_ratio)), 4),
    }


def score_component(
    *,
    area_sqft_value: float,
    parcel_area_sqft: float,
    min_area_sqft: float,
    compactness: float,
    mask_metrics: Dict[str, float],
    hard_surface_pixels: int,
) -> float:
    ratio = area_sqft_value / parcel_area_sqft if parcel_area_sqft > 0 else 0.0
    area_factor = min(1.0, math.log(max(area_sqft_value / max(min_area_sqft, 1.0), 1.0), 7.0))
    access_factor = min(1.0, mask_metrics["accessProximityRatio"] * 10.0) if hard_surface_pixels > 0 else 0.35
    score = 0.10
    score += area_factor * 0.35
    score += min(1.0, compactness * 4.0) * 0.18
    score += mask_metrics["smoothInteriorRatio"] * 0.16
    score += access_factor * 0.12
    if 0.015 <= ratio <= 0.55:
        score += 0.10
    elif 0.55 < ratio <= 0.85:
        score += 0.02
    elif ratio > 0.90:
        score -= 0.12
    score -= mask_metrics["denseWoodsRatio"] * 0.34
    score -= mask_metrics["woodsAdjacencyRatio"] * 0.12
    score -= mask_metrics["noisyBoundaryRatio"] * 0.14
    if area_sqft_value < min_area_sqft * 3.0:
        score -= 0.04
    return round(max(-1.0, min(1.0, score)), 4)


def select_scored_components(
    geoms: Sequence[BaseGeometry],
    *,
    parcel_geom: BaseGeometry,
    crs: Any,
    transform: Any,
    out_shape: Tuple[int, int],
    context: Dict[str, Any],
    max_component_ratio: float,
    min_area_sqft: float,
    max_components: int,
) -> Tuple[List[BaseGeometry], List[float], List[Dict[str, Any]], List[Dict[str, Any]]]:
    parcel_area = area_sqft(parcel_geom, crs)
    component_areas: List[float] = []
    rejected: List[Dict[str, Any]] = []
    scored: List[Tuple[float, BaseGeometry, Dict[str, Any]]] = []

    for idx, geom in enumerate(geoms, start=1):
        component_area = area_sqft(geom, crs)
        component_areas.append(round(component_area, 2))
        ratio = component_area / parcel_area if parcel_area > 0 else 0.0
        shape_metrics = component_shape_metrics(geom, crs)
        compactness = shape_metrics["compactness"]
        component_mask = rasterize_geometries([geom], out_shape=out_shape, transform=transform)
        mask_metrics = component_mask_metrics(component_mask, context)
        score = score_component(
            area_sqft_value=component_area,
            parcel_area_sqft=parcel_area,
            min_area_sqft=min_area_sqft,
            compactness=compactness,
            mask_metrics=mask_metrics,
            hard_surface_pixels=int(context.get("hardSurfacePixels") or 0),
        )
        details = {
            "index": idx,
            "areaSqft": round(component_area, 2),
            "ratio": round(ratio, 4),
            "compactness": compactness,
            "score": score,
            **mask_metrics,
        }

        if component_area < min_area_sqft:
            rejected.append({**details, "reason": "component below mowable lawn area floor"})
            continue
        if max_component_ratio > 0 and ratio >= max_component_ratio:
            rejected.append({**details, "reason": "component covers too much of parcel"})
            continue

        woods_like = (
            component_area < min_area_sqft * 6.0
            and (
                (mask_metrics["denseWoodsRatio"] > 0.55 and mask_metrics["noisyBoundaryRatio"] > 0.50)
                or (compactness < 0.035 and mask_metrics["noisyBoundaryRatio"] > 0.62)
                or (
                    mask_metrics["woodsAdjacencyRatio"] > 0.80
                    and mask_metrics["accessProximityRatio"] < 0.01
                )
            )
        )
        if woods_like:
            rejected.append({**details, "reason": "woods-like noisy component"})
            continue
        if component_area < min_area_sqft * 2.0 and compactness < 0.035:
            rejected.append({**details, "reason": "small irregular canopy-like component"})
            continue

        scored.append((score, geom, details))

    scored.sort(key=lambda item: (item[0], item[2]["areaSqft"]), reverse=True)
    if not scored:
        return [], component_areas, rejected, []

    largest_area = max(item[2]["areaSqft"] for item in scored)
    kept: List[BaseGeometry] = []
    component_scores: List[Dict[str, Any]] = []
    for rank, (score, geom, details) in enumerate(scored, start=1):
        significant = details["areaSqft"] >= largest_area * 0.22
        strong_candidate = score >= 0.24
        if rank > max_components and not significant:
            rejected.append({**details, "reason": "fragmented surplus component"})
            continue
        if not strong_candidate and not significant:
            rejected.append({**details, "reason": "low-scoring scattered component"})
            continue
        kept.append(geom)
        component_scores.append({**details, "rank": len(component_scores) + 1})

    return kept, component_areas, rejected, component_scores


def filter_oversized_components(
    geoms: Sequence[BaseGeometry],
    *,
    parcel_geom: BaseGeometry,
    crs: Any,
    max_component_ratio: float,
    min_area_sqft: float,
) -> Tuple[List[BaseGeometry], List[float], List[Dict[str, Any]]]:
    parcel_area = area_sqft(parcel_geom, crs)
    candidates: List[Tuple[BaseGeometry, float, Dict[str, float], int]] = []
    component_areas: List[float] = []
    rejected: List[Dict[str, Any]] = []
    for idx, geom in enumerate(geoms, start=1):
        component_area = area_sqft(geom, crs)
        component_areas.append(round(component_area, 2))
        ratio = component_area / parcel_area if parcel_area > 0 else 0
        shape_metrics = component_shape_metrics(geom, crs)
        compactness = shape_metrics["compactness"]
        if component_area < min_area_sqft:
            rejected.append(
                {
                    "index": idx,
                    "areaSqft": round(component_area, 2),
                    "ratio": round(ratio, 4),
                    "compactness": compactness,
                    "reason": "component below mowable lawn area floor",
                }
            )
            continue
        if component_area < min_area_sqft * 3.0 and compactness < 0.06:
            rejected.append(
                {
                    "index": idx,
                    "areaSqft": round(component_area, 2),
                    "ratio": round(ratio, 4),
                    "compactness": compactness,
                    "reason": "small irregular canopy-like component",
                }
            )
            continue
        if max_component_ratio > 0 and ratio >= max_component_ratio:
            rejected.append(
                {
                    "index": idx,
                    "areaSqft": round(component_area, 2),
                    "ratio": round(ratio, 4),
                    "compactness": compactness,
                    "reason": "component covers too much of parcel",
                }
            )
            continue

        candidates.append((geom, component_area, shape_metrics, idx))

    candidates.sort(key=lambda item: item[1], reverse=True)
    kept: List[BaseGeometry] = []
    largest_area = candidates[0][1] if candidates else 0.0
    for rank, (geom, component_area, shape_metrics, idx) in enumerate(candidates, start=1):
        compactness = shape_metrics["compactness"]
        significant = largest_area > 0 and component_area >= largest_area * 0.18
        if rank > MAX_COMPONENTS_TO_KEEP and not significant:
            rejected.append(
                {
                    "index": idx,
                    "areaSqft": round(component_area, 2),
                    "compactness": compactness,
                    "reason": "fragmented surplus component",
                }
            )
            continue
        kept.append(geom)
    return kept, component_areas, rejected


def geometry_similarity_to_parcel(geoms: Sequence[BaseGeometry], *, parcel_geom: BaseGeometry, crs: Any) -> float:
    parcel_area = area_sqft(parcel_geom, crs)
    if parcel_area <= 0 or not geoms:
        return 0.0
    try:
        detected = unary_union(list(geoms))
        diff_area = area_sqft(parcel_geom.symmetric_difference(detected), crs)
    except Exception:
        return 0.0
    return round(max(0.0, min(1.0, 1.0 - (diff_area / parcel_area))), 4)


def confidence_for_candidate(
    *,
    detected_ratio: float,
    vegetation_pixels: int,
    polygon_count: int,
    parcel_similarity: float,
) -> float:
    if vegetation_pixels <= 0 or polygon_count <= 0 or detected_ratio <= 0:
        return 0.0
    if detected_ratio < 0.02:
        return 0.15
    if parcel_similarity >= 0.98 or detected_ratio > 0.95:
        return 0.2
    if 0.05 <= detected_ratio <= 0.55:
        return 0.72
    if detected_ratio < 0.05:
        return 0.38
    if detected_ratio <= 0.70:
        return 0.64
    if detected_ratio <= 0.90:
        return 0.55
    return 0.32


def score_candidate(candidate: Dict[str, Any]) -> float:
    ratio = float(candidate["detectedRatio"])
    confidence = float(candidate["confidence"])
    score = confidence
    if 0.05 <= ratio <= 0.55:
        score += 0.35
    elif 0.55 < ratio <= 0.70:
        score += 0.12
    elif 0.70 < ratio <= 0.90 and candidate["hasExclusionEvidence"]:
        score += 0.05
    elif ratio < 0.05:
        score -= 0.04 if candidate.get("fallbackMode") else 0.12
    else:
        score -= 0.3
    score += min(int(candidate["polygonCount"]), 4) * 0.01
    score += min(0.18, float(candidate.get("largestComponentShare", 0.0)) * 0.18)
    score += min(0.08, float(candidate.get("averageCompactness", 0.0)) * 0.08)
    score += min(0.14, float(candidate.get("averageComponentScore", 0.0)) * 0.14)
    score -= min(0.22, max(0, int(candidate["polygonCount"]) - 3) * 0.035)
    score -= min(0.12, int(candidate.get("rejectedSmallComponents", 0)) * 0.01)
    score -= min(0.18, int(candidate.get("rejectedWoodsLikeComponents", 0)) * 0.025)
    score -= max(0.0, float(candidate["parcelSimilarity"]) - 0.92) * 0.8
    return round(score, 4)


def evaluate_mask_candidate(
    mowable: np.ndarray,
    diagnostics: Dict[str, Any],
    *,
    transform: Any,
    raster_crs: Any,
    parcel_raster: BaseGeometry,
    parcel_area_sqft: float,
    context: Dict[str, Any],
    min_component_area_sqft: float,
    max_component_ratio: float,
    max_detected_ratio: float = 0.93,
    hard_detected_ratio: float = 0.97,
    strong_exclusion_ratio: float = 0.015,
    mask_pixel_count_before_filtering: Optional[int] = None,
    mask_before_filter: Optional[np.ndarray] = None,
    fallback_mode: bool = False,
    max_components: int = 3,
    merge_distance_m: float = 5.0,
    min_hole_sqft: float = 500.0,
) -> Dict[str, Any]:
    raw_geoms = vectorize_mask(
        mowable,
        transform=transform,
        crs=raster_crs,
        parcel_geom=parcel_raster,
        min_area_sqft=max(5.0, min_component_area_sqft * 0.05),
    )
    pre_merge_sizes = [area_sqft(g, raster_crs) for g in raw_geoms]
    avg_component_size_before = round(float(np.mean(pre_merge_sizes)), 1) if pre_merge_sizes else 0.0
    merged_geoms, merged_component_count = merge_nearby_components(
        raw_geoms, merge_distance_m=merge_distance_m, source_crs=raster_crs,
    )
    geoms, component_areas, rejected_components, component_scores = select_scored_components(
        merged_geoms,
        parcel_geom=parcel_raster,
        crs=raster_crs,
        transform=transform,
        out_shape=mowable.shape,
        context=context,
        max_component_ratio=max_component_ratio,
        min_area_sqft=min_component_area_sqft,
        max_components=max_components,
    )
    geoms, hole_count_removed = fill_polygon_holes(geoms, min_hole_sqft=min_hole_sqft, source_crs=raster_crs)
    geoms = smooth_geoms(geoms, source_crs=raster_crs)
    geoms, more_holes = fill_polygon_holes(geoms, min_hole_sqft=min_hole_sqft, source_crs=raster_crs)
    hole_count_removed += more_holes
    post_hole_sizes = [area_sqft(g, raster_crs) for g in geoms]
    avg_component_size_after = round(float(np.mean(post_hole_sizes)), 1) if post_hole_sizes else 0.0
    selected_mask = rasterize_geometries(geoms, out_shape=mowable.shape, transform=transform) & context["valid"]
    vegetation_pixels = int(np.count_nonzero(selected_mask))
    detected_area_sqft = sum(area_sqft(geom, raster_crs) for geom in geoms) if geoms else 0.0
    detected_ratio = detected_area_sqft / parcel_area_sqft if parcel_area_sqft > 0 else 0.0
    kept_component_areas = [area_sqft(geom, raster_crs) for geom in geoms]
    largest_component_share = (max(kept_component_areas) / detected_area_sqft) if detected_area_sqft > 0 and kept_component_areas else 0.0
    compactness_values = [component_shape_metrics(geom, raster_crs)["compactness"] for geom in geoms]
    average_compactness = float(np.mean(compactness_values)) if compactness_values else 0.0
    component_score_values = [float(item["score"]) for item in component_scores]
    average_component_score = float(np.mean(component_score_values)) if component_score_values else 0.0
    rejected_small_components = sum(
        1 for item in rejected_components
        if item.get("reason") in {"component below mowable lawn area floor", "small irregular canopy-like component"}
    )
    rejected_woods_like_components = sum(
        1 for item in rejected_components
        if item.get("reason") == "woods-like noisy component"
    )
    parcel_similarity = geometry_similarity_to_parcel(geoms, parcel_geom=parcel_raster, crs=raster_crs)
    hardscape_pixels = int(diagnostics.get("hardscapePixels") or 0)
    valid_pixels = int(diagnostics.get("validPixels") or mowable.size or 0)
    vegetation_candidate_pixels = int(diagnostics.get("vegetationCandidatePixels") or np.count_nonzero(mowable))
    hardscape_exclusion_ratio = hardscape_pixels / valid_pixels if valid_pixels > 0 else 0.0
    has_exclusion_evidence = (
        bool(rejected_components)
        or hardscape_pixels > max(8, valid_pixels * 0.015)
        or (0.0 < detected_ratio < 0.92 and parcel_similarity < 0.95)
    )
    has_strong_exclusion_evidence = (
        bool(rejected_components)
        or hole_count_removed > 0
        or hardscape_exclusion_ratio >= strong_exclusion_ratio
    )
    confidence = confidence_for_candidate(
        detected_ratio=detected_ratio,
        vegetation_pixels=vegetation_pixels,
        polygon_count=len(geoms),
        parcel_similarity=parcel_similarity,
    )

    reject_reason = ""
    if not geoms or detected_area_sqft <= 0:
        reject_reason = "empty detection"
    elif not fallback_mode and detected_ratio < SOFT_FALLBACK_RATIO:
        reject_reason = "extremely small detection"
    elif fallback_mode and detected_area_sqft < min(float(min_component_area_sqft), 50.0):
        reject_reason = "fallback detection below mowable area floor"
    elif len(merged_geoms) > 30 and largest_component_share < 0.35 and average_component_score < 0.34:
        reject_reason = "high-fragmentation canopy-like detection"
    elif detected_ratio > hard_detected_ratio or parcel_similarity >= 0.99:
        reject_reason = "parcel-sized geometry"
    elif detected_ratio > max_detected_ratio and not has_strong_exclusion_evidence:
        reject_reason = "near-whole-parcel detection without strong exclusion evidence"
    elif detected_ratio > max_detected_ratio and not has_exclusion_evidence:
        reject_reason = "high ratio without exclusions"

    candidate = {
        "ndviThreshold": diagnostics["ndviThreshold"],
        "visibleThreshold": diagnostics["visibleThreshold"],
        "saturationMin": diagnostics["saturationMin"],
        "brightnessMin": diagnostics["brightnessMin"],
        "vegetationPixels": vegetation_pixels,
        "rawVegetationPixels": int(np.count_nonzero(mowable)),
        "maskPixelCountBeforeFiltering": int(mask_pixel_count_before_filtering if mask_pixel_count_before_filtering is not None else np.count_nonzero(mowable)),
        "maskPixelCountAfterFiltering": int(np.count_nonzero(mowable)),
        "polygonCount": len(geoms),
        "rawPolygonCount": len(raw_geoms),
        "mergedPolygonCount": len(merged_geoms),
        "polygonCountBeforeFiltering": len(raw_geoms),
        "polygonCountAfterFiltering": len(geoms),
        "keptComponentCount": len(geoms),
        "mergedComponentCount": merged_component_count,
        "holeCountRemoved": hole_count_removed,
        "avgComponentSizeBefore": avg_component_size_before,
        "avgComponentSizeAfter": avg_component_size_after,
        "componentAreas": component_areas,
        "componentScores": component_scores,
        "rejectedComponents": rejected_components,
        "rejectedSmallComponents": rejected_small_components,
        "rejectedWoodsLikeComponents": rejected_woods_like_components,
        "detectedAreaSqft": round(detected_area_sqft, 2),
        "detectedRatio": round(detected_ratio, 4),
        "confidence": round(confidence, 3),
        "canopyRejectedPixels": diagnostics.get("canopyRejectedPixels", 0),
        "canopyHintPixels": diagnostics.get("canopyHintPixels", 0),
        "townLawnExtensionPixels": diagnostics.get("townLawnExtensionPixels", 0),
        "hardscapePixels": hardscape_pixels,
        "hardscapeSeedPixels": diagnostics.get("hardscapeSeedPixels", 0),
        "waterOrPoolPixels": diagnostics.get("waterOrPoolPixels", 0),
        "vegetationCandidatePixels": vegetation_candidate_pixels,
        "validPixels": valid_pixels,
        "hardscapeExcludedAreaSqft": round(parcel_area_sqft * (hardscape_pixels / valid_pixels), 2) if valid_pixels > 0 else 0.0,
        "hardscapeExclusionRatio": round(float(hardscape_exclusion_ratio), 4),
        "hardscapeExcludedRatio": round(float(hardscape_exclusion_ratio), 4),
        "vegetationCandidateAreaSqft": round(parcel_area_sqft * (vegetation_candidate_pixels / valid_pixels), 2) if valid_pixels > 0 else 0.0,
        "finalSelectedAreaSqft": round(detected_area_sqft, 2),
        "detectionPreset": diagnostics.get("detectionPreset"),
        "detectionMode": diagnostics.get("detectionMode", "manmade_exclusion_then_vegetation"),
        "vegetationFilterApplied": diagnostics.get("vegetationFilterApplied", True),
        "retryReason": diagnostics.get("retryReason", ""),
        "remainderAreaSqft": round(detected_area_sqft, 2),
        "hardscapeRules": diagnostics.get("hardscapeRules", {}),
        "textureScore": diagnostics.get("textureScore", 0.0),
        "brightnessRange": diagnostics.get("brightnessRange", [0.0, 0.0]),
        "largestComponentShare": round(float(largest_component_share), 4),
        "averageCompactness": round(float(average_compactness), 4),
        "averageComponentScore": round(float(average_component_score), 4),
        "parcelSimilarity": parcel_similarity,
        "hasExclusionEvidence": has_exclusion_evidence,
        "hasStrongExclusionEvidence": has_strong_exclusion_evidence,
        "fallbackMode": bool(fallback_mode),
        "rejectReason": reject_reason,
        "geoms": geoms,
        "maskBeforeFilter": mask_before_filter.copy() if mask_before_filter is not None else mowable.copy(),
        "mask": selected_mask,
        "diagnostics": diagnostics,
    }
    candidate["score"] = score_candidate(candidate) if not reject_reason else round(score_candidate(candidate) - 0.5, 4)
    return candidate


def write_geojson(geoms: Sequence[BaseGeometry], *, source_crs: Any, output_path: Path, properties: Dict[str, Any]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    features = []
    for idx, geom in enumerate(geoms, start=1):
        geom_wgs84 = transform_geometry(geom, str(source_crs), "EPSG:4326")
        features.append(
            {
                "type": "Feature",
                "id": f"mowable-{idx}",
                "properties": dict(properties, areaSqft=round(area_sqft(geom, source_crs), 2)),
                "geometry": mapping(geom_wgs84),
            }
        )
    with output_path.open("w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh)


def write_mask(path: Path, mask: np.ndarray, *, transform: Any, crs: Any) -> None:
    rasterio = require_rasterio()

    path.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        "driver": "GTiff",
        "height": mask.shape[0],
        "width": mask.shape[1],
        "count": 1,
        "dtype": "uint8",
        "crs": crs,
        "transform": transform,
        "compress": "deflate",
        "nodata": 0,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(mask.astype(np.uint8), 1)


def rgb_preview_from_data(
    data: np.ma.MaskedArray,
    band_lookup: Dict[int, int],
    *,
    red_band: int,
    green_band: int,
    blue_band: int,
) -> Image.Image:
    valid = valid_data_mask(data)
    red = normalize_to_uint8(np.asarray(data[band_lookup[red_band]].filled(0), dtype=np.float32), valid)
    green = normalize_to_uint8(np.asarray(data[band_lookup[green_band]].filled(0), dtype=np.float32), valid)
    blue = normalize_to_uint8(np.asarray(data[band_lookup[blue_band]].filled(0), dtype=np.float32), valid)
    return Image.fromarray(np.dstack([red, green, blue]), mode="RGB")


def mask_preview(mask: np.ndarray) -> Image.Image:
    return Image.fromarray((mask.astype(np.uint8) * 255), mode="L")


def raster_boundary(mask: np.ndarray) -> np.ndarray:
    pixels = mask.astype(bool)
    return pixels & ~binary_erode(pixels)


def save_debug_artifacts(
    debug_dir: Path,
    *,
    data: np.ma.MaskedArray,
    band_lookup: Dict[int, int],
    red_band: int,
    green_band: int,
    blue_band: int,
    nir_band: Optional[int],
    transform: Any,
    parcel_geom: BaseGeometry,
    geoms: Sequence[BaseGeometry],
    before_filter_mask: np.ndarray,
    selected_mask: np.ndarray,
) -> Dict[str, str]:
    debug_dir.mkdir(parents=True, exist_ok=True)
    artifacts = {
        "rawNaip": str(debug_dir / "raw_naip.tif"),
        "rgbPreview": str(debug_dir / "rgb_preview.png"),
        "ndviPreview": str(debug_dir / "ndvi_preview.png"),
        "vegetationMaskBeforeFilter": str(debug_dir / "vegetation_mask_before_filter.png"),
        "vegetationMaskAfterFilter": str(debug_dir / "vegetation_mask_after_filter.png"),
        "finalPolygonOverlay": str(debug_dir / "final_polygon_overlay.png"),
        "polygonOutput": str(debug_dir / "polygon_output.geojson"),
    }

    rgb_image = rgb_preview_from_data(
        data,
        band_lookup,
        red_band=red_band,
        green_band=green_band,
        blue_band=blue_band,
    )
    rgb_image.save(artifacts["rgbPreview"])

    valid = valid_data_mask(data)
    ndvi = ndvi_from_data(data, band_lookup, red_band=red_band, nir_band=nir_band)
    if ndvi is None:
        ndvi_image = Image.new("L", selected_mask.shape[::-1], 0)
    else:
        ndvi_image = Image.fromarray(normalize_to_uint8(ndvi, valid), mode="L")
    ndvi_image.save(artifacts["ndviPreview"])

    mask_preview(before_filter_mask).save(artifacts["vegetationMaskBeforeFilter"])
    mask_preview(selected_mask).save(artifacts["vegetationMaskAfterFilter"])
    mask_preview(selected_mask).save(debug_dir / "vegetation_mask.png")

    overlay = rgb_image.convert("RGBA")
    overlay_layer = Image.new("RGBA", overlay.size, (0, 0, 0, 0))
    overlay_arr = np.array(overlay_layer)
    parcel_mask = rasterize_geometries([parcel_geom], out_shape=selected_mask.shape, transform=transform)
    detected_mask = rasterize_geometries(geoms, out_shape=selected_mask.shape, transform=transform)
    overlay_arr[raster_boundary(parcel_mask)] = [255, 64, 64, 230]
    overlay_arr[detected_mask] = [40, 210, 120, 88]
    overlay_arr[raster_boundary(detected_mask)] = [40, 255, 180, 230]
    overlay = Image.alpha_composite(overlay, Image.fromarray(overlay_arr, mode="RGBA"))
    draw = ImageDraw.Draw(overlay)
    draw.text((8, 8), "red=parcel cyan/green=selected polygons", fill=(255, 255, 255, 230))
    overlay.convert("RGB").save(artifacts["finalPolygonOverlay"])
    overlay.convert("RGB").save(debug_dir / "parcel_overlay.png")
    return artifacts


def detect_mowable(args: argparse.Namespace) -> Dict[str, Any]:
    rasterio = require_rasterio()
    from rasterio.features import sieve
    from rasterio.mask import mask as raster_mask

    debug_dir_value = str(getattr(args, "debug_dir", "") or "").strip()
    debug_dir = Path(debug_dir_value) if debug_dir_value else None
    debug_artifacts: Dict[str, str] = {}
    parcel_wgs84 = load_geojson_geometry(Path(args.parcel))
    if not parcel_wgs84.is_valid:
        parcel_wgs84 = parcel_wgs84.buffer(0)

    with rasterio.open(args.imagery) as src:
        if src.crs is None:
            raise ValueError("Imagery must have a CRS.")
        raster_bands = src.count
        raster_crs = src.crs
        raster_width = int(src.width)
        raster_height = int(src.height)
        raster_transform = tuple(round(float(value), 10) for value in src.transform)
        parcel_raster = transform_geometry(parcel_wgs84, args.parcel_crs, str(raster_crs))
        required_rgb = [args.red_band, args.green_band, args.blue_band]
        missing_rgb = [band for band in required_rgb if band < 1 or band > src.count]
        if missing_rgb:
            raise ValueError(f"Imagery has {src.count} bands; RGB band selection is invalid: {missing_rgb}")

        nir_band = args.nir_band if args.nir_band and args.nir_band <= src.count else None
        band_indexes, band_lookup = selected_bands(args.red_band, args.green_band, args.blue_band, nir_band)
        data, transform = raster_mask(src, [mapping(parcel_raster)], indexes=band_indexes, crop=True, filled=False)
        imagery_mode = "ndvi" if nir_band else "visible-rgb"
        mode = "manmade_exclusion_then_vegetation"
        band_order_assumption = {
            "redBand": args.red_band,
            "greenBand": args.green_band,
            "blueBand": args.blue_band,
            "nirBand": nir_band,
            "source": "configured NAIP band assumption: 1=red, 2=green, 3=blue, 4=NIR",
        }
        naip_nir_warning = "" if nir_band else "NAIP export returned RGB-only imagery; NDVI disabled."
        band_stats = band_statistics(data, band_indexes)
        ndvi = ndvi_from_data(data, band_lookup, red_band=args.red_band, nir_band=nir_band)
        valid_for_stats = valid_data_mask(data)
        ndvi_stats = stats_for_values(ndvi[valid_for_stats]) if ndvi is not None else None
        sam_mask = None
        if args.sam_mask:
            sam_mask = read_sam_mask(
                Path(args.sam_mask),
                dst_shape=data.shape[1:],
                dst_transform=transform,
                dst_crs=raster_crs,
            )
            imagery_mode = f"sam-mask-{args.combine}-{imagery_mode}"

        parcel_area_sqft = area_sqft(parcel_raster, raster_crs)
        detection_preset = normalize_detection_preset(getattr(args, "detection_preset", ""), parcel_area_sqft)
        preset = preset_thresholds(detection_preset)
        mode = preset["detectionMode"]
        thresholds_used = {
            "detectionPreset": detection_preset,
            "detectionMode": preset["detectionMode"],
            "ndviSweep": preset["ndviSweep"],
            "visibleSweep": preset["visibleSweep"],
            "brightnessSweep": preset["brightnessSweep"],
            "maxDetectedRatio": preset["maxDetectedRatio"],
            "hardDetectedRatio": preset["hardDetectedRatio"],
            "strongExclusionRatio": preset["strongExclusionRatio"],
            "minComponentAreaSqft": preset["minComponentAreaSqft"],
            "maxComponentRatio": preset["maxComponentRatio"],
            "maxComponents": preset["maxComponents"],
            "softFallback": preset["softFallback"],
            "lowConfidenceCandidate": preset["lowConfidenceCandidate"],
            "hardscapeRules": preset["hardscapeRules"],
            "vegetation": preset["vegetation"],
        }
        valid_pixels = valid_data_mask(data)
        analysis_context = analysis_context_from_bands(
            data,
            band_lookup,
            red_band=args.red_band,
            green_band=args.green_band,
            blue_band=args.blue_band,
            nir_band=nir_band,
            brightness_min=args.brightness_min,
        )
        # Enhanced hardscape mask subtracted from final mowable masks. On small lots
        # it becomes the primary signal: hardscape first, parcel remainder second.
        hardscape_retry_reason = ""
        hardscape_subtract_mask, hardscape_mask_details = build_hardscape_subtract_mask(
            data,
            band_lookup,
            red_band=args.red_band,
            green_band=args.green_band,
            blue_band=args.blue_band,
            nir_band=nir_band,
            valid_pixels=valid_pixels,
            analysis_context=analysis_context,
            detection_preset=detection_preset,
            preset=preset,
        )
        valid_pixel_count = int(np.count_nonzero(valid_pixels))
        hardscape_excluded_ratio = (int(np.count_nonzero(hardscape_subtract_mask)) / valid_pixel_count) if valid_pixel_count > 0 else 0.0
        if detection_preset == "small_residential" and hardscape_excluded_ratio > 0.70:
            hardscape_retry_reason = "hardscapeExcludedRatio above 0.70; relaxed hardscape thresholds"
            hardscape_subtract_mask, hardscape_mask_details = build_hardscape_subtract_mask(
                data,
                band_lookup,
                red_band=args.red_band,
                green_band=args.green_band,
                blue_band=args.blue_band,
                nir_band=nir_band,
                valid_pixels=valid_pixels,
                analysis_context=analysis_context,
                detection_preset=detection_preset,
                preset=preset,
                relaxed=True,
            )
            hardscape_excluded_ratio = (int(np.count_nonzero(hardscape_subtract_mask)) / valid_pixel_count) if valid_pixel_count > 0 else 0.0
        _hs_total_px = int(np.count_nonzero(hardscape_subtract_mask))
        print(f"[Vision] hardscape_subtract_mask total_px={_hs_total_px} of {valid_pixel_count} valid ratio={round(hardscape_excluded_ratio, 4)} retryReason={hardscape_retry_reason or 'none'}", flush=True)
        if detection_preset == "medium_residential" and hardscape_excluded_ratio < 0.025 and valid_pixel_count > 0:
            print(
                f"[Vision] medium_residential WARNING: very low hardscapeExcludedRatio={round(hardscape_excluded_ratio, 4)}"
                " — expected ≥ 0.025 for suburban lot; structure detection may be under-performing.",
                flush=True,
            )
        if detection_preset == "large_rural":
            ndvi_values = unique_float_sequence(args.ndvi_threshold, preset["ndviSweep"])
            visible_values = unique_float_sequence(args.visible_threshold, preset["visibleSweep"])
            brightness_values = unique_float_sequence(args.brightness_min, preset["brightnessSweep"])
        else:
            ndvi_values = unique_float_sequence(None, preset["ndviSweep"])
            visible_values = unique_float_sequence(None, preset["visibleSweep"])
            brightness_values = unique_float_sequence(None, preset["brightnessSweep"])
        opening_iterations = max(0, int(args.opening_iterations or 0))
        selected: Optional[Dict[str, Any]] = None
        candidate_results: List[Dict[str, Any]] = []
        fallback_soft_mask_used = False
        soft_candidate: Optional[Dict[str, Any]] = None
        is_large_parcel = detection_preset == "large_rural"
        min_component_area_sqft = max(
            float(args.min_area_sqft),
            float(preset["minComponentAreaSqft"]),
            min(500.0 if is_large_parcel else 250.0, parcel_area_sqft * 0.001),
        )
        effective_max_components = int(preset["maxComponents"])
        constrained_boundary_mode = bool(getattr(args, "constrained_boundary_mode", False))
        # medium_residential: preserve holes ≥ 200 sqft so small garages/sheds remain
        # as cutouts rather than being filled back in by fill_polygon_holes.
        # All other presets keep the 500-sqft default.
        _min_hole_sqft = 200.0 if detection_preset == "medium_residential" else 500.0
        if constrained_boundary_mode:
            # Inside a user-selected mowable boundary, vegetation legitimately covers 80-95%
            # of the remaining non-hardscape area after house/driveway removal. The preset's
            # maxComponentRatio and maxDetectedRatio are calibrated for whole-parcel detection
            # and would falsely reject valid lawn polygons inside the selected boundary.
            effective_max_component_ratio = 0.97
            max_detected_ratio = 0.97
            hard_detected_ratio = 0.995
        else:
            effective_max_component_ratio = min(float(args.max_component_ratio), float(preset["maxComponentRatio"]))
            max_detected_ratio = float(preset["maxDetectedRatio"])
            hard_detected_ratio = float(preset["hardDetectedRatio"])
        # Adaptive morphological closing based on ground sample distance (GSD).
        # For 1m NAIP: ~6 px filling (~6m gaps); caps at 10 px to avoid over-merging.
        try:
            pixel_size_units = abs(transform[0])
            is_geo_crs = getattr(raster_crs, "is_geographic", False)
            pixel_size_m = pixel_size_units * 111320.0 if is_geo_crs else pixel_size_units
        except Exception:
            pixel_size_m = 1.0
        gsd_close_iters = max(6, min(int(preset["gsdCloseCap"]), int(round(8.0 / max(pixel_size_m, 0.3)))))
        merge_distance_m = max(5.0, min(10.0, pixel_size_m * 10.0))
        print(f"[Vision] parcel_area_sqft={round(parcel_area_sqft, 1)} detectionPreset={detection_preset} constrained_boundary_mode={constrained_boundary_mode} is_large_parcel={is_large_parcel} min_component_area_sqft={round(min_component_area_sqft, 1)} max_components={effective_max_components} max_component_ratio={effective_max_component_ratio} max_detected_ratio={max_detected_ratio} pixel_size_m={round(pixel_size_m, 3)} gsd_close_iters={gsd_close_iters} merge_distance_m={round(merge_distance_m, 1)}", flush=True)

        # Build morphology barrier mask: frozen during every binary_close so that
        # trailers, gravel, metal roofs, and sheds cannot act as bridges between
        # separate lawn components.  Computed once; reused across the threshold sweep.
        # Returns (morphology_barrier_mask, hard_exclusion_mask, details).
        # For medium_residential+constrained the two masks differ; otherwise identical.
        morphology_barrier_mask, hard_exclusion_mask, morphology_barrier_details = build_morphology_barrier_mask(
            data,
            band_lookup,
            red_band=args.red_band,
            green_band=args.green_band,
            blue_band=args.blue_band,
            nir_band=nir_band,
            valid_pixels=valid_pixels,
            analysis_context=analysis_context,
            hardscape_subtract_mask=hardscape_subtract_mask,
            parcel_area_sqft=parcel_area_sqft,
            constrained_boundary_mode=constrained_boundary_mode,
            detection_preset=detection_preset,
        )
        morphology_barrier_mask = np.asarray(morphology_barrier_mask, dtype=bool)
        hard_exclusion_mask = np.asarray(hard_exclusion_mask, dtype=bool)
        _barrier_px   = morphology_barrier_details["morphologyBarrierPixels"]
        _hs_px        = morphology_barrier_details["hardscapeBarrierPixels"]
        _added_px     = morphology_barrier_details["addedBarrierPixels"]
        _added_ratio  = morphology_barrier_details["addedBarrierRatio"]
        _gravel_px    = morphology_barrier_details["gravelExcludedPixels"]
        _obj_px       = morphology_barrier_details["largeObjectExcludedPixels"]
        _too_broad    = morphology_barrier_details["barrierRejectedAsTooBroad"]
        _capped       = morphology_barrier_details["barrierCapped"]
        _hard_excl_px = morphology_barrier_details.get("hardExclusionPixels", _barrier_px)
        _morph_only_px = morphology_barrier_details.get("morphologyOnlyBarrierPixels", 0)
        _med_constrained_mode = morphology_barrier_details.get("mediumConstrainedBarrierMode", False)
        print(
            f"[Vision] morphology_barrier: frozen_px={_barrier_px} of {valid_pixel_count}"
            f" hardscapeBarrierPixels={_hs_px}"
            f" addedBarrierPixels={_added_px} addedBarrierRatio={_added_ratio}"
            f" barrierCapped={_capped} barrierRejectedAsTooBroad={_too_broad}"
            f" gravel_px={_gravel_px} large_obj_px={_obj_px}"
            f" constrained={constrained_boundary_mode}"
            f" medConstrainedBarrierMode={_med_constrained_mode}"
            f" hardExcl_px={_hard_excl_px} morphOnlyBarrier_px={_morph_only_px}",
            flush=True,
        )
        # DEBUG: dtype/shape/sample audit before boolean operations
        _dbg_sample = morphology_barrier_mask[:10, :10] if morphology_barrier_mask.size >= 100 else morphology_barrier_mask
        print(f"[Vision] DEBUG morphology_barrier_mask dtype={morphology_barrier_mask.dtype} shape={morphology_barrier_mask.shape} unique_sample={np.unique(_dbg_sample).tolist()}", flush=True)
        _dbg_sample = hard_exclusion_mask[:10, :10] if hard_exclusion_mask.size >= 100 else hard_exclusion_mask
        print(f"[Vision] DEBUG hard_exclusion_mask dtype={hard_exclusion_mask.dtype} shape={hard_exclusion_mask.shape} unique_sample={np.unique(_dbg_sample).tolist()}", flush=True)

        # For medium_residential + constrained: compute strong-green mask used to
        # rescue barrier-zone pixels that have clear vegetation evidence back into
        # the final mowable output after morphology is complete.
        _med_constrained = (detection_preset == "medium_residential" and constrained_boundary_mode)
        if _med_constrained:
            _sg_red = np.asarray(data[band_lookup[args.red_band]].filled(0), dtype=np.float32)
            _sg_grn = np.asarray(data[band_lookup[args.green_band]].filled(0), dtype=np.float32)
            _sg_blu = np.asarray(data[band_lookup[args.blue_band]].filled(0), dtype=np.float32)
            _sg_eg  = 2.0 * _sg_grn - _sg_red - _sg_blu
            _sg_sum = _sg_red + _sg_grn + _sg_blu
            _sg_gr  = np.zeros_like(_sg_grn, dtype=np.float32)
            np.divide(_sg_grn, _sg_sum, out=_sg_gr, where=_sg_sum > 1e-6)
            # Grass-positive: lower thresholds so mixed grass/dirt/shadow pixels
            # qualify for rescue — matches strong_green_evidence in barrier mask.
            _strong_green = (_sg_eg > 2.0) | (_sg_gr > 0.34)
            if nir_band is not None and nir_band in band_lookup:
                _sg_nir = np.asarray(data[band_lookup[nir_band]].filled(0), dtype=np.float32)
                _sg_nd_d = _sg_nir + _sg_red
                _sg_ndvi = np.zeros_like(_sg_red, dtype=np.float32)
                np.divide(_sg_nir - _sg_red, _sg_nd_d, out=_sg_ndvi, where=np.abs(_sg_nd_d) > 1e-6)
                _strong_green = _strong_green | (_sg_ndvi > 0.10)
            _strong_green = _strong_green & valid_pixels
        else:
            _strong_green = np.zeros(valid_pixels.shape, dtype=bool)
        _strong_green = np.asarray(_strong_green, dtype=bool)
        _dbg_sg = _strong_green[:10, :10] if _strong_green.size >= 100 else _strong_green
        print(f"[Vision] DEBUG _strong_green dtype={_strong_green.dtype} shape={_strong_green.shape} unique_sample={np.unique(_dbg_sg).tolist()}", flush=True)

        # Trailer/RV/metal component exclusion — medium_residential constrained only.
        # grassPositiveMode: detection runs for diagnostics but result is NOT applied
        # to hard_exclusion_mask.  Under-detecting grass is worse than over-detecting
        # for launch; users can manually cut out trailers/gravel via Edit Area.
        _trailer_excl_px = 0
        _trailer_excl_area = 0.0
        _trailer_comp_count = 0
        _trailer_excl_applied = False
        _trailer_diagnostic_only = False
        if _med_constrained:
            _trailer_mask_exc, _trailer_diag = detect_trailer_components_for_exclusion(
                data, band_lookup,
                red_band=args.red_band,
                green_band=args.green_band,
                blue_band=args.blue_band,
                nir_band=nir_band,
                valid_pixels=valid_pixels,
                strong_green_mask=_strong_green,
                hard_exclusion_mask=hard_exclusion_mask,
                parcel_area_sqft=parcel_area_sqft,
                transform=transform,
                raster_crs=raster_crs,
                parcel_raster=parcel_raster,
            )
            _trailer_excl_px = _trailer_diag["trailerExcludedPixels"]
            _trailer_excl_area = _trailer_diag["trailerExcludedAreaSqft"]
            _trailer_comp_count = _trailer_diag["trailerComponentCount"]
            _trailer_excl_applied = _trailer_diag["trailerExclusionApplied"]
            if _trailer_excl_applied:
                # Diagnostic-only: do not subtract from hard_exclusion_mask.
                _trailer_diagnostic_only = True
                print(
                    f"[Vision] trailerExclusion (diagnostic-only, grassPositiveMode):"
                    f" components={_trailer_comp_count}"
                    f" detected_px={_trailer_excl_px} detected_area_sqft={_trailer_excl_area}"
                    f" — not applied to hard_exclusion_mask",
                    flush=True,
                )
            else:
                print("[Vision] trailerExclusion: no trailer components detected", flush=True)

        # Accumulated rescue diagnostics (updated in each threshold iteration;
        # final values reflect the last-evaluated candidate — good enough for logging).
        _rescued_px_last = 0
        _grass_before_he_last = 0
        _grass_after_he_last = 0
        _green_narrow_rescued_px_last = 0
        _green_narrow_count_last = 0

        threshold_summary = {
            "detectionMode": thresholds_used["detectionMode"],
            "maxDetectedRatio": thresholds_used["maxDetectedRatio"],
            "hardDetectedRatio": thresholds_used["hardDetectedRatio"],
            "strongExclusionRatio": thresholds_used["strongExclusionRatio"],
            "minComponentAreaSqft": thresholds_used["minComponentAreaSqft"],
            "softFallback": thresholds_used["softFallback"],
        }
        print(f"[Vision] preset threshold summary={json.dumps(threshold_summary, default=str, separators=(',', ':'))}", flush=True)

        if detection_preset == "small_residential":
            remainder_mask = valid_pixels & ~hardscape_subtract_mask
            hardscape_evidence_exists = _hs_total_px > max(0, min(8, valid_pixel_count))
            remainder_diagnostics = {
                "ndviThreshold": None,
                "ndviUpperLimit": None,
                "rgbFilterUsed": False,
                "visibleThreshold": None,
                "excessGreenMin": None,
                "saturationMin": None,
                "brightnessMin": None,
                "dynamicBrightnessMin": None,
                "brightnessRange": finite_range(analysis_context["brightness"][valid_pixels]),
                "textureScore": 0.0,
                "textureThreshold": round(float(analysis_context.get("textureThreshold") or 0.0), 3),
                "canopyRejectedPixels": 0,
                "canopyHintPixels": 0,
                "townLawnExtensionPixels": 0,
                "hardscapePixels": _hs_total_px,
                "hardscapeSeedPixels": _hs_total_px,
                "waterOrPoolPixels": 0,
                "vegetationCandidatePixels": 0,
                "validPixels": valid_pixel_count,
                "hardscapeRules": hardscape_mask_details,
                "detectionMode": preset["detectionMode"],
                "detectionPreset": detection_preset,
                "vegetationFilterApplied": False,
                "retryReason": hardscape_retry_reason,
                "softMask": False,
            }
            remainder_candidate = evaluate_mask_candidate(
                remainder_mask,
                remainder_diagnostics,
                transform=transform,
                raster_crs=raster_crs,
                parcel_raster=parcel_raster,
                parcel_area_sqft=parcel_area_sqft,
                context=analysis_context,
                min_component_area_sqft=min_component_area_sqft,
                max_component_ratio=0.995,
                max_detected_ratio=0.995,
                hard_detected_ratio=0.995,
                strong_exclusion_ratio=float(preset["strongExclusionRatio"]),
                mask_pixel_count_before_filtering=int(np.count_nonzero(remainder_mask)),
                mask_before_filter=remainder_mask,
                fallback_mode=False,
                max_components=effective_max_components,
                merge_distance_m=merge_distance_m,
                min_hole_sqft=120.0,
            )
            remainder_ratio = float(remainder_candidate["detectedRatio"])
            if (
                remainder_candidate["rejectReason"] == "parcel-sized geometry"
                and hardscape_evidence_exists
                and remainder_ratio <= 0.995
            ):
                remainder_candidate["rejectReason"] = ""
            if remainder_ratio > 0.80 and not hardscape_evidence_exists:
                remainder_candidate["rejectReason"] = "near-whole-parcel remainder without hardscape evidence"
            if hardscape_evidence_exists and not remainder_candidate["rejectReason"]:
                remainder_candidate["confidence"] = max(float(remainder_candidate["confidence"]), 0.48)
            remainder_candidate["score"] = score_candidate(remainder_candidate) if not remainder_candidate["rejectReason"] else round(score_candidate(remainder_candidate) - 0.5, 4)
            remainder_candidate["requestedNdviThreshold"] = None
            remainder_candidate["hardscapePixelsBeforeSubtract"] = _hs_total_px
            remainder_candidate["hardscapePixelsSubtracted"] = _hs_total_px
            remainder_candidate["finalPixelsAfterHardscapeSubtract"] = int(np.count_nonzero(remainder_mask))
            remainder_candidate["hardscapeExcludedRatio"] = round(float(hardscape_excluded_ratio), 4)
            remainder_candidate["remainderAreaSqft"] = remainder_candidate["detectedAreaSqft"]
            remainder_candidate["vegetationPixels"] = 0
            remainder_candidate["rawVegetationPixels"] = 0
            remainder_candidate["vegetationCandidatePixels"] = 0
            remainder_candidate["vegetationCandidateAreaSqft"] = 0
            remainder_candidate["vegetationFilterApplied"] = False
            remainder_candidate["retryReason"] = hardscape_retry_reason
            candidate_results.append(remainder_candidate)
        else:
            for ndvi_threshold in ndvi_values:
                for visible_threshold in visible_values:
                    for brightness_min in brightness_values:
                        vegetation, diagnostics = vegetation_from_bands(
                            data,
                            band_lookup,
                            red_band=args.red_band,
                            green_band=args.green_band,
                            blue_band=args.blue_band,
                            nir_band=nir_band,
                            ndvi_threshold=ndvi_threshold,
                            visible_threshold=visible_threshold,
                            saturation_min=args.saturation_min,
                            brightness_min=brightness_min,
                            detection_preset=detection_preset,
                        )

                        diagnostics["detectionMode"] = preset["detectionMode"]
                        diagnostics["vegetationFilterApplied"] = True
                        diagnostics["retryReason"] = hardscape_retry_reason
                        # Apply barrier BEFORE morphology so excluded zones are frozen
                        # and binary_close cannot bridge lawn across them.
                        # medium_residential+constrained: use hard_exclusion_mask for
                        # initial subtraction (tight gate); morphology_barrier_mask
                        # (broader) is still used during close to prevent bridging.
                        _initial_excl = hard_exclusion_mask if _med_constrained else morphology_barrier_mask
                        mowable = vegetation & ~_initial_excl
                        if sam_mask is not None:
                            mowable = (vegetation & sam_mask if args.combine == "intersect" else vegetation | sam_mask) & ~_initial_excl

                        pre_filter_mowable = mowable.copy()
                        raw_mask_pixel_count = int(np.count_nonzero(mowable))
                        if opening_iterations:
                            mowable = binary_open(mowable, opening_iterations) & valid_pixels & ~morphology_barrier_mask
                        # Barrier re-applied after close: removes any pixels that grew
                        # into the barrier zone during the dilate phase.
                        mowable = binary_close(mowable, gsd_close_iters) & valid_pixels & ~morphology_barrier_mask

                        if args.sieve_size > 0:
                            mowable = sieve(mowable.astype(np.uint8), size=args.sieve_size).astype(bool)
                            mowable = binary_close(mowable, max(2, gsd_close_iters // 2)) & valid_pixels & ~morphology_barrier_mask
                            background = (~mowable) & valid_pixels
                            cleaned_background = sieve(
                                background.astype(np.uint8),
                                size=max(int(args.sieve_size) * 6, 256),
                            ).astype(bool)
                            mowable = (~cleaned_background) & valid_pixels & ~morphology_barrier_mask

                        # medium_residential+constrained: rescue green pixels that were
                        # in the morphology-only barrier zone (broader minus tight gate).
                        # They were excluded during close to prevent bridging but should
                        # appear in the final output if they have strong vegetation evidence.
                        if _med_constrained:
                            _morph_only = morphology_barrier_mask & ~hard_exclusion_mask & valid_pixels
                            _rescued = _strong_green & _morph_only
                            _rescued_px_last = int(np.count_nonzero(_rescued))
                            _grass_before_he_last = int(np.count_nonzero(mowable))
                            mowable = (mowable | _rescued) & ~hard_exclusion_mask & valid_pixels
                            _grass_after_he_last = int(np.count_nonzero(mowable))
                            _apx = parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0
                            print(
                                f"[Vision] medConstrainedBarrier (primary):"
                                f" hardExcl_px={_hard_excl_px}"
                                f" morphOnlyBarrier_px={_morph_only_px}"
                                f" rescued_px={_rescued_px_last}"
                                f" grassBefore={_grass_before_he_last} ({round(_grass_before_he_last * _apx, 1)} sqft)"
                                f" grassAfter={_grass_after_he_last} ({round(_grass_after_he_last * _apx, 1)} sqft)",
                                flush=True,
                            )

                        # Green narrow/tip component rescue — medium_residential constrained only.
                        # Finds strongly-green pixels eroded or sieved away during morphology
                        # (they are in _strong_green but absent from mowable) and adds them back
                        # as small components before final evaluation.  Keeps them inside the
                        # selected boundary, away from hard-excluded zones.
                        _green_narrow_rescued_px_iter = 0
                        _green_narrow_count_iter = 0
                        if _med_constrained:
                            _narrow_pool = (
                                _strong_green & ~hard_exclusion_mask & valid_pixels & ~mowable
                            )
                            if np.any(_narrow_pool):
                                _narrow_raw_geoms = vectorize_mask(
                                    _narrow_pool,
                                    transform=transform,
                                    crs=raster_crs,
                                    parcel_geom=parcel_raster,
                                    min_area_sqft=15.0,
                                )
                                _narrow_to_add: List[BaseGeometry] = []
                                for _ng in _narrow_raw_geoms:
                                    _ng_area = area_sqft(_ng, raster_crs)
                                    if _ng_area < 15.0 or _ng_area > min_component_area_sqft * 4.0:
                                        continue
                                    _ng_m = rasterize_geometries(
                                        [_ng], out_shape=mowable.shape, transform=transform
                                    )
                                    _ng_px = int(np.count_nonzero(_ng_m & valid_pixels))
                                    if _ng_px < 2:
                                        continue
                                    _ng_gf = float(np.count_nonzero(_ng_m & _strong_green)) / max(_ng_px, 1)
                                    if _ng_gf >= 0.40:
                                        _narrow_to_add.append(_ng)
                                if _narrow_to_add:
                                    _nr_mask = rasterize_geometries(
                                        _narrow_to_add, out_shape=mowable.shape, transform=transform
                                    )
                                    _nr_mask = np.asarray(
                                        _nr_mask & ~hard_exclusion_mask & valid_pixels, dtype=bool
                                    )
                                    _green_narrow_rescued_px_iter = int(np.count_nonzero(_nr_mask))
                                    _green_narrow_count_iter = len(_narrow_to_add)
                                    mowable = (mowable | _nr_mask) & ~hard_exclusion_mask & valid_pixels
                            _green_narrow_rescued_px_last = _green_narrow_rescued_px_iter
                            _green_narrow_count_last = _green_narrow_count_iter
                            _apx = parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0
                            print(
                                f"[Vision] greenNarrowRescue (primary):"
                                f" rescued_geoms={_green_narrow_count_last}"
                                f" rescued_px={_green_narrow_rescued_px_last}"
                                f" ({round(_green_narrow_rescued_px_last * _apx, 1)} sqft)",
                                flush=True,
                            )

                        _hs_px_before = int(np.count_nonzero(mowable & hardscape_subtract_mask))
                        mowable = mowable & ~hardscape_subtract_mask & valid_pixels
                        _mc_min_area = (
                            max(40.0, min_component_area_sqft * 0.40)
                            if _med_constrained else min_component_area_sqft
                        )
                        candidate = evaluate_mask_candidate(
                            mowable,
                            diagnostics,
                            transform=transform,
                            raster_crs=raster_crs,
                            parcel_raster=parcel_raster,
                            parcel_area_sqft=parcel_area_sqft,
                            context=analysis_context,
                            min_component_area_sqft=_mc_min_area,
                            max_component_ratio=effective_max_component_ratio,
                            max_detected_ratio=max_detected_ratio,
                            hard_detected_ratio=hard_detected_ratio,
                            strong_exclusion_ratio=float(preset["strongExclusionRatio"]),
                            mask_pixel_count_before_filtering=raw_mask_pixel_count,
                            mask_before_filter=pre_filter_mowable,
                            fallback_mode=False,
                            max_components=effective_max_components,
                            merge_distance_m=merge_distance_m,
                            min_hole_sqft=_min_hole_sqft,
                        )
                        candidate["requestedNdviThreshold"] = round(float(ndvi_threshold), 3)
                        candidate["hardscapePixelsBeforeSubtract"] = _hs_px_before
                        candidate["hardscapePixelsSubtracted"] = _hs_px_before
                        candidate["finalPixelsAfterHardscapeSubtract"] = int(np.count_nonzero(mowable))
                        candidate["hardscapeExcludedRatio"] = round(float(hardscape_excluded_ratio), 4)
                        candidate["remainderAreaSqft"] = candidate["detectedAreaSqft"]
                        candidate["vegetationFilterApplied"] = True
                        candidate["retryReason"] = hardscape_retry_reason
                        if _med_constrained:
                            _apx_c = parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0
                            candidate["trailerExcludedPixels"] = _trailer_excl_px
                            candidate["trailerExcludedAreaSqft"] = _trailer_excl_area
                            candidate["trailerComponentCount"] = _trailer_comp_count
                            candidate["trailerExclusionApplied"] = _trailer_excl_applied
                            candidate["greenNarrowComponentsRescued"] = _green_narrow_count_iter
                            candidate["greenNarrowRescueAreaSqft"] = round(_green_narrow_rescued_px_iter * _apx_c, 1)
                            candidate["edgeGrassRescueApplied"] = _green_narrow_rescued_px_iter > 0
                            candidate["grassPositiveMode"] = True
                            candidate["objectExclusionConservative"] = True
                            candidate["objectDetectionDiagnosticOnly"] = _trailer_diagnostic_only
                        candidate_results.append(candidate)

        preferred = [
            candidate for candidate in candidate_results
            if not candidate["rejectReason"]
            and 0.05 <= float(candidate["detectedRatio"]) <= min(0.55, max_detected_ratio)
            and float(candidate["confidence"]) >= 0.35
        ]
        allowed_high = [
            candidate for candidate in candidate_results
            if not candidate["rejectReason"]
            and 0.55 < float(candidate["detectedRatio"]) <= max_detected_ratio
            and float(candidate["confidence"]) >= 0.35
        ]
        allowed_low = [
            candidate for candidate in candidate_results
            if not candidate["rejectReason"]
            and float(candidate["detectedRatio"]) > 0
            and float(candidate["confidence"]) >= 0.35
        ]
        pool = preferred or allowed_high or allowed_low or candidate_results
        selected = max(pool, key=lambda candidate: float(candidate["score"])) if pool else None
        strict_selected = selected
        strict_detected_ratio = float(strict_selected["detectedRatio"]) if strict_selected else 0.0

        if bool(preset["softFallback"]) and (selected is None or selected["rejectReason"] or strict_detected_ratio < SOFT_FALLBACK_RATIO):
            soft_vegetation, soft_diagnostics = vegetation_from_bands(
                data,
                band_lookup,
                red_band=args.red_band,
                green_band=args.green_band,
                blue_band=args.blue_band,
                nir_band=nir_band,
                ndvi_threshold=args.ndvi_threshold,
                visible_threshold=args.visible_threshold,
                saturation_min=args.saturation_min,
                brightness_min=args.brightness_min,
                soft=True,
                detection_preset=detection_preset,
            )
            soft_diagnostics["detectionMode"] = preset["detectionMode"]
            soft_diagnostics["vegetationFilterApplied"] = True
            soft_diagnostics["retryReason"] = hardscape_retry_reason
            # Barrier frozen during soft-fallback morphology too.
            # medium_residential+constrained: same split-barrier approach as primary path.
            _sf_initial_excl = hard_exclusion_mask if _med_constrained else morphology_barrier_mask
            soft_mowable = soft_vegetation & ~analysis_context["hardSurface"] & ~_sf_initial_excl
            if sam_mask is not None:
                soft_mowable = (soft_mowable & sam_mask if args.combine == "intersect" else soft_mowable | sam_mask) & ~_sf_initial_excl
            soft_pre_filter_mowable = soft_mowable.copy()
            soft_raw_mask_pixel_count = int(np.count_nonzero(soft_mowable))
            soft_close_iters = max(gsd_close_iters, gsd_close_iters + 2)
            soft_mowable = binary_close(soft_mowable, soft_close_iters) & valid_pixels & ~morphology_barrier_mask
            if args.sieve_size > 0:
                soft_mowable = sieve(
                    soft_mowable.astype(np.uint8),
                    size=max(16, int(args.sieve_size) // 2),
                ).astype(bool)
                soft_mowable = binary_close(soft_mowable, max(3, gsd_close_iters // 2)) & valid_pixels & ~morphology_barrier_mask

            # Rescue green pixels from morphology-only barrier zone (soft-fallback).
            if _med_constrained:
                _sf_morph_only = morphology_barrier_mask & ~hard_exclusion_mask & valid_pixels
                _sf_rescued = _strong_green & _sf_morph_only
                _rescued_px_last = int(np.count_nonzero(_sf_rescued))
                _grass_before_he_last = int(np.count_nonzero(soft_mowable))
                soft_mowable = (soft_mowable | _sf_rescued) & ~hard_exclusion_mask & valid_pixels
                _grass_after_he_last = int(np.count_nonzero(soft_mowable))
                _apx = parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0
                print(
                    f"[Vision] medConstrainedBarrier (soft-fallback):"
                    f" rescued_px={_rescued_px_last}"
                    f" grassBefore={_grass_before_he_last} ({round(_grass_before_he_last * _apx, 1)} sqft)"
                    f" grassAfter={_grass_after_he_last} ({round(_grass_after_he_last * _apx, 1)} sqft)",
                    flush=True,
                )

            # Green narrow/tip rescue (soft-fallback path)
            _sf_green_narrow_rescued_px = 0
            _sf_green_narrow_count = 0
            if _med_constrained:
                _sf_narrow_pool = (
                    _strong_green & ~hard_exclusion_mask & valid_pixels & ~soft_mowable
                )
                if np.any(_sf_narrow_pool):
                    _sf_narrow_geoms = vectorize_mask(
                        _sf_narrow_pool,
                        transform=transform,
                        crs=raster_crs,
                        parcel_geom=parcel_raster,
                        min_area_sqft=15.0,
                    )
                    _sf_narrow_to_add: List[BaseGeometry] = []
                    for _sng in _sf_narrow_geoms:
                        _sng_area = area_sqft(_sng, raster_crs)
                        if _sng_area < 15.0 or _sng_area > min_component_area_sqft * 4.0:
                            continue
                        _sng_m = rasterize_geometries(
                            [_sng], out_shape=soft_mowable.shape, transform=transform
                        )
                        _sng_px = int(np.count_nonzero(_sng_m & valid_pixels))
                        if _sng_px < 2:
                            continue
                        _sng_gf = float(np.count_nonzero(_sng_m & _strong_green)) / max(_sng_px, 1)
                        if _sng_gf >= 0.40:
                            _sf_narrow_to_add.append(_sng)
                    if _sf_narrow_to_add:
                        _sf_nr_mask = rasterize_geometries(
                            _sf_narrow_to_add, out_shape=soft_mowable.shape, transform=transform
                        )
                        _sf_nr_mask = np.asarray(
                            _sf_nr_mask & ~hard_exclusion_mask & valid_pixels, dtype=bool
                        )
                        _sf_green_narrow_rescued_px = int(np.count_nonzero(_sf_nr_mask))
                        _sf_green_narrow_count = len(_sf_narrow_to_add)
                        soft_mowable = (soft_mowable | _sf_nr_mask) & ~hard_exclusion_mask & valid_pixels
                _green_narrow_rescued_px_last = _sf_green_narrow_rescued_px
                _green_narrow_count_last = _sf_green_narrow_count
                _apx = parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0
                print(
                    f"[Vision] greenNarrowRescue (soft-fallback):"
                    f" rescued_geoms={_sf_green_narrow_count}"
                    f" rescued_px={_sf_green_narrow_rescued_px}"
                    f" ({round(_sf_green_narrow_rescued_px * _apx, 1)} sqft)",
                    flush=True,
                )

            _hs_sf_before = int(np.count_nonzero(soft_mowable & hardscape_subtract_mask))
            soft_mowable = soft_mowable & ~hardscape_subtract_mask & valid_pixels
            _mc_min_area_sf = (
                max(40.0, min_component_area_sqft * 0.40)
                if _med_constrained else min_component_area_sqft
            )
            soft_candidate = evaluate_mask_candidate(
                soft_mowable,
                soft_diagnostics,
                transform=transform,
                raster_crs=raster_crs,
                parcel_raster=parcel_raster,
                parcel_area_sqft=parcel_area_sqft,
                context=analysis_context,
                min_component_area_sqft=_mc_min_area_sf,
                max_component_ratio=effective_max_component_ratio,
                max_detected_ratio=max_detected_ratio,
                hard_detected_ratio=hard_detected_ratio,
                strong_exclusion_ratio=float(preset["strongExclusionRatio"]),
                mask_pixel_count_before_filtering=soft_raw_mask_pixel_count,
                mask_before_filter=soft_pre_filter_mowable,
                fallback_mode=True,
                max_components=3,
                merge_distance_m=merge_distance_m,
                min_hole_sqft=_min_hole_sqft,
            )
            soft_candidate["requestedNdviThreshold"] = round(float(args.ndvi_threshold), 3)
            soft_candidate["hardscapePixelsBeforeSubtract"] = _hs_sf_before
            soft_candidate["hardscapePixelsSubtracted"] = _hs_sf_before
            soft_candidate["finalPixelsAfterHardscapeSubtract"] = int(np.count_nonzero(soft_mowable))
            if _med_constrained:
                _apx_csf = parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0
                soft_candidate["trailerExcludedPixels"] = _trailer_excl_px
                soft_candidate["trailerExcludedAreaSqft"] = _trailer_excl_area
                soft_candidate["trailerComponentCount"] = _trailer_comp_count
                soft_candidate["trailerExclusionApplied"] = _trailer_excl_applied
                soft_candidate["greenNarrowComponentsRescued"] = _sf_green_narrow_count
                soft_candidate["greenNarrowRescueAreaSqft"] = round(_sf_green_narrow_rescued_px * _apx_csf, 1)
                soft_candidate["edgeGrassRescueApplied"] = _sf_green_narrow_rescued_px > 0
                soft_candidate["grassPositiveMode"] = True
                soft_candidate["objectExclusionConservative"] = True
                soft_candidate["objectDetectionDiagnosticOnly"] = _trailer_diagnostic_only
            candidate_results.append(soft_candidate)
            if not soft_candidate["rejectReason"] and (
                selected is None
                or selected["rejectReason"]
                or strict_detected_ratio < SOFT_FALLBACK_RATIO
                or float(soft_candidate["score"]) > float(selected["score"])
            ):
                selected = soft_candidate
                fallback_soft_mask_used = True

        low_confidence_candidate_returned = False
        if selected and selected["rejectReason"] and bool(preset["lowConfidenceCandidate"]):
            candidate_pixel_count = int(selected.get("vegetationCandidatePixels") or selected.get("rawVegetationPixels") or 0)
            rough_candidate_geoms: List[BaseGeometry] = []
            if not selected.get("geoms") and candidate_pixel_count > 0:
                rough_candidate_mask = selected.get("maskBeforeFilter")
                if rough_candidate_mask is None or not isinstance(rough_candidate_mask, np.ndarray):
                    rough_candidate_mask = selected.get("mask")
                if isinstance(rough_candidate_mask, np.ndarray):
                    rough_candidate_mask = binary_close(rough_candidate_mask.astype(bool), 3) & valid_pixels & ~hardscape_subtract_mask
                    rough_candidate_geoms = vectorize_mask(
                        rough_candidate_mask,
                        transform=transform,
                        crs=raster_crs,
                        parcel_geom=parcel_raster,
                        min_area_sqft=max(50.0, min_component_area_sqft * 0.5),
                    )
                    rough_candidate_geoms.sort(key=lambda geom: area_sqft(geom, raster_crs), reverse=True)
                    rough_candidate_geoms = rough_candidate_geoms[:MAX_COMPONENTS_TO_KEEP]

            if (selected.get("geoms") or rough_candidate_geoms) and candidate_pixel_count > 0:
                geoms = selected.get("geoms") or rough_candidate_geoms
                low_confidence_candidate_returned = True
            else:
                geoms = []
            component_areas = [round(area_sqft(geom, raster_crs), 2) for geom in geoms] if rough_candidate_geoms else selected["componentAreas"]
            rejected_components = selected["rejectedComponents"]
            vegetation_pixels = int(np.count_nonzero(rasterize_geometries(geoms, out_shape=data.shape[1:], transform=transform))) if rough_candidate_geoms else int(selected["vegetationPixels"])
            mask_diagnostics = selected["diagnostics"]
            mowable = rasterize_geometries(geoms, out_shape=data.shape[1:], transform=transform) & valid_pixels if low_confidence_candidate_returned else np.zeros(data.shape[1:], dtype=bool)
        elif constrained_boundary_mode and selected and selected.get("rejectReason"):
            # Constrained-boundary safety net: accept the best available candidate as an
            # editable low-confidence result when hardscape exclusion evidence is present.
            # Primary path: the threshold relaxation above (0.97) already prevents rejection
            # for typical cases; this fires only for remaining edge cases (e.g. ratio >=0.97).
            _cand_ratio = float(selected.get("detectedRatio", 0))
            _has_excl = bool(selected.get("hasExclusionEvidence", False)) or bool(selected.get("hasStrongExclusionEvidence", False))
            _cand_px = int(selected.get("vegetationCandidatePixels") or selected.get("rawVegetationPixels") or 0)
            constrained_fallback_geoms: List[BaseGeometry] = selected.get("geoms") or []
            if not constrained_fallback_geoms and _has_excl and _cand_ratio > 0 and _cand_ratio < 0.995 and _cand_px > 0:
                _raw_mask = selected.get("maskBeforeFilter")
                if _raw_mask is None or not isinstance(_raw_mask, np.ndarray):
                    _raw_mask = selected.get("mask")
                if isinstance(_raw_mask, np.ndarray):
                    _raw_mask = binary_close(_raw_mask.astype(bool), 3) & valid_pixels & ~hardscape_subtract_mask
                    constrained_fallback_geoms = vectorize_mask(
                        _raw_mask,
                        transform=transform,
                        crs=raster_crs,
                        parcel_geom=parcel_raster,
                        min_area_sqft=max(50.0, min_component_area_sqft * 0.5),
                    )
                    constrained_fallback_geoms.sort(key=lambda geom: area_sqft(geom, raster_crs), reverse=True)
                    constrained_fallback_geoms = constrained_fallback_geoms[:MAX_COMPONENTS_TO_KEEP]
            if constrained_fallback_geoms and (_has_excl or _cand_ratio < 0.995):
                geoms = constrained_fallback_geoms
                low_confidence_candidate_returned = True
                selected["finalAcceptReason"] = "constrained boundary accepted with hardscape exclusion evidence"
                print(f"[Vision] constrained fallback: rejectReason={selected.get('rejectReason')} ratio={_cand_ratio} hasExclEvidence={_has_excl} geomCount={len(geoms)}", flush=True)
            else:
                geoms = []
                print(f"[Vision] constrained fallback skipped: rejectReason={selected.get('rejectReason')} ratio={_cand_ratio} hasExclEvidence={_has_excl} cand_px={_cand_px}", flush=True)
            component_areas = [round(area_sqft(geom, raster_crs), 2) for geom in geoms] if constrained_fallback_geoms else selected["componentAreas"]
            rejected_components = selected["rejectedComponents"]
            vegetation_pixels = int(np.count_nonzero(rasterize_geometries(geoms, out_shape=data.shape[1:], transform=transform))) if constrained_fallback_geoms else int(selected.get("vegetationPixels", 0))
            mask_diagnostics = selected["diagnostics"]
            mowable = rasterize_geometries(geoms, out_shape=data.shape[1:], transform=transform) & valid_pixels if low_confidence_candidate_returned else np.zeros(data.shape[1:], dtype=bool)
        elif selected and not selected["rejectReason"]:
            geoms = selected["geoms"]
            component_areas = selected["componentAreas"]
            rejected_components = selected["rejectedComponents"]
            vegetation_pixels = int(selected["vegetationPixels"])
            mask_diagnostics = selected["diagnostics"]
            mowable = selected["mask"]
        else:
            geoms = []
            component_areas = []
            rejected_components = []
            vegetation_pixels = 0
            mask_diagnostics = {
                "ndviThreshold": None,
                "ndviUpperLimit": None,
                "rgbFilterUsed": True,
                "visibleThreshold": None,
                "excessGreenMin": None,
                "saturationMin": None,
                "brightnessMin": None,
                "dynamicBrightnessMin": None,
                "brightnessRange": [0.0, 0.0],
                "textureScore": 0.0,
                "textureThreshold": None,
                "canopyRejectedPixels": 0,
                "canopyHintPixels": 0,
                "townLawnExtensionPixels": 0,
                "hardscapePixels": 0,
                "hardscapeSeedPixels": 0,
                "waterOrPoolPixels": 0,
                "vegetationCandidatePixels": 0,
                "validPixels": int(np.count_nonzero(valid_pixels)),
                "hardscapeRules": {},
                "detectionMode": preset["detectionMode"],
                "vegetationFilterApplied": detection_preset != "small_residential",
                "retryReason": hardscape_retry_reason,
                "softMask": False,
            }
            mowable = np.zeros(data.shape[1:], dtype=bool)

        fallback_rejected_as_full_parcel = False
        if geoms and strict_detected_ratio <= 0.01:
            _final_area = sum(area_sqft(g, raster_crs) for g in geoms)
            _final_ratio = _final_area / parcel_area_sqft if parcel_area_sqft > 0 else 0.0
            _hardscape_px = int(mask_diagnostics.get("hardscapePixels") or 0)
            _valid_px = int(mask_diagnostics.get("validPixels") or 1)
            _has_excl = bool(selected.get("hasExclusionEvidence", False)) if selected else False
            print(f"[Vision] fallback guard: strict_ratio={strict_detected_ratio} final_ratio={round(_final_ratio, 4)} hardscape_px={_hardscape_px} has_excl={_has_excl}", flush=True)
            if _final_ratio > 0.85 or (not _has_excl and _final_ratio > 0.70 and _hardscape_px < max(8, _valid_px * 0.015)):
                print(f"[Vision] fallback mostly failed: keeping editable selection but marking beta_low; would select {round(_final_ratio * 100, 1)}% of parcel", flush=True)
                low_confidence_candidate_returned = True
                fallback_rejected_as_full_parcel = False
                confidence = "beta_low"
                reject_reason = "AI Detect mostly failed; selected most of parcel for manual review"

        if detection_preset == "small_residential":
            mode = "hardscape_exclusion_then_remainder"
            mask_diagnostics["detectionPreset"] = "small_residential"
            mask_diagnostics["detectionMode"] = mode
            mask_diagnostics["vegetationFilterApplied"] = False
            mask_diagnostics["retryReason"] = mask_diagnostics.get("retryReason", hardscape_retry_reason)
            if selected:
                selected["detectionPreset"] = "small_residential"
                selected["detectionMode"] = mode
                selected["vegetationFilterApplied"] = False
                selected["retryReason"] = selected.get("retryReason", hardscape_retry_reason)

        if args.mask_output:
            write_mask(Path(args.mask_output), mowable, transform=transform, crs=raster_crs)

        properties = {
            "source": "vision_service_geospatial",
            "mode": mode,
            "imageryMode": imagery_mode,
            "detection_mode": mask_diagnostics.get("detectionMode", mode),
            "detectionPreset": detection_preset,
            "ndviThreshold": mask_diagnostics["ndviThreshold"],
            "townLawnNdviThreshold": mask_diagnostics.get("townLawnNdviThreshold"),
            "ndviUpperLimit": mask_diagnostics["ndviUpperLimit"],
            "rgbFilterUsed": mask_diagnostics["rgbFilterUsed"],
            "visibleThreshold": mask_diagnostics["visibleThreshold"],
            "excessGreenMin": mask_diagnostics["excessGreenMin"],
            "saturationMin": mask_diagnostics["saturationMin"],
            "brightnessMin": mask_diagnostics["brightnessMin"],
            "dynamicBrightnessMin": mask_diagnostics["dynamicBrightnessMin"],
            "textureScore": mask_diagnostics["textureScore"],
            "vegetationFilterApplied": mask_diagnostics.get("vegetationFilterApplied", detection_preset != "small_residential"),
        }
        write_geojson(geoms, source_crs=raster_crs, output_path=Path(args.output), properties=properties)
        if debug_dir:
            raw_naip_path = debug_dir / "raw_naip.tif"
            if Path(args.imagery).resolve() != raw_naip_path.resolve():
                shutil.copyfile(args.imagery, raw_naip_path)
            if Path(args.output).resolve() != (debug_dir / "polygon_output.geojson").resolve():
                shutil.copyfile(args.output, debug_dir / "polygon_output.geojson")
            debug_artifacts = save_debug_artifacts(
                debug_dir,
                data=data,
                band_lookup=band_lookup,
                red_band=args.red_band,
                green_band=args.green_band,
                blue_band=args.blue_band,
                nir_band=nir_band,
                transform=transform,
                parcel_geom=parcel_raster,
                geoms=geoms,
                before_filter_mask=selected.get("maskBeforeFilter", mowable) if selected else mowable,
                selected_mask=mowable,
            )

    detected_area_sqft = sum(area_sqft(geom, raster_crs) for geom in geoms) if geoms else 0
    detected_ratio = detected_area_sqft / parcel_area_sqft if parcel_area_sqft > 0 else 0
    if detection_preset == "small_residential":
        mode = "hardscape_exclusion_then_remainder"
        mask_diagnostics["detectionMode"] = mode
        mask_diagnostics["vegetationFilterApplied"] = False
    selected_confidence = float(selected["confidence"]) if selected else 0.0
    if low_confidence_candidate_returned:
        selected_confidence = min(max(selected_confidence, 0.36), 0.38)
    confidence_label = beta_confidence_label(selected_confidence)
    soft_detected_ratio = float(soft_candidate["detectedRatio"]) if soft_candidate else 0.0
    candidate_scores = [
        {
            key: value
            for key, value in candidate.items()
            if key not in {"geoms", "mask", "maskBeforeFilter", "diagnostics"}
        }
        for candidate in sorted(candidate_results, key=lambda item: float(item["score"]), reverse=True)
    ]
    if _med_constrained:
        print(
            f"[Vision] medConstrained_summary:"
            f" trailerExcluded_sqft={_trailer_excl_area} trailerComponents={_trailer_comp_count}"
            f" greenNarrowRescued_sqft={round(_green_narrow_rescued_px_last * (parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0), 1)}"
            f" greenNarrowComponents={_green_narrow_count_last}"
            f" finalDetected_sqft={round(detected_area_sqft, 1)}"
            f" features={len(geoms)}"
            f" rejectReason={selected.get('rejectReason', '') if selected else 'no candidates'}",
            flush=True,
        )
    print(
        "[Vision] geospatial_summary "
        f"preset={detection_preset} mode={mask_diagnostics.get('detectionMode', mode)} "
        f"vegetationFilterApplied={mask_diagnostics.get('vegetationFilterApplied', detection_preset != 'small_residential')} "
        f"areaSqft={round(detected_area_sqft, 2)} ratio={round(detected_ratio, 4)} "
        f"hardscapeExcludedRatio={selected.get('hardscapeExcludedRatio', 0) if selected else 0} "
        f"features={len(geoms)} rejectReason={selected.get('rejectReason', '') if selected else 'no candidates'}",
        flush=True,
    )
    return {
        "features": len(geoms),
        "detectionPreset": detection_preset,
        "thresholds": thresholds_used,
        "thresholdsUsed": thresholds_used,
        "parcelAreaSqft": round(parcel_area_sqft, 2),
        "areaSqft": round(detected_area_sqft, 2),
        "detectedAreaSqm": round(detected_area_sqft / SQFT_PER_SQM, 2),
        "detectedRatio": round(detected_ratio, 4),
        "confidence": confidence_label,
        "confidenceScore": round(selected_confidence, 3),
        "mode": mode,
        "detectionMode": mask_diagnostics.get("detectionMode", mode),
        "detection_mode": mask_diagnostics.get("detectionMode", mode),
        "imageryMode": imagery_mode,
        "rasterBands": raster_bands,
        "rasterBandCount": raster_bands,
        "rasterWidth": raster_width,
        "rasterHeight": raster_height,
        "rasterCrs": str(raster_crs),
        "rasterTransform": list(raster_transform),
        "bandStats": band_stats,
        "bandOrderAssumption": band_order_assumption,
        "ndviStats": ndvi_stats,
        "naipNirWarning": naip_nir_warning,
        "usedNir": bool(nir_band),
        "vegetationPixels": vegetation_pixels,
        "polygonCount": len(geoms),
        "ndviThreshold": mask_diagnostics["ndviThreshold"],
        "townLawnNdviThreshold": mask_diagnostics.get("townLawnNdviThreshold"),
        "ndviUpperLimit": mask_diagnostics["ndviUpperLimit"],
        "rgbFilterUsed": mask_diagnostics["rgbFilterUsed"],
        "visibleThreshold": mask_diagnostics["visibleThreshold"],
        "excessGreenMin": mask_diagnostics["excessGreenMin"],
        "saturationMin": mask_diagnostics["saturationMin"],
        "brightnessMin": mask_diagnostics["brightnessMin"],
        "dynamicBrightnessMin": mask_diagnostics["dynamicBrightnessMin"],
        "brightnessRange": mask_diagnostics["brightnessRange"],
        "textureScore": mask_diagnostics["textureScore"],
        "textureThreshold": mask_diagnostics["textureThreshold"],
        "canopyRejectedPixels": mask_diagnostics["canopyRejectedPixels"],
        "canopyHintPixels": mask_diagnostics.get("canopyHintPixels", 0),
        "townLawnExtensionPixels": mask_diagnostics.get("townLawnExtensionPixels", 0),
        "hardscapePixels": mask_diagnostics.get("hardscapePixels", 0),
        "hardscapeSeedPixels": mask_diagnostics.get("hardscapeSeedPixels", 0),
        "waterOrPoolPixels": mask_diagnostics.get("waterOrPoolPixels", 0),
        "vegetationCandidatePixels": mask_diagnostics.get("vegetationCandidatePixels", 0),
        "validPixels": mask_diagnostics.get("validPixels", 0),
        "hardscapeExcludedAreaSqft": selected.get("hardscapeExcludedAreaSqft", 0) if selected else 0,
        "hardscapeExclusionRatio": selected.get("hardscapeExclusionRatio", 0) if selected else 0,
        "hardscapeExcludedRatio": selected.get("hardscapeExcludedRatio", selected.get("hardscapeExclusionRatio", 0)) if selected else 0,
        "remainderAreaSqft": selected.get("remainderAreaSqft", round(detected_area_sqft, 2)) if selected else 0,
        "vegetationFilterApplied": mask_diagnostics.get("vegetationFilterApplied", detection_preset != "small_residential"),
        "retryReason": mask_diagnostics.get("retryReason", hardscape_retry_reason),
        "vegetationCandidateAreaSqft": selected.get("vegetationCandidateAreaSqft", 0) if selected else 0,
        "finalSelectedAreaSqft": round(detected_area_sqft, 2),
        "hardscapeRules": mask_diagnostics.get("hardscapeRules", {}),
        "hardscapeSubtractMaskPixels": _hs_total_px,
        "hardscapePixelsBeforeSubtract": selected.get("hardscapePixelsBeforeSubtract", 0) if selected else 0,
        "hardscapePixelsSubtracted": selected.get("hardscapePixelsSubtracted", 0) if selected else 0,
        "finalPixelsAfterHardscapeSubtract": selected.get("finalPixelsAfterHardscapeSubtract", 0) if selected else 0,
        "lowConfidenceCandidateReturned": low_confidence_candidate_returned,
        "keptComponentCount": len(geoms),
        "componentAreas": component_areas,
        "rejectedComponents": rejected_components,
        "rejectedSmallComponents": selected.get("rejectedSmallComponents", 0) if selected else 0,
        "rejectedWoodsLikeComponents": selected.get("rejectedWoodsLikeComponents", 0) if selected else 0,
        "maskPixelCountBeforeFiltering": selected.get("maskPixelCountBeforeFiltering") if selected else None,
        "maskPixelCountAfterFiltering": selected.get("maskPixelCountAfterFiltering") if selected else None,
        "polygonCountBeforeFiltering": selected.get("polygonCountBeforeFiltering") if selected else None,
        "polygonCountAfterFiltering": selected.get("polygonCountAfterFiltering") if selected else None,
        "mergedComponentCount": selected.get("mergedComponentCount", 0) if selected else 0,
        "holeCountRemoved": selected.get("holeCountRemoved", 0) if selected else 0,
        "avgComponentSizeBefore": selected.get("avgComponentSizeBefore", 0.0) if selected else 0.0,
        "avgComponentSizeAfter": selected.get("avgComponentSizeAfter", 0.0) if selected else 0.0,
        "strictDetectedRatio": round(strict_detected_ratio, 4),
        "softDetectedRatio": round(soft_detected_ratio, 4),
        "selectedCandidateScores": selected.get("componentScores", []) if selected else [],
        "fallbackSoftMaskUsed": fallback_soft_mask_used,
        "debugRunDir": str(debug_dir) if debug_dir else "",
        "debugArtifacts": debug_artifacts,
        "candidateScores": candidate_scores,
        "selectedCandidate": {
            "score": selected.get("score") if selected else None,
            "rejectReason": selected.get("rejectReason") if selected else "no candidates",
            "parcelSimilarity": selected.get("parcelSimilarity") if selected else None,
            "hasExclusionEvidence": selected.get("hasExclusionEvidence") if selected else False,
            "hasStrongExclusionEvidence": selected.get("hasStrongExclusionEvidence") if selected else False,
            "largestComponentShare": selected.get("largestComponentShare") if selected else None,
            "averageCompactness": selected.get("averageCompactness") if selected else None,
            "averageComponentScore": selected.get("averageComponentScore") if selected else None,
            "fallbackMode": selected.get("fallbackMode") if selected else False,
        },
        "constrainedBoundaryMode": constrained_boundary_mode,
        "finalAcceptReason": selected.get("finalAcceptReason", "") if selected else "",
        "gravelExcludedPixels": morphology_barrier_details.get("gravelExcludedPixels", 0),
        "gravelExcludedAreaSqft": morphology_barrier_details.get("gravelExcludedAreaSqft", 0.0),
        "largeObjectExcludedPixels": morphology_barrier_details.get("largeObjectExcludedPixels", 0),
        "largeObjectExcludedAreaSqft": morphology_barrier_details.get("largeObjectExcludedAreaSqft", 0.0),
        "frozenExclusionPixels": morphology_barrier_details.get("frozenExclusionPixels", 0),
        "morphologyBarrierPixels": morphology_barrier_details.get("morphologyBarrierPixels", 0),
        "hardscapeBarrierPixels": morphology_barrier_details.get("hardscapeBarrierPixels", 0),
        "addedBarrierPixels": morphology_barrier_details.get("addedBarrierPixels", 0),
        "addedBarrierRatio": morphology_barrier_details.get("addedBarrierRatio", 0.0),
        "barrierCapped": morphology_barrier_details.get("barrierCapped", False),
        "barrierRejectedAsTooBroad": morphology_barrier_details.get("barrierRejectedAsTooBroad", False),
        "exclusionBarrierApplied": True,
        "hardExclusionPixels": morphology_barrier_details.get("hardExclusionPixels", 0),
        "hardExclusionAreaSqft": morphology_barrier_details.get("hardExclusionAreaSqft", 0.0),
        "morphologyOnlyBarrierPixels": morphology_barrier_details.get("morphologyOnlyBarrierPixels", 0),
        "morphologyOnlyBarrierAreaSqft": morphology_barrier_details.get("morphologyOnlyBarrierAreaSqft", 0.0),
        "mediumConstrainedBarrierMode": _med_constrained_mode,
        "greenPixelsRescuedFromBarrier": _rescued_px_last,
        "finalGrassPixelsBeforeHardExclusion": _grass_before_he_last,
        "finalGrassPixelsAfterHardExclusion": _grass_after_he_last,
        "exclusionRules": morphology_barrier_details.get("exclusionRules", {}),
        # structureExcludedPixels: total pixels frozen as non-mowable structures
        # (hardscape subtract mask + barrier-only additions).  Useful for confirming
        # that roofs/driveways are being detected before vegetation analysis.
        "structureExcludedPixels": _hs_total_px + morphology_barrier_details.get("addedBarrierPixels", 0),
        "structureExcludedAreaSqft": round(
            (_hs_total_px + morphology_barrier_details.get("addedBarrierPixels", 0))
            * (parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0),
            1,
        ),
        "grassPositiveMode": _med_constrained,
        "objectExclusionConservative": _med_constrained,
        "objectDetectionDiagnosticOnly": _trailer_diagnostic_only if _med_constrained else False,
        "rescuedGrassAreaSqft": round(
            (_rescued_px_last + _green_narrow_rescued_px_last)
            * (parcel_area_sqft / valid_pixel_count if valid_pixel_count > 0 else 0.0),
            1,
        ),
        "rescuedGrassComponentCount": _green_narrow_count_last,
        "finalDetectedAreaSqft": round(detected_area_sqft, 2),
        "output": args.output,
        "maskOutput": args.mask_output,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detect parcel-clipped mowable turf from geospatial imagery.")
    parser.add_argument("--imagery", required=True, help="Input GeoTIFF, such as NAIP 4-band imagery.")
    parser.add_argument("--parcel", required=True, help="Parcel GeoJSON in WGS84 by default.")
    parser.add_argument("--output", required=True, help="Output mowable GeoJSON path.")
    parser.add_argument("--mask-output", default="", help="Optional output mask GeoTIFF path.")
    parser.add_argument("--debug-dir", default="", help="Optional folder for debug imagery and mask artifacts.")
    parser.add_argument("--detection-preset", choices=["small_residential", "medium_residential", "large_rural"], default="", help="Parcel-size preset for vegetation and guardrail thresholds.")
    parser.add_argument("--sam-mask", default="", help="Optional SAMGeo/SAM 2 binary mask GeoTIFF on the same area.")
    parser.add_argument("--combine", choices=["intersect", "union"], default="intersect", help="How to combine vegetation and SAM masks.")
    parser.add_argument("--parcel-crs", default="EPSG:4326", help="CRS for the parcel GeoJSON.")
    parser.add_argument("--red-band", type=int, default=1)
    parser.add_argument("--green-band", type=int, default=2)
    parser.add_argument("--blue-band", type=int, default=3)
    parser.add_argument("--nir-band", type=int, default=4, help="Set to 0 for RGB-only imagery.")
    parser.add_argument("--ndvi-threshold", type=float, default=0.28)
    parser.add_argument("--visible-threshold", type=float, default=6.0)
    parser.add_argument("--saturation-min", type=float, default=None, help="Minimum RGB saturation; defaults to the visible threshold.")
    parser.add_argument("--brightness-min", type=float, default=40.0)
    parser.add_argument("--opening-iterations", type=int, default=1)
    parser.add_argument("--max-component-ratio", type=float, default=0.9)
    parser.add_argument("--sieve-size", type=int, default=64, help="Remove small mask regions by pixel count.")
    parser.add_argument("--min-area-sqft", type=float, default=80.0)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.nir_band <= 0:
        args.nir_band = None
    result = detect_mowable(args)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
