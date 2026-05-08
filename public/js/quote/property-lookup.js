// Property / address / parcel lookup UI logic.
// Extracted from app.js — Phase 4 modular refactor. Loads before app.js.
//
// Pre-load globals required:
//   state                       → public/js/state.js
//   byId, $$, escapeHtml,
//   showResult, showWarning,
//   showError, formatAcres      → public/js/utils/dom.js
//   api                         → public/js/core/api.js
//   showQuoteFlowStep,
//   updateQuoteFlowState        → public/js/quote/quote-flow.js
//
// Runtime globals called (resolved from app.js at call time):
//   normalizeServiceAddressParts, getQuoteFormServiceAddress,
//   setCurrentServiceAddress, hasServiceAddress,
//   resolveServiceAddressFromParcel, parcelPropertiesFromLookupData,
//   propText, setLatLng, placeMarker, placeCurrentLocationMarker,
//   drawParcel, clearParcelLayer, clearMowLayer,
//   layerAreaSqFt, updateMowAreaHelper, renderSuggestedMowablePanel,
//   scheduleEstimateRefresh, saveQuoteDraft, formToObject,
//   prettyApiError, hydrateLiveBidForm, resetParcelQuoteStateForNewAddress

const QUOTE_FLOW_PARCEL_LOOKUP_TIMEOUT_MS = 6500;
const QUOTE_FLOW_PARCEL_LOOKUP_REUSE_MS = 8000;
let activeParcelLookupRequest = null;
let lastParcelLookupRequest = null;
let lookupInFlight = null;

function propertyQuoteFlowDebugEnabled() {
  try {
    return Boolean(window.DEBUG_QUOTE_FLOW)
      || localStorage.getItem('DEBUG_QUOTE_FLOW') === '1'
      || localStorage.getItem('DEBUG_QUOTE_FLOW') === 'true';
  } catch {
    return false;
  }
}

function quoteFlowTrace(label, data = {}) {
  if (!propertyQuoteFlowDebugEnabled()) return;
  console.log(`[QuoteFlow] ${label}`, {
    step: document.body?.dataset?.quoteFlowStep || state.quoteFlowStep || '',
    ...data,
  });
}

function quoteFlowTimeStart(label, data = {}) {
  if (!propertyQuoteFlowDebugEnabled()) return '';
  const timerLabel = `[QuoteFlow] ${label} ${Date.now()}`;
  console.time(timerLabel);
  quoteFlowTrace(`${label}:start`, data);
  return timerLabel;
}

function quoteFlowTimeEnd(timerLabel, label, data = {}) {
  if (!propertyQuoteFlowDebugEnabled() || !timerLabel) return;
  quoteFlowTrace(`${label}:end`, data);
  console.timeEnd(timerLabel);
}

function setAddressLookupLoading(isLoading, message = '') {
  const btn = byId('locateAddressBtn');
  if (btn) {
    if (isLoading) {
      btn.dataset.originalHtml = btn.innerHTML || '';
      btn.disabled = true;
      btn.innerHTML = `<img src="/assets/icons/lucide/search.svg" alt="" class="ui-icon"><span class="ui-label">${escapeHtml(message || 'Finding property...')}</span>`;
    } else {
      btn.disabled = false;
      if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
      else btn.textContent = 'Find Property';
      delete btn.dataset.originalHtml;
    }
  }
}

function normalizeParcelLookupError(error) {
  if (error?.name === 'AbortError') return new Error('Parcel lookup timed out.');
  return error;
}

