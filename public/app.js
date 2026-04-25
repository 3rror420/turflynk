const byId = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const QUOTE_DRAFT_KEY = 'turflynk.quoteDraft.v5';

const EPSG4326 = 'EPSG:4326';
const EPSG26915 = '+proj=utm +zone=15 +datum=NAD83 +units=m +no_defs';

async function api(path, options = {}) {
  const token = localStorage.getItem('turflynk.authToken') || '';

  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json();
}

function setAuthToken(token) {
  if (token) localStorage.setItem('turflynk.authToken', token);
  else localStorage.removeItem('turflynk.authToken');
  updateSessionStatus();
}

function getAuthToken() {
  return localStorage.getItem('turflynk.authToken') || '';
}

function prettyApiError(error) {
  try {
    const parsed = JSON.parse(error.message || '{}');
    return parsed.error || parsed.detail || error.message;
  } catch {
    return error.message || 'Something went wrong';
  }
}

function updateSessionStatus(user) {
  const el = byId('sessionStatus');
  if (!el) return;
  const token = getAuthToken();
  if (!token) {
    el.textContent = 'Guest mode';
    el.classList.remove('ok');
    return;
  }
  if (user?.email) {
    el.textContent = `${user.email} - ${user.role || 'user'}`;
    el.classList.add('ok');
    return;
  }
  el.textContent = 'Session saved';
  el.classList.add('ok');
}

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(value || 0));
}

function formToObject(form) {
  const fd = new FormData(form);
  const obj = Object.fromEntries(fd.entries());
  for (const box of form.querySelectorAll('input[type="checkbox"]')) {
    obj[box.name] = box.checked;
  }
  return obj;
}

function fillForm(form, values) {
  Object.entries(values || {}).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (!field) return;
    if (field instanceof RadioNodeList) return;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  });
}

function multiSelectValues(select) {
  return Array.from(select?.selectedOptions || []).map((option) => option.value);
}

function showResult(id, html) {
  const el = byId(id);
  if (!el) return;
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function card(html) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.innerHTML = html;
  return wrap;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderJobPhotoPreview() {
  const input = byId('jobPhotos');
  const preview = byId('jobPhotoPreview');
  if (!preview) return;
  preview.innerHTML = '';
  const files = Array.from(input?.files || []);
  if (!files.length) return;
  files.forEach((file) => {
    const item = document.createElement('div');
    item.className = 'photo-thumb';
    const img = document.createElement('img');
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    const label = document.createElement('span');
    label.textContent = file.name;
    item.append(img, label);
    preview.append(item);
  });
}

const state = {
  config: null,
  regions: [],
  services: [],
  map: null,
  marker: null,
  parcelLayer: null,
  parcelGeometry: null,
  drawGroup: null,
  drawHandler: null,
  editHandler: null,
  deleteHandler: null,
  activeView: 'quote',
  mowUndoStack: [],
  aiCutoutGroup: null,
  lastQuote: null,       // set after successful quote submission
  currentUser: null,     // set after login / session check
};

function normalizeRegion(region) {
  return {
    ...region,
    id: region.id,
    label: region.label || region.name || region.id || 'Region',
    name: region.name || region.label || region.id || 'Region',
    enabled: region.enabled ?? region.active ?? true,
    featuredCities: Array.isArray(region.featuredCities) ? region.featuredCities : [],
    counties: Array.isArray(region.counties) ? region.counties : [],
    metro: region.metro || '',
    marketMultiplier: Number(region.marketMultiplier ?? 1),
    travelFee: Number(region.travelFee ?? 0),
    minimumJob: Number(region.minimumJob ?? 0),
  };
}

function normalizeService(service) {
  return {
    ...service,
    id: service.id,
    label: service.label || service.name || service.id || 'Service',
    name: service.name || service.label || service.id || 'Service',
    baseFee: Number(service.baseFee ?? 0),
    ratePer1000Sqft: Number(service.ratePer1000Sqft ?? 0),
    minimumPrice: Number(service.minimumPrice ?? 0),
  };
}

function regionLabel(regionId) {
  return state.regions.find((item) => item.id === regionId)?.label || regionId || 'Unassigned';
}

function serviceLabel(serviceId) {
  return state.services.find((item) => item.id === serviceId)?.label || serviceId || 'Service';
}

function fillSelect(select, items, includeBlank = false) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';

  if (includeBlank) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select...';
    select.append(blank);
  }

  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label || item.name || item.id;
    select.append(option);
  });

  if (previous && Array.from(select.options).some((option) => option.value === previous)) {
    select.value = previous;
  }

  if (!select.value && select.options.length) {
    select.selectedIndex = 0;
  }
}

function saveQuoteDraft() {
  const form = byId('quoteForm');
  if (!form) return;
  localStorage.setItem(QUOTE_DRAFT_KEY, JSON.stringify(formToObject(form)));
}

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error('No Google Maps API key'));

    if (window.google?.maps?.places) {
      return resolve();
    }

    const existing = document.querySelector('script[data-google-maps-loader="true"]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.dataset.googleMapsLoader = 'true';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
}

