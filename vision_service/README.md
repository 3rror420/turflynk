# TurfLynk Vision Service

Lightweight FastAPI scaffold for mowable-area detection. The current implementation returns a safe placeholder FeatureCollection clipped to the submitted parcel, or an empty FeatureCollection when a safe placeholder cannot be created.

## Endpoint

`POST /detect-mowable`

Request:

```json
{
  "parcelGeoJson": {},
  "center": {},
  "zoom": 19,
  "source": "map"
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
  "areaSqft": 0,
  "mode": "vision-placeholder"
}
```

The placeholder path projects the parcel into a local UTM CRS, creates an inset/intersected geometry, and intersects with the original parcel before returning. This keeps returned geometry inside the parcel while leaving the API shape ready for a real vision model.

## Start

```bash
cd vision_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8017
```

## Future Optional Packages

Do not install these for the lightweight scaffold. They are candidates for future SAM/SamGeo integration:

- samgeo
- segment-anything
- torch
- rasterio
- opencv-python-headless
