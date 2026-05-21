// AI Detect Yard logic — extracted from app.js (Phase 5 modular refactor)
// Loads before app.js. All called functions are function declarations in app.js
// (auto-global) or window.* properties set by earlier modules.
//
// Runtime globals resolved from app.js at call time:
//   state, byId, showResult, escapeHtml, showToast, showError, prettyApiError
//   stopToolModes, updateQuoteFlowState, setEditorModeLabel
//   currentParcelGeoJSON, exposeCurrentParcelGeometryForAi
//   exposeTurfLynkMapGlobals, exposeTurfLynkQuoteGlobals
//   clearMowableFeatures, setMowableFeatures, clearCutoutFeatures, setCutoutFeatures
//   getCutoutFeatureCount, getMowableFeatureCount, getAllMowLayers
//   layerAreaSqFt, asFeature, cloneFeatureCollection
//   syncMowAreaFromLayers, reorderMapOverlays, refreshEstimate
//   snapshotMowLayersForUndo, applyCutToMowable
//   updateMowAreaHelper, saveQuoteDraft, formatAcres, api
//   window.SATELLITE_TILE_URL, window.SATELLITE_TILE_ATTRIBUTION (exposed by app.js)

function startEditAiCutouts() {
  if (!state.map || !getCutoutFeatureCount()) {
    showResult('parcelInfo', '<strong>No AI cutouts to edit.</strong>');
    return;
  }

  stopToolModes();
  setEditorModeLabel('Mode: Editing AI cutouts');
}

function setAiDetectMowableStatus(status) {
  if (state.aiDetectMowableStatusTimer) clearTimeout(state.aiDetectMowableStatusTimer);
  state.aiDetectMowableStatus = status || '';
  state.aiDetectMowableStatusTimer = null;
  if (status) {
    state.aiDetectMowableStatusTimer = setTimeout(() => {
      state.aiDetectMowableStatus = '';
      state.aiDetectMowableStatusTimer = null;
      updateQuoteFlowState();
    }, 2500);
  }
  updateQuoteFlowState();
}

function aiDetectFallbackMessage(data = {}) {
  return data.message || data.warning || 'AI Detect completed. Please review and adjust the selected area.';
}

async function aiDetectGrassDraft() {
  console.log('REAL AI grass detect fired');

  const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
  if (!parcelRings.length || !state.map) {
    showResult(
      'parcelInfo',
      '<strong>No parcel shape yet.</strong><br>Lookup the parcel first.'
    );
    return;
  }

  exposeTurfLynkMapGlobals();
  exposeTurfLynkQuoteGlobals();

  const geoJsonGeometry = exposeCurrentParcelGeometryForAi();
  if (!geoJsonGeometry) {
    showResult(
      'parcelInfo',
      '<strong>AI setup error.</strong><br>Could not convert parcel geometry for detection.'
    );
    return;
  }
  const validationPoint = aiGeoJsonCenter({ type: 'Feature', properties: {}, geometry: geoJsonGeometry }) || aiQuoteFormLatLng();
  const validationState = byId('quoteForm')?.elements?.state?.value || state.currentServiceAddress?.state || '';
  if (!isLngLatInArkansas({ ...validationPoint, state: validationState })) {
    showResult('parcelInfo', `<strong>${escapeHtml(ARKANSAS_ONLY_MESSAGE)}</strong>`);
    showArkansasOnlyWarning({ force: true });
    return;
  }

  if (!window.TurfLynkAiGrass || typeof window.TurfLynkAiGrass.detectGrass !== 'function') {
    showResult(
      'parcelInfo',
      '<strong>AI detector script not loaded.</strong><br>Check that /js/ai-detect-grass.js exists and loads after /app.js.'
    );
    return;
  }

  stopToolModes();

  state.mowUndoStack = [];

  clearMowableFeatures();

  try {
    showResult('parcelInfo', '<strong>AI detecting grass...</strong><br>Analyzing satellite imagery for likely mowable area.');
    const result = await window.TurfLynkAiGrass.detectGrass();

    exposeTurfLynkMapGlobals();

    const detectedSqFt = Math.round(Number(result?.mowableAreaSqFt || byId('quoteForm')?.elements?.mowAreaSqft?.value || 0));
    const parcelSqFt = state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : Number(byId('quoteForm')?.elements?.lotAreaSqft?.value || 0);

    const form = byId('quoteForm');
    if (form) {
      form.elements.lotAreaSqft.value = parcelSqFt || '';
      form.elements.mowAreaSqft.value = detectedSqFt || '';
      form.elements.lotSource.value = 'ai_detected';
    }

    updateMowAreaHelper(parcelSqFt, detectedSqFt);
    saveQuoteDraft();
    await refreshEstimate({ force: true });

    reorderMapOverlays();

    showResult(
      'parcelInfo',
      `<strong>AI mowable area detected.</strong><br>
      Detected Mow Area: ${formatAcres(detectedSqFt)}<br>
      Green shapes are editable. Adjust them if trees, roofs, driveways, or shadows were misread.`
    );
  } catch (error) {
    console.error('AI grass detection failed', error);
    showResult('parcelInfo', `<strong>AI detection failed.</strong><br>${escapeHtml(error.message || error)}`);
  }
}

function geoJsonFeaturesFromValue(value, properties = {}) {
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value.features.map((feature) => asFeature(feature, properties)).filter((feature) => feature?.geometry);
  }
  const feature = asFeature(value, properties);
  return feature?.geometry ? [feature] : [];
}

function isPolygonalGeometry(geometry) {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

function validPolygonalFeaturesFromValue(value, properties = {}) {
  return geoJsonFeaturesFromValue(value, properties)
    .filter((feature) => feature?.geometry && isPolygonalGeometry(feature.geometry));
}

function normalizeAiParcelGeoJson(value, properties = {}) {
  const features = validPolygonalFeaturesFromValue(value, properties);
  if (!features.length) return null;
  if (features.length === 1) return cloneGeoJson(features[0]);
  return cloneGeoJson({ type: 'FeatureCollection', features });
}

function aiGeoJsonCenter(value) {
  const feature = validPolygonalFeaturesFromValue(value)[0];
  if (!feature?.geometry) return null;
  if (typeof turf !== 'undefined' && typeof turf.centroid === 'function') {
    try {
      const centroid = turf.centroid(feature);
      const coords = centroid?.geometry?.coordinates;
      if (Array.isArray(coords) && Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]))) {
        return { lng: Number(coords[0]), lat: Number(coords[1]) };
      }
    } catch (error) {
      console.debug('[AI Detect] could not compute turf parcel center', error);
    }
  }

  const pairs = [];
  const collectPairs = (coords) => {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]))) {
      pairs.push([Number(coords[0]), Number(coords[1])]);
      return;
    }
    coords.forEach(collectPairs);
  };
  collectPairs(feature.geometry.coordinates);
  if (!pairs.length) return null;
  const bounds = pairs.reduce((acc, pair) => ({
    minLng: Math.min(acc.minLng, pair[0]),
    maxLng: Math.max(acc.maxLng, pair[0]),
    minLat: Math.min(acc.minLat, pair[1]),
    maxLat: Math.max(acc.maxLat, pair[1]),
  }), { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });
  if (!Number.isFinite(bounds.minLng) || !Number.isFinite(bounds.minLat)) return null;
  return {
    lng: (bounds.minLng + bounds.maxLng) / 2,
    lat: (bounds.minLat + bounds.maxLat) / 2,
  };
}