function loadQuoteDraft() {
  try {
    return JSON.parse(localStorage.getItem(QUOTE_DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearQuoteDraft() {
  localStorage.removeItem(QUOTE_DRAFT_KEY);
}

function setEditorModeLabel(text) {
  const el = byId('mowEditorMode');
  if (!el) return;
  el.textContent = text;
}

function placeMarker(lat, lng) {
  if (!state.map) return;
  if (state.marker) state.marker.setLatLng([lat, lng]);
  else state.marker = L.marker([lat, lng]).addTo(state.map);
  state.map.setView([lat, lng], 18);
}

function setLatLng(lat, lng) {
  const form = byId('quoteForm');
  if (!form) return;
  form.elements.lat.value = Number(lat).toFixed(6);
  form.elements.lng.value = Number(lng).toFixed(6);
  saveQuoteDraft();
}

function snapshotMowLayersForUndo() {
  if (!state.drawGroup) return;

  const features = getAllMowLayers()
    .map((layer) => {
      try {
        return layer.toGeoJSON();
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  state.mowUndoStack = state.mowUndoStack || [];
  state.mowUndoStack.push(features);

  // keep it light
  if (state.mowUndoStack.length > 10) {
    state.mowUndoStack.shift();
  }
}

function restoreMowLayersFromSnapshot(features) {
  if (!state.drawGroup || !Array.isArray(features)) return;

  state.drawGroup.clearLayers();

  features.forEach((feature) => {
    const group = L.geoJSON(feature);
    group.eachLayer((layer) => {
      styleMowLayer(layer);
      state.drawGroup.addLayer(layer);
    });
  });

  if (state.parcelLayer?.bringToBack) state.parcelLayer.bringToBack();

  syncMowAreaFromLayers();
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

function clearParcelLayer() {
  if (state.parcelLayer && state.map) {
    state.map.removeLayer(state.parcelLayer);
  }
  state.parcelLayer = null;
  state.parcelGeometry = null;
}

function projectRing26915ToLatLng(ring) {
  return ring.map(([x, y]) => {
    const [lng, lat] = proj4(EPSG26915, EPSG4326, [x, y]);
    return [lat, lng];
  });
}

function esriPolygonToLeafletLatLngs(geometry) {
  const rings = geometry?.rings || [];
  return rings.map(projectRing26915ToLatLng);
}

function exposeTurfLynkMapGlobals() {
  if (state.map) window.map = state.map;
  if (state.drawGroup) {
    window.drawnItems = state.drawGroup;
    window.mowLayerGroup = state.drawGroup;
  }
  if (state.parcelLayer) window.parcelLayer = state.parcelLayer;
}

function exposeCurrentParcelGeometryForAi() {
  // Convert Arkansas GIS ESRI rings into normal GeoJSON Polygon geometry.
  // /api/ai/detect-grass expects GeoJSON lon/lat coordinates.
  try {
    if (!state.parcelGeometry?.rings?.length) return null;
    const latLngsForAi = esriPolygonToLeafletLatLngs(state.parcelGeometry);
    const geoJsonGeometry = L.polygon(latLngsForAi).toGeoJSON().geometry;
    window.currentParcelGeometry = geoJsonGeometry;
    window.parcelGeometry = geoJsonGeometry;
    return geoJsonGeometry;
  } catch (error) {
    console.warn('Could not expose parcel geometry for AI detection', error);
    return null;
  }
}

function exposeTurfLynkQuoteGlobals() {
  // Adapter used by /js/ai-detect-grass.js after it draws returned polygons.
  window.updateMowAreaSqft = function updateMowAreaSqftFromAi(sqft) {
    const form = byId('quoteForm');
    const rounded = Math.round(Number(sqft || 0));

    if (form) {
      form.elements.mowAreaSqft.value = rounded || '';
      if (!form.elements.lotAreaSqft.value && state.parcelLayer) {
        form.elements.lotAreaSqft.value = layerAreaSqFt(state.parcelLayer) || '';
      }
      form.elements.lotSource.value = 'ai_detected';
    }

    updateMowAreaHelper(Number(form?.elements?.lotAreaSqft?.value || 0), rounded);
    saveQuoteDraft();
    updateEstimatePreview();
  };
}

function drawParcel(geometry) {
  if (!state.map || !geometry) return;
  const map = state.map;

  // Remove previous parcel layer from the real Leaflet map
  if (state.parcelLayer) {
    try {
      map.removeLayer(state.parcelLayer);
    } catch (e) {
      console.warn("old parcel layer remove failed", e);
    }
    state.parcelLayer = null;
  }

  // ArcGIS polygon geometry uses rings: [ [ [lng, lat], ... ] ]
  const rings = geometry.rings || geometry.coordinates;
  if (!rings || !rings.length) {
    console.warn("drawParcel: no rings", geometry);
    return;
  }

  const latLngRings = rings.map(ring =>
    ring.map(pt => {
      const lng = Number(pt[0]);
      const lat = Number(pt[1]);
      return [lat, lng];
    }).filter(pt => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
  ).filter(ring => ring.length >= 3);

  if (!latLngRings.length) {
    console.warn("drawParcel: invalid lat/lng rings", geometry);
    return;
  }

  state.parcelGeometry = geometry;

  const layer = L.polygon(latLngRings, {
    color: "#22c55e",
    weight: 3,
    opacity: 1,
    fillColor: "#22c55e",
    fillOpacity: 0.12,
    interactive: false
  });

  layer.addTo(map);
  state.parcelLayer = layer;

  const bounds = layer.getBounds();
  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 20 });
  }

  // Force Leaflet to repaint after sequential lookups / mobile layout shifts
  requestAnimationFrame(() => {
    map.invalidateSize(true);
    layer.redraw();
  });
}
function styleMowLayer(layer) {
  if (layer?.setStyle) {
    layer.setStyle({
      color: '#16a34a',
      weight: 3,
      fillOpacity: 0.18,
    });
  }
}

function layerAreaSqFt(layer) {
  if (!layer) return 0;
  try {
    const gj = layer.toGeoJSON();
    const sqm = turf.area(gj);
    return Math.round(sqm * 10.7639);
  } catch {
    return 0;
  }
}

function startEditAiCutouts() {
  if (!state.map || !state.aiCutoutGroup || !state.aiCutoutGroup.getLayers().length) {
    showResult('parcelInfo', '<strong>No AI cutouts to edit.</strong>');
    return;
  }

  stopToolModes();

  state.editHandler = new L.EditToolbar.Edit(state.map, {
    featureGroup: state.aiCutoutGroup,
    selectedPathOptions: {
      maintainColor: true,
    },
  });

  state.editHandler.enable();
  setEditorModeLabel('Mode: Editing AI cutouts');
}

function startCutMowable() {
  if (!state.map || !state.drawGroup || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to cut.</strong>');
    return;
  }

  stopToolModes();

  state.drawHandler = new L.Draw.Polygon(state.map, {
    allowIntersection: false,
    showArea: false,
    repeatMode: false,
    shapeOptions: {
      color: '#ef4444', // red = cut
      weight: 3,
      fillOpacity: 0.2,
    },
  });

  state.drawHandler.enable();
  setEditorModeLabel('Mode: Draw area to CUT OUT');
}


function getAllMowLayers() {
  if (!state.drawGroup) return [];
  return state.drawGroup.getLayers().filter((layer) => typeof layer.toGeoJSON === 'function');
}

function totalMowAreaSqFt() {
  return getAllMowLayers().reduce((sum, layer) => sum + layerAreaSqFt(layer), 0);
}

function updateMowAreaHelper(parcelSqFt, mowSqFt) {
  const helper = byId('mowAreaHelper');
  if (!helper) return;

  if (!mowSqFt) {
    helper.innerHTML = '<strong>Mowable area editor:</strong> tap Draw Area, tap the map to place points, and tap the first point to finish. You can add multiple green areas.';
    return;
  }

  const pct = parcelSqFt ? Math.round((mowSqFt / parcelSqFt) * 100) : null;
  helper.innerHTML = `
    <strong>Mowable area editor:</strong><br>
    Total mowable area: ${Number(mowSqFt).toLocaleString()} sq ft${pct ? ` (${pct}% of parcel)` : ''}<br>
    Tap a green area to edit it, or use the buttons below.
  `;
}

function syncMowAreaFromLayers() {
  const form = byId('quoteForm');
  if (!form) return;

  const totalSqFt = totalMowAreaSqFt();
  form.elements.mowAreaSqft.value = totalSqFt || '';

  updateMowAreaHelper(
    Number(form.elements.lotAreaSqft.value || 0),
    totalSqFt
  );

  saveQuoteDraft();
  updateEstimatePreview();
}

function stopToolModes() {
  if (state.drawHandler) {
    try { state.drawHandler.disable(); } catch {}
    state.drawHandler = null;
  }
  if (state.editHandler) {
    try { state.editHandler.disable(); } catch {}
    state.editHandler = null;
  }
  if (state.deleteHandler) {
    try { state.deleteHandler.disable(); } catch {}
    state.deleteHandler = null;
  }
  setEditorModeLabel('Mode: Ready');
}

function clearMowLayer() {
  stopToolModes();

  if (state.drawGroup) {
    state.drawGroup.clearLayers();
  }

  const form = byId('quoteForm');
  if (form) {
    form.elements.mowAreaSqft.value = '';
  }

  updateMowAreaHelper(Number(form?.elements?.lotAreaSqft?.value || 0), 0);
  saveQuoteDraft();
  updateEstimatePreview();
}

function cloneParcelAsMowable() {
  if (!state.parcelGeometry?.rings?.length || !state.map || !state.drawGroup) {
    showResult('parcelInfo', '<strong>No parcel shape yet.</strong><br>Lookup the parcel first.');
    return;
  }

  state.drawGroup.clearLayers();

  const latLngs = esriPolygonToLeafletLatLngs(state.parcelGeometry);
  const layer = L.polygon(latLngs, {
    color: '#16a34a',
    weight: 3,
    fillOpacity: 0.18,
  });

  styleMowLayer(layer);
  state.drawGroup.addLayer(layer);

  if (state.parcelLayer?.bringToBack) state.parcelLayer.bringToBack();
  if (layer.bringToFront) layer.bringToFront();

  state.map.fitBounds(layer.getBounds(), { padding: [20, 20] });

  const totalSqFt = totalMowAreaSqFt();
  const form = byId('quoteForm');

  if (form) {
    form.elements.lotAreaSqft.value = totalSqFt || '';
    form.elements.mowAreaSqft.value = totalSqFt || '';
    form.elements.lotSource.value = 'parcel';
  }

  syncMowAreaFromLayers();
}

async function aiDetectGrassDraft() {
  console.log('REAL AI grass detect fired');

  if (!state.parcelGeometry?.rings?.length || !state.map || !state.drawGroup) {
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

  if (!window.TurfLynkAiGrass || typeof window.TurfLynkAiGrass.detectGrass !== 'function') {
    showResult(
      'parcelInfo',
      '<strong>AI detector script not loaded.</strong><br>Check that /js/ai-detect-grass.js exists and loads after /app.js.'
    );
    return;
  }

  stopToolModes();

  state.mowUndoStack = [];

  state.drawGroup.clearLayers();

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
    await updateEstimatePreview();

    if (state.parcelLayer?.bringToBack) state.parcelLayer.bringToBack();

    showResult(
      'parcelInfo',
      `<strong>AI mowable area detected.</strong><br>
      Detected Mow Area: ${Number(detectedSqFt || 0).toLocaleString()} sq ft<br>
      Green shapes are editable. Adjust them if trees, roofs, driveways, or shadows were misread.`
    );
  } catch (error) {
    console.error('AI grass detection failed', error);
    showResult('parcelInfo', `<strong>AI detection failed.</strong><br>${escapeHtml(error.message || error)}`);
  }
}

function startDrawMowable() {
  if (!state.map) return;
  stopToolModes();

  state.drawHandler = new L.Draw.Polygon(state.map, {
    allowIntersection: false,
    showArea: true,
    repeatMode: false,
    shapeOptions: {
      color: '#16a34a',
      weight: 3,
      fillOpacity: 0.18,
    },
  });

  state.drawHandler.enable();
  setEditorModeLabel('Mode: Drawing mowable area');
}

function startEditMowable() {
  if (!state.map || !state.drawGroup || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to edit.</strong><br>Use Parcel Shape, Smart Draft, or Draw Area first.');
    return;
  }

  stopToolModes();

  state.editHandler = new L.EditToolbar.Edit(state.map, {
    featureGroup: state.drawGroup,
    selectedPathOptions: {
      maintainColor: true,
    },
  });

  state.editHandler.enable();
  setEditorModeLabel('Mode: Editing mowable areas');
}



async function aiRefineMowableArea() {
  if (!state.map || !state.drawGroup || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to refine.</strong>');
    return;
  }

  try {
    showResult(
      'parcelInfo',
      '<strong>AI refining area...</strong><br>Looking for house, driveway, pool, shed, or other non-mowable areas.'
    );

    const mowableFeatures = getAllMowLayers().map((layer) => layer.toGeoJSON());
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

    state.aiCutoutGroup.clearLayers();

    cutouts.forEach((feature) => {
      const group = L.geoJSON(feature, {
        style: {
          color: '#ef4444',
          weight: 3,
          fillColor: '#ef4444',
          fillOpacity: 0.25
        }
      });

      group.eachLayer(layer => state.aiCutoutGroup.addLayer(layer));
    });

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
  if (!state.aiCutoutGroup || !state.aiCutoutGroup.getLayers().length) {
    showResult('parcelInfo', '<strong>No AI cutouts to apply.</strong>');
    return;
  }

  snapshotMowLayersForUndo();
  state.skipNextCutUndoSnapshot = true;

  try {
    state.aiCutoutGroup.getLayers().forEach(layer => {
      applyCutToMowable(layer);
    });
  } finally {
    state.skipNextCutUndoSnapshot = false;
  }

  state.aiCutoutGroup.clearLayers();
  syncMowAreaFromLayers();

  showResult('parcelInfo', '<strong>AI cutouts applied.</strong>');
}

function startDeleteMowable() {
  if (!state.map || !state.drawGroup || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to delete.</strong>');
    return;
  }

  stopToolModes();

  state.deleteHandler = new L.EditToolbar.Delete(state.map, {
    featureGroup: state.drawGroup,
  });

  state.deleteHandler.enable();
  setEditorModeLabel('Mode: Delete mowable areas');
}


function applyCutToMowable(cutLayer) {
  try {
    if (!state.skipNextCutUndoSnapshot) {
      snapshotMowLayersForUndo();
    }

    const cutGeo = cutLayer.toGeoJSON();
    const newLayers = [];

    getAllMowLayers().forEach((layer) => {
      const gj = layer.toGeoJSON();

      try {
        const diff = turf.difference(gj, cutGeo);

        if (!diff) return;

        if (diff.geometry.type === 'Polygon') {
          newLayers.push(L.geoJSON(diff));
        } else if (diff.geometry.type === 'MultiPolygon') {
          newLayers.push(L.geoJSON(diff));
        }
      } catch (err) {
        console.warn('Cut failed on layer', err);
      }
    });

    state.drawGroup.clearLayers();

    newLayers.forEach((l) => {
      l.eachLayer((sub) => {
        styleMowLayer(sub);
        state.drawGroup.addLayer(sub);
      });
    });

    syncMowAreaFromLayers();
  } catch (err) {
    console.error('applyCutToMowable failed', err);
  }
}

function initMap() {
  const mapEl = byId('quoteMap');
  if (!mapEl || typeof L === 'undefined') return;

  state.map = L.map('quoteMap', { tap: true }).setView([34.7465, -92.2896], 7);
  exposeTurfLynkMapGlobals();
  exposeTurfLynkQuoteGlobals();

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 20,
      attribution: 'Tiles Esri',
    }
  );

  const streets = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 20,
      attribution: 'OpenStreetMap',
    }
  );

  satellite.addTo(state.map);

  state.drawGroup = new L.FeatureGroup();
  state.map.addLayer(state.drawGroup);
  exposeTurfLynkMapGlobals();

  state.aiCutoutGroup = new L.FeatureGroup();
  state.map.addLayer(state.aiCutoutGroup);

  state.map.on(L.Draw.Event.CREATED, (e) => {
  const layer = e.layer;

  // ?? CUT MODE (red polygon)
  if (layer.options?.color === '#ef4444') {
    applyCutToMowable(layer);
    setTimeout(() => {
      startEditMowable();
    }, 0);
    return;
  }

  // ?? NORMAL DRAW
  styleMowLayer(layer);
  state.drawGroup.addLayer(layer);

  if (state.parcelLayer?.bringToBack) state.parcelLayer.bringToBack();
  if (layer.bringToFront) layer.bringToFront();

  syncMowAreaFromLayers();
  setTimeout(() => {
    startEditMowable();
  }, 0);
});

  state.map.on(L.Draw.Event.EDITED, () => {
    syncMowAreaFromLayers();
    setEditorModeLabel('Mode: Editing mowable areas');
  });

  state.map.on(L.Draw.Event.DELETED, () => {
    syncMowAreaFromLayers();
    setEditorModeLabel('Mode: Delete mowable areas');
  });

  state.drawGroup.on('click', () => {
    startEditMowable();
  });

  state.streetLayer = streets;
  state.satelliteLayer = satellite;
}

window.TurfLynkAppState = state;
window.esriPolygonToLeafletLatLngs = esriPolygonToLeafletLatLngs;
window.exposeCurrentParcelGeometryForAi = exposeCurrentParcelGeometryForAi;
window.exposeTurfLynkMapGlobals = exposeTurfLynkMapGlobals;
window.syncMowAreaFromLayers = syncMowAreaFromLayers;
window.startEditMowable = startEditMowable;
window.updateEstimatePreview = updateEstimatePreview;

function setActiveView(view) {
  state.activeView = view;

  $$('[data-view-panel]').forEach((el) => {
    const visible = el.dataset.viewPanel === view;
    el.classList.toggle('active', visible);
    el.style.display = visible ? '' : 'none';
  });

  $$('[data-view]').forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });

  $$('[data-jump-view]').forEach((btn) => {
    btn.onclick = () => setActiveView(btn.dataset.jumpView);
  });

  const title = byId('viewTitle');
  if (title) {
    const titles = {
      dashboard: 'Dashboard',
      quote: 'Quote + Map',
      jobs: 'Jobs',
      providers: 'Providers',
      admin: 'Admin',
    };
    title.textContent = titles[view] || 'TurfLynk';
  }

  if (view === 'quote' && state.map) {
    setTimeout(() => state.map.invalidateSize(), 50);
  }

  if (view === 'jobs') {
    // Auto-load appropriate job list based on role
    const role = state.currentUser?.role;
    if (role === 'provider') {
      byId('myBookingsPanelTitle') && (byId('myBookingsPanelTitle').textContent = 'Open Jobs');
      loadOpenJobsForProvider().catch(() => {});
    } else {
      loadMyJobs().catch(() => {});
    }
  }
}

function initNavigation() {
  const buttons = $$('[data-view]');
  const sections = $$('[data-view-panel]');
  if (!buttons.length || !sections.length) return;

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) setActiveView(view);
    });
  });

  $$('[data-jump-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.jumpView;
      if (view) setActiveView(view);
    });
  });

  const first = buttons.find((b) => b.classList.contains('active'))?.dataset.view || 'dashboard';
  setActiveView(first);
}