async function geocodeAddress() {
  const timer = quoteFlowTimeStart('address geocode');
  const form = byId('quoteForm');
  if (!form) return;

  const payload = formToObject(form);
  const q = [payload.address, payload.city, payload.state || 'AR', payload.zip]
    .filter(Boolean)
    .join(', ');

  if (!q.trim()) {
    showPropertyConfirmationPanel(true);
    showResult('parcelInfo', '<strong>Enter an address first.</strong>');
    return false;
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&addressdetails=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();

  if (!Array.isArray(data) || !data.length) {
    showPropertyConfirmationPanel(true);
    showResult(
      'parcelInfo',
      '<strong>Address not found.</strong> Try adding city/state or use autocomplete.'
    );
    return false;
  }

  const { lat, lon } = data[0];
  const point = { lat: Number(lat), lng: Number(lon) };
  const resultState = String(data[0]?.address?.state_code || data[0]?.address?.state || '').trim().toLowerCase();
  if (!isLngLatInArkansas({ ...point, state: resultState })) {
    showArkansasOnlyPropertyBlock({ toast: { force: true } });
    quoteFlowTimeEnd(timer, 'address geocode', { blocked: 'outside-arkansas', lat: point.lat, lng: point.lng });
    return false;
  }

  setCurrentServiceAddress(getQuoteFormServiceAddress(), 'typed-address');
  setLatLng(lat, lon);
  placeMarker(lat, lon);

  showResult(
    'parcelInfo',
    `<strong>Address located.</strong><br />Lat: ${Number(lat).toFixed(6)} · Lng: ${Number(lon).toFixed(6)}`
  );
  quoteFlowTimeEnd(timer, 'address geocode', { lat: Number(lat), lng: Number(lon) });
  return true;
}

function addressPartsFromGoogleComponents(components = []) {
  const getLong = (type) => components.find((component) => component.types?.includes(type))?.long_name || '';
  const getShort = (type) => components.find((component) => component.types?.includes(type))?.short_name || '';
  return normalizeServiceAddressParts({
    address: `${getLong('street_number')} ${getLong('route')}`.trim(),
    city:
      getLong('locality') ||
      getLong('sublocality') ||
      getLong('administrative_area_level_3') ||
      getLong('administrative_area_level_2') ||
      '',
    state: getShort('administrative_area_level_1') || 'AR',
    zip: getLong('postal_code') || '',
  });
}

function addressPartsFromNominatim(data = {}) {
  const address = data.address || {};
  const stateValue = address.state_code || (address.state === 'Arkansas' ? 'AR' : address.state);
  return normalizeServiceAddressParts({
    address: [address.house_number, address.road].filter(Boolean).join(' '),
    city:
      address.city ||
      address.town ||
      address.village ||
      address.hamlet ||
      address.municipality ||
      '',
    state: stateValue || 'AR',
    zip: address.postcode || '',
    full: data.display_name || '',
  });
}

async function reverseGeocodeServiceAddress(lat, lng) {
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return normalizeServiceAddressParts();

  if (window.google?.maps?.Geocoder) {
    try {
      const geocoder = new google.maps.Geocoder();
      const results = await new Promise((resolve, reject) => {
        geocoder.geocode({ location: point }, (items, status) => {
          if (status === 'OK') resolve(items || []);
          else reject(new Error(status || 'Google reverse geocode failed'));
        });
      });
      const first = results[0];
      if (first) {
        const parts = addressPartsFromGoogleComponents(first.address_components || []);
        parts.full = first.formatted_address || parts.full;
        return parts;
      }
    } catch (error) {
      console.warn('[Reverse Geocode Failed] google', error);
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lng)}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      return addressPartsFromNominatim(await res.json());
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.warn('[Reverse Geocode Failed] nominatim', error);
    return normalizeServiceAddressParts();
  }
}

async function fillMissingServiceAddressFromReverseGeocode(address, point = {}) {
  const current = normalizeServiceAddressParts(address || {});
  if (current.city && current.zip) return current;
  const reverse = await reverseGeocodeServiceAddress(point.lat, point.lng);
  if (!reverse.city && !reverse.zip) return current;

  const merged = normalizeServiceAddressParts({
    street: current.street || reverse.street,
    address: current.address || reverse.address,
    city: current.city || reverse.city,
    state: current.state || reverse.state || 'AR',
    zip: current.zip || reverse.zip,
    full: current.full || reverse.full,
  });

  console.log('[Service Address Reverse Geocode Fallback]', {
    point,
    reverse,
    final: merged,
  });

  return merged;
}

function fillMissingServiceAddressFromReverseGeocodeLater(address, point = {}) {
  const current = normalizeServiceAddressParts(address || {});
  if (current.city && current.zip) return;
  setTimeout(async () => {
    const timer = quoteFlowTimeStart('reverse geocode fallback', point);
    try {
      const merged = await fillMissingServiceAddressFromReverseGeocode(current, point);
      if (!hasServiceAddress(merged)) return;
      setCurrentServiceAddress(merged, 'reverse-geocode-background', {
        syncQuoteForm: true,
        clearQuoteFormMissing: true,
        replace: false,
      });
      saveQuoteDraft();
    } catch (error) {
      console.warn('[Reverse Geocode Background Failed]', error);
    } finally {
      quoteFlowTimeEnd(timer, 'reverse geocode fallback');
    }
  }, 0);
}

