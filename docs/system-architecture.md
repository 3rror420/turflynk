# MowNWA / TurfLynk System Architecture

This document is the single source of truth for imagery, map math, coordinate systems, AI detection, debug artifacts, and API contracts.

Every AI/code session must read this file before modifying:

- imagery fetching
- MapLibre rendering
- parcel geometry
- CRS/projection logic
- bbox math
- AI Detect
- SAM/SAM2 workers
- classical vegetation detection
- server/index.js detection routing
- frontend AI result display

Do not introduce a second competing architecture. Update this file first when the system design changes.

---

## 1. Core Principle

MowNWA estimates mowable lawn/landscape area from property imagery and parcel geometry.

The detection pipeline must preserve this order:

1. Get parcel/property geometry.
2. Get the correct imagery for that parcel.
3. Preserve imagery CRS, bounds, dimensions, and transform metadata.
4. Run detection against that exact imagery.
5. Convert pixel/mask results back to map coordinates using the same metadata.
6. Clip/validate against the parcel.
7. Return GeoJSON to frontend.
8. Display exactly what backend returned.

No stage should silently resize, reproject, square-pad, simplify, or substitute imagery without recording diagnostics.

---

## 2. Imagery Provider

The app may use multiple imagery sources for different purposes:

| Purpose | Source | Notes |
|---|---|---|
| User map display | MapLibre raster/source imagery | What the user visually sees in browser |
| AI detection canonical image | Backend/vision NAIP or ArcGIS export | Must be explicitly logged |
| Debug overlays | Vision worker generated PNGs | Must correspond to exact request image |

The AI worker must log the actual imagery it used.

Every detect response should expose diagnostics:

- imagerySource
- imageryUrl
- canonicalWidth
- canonicalHeight
- imageCRS
- imageBounds
- captureSeasonOrDate, when known

Do not assume the imagery shown in MapLibre is the same image used by SAM/classical detection.

If the frontend map appears newer/greener than the backend AI image, this must be treated as an imagery-source mismatch, not a SAM failure.

---

## 3. CRS / Projection Rules

| Data | CRS |
|---|---|
| Frontend GeoJSON | EPSG:4326 / WGS84 lon-lat |
| Parcel GeoJSON | EPSG:4326 unless explicitly transformed |
| MapLibre display | Web Mercator rendering internally |
| Canonical AI image export | Prefer EPSG:3857 |
| Pixel mask coordinates | Image pixel space |

Rules:

- GeoJSON coordinates must be longitude, latitude.
- Pixel coordinates must never be treated as lon/lat.
- EPSG:3857 meters must never be treated as EPSG:4326 degrees.
- If ArcGIS returns spatialReference on the FeatureSet root, code must still detect and handle it.
- Do not rely on heuristic EPSG detection when explicit spatial reference exists.

---

## 4. BBOX Format

All bbox values must be labeled.

Never pass unlabeled arrays without knowing their CRS.

EPSG:4326 bbox:

[minLon, minLat, maxLon, maxLat]

EPSG:3857 bbox:

[minX, minY, maxX, maxY]

Every canonical image request should log:

- bbox4326
- bbox3857
- bboxSR
- imageSR

---

## 5. Zoom / Resolution Rules

The AI detection image should be high enough resolution for parcel-scale lawn detection.

Rules:

- Do not reintroduce forced 1024x1024 fallback imagery.
- Do not force square resizing.
- Preserve aspect ratio.
- Prefer high-resolution canonical imagery such as 1536-2048px long edge or better when supported.
- If the provider caps image size, log the cap.
- If image size is reduced for performance, log that reduction.

Bad behavior:

resize(image, (1024, 1024))
resize(image, (768, 768))

Good behavior:

original: 2048 x 1536
scaled:   1024 x 768

Scale by long edge only, preserve aspect ratio, keep the scale factor, and use it when converting masks back to original coordinates.

---

## 6. Tile / Image Math

Image pixel origin is top-left:

x = 0 at left
y = 0 at top

For an EPSG:3857 image with bounds:

minX, minY, maxX, maxY
width, height

Use:

mapX = minX + (pixelX / width) * (maxX - minX)
mapY = maxY - (pixelY / height) * (maxY - minY)

Y is inverted because image coordinates go downward while map coordinates go upward.

Then convert:

EPSG:3857 mapX/mapY -> EPSG:4326 lon/lat

Any SAM/classical mask polygon must be traceable through:

mask pixel coordinate
-> original image pixel coordinate
-> EPSG:3857 coordinate
-> EPSG:4326 coordinate
-> frontend GeoJSON

---

## 7. Detection Flow

The detection system has two major paths:

1. Classical vegetation/geospatial detection.
2. SAM/SAM2 segmentation assistance.

Classical vegetation detection is the reliable base candidate path.

SAM/SAM2 is a helper, not the default final authority.

Pipeline:

parcel geometry
-> canonical imagery
-> vegetation candidate mask
-> parcel clipping
-> hardscape/building/asphalt suppression
-> tree/shadow/canopy handling
-> final mowable mask
-> GeoJSON
-> quote area

The vision service should produce/log stages like:

- dbg_01_source_image.png
- dbg_02_vegetation_candidate.png
- dbg_03_parcel_clipped.png
- dbg_04_hardscape_removed.png
- dbg_05_tree_canopy_review.png
- dbg_06_final_mowable.png

### Commercial lots

For commercial lots like Sam's Club, the final mowable area may mostly be:

- perimeter grass
- parking lot islands
- landscaped strips
- roadside vegetation
- maintained green buffers