function renderCoverage() {
  const grid = byId('coverageGrid');
  if (!grid) return;

  grid.innerHTML = '';
  state.regions.forEach((region) => {
    grid.append(card(`
      <h4>${escapeHtml(region.label)}</h4>
      <div class="meta">${escapeHtml(region.metro || '')}</div>
      <div class="meta">Counties: ${escapeHtml((region.counties || []).join(', '))}</div>
      <div class="meta">Cities: ${escapeHtml((region.featuredCities || []).join(', '))}</div>
      <div class="meta">Multiplier ${region.marketMultiplier} � Travel ${money(region.travelFee)} � Minimum ${money(region.minimumJob)}</div>
    `));
  });
}

async function loadConfig() {
  const data = await api('/api/config');
  state.config = data;
  state.regions = (data.settings?.regions || []).map(normalizeRegion);
  state.services = (data.settings?.services || []).map(normalizeService);

  if (byId('regionCountStat')) byId('regionCountStat').textContent = String(state.regions.length);
  if (byId('serviceCountStat')) byId('serviceCountStat').textContent = String(state.services.length);

  fillSelect(byId('quoteRegionSelect'), state.regions);
  fillSelect(byId('jobRegionSelect'), state.regions);
  fillSelect(byId('regionEditorSelect'), state.regions);
  fillSelect(byId('quoteServiceSelect'), state.services);
  fillSelect(byId('jobServiceSelect'), state.services);
  fillSelect(byId('serviceEditorSelect'), state.services);

  const providerRegions = byId('providerRegions');
  if (providerRegions) {
    providerRegions.innerHTML = '';
    state.regions.forEach((region) => {
      const option = document.createElement('option');
      option.value = region.id;
      option.textContent = region.label;
      providerRegions.append(option);
    });
  }

  const draft = loadQuoteDraft();
  if (draft && byId('quoteForm')) fillForm(byId('quoteForm'), draft);

  renderCoverage();
  hydrateRegionEditor();
  hydrateServiceEditor();
  updateEstimatePreview();
}

