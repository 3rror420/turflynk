// map-core.js — MapLibre map infrastructure (Phase 11 extraction from app.js)
// Loads before app.js. All functions become global. No ES modules.
// Do NOT add lasso drawing, manual polygon editing, or mow-editor logic here.

// --- Tile constants ---

const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_TILE_ATTRIBUTION = 'Tiles Esri';
window.SATELLITE_TILE_URL = SATELLITE_TILE_URL;
window.SATELLITE_TILE_ATTRIBUTION = SATELLITE_TILE_ATTRIBUTION;

// --- GeoJSON helpers ---

const EMPTY_FEATURE_COLLECTION = () => ({ type: 'FeatureCollection', features: [] });

const MAP_SOURCES = {
  parcel: 'parcel-source',
  mowable: 'mowable-source',
  building: 'building-footprint-source',
  cutout: 'cutout-source',
  lasso: 'lasso-temp-source',
  previewParcel: 'preview-parcel-source',
  addressMarker: 'address-marker-source',
  gpsMarker: 'gps-marker-source',
};

function latLngToLngLat(center = DEFAULT_MAP_CENTER) {
  return [Number(center[1]), Number(center[0])];
}

function cloneFeatureCollection(collection) {
  return {
    type: 'FeatureCollection',
    features: (collection?.features || []).map((feature) => {
      try {
        return JSON.parse(JSON.stringify(feature));
      } catch {
        return feature;
      }
    }),
  };
}

function cloneGeoJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function currentParcelGeoJSON() {
  return (
    state.currentParcelGeoJSONData ||
    state.currentParcelGeoJson ||
    state.selectedParcelGeoJSON ||
    state.selectedParcelGeoJson ||
    state.parcelGeoJSON ||
    state.parcelGeoJson ||
    window.currentParcelGeoJSONData ||
    window.currentParcelGeoJson ||
    window.selectedParcelGeoJSON ||
    window.selectedParcelGeoJson ||
    window.parcelGeoJSON ||
    window.parcelGeoJson ||
    null
  );
}

function currentMapScopeSnapshot() {
  if (!state.map) return {};
  const center = state.map.getCenter?.();
  const bounds = state.map.getBounds?.();
  const snapshot = {};
  if (center) {
    snapshot.mapCenter = {
      lng: Number(center.lng ?? center[0]),
      lat: Number(center.lat ?? center[1]),
      zoom: Number(state.map.getZoom?.() || 0) || undefined,
    };
  }
  if (bounds) {
    snapshot.mapBounds = {
      west: Number(bounds.getWest?.() ?? bounds._sw?.lng),
      south: Number(bounds.getSouth?.() ?? bounds._sw?.lat),
      east: Number(bounds.getEast?.() ?? bounds._ne?.lng),
      north: Number(bounds.getNorth?.() ?? bounds._ne?.lat),
    };
  }
  return snapshot;
}

// --- Map mode ---

const MAP_MODES = new Set(['idle', 'lasso', 'select', 'edit', 'pan']);

function setMapMode(mode = 'idle') {
  const nextMode = MAP_MODES.has(mode) ? mode : 'idle';
  state.mapMode = nextMode;
  document.body.dataset.mapMode = nextMode;
  return nextMode;
}

function getMapMode() {
  return MAP_MODES.has(state.mapMode) ? state.mapMode : 'idle';
}

// --- Map gesture capture ---

function setMapGestureCapture(enabled) {
  if (!state.map) return;
  ['dragPan', 'scrollZoom', 'boxZoom', 'keyboard', 'doubleClickZoom', 'dragRotate'].forEach((key) => {
    const control = state.map[key];
    if (!control) return;
    try {
      if (enabled && typeof control.enable === 'function') control.enable();
      if (!enabled && typeof control.disable === 'function') control.disable();
    } catch {}
  });
}

// --- Source data primitives ---

function setSourceData(sourceId, data = EMPTY_FEATURE_COLLECTION()) {
  const source = state.map?.getSource?.(sourceId);
  if (source?.setData) source.setData(data);
}

function setPointSource(sourceId, lng, lat) {
  const hasPoint = Number.isFinite(Number(lng)) && Number.isFinite(Number(lat));
  setSourceData(sourceId, hasPoint ? {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    }],
  } : EMPTY_FEATURE_COLLECTION());
}

// --- Per-source updaters (pure layer/source sync, no mow-editor logic) ---
// updateMowableSource is intentionally left in app.js: it calls markSelectedMowableFeature()
// which is mow-editor state logic.