function parcelLookupPointFromGeometry(geometry = null) {
  const ring = geometry?.rings?.[0] || geometry?.coordinates?.[0]?.[0] || geometry?.coordinates?.[0] || [];
  const points = Array.isArray(ring) ? ring : [];
  const totals = points.reduce((acc, point) => {
    const lng = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return acc;
    acc.lat += lat;
    acc.lng += lng;
    acc.count += 1;
    return acc;
  }, { lat: 0, lng: 0, count: 0 });
  if (!totals.count) return null;
  return { lat: totals.lat / totals.count, lng: totals.lng / totals.count };
}

function quoteFormLatLng() {
  const form = byId('quoteForm');
  const lat = Number(form?.elements?.lat?.value || 0);
  const lng = Number(form?.elements?.lng?.value || 0);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat && lng ? { lat, lng } : null;
}

function showArkansasOnlyPropertyBlock(options = {}) {
  const resultId = options.resultId || 'parcelInfo';
  showPropertyConfirmationPanel(options.showPanel !== false);
  showResult(resultId, `<strong>${escapeHtml(ARKANSAS_ONLY_MESSAGE)}</strong>`);
  showArkansasOnlyWarning(options.toast || {});
}

function parcelLookupArkansasPoint(geometry, fallbackPoint = null) {
  return parcelLookupPointFromGeometry(geometry) || fallbackPoint || quoteFormLatLng();
}

function showPropertyConfirmationPanel(visible = true) {
  byId('quoteParcelScreen')?.classList.toggle('hidden', !visible);
}

