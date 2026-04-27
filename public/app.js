// byId, $$, all constants (QUOTE_DRAFT_KEY, EPSG*, SERVICE_CATALOG, etc.)
// are now defined in public/js/config.js and public/js/utils/dom.js — loaded before this file.

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

// isAdmin, showAdminControls, hideAdminControls → public/js/auth/admin-visibility.js

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
  const mobileAuth = byId('mobileAuthBtn');
  if (!el) return;
  const token = getAuthToken();
  if (!token) {
    el.textContent = 'Guest mode';
    el.classList.remove('ok');
    if (mobileAuth) mobileAuth.textContent = 'Login';
    return;
  }
  if (user?.email) {
    el.textContent = `${user.email} - ${user.role || 'user'}`;
    el.classList.add('ok');
    if (mobileAuth) mobileAuth.textContent = user.role === 'admin' ? 'Admin' : 'Account';
    return;
  }
  el.textContent = 'Session saved';
  el.classList.add('ok');
  if (mobileAuth) mobileAuth.textContent = 'Account';
}

// money() → public/js/utils/dom.js

function formToObject(form) {
  const fd = new FormData(form);
  const obj = Object.fromEntries(fd.entries());
  for (const box of form.querySelectorAll('input[type="checkbox"]')) {
    obj[box.name] = box.checked;
  }
  return obj;
}

function checkedValues(name, root = document) {
  return $$(`input[name="${name}"]:checked`, root).map((input) => input.value);
}

function selectedServiceMeta(serviceId) {
  const aliases = {
    leaf_cleanup: 'leaf_removal',
    brush_cleanup: 'brush_removal',
    landscaping: 'mulch_flower_beds',
    hauling: 'haul_away',
    debris_hauling: 'haul_away',
    other: 'outdoor_junk_debris_removal',
    other_outdoor_work: 'outdoor_junk_debris_removal',
    mowing_edging: 'mowing',
  };
  const normalized = aliases[serviceId] || serviceId;
  return SERVICE_CATALOG.find((service) => service.id === normalized) || SERVICE_CATALOG[0];
}

function aiPhotoPlaceholder(overrides = {}) {
  return { ...AI_PHOTO_PLACEHOLDER, ...overrides };
}

function buildQuotePayload(form) {
  const payload = formToObject(form);
  const drawnMowAreaSqft = currentDrawnMowAreaSqFt();
  payload.mowAreaSqft = drawnMowAreaSqft > 0 ? drawnMowAreaSqft : 0;
  payload.areaSqft = payload.mowAreaSqft;
  if (form?.elements?.mowAreaSqft) form.elements.mowAreaSqft.value = payload.mowAreaSqft || '';
  if (form?.elements?.customerAdjustedMowableSqft) {
    form.elements.customerAdjustedMowableSqft.value = payload.mowAreaSqft || '';
  }
  payload.quote_type = state.serviceFlow || 'instant_mow';
  payload.quoteType = payload.quote_type;
  payload.selected_yard_areas = checkedValues('selected_yard_areas', form);
  payload.selectedYardAreas = payload.selected_yard_areas;
  payload.requested_tasks = checkedValues('requested_tasks', form);
  payload.requestedTasks = payload.requested_tasks;
  payload.obstacles_list = checkedValues('obstacles_list', form);
  payload.available_days_json = checkedValues('available_days_json', form);
  payload.availableDays = payload.available_days_json;
  payload.gate_size_category = payload.gate_size_category || payload.gate_access_type || '';
  payload.yard_access_notes = payload.yard_access_notes || payload.access_notes || '';
  payload.community_access_private = Boolean(payload.community_access_instructions);
  payload.pets = payload.pets || 'none';
  payload.obstacles = Boolean(payload.obstacles || payload.obstacles_list.length);
  payload.included_tasks_json = INCLUDED_MOW_TASKS;
  payload.excluded_tasks_json = EXCLUDED_MOW_TASKS;
  payload.scope_locked = Boolean(payload.standardMowScopeAck);
  payload.final_price = Number(payload.estimate || payload.final_price || 0);
  payload.status = payload.status || 'estimate_ready';
  return payload;
}

function buildAccessSummary(payload = {}) {
  return [
    (payload.gate_size_category || payload.gate_access_type) ? `Gate: ${payload.gate_size_category || payload.gate_access_type}` : '',
    payload.gate_width_inches ? `Gate width: ${payload.gate_width_inches} in` : '',
    payload.mower_access ? `Mower access: ${payload.mower_access}` : '',
    (payload.yard_access_notes || payload.access_notes) ? `Yard access notes: ${payload.yard_access_notes || payload.access_notes}` : '',
    payload.community_access_type ? `Community access: ${payload.community_access_type}` : '',
    payload.community_access_type && payload.community_access_type !== 'no' ? 'Community instructions private' : '',
  ].filter(Boolean).join(' - ');
}

function buildScheduleSummary(payload = {}) {
  const days = payload.available_days_json || payload.availableDays || [];
  return [
    Array.isArray(days) && days.length ? `Days: ${days.join(', ')}` : '',
    payload.time_preference ? `Time: ${payload.time_preference}` : '',
    payload.schedule_flexibility ? `Flexibility: ${payload.schedule_flexibility}` : '',
    payload.available_date_start || payload.available_date_end ? `Range: ${payload.available_date_start || '?'} to ${payload.available_date_end || '?'}` : '',
    payload.specific_service_date ? `Specific date: ${payload.specific_service_date}` : '',
  ].filter(Boolean).join(' - ');
}

function equipmentRecommendation(payload = {}) {
  const gate = payload.gate_size_category || payload.gate_access_type || '';
  if (gate === 'no_gate_open_access') return 'Recommended equipment: any deck size likely okay. Large mower access: likely yes.';
  if (gate === 'small_under_36') return 'Recommended equipment: push mower / small walk-behind. Large zero-turn access: unlikely.';
  if (gate === 'standard_36') return 'Recommended equipment: push mower or small-gate mower. Large zero-turn access: unlikely.';
  if (gate === 'wide_48') return 'Recommended equipment: smaller walk-behind; verify before dispatch. Large zero-turn access: unlikely.';
  if (gate === 'double_60_plus') return 'Recommended equipment: larger decks may fit; provider should verify gate and turns.';
  if (gate === 'not_sure') return 'Recommended equipment: small-gate capable mower or request gate photo/confirmation.';
  if (gate === 'other_size') return 'Recommended equipment: verify custom gate width before dispatch.';
  return '';
}

function availableDayCheckboxes(name = 'available_days_json') {
  return AVAILABLE_DAY_OPTIONS.map(([value, label]) => `<label><input type="checkbox" name="${name}" value="${value}" /> ${label}</label>`).join('');
}

function serviceTaskCheckboxes(name = 'requested_tasks', selected = []) {
  const selectedSet = new Set(selected);
  return EXTRA_SERVICE_OPTIONS.map(([value, label]) => `
    <label><input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${selectedSet.has(value) ? 'checked' : ''} /> ${escapeHtml(label)}</label>
  `).join('');
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

// showResult, showToast, showSuccess/Error/Warning/Info, card, escapeHtml → public/js/utils/dom.js

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

// state, QUOTE_STEP_ORDER → public/js/state.js

function quoteStepNumber(step = state.quoteFlowStep) {
  return Math.max(1, QUOTE_STEP_ORDER.indexOf(step) + 1);
}

function setMapGestureCapture(enabled) {
  if (!state.map) return;
  ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'].forEach((key) => {
    const control = state.map[key];
    if (!control) return;
    try {
      if (enabled && typeof control.enable === 'function') control.enable();
      if (!enabled && typeof control.disable === 'function') control.disable();
    } catch {}
  });
}

