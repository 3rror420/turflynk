// ai-tuning.js — AI Detection Admin Tuning Workstation
// Admin-only. Requires MapLibre GL JS loaded on the page.
//
// PRESET LIFECYCLE (enforced here and server-side):
//   Temporary Session → Draft → Validated → Production → Archived
//
// CORE RULE: slider/toggle changes NEVER auto-save or affect live detection.
// Detection test runs use ephemeral runtime overrides only.
// Only explicit "Promote to Production" affects customer-facing detection.

const aiTuning = (() => {
  // ── Runtime state ──────────────────────────────────────────────────────────
  let map = null;
  let mapReady = false;
  let currentParcelGeoJson = null;
  let currentParcelBounds = null;
  let currentResult = null;
  let previousResult = null;
  let compareMode = false;
  let isRunning = false;
  let savedPresets = [];
  let testParcels = [];
  let activeBasePreset = 'medium_residential';

  // ── Map draw / manual edit state ───────────────────────────────────────────
  let manualAreas = { type: 'FeatureCollection', features: [] };
  let groundTruthAreas = null;
  let manualUndoStack = [];
  let activeMapTool = 'idle'; // 'idle' | 'draw' | 'cut' | 'edit'
  let editMarkersAdmin = [];
  let editSnapshotAdmin = null;
  let currentParcelFeatureForLasso = null;

  // ── Test area state (AI detection geometry selection) ─────────────────────
  let originalParcelGeoJson = null;    // full parcel loaded for tuning
  let activeTestAreaGeoJson = null;    // clipped lasso selection — detection input when set
  let _pendingTestAreaUpdate = false;  // set in startAdminDraw, consumed in setAdminManualAreas

  // ── Randomizer state ───────────────────────────────────────────────────────
  let randomizeSnapshot = null;   // pre-randomize slider values for undo
  let lastRandomSeed    = null;

  // Lifecycle state — never auto-modified by detection runs, slider changes, or parcel loads
  let isDirty = false;
  let loadedPreset = null;   // custom preset currently loaded into controls (or null = built-in)
  let sessionBaseline = {};  // ctrl-id → value at last load/reset (for change highlighting)

  // ── Parcel context — updated whenever a parcel is loaded ───────────────────
  // Used to enrich preset/snapshot saves with "where were you testing?"
  let currentParcelLabel   = null;   // e.g. "11511 Indian Hills"
  let currentParcelAddress = null;   // full address string

  // ── Built-in preset baseline values (mirrors Python defaults) ─────────────
  const BUILT_IN_DEFAULTS = {
    small_residential: {
      detectionMode: 'hardscape_exclusion_then_remainder',
      ndviSweep: [0.32, 0.35, 0.38],
      visibleSweep: [9.0, 11.0, 13.0],
      brightnessSweep: [48.0, 56.0, 64.0],
      maxDetectedRatio: 0.80, hardDetectedRatio: 0.98,
      strongExclusionRatio: 0.06, minComponentAreaSqft: 120.0,
      maxComponents: 4, maxComponentRatio: 0.65,
      gsdCloseCap: 8, softFallback: false, lowConfidenceCandidate: false,
      hardscapeGrow: 2,
      hardscapeRules: { paleBrightnessMin: 128.0, paleSaturationMax: 58.0, neutralSaturationMax: 34.0, graySaturationMax: 30.0, darkShadowBrightnessMax: 42.0, whiteBrightnessMin: 184.0 },
      vegetation: { saturationFloor: 8.0, excessGreenFloor: 6.0, greenRatioMin: 0.335, variMin: 0.025, brightnessMax: 205.0, greenSlack: 4.0, ndviDrop: 0.0, ndviSoftDrop: 0.03, ndviQuantile: 0.56, ndviCap: 0.38, townLawnDrop: 0.035 },
    },
    medium_residential: {
      detectionMode: 'hybrid_hardscape_light_vegetation_sanity',
      ndviSweep: [0.28, 0.30, 0.33],
      visibleSweep: [6.0, 8.0, 10.0],
      brightnessSweep: [40.0, 48.0, 56.0],
      maxDetectedRatio: 0.68, hardDetectedRatio: 0.85,
      strongExclusionRatio: 0.04, minComponentAreaSqft: 100.0,
      maxComponents: 6, maxComponentRatio: 0.65,
      gsdCloseCap: 7, softFallback: true, lowConfidenceCandidate: false,
      hardscapeGrow: 3,
      hardscapeRules: { paleBrightnessMin: 108.0, paleSaturationMax: 60.0, neutralSaturationMax: 38.0, graySaturationMax: 38.0, darkShadowBrightnessMax: 52.0, whiteBrightnessMin: 162.0 },
      vegetation: { saturationFloor: 7.0, excessGreenFloor: 3.5, greenRatioMin: 0.335, variMin: 0.01, brightnessMax: 206.0, greenSlack: 6.0, ndviDrop: 0.02, ndviSoftDrop: 0.06, ndviQuantile: 0.52, ndviCap: 0.32, townLawnDrop: 0.045 },
    },
    large_rural: {
      detectionMode: 'vegetation_ndvi',
      ndviSweep: [0.25, 0.28, 0.30],
      visibleSweep: [4.0, 6.0, 8.0],
      brightnessSweep: [35.0, 40.0, 50.0],
      maxDetectedRatio: 0.93, hardDetectedRatio: 0.97,
      strongExclusionRatio: 0.015, minComponentAreaSqft: 80.0,
      maxComponents: 12, maxComponentRatio: 0.90,
      gsdCloseCap: 15, softFallback: true, lowConfidenceCandidate: true,
      hardscapeGrow: 1,
      hardscapeRules: { paleBrightnessMin: 158.0, paleSaturationMax: 36.0, neutralSaturationMax: 20.0, graySaturationMax: 26.0, darkShadowBrightnessMax: 28.0, whiteBrightnessMin: 205.0 },
      vegetation: { saturationFloor: 2.5, excessGreenFloor: -2.0, greenRatioMin: 0.31, variMin: 0.0, brightnessMax: 222.0, greenSlack: 12.0, ndviDrop: 0.08, ndviSoftDrop: 0.12, ndviQuantile: 0.48, ndviCap: 0.22, townLawnDrop: 0.06 },
    },
  };

  // ── Per-control metadata (descriptions, effects, ranges) ──────────────────
  const CTRL_META = {
    ndviSweep_mid:          { shortDescription: 'Primary greenness threshold — how green a pixel must be to qualify as mowable lawn.', lowEffect: 'Detects more pixels as grass, including dryer, yellower, or shadowed areas.', highEffect: 'Only clearly green pixels count — may miss drought-stressed or shaded lawns.', recommendedRange: '0.28 – 0.35', impact: 'high', visualCue: 'Lower = larger green overlay. Higher = smaller, more selective overlay.' },
    veg_ndviCap:            { shortDescription: 'Upper NDVI ceiling treated as lawn. Values above this are classified as trees or dense shrubs.', lowEffect: 'Excludes denser vegetation (trees, bushes) more aggressively.', highEffect: 'Allows woodsier/overgrown pixels to count as mowable.', recommendedRange: '0.25 – 0.40', impact: 'medium', visualCue: 'Lower = excludes trees. Higher = includes them as lawn.' },
    veg_excessGreenFloor:   { shortDescription: 'Minimum "excess green" score (2G−R−B) for a pixel. Below this threshold the pixel is not considered grass.', lowEffect: 'Very permissive — includes yellowy, faded grass, weeds, even some bare dirt.', highEffect: 'Only richly green pixels count — reduces noise but may miss dry or pale grass.', recommendedRange: '3.5 – 9.0', impact: 'high', visualCue: 'Negative values make detection very inclusive. High values exclude less-green areas.' },
    veg_greenSlack:         { shortDescription: 'How much variance from "green" is tolerated before rejecting a pixel.', lowEffect: 'Tighter green definition — more accurate but may split continuous lawns.', highEffect: 'Looser — captures more marginal grass, can include non-grass patches.', recommendedRange: '4 – 8', impact: 'medium', visualCue: 'Lower = precise edges. Higher = fills in gaps between lawn patches.' },
    veg_saturationFloor:    { shortDescription: 'Minimum color saturation required for a vegetation pixel. Filters out gray and white pixels.', lowEffect: 'Allows nearly gray pixels — useful for arid or dead-grass lawns.', highEffect: 'Requires vivid green — reduces hardscape bleed-in from concrete near grass.', recommendedRange: '5 – 10', impact: 'medium', visualCue: 'Lower = includes pale or dry grass. Higher = only vivid green.' },
    veg_brightnessMax:      { shortDescription: 'Pixels brighter than this value are excluded from vegetation (likely pavement or rooftops).', lowEffect: 'Aggressively excludes bright areas — good for bleached concrete near grass.', highEffect: 'Allows bright pixels to count as grass — may include sun-bleached surfaces.', recommendedRange: '200 – 215', impact: 'medium', visualCue: 'Lower = better hardscape separation in high-sun imagery.' },
    hs_paleBrightnessMin:   { shortDescription: 'Pixels brighter than this become hardscape candidates. Catches concrete, light roofing, and gravel.', lowEffect: 'More pixels are seeded as hardscape — more aggressive structure exclusion.', highEffect: 'Only very bright surfaces excluded — may miss standard concrete driveways.', recommendedRange: '108 – 158', impact: 'high', visualCue: 'Lower = larger excluded structure areas around buildings.' },
    hs_paleSaturationMax:   { shortDescription: 'Max saturation for pale hardscape pixels (concrete, gravel, tan pavement).', lowEffect: 'Only pure gray/white pixels count — misses beige or tinted concrete.', highEffect: 'Includes more colorful surfaces as hardscape — may clip some lawns.', recommendedRange: '50 – 65', impact: 'medium', visualCue: 'Higher = catches tan/beige pavement. Lower = only pure gray concrete.' },
    hs_graySaturationMax:   { shortDescription: 'Saturation ceiling for gray-tone hardscape (roads, driveways, sidewalks).', lowEffect: 'Only pure gray counts — misses lightly colored pavement.', highEffect: 'Catches more road/driveway tones of varying color.', recommendedRange: '26 – 40', impact: 'medium', visualCue: 'Raise for better road and driveway detection.' },
    hs_darkShadowMax:       { shortDescription: 'Pixels darker than this are treated as structural shadow (under eaves, beneath trees near buildings).', lowEffect: 'Only very dark areas excluded — shadows in lawn stay included.', highEffect: 'More shadow excluded — reduces false positives under trees and rooflines.', recommendedRange: '28 – 52', impact: 'medium', visualCue: 'Higher = excludes more shadowed regions near buildings.' },
    hs_whiteBrightnessMin:  { shortDescription: 'Very bright pixels above this are classified as white hardscape (light roofs, white concrete).', lowEffect: 'More bright pixels marked as white hardscape — more exclusion.', highEffect: 'Only the very brightest surfaces excluded — may miss white concrete.', recommendedRange: '162 – 205', impact: 'medium', visualCue: 'Lower = excludes light-colored roofs and bleached concrete.' },
    hardscapeGrow:          { shortDescription: 'Pixels to expand the hardscape mask outward. Fills gaps around roof edges and structural shadows.', lowEffect: 'Tight mask — less bleed into adjacent grass areas.', highEffect: 'Expands outward — catches shadows and fringe pixels around roofs and walls.', recommendedRange: '2 – 4', impact: 'medium', visualCue: 'Higher = cleaner separation at building edges.' },
    gsdCloseCap:            { shortDescription: 'Morphological close iterations — merges nearby lawn patches into unified polygons.', lowEffect: 'Patches stay fragmented — many small separate lawn blobs.', highEffect: 'Gaps between lawn areas filled — fewer, larger polygons result.', recommendedRange: '5 – 10', impact: 'medium', visualCue: 'Higher = smoother, more connected lawn shape output.' },
    maxComponentRatio:      { shortDescription: 'Largest single polygon may cover at most this fraction of the total parcel area.', lowEffect: 'Splits oversized blobs — reduces risk of one polygon claiming the whole yard.', highEffect: 'Allows large contiguous lawn areas — better for open yards and fields.', recommendedRange: '0.65 – 0.90', impact: 'low', visualCue: 'Lower = prevents single-blob over-detection in large parcels.' },
    maxComponents:          { shortDescription: 'Maximum number of separate lawn polygon blobs retained after detection.', lowEffect: 'Keeps only the largest/most significant patches — simpler output.', highEffect: 'Preserves more patches — good for complex yards with strips and corners.', recommendedRange: '4 – 8', impact: 'low', visualCue: 'Lower = simpler result. Higher = handles corner strips and side yards.' },
    softFallback:           { shortDescription: 'If strict detection finds nothing, retry with relaxed thresholds. Safety net for challenging imagery.', recommendedRange: 'On for suburban. Off for strict production.', impact: 'medium', visualCue: 'On = safety net when detection fails due to image quality or unusual grass tone.' },
    maxDetectedRatio:       { shortDescription: 'Detection is soft-rejected if mowable area exceeds this fraction of the total parcel.', lowEffect: 'Stricter — rejects large detections more aggressively.', highEffect: 'Allows detections covering most of the parcel — needed for open rural lots.', recommendedRange: '0.68 – 0.93', impact: 'high', visualCue: 'Lower = reduces false full-parcel detections on suburban lots.' },
    hardDetectedRatio:      { shortDescription: 'Absolute hard limit — detection is always clamped below this parcel fill fraction regardless of other settings.', lowEffect: 'Tighter hard cap — can clip legitimate large lawns.', highEffect: 'Allows almost full-parcel coverage — more permissive.', recommendedRange: '0.85 – 0.97', impact: 'high', visualCue: 'Keep above maxDetectedRatio. Set near 1.0 for rural parcels.' },
    strongExclusionRatio:   { shortDescription: 'Minimum hardscape exclusion ratio required to trust the detection result.', lowEffect: 'Accepts detections even when very little hardscape was excluded.', highEffect: 'Requires significant hardscape evidence — safer but may reject valid results.', recommendedRange: '0.02 – 0.06', impact: 'medium', visualCue: 'Raise if getting false positives on grass-only parcels without driveways.' },
    minComponentAreaSqft:   { shortDescription: 'Minimum size (sqft) for a lawn polygon to be retained. Smaller blobs are dropped as noise.', lowEffect: 'Keeps tiny fragments — more detail but noisier results.', highEffect: 'Drops small patches — cleaner output, may miss narrow strips.', recommendedRange: '80 – 150', impact: 'low', visualCue: 'Higher = drops side strips and noise. Lower = keeps corner patches.' },
    veg_ndviDrop:           { shortDescription: 'Subtracted from NDVI threshold for the strict pass. Higher = require greener pixels in first pass.', lowEffect: 'Strict pass uses near-raw threshold — less aggressive.', highEffect: 'Strict pass requires significantly greener pixels — fewer false positives.', recommendedRange: '0 – 0.05', impact: 'low', visualCue: 'Raise to tighten the first detection pass.' },
    veg_ndviSoftDrop:       { shortDescription: 'Subtracted from NDVI threshold for the soft fallback pass. Higher = stricter fallback.', lowEffect: 'Soft pass is nearly as permissive as the raw threshold.', highEffect: 'Soft pass requires notably greener pixels — reduces fallback false positives.', recommendedRange: '0.03 – 0.08', impact: 'low', visualCue: 'Raise to make the fallback detection pass stricter.' },
    veg_ndviQuantile:       { shortDescription: 'Quantile of the NDVI pixel distribution used to compute the adaptive threshold.', lowEffect: 'Adaptive threshold from the darker portion of distribution — more inclusive.', highEffect: 'Threshold from brighter pixels — more exclusive detection.', recommendedRange: '0.48 – 0.56', impact: 'medium', visualCue: 'Adjust when imagery has an unusual brightness distribution.' },
    veg_townLawnDrop:       { shortDescription: 'NDVI drop applied specifically in town-lawn mode (manicured suburban grass).', lowEffect: 'Town lawns use near-standard threshold.', highEffect: 'Town mode significantly stricter — reduces over-detection in dense suburban parcels.', recommendedRange: '0.03 – 0.06', impact: 'low', visualCue: 'Raise for tighter suburban lawn detection.' },
  };

  // ── Control group definitions ──────────────────────────────────────────────
  const CONTROL_GROUPS = [
    {
      id: 'vegetation', label: 'Vegetation Detection', icon: '🌿',
      description: 'How the AI identifies green pixels in aerial imagery. These settings directly control how much area is classified as mowable lawn.',
      controls: [
        { id: 'ndviSweep_mid', label: 'NDVI Threshold', path: null, special: 'ndviSweep_mid', min: 0.10, max: 0.60, step: 0.01, fmt: (v) => v.toFixed(2), hint: 'Middle value of the NDVI sweep (primary vegetation threshold)' },
        { id: 'veg_ndviCap', label: 'NDVI Cap', path: ['vegetation', 'ndviCap'], min: 0.10, max: 0.60, step: 0.01, fmt: (v) => v.toFixed(2), hint: 'Maximum NDVI value treated as lawn (higher = include woodsier pixels)' },
        { id: 'veg_excessGreenFloor', label: 'Excess Green Floor', path: ['vegetation', 'excessGreenFloor'], min: -5, max: 20, step: 0.5, fmt: (v) => v.toFixed(1), hint: '2G-R-B floor. Lower = include less-green pixels. Negative = very permissive.' },
        { id: 'veg_greenSlack', label: 'Green Slack', path: ['vegetation', 'greenSlack'], min: 0, max: 20, step: 0.5, fmt: (v) => v.toFixed(1), hint: 'Allowable difference before pixel is rejected as non-green' },
        { id: 'veg_saturationFloor', label: 'Saturation Floor', path: ['vegetation', 'saturationFloor'], min: 0, max: 20, step: 0.5, fmt: (v) => v.toFixed(1), hint: 'Minimum color saturation for vegetation pixels' },
        { id: 'veg_brightnessMax', label: 'Brightness Ceiling', path: ['vegetation', 'brightnessMax'], min: 150, max: 255, step: 1, fmt: (v) => v.toFixed(0), hint: 'Very bright pixels (>this) excluded from vegetation detection' },
      ],
    },
    {
      id: 'structure', label: 'Structure Detection', icon: '🏠',
      description: 'Rules for classifying hardscape — roofs, driveways, concrete, and shadows. These pixels are excluded from the mowable area estimate.',
      controls: [
        { id: 'hs_paleBrightnessMin', label: 'Pale Brightness Min', path: ['hardscapeRules', 'paleBrightnessMin'], min: 70, max: 200, step: 1, fmt: (v) => v.toFixed(0), hint: 'Brightness above this = possibly hardscape (concrete, shingles)' },
        { id: 'hs_paleSaturationMax', label: 'Pale Saturation Max', path: ['hardscapeRules', 'paleSaturationMax'], min: 20, max: 80, step: 1, fmt: (v) => v.toFixed(0), hint: 'Low saturation + high brightness = hardscape seed' },
        { id: 'hs_graySaturationMax', label: 'Gray Saturation Max', path: ['hardscapeRules', 'graySaturationMax'], min: 10, max: 60, step: 1, fmt: (v) => v.toFixed(0), hint: 'Gray-toned pixels with saturation below this = hardscape' },
        { id: 'hs_darkShadowMax', label: 'Dark Shadow Max', path: ['hardscapeRules', 'darkShadowBrightnessMax'], min: 15, max: 80, step: 1, fmt: (v) => v.toFixed(0), hint: 'Very dark pixels below this brightness = structural shadow' },
        { id: 'hs_whiteBrightnessMin', label: 'White Surface Min', path: ['hardscapeRules', 'whiteBrightnessMin'], min: 140, max: 235, step: 1, fmt: (v) => v.toFixed(0), hint: 'Very bright surfaces above this = white hardscape' },
        { id: 'hardscapeGrow', label: 'Hardscape Expand (px)', path: ['hardscapeGrow'], min: 0, max: 8, step: 1, fmt: (v) => v.toFixed(0), hint: 'Pixels to expand hardscape mask outward (covers roof edges/shadows)' },
      ],
    },
    {
      id: 'morphology', label: 'Morphology / Region', icon: '🔬',
      description: 'Post-processing that merges nearby lawn patches and limits polygon fragmentation. Affects the shape of output polygons, not raw pixel detection.',
      controls: [
        { id: 'gsdCloseCap', label: 'Gap Bridge Iterations', path: ['gsdCloseCap'], min: 0, max: 25, step: 1, fmt: (v) => v.toFixed(0), hint: 'Morphological close iterations to merge nearby lawn patches' },
        { id: 'maxComponentRatio', label: 'Max Component Ratio', path: ['maxComponentRatio'], min: 0.30, max: 1.0, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%', hint: 'Single component can be at most this fraction of the parcel' },
        { id: 'maxComponents', label: 'Max Components Kept', path: ['maxComponents'], min: 1, max: 20, step: 1, fmt: (v) => v.toFixed(0), hint: 'Maximum number of separate polygon blobs to keep' },
        { id: 'softFallback', label: 'Soft Fallback Mode', path: ['softFallback'], special: 'toggle', hint: 'Allow relaxed thresholds if strict mode finds nothing' },
      ],
    },
    {
      id: 'safety', label: 'Blob Safety Controls', icon: '🛡️',
      description: 'Guardrails that reject or clamp over-large detections. These prevent the AI from claiming the entire parcel as mowable when something goes wrong.',
      controls: [
        { id: 'maxDetectedRatio', label: 'Max Parcel Fill %', path: ['maxDetectedRatio'], min: 0.30, max: 1.0, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%', hint: 'Detection rejected if it covers more than this fraction of the parcel' },
        { id: 'hardDetectedRatio', label: 'Hard Fill Limit', path: ['hardDetectedRatio'], min: 0.50, max: 1.0, step: 0.01, fmt: (v) => (v * 100).toFixed(0) + '%', hint: 'Hard reject threshold — detection always clamped below this' },
        { id: 'strongExclusionRatio', label: 'Strong Exclusion Min', path: ['strongExclusionRatio'], min: 0, max: 0.20, step: 0.005, fmt: (v) => (v * 100).toFixed(1) + '%', hint: 'Minimum hardscape exclusion ratio required to trust result' },
        { id: 'minComponentAreaSqft', label: 'Min Blob Size (sqft)', path: ['minComponentAreaSqft'], min: 20, max: 500, step: 5, fmt: (v) => v.toFixed(0), hint: 'Polygon components smaller than this are dropped' },
      ],
    },
    {
      id: 'ndvi_tune', label: 'NDVI Fine-Tuning', icon: '📈',
      description: 'Advanced NDVI-specific calibrations. Touch these only if basic vegetation thresholds are insufficient to separate lawn from non-lawn in your imagery.',
      controls: [
        { id: 'veg_ndviDrop', label: 'NDVI Drop', path: ['vegetation', 'ndviDrop'], min: 0, max: 0.15, step: 0.005, fmt: (v) => v.toFixed(3), hint: 'Subtract from NDVI threshold for strict pass (higher = require greener pixels)' },
        { id: 'veg_ndviSoftDrop', label: 'NDVI Soft Drop', path: ['vegetation', 'ndviSoftDrop'], min: 0, max: 0.25, step: 0.005, fmt: (v) => v.toFixed(3), hint: 'Subtract from NDVI threshold for soft fallback pass' },
        { id: 'veg_ndviQuantile', label: 'NDVI Quantile', path: ['vegetation', 'ndviQuantile'], min: 0.30, max: 0.80, step: 0.01, fmt: (v) => v.toFixed(2), hint: 'Quantile of NDVI distribution used for adaptive threshold' },
        { id: 'veg_townLawnDrop', label: 'Town Lawn Drop', path: ['vegetation', 'townLawnDrop'], min: 0, max: 0.10, step: 0.005, fmt: (v) => v.toFixed(3), hint: 'NDVI drop applied for town-lawn detection mode' },
      ],
    },
  ];

  // ── Overlay layer config ───────────────────────────────────────────────────
  const OVERLAY_LAYERS = [
    { id: 'mowable',   label: 'AI Detection',    color: '#22c55e', opacity: 0.45, outlineColor: '#16a34a' },
    { id: 'parcel',    label: 'Parcel Boundary',  color: '#3b82f6', opacity: 0,    outlineColor: '#3b82f6', lineWidth: 2 },
    { id: 'prev',      label: 'Previous Run',     color: '#f97316', opacity: 0.30, outlineColor: '#ea580c' },
    { id: 'manual',    label: 'Manual Areas',     color: '#86efac', opacity: 0.35, outlineColor: '#4ade80', lineWidth: 2 },
    { id: 'test-area', label: 'Selected Test Area', color: '#f59e0b', opacity: 0.28, outlineColor: '#d97706', lineWidth: 2 },
  ];

  // ── Tooltip / popover system ───────────────────────────────────────────────
  let _tooltipEl = null;
  let _activeHelpCtrl = null;

  function createTooltipEl() {
    if (_tooltipEl) return;
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'ait-tooltip-pop';
    _tooltipEl.id = 'ait-tooltip';
    _tooltipEl.hidden = true;
    document.body.appendChild(_tooltipEl);
  }

  function openTooltip(btnEl, ctrlId) {
    if (!_tooltipEl) createTooltipEl();
    if (_activeHelpCtrl === ctrlId && !_tooltipEl.hidden) { closeTooltip(); return; }
    _activeHelpCtrl = ctrlId;
    const ctrl = CONTROL_GROUPS.flatMap((g) => g.controls).find((c) => c.id === ctrlId);
    const cm = CTRL_META[ctrlId] || {};
    const label = ctrl?.label || ctrlId;
    const rows = [];
    if (cm.shortDescription) rows.push(`<p class="ait-tt-text" style="margin:0 0 8px">${escapeHtml(cm.shortDescription)}</p>`);
    if (cm.lowEffect)  rows.push(`<div class="ait-tt-row"><span class="ait-tt-tag ait-tt-lo">Lower</span><span class="ait-tt-text">${escapeHtml(cm.lowEffect)}</span></div>`);
    if (cm.highEffect) rows.push(`<div class="ait-tt-row"><span class="ait-tt-tag ait-tt-hi">Higher</span><span class="ait-tt-text">${escapeHtml(cm.highEffect)}</span></div>`);
    if (cm.recommendedRange) rows.push(`<div class="ait-tt-row"><span class="ait-tt-tag ait-tt-rng">Range</span><span class="ait-tt-text">${escapeHtml(cm.recommendedRange)}</span></div>`);
    if (cm.visualCue)  rows.push(`<div class="ait-tt-row"><span class="ait-tt-tag ait-tt-cue">Visual</span><span class="ait-tt-text">${escapeHtml(cm.visualCue)}</span></div>`);
    if (!rows.length && ctrl?.hint) rows.push(`<p class="ait-tt-text" style="margin:0">${escapeHtml(ctrl.hint)}</p>`);
    _tooltipEl.innerHTML = `<p class="ait-tt-title">${escapeHtml(label)}</p>${rows.join('')}`;
    _tooltipEl.hidden = false;
    positionTooltip(btnEl);
  }

  function positionTooltip(btnEl) {
    if (!_tooltipEl || _tooltipEl.hidden) return;
    const rect = btnEl.getBoundingClientRect();
    const tipW = Math.min(260, window.innerWidth - 20);
    _tooltipEl.style.maxWidth = tipW + 'px';
    let left = rect.left - tipW - 8;
    if (left < 10) left = rect.right + 8;
    if (left + tipW > window.innerWidth - 10) left = Math.max(10, window.innerWidth - tipW - 10);
    let top = rect.top;
    const tipH = _tooltipEl.offsetHeight || 120;
    if (top + tipH > window.innerHeight - 10) top = Math.max(10, window.innerHeight - tipH - 10);
    _tooltipEl.style.left = left + 'px';
    _tooltipEl.style.top  = top + 'px';
  }

  function closeTooltip() {
    if (_tooltipEl) _tooltipEl.hidden = true;
    _activeHelpCtrl = null;
  }

  // ── Per-control reset ──────────────────────────────────────────────────────
  function resetControl(ctrlId) {
    const baseline = sessionBaseline[ctrlId];
    if (baseline === undefined) return;
    const ctrl = CONTROL_GROUPS.flatMap((g) => g.controls).find((c) => c.id === ctrlId);
    if (!ctrl) return;
    if (ctrl.special === 'toggle') {
      const chk = el(`ait-tog-${ctrlId}`);
      if (chk) chk.checked = !!baseline;
    } else {
      setControlValue(ctrlId, baseline);
    }
    updateControlHighlight(ctrlId);
    const anyDirty = CONTROL_GROUPS.flatMap((g) => g.controls).some((c) => checkControlModified(c.id));
    isDirty = anyDirty;
    updateSessionBanner();
    updateEffectSummary();
  }

  // ── Live detection bias summary ────────────────────────────────────────────
  function computeDetectionBias() {
    const tags = [];
    const base = BUILT_IN_DEFAULTS[activeBasePreset] || BUILT_IN_DEFAULTS.medium_residential;
    const ndvi = parseFloat(el('ait-ctrl-ndviSweep_mid')?.value);
    const baseNdvi = Array.isArray(base.ndviSweep) ? base.ndviSweep[1] : 0.30;
    if (!isNaN(ndvi)) {
      if (ndvi < baseNdvi - 0.04)      tags.push({ text: 'Aggressive vegetation detection', cls: 'veg' });
      else if (ndvi > baseNdvi + 0.04) tags.push({ text: 'Conservative vegetation detection', cls: 'veg' });
    }
    const exGreen = parseFloat(el('ait-ctrl-veg_excessGreenFloor')?.value);
    if (!isNaN(exGreen)) {
      if (exGreen < 0)    tags.push({ text: 'Very permissive greenness', cls: 'veg' });
      else if (exGreen > 10) tags.push({ text: 'Strict greenness filter', cls: 'veg' });
    }
    const hardGrow = parseFloat(el('ait-ctrl-hardscapeGrow')?.value);
    if (!isNaN(hardGrow)) {
      if (hardGrow >= 5)     tags.push({ text: 'Aggressive structure exclusion', cls: 'hard' });
      else if (hardGrow <= 1) tags.push({ text: 'Minimal structure buffering', cls: 'hard' });
    }
    const maxRatio = parseFloat(el('ait-ctrl-maxDetectedRatio')?.value);
    if (!isNaN(maxRatio)) {
      if (maxRatio > 0.85)    tags.push({ text: 'High over-detection tolerance', cls: 'safety' });
      else if (maxRatio < 0.55) tags.push({ text: 'Strict detection cap', cls: 'safety' });
    }
    const gsd = parseFloat(el('ait-ctrl-gsdCloseCap')?.value);
    if (!isNaN(gsd)) {
      if (gsd >= 12)    tags.push({ text: 'Heavy gap bridging', cls: 'morph' });
      else if (gsd <= 2) tags.push({ text: 'Minimal gap bridging', cls: 'morph' });
    }
    const maxComp = parseFloat(el('ait-ctrl-maxComponents')?.value);
    if (!isNaN(maxComp) && maxComp >= 10) tags.push({ text: 'Complex yard mode', cls: 'morph' });
    const softFb = el('ait-tog-softFallback')?.checked;
    if (softFb) tags.push({ text: 'Soft fallback on', cls: 'neutral' });
    const minBlob = parseFloat(el('ait-ctrl-minComponentAreaSqft')?.value);
    if (!isNaN(minBlob)) {
      if (minBlob <= 40)      tags.push({ text: 'Captures small strips', cls: 'morph' });
      else if (minBlob >= 300) tags.push({ text: 'Large patch minimum', cls: 'morph' });
    }
    if (tags.length === 0) tags.push({ text: 'Baseline settings', cls: 'neutral' });
    return tags;
  }

  function updateEffectSummary() {
    const panel = el('ait-effect-summary');
    if (!panel) return;
    const tags = computeDetectionBias();
    const tagsEl = panel.querySelector('.ait-effect-tags');
    if (tagsEl) tagsEl.innerHTML = tags.map((t) => `<span class="ait-effect-tag ait-etag-${t.cls}">${escapeHtml(t.text)}</span>`).join('');
  }

  // ── Async test-run wrapper (shows inline status) ───────────────────────────
  async function runTestCurrent() {
    const statusEl = el('ait-test-status');
    if (statusEl) { statusEl.textContent = 'Testing runtime settings…'; statusEl.className = 'ait-test-status is-testing'; }
    const ok = await runDetection();
    if (statusEl) {
      statusEl.textContent = ok ? 'Detection complete' : 'Detection failed';
      statusEl.className   = ok ? 'ait-test-status is-done' : 'ait-test-status is-failed';
    }
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function qs(sel, scope) { return (scope || document).querySelector(sel); }
  function el(id) { return document.getElementById(id); }

  // ── Settings fingerprint ───────────────────────────────────────────────────
  // Short 6-char hex derived from the current slider values.
  // Makes two similarly-named presets visually distinguishable at a glance.
  function computeSettingsFingerprint(overrides) {
    try {
      const sorted = JSON.stringify(overrides, Object.keys(overrides || {}).sort());
      let h = 5381;
      for (let i = 0; i < sorted.length; i++) h = ((h << 5) + h + sorted.charCodeAt(i)) >>> 0;
      return h.toString(16).padStart(8, '0').slice(-6);
    } catch { return 'xxxxxx'; }
  }

  // ── Preset name generation ─────────────────────────────────────────────────
  // Formats: "Label — medium_residential — May 09 11:42 AM"
  function formatLocalTimestamp() {
    const d = new Date();
    const mo = d.toLocaleString('en-US', { month: 'short' });
    const dy = d.getDate().toString().padStart(2, '0');
    const hr = d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${mo} ${dy} ${hr}`;
  }

  function generateDefaultPresetName() {
    const base = activeBasePreset.replace('_', ' ');
    const ts   = formatLocalTimestamp();
    if (currentParcelLabel) return `${currentParcelLabel} — ${base} — ${ts}`;
    return `Draft — ${base} — ${ts}`;
  }

  // Converts a human label into a URL-safe unique internal name.
  // Appends a compact timestamp suffix so two same-label saves never collide.
  function labelToUniqueName(label) {
    const d   = new Date();
    const ts  = `${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}-${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}`;
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'preset';
    return `${slug}-${ts}`;
  }

  // Find if a label is already used by any non-archived preset (case-insensitive).
  function findPresetByLabel(label) {
    const norm = label.trim().toLowerCase();
    return savedPresets.find((p) => (p.label || p.name).toLowerCase() === norm);
  }

  // Append "(2)", "(3)", ... to make a label unique.
  function makeUniqueLabelCopy(label) {
    let n = 2;
    let candidate = `${label} (${n})`;
    while (savedPresets.some((p) => (p.label || p.name).toLowerCase() === candidate.toLowerCase())) {
      n++;
      candidate = `${label} (${n})`;
    }
    return candidate;
  }

  // Format a stored ISO date for compact display.
  function fmtDate(iso) {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      const mo  = d.toLocaleString('en-US', { month: 'short' });
      const dy  = d.getDate();
      const hr  = d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      return `${mo} ${dy}, ${hr}`;
    } catch { return null; }
  }

  function getControlValue(ctrlId) {
    const inp = el(`ait-ctrl-${ctrlId}`);
    return inp ? parseFloat(inp.value) : null;
  }
  function setControlValue(ctrlId, value) {
    const slider = el(`ait-ctrl-${ctrlId}`);
    const numInp = el(`ait-num-${ctrlId}`);
    if (slider) slider.value = value;
    if (numInp) numInp.value = value;
    updateSliderLabel(ctrlId, value);
  }
  function updateSliderLabel(ctrlId, value) {
    const lbl = el(`ait-val-${ctrlId}`);
    if (!lbl) return;
    const group = CONTROL_GROUPS.flatMap((g) => g.controls).find((c) => c.id === ctrlId);
    lbl.textContent = group?.fmt ? group.fmt(parseFloat(value)) : String(value);
  }

  // ── Deep path read/write ───────────────────────────────────────────────────
  function getNestedValue(obj, path) {
    return path.reduce((cur, key) => (cur && cur[key] !== undefined ? cur[key] : undefined), obj);
  }
  function setNestedValue(obj, path, value) {
    const clone = JSON.parse(JSON.stringify(obj));
    let cursor = clone;
    for (let i = 0; i < path.length - 1; i++) {
      if (!cursor[path[i]]) cursor[path[i]] = {};
      cursor = cursor[path[i]];
    }
    cursor[path[path.length - 1]] = value;
    return clone;
  }

  // ── Collect current overrides from controls ────────────────────────────────
  function collectOverrides() {
    let overrides = {};
    for (const group of CONTROL_GROUPS) {
      for (const ctrl of group.controls) {
        if (ctrl.special === 'toggle') {
          const chk = el(`ait-tog-${ctrl.id}`);
          if (chk && ctrl.path) overrides = setNestedValue(overrides, ctrl.path, chk.checked);
          continue;
        }
        if (ctrl.special === 'ndviSweep_mid') {
          const v = parseFloat(el(`ait-ctrl-${ctrl.id}`)?.value ?? 0);
          if (!isNaN(v)) {
            const base = BUILT_IN_DEFAULTS[activeBasePreset]?.ndviSweep || [0.28, 0.30, 0.33];
            const delta = v - base[1];
            overrides.ndviSweep = [+(base[0] + delta).toFixed(3), v, +(base[2] + delta).toFixed(3)];
          }
          continue;
        }
        if (!ctrl.path) continue;
        const inp = el(`ait-ctrl-${ctrl.id}`);
        if (!inp) continue;
        const v = parseFloat(inp.value);
        if (!isNaN(v)) overrides = setNestedValue(overrides, ctrl.path, v);
      }
    }
    return overrides;
  }

  // ── Load preset values into controls (does NOT mark dirty) ─────────────────
  function applyPresetToControls(preset) {
    for (const group of CONTROL_GROUPS) {
      for (const ctrl of group.controls) {
        if (ctrl.special === 'toggle') {
          const chk = el(`ait-tog-${ctrl.id}`);
          if (chk && ctrl.path) chk.checked = !!getNestedValue(preset, ctrl.path);
          continue;
        }
        if (ctrl.special === 'ndviSweep_mid') {
          const sweep = preset.ndviSweep;
          if (Array.isArray(sweep) && sweep.length >= 2) setControlValue(ctrl.id, sweep[1]);
          continue;
        }
        if (!ctrl.path) continue;
        const v = getNestedValue(preset, ctrl.path);
        if (v !== undefined && v !== null) setControlValue(ctrl.id, v);
      }
    }
    updateEffectSummary();
  }

  // ── Dirty state tracking ───────────────────────────────────────────────────

  function captureBaseline() {
    sessionBaseline = {};
    for (const group of CONTROL_GROUPS) {
      for (const ctrl of group.controls) {
        if (ctrl.special === 'toggle') {
          const chk = el(`ait-tog-${ctrl.id}`);
          if (chk) sessionBaseline[ctrl.id] = chk.checked;
        } else {
          const inp = el(`ait-ctrl-${ctrl.id}`);
          if (inp) sessionBaseline[ctrl.id] = parseFloat(inp.value);
        }
      }
    }
  }

  function checkControlModified(ctrlId) {
    const ctrl = CONTROL_GROUPS.flatMap((g) => g.controls).find((c) => c.id === ctrlId);
    if (!ctrl) return false;
    const baseline = sessionBaseline[ctrlId];
    if (baseline === undefined) return false;
    if (ctrl.special === 'toggle') {
      const chk = el(`ait-tog-${ctrlId}`);
      return chk ? chk.checked !== baseline : false;
    }
    const inp = el(`ait-ctrl-${ctrlId}`);
    if (!inp) return false;
    return Math.abs(parseFloat(inp.value) - baseline) > 1e-6;
  }

  function updateControlHighlight(ctrlId) {
    const ctrl = CONTROL_GROUPS.flatMap((g) => g.controls).find((c) => c.id === ctrlId);
    if (!ctrl) return;
    const modified = checkControlModified(ctrlId);
    const inputId = ctrl.special === 'toggle' ? `ait-tog-${ctrlId}` : `ait-ctrl-${ctrlId}`;
    const rowEl = el(inputId)?.closest('.ait-ctrl-row');
    if (rowEl) rowEl.classList.toggle('ait-ctrl-modified', modified);
  }

  function markDirty(changedCtrlId) {
    isDirty = true;
    if (changedCtrlId) updateControlHighlight(changedCtrlId);
    updateSessionBanner();
    updateEffectSummary();
  }

  function clearDirty() {
    isDirty = false;
    document.querySelectorAll('.ait-ctrl-row.ait-ctrl-modified').forEach((r) => r.classList.remove('ait-ctrl-modified'));
    updateSessionBanner();
  }

  // ── Session banner ─────────────────────────────────────────────────────────

  const STATUS_LABELS = { draft: 'Draft', validated: 'Validated', production: 'Production', archived: 'Archived' };

  function presetStatus(p) {
    return p?.status || (p?.isProduction ? 'production' : 'draft');
  }

  function updateSessionBanner() {
    const banner       = el('ait-session-banner');
    const dirtyBadge   = el('ait-session-dirty-badge');
    const presetLabel  = el('ait-session-preset-label');
    const validateBtn  = el('ait-mark-validated-btn');
    const promoteBtn   = el('ait-promote-btn');

    if (banner) {
      banner.classList.toggle('ait-session-dirty', isDirty);
      banner.classList.toggle('ait-session-clean', !isDirty);
    }
    if (dirtyBadge) dirtyBadge.hidden = !isDirty;

    if (presetLabel) {
      if (loadedPreset) {
        const s = presetStatus(loadedPreset);
        presetLabel.innerHTML = `<strong>${escapeHtml(loadedPreset.label || loadedPreset.name)}</strong>&nbsp;<span class="ait-badge ait-badge-${s}">${escapeHtml(STATUS_LABELS[s] || s)}</span>`;
      } else {
        presetLabel.textContent = 'Built-in defaults — no preset loaded';
      }
    }

    if (validateBtn) {
      const canValidate = !!(loadedPreset && presetStatus(loadedPreset) === 'draft' && !isDirty);
      validateBtn.disabled = !canValidate;
      validateBtn.title = !loadedPreset ? 'Load a draft preset first'
        : isDirty ? 'Save changes before marking validated'
        : presetStatus(loadedPreset) !== 'draft' ? 'Only draft presets can be marked validated'
        : 'Mark this draft preset as validated and ready for promotion';
    }

    if (promoteBtn) {
      const s = loadedPreset ? presetStatus(loadedPreset) : null;
      const canPromote = !!(loadedPreset && s !== 'production' && s !== 'archived' && !isDirty);
      promoteBtn.disabled = !canPromote;
      promoteBtn.title = !loadedPreset ? 'Load a preset first'
        : isDirty ? 'Save changes before promoting'
        : s === 'production' ? 'Already the active production preset'
        : s === 'archived' ? 'Cannot promote an archived preset'
        : 'Promote this preset to production (affects live detection)';
    }
  }

  // ── Map initialization ─────────────────────────────────────────────────────
  function initMap() {
    if (map) return;
    const container = el('ait-map');
    if (!container || typeof maplibregl === 'undefined') return;

    map = new maplibregl.Map({
      container: 'ait-map',
      style: {
        version: 8,
        sources: {
          satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: '© Esri, Maxar',
          },
        },
        layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
      },
      center: [-94.17, 36.37],
      zoom: 14,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    map.on('load', () => {
      mapReady = true;
      OVERLAY_LAYERS.forEach((layer) => addMapLayer(layer));
      // Lasso temp line — line-only source (no fill), used for live draw preview
      map.addSource('ait-src-lasso-temp', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'ait-line-lasso-temp', type: 'line', source: 'ait-src-lasso-temp',
        paint: { 'line-color': '#60a5fa', 'line-width': 2, 'line-dasharray': [4, 2] } });
      renderParcelLayer();
      setupAdminBridge();
    });
  }

  function addMapLayer(layerDef) {
    if (!map || !mapReady) return;
    const srcId  = `ait-src-${layerDef.id}`;
    const fillId = `ait-fill-${layerDef.id}`;
    const lineId = `ait-line-${layerDef.id}`;
    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(fillId) && layerDef.opacity > 0) {
      map.addLayer({ id: fillId, type: 'fill', source: srcId, paint: { 'fill-color': layerDef.color, 'fill-opacity': layerDef.opacity } });
    }
    if (!map.getLayer(lineId)) {
      map.addLayer({ id: lineId, type: 'line', source: srcId, paint: { 'line-color': layerDef.outlineColor, 'line-width': layerDef.lineWidth || 2 } });
    }
  }

  function setLayerData(layerId, geojson) {
    if (!map || !mapReady) return;
    const src = map.getSource(`ait-src-${layerId}`);
    if (!src) return;
    let safe = geojson;
    if (safe && typeof safe === 'object') {
      if (safe.type === 'Feature') {
        safe = { type: 'FeatureCollection', features: [safe] };
      } else if (safe.type !== 'FeatureCollection') {
        console.warn('[AI Tuning] setLayerData: invalid GeoJSON type', safe.type, '— skipping setData');
        return;
      }
    } else {
      safe = { type: 'FeatureCollection', features: [] };
    }
    src.setData(safe);
  }

  function setLayerVisible(layerId, visible) {
    if (!map || !mapReady) return;
    const vis = visible ? 'visible' : 'none';
    [`ait-fill-${layerId}`, `ait-line-${layerId}`].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  }

  function renderParcelLayer() {
    if (!currentParcelGeoJson) return;
    // Normalize defensively in case currentParcelGeoJson was set from a legacy path
    const fc = isValidParcelFeatureCollection(currentParcelGeoJson)
      ? currentParcelGeoJson
      : normalizeParcelGeoJson(currentParcelGeoJson);
    if (!isValidParcelFeatureCollection(fc)) return;
    setLayerData('parcel', fc);
  }

  function fitToParcel() {
    if (!map) return;
    const bounds = currentParcelBounds || getGeoJsonBounds(currentParcelGeoJson);
    if (!bounds) return;
    try { map.fitBounds(bounds, { padding: 60, maxZoom: 20, duration: 600 }); } catch (_) {}
  }

  // ── Result rendering ───────────────────────────────────────────────────────
  function renderResult(result, layerId = 'mowable') {
    if (!result) return setLayerData(layerId, { type: 'FeatureCollection', features: [] });
    const fc = result.featureCollection || { type: 'FeatureCollection', features: result.features || [] };
    setLayerData(layerId, fc);
  }

  function computeParcelBounds(geojson) {
    const coords = [];
    function walk(obj) {
      if (!obj) return;
      if (Array.isArray(obj) && obj.length === 2 && typeof obj[0] === 'number') { coords.push(obj); return; }
      if (Array.isArray(obj)) { obj.forEach(walk); return; }
      if (obj.coordinates) walk(obj.coordinates);
      if (obj.geometry) walk(obj.geometry);
      if (obj.geometries) obj.geometries.forEach(walk);
      if (obj.features) obj.features.forEach(walk);
    }
    walk(geojson);
    if (!coords.length) return null;
    const lngs = coords.map((c) => c[0]);
    const lats  = coords.map((c) => c[1]);
    return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
  }

  // ── Esri → GeoJSON conversion helpers ────────────────────────────────────
  // The /api/parcel/lookup endpoint returns Esri JSON (f=json) with rings-based
  // geometry instead of GeoJSON coordinates. With outSR=4326 added server-side,
  // coordinates are in WGS84 degrees, but the format is still Esri (rings, no type).

  function esriRingsToPolygon(geometry) {
    const rings = geometry?.rings;
    if (!Array.isArray(rings) || !rings.length) return null;
    const coordinates = rings.map((ring) => {
      if (!Array.isArray(ring) || ring.length < 3) return null;
      const pts = ring.map((pt) => [Number(pt[0]), Number(pt[1])]);
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
      return pts.length >= 4 ? pts : null;
    }).filter(Boolean);
    return coordinates.length ? { type: 'Polygon', coordinates } : null;
  }

  function normalizeParcelGeoJson(input) {
    if (!input || typeof input !== 'object') return null;

    function extractGeometry(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.type === 'Polygon' || obj.type === 'MultiPolygon') return obj;
      if (Array.isArray(obj.rings)) return esriRingsToPolygon(obj);
      if (obj.type === 'Feature') return extractGeometry(obj.geometry);
      if (obj.type === 'FeatureCollection') {
        for (const f of (obj.features || [])) {
          const g = extractGeometry(f);
          if (g) return g;
        }
        return null;
      }
      for (const key of ['geojson', 'geoJson', 'geometry', 'parcelGeoJson', 'parcel_geojson', 'boundary', 'feature']) {
        if (obj[key] && typeof obj[key] === 'object') {
          const g = extractGeometry(obj[key]);
          if (g) return g;
        }
      }
      if (obj.parcel?.geometry) { const g = extractGeometry(obj.parcel.geometry); if (g) return g; }
      if (obj.properties?.geometry) { const g = extractGeometry(obj.properties.geometry); if (g) return g; }
      return null;
    }

    function extractProperties(obj) {
      return { ...(obj?.properties || {}), ...(obj?.attributes || {}) };
    }

    if (input.type === 'FeatureCollection') {
      const features = (input.features || []).map((f) => {
        const geom = extractGeometry(f);
        return geom ? { type: 'Feature', properties: extractProperties(f), geometry: geom } : null;
      }).filter(Boolean);
      return features.length ? { type: 'FeatureCollection', features } : null;
    }

    const geometry = extractGeometry(input);
    if (!geometry) return null;
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: extractProperties(input), geometry }] };
  }

  function isValidParcelFeatureCollection(fc) {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features) || !fc.features.length) return false;
    return fc.features.every((f) => {
      const g = f?.geometry;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return false;
      if (!Array.isArray(g.coordinates) || !g.coordinates.length) return false;
      const firstRing = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0];
      return Array.isArray(firstRing) && firstRing.length >= 4;
    });
  }

  function getGeoJsonBounds(geojson) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    function visitCoord(c) {
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    function walkGeom(g) {
      if (!g || !Array.isArray(g.coordinates)) return;
      if (g.type === 'Polygon') g.coordinates.forEach((ring) => ring.forEach(visitCoord));
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(visitCoord)));
    }
    (geojson?.features || []).forEach((f) => walkGeom(f?.geometry));
    return Number.isFinite(minLng) ? [[minLng, minLat], [maxLng, maxLat]] : null;
  }

  // ── Diagnostics rendering ──────────────────────────────────────────────────
  function pct(v) { return v != null ? (v * 100).toFixed(1) + '%' : '—'; }
  function num(v, d = 0) { return v != null ? Number(v).toFixed(d) : '—'; }

  function renderDiagnostics(result) {
    const panel = el('ait-diagnostics');
    if (!panel) return;
    if (!result) { panel.innerHTML = '<p class="ait-muted">Run detection to see diagnostics.</p>'; return; }

    const d = result.diagnostic || result.diagnostics || {};
    const elapsed = result._elapsedMs;
    const detRatio  = d.detectedRatio;
    const hardRatio = d.hardscapeExcludedRatio;
    const polyCount = d.keptComponentCount ?? d.polygonCount;
    const confScore = result.confidenceScore;
    const confLabel = result.confidence || '—';

    // Warnings
    const warnings = [];
    if (detRatio > 0.80) warnings.push({ level: 'danger',  msg: 'Over-detection risk — mowable covers ' + pct(detRatio) + ' of parcel' });
    if (detRatio < 0.03 && !result.features?.length) warnings.push({ level: 'warning', msg: 'Under-detection — no mowable area found' });
    if (hardRatio != null && hardRatio < 0.02 && detRatio > 0.5) warnings.push({ level: 'warning', msg: 'Low hardscape ratio — structure exclusion may be under-performing' });
    if ((polyCount || 0) > 8) warnings.push({ level: 'info', msg: 'High polygon count (' + polyCount + ') — possible fragmentation' });
    if (d.failureStage === 'full_parcel_match') warnings.push({ level: 'danger', msg: 'Full-parcel match rejected — detection claimed the entire parcel boundary' });
    if (d.fallbackSoftMaskUsed) warnings.push({ level: 'info', msg: 'Soft fallback was triggered — strict pass found nothing' });

    // Confidence badge color
    const confCls = confScore >= 0.75 ? 'ait-val-ok' : confScore >= 0.5 ? '' : 'ait-val-warning';

    const warnHtml = warnings.map((w) => `<span class="ait-warn ait-warn-${w.level}">${escapeHtml(w.msg)}</span>`).join('');

    panel.innerHTML = `
      ${warnHtml ? `<div class="ait-warn-row">${warnHtml}</div>` : ''}
      <div class="ait-diag-summary-row">
        <div class="ait-diag-pill">
          <span class="ait-stat-label">Preset</span>
          <strong>${escapeHtml(result.detectionPreset || d.detectionPreset || activeBasePreset || '—')}${isDirty ? ' <span class="ait-badge ait-badge-draft" style="font-size:.60rem">runtime override</span>' : ''}</strong>
        </div>
        <div class="ait-diag-pill">
          <span class="ait-stat-label">Mode</span>
          <strong>${escapeHtml(d.detectionMode || d.detection_mode || result.mode || '—')}</strong>
        </div>
        <div class="ait-diag-pill">
          <span class="ait-stat-label">Confidence</span>
          <strong class="${confCls}">${escapeHtml(confLabel)}${confScore != null ? ' (' + Number(confScore).toFixed(2) + ')' : ''}</strong>
        </div>
        ${elapsed != null ? `<div class="ait-diag-pill"><span class="ait-stat-label">Time</span><strong>${elapsed} ms</strong></div>` : ''}
      </div>
      <div class="ait-stat-grid" style="margin-top:8px">
        <div class="ait-stat"><span class="ait-stat-label">Mowable Area</span><span class="ait-stat-val">${num(result.areaSqft, 0)} sqft</span></div>
        <div class="ait-stat"><span class="ait-stat-label">Parcel Area</span><span class="ait-stat-val">${num(d.parcelAreaSqft, 0)} sqft</span></div>
        <div class="ait-stat"><span class="ait-stat-label">Detected Ratio</span><span class="ait-stat-val ${detRatio > 0.80 ? 'ait-val-danger' : ''}">${pct(detRatio)}</span></div>
        <div class="ait-stat"><span class="ait-stat-label">Hardscape Excl.</span><span class="ait-stat-val ${hardRatio != null && hardRatio < 0.02 ? 'ait-val-warning' : ''}">${pct(hardRatio)}</span></div>
        <div class="ait-stat"><span class="ait-stat-label">Structure Excl.</span><span class="ait-stat-val">${num(d.structureExcludedAreaSqft, 0)} sqft</span></div>
        <div class="ait-stat"><span class="ait-stat-label">Polygons Kept</span><span class="ait-stat-val">${polyCount ?? '—'}</span></div>
        <div class="ait-stat"><span class="ait-stat-label">Blobs Rejected</span><span class="ait-stat-val">${d.rejectedSmallComponents ?? '—'}</span></div>
        <div class="ait-stat"><span class="ait-stat-label">NDVI Threshold</span><span class="ait-stat-val">${num(d.ndviThreshold, 3)}</span></div>
        <div class="ait-stat"><span class="ait-stat-label">NIR Available</span><span class="ait-stat-val">${d.usedNir ? 'yes' : 'no'}</span></div>
        <div class="ait-stat"><span class="ait-stat-label">Image Size</span><span class="ait-stat-val">${d.rasterWidth || d.actualImageWidth || '?'}×${d.rasterHeight || d.actualImageHeight || '?'}</span></div>
        <div class="ait-stat"><span class="ait-stat-label">Accept Reason</span><span class="ait-stat-val">${escapeHtml(d.finalAcceptReason || result.reason || '—')}</span></div>
      </div>
      ${d.naipNirWarning ? `<p class="ait-muted" style="margin-top:6px">&#9888; ${escapeHtml(d.naipNirWarning)}</p>` : ''}
    `;
  }

  // ── Detection run — ephemeral runtime overrides ONLY ──────────────────────
  // Does NOT save, does NOT touch presets, does NOT affect production.
  async function runDetection() {
    if (isRunning) return;
    if (!currentParcelGeoJson) {
      showToast('Load a parcel before running detection.', 'error');
      return;
    }

    isRunning = true;
    const runBtn = el('ait-run-btn');
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Running…'; }

    // Always use ephemeral tuningOverrides — never write back to any preset
    const overrides = collectOverrides();

    const usingSelectedTestArea = Boolean(activeTestAreaGeoJson);
    const detectionGeoJson = activeTestAreaGeoJson || originalParcelGeoJson || currentParcelGeoJson;
    const parcelForContext  = originalParcelGeoJson || currentParcelGeoJson;

    const selectedAreaSqft = (usingSelectedTestArea && window.turf)
      ? (() => { try { return Math.round(turf.area(activeTestAreaGeoJson) * 10.7639); } catch { return null; } })()
      : null;
    const originalParcelSqft = (parcelForContext && window.turf)
      ? (() => { try { return Math.round(turf.area(parcelForContext) * 10.7639); } catch { return null; } })()
      : null;

    console.log('[AI Tuning] detection geometry', {
      usingSelectedTestArea,
      selectedAreaSqft,
      originalParcelSqft,
    });

    const payload = {
      parcelGeoJson: detectionGeoJson,
      originalParcelGeoJson: parcelForContext,
      detectionPreset: activeBasePreset,
      detection_preset: activeBasePreset,
      debugArtifacts: false,
      tuningOverrides: overrides,  // server injects as _tuning_override, discarded after run
      meta: {
        source: 'admin-ai-tuning',
        usingSelectedTestArea,
        originalParcelIncluded: true,
      },
    };

    try {
      const data = await api('/api/admin/ai-tuning/detect', { method: 'POST', body: JSON.stringify(payload) });
      if (currentResult) previousResult = currentResult;
      currentResult = data;
      renderResult(data, 'mowable');
      if (previousResult && compareMode) renderResult(previousResult, 'prev');
      renderDiagnostics(data);
      updateComparePanel();
      showToast('Detection complete — ' + (data.areaSqft || 0).toFixed(0) + ' sqft mowable', 'success');
      window.dispatchEvent(new CustomEvent('ait:detection-complete', { detail: data }));
      return true;
    } catch (err) {
      showToast('Detection failed: ' + (err.message || 'unknown error'), 'error');
      renderDiagnostics(null);
      return false;
    } finally {
      isRunning = false;
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Run Detection'; }
    }
  }

  function updateComparePanel() {
    const cmpBtn = el('ait-compare-btn');
    if (!cmpBtn) return;
    cmpBtn.disabled = !previousResult;
    cmpBtn.textContent = compareMode ? 'Hide Previous' : 'Compare Previous';
  }

  function toggleCompare() {
    compareMode = !compareMode;
    if (compareMode && previousResult) {
      renderResult(previousResult, 'prev');
      setLayerVisible('prev', true);
    } else {
      setLayerData('prev', { type: 'FeatureCollection', features: [] });
      setLayerVisible('prev', false);
    }
    updateComparePanel();
  }

  // ── Preset management ──────────────────────────────────────────────────────
  async function loadSavedPresets() {
    try {
      const data = await api('/api/admin/ai-tuning/presets');
      savedPresets = data.presets || [];
      window._aitSavedPresetsRef = savedPresets;
      renderPresetList();
    } catch (_) {}
  }

  function loadPreset(preset) {
    if (!preset || !preset.thresholds) return;
    activeBasePreset = preset.basePreset || 'medium_residential';
    const base   = BUILT_IN_DEFAULTS[activeBasePreset] || BUILT_IN_DEFAULTS.medium_residential;
    const merged = deepMergeJs(base, preset.thresholds);
    applyPresetToControls(merged);
    const sel = el('ait-base-preset-select');
    if (sel) sel.value = activeBasePreset;
    loadedPreset = { ...preset };  // snapshot — sliders may diverge from here
    captureBaseline();
    clearDirty();
    updateSessionBanner();
    showToast('Loaded: ' + (preset.label || preset.name), 'success');
  }

  async function deletePreset(name) {
    const target = savedPresets.find((p) => p.name === name);
    if (target && (target.status === 'production' || target.isProduction)) {
      showToast('Cannot delete a production preset. Archive it first.', 'error');
      return;
    }
    if (!confirm('Delete preset "' + name + '"?')) return;
    try {
      await api('/api/admin/ai-tuning/presets/' + encodeURIComponent(name), { method: 'DELETE' });
      if (loadedPreset?.name === name) {
        loadedPreset = null;
        clearDirty();
        updateSessionBanner();
      }
      await loadSavedPresets();
    } catch (err) {
      showToast('Delete failed: ' + (err.message || ''), 'error');
    }
  }

  function deepMergeJs(base, overrides) {
    const result = JSON.parse(JSON.stringify(base));
    for (const [k, v] of Object.entries(overrides || {})) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object' && !Array.isArray(result[k])) {
        result[k] = deepMergeJs(result[k], v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  // ── Preset rename ──────────────────────────────────────────────────────────
  async function renamePreset(name) {
    const preset = savedPresets.find((p) => p.name === name);
    if (!preset) return;
    const currentLabel = preset.label || preset.name;
    const newLabel = prompt('Rename preset — enter new display name:', currentLabel);
    if (!newLabel || !newLabel.trim() || newLabel.trim() === currentLabel) return;
    // Check for label collision
    const collision = findPresetByLabel(newLabel.trim());
    if (collision && collision.name !== name) {
      if (!confirm(`Another preset is already named "${collision.label || collision.name}". Rename anyway?`)) return;
    }
    try {
      const notes = prompt('Update notes (leave blank to keep current):', preset.notes || preset.description || '');
      const data = await api('/api/admin/ai-tuning/presets/' + encodeURIComponent(name) + '/label', {
        method: 'PATCH',
        body: JSON.stringify({ label: newLabel.trim(), notes: notes !== null ? notes : undefined }),
      });
      if (loadedPreset?.name === name) loadedPreset = data.preset;
      await loadSavedPresets();
      updateSessionBanner();
      showToast('Renamed to: ' + newLabel.trim(), 'success');
    } catch (err) {
      showToast('Rename failed: ' + (err.message || ''), 'error');
    }
  }

  // ── Preset duplicate ───────────────────────────────────────────────────────
  async function duplicatePreset(name) {
    try {
      const data = await api('/api/admin/ai-tuning/presets/' + encodeURIComponent(name) + '/duplicate', { method: 'POST' });
      await loadSavedPresets();
      showToast('Duplicated as draft: ' + (data.preset?.label || data.preset?.name), 'success');
    } catch (err) {
      showToast('Duplicate failed: ' + (err.message || ''), 'error');
    }
  }

  // ── Preset list rendering — rich cards ─────────────────────────────────────
  const STATUS_BADGE_HTML = {
    draft:      '<span class="ait-badge ait-badge-draft">Draft</span>',
    validated:  '<span class="ait-badge ait-badge-validated">Validated</span>',
    production: '<span class="ait-badge ait-badge-prod">Production</span>',
    archived:   '<span class="ait-badge ait-badge-archived">Archived</span>',
  };

  function renderPresetList() {
    const container = el('ait-preset-list');
    if (!container) return;

    const active   = savedPresets.filter((p) => presetStatus(p) !== 'archived');
    const archived = savedPresets.filter((p) => presetStatus(p) === 'archived');

    if (!active.length && !archived.length) {
      container.innerHTML = '<p class="ait-muted" style="margin:4px 0 8px">No saved presets yet.</p>';
      return;
    }

    function itemHtml(p) {
      const s         = presetStatus(p);
      const badge     = STATUS_BADGE_HTML[s] || STATUS_BADGE_HTML.draft;
      const isProd    = s === 'production';
      const isArch    = s === 'archived';
      const isLoaded  = loadedPreset?.name === p.name;

      // Metadata sub-row — graceful fallback for legacy presets without new fields
      const savedTime   = fmtDate(p.updatedAt || p.savedAt);
      const fp          = p.settingsFingerprint ? `<span class="ait-preset-fp" title="Settings fingerprint">Config: ${escapeHtml(p.settingsFingerprint)}</span>` : '';
      const parcelInfo  = p.parcelLabel || p.parcelAddress
        ? `<span class="ait-preset-parcel" title="Parcel used when saved">📍 ${escapeHtml(p.parcelLabel || p.parcelAddress)}</span>`
        : '';
      const confInfo    = p.confidenceScore != null
        ? `<span class="ait-preset-conf">Conf: ${Number(p.confidenceScore).toFixed(2)}</span>`
        : '';
      const notesInfo   = (p.notes || p.description)
        ? `<div class="ait-preset-notes" title="${escapeHtml(p.notes || p.description)}">${escapeHtml((p.notes || p.description).slice(0, 80))}${(p.notes || p.description).length > 80 ? '…' : ''}</div>`
        : '';
      const isLegacy    = !p.updatedAt && !p.settingsFingerprint && !p.parcelLabel;
      const legacyTag   = isLegacy
        ? '<span class="ait-preset-legacy" title="Saved before metadata tracking was added">Legacy</span>'
        : '';
      const timeRow     = savedTime
        ? `<span class="ait-preset-time" title="Last saved">${savedTime}</span>`
        : (isLegacy ? '<span class="ait-muted" style="font-size:.66rem">metadata unavailable</span>' : '');
      const metaChips   = [timeRow, fp, parcelInfo, confInfo].filter(Boolean).join('');

      // Action buttons
      const loadLabel = isLoaded ? '★ Loaded' : 'Load';
      const btns = [`<button class="btn secondary xsmall ait-load-preset" data-name="${escapeHtml(p.name)}">${loadLabel}</button>`];
      if (!isProd && !isArch) {
        btns.push(`<button class="btn secondary xsmall ait-rename-preset" data-name="${escapeHtml(p.name)}" title="Rename display name">Rename</button>`);
        btns.push(`<button class="btn secondary xsmall ait-dup-preset" data-name="${escapeHtml(p.name)}" title="Duplicate as new draft">Dup</button>`);
        btns.push(`<button class="btn secondary xsmall ait-archive-btn" data-name="${escapeHtml(p.name)}">Archive</button>`);
        btns.push(`<button class="btn danger xsmall ait-del-preset" data-name="${escapeHtml(p.name)}">Delete</button>`);
      } else if (isArch) {
        btns.push(`<button class="btn secondary xsmall ait-dup-preset" data-name="${escapeHtml(p.name)}" title="Duplicate archived preset as new draft">Dup</button>`);
        btns.push(`<button class="btn danger xsmall ait-del-preset" data-name="${escapeHtml(p.name)}">Delete</button>`);
      } else if (isProd) {
        btns.push(`<button class="btn secondary xsmall ait-rename-preset" data-name="${escapeHtml(p.name)}" title="Rename display name">Rename</button>`);
        btns.push(`<button class="btn secondary xsmall ait-dup-preset" data-name="${escapeHtml(p.name)}" title="Duplicate as new draft">Dup</button>`);
      }

      return `
        <div class="ait-preset-card${isProd ? ' ait-preset-item-prod' : ''}${isLoaded ? ' ait-preset-item-loaded' : ''}${isArch ? ' ait-preset-card-archived' : ''}">
          <div class="ait-preset-card-head">
            <div class="ait-preset-card-title">
              ${badge}${legacyTag}
              <span class="ait-preset-item-name">${escapeHtml(p.label || p.name)}</span>
              <span class="ait-preset-base-tag">${escapeHtml(p.basePreset || 'medium_residential')}</span>
            </div>
            <div class="ait-preset-item-actions">${btns.join('')}</div>
          </div>
          ${metaChips ? `<div class="ait-preset-meta-row">${metaChips}</div>` : ''}
          ${notesInfo}
        </div>`;
    }

    let html = active.map(itemHtml).join('');
    if (archived.length) {
      html += `<details class="ait-archived-section"><summary class="ait-muted ait-archived-toggle">Archived (${archived.length})</summary>${archived.map(itemHtml).join('')}</details>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.ait-load-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = savedPresets.find((x) => x.name === btn.dataset.name);
        if (p) loadPreset(p);
      });
    });
    container.querySelectorAll('.ait-del-preset').forEach((btn) => {
      btn.addEventListener('click', () => deletePreset(btn.dataset.name));
    });
    container.querySelectorAll('.ait-archive-btn').forEach((btn) => {
      btn.addEventListener('click', () => archivePreset(btn.dataset.name));
    });
    container.querySelectorAll('.ait-rename-preset').forEach((btn) => {
      btn.addEventListener('click', () => renamePreset(btn.dataset.name));
    });
    container.querySelectorAll('.ait-dup-preset').forEach((btn) => {
      btn.addEventListener('click', () => duplicatePreset(btn.dataset.name));
    });
  }

  // ── Workflow: Reset Changes ────────────────────────────────────────────────
  function resetChanges() {
    if (loadedPreset) {
      // Restore to the last loaded preset — discard unsaved slider edits
      const base   = BUILT_IN_DEFAULTS[loadedPreset.basePreset || 'medium_residential'] || BUILT_IN_DEFAULTS.medium_residential;
      const merged = deepMergeJs(base, loadedPreset.thresholds);
      applyPresetToControls(merged);
      captureBaseline();
      clearDirty();
      showToast('Reset to: ' + (loadedPreset.label || loadedPreset.name), 'success');
    } else {
      const preset = BUILT_IN_DEFAULTS[activeBasePreset] || BUILT_IN_DEFAULTS.medium_residential;
      applyPresetToControls(preset);
      captureBaseline();
      clearDirty();
      showToast('Reset to built-in: ' + activeBasePreset, 'success');
    }
  }

  // ── Workflow: Save as Draft ────────────────────────────────────────────────
  function openSaveDraftModal() {
    const modal = el('ait-save-draft-modal');
    if (!modal) return;

    const nameInput = el('ait-draft-name-input');
    // If re-saving an already-loaded draft: pre-fill with its current label
    // If saving a new preset: auto-suggest a descriptive default name
    if (nameInput) {
      if (loadedPreset && presetStatus(loadedPreset) === 'draft') {
        nameInput.value = loadedPreset.label || loadedPreset.name;
      } else if (!nameInput.value.trim()) {
        nameInput.value = generateDefaultPresetName();
      }
    }

    // Show parcel context row in modal
    const parcelRow = el('ait-draft-parcel-display');
    if (parcelRow) {
      parcelRow.textContent = currentParcelLabel
        ? (currentParcelAddress || currentParcelLabel)
        : 'No parcel loaded';
      parcelRow.style.color = currentParcelLabel ? '' : 'var(--text-muted,#888)';
    }

    // Clear error + duplicate warning
    const errEl = el('ait-draft-error');
    if (errEl) errEl.textContent = '';
    const dupEl = el('ait-draft-dup-warning');
    if (dupEl) dupEl.hidden = true;

    // Reset duplicate-resolution state
    modal.dataset.dupAction = '';

    modal.hidden = false;
    nameInput?.focus();
    nameInput?.select();
  }

  function closeSaveDraftModal() {
    const modal = el('ait-save-draft-modal');
    if (modal) modal.hidden = true;
  }

  // Called from the duplicate-warning buttons in the modal
  function saveDraftWithAction(action) {
    const modal = el('ait-save-draft-modal');
    if (modal) modal.dataset.dupAction = action;
    confirmSaveDraft();
  }

  async function confirmSaveDraft() {
    const modal    = el('ait-save-draft-modal');
    const nameInput = el('ait-draft-name-input');
    const label    = nameInput?.value?.trim();
    const errEl    = el('ait-draft-error');
    const dupEl    = el('ait-draft-dup-warning');

    if (!label) {
      if (errEl) errEl.textContent = 'A name is required.';
      nameInput?.focus();
      return;
    }
    if (errEl) errEl.textContent = '';

    const overrides   = collectOverrides();
    const fingerprint = computeSettingsFingerprint(overrides);
    const notes       = el('ait-draft-notes-input')?.value?.trim() || '';
    const dupAction   = modal?.dataset.dupAction || '';

    // ── Determine internal `name` key ──────────────────────────────────────
    // Case 1: updating the currently loaded draft → keep its name key
    let internalName;
    let saveLabel = label;
    const isResavingLoaded = loadedPreset && presetStatus(loadedPreset) === 'draft' && loadedPreset.label === label;

    if (isResavingLoaded && dupAction !== 'copy') {
      internalName = loadedPreset.name;
    } else {
      // Check for duplicate label among saved presets (excluding the loaded one)
      const dup = findPresetByLabel(label);
      const isDup = dup && (!loadedPreset || dup.name !== loadedPreset.name);

      if (isDup && !dupAction) {
        // Show duplicate-warning panel and stop — user must choose
        if (dupEl) {
          const dupStatus = presetStatus(dup);
          dupEl.innerHTML = `
            <strong>A preset named &ldquo;${escapeHtml(dup.label || dup.name)}&rdquo; already exists</strong>
            <span class="ait-badge ait-badge-${dupStatus}" style="margin-left:4px">${escapeHtml(dupStatus)}</span>
            <br>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
              <button class="btn danger xsmall" type="button"
                onclick="aiTuning._saveDraftAction('overwrite')">Overwrite existing</button>
              <button class="btn secondary xsmall" type="button"
                onclick="aiTuning._saveDraftAction('copy')">Save as new copy</button>
              <button class="btn secondary xsmall" type="button"
                onclick="aiTuning._saveDraftAction('cancel')">Cancel</button>
            </div>`;
          dupEl.hidden = false;
        }
        return;
      }

      if (dupAction === 'cancel') {
        if (dupEl) dupEl.hidden = true;
        if (modal) modal.dataset.dupAction = '';
        return;
      }

      if (isDup && dupAction === 'overwrite') {
        // Reuse the existing preset's internal name
        internalName = dup.name;
      } else if (dupAction === 'copy' || (!isDup)) {
        // New unique preset: generate a slug+timestamp internal name
        if (dupAction === 'copy') saveLabel = makeUniqueLabelCopy(label);
        internalName = labelToUniqueName(saveLabel);
        // Safety: ensure uniqueness against existing names
        let suffix = 2;
        const base = internalName;
        while (savedPresets.some((p) => p.name === internalName)) {
          internalName = `${base}-${suffix++}`;
        }
      } else {
        internalName = labelToUniqueName(saveLabel);
      }
    }

    if (dupEl) dupEl.hidden = true;
    if (modal) modal.dataset.dupAction = '';

    try {
      const data = await api('/api/admin/ai-tuning/presets', {
        method: 'POST',
        body: JSON.stringify({
          name:               internalName,
          label:              saveLabel,
          basePreset:         activeBasePreset,
          thresholds:         overrides,
          status:             'draft',
          notes,
          description:        notes,
          parcelLabel:        currentParcelLabel   || null,
          parcelAddress:      currentParcelAddress || null,
          detectionMode:      currentResult?.diagnostic?.detectionMode || currentResult?.diagnostic?.detection_mode || null,
          confidenceScore:    currentResult?.confidenceScore           || null,
          settingsFingerprint: fingerprint,
        }),
      });
      loadedPreset = data.preset;
      captureBaseline();
      clearDirty();
      updateSessionBanner();
      closeSaveDraftModal();
      await loadSavedPresets();
      showToast('Draft saved: ' + saveLabel, 'success');
    } catch (err) {
      if (errEl) errEl.textContent = err.message || 'Save failed.';
      else showToast('Save failed: ' + (err.message || ''), 'error');
    }
  }

  // Public shim so onclick="aiTuning._saveDraftAction(...)" works
  function _saveDraftAction(action) {
    if (action === 'cancel') {
      const dupEl = el('ait-draft-dup-warning');
      if (dupEl) dupEl.hidden = true;
      const modal = el('ait-save-draft-modal');
      if (modal) modal.dataset.dupAction = '';
      return;
    }
    saveDraftWithAction(action);
  }

  // ── Workflow: Mark as Validated ────────────────────────────────────────────
  async function markValidatedPreset() {
    if (!loadedPreset || presetStatus(loadedPreset) !== 'draft') return;
    if (isDirty) {
      showToast('Save unsaved changes before marking validated.', 'error');
      return;
    }
    const label = loadedPreset.label || loadedPreset.name;
    if (!confirm(`Mark "${label}" as Validated?\n\nThis indicates the preset has been reviewed and tested. It does NOT affect live detection.`)) return;
    try {
      const data = await api('/api/admin/ai-tuning/presets/' + encodeURIComponent(loadedPreset.name) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'validated' }),
      });
      loadedPreset = data.preset;
      updateSessionBanner();
      await loadSavedPresets();
      showToast('Marked as validated: ' + label, 'success');
    } catch (err) {
      showToast('Failed: ' + (err.message || ''), 'error');
    }
  }

  // ── Workflow: Promote to Production ───────────────────────────────────────
  function openPromoteModal() {
    if (!loadedPreset || isDirty) return;
    const modal = el('ait-promote-modal');
    if (!modal) return;

    const nameEl = el('ait-promote-preset-name');
    if (nameEl) nameEl.textContent = loadedPreset.label || loadedPreset.name;

    const statusEl = el('ait-promote-preset-status');
    if (statusEl) {
      const s = presetStatus(loadedPreset);
      statusEl.innerHTML = STATUS_BADGE_HTML[s] || '';
    }

    // Find current production preset for comparison display
    const currentProd = savedPresets.find((p) => presetStatus(p) === 'production');
    const prevEl = el('ait-promote-prev-prod');
    if (prevEl) {
      prevEl.textContent = currentProd
        ? `Current production preset: "${currentProd.label || currentProd.name}" — it will be auto-archived.`
        : 'No current production preset — this will become the first one.';
    }

    // Reset confirm button to initial state
    const confirmBtn = el('ait-promote-confirm-btn');
    if (confirmBtn) {
      confirmBtn.dataset.stage = '1';
      confirmBtn.textContent = 'I Understand the Risk — Confirm Promotion';
      confirmBtn.classList.add('btn-stage1');
      confirmBtn.classList.remove('btn-stage2');
    }

    modal.hidden = false;
  }

  function closePromoteModal() {
    const modal = el('ait-promote-modal');
    if (modal) modal.hidden = true;
  }

  async function confirmPromote() {
    // Two-click confirmation: first click arms, second click fires
    const confirmBtn = el('ait-promote-confirm-btn');
    if (confirmBtn && confirmBtn.dataset.stage !== '2') {
      confirmBtn.dataset.stage = '2';
      confirmBtn.textContent = 'Click Again to Promote to Production NOW';
      confirmBtn.classList.remove('btn-stage1');
      confirmBtn.classList.add('btn-stage2');
      return;
    }

    if (!loadedPreset) return;
    try {
      const data = await api('/api/admin/ai-tuning/presets/' + encodeURIComponent(loadedPreset.name) + '/promote', {
        method: 'POST',
      });
      loadedPreset = data.preset;
      updateSessionBanner();
      closePromoteModal();
      await loadSavedPresets();
      let msg = 'Promoted to production: ' + (data.preset?.label || data.preset?.name || loadedPreset.name);
      if (data.archivedPrev?.length) msg += '. Previous preset archived: ' + data.archivedPrev.join(', ');
      showToast(msg, 'success');
    } catch (err) {
      showToast('Promotion failed: ' + (err.message || ''), 'error');
      closePromoteModal();
    }
  }

  // ── Workflow: Archive Preset ───────────────────────────────────────────────
  async function archivePreset(name) {
    const target = savedPresets.find((p) => p.name === name);
    if (!target) return;
    if (presetStatus(target) === 'production') {
      showToast('Cannot archive the active production preset directly. Promote another preset first.', 'error');
      return;
    }
    if (!confirm(`Archive "${target.label || name}"?\n\nIt will be hidden from normal view but remain reloadable.`)) return;
    try {
      await api('/api/admin/ai-tuning/presets/' + encodeURIComponent(name) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      });
      if (loadedPreset?.name === name) {
        loadedPreset = { ...loadedPreset, status: 'archived' };
        updateSessionBanner();
      }
      await loadSavedPresets();
      showToast('Archived: ' + name, 'success');
    } catch (err) {
      showToast('Archive failed: ' + (err.message || ''), 'error');
    }
  }

  // ── Test parcel management ─────────────────────────────────────────────────
  async function loadTestParcels() {
    try {
      const data = await api('/api/admin/ai-tuning/test-parcels');
      testParcels = data.parcels || [];
      renderTestParcelList();
    } catch (_) {}
  }

  async function saveCurrentParcel() {
    if (!currentParcelGeoJson) { showToast('No parcel loaded.', 'error'); return; }
    const labelInput = el('ait-parcel-save-label');
    const label = labelInput?.value?.trim();
    if (!label) { showToast('Enter a label for this test parcel.', 'error'); return; }
    try {
      await api('/api/admin/ai-tuning/test-parcels', {
        method: 'POST',
        body: JSON.stringify({
          label,
          address: el('ait-address-input')?.value || '',
          parcelGeoJson: currentParcelGeoJson,
          lat: currentParcelGeoJson?.properties?.lat,
          lng: currentParcelGeoJson?.properties?.lng,
          notes: '',
        }),
      });
      showToast('Test parcel saved: ' + label, 'success');
      if (labelInput) labelInput.value = '';
      await loadTestParcels();
    } catch (err) {
      showToast('Save failed: ' + (err.message || ''), 'error');
    }
  }

  async function deleteTestParcel(id) {
    if (!confirm('Remove this test parcel?')) return;
    try {
      await api('/api/admin/ai-tuning/test-parcels/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadTestParcels();
    } catch (_) {}
  }

  function loadTestParcel(parcel) {
    if (!parcel.parcelGeoJson) return;
    const normalized = normalizeParcelGeoJson(parcel.parcelGeoJson);
    if (!isValidParcelFeatureCollection(normalized)) {
      showToast('Test parcel has no valid polygon geometry.', 'error');
      return;
    }
    currentParcelGeoJson = normalized;
    originalParcelGeoJson = normalized;
    activeTestAreaGeoJson = null;
    currentParcelBounds  = getGeoJsonBounds(normalized);
    updateCurrentParcelFeature(normalized);
    renderParcelLayer();
    fitToParcel();
    setLayerData('mowable', { type: 'FeatureCollection', features: [] });
    renderTestAreaOverlay();
    renderDiagnostics(null);
    updateTestAreaStatus();
    // Capture parcel context for enriched preset saves
    currentParcelLabel   = parcel.label || null;
    currentParcelAddress = parcel.address || null;
    window._aitCurrentParcelContext = { label: currentParcelLabel, address: currentParcelAddress };
    // Loading a parcel does NOT change preset state or mark dirty
    showToast('Parcel loaded: ' + parcel.label, 'success');
    window.dispatchEvent(new CustomEvent('ait:parcel-loaded', { detail: { source: 'test-parcel', label: parcel.label } }));
    if (el('ait-address-input')) el('ait-address-input').value = parcel.address || '';
  }

  function renderTestParcelList() {
    const container = el('ait-test-parcel-list');
    if (!container) return;
    if (!testParcels.length) {
      container.innerHTML = '<p class="ait-muted">No test parcels saved.</p>';
      return;
    }
    container.innerHTML = testParcels.map((p, i) => `
      <div class="ait-preset-item">
        <div class="ait-preset-item-info">
          <span class="ait-preset-item-name">${escapeHtml(p.label)}</span>
          ${p.address ? `<small class="ait-muted">${escapeHtml(p.address)}</small>` : ''}
          ${p.category && p.category !== 'general' ? `<span class="ait-badge ait-badge-cat">${escapeHtml(p.category)}</span>` : ''}
        </div>
        <div class="ait-preset-item-actions">
          <button class="btn secondary xsmall ait-load-tp" data-idx="${i}">Load</button>
          <button class="btn danger xsmall ait-del-tp" data-idx="${i}">Remove</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.ait-load-tp').forEach((btn) => {
      btn.addEventListener('click', () => loadTestParcel(testParcels[+btn.dataset.idx]));
    });
    container.querySelectorAll('.ait-del-tp').forEach((btn) => {
      btn.addEventListener('click', () => deleteTestParcel(testParcels[+btn.dataset.idx]?.id));
    });
  }

  // ── Address / parcel lookup ────────────────────────────────────────────────
  // Strategy: geocode via Nominatim to get lat/lng, then hit the same
  // /api/parcel/lookup endpoint the customer quote flow uses (spatial
  // intersection is far more reliable than address text search alone).
  async function lookupAddress() {
    const input = el('ait-address-input');
    const rawAddress = input?.value?.trim();
    if (!rawAddress) return;

    const statusEl = el('ait-address-status');
    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

    setStatus('Looking up…');
    console.log('[AI Tuning Parcel] lookup start', { address: rawAddress });

    try {
      // ── Step 1: Parse address components from full-address input ───────────
      const chunks = rawAddress.split(',').map((s) => s.trim()).filter(Boolean);
      const streetPart = chunks[0] || rawAddress;
      let cityPart = '';
      let zipPart = '';

      for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];
        const zipMatch = chunk.match(/\b(\d{5})\b/);
        const isStateOnly = /^(AR|Arkansas)$/i.test(chunk);
        const isStateAndZip = /^AR\s+\d{5}$/i.test(chunk);

        if (zipMatch) zipPart = zipMatch[1];
        if (isStateAndZip) { const m = chunk.match(/(\d{5})/); if (m) zipPart = m[1]; }
        if (!isStateOnly && !isStateAndZip && !zipMatch && !cityPart) cityPart = chunk;
      }

      // ── Step 2: Geocode via Nominatim to get lat/lng ───────────────────────
      // Append ", AR" if state not already present so Nominatim focuses on Arkansas.
      const geocodeQ = /\bAR\b|\bArkansas\b/i.test(rawAddress) ? rawAddress : rawAddress + ', AR';
      setStatus('Geocoding address…');
      let lat = null;
      let lng = null;
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=us&addressdetails=1&q=${encodeURIComponent(geocodeQ)}`,
          { headers: { Accept: 'application/json' } }
        );
        const geoData = await geoRes.json();
        console.log('[AI Tuning Parcel] geocode candidates:', geoData?.length, geoData);

        if (Array.isArray(geoData) && geoData.length) {
          const arHits = geoData.filter((r) => {
            const st = String(r?.address?.state_code || r?.address?.state || '').toUpperCase();
            return st === 'AR' || st === 'ARKANSAS';
          });
          const best = arHits[0] || geoData[0];
          lat = Number(best.lat);
          lng = Number(best.lon);
          if (!cityPart) cityPart = best.address?.city || best.address?.town || '';
          if (!zipPart) zipPart = best.address?.postcode || '';
        }
      } catch (geoErr) {
        console.warn('[AI Tuning Parcel] geocode error (will try text search)', geoErr);
      }

      // ── Step 3: Call the shared parcel lookup endpoint ─────────────────────
      const params = new URLSearchParams({ address: streetPart });
      if (lat && lng) { params.set('lat', lat); params.set('lng', lng); }
      if (cityPart) params.set('city', cityPart);
      if (zipPart) params.set('zip', zipPart);

      console.log('[AI Tuning Parcel] lookup URL → /api/parcel/lookup?' + params.toString());
      setStatus('Fetching parcel boundary…');

      const data = await api('/api/parcel/lookup?' + params.toString());
      const candidateCount = Array.isArray(data?.raw?.features) ? data.raw.features.length : (data.ok ? 1 : 0);
      console.log('[AI Tuning Parcel] result — ok:', data.ok, 'method:', data.method, 'candidates:', candidateCount);
      console.debug('[AI Tuning Parcel] raw lookup payload', {
        ok: data.ok,
        method: data.method,
        featureKeys: data.feature ? Object.keys(data.feature) : null,
        geometryKeys: data.feature?.geometry ? Object.keys(data.feature.geometry) : null,
        hasRings: Array.isArray(data.feature?.geometry?.rings),
        ringSampleLength: data.feature?.geometry?.rings?.[0]?.length,
      });

      if (!data.ok || !data.feature) {
        const msg = (lat && lng)
          ? 'Parcel service returned address candidates but no parcel geometry.'
          : 'No parcel found. Try full address with city and ZIP.';
        console.log('[AI Tuning Parcel] lookup failed', { reason: data.reason, lat, lng });
        setStatus(msg);
        return;
      }

      // ── Step 4: Normalize and set active parcel ────────────────────────────
      // Pick best candidate — server pre-selects data.feature; fall back to
      // data.candidates / results / parcels / parcel if present.
      const candidate = data.feature
        || (Array.isArray(data.candidates) && data.candidates[0])
        || (Array.isArray(data.results) && data.results[0])
        || (Array.isArray(data.parcels) && data.parcels[0])
        || data.parcel
        || null;

      if (!candidate) {
        setStatus('Parcel service returned no candidate geometry.');
        return;
      }

      const normalized = normalizeParcelGeoJson(candidate);

      if (!isValidParcelFeatureCollection(normalized)) {
        const msg = 'Parcel service returned a parcel but no valid polygon geometry.';
        console.warn('[AI Tuning Parcel] normalization failed', {
          candidateKeys: Object.keys(candidate || {}),
          geometryKeys: candidate?.geometry ? Object.keys(candidate.geometry) : null,
          hasRings: Array.isArray(candidate?.geometry?.rings),
          normalizedOk: !!normalized,
        });
        setStatus(msg);
        return;
      }

      const bounds = getGeoJsonBounds(normalized);
      const featureCount = normalized.features.length;
      const geometryTypes = [...new Set(normalized.features.map((f) => f.geometry?.type))];
      console.log('[AI Tuning Parcel] normalized geojson', { featureCount, geometryTypes, bounds });

      currentParcelGeoJson = normalized;
      originalParcelGeoJson = normalized;
      activeTestAreaGeoJson = null;
      currentParcelBounds  = bounds;
      updateCurrentParcelFeature(normalized);
      renderParcelLayer();
      fitToParcel();
      setLayerData('mowable', { type: 'FeatureCollection', features: [] });
      renderTestAreaOverlay();
      renderDiagnostics(null);
      updateTestAreaStatus();

      const area = data.normalized?.areaSqft;
      setStatus(
        'Parcel loaded' +
        (area ? ' — ' + Math.round(area).toLocaleString() + ' sqft' : '') +
        '. Method: ' + (data.method || 'lookup')
      );

      // Capture parcel context for enriched preset saves
      // Use street portion of address as compact label
      const rawInput = el('ait-address-input')?.value?.trim() || '';
      currentParcelLabel   = rawInput.split(',')[0].trim() || null;
      currentParcelAddress = rawInput || null;
      window._aitCurrentParcelContext = { label: currentParcelLabel, address: currentParcelAddress };
      window.dispatchEvent(new CustomEvent('ait:parcel-loaded', { detail: { source: 'address-lookup', label: currentParcelLabel } }));

    } catch (err) {
      console.log('[AI Tuning Parcel] lookup failed', err);
      setStatus('Lookup failed: ' + (err.message || 'error'));
    }
  }

  // ── Overlay toggles ────────────────────────────────────────────────────────
  function handleOverlayToggle(layerId, checked) {
    setLayerVisible(layerId, checked);
  }

  // ── Admin parcel feature sync (feeds lasso-yard.js bridge) ─────────────────
  function updateCurrentParcelFeature(fc) {
    currentParcelFeatureForLasso = fc?.features?.[0] || null;
    window.currentParcelGeometry = currentParcelFeatureForLasso || null;
    if (window.TurfLynkAppState) {
      window.TurfLynkAppState.parcelFeature = currentParcelFeatureForLasso;
    }
  }

  // ── Admin lasso / draw bridge ──────────────────────────────────────────────
  // Exposes globals that lasso-yard.js expects (window.map, TurfLynkAppState,
  // setTurfLynkMowableFeatures, etc.) so lasso-yard.js operates on the admin map.
  function setupAdminBridge() {
    window.map = map;
    if (!window.TurfLynkAppState) window.TurfLynkAppState = {};
    Object.assign(window.TurfLynkAppState, {
      map,
      parcelFeature: currentParcelFeatureForLasso,
      mowableFeatureCollection: manualAreas,
      mapMode: 'idle',
      quoteUiMode: 'idle',
    });
    window.setTurfLynkMowableFeatures = setAdminManualAreas;
    window.setTurfLynkLassoTempLine   = setAdminLassoTempLine;
    window.applyTurfLynkCutFeature    = applyAdminCutout;
    window.syncMowAreaFromLayers      = updateAdminManualAreaDisplay;
    window.updateQuoteFlowState       = () => {};
    window.selectTurfLynkMowableFeature = () => {};
    window.setTurfLynkMapMode = (m) => {
      activeMapTool = m;
      if (window.TurfLynkAppState) window.TurfLynkAppState.mapMode = m;
      updateAdminToolbarState();
    };
    window.getTurfLynkMapMode = () => activeMapTool;
    if (typeof window.showError !== 'function')   window.showError   = (msg) => showToast(msg, 'error');
    if (typeof window.showWarning !== 'function') window.showWarning = (msg) => showToast(msg, 'error');
  }

  // ── Admin manual area management ───────────────────────────────────────────
  function setAdminManualAreas(features = []) {
    manualAreas = {
      type: 'FeatureCollection',
      features: Array.isArray(features) ? features.filter((f) => f?.geometry) : [],
    };
    if (window.TurfLynkAppState) window.TurfLynkAppState.mowableFeatureCollection = manualAreas;
    setLayerData('manual', manualAreas);
    updateAdminManualAreaDisplay();
    updateAdminToolbarState();
    console.log('[AI Tuning Map] manual areas updated, count=' + manualAreas.features.length);
    // If this call came from a completed draw, clip the drawn polygon to the parcel and set as test area
    if (_pendingTestAreaUpdate) {
      _pendingTestAreaUpdate = false;
      if (manualAreas.features.length) setActiveTestArea(manualAreas);
    }
  }

  // ── Test area: clip drawn polygon to parcel, store, render ─────────────────
  function setActiveTestArea(drawnFc) {
    const parcel = originalParcelGeoJson || currentParcelGeoJson;
    if (!window.turf || !parcel?.features?.length) {
      activeTestAreaGeoJson = drawnFc.features.length ? drawnFc : null;
      renderTestAreaOverlay();
      updateTestAreaStatus();
      return;
    }
    try {
      const parcelFeature = parcel.features[0];
      let drawnFeature = drawnFc.features[0];
      for (let i = 1; i < drawnFc.features.length; i++) {
        try { drawnFeature = turf.union(drawnFeature, drawnFc.features[i]); } catch (_) {}
      }
      const clipped = turf.intersect(parcelFeature, drawnFeature);
      if (!clipped) {
        showToast('Drawn area does not overlap parcel — test area not set.', 'error');
        activeTestAreaGeoJson = null;
      } else {
        activeTestAreaGeoJson = { type: 'FeatureCollection', features: [clipped] };
      }
    } catch (err) {
      console.warn('[AI Tuning] test area clip failed, using drawn area as-is', err);
      activeTestAreaGeoJson = drawnFc.features.length ? drawnFc : null;
    }
    renderTestAreaOverlay();
    updateTestAreaStatus();
  }

  function renderTestAreaOverlay() {
    setLayerData('test-area', activeTestAreaGeoJson || { type: 'FeatureCollection', features: [] });
  }

  function updateTestAreaStatus() {
    const statusEl = el('ait-test-area-status');
    if (!statusEl) return;
    if (!activeTestAreaGeoJson?.features?.length) {
      const parcel = originalParcelGeoJson || currentParcelGeoJson;
      statusEl.textContent = parcel ? 'Parcel selected. Draw a smaller test area or run detection on full parcel.' : '';
      statusEl.className = 'ait-test-area-status';
      return;
    }
    let msg = 'Test area selected — detection will run on selected area.';
    if (window.turf) {
      try {
        const sqm = turf.area(activeTestAreaGeoJson);
        const sqft = Math.round(sqm * 10.7639);
        const acres = (sqm / 4046.86).toFixed(2);
        msg = `Test area: ${sqft.toLocaleString()} sqft (${acres} ac) — detection will run on selected area.`;
      } catch {}
    }
    statusEl.textContent = msg;
    statusEl.className = 'ait-test-area-status ait-test-area-active';
  }

  function clearTestArea() {
    activeTestAreaGeoJson = null;
    renderTestAreaOverlay();
    updateTestAreaStatus();
    showToast('Test area cleared. Next detection uses full parcel.', 'success');
  }

  function setAdminLassoTempLine(points) {
    if (!map || !mapReady) return;
    const src = map.getSource('ait-src-lasso-temp');
    if (!src) return;
    if (!points || points.length < 2) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) } }],
    });
  }

  function applyAdminCutout(cutFeature) {
    if (!window.turf || !cutFeature || !manualAreas.features.length) return;
    snapshotManualAreasForUndo();
    const newFeatures = [];
    manualAreas.features.forEach((f) => {
      try {
        const diff = turf.difference(f, cutFeature);
        if (diff) newFeatures.push(diff);
      } catch (err) {
        console.warn('[AI Tuning Map] cutout diff failed', err);
      }
    });
    setAdminManualAreas(newFeatures);
    console.log('[AI Tuning Map] cutout created');
  }

  function snapshotManualAreasForUndo() {
    manualUndoStack.push(JSON.parse(JSON.stringify(manualAreas)));
    if (manualUndoStack.length > 12) manualUndoStack.shift();
  }

  function undoManualArea() {
    if (!manualUndoStack.length) { showToast('Nothing to undo.', 'error'); return; }
    const prev = manualUndoStack.pop();
    manualAreas = prev;
    if (window.TurfLynkAppState) window.TurfLynkAppState.mowableFeatureCollection = prev;
    setLayerData('manual', prev);
    updateAdminManualAreaDisplay();
    showToast('Undo applied.', 'success');
  }

  function updateAdminManualAreaDisplay() {
    const display = el('ait-manual-area-display');
    if (!display) return;
    if (!manualAreas.features.length) { display.textContent = ''; return; }
    if (!window.turf) { display.textContent = manualAreas.features.length + ' manual area(s)'; return; }
    try {
      const sqm = turf.area(manualAreas);
      const sqft = Math.round(sqm * 10.7639);
      display.textContent = sqft.toLocaleString() + ' sqft manual';
    } catch {
      display.textContent = manualAreas.features.length + ' manual area(s)';
    }
  }

  // ── Admin map tool activation ──────────────────────────────────────────────
  function setActiveTool(tool) {
    if (activeMapTool !== tool) {
      if (activeMapTool === 'edit') stopAdminEdit();
      if ((activeMapTool === 'draw' || activeMapTool === 'cut') && window.TurfLynkLassoYard?.cancel) {
        window.TurfLynkLassoYard.cancel();
      }
    }
    activeMapTool = tool;
    if (window.TurfLynkAppState) window.TurfLynkAppState.mapMode = tool;
    updateAdminToolbarState();
  }

  function startAdminDraw() {
    console.log('[AI Tuning Map] draw start');
    if (!currentParcelGeoJson) { showToast('Load a parcel first.', 'error'); return; }
    if (!window.TurfLynkLassoYard?.arm) { showToast('Draw tools still loading — try again.', 'error'); return; }
    snapshotManualAreasForUndo();
    setActiveTool('draw');
    _pendingTestAreaUpdate = true;
    window.TurfLynkLassoYard.arm();
  }

  function startAdminCut() {
    if (!manualAreas.features.length) { showToast('Draw mow areas first, then cut.', 'error'); return; }
    if (!window.TurfLynkLassoYard?.armCut) { showToast('Draw tools still loading — try again.', 'error'); return; }
    setActiveTool('cut');
    window.TurfLynkLassoYard.armCut();
  }

  function clearAdminAreas() {
    snapshotManualAreasForUndo();
    _pendingTestAreaUpdate = false;
    setActiveTool('idle');
    if (window.TurfLynkLassoYard?.cancel) window.TurfLynkLassoYard.cancel();
    setAdminManualAreas([]);
    activeTestAreaGeoJson = null;
    renderTestAreaOverlay();
    updateTestAreaStatus();
    showToast('Manual areas cleared.', 'success');
  }

  function resetToParcel() {
    const parcel = originalParcelGeoJson || currentParcelGeoJson;
    if (!parcel) { showToast('No parcel loaded.', 'error'); return; }

    _pendingTestAreaUpdate = false;
    activeTestAreaGeoJson = null;
    currentResult = null;
    previousResult = null;

    setActiveTool('idle');
    if (window.TurfLynkLassoYard?.cancel) window.TurfLynkLassoYard.cancel();

    setLayerData('mowable', { type: 'FeatureCollection', features: [] });
    setLayerData('prev', { type: 'FeatureCollection', features: [] });
    renderTestAreaOverlay();

    currentParcelGeoJson = parcel;
    renderParcelLayer();
    fitToParcel();

    updateTestAreaStatus();
    renderDiagnostics(null);
    updateComparePanel();

    showToast('Reset to parcel.', 'success');
    console.log('[AI Tuning Map] reset to parcel — test area and detection results cleared');
  }

  function gpsCurrentLocation() {
    if (!navigator.geolocation) { showToast('Geolocation not available.', 'error'); return; }
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      showToast('GPS requires HTTPS.', 'error'); return;
    }
    showToast('Getting GPS location…', 'success');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (map) map.flyTo({ center: [lng, lat], zoom: 18, duration: 800 });
      },
      (err) => showToast('Location error: ' + (err.message || 'denied'), 'error'),
      { timeout: 10000 }
    );
  }

  function focusParcelSearch() {
    const input = el('ait-address-input');
    if (!input) return;
    input.focus();
    input.select();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── Admin edit vertex handles (adapted from mow-editor.js) ─────────────────
  function clearAdminEditHandles() {
    editMarkersAdmin.forEach((m) => { try { m.remove(); } catch {} });
    editMarkersAdmin = [];
  }

  function getAdminEditableRings(feature) {
    const g = feature?.geometry;
    if (!g) return [];
    if (g.type === 'Polygon') return g.coordinates.map((ring, ri) => ({ ring, path: [ri] }));
    if (g.type === 'MultiPolygon') {
      const out = [];
      g.coordinates.forEach((poly, pi) => poly.forEach((ring, ri) => out.push({ ring, path: [pi, ri] })));
      return out;
    }
    return [];
  }

  function getAdminRingByPath(feature, path) {
    if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates[path[0]];
    return feature.geometry.coordinates[path[0]][path[1]];
  }

  function buildAdminEditHandles() {
    clearAdminEditHandles();
    if (!map || typeof maplibregl === 'undefined') return;
    manualAreas.features.forEach((feature, fi) => {
      getAdminEditableRings(feature).forEach(({ ring, path }) => {
        ring.slice(0, -1).forEach((coord, ci) => {
          const handle = document.createElement('button');
          handle.type = 'button';
          handle.className = 'maplibre-edit-handle';
          handle.setAttribute('aria-label', 'Move vertex');
          const marker = new maplibregl.Marker({ element: handle, draggable: true })
            .setLngLat(coord)
            .addTo(map);
          marker.on('drag', () => {
            const next = marker.getLngLat();
            const tf = manualAreas.features[fi];
            if (!tf) return;
            const ring2 = getAdminRingByPath(tf, path);
            ring2[ci] = [next.lng, next.lat];
            if (ci === 0) ring2[ring2.length - 1] = [next.lng, next.lat];
            setLayerData('manual', manualAreas);
            console.log('[AI Tuning Map] polygon edited');
          });
          marker.on('dragend', updateAdminManualAreaDisplay);
          editMarkersAdmin.push(marker);
        });
      });
    });
  }

  function startAdminEdit() {
    if (!manualAreas.features.length) { showToast('Draw areas first to edit.', 'error'); return; }
    setActiveTool('edit');
    editSnapshotAdmin = JSON.parse(JSON.stringify(manualAreas));
    buildAdminEditHandles();
  }

  function stopAdminEdit() {
    clearAdminEditHandles();
    editSnapshotAdmin = null;
  }

  function cancelAdminEdit() {
    if (editSnapshotAdmin) {
      setAdminManualAreas(editSnapshotAdmin.features);
      editSnapshotAdmin = null;
    }
    setActiveTool('idle');
  }

  // ── Ground truth / compare ─────────────────────────────────────────────────
  function setManualAreasAsGroundTruth() {
    if (!manualAreas.features.length) { showToast('Draw manual areas first.', 'error'); return; }
    groundTruthAreas = JSON.parse(JSON.stringify(manualAreas));
    setLayerData('prev', groundTruthAreas);
    ['ait-fill-prev', 'ait-line-prev'].forEach((id) => {
      if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    });
    showToast('Manual areas stored as ground truth baseline.', 'success');
    console.log('[AI Tuning Map] compare overlay updated — ground truth set');
  }

  // ── Toolbar state ──────────────────────────────────────────────────────────
  function updateAdminToolbarState() {
    document.querySelectorAll('.ait-draw-tool-btn').forEach((btn) => {
      btn.classList.toggle('ait-tool-active', btn.dataset.tool === activeMapTool);
    });
    const modeEl = el('ait-map-mode-label');
    if (modeEl) {
      const labels = {
        idle: '', draw: 'Drawing — drag to lasso mow area',
        cut: 'Cutting — drag to draw exclusion', edit: 'Editing — drag green handles',
      };
      modeEl.textContent = labels[activeMapTool] ?? '';
    }
  }

  // ── Control HTML generation (enhanced cards) ──────────────────────────────
  function renderControlGroup(group) {
    const groupDescHtml = group.description
      ? `<p class="ait-group-desc">${escapeHtml(group.description)}</p>`
      : '';

    const controls = group.controls.map((ctrl) => {
      const cm = CTRL_META[ctrl.id] || {};
      const impact = cm.impact || 'medium';
      const impactLabel = impact.charAt(0).toUpperCase() + impact.slice(1);
      const helpBtn   = `<button class="ait-help-btn" type="button" data-help="${escapeHtml(ctrl.id)}" aria-label="Help">?</button>`;
      const resetBtn  = `<button class="ait-reset-ctrl-btn" type="button" data-reset="${escapeHtml(ctrl.id)}" aria-label="Reset to baseline" title="Reset to baseline">&#8635;</button>`;
      const badge     = `<span class="ait-impact-badge ait-impact-${impact}">${impactLabel}</span>`;
      const descHtml  = cm.shortDescription ? `<p class="ait-ctrl-desc">${escapeHtml(cm.shortDescription)}</p>` : '';

      if (ctrl.special === 'toggle') {
        return `
          <div class="ait-ctrl-row ait-ctrl-card" data-ctrl="${escapeHtml(ctrl.id)}">
            <div class="ait-ctrl-header-row">
              <div class="ait-ctrl-header-left">
                <label class="ait-ctrl-label" for="ait-tog-${ctrl.id}">${escapeHtml(ctrl.label)}</label>
                ${badge}
              </div>
              <div class="ait-ctrl-header-right">
                ${helpBtn}${resetBtn}
                <div class="ait-toggle-wrap" style="margin-left:2px">
                  <input type="checkbox" id="ait-tog-${ctrl.id}" class="ait-toggle"
                    onchange="aiTuning._onToggle('${ctrl.id}')" />
                  <label for="ait-tog-${ctrl.id}" class="ait-toggle-label"></label>
                </div>
              </div>
            </div>
            ${descHtml}
          </div>`;
      }
      return `
        <div class="ait-ctrl-row ait-ctrl-card" data-ctrl="${escapeHtml(ctrl.id)}">
          <div class="ait-ctrl-header-row">
            <div class="ait-ctrl-header-left">
              <label class="ait-ctrl-label" for="ait-ctrl-${ctrl.id}">${escapeHtml(ctrl.label)}</label>
              ${badge}
            </div>
            <div class="ait-ctrl-header-right">
              <span class="ait-ctrl-val" id="ait-val-${ctrl.id}">—</span>
              ${helpBtn}${resetBtn}
            </div>
          </div>
          ${descHtml}
          <div class="ait-ctrl-bottom">
            <input type="range" id="ait-ctrl-${ctrl.id}" class="ait-slider"
              min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step}" value="${ctrl.min}"
              oninput="aiTuning._onSlider('${ctrl.id}', this.value)" />
            <input type="number" id="ait-num-${ctrl.id}" class="ait-num-input"
              min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step}" value="${ctrl.min}"
              onchange="aiTuning._onNum('${ctrl.id}', this.value)" />
          </div>
        </div>`;
    }).join('');

    return `
      <details class="ait-group" open>
        <summary class="ait-group-summary">
          <span class="ait-group-icon">${group.icon}</span>
          <span class="ait-group-label">${escapeHtml(group.label)}</span>
          <button class="btn secondary xsmall ait-rand-section-btn" type="button"
            onclick="event.stopPropagation(); aiTuning.randomizeSection('${group.id}')"
            title="Randomize controls in this section (experimentation only, does not save)"
            style="margin-left:6px;margin-right:4px">Randomize Section</button>
        </summary>
        ${groupDescHtml}
        <div class="ait-group-body">${controls}</div>
      </details>`;
  }

  // ── Public slider/toggle handlers — called from oninput/onchange attrs ─────
  function _onSlider(ctrlId, value) {
    const numInp = el(`ait-num-${ctrlId}`);
    if (numInp) numInp.value = value;
    updateSliderLabel(ctrlId, value);
    markDirty(ctrlId);
  }
  function _onNum(ctrlId, value) {
    const slider = el(`ait-ctrl-${ctrlId}`);
    if (slider) slider.value = value;
    updateSliderLabel(ctrlId, value);
    markDirty(ctrlId);
  }
  function _onToggle(ctrlId) {
    markDirty(ctrlId);
  }

  // ── Randomizer ─────────────────────────────────────────────────────────────

  function generateSeed() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return 'AIT-' + Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function parseRecommendedRange(rangeStr) {
    if (!rangeStr) return null;
    const m = rangeStr.match(/([-\d.]+)\s*[–—-]\s*([-\d.]+)/);
    if (!m) return null;
    return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
  }

  // Randomize a single slider control. Returns true if changed.
  // Toggles are skipped; controls with randomizeAllowed:false in CTRL_META are skipped.
  // 75% chance: pick within recommendedRange (if parseable). 25%: use safe/hard range.
  function randomizeOneControl(ctrl) {
    const cm = CTRL_META[ctrl.id] || {};
    if (cm.randomizeAllowed === false) return false;
    if (ctrl.special === 'toggle') return false;

    const hardMin = ctrl.min;
    const hardMax = ctrl.max;
    const step    = cm.randomStep || ctrl.step;
    const safeMin = cm.safeRandomMin !== undefined ? cm.safeRandomMin : hardMin;
    const safeMax = cm.safeRandomMax !== undefined ? cm.safeRandomMax : hardMax;

    const rec = parseRecommendedRange(cm.recommendedRange);
    let rangeMin, rangeMax;
    if (Math.random() < 0.75 && rec) {
      rangeMin = Math.max(hardMin, Math.min(safeMax, rec.min));
      rangeMax = Math.min(hardMax, Math.max(safeMin, rec.max));
    } else {
      rangeMin = safeMin;
      rangeMax = safeMax;
    }
    if (rangeMin >= rangeMax) { rangeMin = hardMin; rangeMax = hardMax; }

    const steps  = Math.max(0, Math.floor((rangeMax - rangeMin) / step + 1e-9));
    const newVal = parseFloat((rangeMin + Math.floor(Math.random() * (steps + 1)) * step).toFixed(8));
    setControlValue(ctrl.id, Math.max(hardMin, Math.min(hardMax, newVal)));
    isDirty = true;
    updateControlHighlight(ctrl.id);
    return true;
  }

  // Snapshot current slider values before randomizing (for undo).
  function snapshotForUndo() {
    randomizeSnapshot = {};
    for (const group of CONTROL_GROUPS) {
      for (const ctrl of group.controls) {
        if (ctrl.special === 'toggle') {
          const chk = el(`ait-tog-${ctrl.id}`);
          if (chk) randomizeSnapshot[ctrl.id] = chk.checked;
        } else {
          const inp = el(`ait-ctrl-${ctrl.id}`);
          if (inp) randomizeSnapshot[ctrl.id] = parseFloat(inp.value);
        }
      }
    }
  }

  function showRandomizeSeed(seed) {
    const seedEl = el('ait-random-seed');
    if (!seedEl) return;
    if (seed) { seedEl.textContent = 'Random seed: ' + seed; seedEl.hidden = false; }
    else seedEl.hidden = true;
  }

  function updateUndoBtn() {
    const btn = el('ait-undo-randomize-btn');
    if (btn) btn.disabled = !randomizeSnapshot;
  }

  function setRandomizeStatus(msg) {
    const statusEl = el('ait-randomize-status');
    if (statusEl) statusEl.textContent = msg;
  }

  function randomizeSection(groupId) {
    closeTooltip();
    const group = CONTROL_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    snapshotForUndo();
    const seed = generateSeed();
    lastRandomSeed = seed;
    let changedCount = 0;
    for (const ctrl of group.controls) { if (randomizeOneControl(ctrl)) changedCount++; }
    updateEffectSummary();
    updateSessionBanner();
    showRandomizeSeed(seed);
    updateUndoBtn();
    setRandomizeStatus('Randomized "' + group.label + '" section. Use Test Current Settings to try them.');
    console.log('[AI Tuning Randomizer] section randomized', { group: groupId, seed, changedCount });
  }

  function randomizeAll() {
    closeTooltip();
    snapshotForUndo();
    const seed = generateSeed();
    lastRandomSeed = seed;
    let changedCount = 0;
    for (const group of CONTROL_GROUPS) {
      for (const ctrl of group.controls) { if (randomizeOneControl(ctrl)) changedCount++; }
    }
    updateEffectSummary();
    updateSessionBanner();
    showRandomizeSeed(seed);
    updateUndoBtn();
    setRandomizeStatus('Randomized runtime settings. Use Test Current Settings to try them.');
    console.log('[AI Tuning Randomizer] all randomized', { seed, changedCount });
  }

  function undoRandomize() {
    if (!randomizeSnapshot) return;
    const seed = lastRandomSeed;
    let restoredCount = 0;
    for (const group of CONTROL_GROUPS) {
      for (const ctrl of group.controls) {
        const saved = randomizeSnapshot[ctrl.id];
        if (saved === undefined) continue;
        if (ctrl.special === 'toggle') {
          const chk = el(`ait-tog-${ctrl.id}`);
          if (chk) { chk.checked = saved; restoredCount++; }
        } else {
          setControlValue(ctrl.id, saved);
          restoredCount++;
        }
        updateControlHighlight(ctrl.id);
      }
    }
    const anyDirty = CONTROL_GROUPS.flatMap((g) => g.controls).some((c) => checkControlModified(c.id));
    isDirty = anyDirty;
    updateSessionBanner();
    updateEffectSummary();
    randomizeSnapshot = null;
    lastRandomSeed    = null;
    updateUndoBtn();
    setRandomizeStatus('');
    showRandomizeSeed(null);
    console.log('[AI Tuning Randomizer] undo restored', { seed, restoredCount });
  }

  // ── Initialize the entire workstation ─────────────────────────────────────
  const WORKFLOW_GUIDE_HTML = `
    <div class="ait-workflow-guide">
      <p class="ait-wf-title">Recommended Workflow</p>
      <ol class="ait-wf-steps">
        <li class="ait-wf-step">Load a test parcel using the address lookup above</li>
        <li class="ait-wf-step">Run baseline detection with the loaded preset</li>
        <li class="ait-wf-step">Adjust one category of sliders at a time — use the ? icons for guidance</li>
        <li class="ait-wf-step">Click Test Current Settings to see the effect without saving</li>
        <li class="ait-wf-step">Click Compare Previous to overlay and compare runs visually</li>
        <li class="ait-wf-step">Save as Draft when satisfied, then Mark Validated before promoting to Production</li>
      </ol>
    </div>`;

  function buildUI() {
    createTooltipEl();

    const container = el('ait-controls-body');
    if (!container) return;

    // Effect summary panel (above control groups)
    container.innerHTML = `
      <div class="ait-effect-summary" id="ait-effect-summary">
        <p class="ait-effect-title">Detection Bias</p>
        <div class="ait-effect-tags"></div>
      </div>
      ${CONTROL_GROUPS.map(renderControlGroup).join('')}`;

    // Event delegation for help (?) and reset (↺) buttons
    container.addEventListener('click', (e) => {
      const helpBtn = e.target.closest('[data-help]');
      if (helpBtn) { e.stopPropagation(); openTooltip(helpBtn, helpBtn.dataset.help); return; }
      const resetBtn = e.target.closest('[data-reset]');
      if (resetBtn) { e.stopPropagation(); resetControl(resetBtn.dataset.reset); return; }
      closeTooltip();
    });

    applyPresetToControls(BUILT_IN_DEFAULTS[activeBasePreset] || BUILT_IN_DEFAULTS.medium_residential);
    captureBaseline();
    updateEffectSummary();

    // Inject workflow guide into diagnostics pane
    const diagPane = qs('.ait-diag-pane');
    if (diagPane && !diagPane.querySelector('.ait-workflow-guide')) {
      diagPane.insertAdjacentHTML('afterbegin', WORKFLOW_GUIDE_HTML);
    }
  }

  function init() {
    buildUI();
    initMap();
    loadSavedPresets();
    loadTestParcels();
    updateSessionBanner();

    // Detection + compare (ephemeral — never save)
    el('ait-run-btn')?.addEventListener('click', () => runDetection());
    el('ait-test-btn')?.addEventListener('click', () => runTestCurrent());
    el('ait-compare-btn')?.addEventListener('click', () => toggleCompare());

    // Close tooltip on any outside click
    document.addEventListener('click', (e) => {
      if (_tooltipEl && !_tooltipEl.hidden && !e.target.closest('[data-help]')) closeTooltip();
    }, { capture: true });

    // Session banner workflow buttons
    el('ait-reset-btn')?.addEventListener('click', () => resetChanges());
    el('ait-save-draft-btn')?.addEventListener('click', () => openSaveDraftModal());
    el('ait-mark-validated-btn')?.addEventListener('click', () => markValidatedPreset());
    el('ait-promote-btn')?.addEventListener('click', () => openPromoteModal());

    // Save draft modal
    el('ait-draft-cancel-btn')?.addEventListener('click', () => closeSaveDraftModal());
    el('ait-draft-save-btn')?.addEventListener('click', () => confirmSaveDraft());
    el('ait-draft-name-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmSaveDraft(); if (e.key === 'Escape') closeSaveDraftModal(); });

    // Promote modal
    el('ait-promote-cancel-btn')?.addEventListener('click', () => closePromoteModal());
    el('ait-promote-confirm-btn')?.addEventListener('click', () => confirmPromote());

    // Test parcel save
    el('ait-save-parcel-btn')?.addEventListener('click', () => saveCurrentParcel());

    // Address lookup
    el('ait-address-btn')?.addEventListener('click', () => lookupAddress());
    el('ait-address-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupAddress(); });

    // Randomizer controls (global)
    el('ait-randomize-all-btn')?.addEventListener('click', () => randomizeAll());
    el('ait-undo-randomize-btn')?.addEventListener('click', () => undoRandomize());

    // Base preset change — loads built-in defaults, clears loaded preset
    el('ait-base-preset-select')?.addEventListener('change', (e) => {
      activeBasePreset = e.target.value;
      loadedPreset = null;
      const preset = BUILT_IN_DEFAULTS[activeBasePreset] || BUILT_IN_DEFAULTS.medium_residential;
      applyPresetToControls(preset);
      captureBaseline();
      clearDirty();
      showToast('Switched to built-in: ' + activeBasePreset, 'success');
    });

    // Overlay toggles (includes manual areas toggle via .ait-overlay-toggle class)
    document.querySelectorAll('.ait-overlay-toggle').forEach((chk) => {
      chk.addEventListener('change', () => handleOverlayToggle(chk.dataset.layer, chk.checked));
    });

    // ── Admin map draw toolbar ────────────────────────────────────────────────
    el('ait-tool-gps')?.addEventListener('click', () => gpsCurrentLocation());
    el('ait-tool-search')?.addEventListener('click', () => focusParcelSearch());
    el('ait-tool-draw')?.addEventListener('click', () => startAdminDraw());
    el('ait-tool-edit')?.addEventListener('click', () => {
      if (activeMapTool === 'edit') cancelAdminEdit(); else startAdminEdit();
    });
    el('ait-tool-cut')?.addEventListener('click', () => startAdminCut());
    el('ait-tool-undo')?.addEventListener('click', () => undoManualArea());
    el('ait-tool-clear')?.addEventListener('click', () => clearAdminAreas());
    el('ait-tool-reset')?.addEventListener('click', () => resetToParcel());
    el('ait-tool-detect')?.addEventListener('click', () => runDetection());
    el('ait-tool-compare')?.addEventListener('click', () => toggleCompare());
    el('ait-tool-clear-test')?.addEventListener('click', () => clearTestArea());
    el('ait-ground-truth-btn')?.addEventListener('click', () => setManualAreasAsGroundTruth());

    // Close modals on backdrop click
    el('ait-save-draft-modal')?.addEventListener('click', (e) => {
      if (e.target === el('ait-save-draft-modal')) closeSaveDraftModal();
    });
    el('ait-promote-modal')?.addEventListener('click', (e) => {
      if (e.target === el('ait-promote-modal')) closePromoteModal();
    });

    setTimeout(() => { if (map) map.resize(); }, 50);
  }

  // Public API — only what HTML onclick / external callers need
  return {
    init,
    _onSlider,
    _onNum,
    _onToggle,
    openSaveDraft:   openSaveDraftModal,
    closeSaveDraft:  closeSaveDraftModal,
    confirmSaveDraft,
    openPromote:     openPromoteModal,
    closePromote:    closePromoteModal,
    confirmPromote,
    runTestCurrent,
    resetControl,
    randomizeSection,
    randomizeAll,
    undoRandomize,
    getMap:          () => map,
    getCurrentResult: () => currentResult,
    getSavedPresets:  () => savedPresets,
    _saveDraftAction,
    renamePreset,
    duplicatePreset,
  };
})();

// Called by admin-ui.js when AI Detection tab is first activated
function loadAiTuning() {
  const panel = document.getElementById('adminTabAiDetection');
  if (!panel) return Promise.resolve();

  if (!panel.dataset.aitInit) {
    panel.dataset.aitInit = '1';
    aiTuning.init();
  } else {
    setTimeout(() => {
      try { document.getElementById('ait-map')?._maplibreMap?.resize(); } catch (_) {}
    }, 50);
  }
  return Promise.resolve();
}