function toggleAuthPanel(forceOpen) {
  const panel = document.getElementById('authPanel');
  if (!panel) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
}

document.getElementById('openAuth')?.addEventListener('click', () => {
  toggleAuthPanel();
});

$$('[data-open-auth]').forEach((btn) => {
  btn.addEventListener('click', () => toggleAuthPanel(true));
});

function showAuthTab(tab) {
  document.getElementById('loginForm')?.classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm')?.classList.toggle('hidden', tab !== 'register');
}

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });

  const json = await res.json();
  if (json.ok) {
    setAuthToken(json.token);
    state.currentUser = json.user;
    updateSessionStatus(json.user);
    applyRoleVisibility();
    toggleAuthPanel(false);
    await Promise.allSettled([loadProviders(), loadJobs(), loadAdmin(), loadMyJobs()]);
  } else {
    alert(json.error);
  }
});

document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));

  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });

  const json = await res.json();
  if (json.ok) {
    alert('Account created - now login');
    showAuthTab('login');
  } else {
    alert(json.error);
  }
});

function friendlyAdminSaveError(error) {
  const message = prettyApiError(error);
  if (/missing auth token|unauthorized|invalid session|forbidden/i.test(message)) {
    return 'Please log in as an admin to save pricing changes.';
  }
  return message;
}

function hydrateRegionEditor() {
  const select = byId('regionEditorSelect');
  const region = state.regions.find((item) => item.id === select?.value) || state.regions[0];
  if (!region) return;

  if (byId('regionMarketMultiplier')) byId('regionMarketMultiplier').value = region.marketMultiplier ?? 1;
  if (byId('regionTravelFee')) byId('regionTravelFee').value = region.travelFee ?? 0;
  if (byId('regionMinimumJob')) byId('regionMinimumJob').value = region.minimumJob ?? 0;
  if (byId('regionFeaturedCities')) byId('regionFeaturedCities').value = (region.featuredCities || []).join(', ');
  if (byId('regionEnabled')) byId('regionEnabled').value = String(Boolean(region.enabled));
}

function hydrateServiceEditor() {
  const select = byId('serviceEditorSelect');
  const service = state.services.find((item) => item.id === select?.value) || state.services[0];
  if (!service) return;

  if (byId('serviceBaseFee')) byId('serviceBaseFee').value = service.baseFee ?? 0;
  if (byId('serviceRate')) byId('serviceRate').value = service.ratePer1000Sqft ?? 0;
  if (byId('serviceMinimum')) byId('serviceMinimum').value = service.minimumPrice ?? 0;
}

