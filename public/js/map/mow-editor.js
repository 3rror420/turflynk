// public/js/map/mow-editor.js
// Phase 12a/12c: mowable-area / editor helpers extracted from app.js
//
// Runtime deps (all resolved via shared global scope at call time):
//   state                                   → state.js (loaded before)
//   byId, sqftToAcres, formatAcres          → dom.js (loaded before)
//   showResult                              → dom.js (loaded before)
//   turf                                    → CDN (loaded before)
//   maplibregl                              → CDN (loaded before)
//   setMapMode, cloneFeatureCollection      → map-core.js (loaded before)
//   MAP_SOURCES, EMPTY_FEATURE_COLLECTION   → map-core.js (loaded before)
//   setSourceData                           → map-core.js (loaded before)
//   updateQuoteFlowState                    → quote-flow.js (loaded before)
//   asFeature                               → app.js (loaded after; called at runtime)
//   saveQuoteDraft, scheduleEstimateRefresh → app.js (loaded after; called at runtime)
//   showSuccess                             → app.js (via window.showSuccess; called at runtime)
//   stopToolModes                           → app.js (via window.stopToolModes; called at runtime)

// -- Editor status text --

function setEditorModeLabel(text) {
  const el = byId('mowEditorMode');
  if (!el) return;
  el.textContent = text;
}

// -- Simple GeoJSON feature list helpers --

function getAllMowLayers() {
  return state.mowableFeatureCollection?.features || [];
}

function getMowableFeatureCount() {
  return state.mowableFeatureCollection?.features?.length || 0;
}

function getCutoutFeatureCount() {
  return state.aiCutoutFeatureCollection?.features?.length || 0;
}

function mowableFeatureId(feature) {
  return feature?.id || feature?.properties?.id || '';
}

// -- Selected mowable feature helpers --

function markSelectedMowableFeature() {
  const selectedId = state.selectedMowableFeatureId ? String(state.selectedMowableFeatureId) : '';
  (state.mowableFeatureCollection?.features || []).forEach((feature) => {
    feature.properties = feature.properties || {};
    feature.properties.selected = Boolean(selectedId && String(mowableFeatureId(feature)) === selectedId);
  });
}

function selectMowableFeature(featureId) {
  state.selectedMowableFeatureId = featureId ? String(featureId) : null;
  markSelectedMowableFeature();
  updateMowableSource();
  updateQuoteFlowState();
  if (featureId) setEditorModeLabel('Mode: Area selected');
}

function removeSelectedMowableFeature() {
  const selectedId = state.selectedMowableFeatureId ? String(state.selectedMowableFeatureId) : '';
  if (!selectedId) return false;
  const features = getAllMowLayers().filter((feature) => String(mowableFeatureId(feature)) !== selectedId);
  if (features.length === getMowableFeatureCount()) return false;
  state.selectedMowableFeatureId = null;
  setMowableFeatures(features);
  syncMowAreaFromLayers();
  return true;
}

// -- Area sqft / display helpers --

function layerAreaSqFt(feature) {
  if (!feature) return 0;
  try {
    const sqm = turf.area(feature);
    return Math.round(sqm * 10.7639);
  } catch {
    return 0;
  }
}

function totalMowAreaSqFt() {
  return getAllMowLayers().reduce((sum, feature) => sum + layerAreaSqFt(feature), 0);
}

function currentDrawnMowAreaSqFt() {
  return Math.round(totalMowAreaSqFt());
}

function refreshAreaDisplays(lotSqft, mowSqft) {
  const lotEl = byId('lotAreaAcresDisplay');
  const mowEl = byId('mowAreaAcresDisplay');
  if (lotEl) {
    const n = Math.round(Number(lotSqft || 0));
    lotEl.textContent = n > 0 ? `${sqftToAcres(n).toFixed(2)} acres  ·  ${n.toLocaleString()} sq ft` : '';
  }
  if (mowEl) {
    const n = Math.round(Number(mowSqft || 0));
    mowEl.textContent = n > 0 ? `${sqftToAcres(n).toFixed(2)} acres  ·  ${n.toLocaleString()} sq ft` : '';
  }
}

function hasActiveMowableArea() {
  return currentDrawnMowAreaSqFt() > 0;
}

// -- Mow area form update helpers --

function clearStaleMowAreaWithoutPolygon(form = byId('quoteForm')) {
  if (!form || currentDrawnMowAreaSqFt() > 0) return;
  form.elements.mowAreaSqft.value = '';
  if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = '';
  state.pendingQuote = null;
}