function showQuoteFlowStep(step, options = {}) {
  const nextStep = QUOTE_STEP_ORDER.includes(step) ? step : 'start';
  state.quoteFlowStep = nextStep;
  document.body.dataset.quoteFlowStep = nextStep;

  $$('[data-quote-step-panel]').forEach((panel) => {
    const active = panel.dataset.quoteStepPanel === nextStep;
    panel.classList.toggle('is-active', active);
    panel.classList.toggle('hidden', !active && panel.id === 'leadRequestPanel');
  });

  const drawing = nextStep === 'draw';
  setMapGestureCapture(drawing);
  setMapToolPanelOpen(drawing);
  if (drawing && state.map) {
    setTimeout(() => state.map.invalidateSize(true), 80);
    setTimeout(() => state.parcelLayer ? fitLayerBoundsWithContext(state.parcelLayer) : state.map.invalidateSize(true), 180);
  } else if (!drawing) {
    stopToolModes();
  }

  updateQuoteStepper();
  updateQuoteFlowState({ skipStepper: true });

  if (options.scroll !== false) {
    const activePanel = document.querySelector(`[data-quote-step-panel="${nextStep}"]`);
    activePanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

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
  state.map.setView([lat, lng], 15);
  setTimeout(() => state.map?.invalidateSize(), 100);
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

function clearParcelLayer() {
  if (state.parcelLayer && state.map) {
    state.map.removeLayer(state.parcelLayer);
  }
  if (state.buildingFootprintGroup) {
    state.buildingFootprintGroup.clearLayers();
  }
  state.parcelLayer = null;
  state.parcelGeometry = null;
  state.mowableEstimate = null;
  renderSuggestedMowablePanel(null);
}

function geometryLooksProjected(geometry) {
  const rings = geometry?.rings || geometry?.coordinates || [];
  const firstRing = rings.find((ring) => Array.isArray(ring) && ring.length);
  const firstPoint = firstRing?.find((pt) => Array.isArray(pt) && pt.length >= 2);
  if (!firstPoint) return false;
  const x = Number(firstPoint[0]);
  const y = Number(firstPoint[1]);
  return Math.abs(x) > 180 || Math.abs(y) > 90;
}

function ringToLeafletLatLngs(ring, geometry) {
  const projected = geometryLooksProjected(geometry);
  return ring.map(([xRaw, yRaw]) => {
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    if (projected) {
      const [lng, lat] = proj4(EPSG26915, EPSG4326, [x, y]);
      return [lat, lng];
    }

    return [y, x];
  }).filter(Boolean);
}

function esriPolygonToLeafletLatLngs(geometry) {
  const rings = geometry?.rings || geometry?.coordinates || [];
  return rings.map((ring) => ringToLeafletLatLngs(ring, geometry)).filter((ring) => ring.length >= 3);
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
    const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
    if (!parcelRings.length) return null;
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

function reorderMapOverlays() {
  if (state.parcelLayer?.bringToBack) state.parcelLayer.bringToBack();
  if (state.buildingFootprintGroup?.bringToFront) state.buildingFootprintGroup.bringToFront();
  if (state.aiCutoutGroup?.bringToFront) state.aiCutoutGroup.bringToFront();
  if (state.drawGroup?.bringToFront) state.drawGroup.bringToFront();
}

function fitBoundsWithContext(bounds, options = {}) {
  if (!state.map || !bounds?.isValid?.()) return;
  const fitOptions = { ...PARCEL_FIT_OPTIONS, ...options };

  state.map.invalidateSize();
  state.map.fitBounds(bounds, fitOptions);

  setTimeout(() => {
    if (!state.map) return;
    state.map.invalidateSize();
    state.map.fitBounds(bounds, fitOptions);
  }, 100);
}

function fitLayerBoundsWithContext(layer, options = {}) {
  const bounds = layer?.getBounds?.();
  fitBoundsWithContext(bounds, options);
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

  // ArcGIS polygon geometry may arrive as projected UTM rings or lon/lat rings.
  const rings = geometry.rings || geometry.coordinates;
  if (!rings || !rings.length) {
    console.warn("drawParcel: no rings", geometry);
    return;
  }

  const latLngRings = rings
    .map((ring) => ringToLeafletLatLngs(ring, geometry))
    .filter((ring) => ring.length >= 3);

  if (!latLngRings.length) {
    console.warn("drawParcel: invalid lat/lng rings", geometry);
    return;
  }

  state.parcelGeometry = geometry;

  const layer = L.polygon(latLngRings, {
    color: "#38bdf8",
    weight: 3,
    opacity: 1,
    fillColor: "#38bdf8",
    fillOpacity: 0.08,
    interactive: false
  });

  layer.addTo(map);
  state.parcelLayer = layer;

  fitLayerBoundsWithContext(layer);
  reorderMapOverlays();

  // Force Leaflet to repaint after sequential lookups / mobile layout shifts
  requestAnimationFrame(() => {
    map.invalidateSize(true);
    layer.redraw();
  });
}

function formatSqft(value) {
  const n = Math.round(Number(value || 0));
  return n > 0 ? `${n.toLocaleString()} sq ft` : 'n/a';
}

const SQFT_PER_ACRE = 43560;
function sqftToAcres(sqft) { return Math.round(Number(sqft || 0)) / SQFT_PER_ACRE; }
function formatAcres(sqft) { const n = Math.round(Number(sqft || 0)); return n > 0 ? `${sqftToAcres(n).toFixed(2)} acres` : 'n/a'; }

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

async function getBuildingFootprintsForParcel(_parcelGeometry) {
  return {
    footprints: [],
    source: 'fallback',
  };
}

function calculateBuildingFootprintSqft(footprints) {
  if (!Array.isArray(footprints) || !footprints.length) return 0;

  return Math.round(footprints.reduce((sum, footprint) => {
    try {
      const feature = footprint?.type === 'Feature'
        ? footprint
        : footprint?.geometry
          ? { type: 'Feature', properties: footprint.properties || {}, geometry: footprint.geometry }
          : null;
      return feature ? sum + turf.area(feature) * 10.7639 : sum;
    } catch {
      return sum;
    }
  }, 0));
}

function fallbackMowableRatio(parcelAreaSqft) {
  if (parcelAreaSqft <= 12000) return 0.65;
  if (parcelAreaSqft <= 30000) return 0.55;
  return 0.35;
}

function calculateAutoMowableEstimate(parcelAreaSqft, buildingFootprintSqft, source = 'building_footprints') {
  const parcelArea = Math.max(0, Math.round(Number(parcelAreaSqft || 0)));
  const footprintArea = Math.max(0, Math.round(Number(buildingFootprintSqft || 0)));

  if (parcelArea <= 0) {
    return {
      parcelAreaSqft: 0,
      buildingFootprintSqft: footprintArea,
      buildingAdjustedSqft: 0,
      estimatedNonMowableSqft: 0,
      autoEstimatedMowableSqft: 0,
      mowableEstimateConfidence: 'low',
      buildingFootprintsSource: 'fallback',
    };
  }

  if (footprintArea > 0) {
    const buildingAdjustedSqft = Math.round(footprintArea * 1.25);
    return {
      parcelAreaSqft: parcelArea,
      buildingFootprintSqft: footprintArea,
      buildingAdjustedSqft,
      estimatedNonMowableSqft: buildingAdjustedSqft,
      autoEstimatedMowableSqft: Math.max(0, parcelArea - buildingAdjustedSqft),
      mowableEstimateConfidence: 'medium',
      buildingFootprintsSource: source || 'building_footprints',
    };
  }

  const autoEstimatedMowableSqft = Math.round(parcelArea * fallbackMowableRatio(parcelArea));
  return {
    parcelAreaSqft: parcelArea,
    buildingFootprintSqft: 0,
    buildingAdjustedSqft: 0,
    estimatedNonMowableSqft: Math.max(0, parcelArea - autoEstimatedMowableSqft),
    autoEstimatedMowableSqft,
    mowableEstimateConfidence: 'low',
    buildingFootprintsSource: 'fallback',
  };
}

function setFormEstimateFields(form, estimate) {
  if (!form || !estimate) return;
  MOWABLE_ESTIMATE_FIELDS.forEach((name) => {
    if (form.elements[name]) form.elements[name].value = estimate[name] ?? '';
  });
}

function applySuggestedMowableArea() {
  const form = byId('quoteForm');
  const estimate = state.mowableEstimate;
  if (!form || !estimate) return;

  setFormEstimateFields(form, estimate);
  form.elements.lotAreaSqft.value = estimate.parcelAreaSqft || '';
  form.elements.mowAreaSqft.value = '';
  if (form.elements.lotSource) form.elements.lotSource.value = 'auto_building_estimate';
  if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = '';

  updateMowAreaHelper(estimate.parcelAreaSqft, 0);
  saveQuoteDraft();
  updateEstimatePreview();
  updateQuoteFlowState();
  showWarning('Draw your mowable area first.');
}

function adjustYardOutlineFromSuggestion() {
  if (!state.drawGroup?.getLayers().length && state.parcelGeometry) {
    cloneParcelAsMowable();
    return;
  }
  if (state.drawGroup?.getLayers().length) startEditMowable();
  else startDrawMowable();
}

function renderSuggestedMowablePanel(estimate) {
  const panel = byId('suggestedMowablePanel');
  if (!panel) return;

  if (!estimate || !estimate.parcelAreaSqft) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  const buildingLine = estimate.buildingFootprintSqft > 0
    ? `<div class="suggested-mowable-metric"><span>Building footprint</span><strong>${formatAcres(estimate.buildingFootprintSqft)}</strong></div>`
    : `<div class="suggested-mowable-metric"><span>Building footprint</span><strong>Not detected</strong></div>`;

  panel.innerHTML = `
    <div>
      <h4>Suggested mowable area</h4>
      <p>We estimated your mowable area from property and building footprint data. Adjust the outline if needed.</p>
    </div>
    <div class="suggested-mowable-grid">
      <div class="suggested-mowable-metric"><span>Parcel size</span><strong>${formatAcres(estimate.parcelAreaSqft)}</strong></div>
      ${buildingLine}
      <div class="suggested-mowable-metric"><span>Suggested mowable</span><strong>${formatAcres(estimate.autoEstimatedMowableSqft)}</strong></div>
      <div class="suggested-mowable-metric"><span>Confidence</span><strong>${escapeHtml(estimate.mowableEstimateConfidence || 'low')}</strong></div>
    </div>
    <div class="suggested-mowable-actions">
      <button class="btn primary small" type="button" id="useSuggestedMowableBtn">Use Suggested Area</button>
      <button class="btn secondary small" type="button" id="adjustYardOutlineBtn">Adjust Yard Outline</button>
    </div>
  `;
  panel.classList.remove('hidden');

  byId('useSuggestedMowableBtn')?.addEventListener('click', applySuggestedMowableArea);
  byId('adjustYardOutlineBtn')?.addEventListener('click', adjustYardOutlineFromSuggestion);
}

function drawBuildingFootprintHelpers(footprints) {
  if (!state.buildingFootprintGroup || !Array.isArray(footprints)) return;

  state.buildingFootprintGroup.clearLayers();
  if (!footprints.length) return;

  footprints.forEach((footprint) => {
    try {
      const layer = L.geoJSON(footprint, {
        style: {
          color: '#f97316',
          weight: 2,
          fillColor: '#f97316',
          fillOpacity: 0.24,
          interactive: false,
        },
      });
      layer.eachLayer((subLayer) => state.buildingFootprintGroup.addLayer(subLayer));
    } catch (error) {
      console.warn('Could not draw building footprint helper', error);
    }
  });

  reorderMapOverlays();
}

async function updateAutoMowableEstimateForParcel(parcelAreaHint = 0) {
  const form = byId('quoteForm');
  if (!state.parcelGeometry || !form) return null;

  const parcelAreaSqft = Math.round(Number(parcelAreaHint || 0))
    || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : 0);
  const footprintResult = await getBuildingFootprintsForParcel(state.parcelGeometry);
  const footprints = footprintResult?.footprints || [];
  const buildingFootprintSqft = calculateBuildingFootprintSqft(footprints);
  const estimate = calculateAutoMowableEstimate(
    parcelAreaSqft,
    buildingFootprintSqft,
    buildingFootprintSqft > 0 ? (footprintResult?.source || 'building_footprints') : 'fallback'
  );

  state.mowableEstimate = estimate;
  setFormEstimateFields(form, estimate);
  if (!Number(form.elements.lotAreaSqft.value || 0)) form.elements.lotAreaSqft.value = estimate.parcelAreaSqft || '';
  renderSuggestedMowablePanel(estimate);
  drawBuildingFootprintHelpers(footprints);
  return estimate;
}
function styleMowLayer(layer) {
  if (layer?.setStyle) {
    layer.setStyle({
      color: '#16a34a',
      weight: 3,
      fillOpacity: 0.18,
    });
  }

  if (layer) {
    layer.options.interactive = true;
    layer._turflynkMowable = true;
    attachMowableMoveHandlers(layer);
  }
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
  if (layer.redraw) layer.redraw();
}

function attachMowableMoveHandlers(layer) {
  if (!layer || layer._turflynkMoveBound) return;
  layer._turflynkMoveBound = true;

  layer.on('mousedown touchstart', (event) => {
    const directEditing = typeof layer.editing?.enabled === 'function' && layer.editing.enabled();
    if ((!state.editHandler && !directEditing) || !layer._turflynkMowable || !state.map) return;
    const latlng = eventLatLng(event);
    if (!latlng) return;
    const originalEvent = event.originalEvent || {};
    if (originalEvent.target?.classList?.contains('leaflet-editing-icon')) return;

    L.DomEvent.stop(originalEvent);
    state.moveDrag = {
      layer,
      lastLatLng: latlng,
      moved: false,
    };

    state.map.dragging.disable();
    setEditorModeLabel('Mode: Moving mowable area');
  });
}

function finishMowableMove() {
  if (!state.moveDrag) return;
  const moved = state.moveDrag.moved;
  state.moveDrag = null;

  if (state.map?.dragging) state.map.dragging.enable();

  if (moved) {
    syncMowAreaFromLayers();
  }

  setEditorModeLabel('Mode: Editing mowable areas');
}

function eventLatLng(event) {
  if (event?.latlng) return event.latlng;
  const touch = event?.originalEvent?.touches?.[0] || event?.originalEvent?.changedTouches?.[0];
  if (!touch || !state.map) return null;
  const point = state.map.mouseEventToContainerPoint(touch);
  return state.map.containerPointToLatLng(point);
}

function installMowableMoveMapHandlers() {
  if (!state.map || state._mowMoveHandlersInstalled) return;
  state._mowMoveHandlersInstalled = true;

  state.map.on('mousemove touchmove', (event) => {
    const latlng = eventLatLng(event);
    if (!state.moveDrag || !latlng) return;
    if (event.originalEvent) L.DomEvent.preventDefault(event.originalEvent);
    translateLayerLatLngs(state.moveDrag.layer, state.moveDrag.lastLatLng, latlng);
    state.moveDrag.lastLatLng = latlng;
    state.moveDrag.moved = true;
  });

  state.map.on('mouseup touchend touchcancel', finishMowableMove);
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
  state.quoteUiMode = 'drawing';

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
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}


function getAllMowLayers() {
  if (!state.drawGroup) return [];
  return state.drawGroup.getLayers().filter((layer) => typeof layer.toGeoJSON === 'function');
}

function totalMowAreaSqFt() {
  return getAllMowLayers().reduce((sum, layer) => sum + layerAreaSqFt(layer), 0);
}

function currentDrawnMowAreaSqFt() {
  return Math.round(totalMowAreaSqFt());
}

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
    helper.innerHTML = '<strong>Mowable area editor:</strong> Draw your mowable area first. The parcel outline is only a property boundary.';
    return;
  }

  const pct = parcelSqFt ? Math.round((mowSqFt / parcelSqFt) * 100) : null;
  helper.innerHTML = `
    <strong>Mowable area editor:</strong><br>
    Total mowable area: ${formatAcres(mowSqFt)}${pct ? ` (${pct}% of parcel)` : ''}<br>
    Tap a green area to edit it, or use the buttons below.
  `;
}

function syncMowAreaFromLayers() {
  const form = byId('quoteForm');
  if (!form) return;

  const totalSqFt = currentDrawnMowAreaSqFt();
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
  updateEstimatePreview();
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
  if (totalSqFt > 0) showSuccess('Mowable area updated');
}

function stopToolModes() {
  finishMowableMove();

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
  state.quoteUiMode = 'idle';
  setEditorModeLabel('Mode: Ready');
  updateQuoteFlowState();
}

function clearMowLayer() {
  stopToolModes();

  if (state.drawGroup) {
    state.drawGroup.clearLayers();
  }

  const form = byId('quoteForm');
  if (form) {
    form.elements.mowAreaSqft.value = '';
    if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = '';
    if (form.elements.lotSource) form.elements.lotSource.value = '';
  }
  state.pendingQuote = null;

  updateMowAreaHelper(Number(form?.elements?.lotAreaSqft?.value || 0), 0);
  saveQuoteDraft();
  updateEstimatePreview();
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
  showInfo('Mowable area cleared');
}

function cloneParcelAsMowable(options = {}) {
  const starter = options?.starter === true;
  const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
  if (!parcelRings.length || !state.map || !state.drawGroup) {
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

  fitLayerBoundsWithContext(layer);

  const totalSqFt = totalMowAreaSqFt();
  const parcelSqFt = state.mowableEstimate?.parcelAreaSqft
    || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : totalSqFt);
  const form = byId('quoteForm');

  if (form && !starter) {
    form.elements.lotAreaSqft.value = parcelSqFt || totalSqFt || '';
    form.elements.mowAreaSqft.value = totalSqFt || '';
    form.elements.lotSource.value = 'parcel';
    if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = totalSqFt || '';
  }

  if (starter) {
    reorderMapOverlays();
    updateMowAreaHelper(parcelSqFt, Number(form?.elements?.mowAreaSqft?.value || 0));
  } else {
    syncMowAreaFromLayers();
    setTimeout(() => {
      startEditMowable();
    }, 0);
    showInfo('Full property selected as mowable area');
  }
  updateQuoteFlowState();
}