async function updateEstimatePreview() {
  const form = byId('quoteForm');
  const preview = byId('quotePreview');
  const mirror = byId('quotePreviewMirror');
  if (!form || !preview) return;

  const payload = formToObject(form);
  try {
    const data = await api('/api/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const formatted = money(data.estimate);
    preview.textContent = formatted;
    if (mirror) mirror.textContent = formatted;
  } catch {
    preview.textContent = '$0.00';
    if (mirror) mirror.textContent = '$0.00';
  }
}

async function geocodeAddress() {
  const form = byId('quoteForm');
  if (!form) return;

  const payload = formToObject(form);
  const q = [payload.address, payload.city, payload.state || 'AR', payload.zip]
    .filter(Boolean)
    .join(', ');

  if (!q.trim()) {
    return showResult('parcelInfo', '<strong>Enter an address first.</strong>');
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();

  if (!Array.isArray(data) || !data.length) {
    return showResult(
      'parcelInfo',
      '<strong>Address not found.</strong> Try adding city/state or use autocomplete.'
    );
  }

  const { lat, lon } = data[0];
  setLatLng(lat, lon);
  placeMarker(lat, lon);

  showResult(
    'parcelInfo',
    `<strong>Address located.</strong><br />Lat: ${Number(lat).toFixed(6)} � Lng: ${Number(lon).toFixed(6)}`
  );
}

async function lookupParcel() {
  const quoteForm = byId('quoteForm');
  const parcelInfo = byId('parcelInfo');
  if (!quoteForm || !parcelInfo) return;

  const lat = quoteForm.elements.lat.value;
  const lng = quoteForm.elements.lng.value;

  if (!lat || !lng) {
    return showResult(
      'parcelInfo',
      '<strong>No coordinates yet.</strong> Use Find Address or autocomplete first.'
    );
  }

  const address = quoteForm.elements.address?.value || '';
  const city = quoteForm.elements.city?.value || '';
  const zip = quoteForm.elements.zip?.value || '';

  const qs = new URLSearchParams({ lat, lng, address, city, zip });
  const data = await api(`/api/parcel/lookup?${qs.toString()}`);

  if (!data.ok) {
    parcelInfo.innerHTML = `
      <strong>Parcel boundary not found.</strong><br>
      Reason: ${escapeHtml(data.reason || 'unknown')}<br>
      You can still draw the mowable area manually.
    `;
    parcelInfo.classList.remove('hidden');
    clearParcelLayer();
    return;
  }

  const normalized = data.normalized || {};
  const attrs = normalized.attributes || {};

  const parcelId = normalized.parcelId || attrs.parcelid || '';
  const ownerName = attrs.ownername || 'n/a';
  const addressLabel = attrs.adrlabel || 'n/a';
  const county = normalized.county || attrs.countyid || 'n/a';
  const geometry = data.feature?.geometry || null;

  quoteForm.elements.parcelId.value = parcelId;
  quoteForm.elements.lotAreaSqft.value = '';
  quoteForm.elements.mowAreaSqft.value = '';

  if (geometry) {
    drawParcel(geometry);
    setTimeout(() => {
      cloneParcelAsMowable();
      updateEstimatePreview();
    }, 50);
  }

  updateMowAreaHelper(0, 0);

  const parcelLines = [
    '<strong>Parcel found.</strong>',
    `Match: ${escapeHtml(data.method || 'n/a')}`,
    `County: ${escapeHtml(county)}`,
    `Parcel ID: ${escapeHtml(parcelId || 'n/a')}`,
    `Address: ${escapeHtml(addressLabel)}`,
    `Owner: ${escapeHtml(ownerName)}`,
    'Starter mow area created from parcel. Edit green shape as needed.',
  ];

  parcelInfo.innerHTML = parcelLines.join('<br>');
  parcelInfo.classList.remove('hidden');

  saveQuoteDraft();
  await updateEstimatePreview();
}

async function loadProviders() {
  const list = byId('providersList');
  if (!list) return;

  let data;
  try {
    data = await api('/api/providers');
  } catch {
    list.innerHTML = '';
    list.append(card('<h4>Sign in to view providers</h4><div class="meta">Provider data requires an account.</div>'));
    return;
  }

  list.innerHTML = '';

  if (!data.providers.length) {
    list.append(card('<h4>No providers yet</h4><div class="meta">Add a provider to seed the network.</div>'));
    return;
  }

  data.providers.forEach((provider) => {
    list.append(card(`
      <h4>${escapeHtml(provider.businessName)}</h4>
      <div class="meta">${escapeHtml(provider.ownerName || '')} � Rating ${escapeHtml(provider.rating || 'n/a')}</div>
      <div class="meta">Regions: ${escapeHtml((provider.regions || []).map(regionLabel).join(', '))}</div>
      <div class="meta">Cities: ${escapeHtml((provider.cities || []).join(', '))}</div>
      <div class="meta">Services: ${escapeHtml((provider.services || []).map(serviceLabel).join(', '))}</div>
      <p>${escapeHtml(provider.bio || 'No bio yet.')}</p>
      <div class="meta">Equipment: ${escapeHtml(provider.equipment || 'n/a')}</div>
    `));
  });
}

async function loadJobs() {
  const list = byId('jobsList');
  if (!list) return;

  let data;
  try {
    data = await api('/api/jobs');
  } catch {
    list.innerHTML = '';
    list.append(card('<h4>Sign in to view jobs</h4><div class="meta">Jobs require a customer, provider, or admin account.</div>'));
    return;
  }

  list.innerHTML = '';

  if (!data.jobs.length) {
    list.append(card('<h4>No open jobs yet</h4><div class="meta">Post a job to seed the marketplace board.</div>'));
    return;
  }

  data.jobs.forEach((job) => {
    list.append(card(`
      <h4>${escapeHtml(job.title)}</h4>
      <div class="meta">${escapeHtml(regionLabel(job.regionId || job.region_id))} � ${escapeHtml(serviceLabel(job.serviceType || job.service_type))}</div>
      <div class="meta">${escapeHtml(job.city || '')} ${escapeHtml(job.state || '')} � Budget ${money(job.budget)} � Preferred ${escapeHtml(job.preferredDate || 'Flexible')}</div>
      <p>${escapeHtml(job.details || 'No extra details yet.')}</p>
      <div class="job-photo-row">
        ${(job.photos || []).map((p) => `<img src="${escapeHtml(p)}" alt="Job photo" class="job-photo" />`).join('')}
      </div>
    `));
  });
}

async function loadAdmin() {
  const metrics = byId('adminMetrics');
  if (!metrics) return;

  let data;
  try {
    data = await api('/api/admin/overview');
  } catch {
    metrics.innerHTML = '<div class="metric"><strong>�</strong><span>Sign in for admin metrics</span></div>';
    return;
  }

  metrics.innerHTML = `
    <div class="metric"><strong>${data.metrics.totalQuotes}</strong><span>Total quotes</span></div>
    <div class="metric"><strong>${data.metrics.openJobs}</strong><span>Open jobs</span></div>
    <div class="metric"><strong>${data.metrics.providers}</strong><span>Providers</span></div>
    <div class="metric"><strong>${money(data.metrics.revenuePipeline)}</strong><span>Revenue pipeline</span></div>
  `;

  const latestQuotes = byId('latestQuotes');
  if (latestQuotes) {
    latestQuotes.innerHTML = '';
    (data.latestQuotes.length
      ? data.latestQuotes
      : [{ name: 'No quotes yet', address: 'Start with the quote form.', estimate: 0, region_id: '', service_type: '' }]).forEach((quote) => {
        latestQuotes.append(card(`
          <h4>${escapeHtml(quote.name)}</h4>
          <div class="meta">${escapeHtml(regionLabel(quote.regionId || quote.region_id))} � ${escapeHtml(serviceLabel(quote.serviceType || quote.service_type))}</div>
          <div class="meta">${escapeHtml(quote.address || '')}</div>
          <div class="meta">Estimate ${money(quote.estimate)}</div>
        `));
    });
  }

  const latestJobs = byId('latestJobs');
  if (latestJobs) {
    latestJobs.innerHTML = '';
    (data.latestJobs.length
      ? data.latestJobs
      : [{ title: 'No jobs yet', details: 'Post a job to see it here.', regionId: '', serviceType: '' }]).forEach((job) => {
        latestJobs.append(card(`
          <h4>${escapeHtml(job.title)}</h4>
          <div class="meta">${escapeHtml(regionLabel(job.regionId || job.region_id))} � ${escapeHtml(serviceLabel(job.serviceType || job.service_type))}</div>
          <p>${escapeHtml(job.details || '')}</p>
        `));
    });
  }

  const latestProviders = byId('latestProviders');
  if (latestProviders) {
    latestProviders.innerHTML = '';
    (data.latestProviders?.length
      ? data.latestProviders
      : [{ businessName: 'No providers yet', ownerName: 'Invite local crews to join.' }]).forEach((provider) => {
        latestProviders.append(card(`
          <h4>${escapeHtml(provider.businessName)}</h4>
          <div class="meta">${escapeHtml(provider.ownerName || '')}</div>
        `));
    });
  }
}

byId('quoteForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(event.target);
    const data = await api('/api/quotes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    // Merge API response with form data so bookQuoteAsJob has everything it needs
    state.lastQuote = { ...payload, ...data.quote };

    showResult(
      'quoteResult',
      `<strong>Quote submitted.</strong><br>
       Estimated starting price: <strong>${money(data.quote.estimate)}</strong><br>
       Quote ID: ${escapeHtml(data.quote.id)}<br>
       Region: ${escapeHtml(regionLabel(data.quote.regionId || data.quote.region_id))}<br>
       Service: ${escapeHtml(serviceLabel(data.quote.serviceType || data.quote.service_type))}<br><br>
       <button class="btn primary" type="button" id="bookJobBtn" style="margin-top:4px">
         Book This Service &rarr;
       </button>`
    );

    // Bind after innerHTML is set
    byId('bookJobBtn')?.addEventListener('click', bookQuoteAsJob);

    saveQuoteDraft();
    await updateEstimatePreview();
    await loadAdmin();
  } catch (error) {
    showResult('quoteResult', `<strong>Failed:</strong> ${escapeHtml(error.message)}`);
  }
});

byId('previewEstimateBtn')?.addEventListener('click', updateEstimatePreview);
byId('cutMowableBtn')?.addEventListener('click', startCutMowable);
byId('undoCutBtn')?.addEventListener('click', undoLastCut);
byId('locateAddressBtn')?.addEventListener('click', async () => {
  await geocodeAddress();
  await lookupParcel();
});

byId('lookupParcelBtn')?.addEventListener('click', lookupParcel);
byId('aiDetectGrassBtn')?.addEventListener('click', aiDetectGrassDraft);
byId('useParcelShapeBtn')?.addEventListener('click', cloneParcelAsMowable);
byId('drawMowableBtn')?.addEventListener('click', startDrawMowable);
byId('editMowableBtn')?.addEventListener('click', startEditMowable);
byId('deleteMowableBtn')?.addEventListener('click', startDeleteMowable);
byId('clearMowableBtn')?.addEventListener('click', clearMowLayer);
byId('clearMowAreaBtn')?.addEventListener('click', clearMowLayer);

byId('clearQuoteDraftBtn')?.addEventListener('click', () => {
  byId('quoteForm')?.reset();
  clearQuoteDraft();
  clearParcelLayer();
  clearMowLayer();
  byId('parcelInfo')?.classList.add('hidden');
  updateEstimatePreview();
});

byId('quoteForm')?.addEventListener('input', () => {
  saveQuoteDraft();
  updateEstimatePreview();
});

byId('quoteForm')?.addEventListener('change', () => {
  saveQuoteDraft();
  updateEstimatePreview();
  updateMowAreaHelper(
    Number(byId('quoteForm')?.elements?.lotAreaSqft?.value || 0),
    Number(byId('quoteForm')?.elements?.mowAreaSqft?.value || 0)
  );
});

byId('providerForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(event.target);
    payload.regions = multiSelectValues(byId('providerRegions'));
    payload.cities = String(payload.cities || '').split(',').map((v) => v.trim()).filter(Boolean);
    payload.services = String(payload.services || '').split(',').map((v) => v.trim()).filter(Boolean);

    const data = await api('/api/providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    showResult(
      'providerResult',
      `<strong>Provider added.</strong><br />${escapeHtml(data.provider.businessName)} is now listed.`
    );

    event.target.reset();
    await loadProviders();
    await loadAdmin();
  } catch (error) {
    showResult('providerResult', `<strong>Failed:</strong> ${escapeHtml(error.message)}`);
  }
});