function updateMowAreaHelper(parcelSqFt, mowSqFt) {
  refreshAreaDisplays(parcelSqFt, mowSqFt);
  const helper = byId('mowAreaHelper');
  if (!helper) return;

  if (!mowSqFt) {
    helper.textContent = 'Drag around the grass area. Lift your finger to finish.';
    return;
  }

  const pct = parcelSqFt ? Math.round((mowSqFt / parcelSqFt) * 100) : null;
  helper.textContent = `Area selected: ${formatAcres(mowSqFt)}${pct ? ` (${pct}% of parcel)` : ''}. Use Edit or Redraw if needed.`;
}

function syncMowAreaFromLayers() {
  const form = byId('quoteForm');
  if (!form) return;

  const totalSqFt = currentDrawnMowAreaSqFt();
  const _syncLayers = getMowableFeatureCount();
  const _syncLot = Number(form.elements.lotAreaSqft?.value || 0);
  const _syncPct = _syncLot > 0 ? Math.round((totalSqFt / _syncLot) * 100) : null;
  console.log('[TurfLynk Area Trace] B. syncMowAreaFromLayers | mowAreaSqft=' + totalSqFt + ' lotAreaSqft=' + _syncLot + (_syncPct !== null ? ' (' + _syncPct + '% of parcel)' : '') + ' layers=' + _syncLayers + ' source=drawGroup');
  form.elements.mowAreaSqft.value = totalSqFt || '';
  if (form.elements.customerAdjustedMowableSqft) {
    form.elements.customerAdjustedMowableSqft.value = totalSqFt || '';
  }
  if (form.elements.lotSource) {
    form.elements.lotSource.value = 'customer_adjusted_outline';
  }
  state.pendingQuote = null;

  updateMowAreaHelper(
    Number(form.elements.lotAreaSqft.value || 0),
    totalSqFt
  );

  saveQuoteDraft();
  scheduleEstimateRefresh('mow-area-sync');
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
}

// Expose for lasso-yard.js and ai-detect-grass.js which check window.syncMowAreaFromLayers
window.syncMowAreaFromLayers = syncMowAreaFromLayers;

// -- Button visibility / map tool state helpers --

function setElementVisible(id, visible) {
  const el = byId(id);
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

function setMapToolPanelOpen(open) {
  const panel = byId('mapToolsPanel');
  if (!panel) return;
  const allowOpen = Boolean(open && state.parcelLayer);
  panel.classList.toggle('hidden', !allowOpen);
  setElementVisible('mapToolsToggle', Boolean(state.parcelLayer && state.quoteFlowStep === 'draw' && !allowOpen));
}

// -- Lasso mode activation (Phase 12b) --
// All lasso drawing interaction (point collection, event handlers, polygon completion)
// lives in public/js/lasso-yard.js (loaded after app.js, exposes window.TurfLynkLassoYard).
// This function only activates lasso mode and updates editor UI state.

function startDrawMowable() {
  if (!state.map) return;
  // stopToolModes is defined in app.js (handles edit/delete/move mode cleanup); resolved at runtime
  if (typeof window.stopToolModes === 'function') window.stopToolModes();
  state.quoteUiMode = 'drawing';
  if (window.TurfLynkLassoYard?.arm) window.TurfLynkLassoYard.arm();
  setEditorModeLabel('Mode: Drag on map to draw');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}

window.startDrawMowable = startDrawMowable;

// -- Phase 12c: Edit handle helpers (moved from app.js) --

function clearEditHandles() {
  (state.editMarkers || []).forEach((marker) => {
    try { marker.remove(); } catch {}
  });
  state.editMarkers = [];
}

function getEditableRings(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring, ringIndex) => ({ ring, path: [ringIndex] }));
  }
  if (geometry.type === 'MultiPolygon') {
    const rings = [];
    geometry.coordinates.forEach((polygon, polygonIndex) => {
      polygon.forEach((ring, ringIndex) => rings.push({ ring, path: [polygonIndex, ringIndex] }));
    });
    return rings;
  }
  return [];
}

function getRingByPath(feature, path) {
  if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates[path[0]];
  return feature.geometry.coordinates[path[0]][path[1]];
}