function updateParcelSource() {
  setSourceData(MAP_SOURCES.parcel, state.parcelFeature ? {
    type: 'FeatureCollection',
    features: [state.parcelFeature],
  } : EMPTY_FEATURE_COLLECTION());
}

function updateCutoutSource() {
  setSourceData(MAP_SOURCES.cutout, state.aiCutoutFeatureCollection || EMPTY_FEATURE_COLLECTION());
}

function updateBuildingFootprintSource() {
  setSourceData(MAP_SOURCES.building, state.buildingFootprintFeatureCollection || EMPTY_FEATURE_COLLECTION());
}

function updatePreviewParcelSource() {
  setSourceData(MAP_SOURCES.previewParcel, state.pendingParcelPreviewFeature ? {
    type: 'FeatureCollection',
    features: [state.pendingParcelPreviewFeature],
  } : EMPTY_FEATURE_COLLECTION());
}

function setLassoTempLine(points = []) {
  const coords = points.map((point) => [point.lng, point.lat]);
  setSourceData(MAP_SOURCES.lasso, coords.length > 1 ? {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    }],
  } : EMPTY_FEATURE_COLLECTION());
}

// --- Layer setup ---

function ensureMapLayer(id, config, beforeId) {
  if (state.map.getLayer(id)) return;
  state.map.addLayer({ id, ...config }, beforeId);
}