byId('jobForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const form = event.target;
    const payload = formToObject(form);

    let photoUrls = [];
    const fileInput = byId('jobPhotos');

    if (fileInput && fileInput.files && fileInput.files.length) {
      const fd = new FormData();

      for (const file of fileInput.files) {
        fd.append('photos', file);
      }

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: fd
      });

      const uploadText = await uploadRes.text();
      let uploadData;

      try {
        uploadData = JSON.parse(uploadText);
      } catch {
        throw new Error(`Upload did not return JSON: ${uploadText.slice(0, 120)}`);
      }

      if (!uploadRes.ok || !uploadData.ok) {
        throw new Error(uploadData?.error || 'Upload failed');
      }

      photoUrls = (uploadData.files || []).map((f) => f.url);
    }

    payload.photos = photoUrls;

    const data = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    showResult(
      'jobResult',
      `<strong>Job posted.</strong><br />${escapeHtml(data.job.title)} is now live in ${escapeHtml(regionLabel(data.job.regionId || data.job.region_id))}.`
    );

    form.reset();
    await loadJobs();
    await loadAdmin();
  } catch (error) {
    showResult('jobResult', `<strong>Failed:</strong> ${escapeHtml(error.message)}`);
  }
});

byId('regionEditorSelect')?.addEventListener('change', hydrateRegionEditor);
byId('serviceEditorSelect')?.addEventListener('change', hydrateServiceEditor);

byId('regionEditorForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = byId('regionEditorSelect')?.value;
  if (!id) return;

  try {
    await api(`/api/regions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        marketMultiplier: Number(byId('regionMarketMultiplier')?.value || 1),
        travelFee: Number(byId('regionTravelFee')?.value || 0),
        minimumJob: Number(byId('regionMinimumJob')?.value || 0),
        featuredCities: String(byId('regionFeaturedCities')?.value || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        enabled: byId('regionEnabled')?.value === 'true',
      }),
    });

    showResult('regionEditorResult', '<strong>Region pricing saved.</strong>');
    await loadConfig();
  } catch (error) {
    showResult('regionEditorResult', `<strong>Could not save:</strong> ${escapeHtml(friendlyAdminSaveError(error))}`);
  }
});

byId('serviceEditorForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = byId('serviceEditorSelect')?.value;
  if (!id) return;

  try {
    await api(`/api/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        baseFee: Number(byId('serviceBaseFee')?.value || 0),
        ratePer1000Sqft: Number(byId('serviceRate')?.value || 0),
        minimumPrice: Number(byId('serviceMinimum')?.value || 0),
      }),
    });

    showResult('serviceEditorResult', '<strong>Service pricing saved.</strong>');
    await loadConfig();
  } catch (error) {
    showResult('serviceEditorResult', `<strong>Could not save:</strong> ${escapeHtml(friendlyAdminSaveError(error))}`);
  }
});

