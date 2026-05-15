#!/usr/bin/env python3
import argparse
import csv
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

API_URL = "http://127.0.0.1:3000/api/ai/detect-mowable/debug"
OUT_ROOT = Path("sam-test-runs")


TESTS = [
    {
        "name": "bentonville_subdivision_test",
        "address": "4606 SW Fieldstone Blvd, Bentonville, AR",
        "lat": 36.3385,
        "lng": -94.2083,
        "zoom": 20,
        "parcelGeoJson": {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-94.20855, 36.33868],
                    [-94.20808, 36.33868],
                    [-94.20808, 36.33832],
                    [-94.20855, 36.33832],
                    [-94.20855, 36.33868],
                ]]
            },
            "properties": {}
        }
    },
    {
        "name": "rogers_shadow_test",
        "address": "2404 S 26th St, Rogers, AR",
        "lat": 36.3082,
        "lng": -94.1568,
        "zoom": 20,
        "parcelGeoJson": {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-94.15705, 36.30840],
                    [-94.15655, 36.30840],
                    [-94.15655, 36.30800],
                    [-94.15705, 36.30800],
                    [-94.15705, 36.30840],
                ]]
            },
            "properties": {}
        }
    },
    {
        "name": "simple_square_known_good",
        "address": "manual test polygon",
        "lat": 36.3729,
        "lng": -94.2088,
        "zoom": 19,
        "parcelGeoJson": {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [-94.2091, 36.3731],
                    [-94.2085, 36.3731],
                    [-94.2085, 36.3726],
                    [-94.2091, 36.3726],
                    [-94.2091, 36.3731],
                ]]
            },
            "properties": {}
        }
    },
]


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "test"


def build_esri_export_url(lat: float, lng: float, zoom: float, size: int = 1024) -> str:
    meters_per_px = 156543.03392804103 / (2 ** zoom)
    half = size / 2
    half_lng = meters_per_px * half / 111320
    half_lat = meters_per_px * half * math.cos(lat * math.pi / 180) / 111320

    bbox = [
        lng - half_lng,
        lat - half_lat,
        lng + half_lng,
        lat + half_lat,
    ]

    params = {
        "bbox": ",".join(f"{v:.8f}" for v in bbox),
        "bboxSR": "4326",
        "size": f"{size},{size}",
        "imageSR": "4326",
        "format": "jpg",
        "f": "image",
    }

    return (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        "World_Imagery/MapServer/export?"
        + urllib.parse.urlencode(params)
    )


def post_json(url: str, payload: dict, timeout: int = 180) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read().decode("utf-8", errors="replace")
        return json.loads(raw)


def download_file(url: str, path: Path, timeout: int = 60) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as res:
            path.write_bytes(res.read())
        return True
    except Exception as exc:
        path.with_suffix(path.suffix + ".error.txt").write_text(str(exc))
        return False


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=False))


def extract_summary(test: dict, response: dict, elapsed: float, image_saved: bool) -> dict:
    features = response.get("features") or response.get("featureCollection", {}).get("features") or []
    diagnostics = response.get("diagnostics") or {}

    return {
        "name": test.get("name", ""),
        "address": test.get("address", ""),
        "ok": response.get("ok"),
        "source": response.get("source"),
        "mode": response.get("mode") or response.get("detectionMode") or response.get("detection_mode"),
        "feature_count": len(features),
        "mowable_sqft": response.get("mowableAreaSqft"),
        "parcel_sqft": response.get("parcelAreaSqft"),
        "detected_ratio": response.get("detectedRatio") or diagnostics.get("detectedRatio"),
        "confidence": response.get("confidence"),
        "confidenceScore": response.get("confidenceScore"),
        "reason": response.get("reason") or diagnostics.get("reason"),
        "guardrailReason": diagnostics.get("guardrailReason"),
        "elapsed_sec": round(elapsed, 2),
        "image_saved": image_saved,
    }


def run_test(test: dict, run_dir: Path, api_url: str) -> dict:
    name = slugify(test["name"])
    test_dir = run_dir / name
    test_dir.mkdir(parents=True, exist_ok=True)

    payload = dict(test)
    payload.pop("name", None)
    payload["debugArtifacts"] = True

    image_url = build_esri_export_url(payload["lat"], payload["lng"], payload.get("zoom", 19))
    payload["imageUrl"] = image_url

    write_json(test_dir / "request.json", payload)
    (test_dir / "image-url.txt").write_text(image_url + "\n")

    image_saved = download_file(image_url, test_dir / "sam-input-image.jpg")

    start = time.time()
    try:
        response = post_json(api_url, payload)
    except Exception as exc:
        response = {
            "ok": False,
            "error": "request_failed",
            "detail": str(exc),
        }
    elapsed = time.time() - start

    write_json(test_dir / "response.json", response)

    fc = response.get("featureCollection")
    if fc:
        write_json(test_dir / "result.geojson", fc)

    summary = extract_summary(test, response, elapsed, image_saved)
    write_json(test_dir / "summary.json", summary)

    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", default=API_URL)
    parser.add_argument("--out-root", default=str(OUT_ROOT))
    parser.add_argument("--tests-json", default="")
    parser.add_argument("--only", default="", help="Run one test by name")
    args = parser.parse_args()

    tests = TESTS
    if args.tests_json:
        tests = json.loads(Path(args.tests_json).read_text())
    if args.only:
        tests = [t for t in tests if t.get("name") == args.only]

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = Path(args.out_root) / f"sam-run-{stamp}"
    run_dir.mkdir(parents=True, exist_ok=True)

    rows = []

    print(f"Run folder: {run_dir}")
    print(f"API: {args.api_url}")
    print()

    for i, test in enumerate(tests, 1):
        print(f"[{i}/{len(tests)}] {test['name']} — {test.get('address','')}")
        row = run_test(test, run_dir, args.api_url)
        rows.append(row)
        print(
            f"  source={row['source']} features={row['feature_count']} "
            f"sqft={row['mowable_sqft']} confidenceScore={row['confidenceScore']} "
            f"reason={row['reason']}"
        )

    csv_path = run_dir / "summary.csv"
    fieldnames = list(rows[0].keys()) if rows else []
    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    write_json(run_dir / "summary.json", rows)

    print()
    print(f"Done.")
    print(f"Summary CSV: {csv_path}")
    print(f"Full run dir: {run_dir}")


if __name__ == "__main__":
    main()