function ensureMapLibreSourcesAndLayers() {
  if (!state.map || !state.map.isStyleLoaded?.()) return false;
  Object.values(MAP_SOURCES).forEach((id) => {
    if (!state.map.getSource(id)) {
      state.map.addSource(id, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION() });
    }
  });

  ensureMapLayer('parcel-fill', {
    type: 'fill',
    source: MAP_SOURCES.parcel,
    paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.08 },
  });
  ensureMapLayer('parcel-line', {
    type: 'line',
    source: MAP_SOURCES.parcel,
    paint: { 'line-color': '#38bdf8', 'line-width': 3 },
  });
  ensureMapLayer('building-footprint-fill', {
    type: 'fill',
    source: MAP_SOURCES.building,
    paint: { 'fill-color': '#f97316', 'fill-opacity': 0.24 },
  });
  ensureMapLayer('building-footprint-line', {
    type: 'line',
    source: MAP_SOURCES.building,
    paint: { 'line-color': '#f97316', 'line-width': 2 },
  });
  ensureMapLayer('mowable-fill', {
    type: 'fill',
    source: MAP_SOURCES.mowable,
    paint: {
      'fill-color': ['case', ['boolean', ['get', 'selected'], false], '#22c55e', '#16a34a'],
      'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.36, 0.22],
    },
  });
  ensureMapLayer('mowable-line', {
    type: 'line',
    source: MAP_SOURCES.mowable,
    paint: {
      'line-color': ['case', ['boolean', ['get', 'selected'], false], '#facc15', '#16a34a'],
      'line-width': ['case', ['boolean', ['get', 'selected'], false], 5, 3],
    },
  });
  ensureMapLayer('cutout-fill', {
    type: 'fill',
    source: MAP_SOURCES.cutout,
    paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 },
  });
  ensureMapLayer('cutout-line', {
    type: 'line',
    source: MAP_SOURCES.cutout,
    paint: { 'line-color': '#ef4444', 'line-width': 3 },
  });
  ensureMapLayer('preview-parcel-fill', {
    type: 'fill',
    source: MAP_SOURCES.previewParcel,
    paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.15 },
  });
  ensureMapLayer('preview-parcel-line', {
    type: 'line',
    source: MAP_SOURCES.previewParcel,
    paint: { 'line-color': '#f59e0b', 'line-width': 3 },
  });
  ensureMapLayer('lasso-temp-line', {
    type: 'line',
    source: MAP_SOURCES.lasso,
    paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-opacity': 0.9 },
  });
  ensureMapLayer('address-marker', {
    type: 'circle',
    source: MAP_SOURCES.addressMarker,
    paint: {
      'circle-radius': 7,
      'circle-color': '#2563eb',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
  ensureMapLayer('gps-marker', {
    type: 'circle',
    source: MAP_SOURCES.gpsMarker,
    paint: {
      'circle-radius': 8,
      'circle-color': '#f59e0b',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });

  updateParcelSource();
  // updateMowableSource is in app.js (calls markSelectedMowableFeature, mow-editor logic)
  if (typeof updateMowableSource === 'function') updateMowableSource();
  updateCutoutSource();
  updateBuildingFootprintSource();
  updatePreviewParcelSource();
  setLassoTempLine([]);
  return true;
}

function withMapReady(fn) {
  if (!state.map) return;
  if (ensureMapLibreSourcesAndLayers()) {
    fn();
    return;
  }
  state.map.once('load', () => {
    ensureMapLibreSourcesAndLayers();
    fn();
  });
}

// --- Viewport / bounds ---

function fitBoundsWithContext(boundsOrFeature, options = {}) {
  if (!state.map || !boundsOrFeature) return;
  const fitOptions = { ...PARCEL_FIT_OPTIONS, ...options };
  let bounds = boundsOrFeature;
  if (boundsOrFeature.type === 'Feature' || boundsOrFeature.type === 'FeatureCollection' || boundsOrFeature.type === 'Polygon' || boundsOrFeature.type === 'MultiPolygon') {
    try {
      const bbox = turf.bbox(boundsOrFeature);
      if (bbox.some((value) => !Number.isFinite(value))) return;
      bounds = [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
    } catch {
      return;
    }
  }

  state.map.resize?.();
  state.map.fitBounds(bounds, fitOptions);

  setTimeout(() => {
    if (!state.map) return;
    state.map.resize?.();
    state.map.fitBounds(bounds, fitOptions);
  }, 100);
}

function fitLayerBoundsWithContext(layer, options = {}) {
  fitBoundsWithContext(layer, options);
}

// --- Map refresh helpers ---

function reorderMapOverlays() {
  ensureMapLibreSourcesAndLayers();
}

function refreshMapAfterStepVisible(reason = 'unknown') {
  if (!state.map) return;

  requestAnimationFrame(() => {
    try { state.map.resize?.(); } catch {}
  });

  setTimeout(() => {
    try {
      state.map.resize?.();

      if (state.parcelFeature || state.parcelLayer) {
        updateParcelSource();
        console.log('[Parcel Layer] render from state source=', reason);
      }
      if (state.mowableFeatureCollection?.features?.length) {
        if (typeof updateMowableSource === 'function') updateMowableSource();
      }

      const parcel = state.parcelFeature || state.parcelLayer;
      if (parcel) {
        fitLayerBoundsWithContext(parcel);
        console.log('[Map Refresh] fit bounds parcel');
      } else {
        console.log('[Map Refresh] no parcel geometry found');
      }

      console.log('[Map Refresh] complete reason=', reason);
    } catch (err) {
      console.warn('[Map Refresh] failed reason=', reason, err);
    }
  }, 80);
}

// --- Global map exposure ---

function exposeTurfLynkMapGlobals() {
  if (state.map) window.map = state.map;
  if (state.map) window.turflynkMap = state.map;
  window.mowableFeatureCollection = state.mowableFeatureCollection;
  window.drawnItems = state.mowableFeatureCollection;
  window.mowLayerGroup = state.mowableFeatureCollection;
  if (state.parcelLayer) window.parcelLayer = state.parcelLayer;
}

// --- Map initialization ---

function isUsableTurfLynkMap(map) {
  return Boolean(
    map
    && !map.__turflynkRemoved
    && typeof map.resize === 'function'
    && typeof map.getContainer === 'function'
  );
}

function reuseTurfLynkMap(map, reason = 'initMap') {
  state.map = map;
  installTurfLynkMapLifecycleDiagnostics(map);
  installTurfLynkMapEventHandlers(map);
  exposeTurfLynkMapGlobals();
  console.log('[MapLibre] reusing existing map instance', reason);
  requestAnimationFrame(() => {
    try { map.resize(); } catch {}
  });
  return map;
}

function installTurfLynkMapLifecycleDiagnostics(map) {
  if (!map || map.__turflynkLifecycleDiagnosticsInstalled) return;
  map.__turflynkLifecycleDiagnosticsInstalled = true;
  const originalRemove = map.remove;
  if (typeof originalRemove !== 'function') return;
  map.remove = function turflynkIntentionalMapRemove(...args) {
    console.log('[MapLibre] map removed intentionally');
    map.__turflynkRemoved = true;
    if (window.turflynkMap === map) window.turflynkMap = null;
    if (window.map === map) window.map = null;
    if (state.map === map) state.map = null;
    return originalRemove.apply(this, args);
  };
}

function installTurfLynkMapEventHandlers(map) {
  if (!map || map.__turflynkQuoteHandlersInstalled) return;
  map.__turflynkQuoteHandlersInstalled = true;

  map.on('click', (e) => {
    if (getMapMode() !== 'select' || !state.parcelSelectMode) return;
    e.preventDefault?.();
    applyParcelFromClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  });

  map.on('click', 'mowable-fill', (e) => {
    if (getMapMode() === 'lasso' || state.quoteUiMode === 'drawing') return;
    const feature = e.features?.[0];
    const featureId = feature?.properties?.id || feature?.id;
    if (!featureId) return;
    e.preventDefault?.();
    selectMowableFeature(featureId);
    setMapToolPanelOpen(true);
  });
  map.on('mouseenter', 'mowable-fill', () => {
    try { map.getCanvas().style.cursor = 'pointer'; } catch {}
  });
  map.on('mouseleave', 'mowable-fill', () => {
    try { map.getCanvas().style.cursor = ''; } catch {}
  });

  map.on('dblclick', (e) => {
    if (getMapMode() !== 'select' || !state.parcelSelectMode) return;
    e.preventDefault?.();
    state.parcelDblClick = true;
    if (state.pendingParcelFeature) {
      state.parcelDblClick = false;
      confirmParcelSelection().catch((error) => showError('Parcel selection failed: ' + prettyApiError(error)));
    }
  });
}

function initMap() {
  const mapEl = byId('quoteMap');
  if (!mapEl || typeof maplibregl === 'undefined') return;

  if (isUsableTurfLynkMap(window.turflynkMap)) {
    if (window.turflynkMap.getContainer?.() === mapEl) {
      window.__mapLibreCreateCount = Number(window.__mapLibreCreateCount || 0);
    }
    return reuseTurfLynkMap(window.turflynkMap, 'window.turflynkMap');
  }
  if (isUsableTurfLynkMap(state.map)) {
    return reuseTurfLynkMap(state.map, 'state.map');
  }

  window.__mapLibreCreateCount = Number(window.__mapLibreCreateCount || 0) + 1;
  if (window.__mapLibreCreateCount > 1) {
    console.warn('[MapLibre] duplicate map creation blocked');
    if (isUsableTurfLynkMap(window.turflynkMap)) return reuseTurfLynkMap(window.turflynkMap, 'duplicate-create-window');
    if (isUsableTurfLynkMap(state.map)) return reuseTurfLynkMap(state.map, 'duplicate-create-state');
    return;
  }

  console.log('[MapLibre] creating new map instance');
  state.map = new maplibregl.Map({
    container: 'quoteMap',
    center: latLngToLngLat(DEFAULT_MAP_CENTER),
    zoom: DEFAULT_MAP_ZOOM,
    maxBounds: [
      [ARKANSAS_MAP_BUFFERED_BOUNDS.west, ARKANSAS_MAP_BUFFERED_BOUNDS.south],
      [ARKANSAS_MAP_BUFFERED_BOUNDS.east, ARKANSAS_MAP_BUFFERED_BOUNDS.north],
    ],
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tiles: [SATELLITE_TILE_URL],
          tileSize: 256,
          attribution: SATELLITE_TILE_ATTRIBUTION,
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    },
  });
  installTurfLynkMapLifecycleDiagnostics(state.map);
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  setMapGestureCapture(false);
  state.drawGroup = state.mowableFeatureCollection;
  state.aiCutoutGroup = state.aiCutoutFeatureCollection;
  state.buildingFootprintGroup = state.buildingFootprintFeatureCollection;

  state.map.on('load', () => {
    ensureMapLibreSourcesAndLayers();
    if (typeof installMowableMoveMapHandlers === 'function') installMowableMoveMapHandlers();
    exposeTurfLynkMapGlobals();
    if (typeof exposeTurfLynkQuoteGlobals === 'function') exposeTurfLynkQuoteGlobals();
  });

  exposeTurfLynkMapGlobals();
  installTurfLynkMapEventHandlers(state.map);
  return state.map;
}

// --- Window exposure ---

window.setTurfLynkMapMode = setMapMode;
window.getTurfLynkMapMode = getMapMode;
window.exposeTurfLynkMapGlobals = exposeTurfLynkMapGlobals;
window.setTurfLynkLassoTempLine = setLassoTempLine;
window.initMap = initMap;