function aiQuoteFormLatLng() {
  const form = byId('quoteForm');
  const lat = Number(form?.elements?.lat?.value || 0);
  const lng = Number(form?.elements?.lng?.value || 0);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat && lng ? { lat, lng } : null;
}

function currentAiParcelGeoJson() {
  const parcelProps = state.confirmedParcelProperties
    || state.currentParcelProperties
    || state.selectedParcelProperties
    || state.parcelProperties
    || state.parcelFeature?.properties
    || {};
  const candidateGetters = [
    () => (state.parcelSelectMode ? state.pendingParcelPreviewFeature : null),
    () => state.confirmedParcel,
    () => window.confirmedParcel,
    () => state.currentParcelGeoJSONData,
    () => state.currentParcel,
    () => state.selectedParcelGeoJson,
    () => state.selectedParcelGeoJSON,
    () => state.parcelGeoJson,
    () => state.parcelGeoJSON,
    () => state.currentParcelGeoJson,
    () => state.parcelFeature,
    () => state.parcelLayer,
    () => state.selectedParcel,
    () => window.currentParcelGeoJSONData,
    () => window.currentParcel,
    () => window.selectedParcelGeoJson,
    () => window.selectedParcelGeoJSON,
    () => window.parcelGeoJson,
    () => window.parcelGeoJSON,
    () => window.currentParcelGeoJson,
    () => (typeof currentParcelGeoJSON === 'function' ? currentParcelGeoJSON() : null),
    () => (state.parcelGeometry && typeof esriPolygonToGeoJSONFeature === 'function'
      ? esriPolygonToGeoJSONFeature(state.parcelGeometry, parcelProps)
      : null),
    () => window.currentParcelGeometry,
    () => window.parcelGeometry,
  ];

  for (const getCandidate of candidateGetters) {
    let candidate = null;
    try {
      candidate = getCandidate();
    } catch (error) {
      console.debug('[AI Detect] skipped parcel candidate', error);
    }
    const normalized = normalizeAiParcelGeoJson(candidate, parcelProps);
    if (normalized) return normalized;
  }
  return null;
}

// AI-source pattern list used by multiple guards below.
const _AI_SOURCE_PATTERNS = ['vision', 'sam', 'ai', 'ai_detect', 'auto'];

function _isAiGeneratedFeature(f) {
  const src = String(f?.properties?.source || '').toLowerCase();
  return _AI_SOURCE_PATTERNS.some((pat) => src.includes(pat));
}

function _allFeaturesAreAiGenerated(features) {
  return Array.isArray(features) && features.length > 0 && features.every(_isAiGeneratedFeature);
}

// Returns only human-drawn mow layers — excludes AI/vision/SAM polygons so
// this cannot accidentally feed prior AI output back as a constraint.
function getAiConstraintGeoJson() {
  const features = getAllMowLayers().filter(
    (f) => f && isPolygonalGeometry(f.geometry) && !_isAiGeneratedFeature(f)
  );
  if (!features.length) return null;
  return { type: 'FeatureCollection', features };
}

function mowableFeaturesFromAiResponse(data = {}) {
  if (data.featureCollection?.type === 'FeatureCollection') {
    return geoJsonFeaturesFromValue(data.featureCollection);
  }
  if (Array.isArray(data.features)) {
    return data.features.map((feature) => asFeature(feature)).filter((feature) => feature?.geometry);
  }
  return [];
}

function sanitizeAiMowableFeatures(data = {}, parcelGeoJson = null, selectedAreaGeoJson = null) {
  const source = String(data.source || '').toLowerCase();
  const parcelFeatures = geoJsonFeaturesFromValue(parcelGeoJson);
  const parcelFeature = parcelFeatures.find((feature) => isPolygonalGeometry(feature.geometry)) || null;
  const parcelAreaSqFt = parcelFeature ? layerAreaSqFt(parcelFeature) : 0;
  // When a selected/drawn area exists, use it as the primary clip boundary and for rejection threshold
  const selectedFeatures = selectedAreaGeoJson ? geoJsonFeaturesFromValue(selectedAreaGeoJson) : [];
  const selectedFeature = selectedFeatures.find((feature) => isPolygonalGeometry(feature.geometry)) || null;
  const selectedAreaSqFt = selectedFeature ? layerAreaSqFt(selectedFeature) : 0;
  const clipFeature = selectedFeature || parcelFeature;
  const thresholdAreaSqFt = selectedAreaSqFt > 0 ? selectedAreaSqFt : parcelAreaSqFt;
  const cleaned = [];
  const isFallbackSource = source.includes('fallback') || source.includes('parcel') || source.includes('copy') || source.includes('placeholder');
  const confidenceLabelRaw = String(data.confidence || data.diagnostics?.confidence || data.diagnostics?.confidenceLabel || '');
  const confidence = confidenceLabelRaw === 'beta_low' ? 0.25 : confidenceLabelRaw === 'beta_medium' ? 0.6 : confidenceLabelRaw === 'beta_high' ? 0.9 : Number(data.confidenceScore ?? data.score ?? data.modelConfidence ?? data.mowableConfidence ?? data.confidence);

  if (isFallbackSource) {
    console.warn('[AI Detect] rejected fallback mowable response', { source: data.source });
    return cleaned;
  }

  mowableFeaturesFromAiResponse(data).forEach((feature) => {
    const featureSource = String(feature.properties?.source || '').toLowerCase();
    if (feature.properties?.draft === true || featureSource.includes('fallback') || featureSource.includes('parcel') || featureSource.includes('copy') || featureSource.includes('placeholder')) {
      console.warn('[AI Detect] rejected fallback mowable feature', { source: feature.properties?.source });
      return;
    }

    const normalized = asFeature(feature, {
      source: data.source || feature.properties?.source || 'vision',
      draft: data.source === 'fallback' || feature.properties?.draft === true,
    });
    if (!normalized || !isPolygonalGeometry(normalized.geometry)) return;
    const normalizedAreaSqFt = layerAreaSqFt(normalized);
    if (typeof logGeomContractAi === 'function') {
      logGeomContractAi('frontend received vision GeoJSON', normalized, {
        source: data.source || feature.properties?.source || 'vision',
        isRawPixelMask: false,
        conversionApplied: 'none',
        clippedToParcel: false,
        outsideParcelRatio: 0,
      });
    }

    let candidate = normalized;
    let clippedToParcel = false;
    if (clipFeature && source !== 'fallback' && typeof turf !== 'undefined' && typeof turf.intersect === 'function') {
      try {
        const clipped = turf.intersect(normalized, clipFeature);
        if (clipped?.geometry && isPolygonalGeometry(clipped.geometry)) {
          candidate = asFeature(clipped, normalized.properties);
          clippedToParcel = true;
        }
      } catch (error) {
        console.warn('[AI Detect] could not clip detected feature to boundary', error);
      }
    }

    const areaSqFt = layerAreaSqFt(candidate);
    if (areaSqFt <= 0) return;
    if (typeof logGeomContractAi === 'function') {
      const outsideParcelRatio = normalizedAreaSqFt > 0
        ? Math.max(0, (normalizedAreaSqFt - areaSqFt) / normalizedAreaSqFt)
        : 0;
      logGeomContractAi('frontend sanitized AI GeoJSON before setData', candidate, {
        source: data.source || feature.properties?.source || 'vision',
        isRawPixelMask: false,
        conversionApplied: 'none',
        clippedToParcel,
        outsideParcelRatio: Number(outsideParcelRatio.toFixed(6)),
      });
    }
    if (thresholdAreaSqFt > 0 && areaSqFt > thresholdAreaSqFt * 0.97) {
      console.warn('[AI Detect] rejected boundary-sized mowable feature', { areaSqFt, thresholdAreaSqFt });
      return;
    }

    cleaned.push(candidate);
  });

  const totalAreaSqFt = cleaned.reduce((sum, feature) => sum + layerAreaSqFt(feature), 0);
  if (thresholdAreaSqFt > 0 && totalAreaSqFt > thresholdAreaSqFt * 0.97) {
    console.warn('[AI Detect] rejected boundary-sized mowable response', { totalAreaSqFt, thresholdAreaSqFt });
    return [];
  }

  return cleaned;
}