function hasActiveMowableArea() {
  return currentDrawnMowAreaSqFt() > 0;
}

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
}

function updateQuoteFlowState(options = {}) {
  const form = byId('quoteForm');
  const parcelLoaded = Boolean(state.parcelLayer);
  const mowSelected = hasActiveMowableArea();
  const editing = state.quoteUiMode === 'editing' || state.quoteUiMode === 'deleting';
  const drawing = state.quoteUiMode === 'drawing';
  const hasEstimate = mowSelected && state.pendingQuote?.estimate > 0;

  document.body.dataset.quoteState = editing
    ? 'editing'
    : mowSelected
      ? 'mowable-selected'
      : parcelLoaded
        ? 'parcel-loaded'
        : 'empty';

  setElementVisible('mapToolsToggle', parcelLoaded && state.quoteFlowStep === 'draw');
  if (!parcelLoaded || state.quoteFlowStep !== 'draw') setMapToolPanelOpen(false);

  setElementVisible('useParcelShapeBtn', parcelLoaded && !mowSelected && !editing && !drawing);
  setElementVisible('lassoYardBtn', parcelLoaded && !mowSelected && !editing && !drawing);
  setElementVisible('finishLassoBtn', parcelLoaded && drawing);
  setElementVisible('drawMowableBtn', parcelLoaded && !editing && !drawing);
  setElementVisible('editMowableBtn', parcelLoaded && mowSelected && !editing && !drawing);
  setElementVisible('deleteMowableBtn', parcelLoaded && mowSelected && !drawing);
  setElementVisible('cutMowableBtn', parcelLoaded && mowSelected && !editing && !drawing);
  setElementVisible('clearMowAreaBtn', parcelLoaded && mowSelected);
  setElementVisible('undoCutBtn', parcelLoaded && mowSelected && !editing && !drawing);
  setElementVisible('saveAreaBtn', parcelLoaded && editing);
  setElementVisible('cancelEditAreaBtn', parcelLoaded && (editing || drawing));

  const previewBtn = byId('previewEstimateBtn');
  const estimateBtn = byId('getEstimateBtn');
  const drawContinueBtn = byId('drawContinueBtn');
  [previewBtn, estimateBtn, drawContinueBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !mowSelected;
    btn.classList.toggle('disabled', !mowSelected);
  });

  const requestBtn = byId('requestServiceBtn');
  if (requestBtn) requestBtn.classList.toggle('hidden', !hasEstimate);

  if (!options.skipStepper) updateQuoteStepper();
}

function showMissingMowableAreaPrompt(targetId = 'quoteResult') {
  showResult(
    targetId,
    '<strong>Draw your mowable area first.</strong><br>The parcel outline is only a property boundary and is not priced as mowing area.'
  );
  showWarning('Draw your mowable area first.');
}

async function aiDetectGrassDraft() {
  console.log('REAL AI grass detect fired');

  const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
  if (!parcelRings.length || !state.map || !state.drawGroup) {
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
      Detected Mow Area: ${formatAcres(detectedSqFt)}<br>
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
  state.quoteUiMode = 'drawing';

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
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
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
  state.quoteUiMode = 'editing';
  setEditorModeLabel('Mode: Drag vertices, or drag inside a green shape to move it');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
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
  state.quoteUiMode = 'deleting';
  setEditorModeLabel('Mode: Delete mowable areas');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
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

  state.map = L.map('quoteMap', { tap: true }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  setMapGestureCapture(false);
  if (state.map.attributionControl) {
    state.map.attributionControl.setPrefix(false);
  }
  installMowableMoveMapHandlers();
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
  state.drawGroup.on('layeradd', (event) => {
    if (event.layer?.setStyle || event.layer?.getLatLngs) {
      event.layer._turflynkMowable = true;
      attachMowableMoveHandlers(event.layer);
    }
  });
  exposeTurfLynkMapGlobals();

  state.aiCutoutGroup = new L.FeatureGroup();
  state.map.addLayer(state.aiCutoutGroup);

  state.buildingFootprintGroup = new L.FeatureGroup();
  state.map.addLayer(state.buildingFootprintGroup);
  reorderMapOverlays();

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
  state.drawGroup.clearLayers();
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
    setEditorModeLabel('Mode: Drag vertices, or drag inside a green shape to move it');
  });

  state.map.on(L.Draw.Event.DELETED, () => {
    syncMowAreaFromLayers();
    setEditorModeLabel('Mode: Delete mowable areas');
  });

  state.drawGroup.on('click', () => {
    startEditMowable();
  });

  state.map.on('click', (e) => {
    if (!state.parcelSelectMode) return;
    if (state.drawHandler?._enabled) return;
    applyParcelFromClick(e.latlng);
  });

  state.map.on('dblclick', (e) => {
    if (!state.parcelSelectMode) return;
    if (state.drawHandler?._enabled) return;
    L.DomEvent.stop(e);
    state.parcelDblClick = true;
    if (state.pendingParcelFeature) {
      state.parcelDblClick = false;
      confirmParcelSelection();
    }
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
window.showToast = showToast;
window.showSuccess = showSuccess;
window.showError = showError;
window.showWarning = showWarning;
window.showInfo = showInfo;

function setQuoteService(serviceType) {
  const select = byId('quoteServiceSelect');
  if (!serviceType || !select) return;
  const value = serviceType === 'recurring_lawn_care' ? 'mowing' : serviceType;
  if (Array.from(select.options).some((option) => option.value === value)) {
    select.value = value;
    saveQuoteDraft();
    updateEstimatePreview();
  }
}

function setServiceFlow(flow) {
  state.serviceFlow = flow || 'instant_mow';
  const instant = state.serviceFlow === 'instant_mow';
  byId('quoteForm')?.classList.toggle('hidden', !instant);
  byId('leadRequestPanel')?.classList.add('hidden');
  byId('liveBidPanel')?.classList.toggle('hidden', instant);
  if (byId('viewTitle')) byId('viewTitle').textContent = instant ? 'Instant Mow Quote' : 'Live Bid Request';
  if (byId('mobileViewTitle')) byId('mobileViewTitle').textContent = instant ? 'Instant Mow' : 'Live Bid';
  if (instant && state.map) setTimeout(() => state.map.invalidateSize(), 120);
}

function hydrateLiveBidForm(serviceId) {
  const service = selectedServiceMeta(serviceId);
  const form = byId('liveBidForm');
  if (!form) return;

  if (byId('liveBidServiceType')) byId('liveBidServiceType').value = service.id;
  const badge = byId('liveBidBadge');
  if (badge) badge.textContent = service.badge;
  const taskWrap = byId('liveBidTaskChecks');
  if (taskWrap) taskWrap.innerHTML = serviceTaskCheckboxes('requested_tasks', [service.id]);

  const quoteForm = byId('quoteForm');
  if (quoteForm) {
    const q = formToObject(quoteForm);
    ['address', 'city', 'state', 'zip'].forEach((name) => {
      if (form.elements[name] && q[name]) form.elements[name].value = q[name];
    });
    if (form.elements.customerName && q.name) form.elements.customerName.value = q.name;
    if (form.elements.customerPhone && q.phone) form.elements.customerPhone.value = q.phone;
    if (form.elements.customerEmail && q.email) form.elements.customerEmail.value = q.email;
  }
}

function selectServiceCard(serviceId) {
  const service = selectedServiceMeta(serviceId);
  setActiveView('quote');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (service.quoteType === 'instant_mow') {
    setServiceFlow('instant_mow');
    setQuoteService(service.id);
    const frequency = byId('quoteForm')?.elements?.service_frequency;
    if (frequency && service.id === 'recurring_lawn_care') frequency.value = 'biweekly';
    showInfo(`${service.title} uses the instant mowing estimate.`);
    return;
  }

  setServiceFlow('live_bid');
  hydrateLiveBidForm(service.id);
  showInfo(`${service.title} is handled as a live bid.`);
}

function closeAppDrawer() {
  byId('appDrawer')?.classList.add('hidden');
  byId('appDrawerOverlay')?.classList.add('hidden');
}

function openAppDrawer() {
  byId('appDrawer')?.classList.remove('hidden');
  byId('appDrawerOverlay')?.classList.remove('hidden');
}

function navigateFromElement(el) {
  const view = el?.dataset?.jumpView || el?.dataset?.drawerView || el?.dataset?.view;
  let requestedFlow = null;
  let requestedService = null;
  if (el?.dataset?.serviceType) {
    const meta = selectedServiceMeta(el.dataset.serviceType);
    if (meta.quoteType === 'instant_mow') {
      requestedFlow = 'instant_mow';
      requestedService = el.dataset.serviceType;
    } else {
      requestedFlow = 'live_bid';
      requestedService = meta.id;
    }
  }
  if (view) setActiveView(view);
  if (requestedFlow === 'instant_mow') {
    setServiceFlow('instant_mow');
    setQuoteService(requestedService);
  }
  if (requestedFlow === 'live_bid') {
    setServiceFlow('live_bid');
    hydrateLiveBidForm(requestedService);
  }
  if (el?.dataset?.scrollTarget) {
    setTimeout(() => byId(el.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
  if (el?.hasAttribute?.('data-drawer-contact') || el?.hasAttribute?.('data-mobile-contact')) {
    setActiveView('quote');
    setTimeout(() => byId('leadRequestPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    showInfo('Start with a quote, then send the service request.');
  }
  closeAppDrawer();
}

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
    btn.onclick = () => navigateFromElement(btn);
  });

  const title = byId('viewTitle');
  if (title) {
    const titles = {
      dashboard: 'Home',
      quote: 'Get a Quote',
      jobs: 'Jobs',
      providers: 'Providers',
      admin: 'Admin Dashboard',
    };
    title.textContent = titles[view] || 'MowNWA';
    if (byId('mobileViewTitle')) byId('mobileViewTitle').textContent = titles[view] || 'MowNWA';
  }

  if (view === 'quote' && state.map) {
    setTimeout(() => state.map.invalidateSize(), 100);
    showQuoteFlowStep(state.quoteFlowStep || 'start', { scroll: false });
    updateQuoteFlowState();
  }

  if (view === 'admin') {
    if (isAdmin()) loadAdminLeads().catch(() => {});
    // Populate service filter dropdown if empty
    const sf = byId('leadsServiceFilter');
    if (sf && sf.options.length <= 1) {
      state.services.forEach((svc) => {
        const opt = document.createElement('option');
        opt.value = svc.id;
        opt.textContent = svc.label || svc.name;
        sf.append(opt);
      });
    }
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

  if (view === 'providers') {
    populateProviderSetupChoices();
    loadProviderServiceAreas().catch(() => {});
  }
}

function initNavigation() {
  const buttons = $$('[data-view]');
  const sections = $$('[data-view-panel]');
  if (!buttons.length || !sections.length) return;

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateFromElement(btn);
    });
  });

  $$('[data-jump-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateFromElement(btn);
    });
  });

  const first = buttons.find((b) => b.classList.contains('active'))?.dataset.view || 'dashboard';
  setActiveView(first);
}

function renderCoverage() {
  const grid = byId('coverageGrid');
  if (!grid) return;

  grid.innerHTML = '';
  const localCities = window.TurfLynkLocalContent?.cities || [];
  const localAreas = window.TurfLynkLocalContent?.areas || [];

  if (localCities.length || localAreas.length) {
    localAreas.slice(0, 3).forEach((area) => {
      grid.append(card(`
        <h4>${escapeHtml(area.name || 'Arkansas service area')}</h4>
        <div class="meta">${escapeHtml(area.shortDescription || 'Request lawn care estimates in this area.')}</div>
        <div class="meta">Counties: ${escapeHtml((area.counties || []).join(', '))}</div>
        <div class="meta">Cities: ${escapeHtml((area.neighborhoodsOrNearbyAreas || []).slice(0, 6).join(', '))}</div>
        <button class="btn secondary small" type="button" data-local-path="/areas/${escapeHtml(area.slug)}">View area</button>
      `));
    });

    localCities.slice(0, 9).forEach((city) => {
      grid.append(card(`
        <h4>${escapeHtml(city.name)}, ${escapeHtml(city.state || 'AR')}</h4>
        <div class="meta">${escapeHtml(city.shortDescription || `${city.name} lawn care estimates.`)}</div>
        <div class="meta">Common needs: ${escapeHtml((city.commonServices || []).slice(0, 4).join(', '))}</div>
        <div class="meta">Nearby: ${escapeHtml((city.neighborhoodsOrNearbyAreas || []).slice(0, 5).join(', '))}</div>
        <button class="btn secondary small" type="button" data-local-path="/cities/${escapeHtml(city.slug)}">View ${escapeHtml(city.name)}</button>
      `));
    });
    bindLocalContentLinks(grid);
    return;
  }

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

function localContentData() {
  return window.TurfLynkLocalContent || { homepage: {}, cities: [], areas: [], services: [] };
}

function setMetaDescription(description) {
  const text = String(description || '').trim();
  if (!text) return;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);
  }
  meta.content = text;
}