function confirmPropertyAddressText(parcelProps = {}, serviceAddress = {}) {
  const normalizedAddress = normalizeServiceAddressParts(serviceAddress || {});
  const serviceFull = [
    normalizedAddress.address,
    normalizedAddress.city,
    [normalizedAddress.state, normalizedAddress.zip].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');

  return firstTextValue(
    parcelFullAddressFromProps(parcelProps),
    propText(parcelProps, 'adrlabel', 'situsaddress', 'siteaddress', 'propertyaddress', 'address'),
    normalizedAddress.full,
    serviceFull
  );
}

function renderConfirmProperty(options = {}) {
  const parcelInfo = byId('parcelInfo');
  if (!parcelInfo) return;

  const parcelProps = options.parcelProps
    || state.selectedParcelProperties
    || state.parcelProperties
    || state.selectedParcel?.properties
    || {};
  const normalized = options.normalized || {};
  const attrs = options.attrs || normalized.attributes || {};
  const serviceAddress = normalizeServiceAddressParts(options.serviceAddress || state.currentServiceAddress || {});
  const parcelId = firstTextValue(
    options.parcelId,
    normalized.parcelId,
    propText(parcelProps, 'parcelId', 'parcelid', 'parcel_id', 'PARCELID', 'PIN'),
    propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN')
  );
  const addressLabel = firstTextValue(options.addressLabel, confirmPropertyAddressText(parcelProps, serviceAddress));
  const ownerName = firstTextValue(
    options.ownerName,
    propText(parcelProps, 'ownername', 'owner_name', 'OWNERNAME', 'owner', 'OWNER', 'own_name'),
    propText(attrs, 'ownername', 'owner_name', 'OWNERNAME', 'owner', 'OWNER', 'own_name')
  );
  const county = firstTextValue(
    options.county,
    normalized.county,
    propText(parcelProps, 'county', 'countyid', 'COUNTY', 'COUNTY_NAME'),
    propText(attrs, 'county', 'countyid', 'COUNTY', 'COUNTY_NAME')
  );
  const method = firstTextValue(options.method, normalized.method);
  const customerLines = [
    `<strong>${escapeHtml(options.headline || 'Parcel found. Boundary loaded.')}</strong>`,
    addressLabel ? `Address: ${escapeHtml(addressLabel)}` : null,
    ownerName ? `Owner: ${escapeHtml(ownerName)}` : null,
    'Use <strong>Lasso Yard</strong> to draw the mowable area.',
  ].filter(Boolean);
  const techLines = [
    method ? `Match: ${escapeHtml(method)}` : null,
    `County: ${escapeHtml(county || 'n/a')}`,
    `Parcel ID: ${escapeHtml(parcelId || 'n/a')}`,
  ].filter(Boolean).join('<br>');

  parcelInfo.textContent = '';
  parcelInfo.innerHTML = customerLines.join('<br>')
    + `<details class="parcel-tech-details"><summary>Advanced parcel details</summary>${techLines}</details>`;
  parcelInfo.dataset.parcelId = parcelId || '';
  parcelInfo.dataset.addressLabel = addressLabel || '';
  parcelInfo.classList.remove('hidden');
}

async function lookupParcel(options = {}) {
  const timer = quoteFlowTimeStart('parcel lookup handler');
  const quoteForm = byId('quoteForm');
  const parcelInfo = byId('parcelInfo');
  if (!quoteForm || !parcelInfo) return;

  const lat = quoteForm.elements.lat.value;
  const lng = quoteForm.elements.lng.value;

  if (!lat || !lng) {
    showPropertyConfirmationPanel(true);
    return showResult(
      'parcelInfo',
      '<strong>No coordinates yet.</strong> Use Find Address or autocomplete first.'
    );
  }

  const selectedPoint = { lat: Number(lat), lng: Number(lng) };
  if (!isLngLatInArkansas(selectedPoint)) {
    showArkansasOnlyPropertyBlock({ toast: { force: true } });
    clearParcelLayer();
    updateQuoteFlowState();
    quoteFlowTimeEnd(timer, 'parcel lookup handler', { blocked: 'outside-arkansas', lat: selectedPoint.lat, lng: selectedPoint.lng });
    return { ok: false, reason: 'outside_arkansas' };
  }

  const address = quoteForm.elements.address?.value || '';
  const city = quoteForm.elements.city?.value || '';
  const zip = quoteForm.elements.zip?.value || '';

  const qs = new URLSearchParams({ lat, lng, address, city, zip });
  const lookupKey = qs.toString();
  if (activeParcelLookupRequest?.key === lookupKey) {
    quoteFlowTrace('parcel lookup:deduped', { lookupKey });
    console.info('[ParcelLookup] reusing in-flight lookup', { lookupKey, source: options.source || '' });
    window.turflynkCanvasDiagnostics?.('parcel lookup deduped', { lookupKey, source: options.source || '' });
    lookupInFlight = activeParcelLookupRequest.promise;
    return activeParcelLookupRequest.promise;
  }
  if (
    !options.force
    && lastParcelLookupRequest?.key === lookupKey
    && Date.now() - Number(lastParcelLookupRequest.completedAt || 0) < QUOTE_FLOW_PARCEL_LOOKUP_REUSE_MS
  ) {
    quoteFlowTrace('parcel lookup:recent-result-reused', { lookupKey });
    console.info('[ParcelLookup] recent duplicate lookup skipped', { lookupKey, source: options.source || '' });
    window.turflynkCanvasDiagnostics?.('parcel lookup skipped', { lookupKey, source: options.source || '' });
    return lastParcelLookupRequest.result;
  }

  parcelInfo.innerHTML = '<strong>Finding property boundary...</strong>';
  parcelInfo.classList.remove('hidden');
  window.turflynkCanvasDiagnostics?.('parcel lookup start', { lookupKey, source: options.source || '' });

  const lookupPromise = (async () => {
    let data;
    try {
      data = await api(`/api/parcel/lookup?${qs.toString()}`, {
        timeoutMs: options.timeoutMs || QUOTE_FLOW_PARCEL_LOOKUP_TIMEOUT_MS,
      });
    } catch (error) {
      throw normalizeParcelLookupError(error);
    }

    if (!data.ok) {
      const message = options.notFoundMessage || 'Parcel boundary not found. You can still draw the mowable area manually.';
      parcelInfo.innerHTML = options.hideNotFoundDetails
        ? `<strong>${escapeHtml(message)}</strong>`
        : `
          <strong>${escapeHtml(message)}</strong><br>
          Reason: ${escapeHtml(data.reason || 'unknown')}<br>
          You can still draw the mowable area manually.
        `;
      parcelInfo.classList.remove('hidden');
      showPropertyConfirmationPanel(true);
      clearParcelLayer();
      updateQuoteFlowState();
      if (!options.suppressNotFoundToast) {
        showWarning('Parcel lookup failed. You can still draw the area manually.');
      }
      return data;
    }

    const normalized = data.normalized || {};
    const attrs = normalized.attributes || {};
    const parcelProps = parcelPropertiesFromLookupData(data);
    const fallbackAddress = options.allowAddressFallback === false ? {} : getQuoteFormServiceAddress();
    const serviceAddress = resolveServiceAddressFromParcel(parcelProps, fallbackAddress);
    fillMissingServiceAddressFromReverseGeocodeLater(serviceAddress, { lat, lng });

    const parcelId = normalized.parcelId || propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN') || '';
    const addressLabel = propText(parcelProps, 'adrlabel') || 'n/a';
    const county = normalized.county || propText(attrs, 'countyid', 'county', 'COUNTY') || 'n/a';
    const geometry = data.feature?.geometry || null;
    const validationPoint = parcelLookupArkansasPoint(geometry, selectedPoint);
    const validationState = serviceAddress.state || addressPartsFromParcelProps(parcelProps).state || '';
    if (!isLngLatInArkansas(validationPoint)) {
      showArkansasOnlyPropertyBlock({ toast: { force: true } });
      clearParcelLayer();
      updateQuoteFlowState();
      return { ok: false, reason: 'outside_arkansas', blocked: true };
    }
    if (validationState && !isLngLatInArkansas({ ...validationPoint, state: validationState })) {
      showArkansasOnlyPropertyBlock({ toast: { force: true } });
      clearParcelLayer();
      updateQuoteFlowState();
      return { ok: false, reason: 'outside_arkansas', blocked: true };
    }

    state.parcelProperties = parcelProps;
    state.selectedParcelProperties = parcelProps;
    state.selectedParcel = { type: 'Feature', geometry: null, properties: parcelProps };

    quoteForm.elements.parcelId.value = parcelId;
    quoteForm.elements.lotAreaSqft.value = '';
    quoteForm.elements.mowAreaSqft.value = '';
    if (quoteForm.elements.customerAdjustedMowableSqft) quoteForm.elements.customerAdjustedMowableSqft.value = '';
    const serviceAddressSource = hasServiceAddress(serviceAddress)
      ? `parcel-${data.method || 'lookup'}`
      : options.allowAddressFallback === false
        ? 'parcel-no-address'
        : `parcel-${data.method || 'lookup'}`;
    setCurrentServiceAddress(serviceAddress, serviceAddressSource, {
      syncQuoteForm: true,
      clearQuoteFormMissing: true,
      replace: true,
    });

    if (geometry) {
      drawParcel(geometry, parcelProps); // TODO: drawParcel is map-coupled, stays in app.js
      const parcelAreaSqft = Number(normalized.areaSqft || 0)
        || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : 0);
      quoteForm.elements.lotAreaSqft.value = parcelAreaSqft || '';
      renderSuggestedMowablePanel(null);
      scheduleEstimateRefresh('parcel-loaded');
    }

    updateMowAreaHelper(
      Number(quoteForm.elements.lotAreaSqft.value || 0),
      Number(quoteForm.elements.mowAreaSqft.value || 0)
    );

    renderConfirmProperty({
      headline: 'Parcel found. Boundary loaded.',
      parcelProps,
      normalized,
      attrs,
      serviceAddress,
      method: data.method || '',
      parcelId,
      addressLabel,
      county,
      lotSqft: Number(quoteForm.elements.lotAreaSqft.value || 0),
      mowSqft: Number(quoteForm.elements.mowAreaSqft.value || 0),
    });
    showPropertyConfirmationPanel(true);

    saveQuoteDraft();
    scheduleEstimateRefresh('parcel-loaded');
    updateQuoteFlowState();
    if (options.navigate !== false) showQuoteFlowStep('property');
    window.turflynkCanvasDiagnostics?.('parcel lookup complete', { lookupKey, source: options.source || '' });
    return data;

  })();

  activeParcelLookupRequest = { key: lookupKey, promise: lookupPromise };
  lookupInFlight = lookupPromise;
  try {
    const result = await lookupPromise;
    lastParcelLookupRequest = {
      key: lookupKey,
      result,
      completedAt: Date.now(),
    };
    return result;
  } catch (error) {
    const normalizedError = normalizeParcelLookupError(error);
    const message = normalizedError.message === 'Parcel lookup timed out.'
      ? 'Parcel lookup is taking longer than expected. You can search again or request an in-person quote.'
      : prettyApiError(normalizedError);
    parcelInfo.innerHTML = `<strong>${escapeHtml(message)}</strong>`;
    parcelInfo.classList.remove('hidden');
    showPropertyConfirmationPanel(true);
    updateQuoteFlowState();
    if (!options.suppressNotFoundToast) showWarning(message);
    throw normalizedError;
  } finally {
    if (activeParcelLookupRequest?.key === lookupKey) activeParcelLookupRequest = null;
    if (lookupInFlight === lookupPromise) lookupInFlight = null;
    quoteFlowTimeEnd(timer, 'parcel lookup handler');
  }
}

