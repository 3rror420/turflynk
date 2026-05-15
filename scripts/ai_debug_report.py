#!/usr/bin/env python3
"""Read-only AI debug report — calls /api/ai/detect-mowable/debug and prints a summary."""

import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API_URL = "http://127.0.0.1:3000/api/ai/detect-mowable/debug"
OUT_FILE = Path("sam-test-runs/latest-ai-debug-report.json")

TEST_PAYLOAD = {
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
            ]],
        },
        "properties": {},
    },
    "debugArtifacts": True,
}


def build_image_url(lat: float, lng: float, zoom: float, size: int = 1024) -> str:
    meters_per_px = 156543.03392804103 / (2 ** zoom)
    half = size / 2
    half_lng = meters_per_px * half / 111320
    half_lat = meters_per_px * half * math.cos(lat * math.pi / 180) / 111320
    bbox = [lng - half_lng, lat - half_lat, lng + half_lng, lat + half_lat]
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
        "World_Imagery/MapServer/export?" + urllib.parse.urlencode(params)
    )


def post_json(url: str, payload: dict, timeout: int = 180) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8", errors="replace"))


def val(v, fmt=None) -> str:
    if v is None:
        return "unavailable"
    if fmt:
        try:
            return fmt(v)
        except Exception:
            pass
    return str(v)


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def row(label: str, value) -> None:
    print(f"  {label:<22} {val(value)}")


def main() -> int:
    payload = dict(TEST_PAYLOAD)
    payload["imageUrl"] = build_image_url(payload["lat"], payload["lng"], payload["zoom"])

    print(f"Calling {API_URL} ...")
    try:
        resp = post_json(API_URL, payload)
    except Exception as exc:
        print(f"ERROR: request failed — {exc}", file=sys.stderr)
        return 1

    # Save raw JSON
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(resp, indent=2))
    print(f"Raw JSON saved → {OUT_FILE}")

    diag = resp.get("diagnostics") or {}
    worker = diag.get("workerStatus") or {}
    sem_block = diag.get("semantic") or {}
    sem = sem_block.get("semanticSummary") or {}
    mismatch = diag.get("semanticMismatch") or {}
    debug_paths = sem_block.get("debug") or {}

    features = resp.get("features") or []

    section("Detection Summary")
    row("source", resp.get("source"))
    row("detection_mode", resp.get("detection_mode") or resp.get("detectionMode"))
    row("features", len(features))
    row("sqft (mowable)", resp.get("mowableAreaSqft"))
    row("confidenceScore", resp.get("confidenceScore"))

    section("Worker Status")
    sam = worker.get("sam") or {}
    a5k = worker.get("a5000") or {}
    row("SAM enabled", sam.get("enabled"))
    row("SAM used", sam.get("used"))
    row("A5000 enabled", a5k.get("enabled"))
    row("A5000 used", a5k.get("used"))

    section("Semantic Summary")
    row("dominantClass", sem.get("dominantClass"))
    row("vegetationPercent", sem.get("vegetationPercent"))
    row("structurePercent", sem.get("structurePercent"))
    row("pavementPercent", sem.get("pavementPercent"))
    row("treeHeavy", sem.get("treeHeavy"))
    row("structureHeavy", sem.get("structureHeavy"))
    row("likelyMowable", sem.get("likelyMowable"))

    section("Semantic Mismatch")
    row("suspicious", mismatch.get("suspicious"))
    reasons = mismatch.get("reasons")
    if reasons:
        for r in reasons:
            print(f"  {'reason':<22} {r}")
    else:
        print(f"  {'reasons':<22} unavailable")

    section("Hybrid Confidence")
    hc = diag.get("hybridConfidence") or {}
    row("baseConfidence", hc.get("baseConfidence"))
    row("adjustment", hc.get("adjustment"))
    row("score", hc.get("score"))
    hc_reasons = hc.get("reasons")
    if hc_reasons:
        for r in hc_reasons:
            print(f"  {'reason':<22} {r}")
    else:
        print(f"  {'reasons':<22} unavailable")

    section("Routing Recommendation")
    rr = diag.get("routingRecommendation") or {}
    row("action", rr.get("action"))
    row("confidenceBand", rr.get("confidenceBand"))
    rr_reasons = rr.get("reasons")
    if rr_reasons:
        for r in rr_reasons:
            print(f"  {'reason':<22} {r}")
    else:
        print(f"  {'reasons':<22} unavailable")

    section("Debug Paths")
    row("overlay", debug_paths.get("overlay"))
    row("mask", debug_paths.get("mask"))
    row("classesJson", debug_paths.get("classesJson"))

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
