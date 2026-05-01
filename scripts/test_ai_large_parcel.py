#!/usr/bin/env python3
"""
Direct test for AI Detect Yard on large parcels.

Usage:
    cd /var/www/turflynk-arkansas-quote-ready-fixed-v3
    python3 scripts/test_ai_large_parcel.py
    python3 scripts/test_ai_large_parcel.py --debug  # saves debug artifacts
    python3 scripts/test_ai_large_parcel.py --via-http  # uses running vision service
"""
import argparse
import json
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Test parcel geometries
# ---------------------------------------------------------------------------

# ~10,000 sqft subdivision lot (Rogers, AR area)
SMALL_LOT_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[
        [-94.1310, 36.3320],
        [-94.1305, 36.3320],
        [-94.1305, 36.3315],
        [-94.1310, 36.3315],
        [-94.1310, 36.3320],
    ]],
}

# ~2-acre business parcel
BUSINESS_PARCEL_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[
        [-94.1350, 36.3300],
        [-94.1335, 36.3300],
        [-94.1335, 36.3290],
        [-94.1350, 36.3290],
        [-94.1350, 36.3300],
    ]],
}

# ~10-acre large residential/rural parcel
LARGE_RURAL_PARCEL_GEOJSON = {
    "type": "Polygon",
    "coordinates": [[
        [-94.1400, 36.3400],
        [-94.1360, 36.3400],
        [-94.1360, 36.3370],
        [-94.1400, 36.3370],
        [-94.1400, 36.3400],
    ]],
}

PARCELS = {
    "small_subdivision": SMALL_LOT_GEOJSON,
    "business_parcel": BUSINESS_PARCEL_GEOJSON,
    "large_rural": LARGE_RURAL_PARCEL_GEOJSON,
}


def sqft_from_geojson(geojson):
    try:
        from pyproj import Transformer
        from shapely.geometry import shape
        from shapely.ops import transform as shapely_transform

        geom = shape(geojson)
        centroid = geom.centroid
        zone = int((centroid.x + 180.0) // 6.0) + 1
        epsg = 32600 + zone if centroid.y >= 0 else 32700 + zone
        t = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
        proj = shapely_transform(t.transform, geom)
        return proj.area * 10.76391041671
    except Exception:
        return 0.0


def run_via_http(parcel_name, geojson, debug=False):
    import requests

    url = "http://127.0.0.1:8017/detect-mowable"
    payload = {
        "parcelGeoJson": {"type": "Feature", "geometry": geojson, "properties": {}},
        "debugArtifacts": debug,
    }
    t0 = time.time()
    try:
        resp = requests.post(url, json=payload, timeout=180)
        elapsed = time.time() - t0
        resp.raise_for_status()
        data = resp.json()
        features = data.get("features", [])
        diag = data.get("diagnostics") or data.get("diagnostic") or {}
        print(f"\n{'='*60}")
        print(f"PARCEL: {parcel_name}  ({round(sqft_from_geojson(geojson))} sqft)")
        print(f"STATUS: {'SUCCESS' if features else 'FAILED'}")
        print(f"ELAPSED: {elapsed:.1f}s")
        print(f"FEATURES: {len(features)}")
        print(f"AREA SQFT: {data.get('areaSqft', 0)}")
        print(f"CONFIDENCE: {data.get('confidence')} ({data.get('confidenceScore', 0):.3f})")
        print(f"REASON: {data.get('reason', '') or diag.get('reason', '') or 'none'}")
        print(f"FAILURE_STAGE: {diag.get('failureStage', 'n/a')}")
        print(f"PARCEL_AREA_SQFT: {diag.get('parcelAreaSqft', 'n/a')}")
        print(f"IMAGE_SIZE: {diag.get('actualImageWidth', 'n/a')}x{diag.get('actualImageHeight', 'n/a')}")
        print(f"PIXEL_COUNT: {diag.get('pixelCount', 'n/a')}")
        print(f"METERS_PER_PIXEL: {diag.get('metersPerPixel', 'n/a')}")
        print(f"VEGETATION_PIXELS: {diag.get('vegetationPixels', 'n/a')}")
        print(f"HARDSCAPE_PIXELS: {diag.get('hardscapePixels', 'n/a')}")
        print(f"POLYGON_COUNT_BEFORE_FILTER: {diag.get('polygonCountBeforeFiltering', 'n/a')}")
        print(f"POLYGON_COUNT_AFTER_FILTER: {diag.get('polygonCountAfterFiltering', 'n/a')}")
        print(f"DETECTED_RATIO: {diag.get('detectedRatio', 'n/a')}")
        print(f"LOW_CONF_CANDIDATE_RETURNED: {diag.get('lowConfidenceCandidateReturned', 'n/a')}")
        print(f"FALLBACK_SOFT_MASK_USED: {diag.get('fallbackSoftMaskUsed', 'n/a')}")
        selected = diag.get("selectedCandidate", {})
        print(f"SELECTED_CANDIDATE_REJECT_REASON: {selected.get('rejectReason', 'n/a')}")
        if debug:
            print(f"DEBUG_DIR: {diag.get('debugRunDir', 'n/a')}")
        return bool(features)
    except Exception as exc:
        elapsed = time.time() - t0
        print(f"\n{'='*60}")
        print(f"PARCEL: {parcel_name}  ERROR after {elapsed:.1f}s: {exc}")
        return False


def run_via_python(parcel_name, geojson, debug=False):
    import importlib
    import sys
    import tempfile
    from pathlib import Path
    from types import SimpleNamespace

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vision_service"))
    try:
        import mowable_geospatial
    except ImportError as exc:
        print(f"Cannot import mowable_geospatial: {exc}")
        print("Run this script from the project root or vision_service directory.")
        return False

    try:
        mowable_geospatial.require_rasterio()
    except SystemExit as exc:
        print(f"rasterio not available: {exc}")
        return False

    print(f"\n{'='*60}")
    print(f"PARCEL: {parcel_name}  ({round(sqft_from_geojson(geojson))} sqft)")

    # We need actual NAIP imagery — this test only works via HTTP endpoint
    print("NOTE: direct python test requires pre-downloaded NAIP imagery.")
    print("Use --via-http to test against the running vision service.")
    return None


def main():
    parser = argparse.ArgumentParser(description="Test AI large-parcel detection.")
    parser.add_argument("--debug", action="store_true", help="Save debug artifacts")
    parser.add_argument("--via-http", action="store_true", default=True,
                        help="Use running vision service HTTP API (default)")
    parser.add_argument("--parcel", choices=list(PARCELS.keys()) + ["all"], default="all",
                        help="Which parcel to test")
    args = parser.parse_args()

    parcels_to_test = PARCELS if args.parcel == "all" else {args.parcel: PARCELS[args.parcel]}

    print("TurfLynk AI Large-Parcel Test")
    print(f"Testing {len(parcels_to_test)} parcel(s) via {'HTTP' if args.via_http else 'Python'}...")

    results = {}
    for name, geojson in parcels_to_test.items():
        if args.via_http:
            results[name] = run_via_http(name, geojson, debug=args.debug)
        else:
            results[name] = run_via_python(name, geojson, debug=args.debug)

    print(f"\n{'='*60}")
    print("SUMMARY:")
    for name, success in results.items():
        status = "PASS" if success else ("SKIP" if success is None else "FAIL")
        print(f"  {status}  {name}")

    failed = [k for k, v in results.items() if v is False]
    if failed:
        print(f"\n{len(failed)} test(s) failed: {', '.join(failed)}")
        sys.exit(1)
    else:
        print("\nAll tests passed or skipped.")


if __name__ == "__main__":
    main()