async function lookupParcelByLatLng(lat, lng) {
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!isLngLatInArkansas(point)) {
    setGpsStatus(ARKANSAS_ONLY_MESSAGE);
    showArkansasOnlyPropertyBlock({ showPanel: false, toast: { force: true } });
    throw new Error(ARKANSAS_ONLY_MESSAGE);
  }
  const reverseAddress = await reverseGeocodeServiceAddress(point.lat, point.lng);
  if (reverseAddress.state && !isLngLatInArkansas({ ...point, state: reverseAddress.state })) {
    setGpsStatus(ARKANSAS_ONLY_MESSAGE);
    showArkansasOnlyPropertyBlock({ showPanel: false, toast: { force: true } });
    throw new Error(ARKANSAS_ONLY_MESSAGE);
  }

  clearParcelLayer(); // TODO: clearParcelLayer is map-coupled, stays in app.js
  clearMowLayer();    // TODO: clearMowLayer is map-coupled, stays in app.js
  renderSuggestedMowablePanel(null);
  setCurrentServiceAddress({}, 'gps-location', {
    syncQuoteForm: true,
    clearQuoteFormMissing: true,
  });
  setLatLng(lat, lng);
  placeCurrentLocationMarker(lat, lng); // TODO: placeCurrentLocationMarker is map-coupled, stays in app.js
  await lookupParcel({
    notFoundMessage: 'We found your location, but could not match a parcel here. Try typing the address.',
    hideNotFoundDetails: true,
    suppressNotFoundToast: true,
    allowAddressFallback: false,
  });
}

