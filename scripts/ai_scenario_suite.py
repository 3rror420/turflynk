#!/usr/bin/env python3
"""
Reusable parcel scenario test suite for AI diagnostics validation.
Calls /api/ai/detect-mowable/debug once per scenario and prints a compact
summary table. Diagnostics/testing only — no geometry, pricing, or production
API changes.
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

API_URL = "http://127.0.0.1:3000/api/ai/detect-mowable/debug"
SCENARIOS_FILE = Path("data/ai-test-scenarios.json")
OUT_ROOT = Path("sam-test-runs/scenario-suite")

SUMMARY_COLS = [
    "id",
    "dominantClass",
    "vegetationPercent",
    "structurePercent",
    "confidenceScore",
    "hybridConfidence.score",
    "routingRecommendation.action",
    "semanticCleanupProposal.estimatedRemovePercent",
]


def build_bbox_polygon(lat: float, lng: float, half_deg: float = 0.00045) -> dict:
    """Return a GeoJSON Feature with a rectangular Polygon around center."""
    coords = [
        [lng - half_deg, lat - half_deg],
        [lng + half_deg, lat - half_deg],
        [lng + half_deg, lat + half_deg],
        [lng - half_deg, lat + half_deg],
        [lng - half_deg, lat - half_deg],
    ]
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [coords]},
        "properties": {},
    }


def build_esri_url(lat: float, lng: float, zoom: float, size: int = 1024) -> str:
    meters_per_px = 156543.03392804103 / (2 ** zoom)
    half = size / 2
    half_lng = meters_per_px * half / 111320
    half_lat = meters_per_px * half * math.cos(lat * math.pi / 180) / 111320
    params = {
        "bbox": ",".join(f"{v:.8f}" for v in [lng - half_lng, lat - half_lat, lng + half_lng, lat + half_lat]),
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
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def dig(obj, *path, default=None):
    """Safely traverse nested dicts/lists by key path."""
    cur = obj
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur


def extract_row(scenario_id: str, resp: dict) -> dict:
    diag = resp.get("diagnostics") or {}
    sem_summary = (
        dig(diag, "semantic", "semanticSummary")
        or dig(diag, "semanticSummary")
        or {}
    )
    return {
        "id": scenario_id,
        "dominantClass": sem_summary.get("dominantClass"),
        "vegetationPercent": sem_summary.get("vegetationPercent"),
        "structurePercent": sem_summary.get("structurePercent"),
        "confidenceScore": resp.get("confidenceScore"),
        "hybridConfidence.score": dig(diag, "hybridConfidence", "score"),
        "routingRecommendation.action": dig(diag, "routingRecommendation", "action"),
        "semanticCleanupProposal.estimatedRemovePercent": dig(diag, "semanticCleanupProposal", "estimatedRemovePercent"),
    }


def fmt_cell(val, width: int) -> str:
    s = "-" if val is None else str(val)
    return s[:width].ljust(width)


def print_table(rows: list[dict]) -> None:
    widths = {col: max(len(col), 6) for col in SUMMARY_COLS}
    for row in rows:
        for col in SUMMARY_COLS:
            widths[col] = max(widths[col], len(str(row.get(col) or "-")))

    sep = "+" + "+".join("-" * (w + 2) for w in widths.values()) + "+"
    header = "|" + "|".join(f" {col.ljust(widths[col])} " for col in SUMMARY_COLS) + "|"

    print(sep)
    print(header)
    print(sep)
    for row in rows:
        line = "|" + "|".join(f" {fmt_cell(row.get(col), widths[col])} " for col in SUMMARY_COLS) + "|"
        print(line)
    print(sep)


def run_scenario(scenario: dict, out_dir: Path) -> dict:
    sid = scenario["id"]
    lat = scenario["center"]["lat"]
    lng = scenario["center"]["lng"]
    zoom = scenario.get("zoom", 19)

    payload = {
        "lat": lat,
        "lng": lng,
        "zoom": zoom,
        "parcelGeoJson": build_bbox_polygon(lat, lng),
        "imageUrl": build_esri_url(lat, lng, zoom),
        "source": "scenario_suite",
        "debugArtifacts": True,
    }

    t0 = time.time()
    try:
        resp = post_json(API_URL, payload)
        err = None
    except Exception as exc:
        resp = {"ok": False, "error": "request_failed", "detail": str(exc)}
        err = str(exc)
    elapsed = round(time.time() - t0, 2)

    scenario_dir = out_dir / sid
    scenario_dir.mkdir(parents=True, exist_ok=True)
    (scenario_dir / "response.json").write_text(json.dumps(resp, indent=2))
    (scenario_dir / "request.json").write_text(json.dumps(payload, indent=2))

    row = extract_row(sid, resp)
    row["_ok"] = resp.get("ok")
    row["_elapsed_sec"] = elapsed
    row["_error"] = err
    return row


def main() -> None:
    if not SCENARIOS_FILE.exists():
        print(f"ERROR: scenarios file not found: {SCENARIOS_FILE}", file=sys.stderr)
        sys.exit(1)

    scenarios = json.loads(SCENARIOS_FILE.read_text())
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = OUT_ROOT / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Scenario suite  — {len(scenarios)} scenario(s)")
    print(f"API             : {API_URL}")
    print(f"Output dir      : {out_dir}")
    print()

    rows = []
    for i, scenario in enumerate(scenarios, 1):
        sid = scenario.get("id", f"scenario_{i}")
        desc = scenario.get("description", "")
        print(f"[{i}/{len(scenarios)}] {sid}  —  {desc}")
        row = run_scenario(scenario, out_dir)
        rows.append(row)
        status = "OK" if row["_ok"] else f"FAIL ({row['_error']})"
        print(f"          status={status}  elapsed={row['_elapsed_sec']}s")

    print()
    print_table(rows)
    print()

    # Final summary stats
    low_conf = sum(
        1 for r in rows
        if r.get("confidenceScore") is not None and float(r["confidenceScore"]) < 0.42
    )
    manual_draw = sum(
        1 for r in rows if r.get("routingRecommendation.action") == "request_manual_draw"
    )

    # likelyMowable lives in the diagnostics semantic summary — re-read from saved files
    likely_mowable = 0
    for scenario in scenarios:
        sid = scenario.get("id", "")
        resp_file = out_dir / sid / "response.json"
        if resp_file.exists():
            resp = json.loads(resp_file.read_text())
            diag = resp.get("diagnostics") or {}
            sem = (dig(diag, "semantic", "semanticSummary") or dig(diag, "semanticSummary") or {})
            if sem.get("likelyMowable") is True:
                likely_mowable += 1

    print(f"Low confidence (<0.42)    : {low_conf}/{len(rows)}")
    print(f"request_manual_draw       : {manual_draw}/{len(rows)}")
    print(f"likelyMowable true        : {likely_mowable}/{len(rows)}")
    print()
    print(f"Raw outputs saved to: {out_dir}/")


if __name__ == "__main__":
    main()
