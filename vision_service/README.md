# TurfLynk Vision Service

FastAPI service for mowable-area detection. The current implementation fetches satellite imagery tiles, classifies likely grass/lawn pixels with a conservative vegetation heuristic, clips the result to the submitted parcel, and returns GeoJSON polygons only when confidence is acceptable.

## Endpoint

`POST /detect-mowable`

Request:

```json
{
  "parcelGeoJson": {},
  "center": {},
  "zoom": 19,
  "source": "map",
  "imageSource": {
    "type": "tile",
    "provider": "esri-world-imagery",
    "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  }
}
```

Response:

```json
{
  "ok": true,
  "featureCollection": {
    "type": "FeatureCollection",
    "features": []
  },
  "areaSqft": 1234,
  "source": "vision_service",
  "mode": "satellite-vegetation-heuristic",
  "confidence": 0.72
}
```

The service never returns the parcel itself as a fake detection. Empty or low-confidence detections return an empty FeatureCollection so the Node backend can show the manual Lasso Yard fallback.

`POST /detect-grass` is also available as a compatibility alias for older callers.

## Start

```bash
cd vision_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8017
```

## Optional GeoTIFF / SAMGeo Pipeline

For higher-accuracy parcel analysis with NAIP or another georeferenced aerial raster, use `mowable_geospatial.py`. It clips the raster to the parcel, builds an NDVI mask when a NIR band is available, falls back to visible RGB vegetation cues when it is not, optionally combines that mask with a SAMGeo/SAM 2 mask, and writes editable mowable polygons as GeoJSON.

Install the native geospatial stack with conda on Ubuntu:

```bash
conda create -n mow python=3.11 -c conda-forge gdal rasterio geopandas pyproj shapely numpy
conda activate mow
pip install -r vision_service/requirements-geospatial.txt
```

NDVI-only run with 4-band NAIP-style imagery:

```bash
python vision_service/mowable_geospatial.py \
  --imagery data/naip_parcel.tif \
  --parcel data/parcel.geojson \
  --output data/mowable.geojson \
  --mask-output data/mowable-mask.tif
```

RGB-only imagery:

```bash
python vision_service/mowable_geospatial.py \
  --imagery data/rgb_parcel.tif \
  --parcel data/parcel.geojson \
  --nir-band 0 \
  --output data/mowable.geojson
```

Hybrid SAMGeo flow:

1. Generate a binary raster mask with SAMGeo/SAM 2 for the same imagery.
2. Intersect it with NDVI to keep vegetation-shaped segments only:

```bash
python vision_service/mowable_geospatial.py \
  --imagery data/naip_parcel.tif \
  --parcel data/parcel.geojson \
  --sam-mask data/samgeo-mask.tif \
  --combine intersect \
  --output data/mowable.geojson \
  --mask-output data/mowable-hybrid-mask.tif
```

Use `--ndvi-threshold` to tune healthy vegetation sensitivity and `--min-area-sqft` to drop small fragments. For tree-heavy parcels, run DeepForest or a canopy-height model separately and subtract that canopy mask before accepting the output.

## Future Optional Packages

Do not install these for the lightweight scaffold. They are candidates for future SAM/SamGeo integration:

- segment-geospatial
- rasterio
- torch
- torchvision
- deepforest