function setGpsStatus(message) {
  const statusEl = byId('gpsStatusMsg');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.classList.toggle('hidden', !message);
}

function setGpsButtonLocating(isLocating) {
  $$('[data-use-current-location]').forEach((btn) => {
    if (isLocating) {
      btn.dataset.originalText = btn.textContent || 'Use Current Location';
      btn.textContent = 'Finding your location...';
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || 'Use Current Location';
    delete btn.dataset.originalText;
  });
}

function gpsErrorMessage(error) {
  if (error?.code === 1) {
    return 'Location permission was denied. You can still type your address.';
  }
  return 'Could not get your location. Try again or type your address.';
}

async function requestCurrentLocation() {
  if (!navigator.geolocation) {
    setGpsStatus('GPS location is not supported on this device/browser.');
    return;
  }

  setGpsButtonLocating(true);
  setGpsStatus('Finding your location...');
  byId('gpsConfirmBar')?.classList.add('hidden');
  showPropertyConfirmationPanel(false);

  // Browser geolocation requires HTTPS in production, or localhost during development.
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude: lat, longitude: lng } = position.coords;
      setGpsStatus('Location found. Checking parcel...');
      try {
        await lookupParcelByLatLng(lat, lng);
        if (state.parcelLayer) {
          setGpsStatus('');
          showPropertyConfirmationPanel(true);
          if (state.serviceFlow === 'live_bid') hydrateLiveBidForm(byId('liveBidServiceType')?.value || 'other');
          byId('gpsConfirmBar')?.classList.remove('hidden');
        } else {
          setGpsStatus('We found your location, but could not match a parcel here. Try typing the address.');
        }
      } catch (err) {
        const message = prettyApiError(err) || 'Could not get your location. Try again or type your address.';
        setGpsStatus(message);
        if (message !== ARKANSAS_ONLY_MESSAGE) showError(message);
      } finally {
        setGpsButtonLocating(false);
      }
    },
    (geoError) => {
      setGpsButtonLocating(false);
      const message = gpsErrorMessage(geoError);
      setGpsStatus(message);
      showError(message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

if (!window.__turflynkPropertyLookupListenersInstalled) {
  window.__turflynkPropertyLookupListenersInstalled = true;

  // Continue to draw — only confirms parcel exists, then navigates
  byId('continueToDrawBtn')?.addEventListener('click', () => {
    const timer = quoteFlowTimeStart('continue to draw click');
    if (state.pendingParcelFeature && typeof confirmParcelSelection === 'function') {
      confirmParcelSelection({ nextStep: 'draw' })
        .catch((error) => showError('Parcel selection failed: ' + prettyApiError(error)))
        .finally(() => quoteFlowTimeEnd(timer, 'continue to draw click'));
      return;
    }
    if (!state.parcelLayer) {
      showWarning('Lookup the parcel before drawing.');
      quoteFlowTimeEnd(timer, 'continue to draw click', { blocked: true });
      return;
    }
    const validationPoint = parcelLookupPointFromGeometry(state.parcelGeometry) || quoteFormLatLng();
    if (!isLngLatInArkansas(validationPoint)) {
      showArkansasOnlyPropertyBlock({ toast: { force: true } });
      quoteFlowTimeEnd(timer, 'continue to draw click', { blocked: 'outside-arkansas' });
      return;
    }
    showQuoteFlowStep('draw');
    quoteFlowTimeEnd(timer, 'continue to draw click');
  });

  // Find address by typing
  byId('locateAddressBtn')?.addEventListener('click', async () => {
    const timer = quoteFlowTimeStart('find property click');
    byId('gpsConfirmBar')?.classList.add('hidden');
    setAddressLookupLoading(true);
    try {
      const located = await geocodeAddress();
      if (located === false) return;
      setAddressLookupLoading(true, 'Checking parcel...');
      await lookupParcel({ source: 'manual-search' });
    } catch (error) {
      showError(prettyApiError(error));
    } finally {
      setAddressLookupLoading(false);
      quoteFlowTimeEnd(timer, 'find property click');
    }
  });

  // Search again / change property
  byId('lookupParcelBtn')?.addEventListener('click', () => {
    byId('gpsConfirmBar')?.classList.add('hidden');
    if (typeof clearCheckoutPii === 'function') clearCheckoutPii({ reason: 'search-again', clearAddress: false });
    resetParcelQuoteStateForNewAddress();
    showPropertyConfirmationPanel(false);
    showQuoteFlowStep('property');
    byId('quoteForm')?.elements?.address?.focus?.();
  });

  // Use Current Location buttons
  $$('[data-use-current-location]').forEach((btn) => btn.addEventListener('click', requestCurrentLocation));

  // GPS confirm bar — Yes: proceed to draw
  byId('gpsConfirmYesBtn')?.addEventListener('click', () => {
    const point = quoteFormLatLng();
    if (!isLngLatInArkansas(point)) {
      setGpsStatus(ARKANSAS_ONLY_MESSAGE);
      showArkansasOnlyPropertyBlock({ showPanel: false, toast: { force: true } });
      return;
    }
    byId('gpsConfirmBar')?.classList.add('hidden');
    showQuoteFlowStep('draw');
  });

  // GPS confirm bar — No: discard GPS parcel and return to property search
  byId('gpsConfirmNoBtn')?.addEventListener('click', () => {
    byId('gpsConfirmBar')?.classList.add('hidden');
    clearParcelLayer();
    clearMowLayer();
    byId('gpsStatusMsg')?.classList.add('hidden');
    showPropertyConfirmationPanel(false);
    showQuoteFlowStep('property');
  });
}

// Expose globally — called from app.js (autocomplete, confirmParcelSelection, init, clearQuoteDraftBtn)
window.lookupParcel = lookupParcel;
window.lookupParcelInFlight = () => lookupInFlight;
window.showPropertyConfirmationPanel = showPropertyConfirmationPanel;
window.renderConfirmProperty = renderConfirmProperty;
window.quoteFormLatLng = quoteFormLatLng;
window.fillMissingServiceAddressFromReverseGeocode = fillMissingServiceAddressFromReverseGeocode;
window.parcelLookupPointFromGeometry = parcelLookupPointFromGeometry;