function buildEditHandles() {
  clearEditHandles();
  if (!state.map || typeof maplibregl === 'undefined') return;
  getAllMowLayers().forEach((feature, featureIndex) => {
    getEditableRings(feature).forEach(({ ring, path }) => {
      ring.slice(0, -1).forEach((coord, coordIndex) => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'maplibre-edit-handle';
        handle.setAttribute('aria-label', 'Move vertex');
        const marker = new maplibregl.Marker({ element: handle, draggable: true })
          .setLngLat(coord)
          .addTo(state.map);
        marker.on('drag', () => {
          const next = marker.getLngLat();
          const targetFeature = state.mowableFeatureCollection.features[featureIndex];
          const targetRing = getRingByPath(targetFeature, path);
          targetRing[coordIndex] = [next.lng, next.lat];
          if (coordIndex === 0) targetRing[targetRing.length - 1] = [next.lng, next.lat];
          updateMowableSource();
          updateMowAreaHelper(
            Number(byId('quoteForm')?.elements?.lotAreaSqft?.value || 0),
            currentDrawnMowAreaSqFt()
          );
        });
        marker.on('dragend', () => {
          syncMowAreaFromLayers();
        });
        state.editMarkers.push(marker);
      });
    });
  });
}

// -- Phase 12c: Enter edit / delete mode (moved from app.js) --

function startEditMowable() {
  if (!state.map || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to edit.</strong><br>Use Parcel Shape, Smart Draft, or Draw Area first.');
    return;
  }

  if (typeof window.stopToolModes === 'function') window.stopToolModes();
  setMapMode('edit');
  state.quoteUiMode = 'editing';
  state.editSnapshot = cloneFeatureCollection(state.mowableFeatureCollection).features;
  buildEditHandles();
  setEditorModeLabel('Mode: Drag green handles to adjust the mowable area');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}

function startDeleteMowable() {
  if (!state.map || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to delete.</strong>');
    return;
  }

  if (typeof window.stopToolModes === 'function') window.stopToolModes();
  if (removeSelectedMowableFeature()) {
    state.quoteUiMode = 'idle';
    setEditorModeLabel('Mode: Selected area deleted');
    setMapToolPanelOpen(true);
    updateQuoteFlowState();
    if (typeof window.showSuccess === 'function') window.showSuccess('Selected area deleted');
    return;
  }
  setMapMode('edit');
  state.editSnapshot = null;
  clearMowableFeatures();
  syncMowAreaFromLayers();
  state.quoteUiMode = 'idle';
  setEditorModeLabel('Mode: Mowable areas deleted');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}

window.startEditMowable = startEditMowable;
window.startDeleteMowable = startDeleteMowable;
window.buildEditHandles = buildEditHandles;
window.clearEditHandles = clearEditHandles;

// -- Phase 12c: Edit/Save/Delete button handlers (moved from app.js) --

byId('editMowableBtn')?.addEventListener('click', startEditMowable);
byId('deleteMowableBtn')?.addEventListener('click', startDeleteMowable);

byId('saveAreaBtn')?.addEventListener('click', () => {
  if (typeof window.stopToolModes === 'function') window.stopToolModes();
  state.editSnapshot = null;
  syncMowAreaFromLayers();
  setMapToolPanelOpen(true);
});

byId('cancelEditAreaBtn')?.addEventListener('click', () => {
  const shouldRestoreEdit = state.quoteUiMode === 'editing' && Array.isArray(state.editSnapshot);
  if (typeof window.stopToolModes === 'function') window.stopToolModes();
  if (shouldRestoreEdit) {
    setMowableFeatures(state.editSnapshot);
    state.editSnapshot = null;
    syncMowAreaFromLayers();
  }
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
});

// -- Phase 12d: Cutout / Undo logic (moved from app.js) --

function snapshotMowLayersForUndo() {
  const features = cloneFeatureCollection(state.mowableFeatureCollection).features;

  state.mowUndoStack = state.mowUndoStack || [];
  state.mowUndoStack.push(features);

  // keep it light
  if (state.mowUndoStack.length > 10) {
    state.mowUndoStack.shift();
  }
}

function restoreMowLayersFromSnapshot(features) {
  if (!Array.isArray(features)) return;
  setMowableFeatures(features);

  syncMowAreaFromLayers();
  setTimeout(() => {
    startEditMowable();
  }, 0);
}

function undoLastCut() {
  const stack = state.mowUndoStack || [];

  if (!stack.length) {
    showResult('parcelInfo', '<strong>Nothing to undo.</strong>');
    return;
  }

  const last = stack.pop();
  restoreMowLayersFromSnapshot(last);

  showResult('parcelInfo', '<strong>Last cut undone.</strong>');
}

function startCutMowable() {
  if (!state.map || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to cut.</strong>');
    return;
  }

  if (typeof window.stopToolModes === 'function') window.stopToolModes();
  state.quoteUiMode = 'drawing';
  if (window.TurfLynkLassoYard?.armCut) window.TurfLynkLassoYard.armCut();
  setEditorModeLabel('Mode: Draw area to CUT OUT');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}

