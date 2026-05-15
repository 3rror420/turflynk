"""
vision-sam-worker/semantic_app.py

FastAPI A5000 semantic diagnostics worker.

POST /semantic-detect { imageUrl }
  → fetches the image, runs pixel-wise semantic classification,
    saves debug artifacts (original, mask, overlay, classes JSON),
    and returns classes + debug paths.

Diagnostics only — does not touch SAM geometry or mowable polygons.
"""

import io
import json
import logging
import os
import random
import string
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import requests
from fastapi import FastAPI
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "info").upper(),
    format="%(asctime)s [SEMANTIC] %(levelname)s %(message)s",
)
log = logging.getLogger("semantic-worker")

try:
    import torch
    _DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    _GPU_NAME = torch.cuda.get_device_name(0) if _DEVICE == "cuda" else "cpu"
except ImportError:
    _DEVICE = "cpu"
    _GPU_NAME = "cpu"

log.info(f"semantic-worker device={_DEVICE} gpu={_GPU_NAME}")

app = FastAPI(title="TurfLynk A5000 Semantic Worker", version="0.1.0")

# ── Debug output root ────────────────────────────────────────────────────────
_DEBUG_ROOT = Path(os.getenv("SEMANTIC_DEBUG_ROOT", Path(__file__).parent / "debug_runs"))
_DEBUG_ROOT.mkdir(parents=True, exist_ok=True)

# ── Stable class color map (RGBA) ────────────────────────────────────────────
# Classes referenced by server/index.js: grass, tree, building, road, water
CLASS_COLORS: Dict[str, tuple] = {
    "grass":    (0,   200,  60,  180),   # green
    "tree":     (0,    90,  10,  180),   # dark green
    "building": (220,  50,  50,  180),   # red
    "road":     (120, 120, 120,  180),   # gray
    "water":    (30,  100, 220,  180),   # blue
    "other":    (180, 180, 180,   40),   # low-opacity light gray
}


# ── Request model ─────────────────────────────────────────────────────────────
class SemanticRequest(BaseModel):
    imageUrl: str


# ── Pixel-wise semantic classification ───────────────────────────────────────
def classify_pixels(arr: np.ndarray) -> np.ndarray:
    """
    Classify each pixel into a semantic class index.
    Returns an int8 array with the same (H, W) shape.

    Class indices:
      0 = grass
      1 = tree
      2 = building
      3 = road
      4 = water
      5 = other
    """
    r = arr[:, :, 0].astype(np.float32)
    g = arr[:, :, 1].astype(np.float32)
    b = arr[:, :, 2].astype(np.float32)

    brightness  = (r + g + b) / 3.0
    saturation  = np.max(arr, axis=2).astype(np.float32) - np.min(arr, axis=2).astype(np.float32)
    excess_green = 2.0 * g - r - b

    # Texture: sum of horizontal + vertical absolute differences
    dy = np.zeros_like(brightness)
    dx = np.zeros_like(brightness)
    dy[1:, :]  = np.abs(brightness[1:, :]  - brightness[:-1, :])
    dx[:, 1:]  = np.abs(brightness[:, 1:]  - brightness[:, :-1])
    texture = dx + dy

    # Priority order: water > tree > grass > building > road > other
    out = np.full(arr.shape[:2], 5, dtype=np.int8)   # default: other

    # road: medium gray, low saturation, no strong color channel dominance
    road_mask = (
        (brightness > 55)  & (brightness < 190)
        & (saturation < 28)
        & (excess_green > -20) & (excess_green < 20)
    )
    out[road_mask] = 3

    # building: bright and low saturation, or reddish-gray roof
    building_mask = (
        (brightness > 160) & (saturation < 35)
    ) | (
        (r > g + 20) & (r > b + 20) & (brightness > 100) & (saturation > 20)
    )
    out[building_mask] = 2

    # grass: green dominant, medium brightness, excess green
    grass_mask = (
        (g > r + 7) & (g > b + 3)
        & (excess_green > 8)
        & (brightness > 50)  & (brightness < 215)
        & (saturation > 10)
        & (texture < 60)
    )
    out[grass_mask] = 0

    # tree: green dominant, darker, higher texture (canopy shadow)
    tree_mask = (
        (g > r + 3)
        & (brightness < 105)
        & (texture > 20)
        & (saturation > 8)
    )
    out[tree_mask] = 1

    # water: blue strongly dominant
    water_mask = (
        (b > r + 12) & (b > g + 8)
        & (brightness > 30)
    )
    out[water_mask] = 4

    return out