A high-coverage vegetation mask around the non-asphalt/non-building areas may be correct.

### Residential lots

For residential parcels, the system must avoid:

- selecting only trees
- selecting only dark green/shadow patches
- returning stale SAM polygons
- suppressing a better classical lawn candidate

---

## 8. SAM / SAM2 Rules

SAM should not overwrite classical detection just because SAM returned a mask.

SAM may win only when diagnostics show it is coherent and agrees with the expected property geometry.

SAM should be rejected or downgraded when:

- detected area is tiny compared with parcel/lawn expectation
- mask is mostly tree canopy
- mask is mostly dark/shadow areas
- mask is spatially fragmented
- mask does not overlap vegetation candidate well
- mask is stale/cached from a previous request
- mask was produced from wrong-size or square-resized imagery

Required SAM diagnostics:

- samEnabled
- samAttempted
- samAccepted
- samRejectedReason
- samDetectedAreaSqft
- samDetectedRatio
- samImageWidth
- samImageHeight
- samImageUrl

---

## 9. Classical Detection Rules

The classical path should expose:

- classicalAttempted
- classicalAccepted
- vegetationCandidateRatio
- parcelClippedRatio
- hardscapeRemovedRatio
- finalSelectedRatio
- classicalDetectedAreaSqft

If classical detection produces a strong vegetation/final mask and SAM is poor, classical should win.

The final API response should clearly state:

aiWinner: classical

or:

aiWinner: sam

---

## 10. Debug Artifacts

Debug artifacts are mandatory for serious AI Detect work.

Each detect run should be able to save:

debug-runs/
  <timestamp-or-request-id>/
    request.json
    source_image.png
    parcel_overlay.png
    vegetation_candidate.png
    hardscape_mask.png
    sam_mask.png
    final_selected_mask.png
    final_overlay.png
    response.json

A debug overlay without the source image and request metadata is not enough.

Every debug run must allow the same request to be replayed later.

---

## 11. API Contracts

Frontend AI Detect request should include:

- propertyId, optional
- parcelGeoJson
- humanConstraintGeoJson, nullable
- includeDiagnostics
- forceFresh

Important frontend rule:

The frontend must not send the previous AI result as the next detection constraint.

Human-drawn areas may be constraints.

AI-generated polygons must not become the next input constraint unless the user explicitly edits/accepts them as human input.

Backend AI Detect response should include:

- ok
- features
- detectedAreaSqft
- geometrySource
- aiWinner
- diagnostics

Diagnostics should include:

- imagerySource
- canonicalWidth
- canonicalHeight
- imageCRS
- vegetationCandidateRatio
- finalSelectedRatio
- classicalDetectedAreaSqft
- samDetectedAreaSqft
- samRejectedReason

---

## 12. Frontend Display Contract

The frontend must display the backend result directly.

It must not:

- reuse stale AI polygons
- silently simplify geometry into a different shape
- send AI polygons back as human constraints
- hide diagnostics from admin/debug mode
- show a cached response as if it were fresh

Frontend console logs should include:

- [AI DETECT INPUT]
- [AI DETECT RESPONSE]
- [AI DETECT DISPLAY]

Each should include request id / run id if available.

---

## 13. Server Routing Contract

server/index.js must not become the place where undocumented detection behavior hides.

Any routing decision must produce diagnostics:

- routingDecision
- reason
- aiWinner

If SAM fails, rejects, times out, or returns poor geometry, the request should continue to classical detection unless explicitly configured otherwise.

---

## 14. Environment Variables

Known environment flags:

- SAM_VISION_ENABLED
- SAM_VISION_URL
- SAM_VISION_TIMEOUT_MS
- A5000_VISION_ENABLED
- A5000_VISION_URL
- VISION_ENABLE_CLASSICAL_SEMANTICS
- VISION_NAIP_MAX_IMAGE_SIZE
- STRIPE_ALLOW_LIVE

Any new flag must include:

- name
- default
- allowed values
- effect
- where used

---

## 15. Do Not Regress List

Do not reintroduce:

- 1024x1024 forced fallback imagery
- square resizing without transform correction
- SAM as unconditional winner
- AI result reused as next AI constraint
- unlabeled bbox arrays
- hidden CRS assumptions
- frontend display of stale geometry
- broad server/index.js rewrites without diagnostics
- old Leaflet assumptions; frontend uses MapLibre

---

## 16. Required Workflow For AI Coding Sessions

Before patching, every AI assistant/person must:

1. Read this file.
2. State which section their patch affects.
3. Backup files first.
4. Make the smallest targeted change.
5. Add or preserve diagnostics.
6. Run syntax checks.
7. Report changed files and diff summary.

Backup command:

cd /var/www/turflynk-arkansas-quote-ready-fixed-v3
mkdir -p backups
tar -czf backups/pre-architecture-patch-$(date +%Y%m%d-%H%M%S).tar.gz server public vision_service docs package.json package-lock.json 2>/dev/null || true

---

## 17. Current Open Risk Areas

These areas are known to be fragile:

- imagery source mismatch between MapLibre and backend AI image
- EPSG:3857 vs EPSG:4326 conversion
- SAM resizing/padding coordinate drift
- stale SAM/frontend geometry reuse
- old brown/dormant imagery causing tree-biased masks
- server/index.js detection routing complexity
- missing replayable debug request bundles

---

## 18. Architecture Decision Rule

When uncertain, prefer:

- explicit metadata over guessing
- classical vegetation candidate over bad SAM
- high-resolution canonical imagery over 1024 fallback
- replayable debug artifacts over screenshots only
- small targeted patches over rewrites