function applyCutToMowable(cutLayer) {
  try {
    if (!state.skipNextCutUndoSnapshot) {
      snapshotMowLayersForUndo();
    }

    const cutGeo = asFeature(cutLayer);
    if (!cutGeo) return;
    const newFeatures = [];

    getAllMowLayers().forEach((gj) => {

      try {
        const diff = turf.difference(gj, cutGeo);

        if (!diff) return;

        if (diff.geometry.type === 'Polygon') {
          newFeatures.push(diff);
        } else if (diff.geometry.type === 'MultiPolygon') {
          newFeatures.push(diff);
        }
      } catch (err) {
        console.warn('Cut failed on layer', err);
      }
    });

    setMowableFeatures(newFeatures);

    syncMowAreaFromLayers();
  } catch (err) {
    console.error('applyCutToMowable failed', err);
  }
}

window.startCutMowable = startCutMowable;
window.undoLastCut = undoLastCut;
window.applyTurfLynkCutFeature = applyCutToMowable;

byId('cutMowableBtn')?.addEventListener('click', startCutMowable);
byId('undoCutBtn')?.addEventListener('click', undoLastCut);

// -- Phase 12e: Core mow feature management (moved from app.js) --

function updateMowableSource() {
  markSelectedMowableFeature();
  setSourceData(MAP_SOURCES.mowable, state.mowableFeatureCollection || EMPTY_FEATURE_COLLECTION());
}

function setMowableFeatures(features = []) {
  const previousSelectedId = state.selectedMowableFeatureId;
  state.mowableFeatureCollection = {
    type: 'FeatureCollection',
    features: features.map((feature, index) => {
      const normalized = asFeature(feature);
      if (!normalized) return null;
      const id = normalized.id || normalized.properties?.id || `mowable-${index}-${Date.now()}`;
      return {
        ...normalized,
        id,
        properties: {
          ...(normalized.properties || {}),
          id,
          role: 'mowable',
        },
      };
    }).filter((feature) => feature?.geometry),
  };
  if (previousSelectedId && !state.mowableFeatureCollection.features.some((feature) => String(feature.id || feature.properties?.id) === String(previousSelectedId))) {
    state.selectedMowableFeatureId = null;
  }
  state.drawGroup = state.mowableFeatureCollection;
  window.mowableFeatureCollection = state.mowableFeatureCollection;
  updateMowableSource();
}

// Expose for lasso-yard.js, ai-detect.js, and external callers
window.setTurfLynkMowableFeatures = setMowableFeatures;

function clearMowableFeatures() {
  state.selectedMowableFeatureId = null;
  setMowableFeatures([]);
}

// -- Phase 12e: Move/drag helpers (moved from app.js) --

function styleMowLayer(layer) {
  return asFeature(layer, { role: 'mowable' });
}

function eachLatLng(latlngs, fn) {
  latlngs.forEach((item) => {
    if (Array.isArray(item)) eachLatLng(item, fn);
    else if (item && Number.isFinite(item.lat) && Number.isFinite(item.lng)) fn(item);
  });
}

function translateLayerLatLngs(layer, fromLatLng, toLatLng) {
  if (!state.map || !layer?.getLatLngs || !layer.setLatLngs) return;

  const from = state.map.project(fromLatLng);
  const to = state.map.project(toLatLng);
  const delta = to.subtract(from);
  const latlngs = layer.getLatLngs();

  eachLatLng(latlngs, (latlng) => {
    const point = state.map.project(latlng).add(delta);
    const moved = state.map.unproject(point);
    latlng.lat = moved.lat;
    latlng.lng = moved.lng;
  });

  layer.setLatLngs(latlngs);
}

function attachMowableMoveHandlers(layer) {
  return layer;
}

function finishMowableMove() {
  if (!state.moveDrag) return;
  const moved = state.moveDrag.moved;
  state.moveDrag = null;

  if (moved) {
    syncMowAreaFromLayers();
  }

  setEditorModeLabel('Mode: Editing mowable areas');
}

function eventLatLng(event) {
  if (event?.latlng) return event.latlng;
  const lngLat = event?.lngLat;
  return lngLat ? { lat: lngLat.lat, lng: lngLat.lng } : null;
}

function installMowableMoveMapHandlers() {
  if (!state.map || state._mowMoveHandlersInstalled) return;
  state._mowMoveHandlersInstalled = true;
}