def class_fractions(label_map: np.ndarray) -> Dict[str, float]:
    total = label_map.size
    class_names = ["grass", "tree", "building", "road", "water", "other"]
    result: Dict[str, float] = {}
    for idx, name in enumerate(class_names):
        count = int(np.sum(label_map == idx))
        result[name] = round(count / total, 4) if total > 0 else 0.0
    return result


# ── Debug artifact helpers ────────────────────────────────────────────────────
def _random_tag(n: int = 6) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def make_run_dir() -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    tag = _random_tag()
    run_dir = _DEBUG_ROOT / f"semantic-{ts}-{tag}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def build_semantic_mask_image(label_map: np.ndarray) -> Image.Image:
    """Create an RGBA image where each pixel is colored by its class."""
    h, w = label_map.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    class_names = ["grass", "tree", "building", "road", "water", "other"]
    for idx, name in enumerate(class_names):
        mask = label_map == idx
        if mask.any():
            color = CLASS_COLORS[name]
            out[mask] = color
    return Image.fromarray(out, mode="RGBA")


def build_semantic_overlay(original: Image.Image, label_map: np.ndarray) -> Image.Image:
    """Blend original RGB image with semi-transparent class color overlay."""
    base = original.convert("RGBA")
    overlay = build_semantic_mask_image(label_map)
    return Image.alpha_composite(base, overlay)


def save_debug_artifacts(
    run_dir: Path,
    original_img: Image.Image,
    label_map: np.ndarray,
    classes: Dict[str, float],
) -> Dict[str, str]:
    # 1. original.png
    orig_path = run_dir / "original.png"
    original_img.save(orig_path)

    # 2. semantic_mask.png
    mask_path = run_dir / "semantic_mask.png"
    build_semantic_mask_image(label_map).save(mask_path)

    # 3. semantic_overlay.png
    overlay_path = run_dir / "semantic_overlay.png"
    build_semantic_overlay(original_img, label_map).save(overlay_path)

    # 4. classes.json
    classes_path = run_dir / "classes.json"
    classes_path.write_text(json.dumps(classes, indent=2))

    log.info(f"Debug artifacts saved to {run_dir}")
    return {
        "runDir":     str(run_dir),
        "original":   str(orig_path),
        "mask":       str(mask_path),
        "overlay":    str(overlay_path),
        "classesJson": str(classes_path),
    }


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "a5000-semantic-worker",
        "device": _DEVICE,
        "gpuName": _GPU_NAME,
        "model": "color-heuristic",
        "debugRoot": str(_DEBUG_ROOT),
    }


@app.post("/semantic-detect")
def semantic_detect(req: SemanticRequest):
    t0 = time.time()

    # Fetch image
    try:
        resp = requests.get(
            req.imageUrl,
            timeout=30,
            headers={"User-Agent": "TurfLynk-SemanticWorker/0.1"},
        )
        resp.raise_for_status()
        original_img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    except Exception as exc:
        log.warning(f"Image fetch failed url={req.imageUrl!r}: {exc}")
        return {
            "ok": False,
            "error": f"image fetch failed: {exc}",
            "source": "a5000_semantic",
            "model": "color-heuristic",
            "device": _DEVICE,
        }

    width, height = original_img.size
    arr = np.array(original_img)

    # Classify
    label_map = classify_pixels(arr)
    classes = class_fractions(label_map)

    # Save debug artifacts (always — diagnostics only, no gating)
    run_dir = make_run_dir()
    debug_paths = save_debug_artifacts(run_dir, original_img, label_map, classes)

    elapsed_ms = round((time.time() - t0) * 1000)
    log.info(
        f"semantic-detect w={width} h={height} "
        f"grass={classes.get('grass', 0):.3f} "
        f"tree={classes.get('tree', 0):.3f} "
        f"building={classes.get('building', 0):.3f} "
        f"road={classes.get('road', 0):.3f} "
        f"water={classes.get('water', 0):.3f} "
        f"elapsedMs={elapsed_ms}"
    )

    return {
        "ok": True,
        "source": "a5000_semantic",
        "model": "color-heuristic",
        "device": _DEVICE,
        "width": width,
        "height": height,
        "classes": classes,
        "elapsedMs": elapsed_ms,
        "debug": debug_paths,
    }