byId('jobPhotos')?.addEventListener('change', renderJobPhotoPreview);

byId('authForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(event.target);
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {},
    });
    setAuthToken(data.token);
    showResult('authResult', `<strong>Signed in.</strong><br />${escapeHtml(data.user.email)} � ${escapeHtml(data.user.role)}`);
    try { await Promise.allSettled([loadJobs(), loadProviders(), loadAdmin()]); } catch {}
  } catch (error) {
    showResult('authResult', `<strong>Failed:</strong> ${escapeHtml(prettyApiError(error))}`);
  }
});

byId('whoAmIBtn')?.addEventListener('click', async () => {
  try {
    const data = await api('/api/auth/me');
    updateSessionStatus(data.user);
    showResult('authResult', `<strong>Session active.</strong><br />${escapeHtml(data.user.email)} � ${escapeHtml(data.user.role)}`);
  } catch (error) {
    showResult('authResult', `<strong>No active session.</strong><br />${escapeHtml(prettyApiError(error))}`);
    setAuthToken('');
  }
});

byId('logoutBtn')?.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {}
  setAuthToken('');
  showResult('authResult', '<strong>Logged out.</strong>');
});

byId('aiRefineMowableBtn')?.addEventListener('click', aiRefineMowableArea);

byId('applyAiCutoutsBtn')?.addEventListener('click', applyAiCutouts);

byId('refreshProviders')?.addEventListener('click', loadProviders);
byId('refreshJobs')?.addEventListener('click', loadJobs);
byId('refreshRegions')?.addEventListener('click', loadConfig);
byId('refreshServices')?.addEventListener('click', loadConfig);
byId('refreshAdmin')?.addEventListener('click', loadAdmin);
byId('editAiCutoutsBtn')?.addEventListener('click', startEditAiCutouts);
function resetParcelQuoteStateForNewAddress() {
  const form = byId('quoteForm');

  clearParcelLayer();
  clearMowLayer();

  if (form) {
    form.elements.parcelId.value = '';
    form.elements.lotAreaSqft.value = '';
    form.elements.mowAreaSqft.value = '';
    form.elements.lotSource.value = '';
  }

  updateMowAreaHelper(0, 0);
  updateEstimatePreview();
}

function initAddressAutocomplete() {
  const input =
    byId('quoteAddressInput') ||
    document.querySelector('#quoteForm input[name="address"]');

  if (!input || !window.google?.maps?.places) {
    console.warn('Google Places not loaded � autocomplete disabled');
    return;
  }

  const autocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'us' },
    fields: ['formatted_address', 'geometry', 'address_components'],
    types: ['address'],
  });

  autocomplete.addListener('place_changed', () => {
    resetParcelQuoteStateForNewAddress();

    const place = autocomplete.getPlace();
    if (!place?.geometry?.location) return;

    const form = byId('quoteForm');
    if (!form) return;

    const components = place.address_components || [];

    const getLong = (type) =>
      components.find((c) => c.types.includes(type))?.long_name || '';

    const getShort = (type) =>
      components.find((c) => c.types.includes(type))?.short_name || '';

    form.elements.address.value =
      `${getLong('street_number')} ${getLong('route')}`.trim() ||
      place.formatted_address ||
      input.value;

    form.elements.city.value =
      getLong('locality') ||
      getLong('sublocality') ||
      getLong('administrative_area_level_3') ||
      '';

    form.elements.state.value =
      getShort('administrative_area_level_1') || 'AR';

    form.elements.zip.value = getLong('postal_code') || '';

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    setLatLng(lat, lng);
    placeMarker(lat, lng);
    saveQuoteDraft();
    updateEstimatePreview();

    setTimeout(() => {
      lookupParcel().catch((error) => {
        console.warn('Autocomplete parcel lookup failed', error);
      });
}, 100);
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   ROLE VISIBILITY — show/hide admin controls based on session role
───────────────────────────────────────────────────────────────────────── */

function applyRoleVisibility() {
  const isAdmin = state.currentUser?.role === 'admin';

  // Admin nav buttons: only visible to admins
  $$('.admin-only-nav').forEach((el) => {
    el.style.display = isAdmin ? '' : 'none';
  });

  // Admin view: show controls or auth wall
  const wall = byId('adminAuthWall');
  const wrap = byId('adminControlsWrap');
  if (wall) wall.style.display = isAdmin ? 'none' : '';
  if (wrap) wrap.style.display = isAdmin ? '' : 'none';
}

/* ─────────────────────────────────────────────────────────────────────────
   AUTH GATE — shown when unauthenticated user tries to book a service
───────────────────────────────────────────────────────────────────────── */

function openAuthGate(onSuccess) {
  state._authGateCallback = onSuccess;
  const el = byId('authGateModal');
  if (el) { el.classList.remove('hidden'); el.style.display = 'flex'; }
  byId('gateLoginForm')?.reset();
  byId('gateRegisterForm')?.reset();
  showGateTab('login');
}

function closeAuthGate() {
  const el = byId('authGateModal');
  if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
  state._authGateCallback = null;
}

function showGateTab(tab) {
  byId('gateLoginForm')?.classList.toggle('hidden', tab !== 'login');
  byId('gateRegisterForm')?.classList.toggle('hidden', tab !== 'register');
  byId('gateLoginTab')?.classList.toggle('active', tab === 'login');
  byId('gateRegisterTab')?.classList.toggle('active', tab !== 'login');
}

byId('closeAuthGateBtn')?.addEventListener('click', closeAuthGate);

// Close on backdrop click
byId('authGateModal')?.addEventListener('click', (e) => {
  if (e.target === byId('authGateModal')) closeAuthGate();
});

byId('gateLoginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const { email, password } = Object.fromEntries(new FormData(e.target));
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Login failed');
    setAuthToken(json.token);
    state.currentUser = json.user;
    applyRoleVisibility();
    closeAuthGate();
    if (typeof state._authGateCallback === 'function') state._authGateCallback();
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

byId('gateRegisterForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const { fullName, email, password } = Object.fromEntries(new FormData(e.target));
    const regRes = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password, role: 'customer' }),
    });
    const regJson = await regRes.json();
    if (!regJson.ok) throw new Error(regJson.error || 'Registration failed');
    // Auto-login after register
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginJson = await loginRes.json();
    if (!loginJson.ok) throw new Error('Account created — please log in.');
    setAuthToken(loginJson.token);
    state.currentUser = loginJson.user;
    applyRoleVisibility();
    closeAuthGate();
    if (typeof state._authGateCallback === 'function') state._authGateCallback();
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   QUOTE → JOB BOOKING
───────────────────────────────────────────────────────────────────────── */