function bindLocalContentLinks(root = document) {
  root.querySelectorAll('[data-local-path]').forEach((btn) => {
    if (btn.dataset.localBound) return;
    btn.dataset.localBound = '1';
    btn.addEventListener('click', () => {
      const path = btn.dataset.localPath;
      if (!path) return;
      history.pushState({}, '', path);
      renderLocalLandingFromPath();
      setActiveView('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function renderFaqItems(faqs = []) {
  return faqs.map((faq) => `
    <div class="card">
      <h4>${escapeHtml(faq.question || 'Question')}</h4>
      <p>${escapeHtml(faq.answer || 'Details may vary by location and service request.')}</p>
    </div>
  `).join('');
}

function renderHomepageContent() {
  const data = localContentData();
  const homepage = data.homepage || {};

  if (byId('homeHeroTitle')) byId('homeHeroTitle').textContent = 'Book trusted lawn and outdoor services near you.';
  if (byId('homeHeroSubtitle')) byId('homeHeroSubtitle').textContent = 'Get an instant mowing price or request a live bid for cleanup, trimming, landscaping, and more.';
  const tags = byId('homeServiceTags');
  if (tags) {
    tags.innerHTML = ['Mowing', 'Cleanup', 'Bush Trimming', 'Leaf Removal', 'Pressure Washing', 'Gutter Cleaning']
      .map((item) => `<span class="pill muted">${escapeHtml(item)}</span>`)
      .join('');
  }

  const servicesGrid = byId('popularServicesGrid');
  if (servicesGrid) {
    servicesGrid.innerHTML = '';
    const groups = [...new Set(SERVICE_CATALOG.map((service) => service.group || 'Services'))];
    groups.forEach((group) => {
      const heading = document.createElement('div');
      heading.className = 'service-group-title';
      heading.textContent = group;
      servicesGrid.append(heading);
      SERVICE_CATALOG.filter((service) => (service.group || 'Services') === group).forEach((service) => {
        servicesGrid.append(card(`
        <div class="service-card-head">
          <h4>${escapeHtml(service.title)}</h4>
          <span class="service-badge ${service.quoteType === 'instant_mow' ? 'instant' : 'bid'}">${escapeHtml(service.badge)}</span>
        </div>
        <p>${escapeHtml(service.description)}</p>
        <button class="btn ${service.quoteType === 'instant_mow' ? 'primary' : 'secondary'} small service-select-btn" type="button" data-service-card="${escapeHtml(service.id)}">Continue</button>
      `));
      });
    });
    servicesGrid.querySelectorAll('[data-service-card]').forEach((btn) => {
      btn.addEventListener('click', () => selectServiceCard(btn.dataset.serviceCard));
    });
  }

  const steps = byId('howItWorksGrid');
  if (steps) {
    steps.innerHTML = '';
    (homepage.howItWorks || []).forEach((step, index) => {
      steps.append(card(`
        <h4>${index + 1}. ${escapeHtml(step)}</h4>
        <p>${escapeHtml(index === 0 ? 'Start with the property address.' : index === 1 ? 'Use parcel lookup, lasso, and edit tools for the yard area.' : index === 2 ? 'Review the estimate before creating an account.' : 'Share contact details only when you are ready to continue.')}</p>
      `));
    });
  }

  const faqGrid = byId('homeFaqGrid');
  if (faqGrid) faqGrid.innerHTML = renderFaqItems(homepage.faqs || []);
}

function findLocalEntry(type, slug) {
  const data = localContentData();
  const list = type === 'services' ? data.services : type === 'areas' ? data.areas : data.cities;
  return (list || []).find((item) => item.slug === slug) || null;
}

function renderLocalLanding(entry, type) {
  const panel = byId('localLandingPanel');
  if (!panel) return;

  if (!entry) {
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="pill muted">Arkansas lawn care</div>
      <h2>Local lawn care estimates</h2>
      <p class="section-copy">That page is not available yet, but you can still start an estimate with your Arkansas address.</p>
      <button class="btn primary" type="button" data-jump-view="quote">Get a lawn care estimate</button>
    `;
    panel.querySelectorAll('[data-jump-view]').forEach((btn) => {
      btn.addEventListener('click', () => setActiveView(btn.dataset.jumpView));
    });
    return;
  }

  document.title = entry.seoTitle || entry.heroTitle || 'TurfLynk';
  setMetaDescription(entry.seoDescription || entry.shortDescription || '');

  const included = type === 'services'
    ? (entry.whatIsIncluded || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : (entry.commonServices || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const nearby = (entry.neighborhoodsOrNearbyAreas || entry.bestFor || []).map((item) => `<span class="pill muted">${escapeHtml(item)}</span>`).join('');
  const priceFactors = (entry.priceFactors || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="pill">${escapeHtml(type === 'services' ? 'Service guide' : entry.regionName || 'Arkansas service area')}</div>
    <h2>${escapeHtml(entry.heroTitle || entry.name || 'Local lawn care estimates')}</h2>
    <p class="section-copy">${escapeHtml(entry.heroSubtitle || entry.shortDescription || 'Start with an address and review an estimate before continuing.')}</p>
    <div class="local-landing-actions">
      <button class="btn primary" type="button" data-jump-view="quote">${escapeHtml(entry.ctaText || 'Get an estimate')}</button>
      <button class="btn secondary" type="button" data-local-path="/">Back to Northwest Arkansas</button>
    </div>
    <div class="section-grid two-up local-detail-grid">
      <div class="mini-card">
        <h3>${escapeHtml(type === 'services' ? 'What is included' : 'Common lawn care needs')}</h3>
        <ul>${included || '<li>Service details vary by property and provider availability.</li>'}</ul>
      </div>
      <div class="mini-card">
        <h3>${escapeHtml(type === 'services' ? 'Good fit for' : 'Nearby areas')}</h3>
        <div class="local-pill-row">${nearby || '<span class="pill muted">Nearby Arkansas areas</span>'}</div>
        <p>${escapeHtml(entry.localNotes || entry.estimateNotes || 'Availability, coverage, and pricing may vary by location and job details.')}</p>
      </div>
    </div>
    ${type === 'services' ? `
      <div class="section-grid two-up local-detail-grid">
        <div class="mini-card">
          <h3>When customers need it</h3>
          <p>${escapeHtml(entry.whenNeeded || 'This service can help when regular yard care, cleanup, or a one-time request fits the property.')}</p>
        </div>
        <div class="mini-card">
          <h3>What affects price</h3>
          <ul>${priceFactors || '<li>Property size, access, selected services, and local availability.</li>'}</ul>
        </div>
      </div>
    ` : ''}
    <h3>FAQ</h3>
    <div class="card-grid">${renderFaqItems(entry.faqs || [])}</div>
  `;

  bindLocalContentLinks(panel);
  panel.querySelectorAll('[data-jump-view]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveView(btn.dataset.jumpView));
  });
}

function renderLocalLandingFromPath() {
  const panel = byId('localLandingPanel');
  if (!panel) return;

  const path = window.location.pathname.replace(/\/+$/, '');
  const match = path.match(/^\/(cities|areas|services)\/([a-z0-9-]+)$/);

  if (!match) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    renderHomepageContent();
    const homepage = localContentData().homepage || {};
    document.title = homepage.seoTitle || 'TurfLynk Arkansas';
    setMetaDescription(homepage.seoDescription || homepage.heroSubtitle || '');
    return;
  }

  const [, type, slug] = match;
  renderLocalLanding(findLocalEntry(type, slug), type);
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
  populateProviderSetupChoices();

  const draft = loadQuoteDraft();
  if (draft && byId('quoteForm')) {
    fillForm(byId('quoteForm'), draft);
    clearStaleMowAreaWithoutPolygon(byId('quoteForm'));
  }

  renderHomepageContent();
  renderCoverage();
  renderLocalLandingFromPath();
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

byId('mobileAuthBtn')?.addEventListener('click', () => toggleAuthPanel(true));
byId('openAppDrawer')?.addEventListener('click', openAppDrawer);
byId('mobileMoreBtn')?.addEventListener('click', openAppDrawer);
byId('closeAppDrawer')?.addEventListener('click', closeAppDrawer);
byId('appDrawerOverlay')?.addEventListener('click', closeAppDrawer);
document.querySelectorAll('[data-drawer-view], [data-drawer-contact], [data-mobile-contact]').forEach((btn) => {
  btn.addEventListener('click', () => navigateFromElement(btn));
});

$$('[data-open-auth]').forEach((btn) => {
  btn.addEventListener('click', () => {
    closeAppDrawer();
    toggleAuthPanel(true);
  });
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
    showSuccess('Signed in');
    const adminTasks = json.user?.role === 'admin' ? [loadAdmin().catch(() => {}), loadAdminLeads().catch(() => {})] : [];
    await Promise.allSettled([loadProviders(), loadJobs(), loadMyJobs(), ...adminTasks]);
  } else {
    showError(json.error);
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
    showSuccess('Account created. Now log in.');
    showAuthTab('login');
  } else {
    showError(json.error);
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

function populateProviderSetupChoices() {
  const fillMulti = (select) => {
    if (!select || select.options.length) return;
    SERVICE_AREA_OPTIONS.forEach((city) => {
      const option = document.createElement('option');
      option.value = city;
      option.textContent = city;
      select.append(option);
    });
  };
  fillMulti(byId('providerServiceAreaCities'));
  fillMulti(byId('providerAreaCitySelect'));

  const servicesWrap = byId('providerServicesOffered');
  if (servicesWrap && !servicesWrap.innerHTML.trim()) {
    servicesWrap.innerHTML = SERVICE_CATALOG.map((service) => `
      <label><input type="checkbox" name="servicesOffered" value="${escapeHtml(service.id)}" ${service.id === 'mowing' ? 'checked' : ''} /> ${escapeHtml(service.title)}</label>
    `).join('');
  }
}

async function loadProviderServiceAreas() {
  const summary = byId('providerServiceAreaSummary');
  if (!summary) return;

  if (!getAuthToken()) {
    summary.innerHTML = '<div style="color:var(--muted);padding:12px">Sign in as a provider to manage service areas.</div>';
    return;
  }

  try {
    const data = await api('/api/provider/service-areas');
    const cities = data.cities || [];
    const preferences = data.preferences || {};
    summary.innerHTML = '';
    summary.append(card(`
      <h4>Selected Cities</h4>
      <div class="meta">${cities.length ? cities.map((city) => `${city.city}${city.radius_miles ? ` + ${city.radius_miles} mi` : ''}${city.enabled === false ? ' (disabled)' : ''}`).join(', ') : 'No selected cities yet.'}</div>
      <div class="meta">Nearby jobs: ${preferences.accepts_nearby_jobs ? 'yes' : 'no'} · Areas paused: ${preferences.service_areas_paused ? 'yes' : 'no'}</div>
    `));
  } catch (error) {
    summary.innerHTML = `<div style="color:var(--muted);padding:12px">Could not load service areas: ${escapeHtml(prettyApiError(error))}</div>`;
  }
}

async function updateEstimatePreview() {
  const form = byId('quoteForm');
  const preview = byId('quotePreview');
  const mirror = byId('quotePreviewMirror');
  if (!form || !preview) return;

  const payload = buildQuotePayload(form);
  if (Number(payload.mowAreaSqft || 0) <= 0) {
    preview.textContent = 'Draw area';
    if (mirror) mirror.textContent = 'Draw area';
    updateQuoteFlowState();
    return;
  }

  try {
    const data = await api('/api/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const formatted = money(data.estimate);
    preview.textContent = formatted;
    if (mirror) mirror.textContent = formatted;
  } catch {
    preview.textContent = 'Unavailable';
    if (mirror) mirror.textContent = 'Unavailable';
    showError('Could not update quote preview.');
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
    updateQuoteFlowState();
    showWarning('Parcel lookup failed. You can still draw the area manually.');
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
  if (quoteForm.elements.customerAdjustedMowableSqft) quoteForm.elements.customerAdjustedMowableSqft.value = '';

  if (geometry) {
    drawParcel(geometry);
    const parcelAreaSqft = Number(normalized.areaSqft || 0)
      || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : 0);
    quoteForm.elements.lotAreaSqft.value = parcelAreaSqft || '';
    renderSuggestedMowablePanel(null);
    updateEstimatePreview();
    showSuccess('Property boundary loaded');
  }

  updateMowAreaHelper(
    Number(quoteForm.elements.lotAreaSqft.value || 0),
    Number(quoteForm.elements.mowAreaSqft.value || 0)
  );

  const lotSqft = Number(quoteForm.elements.lotAreaSqft.value || 0);
  const mowSqft = Number(quoteForm.elements.mowAreaSqft.value || 0);
  const customerLines = [
    '<strong>Parcel found. Boundary loaded.</strong>',
    addressLabel && addressLabel !== 'n/a' ? `Address: ${escapeHtml(addressLabel)}` : null,
    lotSqft > 0 ? `<span class="parcel-customer-acres">Lot Area: ${formatAcres(lotSqft)}</span>` : null,
    mowSqft > 0 ? `<span class="parcel-customer-acres">Mowable Area: ${formatAcres(mowSqft)}</span>` : null,
    'Use <strong>Lasso Yard</strong> to draw the mowable area.',
  ].filter(Boolean);
  const techLines = [
    `Match: ${escapeHtml(data.method || 'n/a')}`,
    `County: ${escapeHtml(county)}`,
    `Parcel ID: ${escapeHtml(parcelId || 'n/a')}`,
  ].join('<br>');

  parcelInfo.innerHTML = customerLines.join('<br>')
    + `<details class="parcel-tech-details"><summary>Advanced parcel details</summary>${techLines}</details>`;
  parcelInfo.classList.remove('hidden');

  saveQuoteDraft();
  await updateEstimatePreview();
  updateQuoteFlowState();
  showQuoteFlowStep('parcel');
}

/* ─────────────────────────────────────────────────────────────────────────
   PARCEL SELECT MODE  (tap/click map to pick a different parcel)
───────────────────────────────────────────────────────────────────────── */

function enterParcelSelectMode() {
  state.parcelSelectMode = true;
  if (state.drawHandler?._enabled) state.drawHandler.disable();
  if (state.editHandler?._enabled) state.editHandler.disable();
  setEditorModeLabel('Mode: Tap a parcel on the map to select it');
  byId('selectParcelBtn')?.classList.add('active');
  byId('useThisParcelBar')?.classList.add('hidden');
  showInfo('Tap any parcel on the map. Press "Use This Parcel" to confirm, or Cancel to exit.');
}

function exitParcelSelectMode() {
  state.parcelSelectMode = false;
  state.parcelDblClick = false;
  if (state.pendingParcelPreviewLayer && state.map) {
    try { state.map.removeLayer(state.pendingParcelPreviewLayer); } catch {}
  }
  state.pendingParcelPreviewLayer = null;
  state.pendingParcelFeature = null;
  setEditorModeLabel('Mode: Ready');
  byId('selectParcelBtn')?.classList.remove('active');
  byId('useThisParcelBar')?.classList.add('hidden');
}

async function applyParcelFromClick(latlng) {
  if (!state.parcelSelectMode) return;
  const { lat, lng } = latlng;
  showInfo('Looking up parcel…');
  let data;
  try {
    const qs = new URLSearchParams({ lat, lng });
    data = await api(`/api/parcel/lookup?${qs.toString()}`);
  } catch (err) {
    showError('Parcel lookup failed: ' + err.message);
    return;
  }
  if (!data.ok || !data.feature?.geometry) {
    showWarning('No parcel found here. Try tapping closer to a property boundary.');
    return;
  }
  const geometry = data.feature.geometry;
  if (state.pendingParcelPreviewLayer && state.map) {
    try { state.map.removeLayer(state.pendingParcelPreviewLayer); } catch {}
  }
  const rings = (geometry.rings || geometry.coordinates || [])
    .map((ring) => ringToLeafletLatLngs(ring, geometry))
    .filter((ring) => ring.length >= 3);
  if (rings.length && state.map) {
    state.pendingParcelPreviewLayer = L.polygon(rings, {
      color: '#f59e0b',
      weight: 3,
      fillColor: '#f59e0b',
      fillOpacity: 0.15,
      interactive: false,
    }).addTo(state.map);
  }
  state.pendingParcelFeature = data;
  if (state.parcelDblClick) {
    state.parcelDblClick = false;
    confirmParcelSelection();
    return;
  }
  const bar = byId('useThisParcelBar');
  const addrEl = byId('useThisParcelAddr');
  if (bar && addrEl) {
    const attrs = data.normalized?.attributes || {};
    addrEl.textContent = attrs.adrlabel
      || [data.normalized?.address, data.normalized?.city].filter(Boolean).join(', ')
      || 'Parcel found';
    bar.classList.remove('hidden');
  }
}

function confirmParcelSelection() {
  if (!state.pendingParcelFeature) return;
  const data = state.pendingParcelFeature;
  const geometry = data.feature?.geometry;
  const normalized = data.normalized || {};
  const attrs = normalized.attributes || {};
  if (state.drawGroup) state.drawGroup.clearLayers();
  state.mowUndoStack = [];
  if (geometry) drawParcel(geometry);
  const quoteForm = byId('quoteForm');
  if (quoteForm) {
    quoteForm.elements.parcelId.value = normalized.parcelId || attrs.parcelid || '';
    const sqft = Number(normalized.areaSqft || 0)
      || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : 0);
    quoteForm.elements.lotAreaSqft.value = sqft || '';
    quoteForm.elements.mowAreaSqft.value = '';
    if (quoteForm.elements.customerAdjustedMowableSqft)
      quoteForm.elements.customerAdjustedMowableSqft.value = '';
  }
  renderSuggestedMowablePanel(null);
  updateEstimatePreview();
  syncMowAreaFromLayers();
  saveQuoteDraft();
  updateQuoteFlowState();
  showSuccess('Parcel selected. Draw or lasso the mowable area.');
  const parcelInfo = byId('parcelInfo');
  if (parcelInfo) {
    const selQf = byId('quoteForm');
    const selAddrLabel = attrs.adrlabel || '';
    const selLotSqft = selQf ? Number(selQf.elements.lotAreaSqft.value || 0) : 0;
    const selCustomerLines = [
      '<strong>Parcel selected. Boundary loaded.</strong>',
      selAddrLabel ? `Address: ${escapeHtml(selAddrLabel)}` : null,
      selLotSqft > 0 ? `<span class="parcel-customer-acres">Lot Area: ${formatAcres(selLotSqft)}</span>` : null,
      'Use <strong>Lasso Yard</strong> to draw the mowable area.',
    ].filter(Boolean);
    const selTechLines = [
      `County: ${escapeHtml(normalized.county || attrs.countyid || 'n/a')}`,
      `Parcel ID: ${escapeHtml(normalized.parcelId || attrs.parcelid || 'n/a')}`,
    ].join('<br>');
    parcelInfo.innerHTML = selCustomerLines.join('<br>')
      + `<details class="parcel-tech-details"><summary>Advanced parcel details</summary>${selTechLines}</details>`;
    parcelInfo.classList.remove('hidden');
  }
  exitParcelSelectMode();
  showQuoteFlowStep('parcel');
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
      <div class="meta">Services: ${escapeHtml((provider.servicesOffered || provider.services || []).map((id) => selectedServiceMeta(id).title || serviceLabel(id)).join(', '))}</div>
      <p>${escapeHtml(provider.bio || 'No bio yet.')}</p>
      <div class="meta">Equipment: ${escapeHtml(provider.equipment || 'n/a')}</div>
      <div class="meta">Main deck: ${provider.mowerDeckSizeInches || 'n/a'} in · Small-gate mower: ${provider.hasSmallGateMower ? 'yes' : 'no'}</div>
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

function quoteContactMissing(payload) {
  const missing = [];
  if (!String(payload.name || '').trim()) missing.push('name');
  if (!String(payload.email || '').trim()) missing.push('email');
  if (!String(payload.phone || '').trim()) missing.push('phone');
  return missing;
}

function showQuoteContactRequest(missing) {
  const details = document.querySelector('#quoteForm .contact-details');
  if (details) details.open = true;

  const first = missing[0];
  const field = first ? document.querySelector(`#quoteForm [name="${first}"]`) : null;
  if (field?.focus) field.focus();

  showResult(
    'quoteResult',
    `<strong>Almost there.</strong><br>Add your ${escapeHtml(missing.join(', '))}, then accept the quote.<br><br>
     <button class="btn primary" type="button" id="acceptQuoteBtn">Pay &amp; Book Mow</button>`
  );

  byId('acceptQuoteBtn')?.addEventListener('click', acceptPendingQuote);
}

function renderFilePreview(input, preview) {
  if (!input || !preview) return;
  preview.innerHTML = '';
  Array.from(input.files || []).forEach((file) => {
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

function updateExtraBidFields() {
  const wantsExtra = document.querySelector('input[name="extraWorkChoice"]:checked')?.value === 'yes';
  byId('extraBidFields')?.classList.toggle('hidden', !wantsExtra);
  if (!wantsExtra) state.pendingExtraBid = null;
  updateExtraBidReview();
}

function updateExtraBidReview() {
  const wantsExtra = document.querySelector('input[name="extraWorkChoice"]:checked')?.value === 'yes';
  const review = byId('extraBidReview');
  if (!wantsExtra) {
    if (review) review.textContent = 'Extra services: none selected.';
    state.pendingExtraBid = null;
    return;
  }

  const tasks = checkedValues('extra_requested_tasks');
  const photoCount = byId('extraBidPhotos')?.files?.length || 0;
  const notes = byId('extraBidNotes')?.value || '';
  const preferredTiming = byId('extraBidTiming')?.value || 'flexible';
  state.pendingExtraBid = { tasks, photoCount, notes, preferredTiming };
  if (review) {
    review.textContent = `Extra services: live bid requested for ${tasks.length || 0} task(s), ${photoCount} photo(s). Quoted separately.`;
  }
}

async function uploadPhotoInput(input) {
  if (!input?.files?.length) return [];
  const fd = new FormData();
  Array.from(input.files).forEach((file) => fd.append('photos', file));
  const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
  const uploadText = await uploadRes.text();
  let uploadData;
  try {
    uploadData = JSON.parse(uploadText);
  } catch {
    throw new Error(`Upload did not return JSON: ${uploadText.slice(0, 120)}`);
  }
  if (!uploadRes.ok || !uploadData.ok) throw new Error(uploadData?.error || 'Upload failed');
  return (uploadData.files || []).map((file) => file.url);
}

async function submitBidRequest(payload, resultId = 'liveBidResult') {
  const res = await fetch('/api/bid-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Bid request failed');
  if (resultId) {
    showResult(
      resultId,
      `<strong>Bid request submitted.</strong><br>Request ID: ${escapeHtml(data.bidRequest?.id || '')}<br><span class="meta">No payment is due until a provider bid is accepted.</span>`
    );
  }
  return data.bidRequest;
}

function renderEstimateResult(payload) {
  const area = Number(payload.mowAreaSqft || 0);
  if (area <= 0) {
    showMissingMowableAreaPrompt('quoteResult');
    return;
  }

  showResult(
    'quoteResult',
    `<div class="estimate-card">
      <div class="estimate-head">
        <div>
          <span class="pill">Instant mow estimate</span>
          <h3>${money(payload.estimate)}</h3>
          <p>${formatAcres(area)} mowable area. Standard mowing only.</p>
        </div>
        <div class="preview-pill"><span>Mowable area</span><strong>${formatSqft(area)}</strong></div>
      </div>
      <div class="scope-grid">
        <div>
          <h4>Includes</h4>
          <ul>${INCLUDED_MOW_TASKS.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
        <div>
          <h4>Not included</h4>
          <ul>${EXCLUDED_MOW_TASKS.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="final-review">
        <h4>Access review</h4>
        <div class="meta">Price shown: ${money(payload.estimate)}.</div>
        <div class="meta">${escapeHtml(buildAccessSummary(payload) || 'Gate/access: no special access entered.')}</div>
        <div class="meta">${escapeHtml(equipmentRecommendation(payload) || '')}</div>
      </div>
    </div>`
  );
}

function showLeadRequestPanel(payload) {
  const panel = byId('leadRequestPanel');
  if (!panel) return;

  const estimate = payload.estimate || 0;
  const quoteForm = byId('quoteForm');
  const quoteFields = quoteForm ? formToObject(quoteForm) : {};

  // Populate hidden fields from the estimate payload
  const set = (id, val) => { const el = byId(id); if (el) el.value = val || ''; };
  set('leadEstimatedPrice', estimate);
  set('leadMowAreaSqft', payload.mowAreaSqft || 0);
  set('leadLotAreaSqft', payload.lotAreaSqft || 0);
  set('leadAddress', payload.address || '');
  set('leadCity', payload.city || '');
  set('leadState', payload.state || 'AR');
  set('leadZip', payload.zip || '');
  set('leadRegionId', payload.regionId || '');
  set('leadServiceType', payload.serviceType || 'mowing');
  set('leadParcelAreaSqft', payload.parcelAreaSqft || quoteFields.parcelAreaSqft || '');
  set('leadBuildingFootprintSqft', payload.buildingFootprintSqft || quoteFields.buildingFootprintSqft || '');
  set('leadBuildingAdjustedSqft', payload.buildingAdjustedSqft || quoteFields.buildingAdjustedSqft || '');
  set('leadEstimatedNonMowableSqft', payload.estimatedNonMowableSqft || quoteFields.estimatedNonMowableSqft || '');
  set('leadAutoEstimatedMowableSqft', payload.autoEstimatedMowableSqft || quoteFields.autoEstimatedMowableSqft || '');
  set('leadMowableEstimateConfidence', payload.mowableEstimateConfidence || quoteFields.mowableEstimateConfidence || '');
  set('leadBuildingFootprintsSource', payload.buildingFootprintsSource || quoteFields.buildingFootprintsSource || '');
  set('leadCustomerAdjustedMowableSqft', payload.customerAdjustedMowableSqft || quoteFields.customerAdjustedMowableSqft || '');

  const display = byId('leadEstimateDisplay');
  if (display) display.textContent = estimate > 0 ? money(estimate) : '—';
  const submitBtn = byId('leadSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Service Request';
  }

  panel.classList.remove('hidden');
  showQuoteFlowStep('request');
  updateQuoteStepper();
}

async function generateGuestEstimate(form) {
  const payload = buildQuotePayload(form);
  if (Number(payload.mowAreaSqft || 0) <= 0) {
    state.pendingQuote = null;
    showMissingMowableAreaPrompt('quoteResult');
    await updateEstimatePreview();
    return;
  }

  const data = await api('/api/estimate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  state.pendingQuote = { ...payload, estimate: data.estimate };
  state.lastQuote = null;
  renderEstimateResult(state.pendingQuote);
  showQuoteFlowStep('estimate');
  saveQuoteDraft();
  await updateEstimatePreview();
  updateQuoteFlowState();
  showSuccess('Quote updated');
}

async function acceptPendingQuote() {
  const form = byId('quoteForm');
  if (!form) return;

  const payload = {
    ...(state.pendingQuote || {}),
    ...buildQuotePayload(form),
  };

  try {
    if (Number(payload.mowAreaSqft || 0) <= 0) {
      showMissingMowableAreaPrompt('quoteResult');
      return;
    }
    const scopeAcknowledged = Boolean(payload.standardMowScopeAck || byId('standardMowScopeAck')?.checked);
    if (!scopeAcknowledged) {
      showWarning('Please confirm the standard mowing scope before booking.');
      byId('standardMowScopeAck')?.focus();
      return;
    }
    payload.standardMowScopeAck = true;
    payload.scope_locked = true;

    const estimateData = await api('/api/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    payload.estimate = estimateData.estimate;
    state.pendingQuote = payload;

    const missing = quoteContactMissing(payload);
    if (missing.length) {
      showQuoteContactRequest(missing);
      return;
    }

    const btn = byId('acceptQuoteBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Accepting...';
    }

    const data = await api('/api/quotes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    // Merge API response with form data so bookQuoteAsJob has everything it needs
    state.lastQuote = { ...payload, ...data.quote };
    state.pendingQuote = null;

    showResult(
      'quoteResult',
      `<strong>Quote accepted.</strong><br>
       Estimated starting price: <strong>${money(data.quote.estimate)}</strong><br>
       Quote ID: ${escapeHtml(data.quote.id)}<br>
       Region: ${escapeHtml(regionLabel(data.quote.regionId || data.quote.region_id))}<br>
       Service: ${escapeHtml(serviceLabel(data.quote.serviceType || data.quote.service_type))}<br><br>
       <button class="btn primary" type="button" id="bookJobBtn" style="margin-top:4px">
         Pay &amp; Book Mow
       </button>`
    );

    byId('bookJobBtn')?.addEventListener('click', bookQuoteAsJob);

    saveQuoteDraft();
    await updateEstimatePreview();
    if (isAdmin()) await loadAdmin().catch(() => {});

    if (!getAuthToken()) {
      openAuthGate(bookQuoteAsJob);
    }
  } catch (error) {
    showResult('quoteResult', `<strong>Could not accept quote:</strong> ${escapeHtml(prettyApiError(error))}`);
    const btn = byId('acceptQuoteBtn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Accept Quote';
    }
  }
}

byId('quoteForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await generateGuestEstimate(event.target);
  } catch (error) {
    showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
    showError(prettyApiError(error));
  }
});

byId('previewEstimateBtn')?.addEventListener('click', async () => {
  const form = byId('quoteForm');
  if (!form) return;
  try {
    await generateGuestEstimate(form);
  } catch (error) {
    showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
    showError(prettyApiError(error));
  }
});
byId('cutMowableBtn')?.addEventListener('click', startCutMowable);
byId('undoCutBtn')?.addEventListener('click', undoLastCut);
byId('mapToolsToggle')?.addEventListener('click', () => {
  const panel = byId('mapToolsPanel');
  setMapToolPanelOpen(panel?.classList.contains('hidden'));
});
byId('closeMapTools')?.addEventListener('click', () => setMapToolPanelOpen(false));
byId('continueToDrawBtn')?.addEventListener('click', () => {
  if (!state.parcelLayer) {
    showWarning('Lookup the parcel before drawing.');
    return;
  }
  showQuoteFlowStep('draw');
});
byId('drawContinueBtn')?.addEventListener('click', async () => {
  const form = byId('quoteForm');
  if (!form) return;
  if (!hasActiveMowableArea()) {
    showMissingMowableAreaPrompt('parcelInfo');
    return;
  }
  try {
    await generateGuestEstimate(form);
  } catch (error) {
    showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
    showError(prettyApiError(error));
  }
});
byId('requestServiceBtn')?.addEventListener('click', async () => {
  const form = byId('quoteForm');
  if (!form) return;
  try {
    if (!hasActiveMowableArea()) {
      showMissingMowableAreaPrompt('quoteResult');
      return;
    }
    if (!state.pendingQuote?.estimate || Number(state.pendingQuote.mowAreaSqft || 0) !== currentDrawnMowAreaSqFt()) {
      await generateGuestEstimate(form);
    }
    showLeadRequestPanel(state.pendingQuote || buildQuotePayload(form));
  } catch (error) {
    showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
    showError(prettyApiError(error));
  }
});
$$('[data-quote-back]').forEach((btn) => {
  btn.addEventListener('click', () => showQuoteFlowStep(btn.dataset.quoteBack || 'start'));
});
byId('saveAreaBtn')?.addEventListener('click', () => {
  stopToolModes();
  syncMowAreaFromLayers();
  setMapToolPanelOpen(true);
  showSuccess('Area saved');
});
byId('cancelEditAreaBtn')?.addEventListener('click', () => {
  stopToolModes();
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
  showInfo('Area editing closed');
});
byId('locateAddressBtn')?.addEventListener('click', async () => {
  try {
    await geocodeAddress();
    await lookupParcel();
  } catch (error) {
    showError(prettyApiError(error));
  }
});

byId('lookupParcelBtn')?.addEventListener('click', () => {
  lookupParcel().catch((error) => showError(prettyApiError(error)));
});
byId('aiDetectGrassBtn')?.addEventListener('click', aiDetectGrassDraft);
byId('useParcelShapeBtn')?.addEventListener('click', cloneParcelAsMowable);
byId('lassoYardBtn')?.addEventListener('click', () => {
  state.quoteUiMode = 'drawing';
  updateQuoteFlowState();
});
byId('drawMowableBtn')?.addEventListener('click', () => {
  if (state.drawGroup?.getLayers?.().length) clearMowLayer();
  startDrawMowable();
});
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
  byId('quoteResult')?.classList.add('hidden');
  byId('leadRequestPanel')?.classList.add('hidden');
  renderSuggestedMowablePanel(null);
  updateEstimatePreview();
  showQuoteFlowStep('start');
});

byId('quoteForm')?.addEventListener('input', () => {
  saveQuoteDraft();
  updateEstimatePreview();
  updateQuoteFlowState();
});

byId('quoteForm')?.addEventListener('change', () => {
  saveQuoteDraft();
  updateEstimatePreview();
  updateMowAreaHelper(
    Number(byId('quoteForm')?.elements?.lotAreaSqft?.value || 0),
    Number(byId('quoteForm')?.elements?.mowAreaSqft?.value || 0)
  );
  updateQuoteFlowState();
});

byId('providerForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(event.target);
    payload.regions = multiSelectValues(byId('providerRegions'));
    payload.cities = String(payload.cities || '').split(',').map((v) => v.trim()).filter(Boolean);
    payload.serviceAreaCities = multiSelectValues(byId('providerServiceAreaCities'));
    payload.services = checkedValues('servicesOffered', event.target);
    payload.servicesOffered = payload.services;
    payload.mower_deck_size_inches = Number(payload.mowerDeckSizeInches || 0) || null;
    payload.has_small_gate_mower = payload.hasSmallGateMower === 'true';
    payload.accepts_nearby_jobs = payload.acceptsNearbyJobs === 'true';
    payload.max_extra_travel_miles = Number(payload.maxExtraTravelMiles || 0) || null;
    payload.radius_miles = payload.radiusMiles === 'custom'
      ? Number(payload.customRadiusMiles || 0) || null
      : Number(payload.radiusMiles || 0) || null;

    const data = await api('/api/providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    showResult(
      'providerResult',
      `<strong>Provider added.</strong><br />${escapeHtml(data.provider.businessName)} is now listed.`
    );

    event.target.reset();
    populateProviderSetupChoices();
    await loadProviders();
    await loadProviderServiceAreas().catch(() => {});
    if (isAdmin()) await loadAdmin().catch(() => {});
  } catch (error) {
    showResult('providerResult', `<strong>Failed:</strong> ${escapeHtml(error.message)}`);
  }
});

byId('providerServiceAreaForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(event.target);
    payload.cities = multiSelectValues(byId('providerAreaCitySelect'));
    payload.radius_miles = Number(payload.radiusMiles || 0) || null;
    payload.accepts_nearby_jobs = payload.acceptsNearbyJobs === 'true';
    payload.service_areas_paused = payload.serviceAreasPaused === 'true';
    payload.zone_geojson = payload.zoneGeojson || '';

    await api('/api/provider/service-areas/preferences', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    showResult('providerServiceAreaResult', '<strong>Service areas saved.</strong>');
    await loadProviderServiceAreas();
  } catch (error) {
    showResult('providerServiceAreaResult', `<strong>Could not save:</strong> ${escapeHtml(prettyApiError(error))}`);
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

      if (!getAuthToken()) {
        openAuthGate(() => form.requestSubmit());
        return;
      }

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
    if (isAdmin()) await loadAdmin().catch(() => {});
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
    const adminItems = data.user?.role === 'admin' ? [loadAdmin().catch(() => {})] : [];
    try { await Promise.allSettled([loadJobs(), loadProviders(), ...adminItems]); } catch {}
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

byId('quoteForm')?.elements?.lotAreaSqft?.addEventListener('input', () => {
  const form = byId('quoteForm');
  refreshAreaDisplays(form.elements.lotAreaSqft.value, form.elements.mowAreaSqft.value);
});
byId('quoteForm')?.elements?.mowAreaSqft?.addEventListener('input', () => {
  const form = byId('quoteForm');
  refreshAreaDisplays(form.elements.lotAreaSqft.value, form.elements.mowAreaSqft.value);
});
byId('refreshJobs')?.addEventListener('click', loadJobs);
byId('refreshRegions')?.addEventListener('click', loadConfig);
byId('refreshServices')?.addEventListener('click', loadConfig);
byId('refreshAdmin')?.addEventListener('click', loadAdmin);
byId('editAiCutoutsBtn')?.addEventListener('click', startEditAiCutouts);

/* ─────────────────────────────────────────────────────────────────────────
   LEAD REQUEST FORM — public service request submission
───────────────────────────────────────────────────────────────────────── */

byId('closeleadRequestPanel')?.addEventListener('click', () => {
  byId('leadRequestPanel')?.classList.add('hidden');
  showQuoteFlowStep('estimate');
  updateQuoteStepper();
});

byId('leadRequestForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = byId('leadSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const form = e.target;
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    const requestAvailableDays = checkedValues('available_days_json', form);

    // Merge in the quote form address/service data from hidden fields
    const quoteForm = byId('quoteForm');
    if (quoteForm) {
      const qd = buildQuotePayload(quoteForm);
      if (Number(qd.mowAreaSqft || 0) <= 0) {
        showMissingMowableAreaPrompt('quoteResult');
        if (btn) { btn.disabled = false; btn.textContent = 'Submit Service Request'; }
        return;
      }
      payload.address = payload.address || qd.address || '';
      payload.city = payload.city || qd.city || '';
      payload.state = payload.state || qd.state || 'AR';
      payload.zip = payload.zip || qd.zip || '';
      payload.regionId = payload.regionId || qd.regionId || '';
      payload.serviceType = payload.serviceType || qd.serviceType || 'mowing';
      payload.mowAreaSqft = qd.mowAreaSqft;
      payload.lotAreaSqft = payload.lotAreaSqft || qd.lotAreaSqft || 0;
      payload.quote_type = qd.quote_type || 'instant_mow';
      payload.quoteType = payload.quote_type;
      payload.service_frequency = qd.service_frequency || '';
      payload.grass_height_range = qd.grass_height_range || '';
      payload.selected_yard_areas = checkedValues('selected_yard_areas', quoteForm);
      payload.gate_size_category = qd.gate_size_category || '';
      payload.gate_access_type = qd.gate_size_category || qd.gate_access_type || '';
      payload.gate_width_inches = qd.gate_width_inches || '';
      payload.mower_access = qd.mower_access || '';
      payload.yard_access_notes = qd.yard_access_notes || qd.access_notes || '';
      payload.community_access_type = qd.community_access_type || 'no';
      payload.community_access_instructions = qd.community_access_instructions || '';
      payload.available_days_json = requestAvailableDays.length
        ? requestAvailableDays
        : checkedValues('available_days_json', quoteForm);
      payload.time_preference = payload.schedule_preference || qd.time_preference || '';
      payload.schedule_flexibility = payload.schedule_preference || qd.schedule_flexibility || '';
      payload.available_date_start = qd.available_date_start || '';
      payload.available_date_end = qd.available_date_end || '';
      payload.specific_service_date = qd.specific_service_date || '';
      payload.pets = qd.pets || '';
      payload.pet_waste_level = qd.pet_waste_level || '';
      payload.obstacles_list = checkedValues('obstacles_list', quoteForm);
      payload.requested_tasks = checkedValues('requested_tasks', quoteForm);
      payload.included_tasks_json = INCLUDED_MOW_TASKS;
      payload.excluded_tasks_json = EXCLUDED_MOW_TASKS;
      payload.scope_locked = Boolean(qd.standardMowScopeAck);
      MOWABLE_ESTIMATE_FIELDS.forEach((name) => {
        payload[name] = payload[name] || qd[name] || '';
      });
    }

    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!data.ok) throw new Error(data.error || 'Submission failed');

    const result = byId('leadRequestResult');
    if (result) {
      result.innerHTML = `
        <strong>Request submitted!</strong><br>
        We'll follow up to confirm availability and schedule your service.<br>
        <span style="color:var(--muted);font-size:.9rem">Request ID: ${escapeHtml(data.lead?.id || '')}</span><br><br>
        ${getAuthToken() ? '' : '<button class="btn primary small" type="button" id="postRequestAuthBtn">Create Account / Sign In</button> '}
        <button class="btn secondary small" type="button" id="startAnotherQuoteBtn">Start Another Quote</button>
      `;
      result.classList.remove('hidden');
    }
    showSuccess('Service request submitted');
    byId('postRequestAuthBtn')?.addEventListener('click', () => openAuthGate(() => closeAuthGate()));

    form.reset();
    if (btn) { btn.disabled = true; btn.textContent = 'Request Submitted'; }
    byId('startAnotherQuoteBtn')?.addEventListener('click', () => {
      byId('leadRequestPanel')?.classList.add('hidden');
      byId('quoteForm')?.reset();
      clearMowLayer();
      clearParcelLayer();
      clearQuoteDraft();
      updateQuoteFlowState();
      showInfo('Ready for another quote');
    });

  } catch (err) {
    const result = byId('leadRequestResult');
    if (result) {
      result.innerHTML = `<strong>Could not submit:</strong> ${escapeHtml(err.message)}`;
      result.classList.remove('hidden');
    }
    showError(err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Service Request'; }
  }
});

byId('liveBidPhotos')?.addEventListener('change', () => {
  renderFilePreview(byId('liveBidPhotos'), byId('liveBidPhotoPreview'));
});

byId('liveBidForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = byId('liveBidSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const form = e.target;
    const payload = formToObject(form);
    const photoUrls = await uploadPhotoInput(byId('liveBidPhotos'));
    const tasks = checkedValues('requested_tasks', form);
    payload.quote_type = payload.quote_type || 'live_bid';
    payload.quoteType = payload.quote_type;
    payload.service_types = tasks.length ? tasks : [payload.serviceType || 'other_outdoor_work'];
    payload.requested_tasks = payload.service_types;
    payload.available_days_json = checkedValues('available_days_json', form);
    payload.gate_access_type = payload.gate_size_category || payload.gate_access_type || '';
    payload.yard_access_notes = payload.yard_access_notes || payload.access_notes || '';
    payload.community_access_private = Boolean(payload.community_access_instructions);
    payload.photos = photoUrls;
    payload.photo_count = photoUrls.length;
    payload.status = 'new';
    payload.ai_summary_json = aiPhotoPlaceholder({
      detected_services: payload.service_types,
      live_bid_recommended: true,
    });
    payload.access_summary = buildAccessSummary(payload);

    const missingContact = !payload.customerName || !payload.customerPhone;
    if (missingContact && !getAuthToken()) {
      state.pendingExtraBid = payload;
      openAuthGate(async () => {
        await submitBidRequest(payload, 'liveBidResult');
        form.reset();
        renderFilePreview(byId('liveBidPhotos'), byId('liveBidPhotoPreview'));
      });
      return;
    }

    await submitBidRequest(payload, 'liveBidResult');
    form.reset();
    renderFilePreview(byId('liveBidPhotos'), byId('liveBidPhotoPreview'));
    showSuccess('Bid request submitted');
  } catch (err) {
    showResult('liveBidResult', `<strong>Could not submit:</strong> ${escapeHtml(err.message)}`);
    showError(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Bid Request'; }
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   ADMIN LEADS DASHBOARD
───────────────────────────────────────────────────────────────────────── */

async function loadAdminLeads() {
  const list = byId('leadsList');
  if (!list) return;

  if (!getAuthToken()) {
    list.innerHTML = '<div style="color:var(--muted);padding:12px">Sign in as admin to view leads. Use the ADMIN_API_KEY as your Bearer token.</div>';
    return;
  }

  list.innerHTML = '<div style="color:var(--muted);padding:12px">Loading leads...</div>';

  try {
    const statusFilter = byId('leadsStatusFilter')?.value || '';
    const serviceFilter = byId('leadsServiceFilter')?.value || '';
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (serviceFilter) params.set('serviceType', serviceFilter);
    const qs = params.toString() ? '?' + params.toString() : '';

    const [data, bidData] = await Promise.all([
      api('/api/admin/jobs' + qs),
      api('/api/admin/bid-requests' + qs).catch(() => ({ bidRequests: [] })),
    ]);
    list.innerHTML = '';

    if ((!data.jobs || !data.jobs.length) && (!bidData.bidRequests || !bidData.bidRequests.length)) {
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No leads yet. Customer service requests will appear here after submission.</div>';
      return;
    }

    const instantBookings = (data.jobs || []).filter((lead) => (lead.quote_type || lead.quoteType || 'instant_mow') === 'instant_mow');
    const otherLeads = (data.jobs || []).filter((lead) => (lead.quote_type || lead.quoteType || 'instant_mow') !== 'instant_mow');

    if (instantBookings.length) {
      const heading = document.createElement('div');
      heading.className = 'admin-group-title';
      heading.textContent = 'Instant mow bookings';
      list.append(heading);
    }

    [...instantBookings, ...otherLeads].forEach((lead) => {
      const estimateText = lead.estimatedPrice > 0 ? money(lead.estimatedPrice) : (lead.suggestedBudget > 0 ? `Budget: ${money(lead.suggestedBudget)}` : 'No estimate');
      const mowText = lead.mowAreaSqft > 0 ? `${formatAcres(lead.mowAreaSqft)} (${Number(lead.mowAreaSqft).toLocaleString()} sq ft) mowable` : '';
      const autoText = lead.autoEstimatedMowableSqft > 0 ? `${formatAcres(lead.autoEstimatedMowableSqft)} (${Number(lead.autoEstimatedMowableSqft).toLocaleString()} sq ft) suggested` : '';
      const parcelText = lead.parcelAreaSqft > 0 ? `${formatAcres(lead.parcelAreaSqft)} (${Number(lead.parcelAreaSqft).toLocaleString()} sq ft) parcel` : '';
      const dateText = lead.preferredDate ? `Preferred: ${lead.preferredDate}` : 'Date flexible';
      const accessText = buildAccessSummary(lead);
      const scheduleText = buildScheduleSummary(lead);
      const equipmentText = equipmentRecommendation(lead);
      const requestedTasks = (lead.requested_tasks || lead.requestedTasks || []).join(', ');

      const c = card(`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <h4 style="margin:0 0 4px">${escapeHtml(lead.customerName || 'Anonymous')}</h4>
            <div class="meta">${escapeHtml(lead.customerPhone || '')}${lead.customerEmail ? ' &nbsp;&middot;&nbsp; ' + escapeHtml(lead.customerEmail) : ''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${statusBadge(lead.status)}
            <select class="lead-status-select" data-lead-id="${escapeHtml(lead.id)}" style="padding:7px 10px;border-radius:10px;font-size:.85rem;width:auto">
              <option value="new" ${lead.status === 'new' ? 'selected' : ''}>New</option>
              <option value="quoted" ${lead.status === 'quoted' ? 'selected' : ''}>Quoted</option>
              <option value="bidding" ${lead.status === 'bidding' ? 'selected' : ''}>Bidding</option>
              <option value="scheduled" ${lead.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
              <option value="completed" ${lead.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="canceled" ${lead.status === 'canceled' ? 'selected' : ''}>Canceled</option>
            </select>
          </div>
        </div>
        <div class="meta" style="margin-top:8px">${escapeHtml(lead.address || '')}${lead.city ? ', ' + escapeHtml(lead.city) : ''}${lead.zip ? ' ' + escapeHtml(lead.zip) : ''}</div>
        <div class="meta">${escapeHtml(serviceLabel(lead.serviceType))} &nbsp;&middot;&nbsp; ${escapeHtml(lead.quote_type || 'instant_mow')} &nbsp;&middot;&nbsp; ${estimateText}${mowText ? ' &nbsp;&middot;&nbsp; ' + escapeHtml(mowText) : ''}</div>
        ${(autoText || parcelText || lead.mowableEstimateConfidence || lead.buildingFootprintsSource) ? `<div class="meta">${escapeHtml([parcelText, autoText, lead.mowableEstimateConfidence ? `confidence: ${lead.mowableEstimateConfidence}` : '', lead.buildingFootprintsSource ? `source: ${lead.buildingFootprintsSource}` : ''].filter(Boolean).join(' - '))}</div>` : ''}
        ${accessText ? `<div class="meta">Gate/access: ${escapeHtml(accessText)}</div>` : ''}
        ${scheduleText ? `<div class="meta">Scheduling: ${escapeHtml(scheduleText)}</div>` : ''}
        ${equipmentText ? `<div class="meta">${escapeHtml(equipmentText)}</div>` : ''}
        ${requestedTasks ? `<div class="meta">Requested tasks: ${escapeHtml(requestedTasks)}</div>` : ''}
        ${lead.photos?.length ? `<div class="meta">Photos: ${lead.photos.length}</div>` : ''}
        ${lead.aiSummaryJson ? `<div class="mini-card notice admin-ai-note"><strong>AI notes placeholder</strong><span>${escapeHtml(lead.aiSummaryJson.customer_summary || 'Rough photo guidance only. Provider bid required.')}</span></div>` : ''}
        <div class="meta">${dateText} &nbsp;&middot;&nbsp; ${new Date(lead.createdAt).toLocaleString()}</div>
        ${lead.notes ? `<p style="margin:6px 0 0;font-size:.9rem">${escapeHtml(lead.notes)}</p>` : ''}
        <div class="tool-row admin-actions"><button class="btn secondary small" type="button">Create bid / assign provider</button></div>
        <div class="meta" style="font-size:.8rem;margin-top:4px">ID: ${escapeHtml(lead.id)} &nbsp;&middot;&nbsp; Source: ${escapeHtml(lead.sourceBrand || 'MowNWA')}</div>
      `);

      list.append(c);
    });

    if (bidData.bidRequests?.length) {
      const heading = document.createElement('div');
      heading.className = 'admin-group-title';
      heading.textContent = 'Live bid requests';
      list.append(heading);

      bidData.bidRequests.forEach((bid) => {
        const services = (bid.service_types || []).join(', ') || 'other_outdoor_work';
        const aiSummary = bid.ai_summary_json || {};
        const bidAccess = buildAccessSummary(bid);
        const bidSchedule = buildScheduleSummary(bid);
        const c = card(`
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div>
              <h4 style="margin:0 0 4px">${escapeHtml(bid.customerName || 'Live bid request')}</h4>
              <div class="meta">${escapeHtml(bid.customerPhone || '')}${bid.customerEmail ? ' &nbsp;&middot;&nbsp; ' + escapeHtml(bid.customerEmail) : ''}</div>
            </div>
            ${statusBadge(bid.status || 'new')}
          </div>
          <div class="meta" style="margin-top:8px">${escapeHtml(bid.address || '')}${bid.city ? ', ' + escapeHtml(bid.city) : ''}${bid.zip ? ' ' + escapeHtml(bid.zip) : ''}</div>
          <div class="meta">Services: ${escapeHtml(services)} &nbsp;&middot;&nbsp; Photos: ${(bid.photos || []).length} &nbsp;&middot;&nbsp; Quoted separately</div>
          ${bidAccess ? `<div class="meta">Gate/access: ${escapeHtml(bidAccess)}</div>` : ''}
          ${bidSchedule ? `<div class="meta">Scheduling: ${escapeHtml(bidSchedule)}</div>` : ''}
          <div class="photo-preview-grid">${(bid.photos || []).map((url) => `<img src="${escapeHtml(url)}" alt="Bid request photo" class="job-photo" />`).join('')}</div>
          <div class="mini-card notice admin-ai-note"><strong>AI notes placeholder</strong><span>${escapeHtml(aiSummary.customer_summary || 'Rough photo guidance only. Final amount should come from provider bid.')}</span></div>
          ${bid.notes ? `<p style="margin:6px 0 0;font-size:.9rem">${escapeHtml(bid.notes)}</p>` : ''}
          <div class="tool-row admin-actions"><button class="btn primary small" type="button">Create bid</button><button class="btn secondary small" type="button">Assign provider</button></div>
          <div class="meta" style="font-size:.8rem;margin-top:4px">ID: ${escapeHtml(bid.id)}${bid.related_job_id ? ' &nbsp;&middot;&nbsp; Job: ' + escapeHtml(bid.related_job_id) : ''}</div>
        `);
        list.append(c);
      });
    }

    // Wire status dropdowns
    list.querySelectorAll('.lead-status-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const leadId = sel.dataset.leadId;
        const status = sel.value;
        try {
          await api(`/api/admin/jobs/${leadId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status }),
          });
          await loadAdminLeads();
        } catch (err) {
          showError('Could not update status: ' + err.message);
        }
      });
    });

  } catch (err) {
    list.innerHTML = `<div style="color:var(--muted);padding:12px">Could not load leads: ${escapeHtml(err.message)}</div>`;
  }
}

byId('refreshLeadsBtn')?.addEventListener('click', loadAdminLeads);
byId('leadsStatusFilter')?.addEventListener('change', loadAdminLeads);
byId('leadsServiceFilter')?.addEventListener('change', loadAdminLeads);
function resetParcelQuoteStateForNewAddress() {
  const form = byId('quoteForm');

  clearParcelLayer();
  clearMowLayer();

  if (form) {
    form.elements.parcelId.value = '';
    form.elements.lotAreaSqft.value = '';
    form.elements.mowAreaSqft.value = '';
    form.elements.lotSource.value = '';
    MOWABLE_ESTIMATE_FIELDS.forEach((name) => {
      if (form.elements[name]) form.elements[name].value = '';
    });
  }

  updateMowAreaHelper(0, 0);
  renderSuggestedMowablePanel(null);
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

// applyRoleVisibility() → public/js/auth/admin-visibility.js

function updateQuoteStepper() {
  const stepper = byId('quoteStepper');
  if (!stepper) return;
  const step = quoteStepNumber();

  stepper.querySelectorAll('.qs-step').forEach((el) => {
    const s = Number(el.dataset.qsStep);
    el.classList.toggle('qs-active', s === step);
    el.classList.toggle('qs-done', s < step);
  });
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

  const quote = state.lastQuote || state.pendingQuote || {};
  const loginForm = byId('gateLoginForm');
  const registerForm = byId('gateRegisterForm');
  if (loginForm?.elements?.email && quote.email) loginForm.elements.email.value = quote.email;
  if (registerForm) {
    if (registerForm.elements.fullName && quote.name) registerForm.elements.fullName.value = quote.name;
    if (registerForm.elements.email && quote.email) registerForm.elements.email.value = quote.email;
    if (registerForm.elements.phone && quote.phone) registerForm.elements.phone.value = quote.phone;
  }

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
    const callback = state._authGateCallback;
    closeAuthGate();
    if (typeof callback === 'function') callback();
  } catch (err) {
    showError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

byId('gateRegisterForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const { fullName, email, phone, password } = Object.fromEntries(new FormData(e.target));
    const regRes = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, phone, password, role: 'customer' }),
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
    const callback = state._authGateCallback;
    closeAuthGate();
    if (typeof callback === 'function') callback();
  } catch (err) {
    showError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   QUOTE → JOB BOOKING
───────────────────────────────────────────────────────────────────────── */

async function bookQuoteAsJob() {
  if (!state.lastQuote) {
    showResult('quoteResult', '<strong>Get an estimate, then accept the quote to book.</strong>');
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
      Number(q.mowAreaSqft || 0) > 0 ? `Mow area: ${formatAcres(q.mowAreaSqft)} (${Number(q.mowAreaSqft).toLocaleString()} sq ft)` : '',
      Number(q.lotAreaSqft || 0) > 0 ? `Lot area: ${formatAcres(q.lotAreaSqft)} (${Number(q.lotAreaSqft).toLocaleString()} sq ft)` : '',
      q.propertyType && q.propertyType !== 'standard' ? `Property type: ${q.propertyType}` : '',
      q.fenced ? 'Fenced' : '',
      q.overgrown ? 'Overgrown' : '',
      q.obstacles ? 'Obstacles' : '',
      q.rushJob ? 'Rush job' : '',
      q.slopedTerrain ? 'Sloped terrain' : '',
      q.grass_height_range ? `Grass height: ${q.grass_height_range}` : '',
      q.service_frequency ? `Frequency: ${q.service_frequency}` : '',
      q.selected_yard_areas?.length ? `Yard areas: ${q.selected_yard_areas.join(', ')}` : '',
      buildAccessSummary(q),
      buildScheduleSummary(q),
      equipmentRecommendation(q),
      q.pets ? `Pets: ${q.pets}` : '',
      q.pet_waste_level ? `Pet waste: ${q.pet_waste_level}` : '',
      q.obstacles_list?.length ? `Obstacles: ${q.obstacles_list.join(', ')}` : '',
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
      quote_id: q.id || q.quote_id || null,
      final_price: Number(q.estimate || 0),
      payment_status: 'checkout_pending',
      scope_locked: true,
      included_tasks_json: INCLUDED_MOW_TASKS,
      excluded_tasks_json: EXCLUDED_MOW_TASKS,
    };

    const checkout = await api('/api/checkout/instant-mow', {
      method: 'POST',
      body: JSON.stringify({
        quote_id: q.id || q.quote_id || '',
        serviceType: q.serviceType || 'mowing',
        estimate: Number(q.estimate || 0),
        final_price: Number(q.estimate || 0),
      }),
    });
    if (checkout.checkoutUrl) {
      window.location.href = checkout.checkoutUrl;
      return;
    }
    payload.payment_status = checkout.paymentStatus || 'checkout_pending';

    const data = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    let extraBidMessage = '';
    if (state.pendingExtraBid?.tasks?.length) {
      const photoUrls = await uploadPhotoInput(byId('extraBidPhotos'));
      const bidRequest = await submitBidRequest({
        related_quote_id: q.id || null,
        related_job_id: data.job.id,
        service_types: state.pendingExtraBid.tasks,
        requested_tasks: state.pendingExtraBid.tasks,
        address: q.address || '',
        city: q.city || '',
        state: q.state || 'AR',
        zip: q.zip || '',
        customerName: q.name || '',
        customerPhone: q.phone || '',
        customerEmail: q.email || '',
        notes: state.pendingExtraBid.notes || '',
        preferredTiming: state.pendingExtraBid.preferredTiming || 'flexible',
        photos: photoUrls,
        ai_summary_json: aiPhotoPlaceholder({
          detected_services: state.pendingExtraBid.tasks,
          live_bid_recommended: true,
        }),
      }, '');
      extraBidMessage = `<br>Extra services: live bid requested (${escapeHtml(bidRequest.id)}), quoted separately.`;
    }

    state.lastQuote = null;
    state.pendingExtraBid = null;

    showResult(
      'quoteResult',
      `<strong>Job booked!</strong><br>
       Job ID: ${escapeHtml(data.job.id)}<br>
       Address: ${escapeHtml(data.job.address)}<br>
       Price: <strong>${money(data.job.budget)}</strong><br>
       Status: <span class="status-badge ${escapeHtml(data.job.status)}">${escapeHtml(data.job.status)}</span>${extraBidMessage}<br><br>
       <button class="btn secondary small" type="button"
         onclick="setActiveView('jobs')">View My Bookings &rarr;</button>`
    );

    await loadMyJobs();
    if (isAdmin()) await loadAdmin().catch(() => {});
  } catch (error) {
    showResult('quoteResult', `<strong>Booking failed:</strong> ${escapeHtml(error.message)}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Pay & Book Mow'; }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   MY BOOKINGS (customer) + OPEN JOBS (provider)
───────────────────────────────────────────────────────────────────────── */

function statusBadge(status) {
  return `<span class="status-badge ${escapeHtml(status || 'open')}">${escapeHtml(status || 'open')}</span>`;
}

function navLinksHtml(job) {
  const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');
  if (!addr.trim()) return '';
  const enc = encodeURIComponent(addr);
  return `<div class="nav-link-row">
    <a class="nav-link-btn" href="https://www.google.com/maps/search/?api=1&query=${enc}" target="_blank" rel="noopener">Google Maps</a>
    <a class="nav-link-btn" href="https://maps.apple.com/?q=${enc}" target="_blank" rel="noopener">Apple Maps</a>
    <a class="nav-link-btn" href="https://waze.com/ul?q=${enc}&navigate=yes" target="_blank" rel="noopener">Waze</a>
    <button class="nav-link-btn" type="button" data-copy-addr="${escapeHtml(addr)}">Copy Address</button>
  </div>`;
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
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No bookings yet. Get an estimate, accept the quote, then book service.</div>';
      return;
    }

    data.jobs.forEach((job) => {
      const c = card(`
        <h4>${escapeHtml(job.title || 'Lawn Service')}</h4>
        <div class="meta">${escapeHtml(job.address || '')} ${escapeHtml(job.city || '')} ${escapeHtml(job.state || '')}</div>
        <div class="meta">Price: <strong>${money(job.budget)}</strong> &nbsp;·&nbsp; ${statusBadge(job.status)}</div>
        ${job.details ? `<p>${escapeHtml(job.details)}</p>` : ''}
        <div class="meta" style="font-size:.85rem">Booked: ${job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'n/a'}</div>
        ${navLinksHtml(job)}
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
      const access = buildAccessSummary(job);
      const schedule = buildScheduleSummary(job);
      const equipment = equipmentRecommendation(job);
      const c = card(`
        <h4>${escapeHtml(job.title || 'Lawn Service')}</h4>
        <div class="meta">${escapeHtml(job.address || '')} ${escapeHtml(job.city || '')} ${escapeHtml(job.state || '')}</div>
        <div class="meta">Budget: <strong>${money(job.budget)}</strong> &nbsp;·&nbsp; ${statusBadge(job.status)}</div>
        ${access ? `<div class="meta">${escapeHtml(access)}</div>` : ''}
        ${schedule ? `<div class="meta">${escapeHtml(schedule)}</div>` : ''}
        ${equipment ? `<div class="meta">${escapeHtml(equipment)}</div>` : ''}
        ${job.details ? `<p>${escapeHtml(job.details.slice(0, 200))}</p>` : ''}
        <div class="meta" style="font-size:.85rem">Posted: ${job.postedAt ? new Date(job.postedAt).toLocaleDateString() : 'n/a'}</div>
        ${isProvider ? navLinksHtml(job) : ''}
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
    showError('Could not accept job: ' + error.message);
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

byId('selectParcelBtn')?.addEventListener('click', () => {
  if (state.parcelSelectMode) exitParcelSelectMode();
  else enterParcelSelectMode();
});

byId('useThisParcelConfirmBtn')?.addEventListener('click', confirmParcelSelection);
byId('useThisParcelCancelBtn')?.addEventListener('click', exitParcelSelectMode);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy-addr]');
  if (!btn) return;
  const addr = btn.dataset.copyAddr || '';
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(addr)
      .then(() => showSuccess('Address copied'))
      .catch(() => showError('Could not copy address'));
  } else {
    showInfo(addr);
  }
});

window.addEventListener('popstate', () => {
  renderLocalLandingFromPath();
  setActiveView('dashboard');
});

(async function init() {
  initNavigation();
  initMap();

  renderHomepageContent();
  renderCoverage();
  renderLocalLandingFromPath();

  try {
    await loadConfig();
  } catch (error) {
    console.warn('Could not load pricing/config yet; showing local landing content only.', error);
  }

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
  // loadAdmin() and loadAdminLeads() are triggered by applyRoleVisibility() above when admin
  await Promise.allSettled([loadProviders(), loadJobs()]);

  const form = byId('quoteForm');
  const lat = form?.elements?.lat?.value;
  const lng = form?.elements?.lng?.value;

  if (lat && lng) {
    placeMarker(lat, lng);
    lookupParcel().catch((error) => showWarning(prettyApiError(error)));
  } else {
    updateMowAreaHelper(0, 0);
    showQuoteFlowStep('start', { scroll: false });
  }
  updateQuoteFlowState();
})();
