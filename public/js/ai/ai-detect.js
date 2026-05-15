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

function getAiConstraintGeoJson() {
  const features = getAllMowLayers().filter(
    (f) => f && isPolygonalGeometry(f.geometry)
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

    let candidate = normalized;
    if (clipFeature && source !== 'fallback' && typeof turf !== 'undefined' && typeof turf.intersect === 'function') {
      try {
        const clipped = turf.intersect(normalized, clipFeature);
        if (clipped?.geometry && isPolygonalGeometry(clipped.geometry)) {
          candidate = asFeature(clipped, normalized.properties);
        }
      } catch (error) {
        console.warn('[AI Detect] could not clip detected feature to boundary', error);
      }
    }

    const areaSqFt = layerAreaSqFt(candidate);
    if (areaSqFt <= 0) return;
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
  if (!parcelGeoJson) {
    const msg = 'Select a parcel first, then run AI Detect.';
    showResult('parcelInfo', `<strong>No parcel selected.</strong><br>${escapeHtml(msg)}`);
    showToast(msg, 'warning', { duration: 5000 });
    updateQuoteFlowState();
    return;
  }

  const constraintGeoJson = getAiConstraintGeoJson();
  const detectionBoundarySource = constraintGeoJson ? 'mowable' : 'parcel';
  if (constraintGeoJson) {
    console.debug('[AI Detect] mode:', 'constrained-selection', constraintGeoJson.features.length);
    console.debug('[AI Detect] boundary source: mowable');
  } else {
    console.debug('[AI Detect] mode:', 'full-parcel');
    console.debug('[AI Detect] boundary source: parcel');
  }

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
    || validPolygonalFeaturesFromValue(parcelGeoJson)[0]
    || null;
  const payload = {
    parcelGeoJson,
    parcelFeature,
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

  console.log('[AI Detect] request body', payload);

  stopToolModes();
  setAiDetectMowableStatus('');
  state.aiDetectMowableLoading = true;
  const loadingStartedAt = Date.now();
  updateQuoteFlowState();
  showResult('parcelInfo', '<strong>Detecting yard (Beta)...</strong><br>Building an editable mowable-area draft.');

  try {
    const token = localStorage.getItem('turflynk.authToken') || '';
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

    renderAiSemanticDiagPanel(data);

    let features = sanitizeAiMowableFeatures(data, parcelGeoJson, constraintGeoJson);
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
      console.log('[MowNWA AI State] forced features count after override:', features.length);
    }

    // Server returned no usable features — guardrail rejection or no detection.
    // Note: server always returns ok:true, so we use features.length and data.reason to detect rejection.
    if (features.length === 0) {
      const rejectionReason = data.reason || diag.reason || diag.guardrailReason || '';
      const failureStage = diag.failureStage || '';

      // Clear any stale mowable polygon so no shape remains on the map when AI finds nothing.
      // This prevents a prior lasso draw or previous AI result from confusing the user.
      const staleFeaturesCleared = getMowableFeatureCount() > 0;
      if (staleFeaturesCleared) clearMowableFeatures();
      // Belt-and-suspenders: ensure any in-progress lasso temp line is also gone.
      if (typeof setLassoTempLine === 'function') setLassoTempLine([]);

      console.warn('[MowNWA AI State] no usable features after server + client pipeline',
        { serverFeaturesCount, rejectionReason, failureStage, staleFeaturesCleared });

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
    state.mowUndoStack = [];
    state.selectedMowableFeatureId = null;
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
bindAiDetectOnce('aiRefineMowableBtn', 'ai-refine-mowable', aiRefineMowableArea);
bindAiDetectOnce('applyAiCutoutsBtn', 'apply-ai-cutouts', applyAiCutouts);
bindAiDetectOnce('editAiCutoutsBtn', 'edit-ai-cutouts', startEditAiCutouts);