async function aiDetectMowableArea() {
  console.log('[AI Detect] clicked');

  const map = state.map || window.map || window.TurfLynkAppState?.map || null;
  if (!map) {
    showResult('parcelInfo', '<strong>Map is still loading.</strong><br>Try again in a moment.');
    updateQuoteFlowState();
    return;
  }

  if (state.parcelSelectMode) {
    if (state.pendingParcelFeature && typeof confirmParcelSelection === 'function') {
      try {
        await confirmParcelSelection({ nextStep: 'draw' });
        if (state.pendingParcelFeature) return;
      } catch (error) {
        showError('Parcel selection failed: ' + prettyApiError(error));
        return;
      }
    } else if (typeof exitParcelSelectMode === 'function') {
      exitParcelSelectMode();
    }
  }

  const parcelGeoJson = currentAiParcelGeoJson();
  // Apply global alignment calibration if present before sending geometry to backend
  const _acal = window._globalAlignmentCalibration;
  const effectiveParcelGeoJson = (_acal && typeof applyAlignmentCalibrationToGeoJson === 'function')
    ? applyAlignmentCalibrationToGeoJson(parcelGeoJson, _acal)
    : parcelGeoJson;
  if (_acal && effectiveParcelGeoJson !== parcelGeoJson) {
    console.log('[ALIGNMENT CALIBRATION] applied to AI detect input', JSON.stringify({
      translateLng: _acal.translateLng, translateLat: _acal.translateLat,
      scale: _acal.scale, rotationDeg: _acal.rotationDeg,
    }));
  }
  if (!parcelGeoJson) {
    const msg = 'Select a parcel first, then run AI Detect.';
    showResult('parcelInfo', `<strong>No parcel selected.</strong><br>${escapeHtml(msg)}`);
    showToast(msg, 'warning', { duration: 5000 });
    updateQuoteFlowState();
    return;
  }

  // Anchor the detection base to human-defined geometry.
  // If the user has drawn/lassoed an area, use that as the constraint.
  // If no human area exists yet, fall back to the parcel (no constraintGeoJson).
  // Critically: NEVER use current mow layers directly — they may be prior AI output,
  // which would cause recursive shrinking on repeated clicks.
  if (!state.detectionBaseGeoJson && state.lastHumanDefinedGeoJson) {
    state.detectionBaseGeoJson = state.lastHumanDefinedGeoJson;
    state.detectionBaseSource = state.lastHumanDefinedSource || 'human';
  }
  const constraintGeoJson = state.detectionBaseGeoJson || null;
  const detectionBoundarySource = constraintGeoJson ? (state.detectionBaseSource || 'human') : 'parcel';

  console.log('[AI Detect] detection base', {
    detectionBaseSource: state.detectionBaseSource || 'parcel',
    hasDetectionBase: Boolean(state.detectionBaseGeoJson),
    hasParcelGeoJson: Boolean(parcelGeoJson),
    hasLastHumanDefinedGeoJson: Boolean(state.lastHumanDefinedGeoJson),
    currentMowableSource: String(getAllMowLayers()[0]?.properties?.source || 'none'),
    sendingConstraintFrom: constraintGeoJson ? (state.detectionBaseSource || 'human') : 'none (full parcel)',
    aiUndoAvailable: Boolean(state.previousMowableBeforeAi?.length),
  });
  if (constraintGeoJson) {
    console.debug('[AI Detect] mode:', 'constrained-selection', constraintGeoJson.features?.length || 1);
    console.debug('[AI Detect] boundary source:', detectionBoundarySource);
  } else {
    console.debug('[AI Detect] mode:', 'full-parcel');
    console.debug('[AI Detect] boundary source: parcel');
  }

  // Snapshot current mowable area before AI overwrites it — enables Undo AI
  const _priorMowable = getAllMowLayers();
  state.previousMowableBeforeAi = _priorMowable.length
    ? _priorMowable.map(f => cloneGeoJson(f))
    : null;

  const form = byId('quoteForm');
  const mapCenter = map.getCenter?.();
  const parcelCenter = aiGeoJsonCenter(parcelGeoJson);
  const formPoint = aiQuoteFormLatLng();
  const center = parcelCenter || (mapCenter ? {
    lng: Number(mapCenter.lng ?? mapCenter[0]),
    lat: Number(mapCenter.lat ?? mapCenter[1]),
  } : null);
  const validationPoint = parcelCenter || formPoint || center;
  const validationState = form?.elements?.state?.value || state.currentServiceAddress?.state || '';
  if (!isLngLatInArkansas({ ...validationPoint, state: validationState })) {
    showResult('parcelInfo', `<strong>${escapeHtml(ARKANSAS_ONLY_MESSAGE)}</strong>`);
    showArkansasOnlyWarning({ force: true });
    updateQuoteFlowState();
    return;
  }

  const metadataPoint = formPoint || center;
  const parcelFeature = validPolygonalFeaturesFromValue(state.parcelFeature)[0]
    || validPolygonalFeaturesFromValue(effectiveParcelGeoJson)[0]
    || null;
  const parcelAreaSqft = form
    ? (Number(form.elements.lotAreaSqft?.value || 0) || (typeof layerAreaSqFt === 'function' ? Math.round(layerAreaSqFt(parcelGeoJson)) : 0))
    : (typeof layerAreaSqFt === 'function' ? Math.round(layerAreaSqFt(parcelGeoJson)) : 0);
  const aiRequestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const debugId = `mownwa-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const payload = {
    forceFreshSamOnly: true,
    aiRequestId,
    debugId,
    parcelGeoJson: effectiveParcelGeoJson,
    parcelFeature,
    detection_mode: 'parcel_minus_non_mowable',
    parcelAreaSqft,
    center: center ? {
      lng: Number(center.lng ?? center[0]),
      lat: Number(center.lat ?? center[1]),
    } : null,
    lng: metadataPoint ? Number(metadataPoint.lng ?? metadataPoint[0]) : null,
    lat: metadataPoint ? Number(metadataPoint.lat ?? metadataPoint[1]) : null,
    zoom: Number(map.getZoom?.() || 0) || null,
    address: form ? [form.elements.address?.value, form.elements.city?.value, form.elements.state?.value, form.elements.zip?.value].filter(Boolean).join(', ') : '',
    source: 'maplibre',
    imageSource: {
      type: 'tile',
      provider: 'esri-world-imagery',
      tileUrl: window.SATELLITE_TILE_URL,
      attribution: window.SATELLITE_TILE_ATTRIBUTION,
    },
    detectionBoundarySource,
    ...(constraintGeoJson ? { constraintGeoJson, mowableGeoJson: constraintGeoJson } : {}),
  };

  // Geometry source trace — correlates with [AI INPUT TRACE] in server logs
  const _parcelBbox = (() => {
    try {
      if (typeof turf !== 'undefined' && typeof turf.bbox === 'function') return turf.bbox(parcelGeoJson);
    } catch {}
    return null;
  })();
  const _constraintBbox = constraintGeoJson ? (() => {
    try {
      if (typeof turf !== 'undefined' && typeof turf.bbox === 'function') return turf.bbox(constraintGeoJson);
    } catch {}
    return null;
  })() : null;
  const _constraintAreaSqft = constraintGeoJson ? (() => {
    try {
      return typeof turf !== 'undefined' ? Math.round(turf.area(constraintGeoJson) * 10.7639) : null;
    } catch {}
    return null;
  })() : null;
  console.log('[AI GEOMETRY TRACE]', JSON.stringify({
    parcelBboxWgs84: _parcelBbox,
    constraintBboxWgs84: _constraintBbox,
    parcelAreaSqft,
    constraintAreaSqft: _constraintAreaSqft,
    constraintToParcelRatio: (_constraintAreaSqft && parcelAreaSqft) ? Number((_constraintAreaSqft / parcelAreaSqft).toFixed(3)) : null,
    geometrySource: detectionBoundarySource,
    hasConstraint: Boolean(constraintGeoJson),
    detectionBaseSource: state.detectionBaseSource || 'parcel',
    lastHumanDefinedSource: state.lastHumanDefinedSource || null,
    currentMowableSource: String(getAllMowLayers()[0]?.properties?.source || 'none'),
    mowableLayerCount: getAllMowLayers().length,
  }));
  console.log('[AI Detect] request body', payload);
  console.log('[MowNWA AI Request]', {
    workerUrl: '/api/ai/detect-mowable',
    detection_mode: payload.detection_mode,
    parcelAreaSqft,
    forceFreshSamOnly: payload.forceFreshSamOnly,
    aiRequestId,
    debugId,
  });

  const _existingMowLayers = getAllMowLayers();
  const _inputAreaSqft = constraintGeoJson ? (() => {
    try { return typeof turf !== 'undefined' ? Math.round(turf.area(constraintGeoJson) * 10.7639) : null; } catch { return null; }
  })() : parcelAreaSqft;
  const _inputBBox = (() => {
    try { return (typeof turf !== 'undefined' && typeof turf.bbox === 'function') ? turf.bbox(constraintGeoJson || parcelGeoJson) : null; } catch { return null; }
  })();
  console.log('[AI DETECT INPUT]', JSON.stringify({
    aiInputSource: detectionBoundarySource,
    hasDetectionBase: Boolean(state.detectionBaseGeoJson),
    detectionBaseSource: state.detectionBaseSource || null,
    inputAreaSqft: _inputAreaSqft,
    inputBBox: _inputBBox,
    hasExistingAiGeometry: _existingMowLayers.length > 0 && _allFeaturesAreAiGenerated(_existingMowLayers),
  }));

  // ── ALIGNMENT TRACE: original vs calibrated vs payload geometry ──────────────
  {
    const _origBbox   = (() => { try { return typeof turf !== 'undefined' ? turf.bbox(parcelGeoJson) : null; } catch { return null; } })();
    const _adjBbox    = (() => { try { return typeof turf !== 'undefined' ? turf.bbox(effectiveParcelGeoJson) : null; } catch { return null; } })();
    const _origFirst  = (() => { try { const f = validPolygonalFeaturesFromValue(parcelGeoJson)[0]; return f?.geometry?.coordinates?.[0]?.[0] ?? null; } catch { return null; } })();
    const _adjFirst   = (() => { try { const f = validPolygonalFeaturesFromValue(effectiveParcelGeoJson)[0]; return f?.geometry?.coordinates?.[0]?.[0] ?? null; } catch { return null; } })();
    const _payloadBbox  = (() => { try { return typeof turf !== 'undefined' ? turf.bbox(payload.parcelGeoJson) : null; } catch { return null; } })();
    const _payloadFirst = (() => { try { const f = validPolygonalFeaturesFromValue(payload.parcelGeoJson)[0]; return f?.geometry?.coordinates?.[0]?.[0] ?? null; } catch { return null; } })();
    console.log('[ALIGNMENT TRACE] calibration object', window._globalAlignmentCalibration);
    console.log('[ALIGNMENT TRACE] frontend parcel geometry', {
      hasCalibration: Boolean(_acal),
      calibrationApplied: effectiveParcelGeoJson !== parcelGeoJson,
      originalParcelBbox: _origBbox,
      adjustedParcelBbox: _adjBbox,
      originalFirstCoord: _origFirst,
      adjustedFirstCoord: _adjFirst,
      payloadParcelBbox: _payloadBbox,
      payloadFirstCoord: _payloadFirst,
      parcelSource: detectionBoundarySource,
      bboxDelta: _origBbox && _adjBbox ? [
        +(_adjBbox[0] - _origBbox[0]).toFixed(7),
        +(_adjBbox[1] - _origBbox[1]).toFixed(7),
        +(_adjBbox[2] - _origBbox[2]).toFixed(7),
        +(_adjBbox[3] - _origBbox[3]).toFixed(7),
      ] : null,
    });
  }

  stopToolModes();
  setAiDetectMowableStatus('');
  state.aiDetectMowableLoading = true;
  const loadingStartedAt = Date.now();
  updateQuoteFlowState();
  showResult('parcelInfo', '<strong>Detecting yard (Beta)...</strong><br>Building an editable mowable-area draft.');

  try {
    const token = localStorage.getItem('turflynk.authToken') || '';
    const _liveTraceNocache = Date.now();
    console.log(`[LIVE TRACE] browser sending aiRequestId=${aiRequestId} nocache=${_liveTraceNocache}`);
    const response = await fetch('/api/ai/detect-mowable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    console.log('[AI Detect] response status', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn('[AI Detect] error', errText || `HTTP ${response.status}`);
      const msg = aiDetectFallbackMessage();
      setAiDetectMowableStatus('fallback');
      showResult('parcelInfo', `<strong>Use Lasso Yard</strong><br>${escapeHtml(msg)}`);
      showToast(msg, 'warning', { duration: 6000 });
      return;
    }

    const data = await response.json();
    console.log('[AI Detect] response json', data);
    console.log(`[LIVE TRACE] browser received aiResponseTraceId=${data.aiResponseTraceId ?? 'MISSING'} samRequestId=${data.samRequestId ?? 'MISSING'} backendBuildId=${data.backendBuildId ?? 'MISSING'} nodePid=${data.nodePid ?? 'MISSING'} nodeGitCommit=${data.nodeGitCommit ?? 'MISSING'} nodeGitBranch=${data.nodeGitBranch ?? 'MISSING'} samWorkerUrl=${data.samWorkerUrl ?? data.visionWorkerUrl ?? 'MISSING'} canonicalImageUrl=${data.canonicalImageUrl ?? 'MISSING'} canonicalImageSize=${data.canonicalImageWidth ?? '?'}x${data.canonicalImageHeight ?? '?'} samWorkerHealth=${JSON.stringify(data.samWorkerHealth ?? null)} a5000CacheUsed=${data.a5000CacheUsed ?? 'MISSING'}`);
    {
      const _rcvBboxOf = (f) => { const fc=f?.geometry?.coordinates?.[0]; if(!Array.isArray(fc)||!fc.length) return null; let la=Infinity,lb=Infinity,lc=-Infinity,ld=-Infinity; for(const p of fc){la=Math.min(la,p[0]);lb=Math.min(lb,p[1]);lc=Math.max(lc,p[0]);ld=Math.max(ld,p[1]);} return [+la.toFixed(6),+lb.toFixed(6),+lc.toFixed(6),+ld.toFixed(6)]; };
      const _rcvFeats = Array.isArray(data.features) ? data.features : (Array.isArray(data.featureCollection?.features) ? data.featureCollection.features : []);
      console.log('[AI RESPONSE TRACE] received', JSON.stringify({
        aiResponseTraceId: data.aiResponseTraceId ?? null,
        samWorkerSource: data.samWorkerSource ?? null,
        samWorkerVersion: data.samWorkerVersion ?? null,
        featuresLength: Array.isArray(data.features) ? data.features.length : 0,
        featureCollectionLength: Array.isArray(data.featureCollection?.features) ? data.featureCollection.features.length : 0,
        detectionMode: data.detectionMode || data.detection_mode || data.mode || null,
        areaSqft: data.mowableAreaSqft ?? data.areaSqft ?? null,
        source: data.source ?? null,
        first10Features: _rcvFeats.slice(0, 10).map((f, i) => ({
          i,
          source: f?.properties?.source ?? null,
          componentId: f?.properties?.componentId ?? null,
          bbox: _rcvBboxOf(f),
        })),
      }));
    }
    const diag = data.diagnostics || data.diagnostic || {};
    console.log('[AI Detect] diagnostics', JSON.stringify({
      failureStage: diag.failureStage,
      reason: data.reason || diag.reason || diag.guardrailReason || '',
      parcelAreaSqft: diag.parcelAreaSqft,
      parcelBounds: diag.parcelBounds,
      imageBounds: diag.imageBounds,
      requestedImageWidth: diag.requestedImageWidth,
      requestedImageHeight: diag.requestedImageHeight,
      actualImageWidth: diag.actualImageWidth,
      actualImageHeight: diag.actualImageHeight,
      pixelCount: diag.pixelCount,
      metersPerPixel: diag.metersPerPixel,
      vegetationPixels: diag.vegetationPixels,
      vegetationCandidatePixels: diag.vegetationCandidatePixels,
      hardscapePixels: diag.hardscapePixels,
      polygonCountBeforeFiltering: diag.polygonCountBeforeFiltering,
      polygonCountAfterFiltering: diag.polygonCountAfterFiltering,
      keptComponentCount: diag.keptComponentCount,
      detectedRatio: diag.detectedRatio,
      strictDetectedRatio: diag.strictDetectedRatio,
      softDetectedRatio: diag.softDetectedRatio,
      confidence: diag.confidence,
      lowConfidenceCandidateReturned: diag.lowConfidenceCandidateReturned,
      fallbackSoftMaskUsed: diag.fallbackSoftMaskUsed,
      selectedCandidate: diag.selectedCandidate,
      debugRunDir: diag.debugRunDir,
    }));

    console.log('[MowNWA AI Request] response', {
      responseMode: data.mode || data.detectionMode || data.detection_mode || '',
      confidence: data.confidence || '',
      softCandidate: data.softCandidate ?? null,
      excludedGeoJson: data.excludedGeoJson != null ? '[present]' : null,
      excludedClasses: data.excludedClasses || null,
    });

    renderAiSemanticDiagPanel(data);
    renderCanonicalRasterDebugOverlay(data.diagnostics || data.diagnostic || {});

    // Use effectiveParcelGeoJson (calibrated) so client clip matches backend geometry.
    // constraintGeoJson (human-drawn) is not re-transformed — it was drawn on the calibrated map.
    let features = sanitizeAiMowableFeatures(data, effectiveParcelGeoJson, constraintGeoJson);
    {
      const _sanBboxOf = (f) => { const fc=f?.geometry?.coordinates?.[0]; if(!Array.isArray(fc)||!fc.length) return null; let la=Infinity,lb=Infinity,lc=-Infinity,ld=-Infinity; for(const p of fc){la=Math.min(la,p[0]);lb=Math.min(lb,p[1]);lc=Math.max(lc,p[0]);ld=Math.max(ld,p[1]);} return [+la.toFixed(6),+lb.toFixed(6),+lc.toFixed(6),+ld.toFixed(6)]; };
      const _sanParcel = effectiveParcelGeoJson !== parcelGeoJson ? 'calibrated' : 'original';
      const _sanClipSrc = constraintGeoJson ? 'constraint' : _sanParcel;
      console.log('[AI RESPONSE TRACE] sanitized', JSON.stringify({
        sanitizedCount: features.length,
        clipSource: _sanClipSrc,
        first10Features: features.slice(0, 10).map((f, i) => ({
          i,
          source: f?.properties?.source ?? null,
          componentId: f?.properties?.componentId ?? null,
          areaSqft: (() => { try { return typeof turf !== 'undefined' ? Math.round(turf.area(f) * 10.7639) : null; } catch { return null; } })(),
          bbox: _sanBboxOf(f),
        })),
      }));
    }
    {
      const _origBbox = (() => { try { return typeof turf !== 'undefined' ? turf.bbox(parcelGeoJson) : null; } catch { return null; } })();
      const _effBbox  = (() => { try { return typeof turf !== 'undefined' ? turf.bbox(effectiveParcelGeoJson) : null; } catch { return null; } })();
      const _clipSrc  = constraintGeoJson || effectiveParcelGeoJson;
      const _clipBbox = (() => { try { return typeof turf !== 'undefined' ? turf.bbox(_clipSrc) : null; } catch { return null; } })();
      const _usesEff  = effectiveParcelGeoJson !== parcelGeoJson;
      if (_usesEff && !constraintGeoJson) {
        console.log('[ALIGNMENT CALIBRATION] using calibrated parcel for client clip');
      }
      console.log('[ALIGNMENT TRACE] client clip boundary', {
        originalParcelBbox:  _origBbox,
        effectiveParcelBbox: _effBbox,
        clipBoundaryBbox:    _clipBbox,
        usesEffectiveParcel: _usesEff,
        clipSource: constraintGeoJson ? 'constraint (human-drawn)' : (_usesEff ? 'effectiveParcel (calibrated)' : 'parcel (uncalibrated)'),
      });
    }
    const serverFeaturesCount = Array.isArray(data.features) ? data.features.length
      : (Array.isArray(data.featureCollection?.features) ? data.featureCollection.features.length : 0);
    console.log('[MowNWA AI State] server features count', serverFeaturesCount, '| sanitized features count', features.length);

    // If client-side sanitization rejected features but the server had them, force them through.
    // This handles the case where server polygons slightly exceed the 97% area threshold check.
    if (serverFeaturesCount > 0 && features.length === 0) {
      console.warn('[MowNWA AI State] sanitization rejected all features — forcing raw server features through for manual review');
      const rawFeatures = Array.isArray(data.features) && data.features.length
        ? data.features
        : (Array.isArray(data.featureCollection?.features) ? data.featureCollection.features : []);
      features = rawFeatures
        .filter(f => f && f.geometry)
        .map(f => ({
          type: 'Feature',
          properties: { ...(f.properties || {}), source: 'ai-detect-beta-low-manual-review' },
          geometry: f.geometry,
        }));
      features.forEach((feature) => {
        if (typeof logGeomContractAi === 'function') {
          logGeomContractAi('frontend forced raw server GeoJSON before setData', feature, {
            source: feature.properties?.source || data.source || 'vision',
            isRawPixelMask: false,
            conversionApplied: 'none',
            clippedToParcel: false,
            outsideParcelRatio: null,
          });
        }
      });
      console.log('[MowNWA AI State] forced features count after override:', features.length);
    }

    // Server returned no usable features — guardrail rejection or no detection.
    // Note: server always returns ok:true, so we use features.length and data.reason to detect rejection.
    if (features.length === 0) {
      const rejectionReason = data.reason || diag.reason || diag.guardrailReason || '';
      const failureStage = diag.failureStage || '';

      const preservedExistingFeatures = getMowableFeatureCount() > 0;
      // Ensure any in-progress lasso temp line is gone without discarding a valid manual area.
      if (typeof setLassoTempLine === 'function') setLassoTempLine([]);

      console.warn('[MowNWA AI State] no usable features after server + client pipeline',
        { serverFeaturesCount, rejectionReason, failureStage, preservedExistingFeatures });

      // Reset helper text to prompt manual lasso so the user knows what to do next.
      const _noFeatForm = byId('quoteForm');
      updateMowAreaHelper(Number(_noFeatForm?.elements?.lotAreaSqft?.value || 0), 0);

      let msg;
      if (rejectionReason && rejectionReason !== 'vision service unavailable') {
        msg = `AI detection completed but no confident vegetation area was found. Reason: ${rejectionReason}. Use Lasso Yard to outline the mowable area.`;
      } else {
        msg = aiDetectFallbackMessage(data);
      }
      setAiDetectMowableStatus('fallback');
      showResult('parcelInfo', `<strong>AI Detect: no result</strong><br>${escapeHtml(msg)}`);
      showToast(msg, 'warning', { duration: 8000 });
      return;
    }

    // Commit features into the same mowable-area state used by manual lasso selection.
    console.log('[MowNWA AI State] committing', features.length, 'feature(s) to mowable state');
    features.forEach((feature) => {
      if (typeof logGeomContractAi === 'function') {
        logGeomContractAi('frontend AI commit to MapLibre mowable source', feature, {
          source: feature.properties?.source || data.source || 'vision',
          isRawPixelMask: false,
          conversionApplied: 'none',
          clippedToParcel: true,
          outsideParcelRatio: null,
        });
      }
    });
    state.mowUndoStack = [];
    state.selectedMowableFeatureId = null;
    {
      const _renBboxOf = (f) => { const fc=f?.geometry?.coordinates?.[0]; if(!Array.isArray(fc)||!fc.length) return null; let la=Infinity,lb=Infinity,lc=-Infinity,ld=-Infinity; for(const p of fc){la=Math.min(la,p[0]);lb=Math.min(lb,p[1]);lc=Math.max(lc,p[0]);ld=Math.max(ld,p[1]);} return [+la.toFixed(6),+lb.toFixed(6),+lc.toFixed(6),+ld.toFixed(6)]; };
      console.log('[AI RESPONSE TRACE] render', JSON.stringify({
        renderedCount: features.length,
        aiResponseTraceId: data.aiResponseTraceId ?? null,
        features: features.map((f, i) => ({
          i,
          source: f?.properties?.source ?? null,
          componentId: f?.properties?.componentId ?? null,
          areaSqft: (() => { try { return typeof turf !== 'undefined' ? Math.round(turf.area(f) * 10.7639) : null; } catch { return null; } })(),
          bbox: _renBboxOf(f),
        })),
        mapSourceUpdated: 'mowable-source',
        mowLayerId: 'mowable-fill',
      }));
    }
    setMowableFeatures(features);
    clearCutoutFeatures();
    reorderMapOverlays();
    syncMowAreaFromLayers();
    updateQuoteFlowState();

    const committedCount = getMowableFeatureCount();
    const committedSqFt = Math.round(features.reduce((sum, f) => {
      try { return sum + (typeof turf !== 'undefined' ? turf.area(f) * 10.7639 : 0); } catch { return sum; }
    }, 0));
    console.log('[MowNWA AI State] committed count:', committedCount, '| estimated sqft:', committedSqFt);

    // Genuine rendering failure — features were provided but couldn't be committed to map state.
    if (committedCount === 0) {
      if (constraintGeoJson) setMowableFeatures(constraintGeoJson.features);
      const msg = 'AI returned a yard suggestion, but it could not be displayed. Use Lasso Yard to quickly outline the mowable grass area.';
      console.warn('[MowNWA AI State] render failure — getMowableFeatureCount()=0 after setMowableFeatures');
      setAiDetectMowableStatus('fallback');
      showResult('parcelInfo', `<strong>Use Lasso Yard</strong><br>${escapeHtml(msg)}`);
      showToast(msg, 'warning', { duration: 6000 });
      return;
    }

    console.log('[MowNWA AI State] state committed successfully — refreshing estimate and enabling Next button');

    await refreshEstimate({ force: true }).catch((error) => {
      showError(prettyApiError(error));
    });

    const isFallback = data.source === 'fallback' || features.some((feature) => feature.properties?.source === 'fallback');
    const confidenceLabel = String(data.confidence || data.diagnostics?.confidence || data.diagnostics?.confidenceLabel || '').toLowerCase();
    const isLowConfidence = confidenceLabel === 'beta_low' || Number(data.confidenceScore || 0) < 0.42;
    const successMsg = isFallback
      ? 'AI used a parcel-based draft. Please adjust before booking.'
      : isLowConfidence
        ? 'AI Detect found a low-confidence area. Please review and edit before booking.'
        : 'Beta AI selected likely mowable vegetation by excluding buildings, pavement, roads, and other hard surfaces. Please review and edit before booking.';
    console.log('[MowNWA AI State] success — confidenceLabel:', confidenceLabel, 'isLowConfidence:', isLowConfidence,
      'committedFeatures:', committedCount, 'sqft:', committedSqFt);
    setAiDetectMowableStatus('success');
    showResult('parcelInfo', successMsg);
    showToast(successMsg, isFallback || isLowConfidence ? 'info' : 'success', { duration: 6000 });
    updateQuoteFlowState();
  } catch (error) {
    console.error('[AI Detect] error', error);
    const msg = aiDetectFallbackMessage();
    setAiDetectMowableStatus('fallback');
    showResult('parcelInfo', `<strong>Use Lasso Yard</strong><br>${escapeHtml(msg)}`);
    showToast(msg, 'warning', { duration: 6000 });
  } finally {
    const remainingLoadingMs = 700 - (Date.now() - loadingStartedAt);
    if (remainingLoadingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingLoadingMs));
    state.aiDetectMowableLoading = false;
    updateQuoteFlowState();
  }
}

async function aiRefineMowableArea() {
  if (!state.map || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to refine.</strong>');
    return;
  }

  try {
    showResult(
      'parcelInfo',
      '<strong>AI refining area...</strong><br>Looking for house, driveway, pool, shed, or other non-mowable areas.'
    );

    const mowableFeatures = cloneFeatureCollection(state.mowableFeatureCollection).features;
    const parcelGeometry = exposeCurrentParcelGeometryForAi();

    const payload = {
      parcelGeometry,
      mowableFeatures,
      center: state.map.getCenter(),
      zoom: state.map.getZoom()
    };

    const data = await api('/api/ai/refine-mowable', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const cutouts = data.cutouts || [];

    if (!data.ok || !cutouts.length) {
      showResult(
        'parcelInfo',
        '<strong>AI did not find obvious cutouts.</strong><br>You can still use Cut Out Area manually.'
      );
      return;
    }

    setCutoutFeatures(cutouts);

    showResult(
      'parcelInfo',
      `<strong>AI suggested ${cutouts.length} cutouts.</strong><br>Edit red shapes, then click Apply Cutouts.`
    );
  } catch (error) {
    console.error('AI refine failed', error);
    showResult(
      'parcelInfo',
      `<strong>AI refine failed.</strong><br>${escapeHtml(error.message || error)}`
    );
  }
}

function applyAiCutouts() {
  if (!getCutoutFeatureCount()) {
    showResult('parcelInfo', '<strong>No AI cutouts to apply.</strong>');
    return;
  }

  snapshotMowLayersForUndo();
  state.skipNextCutUndoSnapshot = true;

  try {
    state.aiCutoutFeatureCollection.features.forEach(feature => {
      applyCutToMowable(feature);
    });
  } finally {
    state.skipNextCutUndoSnapshot = false;
  }

  clearCutoutFeatures();
  syncMowAreaFromLayers();

  showResult('parcelInfo', '<strong>AI cutouts applied.</strong>');
}

// ── Admin AI Semantic Diagnostics Panel ──────────────────────────────────────
// Only shown to admins. Never touches customer-facing flow or pricing.

function _aiDiagDebugFileUrl(filePath) {
  if (!filePath) return null;
  return '/api/admin/ai/semantic-debug-file?path=' + encodeURIComponent(filePath);
}

function _aiDiagBand(score) {
  if (score == null || !Number.isFinite(Number(score))) return '';
  const n = Number(score);
  if (n >= 0.7) return 'diag-good';
  if (n >= 0.4) return 'diag-warn';
  return 'diag-bad';
}

function renderAiSemanticDiagPanel(data) {
  if (typeof isAdmin !== 'function' || !isAdmin()) return;
  const diag = data?.diagnostics || {};
  const sem = diag.semantic || {};
  const semDebug = sem.debug || {};
  const hc = diag.hybridConfidence || {};
  const rr = diag.routingRecommendation || {};
  const scp = diag.semanticCleanupProposal || {};

  const hasDiag = hc.score != null || rr.action || scp.suggestedAction || semDebug.overlay;
  if (!hasDiag) return;

  let panel = document.getElementById('ai-semantic-diag-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ai-semantic-diag-panel';
    const anchor = document.getElementById('mowAreaHelper') || document.getElementById('aiDetectGrassStatus');
    if (anchor) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    } else {
      const drawScreen = document.getElementById('quoteDrawScreen');
      if (drawScreen) drawScreen.appendChild(panel);
    }
    panel.addEventListener('click', (e) => {
      if (e.target.closest('.ai-diag-header')) {
        panel.classList.toggle('diag-open');
      }
    });
  }

  const score = hc.score != null ? Number(hc.score).toFixed(3) : '—';
  const action = rr.action || '—';
  const band = rr.confidenceBand || hc.confidenceBand || '—';
  const removePercent = scp.estimatedRemovePercent != null ? Number(scp.estimatedRemovePercent).toFixed(1) + '%' : '—';
  const cleanupAction = scp.suggestedAction || '—';

  const overlayUrl = _aiDiagDebugFileUrl(semDebug.overlay);
  const maskUrl = _aiDiagDebugFileUrl(semDebug.mask);
  const classesUrl = _aiDiagDebugFileUrl(semDebug.classesJson);

  const linkHtml = [
    overlayUrl ? `<a class="ai-diag-link" href="${overlayUrl}" target="_blank" rel="noopener">Semantic Overlay</a>` : '',
    maskUrl    ? `<a class="ai-diag-link" href="${maskUrl}"    target="_blank" rel="noopener">Semantic Mask</a>` : '',
    classesUrl ? `<a class="ai-diag-link" href="${classesUrl}" target="_blank" rel="noopener">Classes JSON</a>` : '',
  ].filter(Boolean).join('');

  panel.innerHTML = `
    <div class="ai-diag-header">
      <span class="ai-diag-header-label">AI Diagnostics (admin)</span>
      <span class="ai-diag-chevron">&#9660;</span>
    </div>
    <div class="ai-diag-body">
      <div class="ai-diag-section-title">AI Routing</div>
      <div class="ai-diag-row"><span class="ai-diag-key">Action</span><span class="ai-diag-val">${escapeHtml(action)}</span></div>
      <div class="ai-diag-row"><span class="ai-diag-key">Confidence band</span><span class="ai-diag-val">${escapeHtml(band)}</span></div>
      <div class="ai-diag-row"><span class="ai-diag-key">Hybrid score</span><span class="ai-diag-val ${_aiDiagBand(hc.score)}">${escapeHtml(score)}</span></div>
      <div class="ai-diag-row"><span class="ai-diag-key">Remove estimate</span><span class="ai-diag-val">${escapeHtml(removePercent)}</span></div>
      <div class="ai-diag-row"><span class="ai-diag-key">Cleanup action</span><span class="ai-diag-val">${escapeHtml(cleanupAction)}</span></div>
      ${linkHtml ? `<div class="ai-diag-section-title">Visual Debug</div><div class="ai-diag-links">${linkHtml}</div>` : ''}
    </div>`;
}

// ── Detection-base state helpers ─────────────────────────────────────────────
// These keep the detection base anchored to human-defined geometry so repeated
// Auto Detect clicks never recurse into prior AI output.

// Call after any human lasso/draw/edit completes.  Records the current mowable
// layers as the authoritative detection base and resets the AI undo snapshot.
// Guard: if all current features are AI-generated, skip recording to prevent
// recursive shrink when Edit → Save Area is clicked without real edits.
function recordHumanDefinedMowableArea(source) {
  const features = getAllMowLayers();
  if (_allFeaturesAreAiGenerated(features)) {
    console.log('[AI DETECT BASE] skipped recording AI-generated geometry', {
      source,
      featureCount: features.length,
      featureSources: features.map(f => f?.properties?.source || 'unknown'),
    });
    return;
  }
  const geoJson = features.length
    ? { type: 'FeatureCollection', features: features.map(f => cloneGeoJson(f)) }
    : null;
  state.detectionBaseGeoJson = geoJson;
  state.detectionBaseSource = geoJson ? (source || 'human') : null;
  state.lastHumanDefinedGeoJson = geoJson;
  state.lastHumanDefinedSource = geoJson ? (source || 'human') : null;
  state.previousMowableBeforeAi = null; // human change resets AI undo
}
window.recordHumanDefinedMowableArea = recordHumanDefinedMowableArea;

// Call when the user clears all mowable areas so next AI detect starts from parcel.
function clearAiDetectionBase() {
  state.detectionBaseGeoJson = null;
  state.detectionBaseSource = null;
  state.previousMowableBeforeAi = null;
}
window.clearAiDetectionBase = clearAiDetectionBase;

// Restore the mowable state that existed just before the last AI detect.
function aiDetectUndoMowable() {
  if (!state.previousMowableBeforeAi) {
    showResult('parcelInfo', '<strong>No AI detect to undo.</strong>');
    return;
  }
  const prev = state.previousMowableBeforeAi;
  state.previousMowableBeforeAi = null;
  setMowableFeatures(prev);
  syncMowAreaFromLayers();
  reorderMapOverlays();
  updateQuoteFlowState();
  showResult('parcelInfo', '<strong>AI Detect undone.</strong><br>Previous mowable area restored.');
  showToast('AI Detect undone.', 'info', { duration: 4000 });
  saveQuoteDraft();
  refreshEstimate({ force: true }).catch(() => {});
}
window.aiDetectUndoMowable = aiDetectUndoMowable;

// ── Canonical Raster Alignment Debug Overlay ─────────────────────────────────
// Renders the exact canonical_naip.png used by SAM as a semi-transparent raster
// layer on the map so you can visually compare it against:
//   1. Esri satellite tiles (background)
//   2. Parcel GeoJSON outline
//   3. Final SAM/mowable polygon
//
// ONLY runs when one of:
//   ?debugCanonical=1 in URL
//   localStorage.MOWNWA_DEBUG_CANONICAL === "1"
//   isAdmin() && state.adminAiDiagnosticsEnabled
//
// Never shown to normal customers.

function _isCanonicalDebugEnabled() {
  try {
    if (new URLSearchParams(window.location.search).get('debugCanonical') === '1') return true;
    if (localStorage.getItem('MOWNWA_DEBUG_CANONICAL') === '1') return true;
  } catch {}
  if (typeof isAdmin === 'function' && isAdmin() &&
      typeof state !== 'undefined' && state.adminAiDiagnosticsEnabled) return true;
  return false;
}

function renderCanonicalRasterDebugOverlay(diagnostics) {
  if (!_isCanonicalDebugEnabled()) return;
  if (!diagnostics || !diagnostics.canonicalImageUrl || !diagnostics.canonicalImageBoundsWgs84) return;
  if (!state.map) return;

  const b = diagnostics.canonicalImageBoundsWgs84; // [minLng, minLat, maxLng, maxLat]
  if (!Array.isArray(b) || b.length < 4) return;
  const [west, south, east, north] = b;

  // Route canonical PNG through Node server proxy — vision service is not publicly exposed
  const proxyUrl = '/api/admin/ai/vision-asset?path=' + encodeURIComponent(diagnostics.canonicalImageUrl);

  console.log(
    '[Canonical Raster Overlay]',
    '\ncanonicalImageUrl:', diagnostics.canonicalImageUrl,
    '\nproxyUrl:', proxyUrl,
    '\ncanonicalImageWidth:', diagnostics.canonicalImageWidth,
    '\ncanonicalImageHeight:', diagnostics.canonicalImageHeight,
    '\ncanonicalImageBoundsWgs84:', b,
    '\ncanonicalImageBounds3857:', diagnostics.canonicalImageBounds3857,
    '\ncanonicalImageTransform:', diagnostics.canonicalImageTransform,
    '\nsamImageSource:', diagnostics.samImageSource,
    '\nsamPixelToGeoMode:', diagnostics.samPixelToGeoMode
  );

  withMapReady(() => {
    const imgSrcId = 'canonical-naip-debug-img';
    const imgLayerId = 'canonical-naip-debug-raster';
    const bndSrcId = 'canonical-naip-debug-bounds';
    const bndLayerId = 'canonical-naip-debug-bounds-line';

    // MapLibre image source corner order: [topLeft, topRight, bottomRight, bottomLeft]
    const coords = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];

    if (state.map.getSource(imgSrcId)) {
      state.map.getSource(imgSrcId).updateImage({ url: proxyUrl, coordinates: coords });
    } else {
      state.map.addSource(imgSrcId, { type: 'image', url: proxyUrl, coordinates: coords });
    }
    if (!state.map.getLayer(imgLayerId)) {
      const beforeId = state.map.getLayer('parcel-fill') ? 'parcel-fill' : undefined;
      state.map.addLayer(
        { id: imgLayerId, type: 'raster', source: imgSrcId, paint: { 'raster-opacity': 0.45 } },
        beforeId
      );
    }

    const boundsGeoJson = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
        },
        properties: {},
      }],
    };
    if (state.map.getSource(bndSrcId)) {
      state.map.getSource(bndSrcId).setData(boundsGeoJson);
    } else {
      state.map.addSource(bndSrcId, { type: 'geojson', data: boundsGeoJson });
    }
    if (!state.map.getLayer(bndLayerId)) {
      state.map.addLayer({
        id: bndLayerId,
        type: 'line',
        source: bndSrcId,
        paint: { 'line-color': '#ff00ff', 'line-width': 2, 'line-dasharray': [4, 2] },
      });
    }
  });
}

// Event listeners — wired here; app.js no longer registers these
function bindAiDetectOnce(id, key, handler) {
  const target = byId(id);
  if (!target) return;
  if (typeof bindTurfLynkOnce === 'function') {
    bindTurfLynkOnce(target, 'click', key, handler);
    return;
  }
  const registry = target.__turflynkAiListenerKeys || (target.__turflynkAiListenerKeys = new Set());
  if (registry.has(key)) return;
  registry.add(key);
  target.addEventListener('click', handler);
}

bindAiDetectOnce('aiDetectPrimaryBtn', 'ai-detect-primary', aiDetectMowableArea);
bindAiDetectOnce('aiDetectMowableBtn', 'ai-detect-mowable', aiDetectMowableArea);
bindAiDetectOnce('aiDetectUndoBtn', 'ai-detect-undo', aiDetectUndoMowable);
bindAiDetectOnce('aiRefineMowableBtn', 'ai-refine-mowable', aiRefineMowableArea);
bindAiDetectOnce('applyAiCutoutsBtn', 'apply-ai-cutouts', applyAiCutouts);
bindAiDetectOnce('editAiCutoutsBtn', 'edit-ai-cutouts', startEditAiCutouts);