async function bookQuoteAsJob() {
  if (!state.lastQuote) {
    showResult('quoteResult', '<strong>Submit a quote first, then book.</strong>');
    return;
  }

  if (!getAuthToken()) {
    openAuthGate(bookQuoteAsJob);
    return;
  }

  const btn = byId('bookJobBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Booking…'; }

  try {
    const q = state.lastQuote;
    const serviceLabel = q.serviceType
      ? String(q.serviceType).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
      : 'Mowing';

    const detailParts = [
      q.notes ? `Notes: ${q.notes}` : '',
      q.parcelId ? `Parcel ID: ${q.parcelId}` : '',
      Number(q.mowAreaSqft || 0) > 0 ? `Mow area: ${Number(q.mowAreaSqft).toLocaleString()} sqft` : '',
      Number(q.lotAreaSqft || 0) > 0 ? `Lot area: ${Number(q.lotAreaSqft).toLocaleString()} sqft` : '',
      q.propertyType && q.propertyType !== 'standard' ? `Property type: ${q.propertyType}` : '',
      q.fenced ? 'Fenced' : '',
      q.overgrown ? 'Overgrown' : '',
      q.obstacles ? 'Obstacles' : '',
      q.rushJob ? 'Rush job' : '',
      q.slopedTerrain ? 'Sloped terrain' : '',
    ].filter(Boolean).join(' · ');

    const payload = {
      title: `${serviceLabel} — ${q.address || 'Property'}`,
      address: q.address || '',
      city: q.city || '',
      state: q.state || 'AR',
      zip: q.zip || '',
      regionId: q.regionId || '',
      budget: Number(q.estimate || 0),
      serviceType: q.serviceType || 'mowing',
      preferredDate: q.preferredDate || null,
      details: detailParts,
      photos: [],
    };

    const data = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    state.lastQuote = null;

    showResult(
      'quoteResult',
      `<strong>Job booked!</strong><br>
       Job ID: ${escapeHtml(data.job.id)}<br>
       Address: ${escapeHtml(data.job.address)}<br>
       Price: <strong>${money(data.job.budget)}</strong><br>
       Status: <span class="status-badge ${escapeHtml(data.job.status)}">${escapeHtml(data.job.status)}</span><br><br>
       <button class="btn secondary small" type="button"
         onclick="setActiveView('jobs')">View My Bookings &rarr;</button>`
    );

    await loadMyJobs();
    await loadAdmin().catch(() => {});
  } catch (error) {
    showResult('quoteResult', `<strong>Booking failed:</strong> ${escapeHtml(error.message)}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Book This Service →'; }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   MY BOOKINGS (customer) + OPEN JOBS (provider)
───────────────────────────────────────────────────────────────────────── */

function statusBadge(status) {
  return `<span class="status-badge ${escapeHtml(status || 'open')}">${escapeHtml(status || 'open')}</span>`;
}

async function loadMyJobs() {
  const list = byId('myJobsList');
  if (!list) return;

  if (!getAuthToken()) {
    list.innerHTML = '<div style="color:var(--muted);padding:12px">Sign in to see your bookings.</div>';
    return;
  }

  list.innerHTML = '<div style="color:var(--muted);padding:12px">Loading…</div>';

  try {
    const data = await api('/api/jobs/my');
    list.innerHTML = '';

    if (!data.jobs.length) {
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No bookings yet. Submit a quote and click "Book This Service".</div>';
      return;
    }

    data.jobs.forEach((job) => {
      const c = card(`
        <h4>${escapeHtml(job.title || 'Lawn Service')}</h4>
        <div class="meta">${escapeHtml(job.address || '')} ${escapeHtml(job.city || '')} ${escapeHtml(job.state || '')}</div>
        <div class="meta">Price: <strong>${money(job.budget)}</strong> &nbsp;·&nbsp; ${statusBadge(job.status)}</div>
        ${job.details ? `<p>${escapeHtml(job.details)}</p>` : ''}
        <div class="meta" style="font-size:.85rem">Booked: ${job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'n/a'}</div>
      `);
      list.append(c);
    });
  } catch {
    list.innerHTML = '<div style="color:var(--muted);padding:12px">Could not load bookings (sign in required).</div>';
  }
}

async function loadOpenJobsForProvider() {
  const list = byId('myJobsList');
  if (!list) return;

  list.innerHTML = '<div style="color:var(--muted);padding:12px">Loading open jobs…</div>';

  try {
    const data = await fetch('/api/jobs/open').then((r) => r.json());
    list.innerHTML = '';

    if (!data.jobs || !data.jobs.length) {
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No open jobs right now. Check back soon.</div>';
      return;
    }

    data.jobs.forEach((job) => {
      const isProvider = state.currentUser?.role === 'provider';
      const c = card(`
        <h4>${escapeHtml(job.title || 'Lawn Service')}</h4>
        <div class="meta">${escapeHtml(job.address || '')} ${escapeHtml(job.city || '')} ${escapeHtml(job.state || '')}</div>
        <div class="meta">Budget: <strong>${money(job.budget)}</strong> &nbsp;·&nbsp; ${statusBadge(job.status)}</div>
        ${job.details ? `<p>${escapeHtml(job.details.slice(0, 200))}</p>` : ''}
        <div class="meta" style="font-size:.85rem">Posted: ${job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'n/a'}</div>
        ${isProvider ? `<button class="btn primary small" data-accept-job="${escapeHtml(job.id)}" style="margin-top:8px">Accept Job</button>` : ''}
      `);
      list.append(c);
    });

    // Wire accept buttons
    list.querySelectorAll('[data-accept-job]').forEach((btn) => {
      btn.addEventListener('click', () => acceptJob(btn.dataset.acceptJob, btn));
    });
  } catch (err) {
    list.innerHTML = `<div style="color:var(--muted);padding:12px">Could not load open jobs: ${escapeHtml(err.message)}</div>`;
  }
}

async function acceptJob(jobId, btn) {
  if (!getAuthToken()) {
    openAuthGate(() => acceptJob(jobId, btn));
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Accepting…'; }
  try {
    const data = await api(`/api/jobs/${jobId}/accept`, { method: 'POST', body: '{}' });
    if (btn) {
      btn.textContent = 'Accepted!';
      btn.className = 'btn ghost small';
    }
    showResult('jobResult', `<strong>Job accepted!</strong> Job ID: ${escapeHtml(data.job.id)} is now assigned to you.`);
    await loadMyJobs();
  } catch (error) {
    alert('Could not accept job: ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Accept Job'; }
  }
}

// Wire My Bookings panel buttons
byId('showMyJobsBtn')?.addEventListener('click', () => {
  byId('myBookingsPanelTitle') && (byId('myBookingsPanelTitle').textContent = 'My Bookings');
  loadMyJobs();
});

byId('showOpenJobsBtn')?.addEventListener('click', () => {
  byId('myBookingsPanelTitle') && (byId('myBookingsPanelTitle').textContent = 'Open Jobs');
  loadOpenJobsForProvider();
});

byId('refreshMyJobs')?.addEventListener('click', () => {
  const title = byId('myBookingsPanelTitle')?.textContent || '';
  if (title.includes('Open')) loadOpenJobsForProvider();
  else loadMyJobs();
});

(async function init() {
  initNavigation();
  initMap();

  await loadConfig();

  if (state.config?.maps?.googleApiKey) {
    try {
      await loadGoogleMaps(state.config.maps.googleApiKey);
      initAddressAutocomplete();
    } catch (e) {
      console.warn('Google Maps failed to load', e);
    }
  } else {
    console.warn('No Google Maps API key returned from /api/config');
  }

  // Resolve current user so role-based UI (provider Accept, My Bookings, admin) works immediately
  if (getAuthToken()) {
    try {
      const meData = await api('/api/auth/me');
      state.currentUser = meData.user;
      updateSessionStatus(meData.user);
    } catch {
      setAuthToken('');
      state.currentUser = null;
    }
  }
  applyRoleVisibility();

  updateSessionStatus();
  await Promise.allSettled([loadProviders(), loadJobs(), loadAdmin()]);

  const form = byId('quoteForm');
  const lat = form?.elements?.lat?.value;
  const lng = form?.elements?.lng?.value;

  if (lat && lng) {
    placeMarker(lat, lng);
    lookupParcel().catch(() => {});
  } else {
    updateMowAreaHelper(0, 0);
  }
})();