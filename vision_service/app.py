from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union


app = FastAPI(
    title="TurfLynk Vision Service",
    version="placeholder-0.1.0",
    description="Lightweight mowable-area placeholder ready for future SAM/SamGeo integration.",
)

SQFT_PER_SQM = 10.76391041671
PLACEHOLDER_INSET_FEET = 10.0


class DetectMowableRequest(BaseModel):
    parcelGeoJson: Dict[str, Any]
    center: Optional[Dict[str, float]] = None
    zoom: Optional[float] = None
    source: Optional[str] = None


def empty_feature_collection() -> Dict[str, Any]:
    return {"type": "FeatureCollection", "features": []}


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


def build_placeholder(parcel_geom: BaseGeometry) -> BaseGeometry:
    if parcel_geom.is_empty:
        return parcel_geom

    centroid = parcel_geom.centroid
    utm = estimate_utm_epsg(centroid.x, centroid.y)
    parcel_projected = transform_geometry(parcel_geom, "EPSG:4326", utm)

    if not parcel_projected.is_valid:
        parcel_projected = parcel_projected.buffer(0)

    inset_meters = PLACEHOLDER_INSET_FEET * 0.3048
    inner = parcel_projected.buffer(-inset_meters)
    if inner.is_empty:
        return inner

    min_x, min_y, max_x, max_y = inner.bounds
    width = max_x - min_x
    height = max_y - min_y
    if width <= 0 or height <= 0:
        return inner.intersection(parcel_projected)

    placeholder_box = box(
        min_x + width * 0.2,
        min_y + height * 0.2,
        max_x - width * 0.2,
        max_y - height * 0.2,
    )
    placeholder = placeholder_box.intersection(inner).intersection(parcel_projected)
    if not placeholder.is_valid:
        placeholder = placeholder.buffer(0)

    return transform_geometry(placeholder, utm, "EPSG:4326")


def feature_collection_from_geometry(geom: BaseGeometry) -> Dict[str, Any]:
    features = []
    for part in polygon_parts(geom):
        if part.is_empty or part.area <= 0:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"mode": "vision-placeholder"},
                "geometry": mapping(part),
            }
        )
    return {"type": "FeatureCollection", "features": features}


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "service": "turflynk-vision-service", "mode": "vision-placeholder"}


@app.post("/detect-mowable")
def detect_mowable(req: DetectMowableRequest) -> Dict[str, Any]:
    parcel_geom = geometry_from_geojson(req.parcelGeoJson)
    if parcel_geom.is_empty:
        return {
            "ok": True,
            "featureCollection": empty_feature_collection(),
            "areaSqft": 0,
            "mode": "vision-placeholder",
        }

    placeholder = build_placeholder(parcel_geom)
    placeholder = placeholder.intersection(parcel_geom)
    if not placeholder.is_valid:
        placeholder = placeholder.buffer(0).intersection(parcel_geom)

    feature_collection = feature_collection_from_geometry(placeholder)
    return {
        "ok": True,
        "featureCollection": feature_collection,
        "areaSqft": round(area_sqft(placeholder), 2) if feature_collection["features"] else 0,
        "mode": "vision-placeholder",
    }
