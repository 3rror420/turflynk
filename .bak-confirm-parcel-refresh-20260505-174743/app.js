

// Parcel confirmation state machine — toggles between search and confirm panels

function _getMapStage() {
  return document.querySelector('.map-stage');
}

function _moveMapToConfirmPanel() {
  const ms = _getMapStage();
  const parcelInfo = document.getElementById('parcelInfo');
  if (ms && parcelInfo && !ms.closest('#parcel-confirm-panel')) {
    parcelInfo.insertAdjacentElement('afterend', ms);
  }
}

function _moveMapToDrawScreen() {
  const ms = _getMapStage();
  const helper = document.getElementById('mowAreaHelper');
  if (ms && helper && ms !== helper.nextElementSibling) {
    helper.insertAdjacentElement('afterend', ms);
  }
}

function showSearch() {
  const s = document.getElementById('quoteStartScreen');
  if (s) { s.classList.add('is-searching'); s.classList.remove('is-confirming'); }
}
function _enableConfirmMapGestures() {
  const m = state.map;
  if (!m) return;
  try { m.dragPan?.enable(); } catch {}
  try { m.scrollZoom?.enable(); } catch {}
  try { m.touchZoomRotate?.enable(); } catch {}
  try { m.doubleClickZoom?.enable(); } catch {}
  setTimeout(function() { try { m.resize?.(); } catch {} }, 50);
}

function showConfirm() {
  const s = document.getElementById('quoteStartScreen');
  if (s) { s.classList.remove('is-searching'); s.classList.add('is-confirming'); }
  _moveMapToConfirmPanel();
  _enableConfirmMapGestures();
}
function setParcelUiState(state) {
  const el = document.getElementById('quoteStartScreen');
  if (!el) return;
  el.classList.toggle('is-searching', state === 'search');
  el.classList.toggle('is-confirming', state === 'confirm');
}

window.setParcelUiState = setParcelUiState;

// Bridge property-lookup.js's showPropertyConfirmationPanel calls into the state machine.
// property-lookup.js exports this to window; we override it after it loads.
window.showPropertyConfirmationPanel = function(visible) {
  if (visible === undefined) visible = true;
  if (visible) showConfirm(); else showSearch();
};

// Ensure map-stage moves to the right container on step transitions.
(function() {
  var _origStep = window.showQuoteFlowStep;
  window.showQuoteFlowStep = function(step, opts) {
    if (step === 'draw') _moveMapToDrawScreen();
    var result = _origStep && _origStep(step, opts);
    // When returning to the property step while confirm panel is showing,
    // move the map back and re-enable gestures (setMapGestureCapture(false)
    // was just called by showQuoteFlowStep for non-draw steps).
    var normalized = (step === 'start' || step === 'parcel') ? 'property' : step;
    if (normalized === 'property') {
      var s = document.getElementById('quoteStartScreen');
      if (s && s.classList.contains('is-confirming')) {
        _moveMapToConfirmPanel();
        _enableConfirmMapGestures();
      }
    }
    return result;
  };
})();

// byId, $$, all constants (QUOTE_DRAFT_KEY, EPSG*, SERVICE_CATALOG, etc.)
// are now defined in public/js/config.js and public/js/utils/dom.js — loaded before this file.

// api() → public/js/core/api.js
// setAuthToken, getAuthToken, hasActiveSession → public/js/auth/auth-ui.js

// ACCOUNT_SECTIONS → moved to account-panel.js

// isAdmin, showAdminControls, hideAdminControls → public/js/auth/admin-visibility.js
// getCurrentUser, accountDisplayName, accountAvatarUrl, accountInitials,
// renderAvatarElement, updateAccountAvatar → public/js/auth/auth-ui.js

// prettyApiError() → public/js/core/api.js

// phoneDigits → moved to checkout-request.js
// isValidLookingPhone → moved to checkout-request.js
// bookingPhoneValue → moved to checkout-request.js
// focusBookingPhoneField → moved to checkout-request.js
// showPhoneRequiredError → moved to checkout-request.js

function rememberProfilePhoneIfBlank(phone) {
  const trimmed = String(phone || '').trim();
  if (!trimmed || !state.currentUser || String(state.currentUser.phone || '').trim()) return;
  state.currentUser = { ...state.currentUser, phone: trimmed };
  hydrateLeadFormFromUser(state.currentUser);
}

// updateSessionStatus, accountUser, renderAccountUserInfo → public/js/auth/auth-ui.js

// hideAllPanels, showAccountPanel, renderAccountMenu, accountEmptyMessage, renderAccountSection
// → moved to account-panel.js

// loadMyQuotes → public/js/jobs/jobs-ui.js

// getUserDisplayName, hydrateLeadFormFromUser → public/js/auth/auth-ui.js

function getCheckoutAddressFieldElements() {
  const form = byId('leadRequestForm');
  return {
    addressEl: byId('leadAddress') || form?.elements?.address || null,
    cityEl: byId('leadCity') || form?.elements?.city || null,
    stateEl: byId('leadState') || form?.elements?.state || null,
    zipEl: byId('leadZip') || form?.elements?.zip || null,
  };
}

// propText, propTextByNormalizedKeys, propTextByAddressIntent,
// parcelAddressFieldCandidates, parcelFullAddressFromProps, parcelStructuredAddressFromProps,
// sameLeadingStreetNumber, parseFullServiceAddress → moved to parcel-utils.js

function resolveServiceAddressFromParcel(props = {}, fallbackAddress = '') {
  console.log('[PARCEL PROPS FULL]', props);
  console.log('[PARCEL PROPS ADDRESS KEYS]', parcelAddressFieldCandidates(props));

  const fallbackParts = typeof fallbackAddress === 'string'
    ? parseFullServiceAddress(fallbackAddress)
    : normalizeServiceAddressParts(fallbackAddress || {});
  const structured = parcelStructuredAddressFromProps(props);
  const parcelStreet = firstTextValue(structured.street, structured.address, parcelFullAddressFromProps(props));
  const fallbackStreet = firstTextValue(fallbackParts.street, fallbackParts.address);
  const street = sameLeadingStreetNumber(parcelStreet, fallbackStreet)
    ? fallbackStreet
    : firstTextValue(parcelStreet, fallbackStreet);

  let parsed = { city: '', state: '', zip: '' };
  if (parcelStreet) {
    parsed = parseCityStateZipFromAddress(parcelStreet);
  }

  const city = firstTextValue(structured.city, parsed.city, fallbackParts.city);
  const stateValue = firstTextValue(structured.state, parsed.state, fallbackParts.state, 'AR');
  const zip = firstTextValue(structured.zip, parsed.zip, fallbackParts.zip);
  const full = [street, city, [stateValue, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  console.log('[Service Address RESOLVED]', {
    adrlabel: parcelStreet,
    structured,
    parsed,
    final: { city, state: stateValue, zip }
  });

  return {
    street,
    address: street,
    city,
    state: stateValue,
    zip,
    full: full || parcelStreet,
    source: 'parcel-resolver'
  };
}

// parcelPropertiesFromLookupData → moved to parcel-utils.js

function checkoutParcelProps() {
  const candidates = [
    state.selectedParcelProperties,
    state.parcelProperties,
    state.parcelFeature?.properties,
    state.selectedParcel?.properties,
    state.pendingParcelFeature?.normalized?.attributes,
    state.pendingParcelFeature?.feature?.attributes,
    state.pendingParcelFeature?.properties,
  ];
  return candidates.find((props) => {
    if (!props || typeof props !== 'object') return false;
    return [
      parcelFullAddressFromProps(props),
      propText(props, 'adrcity', 'city', 'situscity', 'propertycity'),
      propText(props, 'adrzip5', 'adrzip', 'zip', 'zipcode', 'postalCode', 'postal_code'),
    ].some((value) => String(value || '').trim());
  }) || {};
}

// firstTextValue, addressPartsFromParcelProps, addressPartsFromQuote,
// mergeAddressResolution → moved to parcel-utils.js

function resolveCheckoutAddressSource(quote = {}) {
  const quoteParcelProps = quote.parcelProperties || quote.selectedParcelProperties || {};
  const parcelFeatureProps = state.parcelFeature?.properties || {};
  const selectedParcelProps = state.selectedParcel?.properties || state.selectedParcelProperties || {};
  const pendingQuote = state.pendingQuote || {};
  const props =
    quote.parcelProperties ||
    state.parcelFeature?.properties ||
    state.selectedParcel?.properties ||
    {};
  const parcelFeatureRaw = parcelFullAddressFromProps(parcelFeatureProps);
  const selectedRaw = parcelFullAddressFromProps(selectedParcelProps);
  const target = {
    parts: { address: '', city: '', state: '', zip: '' },
    addressSource: '',
    citySource: '',
    stateSource: '',
    zipSource: '',
    rawAddress: '',
    parsed: {},
    parcelProps: quoteParcelProps || parcelFeatureProps || selectedParcelProps || {},
  };

  const adrlabel = firstTextValue(
    quote.parcelAddressLabel,
    props?.adrlabel,
    props?.full_address,
    props?.site_address,
    parcelFullAddressFromProps(props),
    parcelFullAddressFromProps(quoteParcelProps),
    parcelFeatureRaw,
    selectedRaw
  );
  let parsedParcelLabel = { city: '', state: '', zip: '' };
  const missingParcelCity = !firstTextValue(quote.parcelCity);
  const missingParcelZip = !firstTextValue(quote.parcelZip);
  if (adrlabel && (missingParcelCity || missingParcelZip)) {
    const parsed = parseCityStateZipFromAddress(adrlabel);
    parsedParcelLabel = { city: parsed.city || '', state: parsed.state || '', zip: parsed.zip || '' };
  }
  const quoteParcelRaw = adrlabel;
  const parsedQuoteParcelRaw = parseFullServiceAddress(quoteParcelRaw);
  const propsParts = addressPartsFromParcelProps(props);
  const parcelFeatureParts = addressPartsFromParcelProps(parcelFeatureProps);
  const selectedParcelParts = addressPartsFromParcelProps(selectedParcelProps);
  const parcelFieldParts = {
    address: firstTextValue(propsParts.address, parsedQuoteParcelRaw.address, quoteParcelRaw),
    city: firstTextValue(quote.parcelCity, propsParts.city, parcelFeatureParts.city, selectedParcelParts.city, parsedParcelLabel.city),
    state: firstTextValue(quote.parcelState, propsParts.state, parcelFeatureParts.state, selectedParcelParts.state, parsedParcelLabel.state),
    zip: firstTextValue(quote.parcelZip, propsParts.zip, parcelFeatureParts.zip, selectedParcelParts.zip, parsedParcelLabel.zip),
  };
  console.log('[FINAL PARCEL RESOLVE]', {
    adrlabel,
    parsed: parsedParcelLabel,
    final: { city: parcelFieldParts.city, state: parcelFieldParts.state, zip: parcelFieldParts.zip },
  });
  mergeAddressResolution(target, {
    source: 'quote.parcelFields',
    rawAddress: quoteParcelRaw,
    parsed: parsedParcelLabel,
    parcelProps: props,
    parts: parcelFieldParts,
  });

  const parsedQuoteLabel = parseFullServiceAddress(quoteParcelRaw);
  mergeAddressResolution(target, {
    source: 'quote.parcelAddressLabel',
    rawAddress: quoteParcelRaw,
    parsed: parsedQuoteLabel,
    parcelProps: quoteParcelProps,
    parts: parsedQuoteLabel,
  });

  const parsedFeatureLabel = parseFullServiceAddress(parcelFeatureRaw);
  mergeAddressResolution(target, {
    source: 'state.parcelFeature.properties.adrlabel',
    rawAddress: parcelFeatureRaw,
    parsed: parsedFeatureLabel,
    parcelProps: parcelFeatureProps,
    parts: parsedFeatureLabel,
  });

  mergeAddressResolution(target, {
    source: 'state.parcelFeature.properties',
    rawAddress: parcelFeatureRaw,
    parsed: parsedFeatureLabel,
    parcelProps: parcelFeatureProps,
    parts: addressPartsFromParcelProps(parcelFeatureProps),
  });

  const parsedSelected = parseFullServiceAddress(selectedRaw);
  mergeAddressResolution(target, {
    source: 'state.selectedParcel.properties',
    rawAddress: selectedRaw,
    parsed: parsedSelected,
    parcelProps: selectedParcelProps,
    parts: addressPartsFromParcelProps(selectedParcelProps),
  });

  const currentRaw = firstTextValue(state.currentServiceAddress?.address);
  const parsedCurrent = parseFullServiceAddress(currentRaw);
  mergeAddressResolution(target, {
    source: 'state.currentServiceAddress',
    rawAddress: currentRaw,
    parsed: parsedCurrent,
    parcelProps: target.parcelProps,
    parts: state.currentServiceAddress || {},
  });

  const quoteRaw = firstTextValue(quote.address, quote.serviceAddress, quote.customerAddress);
  const parsedQuote = parseFullServiceAddress(quoteRaw);
  mergeAddressResolution(target, {
    source: 'quote.addressFields',
    rawAddress: quoteRaw,
    parsed: parsedQuote,
    parcelProps: target.parcelProps,
    parts: {
      address: quoteRaw,
      city: firstTextValue(quote.city, quote.serviceCity, quote.customerCity, parsedQuote.city),
      state: firstTextValue(quote.state, quote.serviceState, quote.customerState, parsedQuote.state),
      zip: firstTextValue(quote.zip, quote.serviceZip, quote.customerZip, parsedQuote.zip),
    },
  });

  const pendingRaw = firstTextValue(pendingQuote.address, pendingQuote.serviceAddress);
  const parsedPending = parseFullServiceAddress(pendingRaw);
  mergeAddressResolution(target, {
    source: 'pendingQuote',
    rawAddress: pendingRaw,
    parsed: parsedPending,
    parcelProps: target.parcelProps,
    parts: {
      address: pendingRaw,
      city: firstTextValue(pendingQuote.city, pendingQuote.serviceCity, parsedPending.city),
      state: firstTextValue(pendingQuote.state, pendingQuote.serviceState, parsedPending.state),
      zip: firstTextValue(pendingQuote.zip, pendingQuote.serviceZip, parsedPending.zip),
    },
  });

  target.parts = normalizeServiceAddressParts(target.parts);
  const cityZipSource = target.citySource || target.zipSource;
  const source = cityZipSource || (target.addressSource === 'pendingQuote' ? 'pendingQuote-address-only' : target.addressSource || 'none');
  return {
    source,
    rawAddress: target.rawAddress || quoteParcelRaw || parcelFeatureRaw || selectedRaw || currentRaw || quoteRaw || pendingRaw,
    parsed: target.parsed || {},
    parcelProps: target.parcelProps || {},
    parts: target.parts,
  };
}

function fillBlankCheckoutAddressParts(elements, parts) {
  // Deprecated no-op. applyServiceAddressToLeadForm() is the single lead address writer.
}

function hydrateCheckoutAddressFieldsFromQuote(quote) {
  // Deprecated: keep for older callers, but do not write lead address fields here.
  // The single writer is applyServiceAddressToLeadForm().
  const resolvedSource = resolveCheckoutAddressSource(quote || {});
  const resolved = resolvedSource.parts;

  console.log('[Checkout Address Source]', {
    source: resolvedSource.source,
    rawAddress: resolvedSource.rawAddress,
    parsed: resolvedSource.parsed,
    parcelProps: resolvedSource.parcelProps,
  });

  if (resolved.address || resolved.city || resolved.zip) {
    setCurrentServiceAddress(resolved, 'deprecated-checkout-hydrate');
  }

  console.log('[Checkout Address Hydrate]', {
    currentServiceAddress: state.currentServiceAddress,
    quote,
    parcelProps: state.parcelFeature?.properties || state.selectedParcel?.properties,
  });
}

function hydrateLeadFormFromQuoteContext(quote) {
  if (!quote) return;

  // Deprecated: keep for older callers, but do not write lead address fields here.
  // The single writer is applyServiceAddressToLeadForm().
  // Robust selectors — falls back through known IDs then name attributes
  const cityEl =
    document.getElementById('leadCity') ||
    document.getElementById('customerCity') ||
    document.querySelector('[name="city"]') ||
    document.querySelector('[name="customerCity"]');
  const stateEl =
    document.getElementById('leadState') ||
    document.getElementById('customerState') ||
    document.querySelector('[name="state"]') ||
    document.querySelector('[name="customerState"]');
  const zipEl =
    document.getElementById('leadZip') ||
    document.getElementById('customerZip') ||
    document.querySelector('[name="zip"]') ||
    document.querySelector('[name="postalCode"]') ||
    document.querySelector('[name="customerZip"]');
  const addressEl =
    document.getElementById('leadAddress') ||
    document.querySelector('[name="address"]');

  // If none of the target fields exist, the form isn't in the DOM yet; bail silently.
  if (!addressEl && !cityEl && !stateEl && !zipEl) return;

  const resolvedSource = resolveCheckoutAddressSource(quote || {});
  const src = resolvedSource.parts;
  const source = resolvedSource.source;

  console.log('[Quote Hydrate Debug]', {
    fieldIds: { city: cityEl?.id, state: stateEl?.id, zip: zipEl?.id, address: addressEl?.id },
    fieldNames: { city: cityEl?.name, state: stateEl?.name, zip: zipEl?.name, address: addressEl?.name },
    quote,
    currentServiceAddress: state.currentServiceAddress,
    parcelProps: state.parcelFeature?.properties || state.selectedParcel?.properties,
    addressInput: document.getElementById('addressInput')?.value,
  });
  console.log('[Checkout Address Source]', {
    source,
    rawAddress: resolvedSource.rawAddress,
    parsed: resolvedSource.parsed,
    parcelProps: resolvedSource.parcelProps,
  });

  if (src.address || src.city || src.zip) setCurrentServiceAddress(src, 'deprecated-quote-context');

  console.info('[Quote Hydrate] resolved city=' + (src.city || '(empty)') + ' state=' + src.state + ' zip=' + (src.zip || '(empty)') + ' source=' + source);
}

// clearFrontendSessionState, signOut → public/js/auth/auth-ui.js

// money() → public/js/utils/dom.js

const ESTIMATE_DEBOUNCE_MS = 350;
// AUTH_RETURN_KEY → public/js/auth/auth-ui.js
let estimateRefreshTimer = null;
let estimateRequestSeq = 0;

// formToObject, checkedValues, selectedServiceMeta → moved to quote-flow.js

function aiPhotoPlaceholder(overrides = {}) {
  return { ...AI_PHOTO_PLACEHOLDER, ...overrides };
}

function buildQuotePayload(form) {
  const payload = formToObject(form);
  const _formMowArea = Number(payload.mowAreaSqft || 0);
  const drawnMowAreaSqft = currentDrawnMowAreaSqFt();
  const _dbgLot = Number(form?.elements?.lotAreaSqft?.value || 0);
  const _dbgLayers = getMowableFeatureCount();
  const _pct = _dbgLot > 0 ? Math.round((drawnMowAreaSqft / _dbgLot) * 100) : null;
  const _mismatch = _formMowArea > 0 && Math.abs(_formMowArea - drawnMowAreaSqft) > 50;
  console.log('[TurfLynk Area Trace] C. buildQuotePayload | formField=' + _formMowArea + ' drawGroup=' + drawnMowAreaSqft + ' lotAreaSqft=' + _dbgLot + (_pct !== null ? ' (' + _pct + '% of parcel)' : '') + ' layers=' + _dbgLayers + (_mismatch ? ' ⚠ MISMATCH' : '') + ' source=' + (drawnMowAreaSqft > 0 ? 'drawGroup' : 'none(no polygon)'));
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
  const parcelProps = checkoutParcelProps();
  const parcelParts = addressPartsFromParcelProps(parcelProps);
  const parcelAddressLabel = parcelFullAddressFromProps(parcelProps);
  if (Object.keys(parcelProps).length) {
    const serviceAddress = resolveServiceAddressFromParcel(parcelProps, getQuoteFormServiceAddress());
    if (hasServiceAddress(serviceAddress)) setCurrentServiceAddress(serviceAddress, 'build-quote-payload');
    payload.parcelAddressLabel = parcelAddressLabel;
    payload.parcelCity = parcelParts.city || '';
    payload.parcelState = parcelParts.state || 'AR';
    payload.parcelZip = parcelParts.zip || '';
    payload.parcelProperties = parcelProps;
    payload.selectedParcelProperties = parcelProps;
  }
  const serviceAddress = getCurrentServiceAddress(payload);
  if (hasServiceAddress(serviceAddress)) {
    setCurrentServiceAddress(serviceAddress, 'build-quote-payload-final');
    payload.street = state.currentServiceAddress.street || state.currentServiceAddress.address || '';
    payload.address = state.currentServiceAddress.street || state.currentServiceAddress.address || payload.address || '';
    payload.city = state.currentServiceAddress.city || payload.city || '';
    payload.state = state.currentServiceAddress.state || payload.state || 'AR';
    payload.zip = state.currentServiceAddress.zip || payload.zip || '';
    payload.full = state.currentServiceAddress.full || payload.full || '';
  }
  return payload;
}

// buildAccessSummary, buildScheduleSummary, equipmentRecommendation,
// availableDayCheckboxes, serviceTaskCheckboxes, fillForm, multiSelectValues → moved to quote-flow.js

// showResult, showToast, showSuccess/Error/Warning/Info, card, escapeHtml → public/js/utils/dom.js

// renderJobPhotoPreview → moved to jobs-ui.js

// normalizeQuoteStep, quoteStepNumber, showQuoteFlowStep, updateQuoteStepper, updateQuoteFlowState
// → public/js/quote/quote-flow.js

// setMapGestureCapture, MAP_MODES, setMapMode, getMapMode → public/js/map/map-core.js
// SATELLITE_TILE_URL, SATELLITE_TILE_ATTRIBUTION, EMPTY_FEATURE_COLLECTION, MAP_SOURCES → public/js/map/map-core.js
// latLngToLngLat, cloneFeatureCollection, cloneGeoJson, currentParcelGeoJSON, currentMapScopeSnapshot → public/js/map/map-core.js

function currentJobScopeSnapshotFields() {
  return {
    parcelGeoJSON: currentParcelGeoJSON(),
    selectedMowableGeoJSON: cloneFeatureCollection(state.mowableFeatureCollection),
    mowableGeoJSON: cloneFeatureCollection(state.mowableFeatureCollection),
    excludedGeoJSON: state.aiCutoutFeatureCollection?.features?.length
      ? cloneFeatureCollection(state.aiCutoutFeatureCollection)
      : null,
    ...currentMapScopeSnapshot(),
  };
}

function asFeature(featureOrGeometry, properties = {}) {
  if (!featureOrGeometry) return null;
  if (featureOrGeometry.type === 'Feature') {
    return {
      ...featureOrGeometry,
      properties: { ...(featureOrGeometry.properties || {}), ...properties },
    };
  }
  if (featureOrGeometry.type && featureOrGeometry.coordinates) {
    return { type: 'Feature', properties, geometry: featureOrGeometry };
  }
  return null;
}

// setSourceData, setPointSource, updateParcelSource, updateCutoutSource,
// updateBuildingFootprintSource, updatePreviewParcelSource, setLassoTempLine,
// ensureMapLayer, ensureMapLibreSourcesAndLayers, withMapReady → public/js/map/map-core.js

// updateMowableSource → public/js/map/mow-editor.js (Phase 12e)

// normalizeRegion, normalizeService, regionLabel, serviceLabel, fillSelect → moved to core/dom.js

// saveQuoteDraft → moved to quote-draft.js

// saveAuthReturnContext, loadAuthReturnContext, clearAuthReturnContext,
// isMobileFacebookLoginFlow, facebookAuthStartPath, authReturnStep,
// startFacebookLogin, beginSocialAuth, applySocialLoginVisibility → public/js/auth/auth-ui.js

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

// loadQuoteDraft, clearQuoteDraft → moved to quote-draft.js

// setEditorModeLabel → public/js/map/mow-editor.js

function placeMarker(lat, lng) {
  if (!state.map) return;
  state.marker = { lat: Number(lat), lng: Number(lng) };
  withMapReady(() => setPointSource(MAP_SOURCES.addressMarker, lng, lat));
  state.map.flyTo({ center: [Number(lng), Number(lat)], zoom: 15, essential: true });
  setTimeout(() => state.map?.resize?.(), 100);
}

function placeCurrentLocationMarker(lat, lng) {
  if (!state.map) return;
  state.gpsMarker = { lat: Number(lat), lng: Number(lng) };
  withMapReady(() => setPointSource(MAP_SOURCES.gpsMarker, lng, lat));
  state.map.flyTo({ center: [Number(lng), Number(lat)], zoom: Math.max(state.map.getZoom() || 15, 17), essential: true });
  setTimeout(() => state.map?.resize?.(), 100);
}

function setLatLng(lat, lng) {
  const form = byId('quoteForm');
  if (!form) return;
  form.elements.lat.value = Number(lat).toFixed(6);
  form.elements.lng.value = Number(lng).toFixed(6);
  saveQuoteDraft();
}

// normalizeServiceAddressParts, parseCityStateZipFromAddress,
// hasServiceAddress, serviceAddressBlocksFallback → moved to parcel-utils.js

function getQuoteFormServiceAddress() {
  const form = byId('quoteForm');
  if (!form) return normalizeServiceAddressParts();
  return normalizeServiceAddressParts({
    street: form.elements.address?.value || '',
    address: form.elements.address?.value || '',
    city: form.elements.city?.value || '',
    state: form.elements.state?.value || 'AR',
    zip: form.elements.zip?.value || '',
  });
}

// parcelAddressFromNormalized → moved to parcel-utils.js

function applyServiceAddressToQuoteForm(address, options = {}) {
  const form = byId('quoteForm');
  if (!form) return;
  const next = normalizeServiceAddressParts(address);
  const clearMissing = Boolean(options.clearMissing);
  ['address', 'city', 'state', 'zip'].forEach((name) => {
    const field = form.elements[name];
    if (!field) return;
    if (next[name] || clearMissing || name === 'state') field.value = next[name] || (name === 'state' ? 'AR' : '');
  });
}

function clearStaleServiceAddressFields() {
  // Deprecated: do not clear lead address fields. currentServiceAddress is the source of truth.
  const liveBidForm = byId('liveBidForm');
  if (liveBidForm) {
    ['address', 'city', 'state', 'zip'].forEach((name) => {
      const field = liveBidForm.elements[name];
      if (!field) return;
      field.value = name === 'state' ? 'AR' : '';
    });
  }
}

function setCurrentServiceAddress(address, source = 'unknown', options = {}) {
  const next = normalizeServiceAddressParts(address);
  const incoming = Object.fromEntries(
    Object.entries({
      street: next.street,
      address: next.street,
      city: next.city,
      state: next.state,
      zip: next.zip,
      full: next.full,
    }).filter(([, value]) => value)
  );
  const hasIncoming = Object.keys(incoming).some((key) => key !== 'state' || incoming[key] !== 'AR');
  if (!hasIncoming && ['quote-reset', 'address-reset', 'gps-location'].includes(source)) {
    state.currentServiceAddress = { street: '', address: '', city: '', state: 'AR', zip: '', full: '', source, updatedAt: Date.now() };
  } else {
    const baseAddress = options.replace
      ? { street: '', address: '', city: '', state: 'AR', zip: '', full: '' }
      : (state.currentServiceAddress || {});
    state.currentServiceAddress = {
      ...baseAddress,
      ...incoming,
      source,
      updatedAt: Date.now(),
    };
  }
  console.log('[Service Address] set', source, state.currentServiceAddress);
  if (options.syncQuoteForm) {
    applyServiceAddressToQuoteForm(state.currentServiceAddress, { clearMissing: options.clearQuoteFormMissing });
  }
  return normalizeServiceAddressParts(state.currentServiceAddress);
}

function getCurrentServiceAddress(fallback = {}) {
  const current = normalizeServiceAddressParts(state.currentServiceAddress || {});
  if (hasServiceAddress(current)) return current;
  if (serviceAddressBlocksFallback(state.currentServiceAddress || {})) return current;

  const formAddress = getQuoteFormServiceAddress();
  if (hasServiceAddress(formAddress)) return formAddress;

  return normalizeServiceAddressParts(fallback);
}

function syncServiceAddressFields(fallback = {}) {
  // Deprecated: this used to write lead address fields directly.
  // Keep it as a state resolver only; applyServiceAddressToLeadForm() is the single writer.
  const next = getCurrentServiceAddress(fallback);
  if (hasServiceAddress(next)) setCurrentServiceAddress(next, 'deprecated-sync-service-address');
  const liveBidForm = byId('liveBidForm');
  if (liveBidForm) {
    ['address', 'city', 'state', 'zip'].forEach((name) => {
      const field = liveBidForm.elements[name];
      if (!field) return;
      if (next[name]) {
        field.value = next[name];
      } else if (name === 'state' && !field.value) {
        field.value = 'AR';
      }
    });
  }
  return next;
}

function applyServiceAddressToLeadForm(address = state.currentServiceAddress) {
  const next = normalizeServiceAddressParts(address || {});
  const addressEl = document.getElementById('leadAddress');
  const cityEl = document.getElementById('leadCity');
  const stateEl = document.getElementById('leadState');
  const zipEl = document.getElementById('leadZip');

  if (addressEl && next.street) addressEl.value = next.street;
  if (cityEl && next.city) cityEl.value = next.city;
  if (stateEl && next.state) stateEl.value = next.state;
  if (zipEl && next.zip) zipEl.value = next.zip;

  console.log('[Service Address] applied to lead form', {
    address: addressEl?.value,
    city: cityEl?.value,
    state: stateEl?.value,
    zip: zipEl?.value
  });
}

// snapshotMowLayersForUndo → public/js/map/mow-editor.js (Phase 12d)

// restoreMowLayersFromSnapshot → public/js/map/mow-editor.js (Phase 12d)

// undoLastCut → public/js/map/mow-editor.js (Phase 12d)

function clearParcelLayer() {
  state.parcelFeature = null;
  state.parcelLayer = null;
  state.parcelProperties = null;
  state.selectedParcel = null;
  state.selectedParcelProperties = null;
  state.buildingFootprintFeatureCollection = EMPTY_FEATURE_COLLECTION();
  updateParcelSource();
  updateBuildingFootprintSource();
  state.parcelLayer = null;
  state.parcelGeometry = null;
  state.mowableEstimate = null;
  renderSuggestedMowablePanel(null);
}

// setMowableFeatures  → public/js/map/mow-editor.js (Phase 12e)
// clearMowableFeatures → public/js/map/mow-editor.js (Phase 12e)

function setCutoutFeatures(features = []) {
  state.aiCutoutFeatureCollection = {
    type: 'FeatureCollection',
    features: features.map((feature, index) => {
      const normalized = asFeature(feature);
      if (!normalized) return null;
      return {
        ...normalized,
        id: normalized.id || `cutout-${index}-${Date.now()}`,
        properties: {
          ...(normalized.properties || {}),
          role: 'cutout',
        },
      };
    }).filter((feature) => feature?.geometry),
  };
  state.aiCutoutGroup = state.aiCutoutFeatureCollection;
  updateCutoutSource();
}

function clearCutoutFeatures() {
  setCutoutFeatures([]);
}

// getMowableFeatureCount, mowableFeatureId, markSelectedMowableFeature,
// selectMowableFeature, removeSelectedMowableFeature, getCutoutFeatureCount
//   → public/js/map/mow-editor.js

// geometryLooksProjected, ringToLngLatCoords, closeRing,
// esriPolygonToGeoJSONFeature, esriPolygonToLatLngPairs → moved to parcel-utils.js

// exposeTurfLynkMapGlobals → public/js/map/map-core.js

function exposeCurrentParcelGeometryForAi() {
  // Convert Arkansas GIS ESRI rings into normal GeoJSON Polygon geometry.
  // /api/ai/detect-grass expects GeoJSON lon/lat coordinates.
  try {
    const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
    if (!parcelRings.length) return null;
    const geoJsonGeometry = esriPolygonToGeoJSONFeature(state.parcelGeometry)?.geometry;
    if (!geoJsonGeometry) return null;
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
    scheduleEstimateRefresh('ai-area');
  };
}

// reorderMapOverlays, fitBoundsWithContext, fitLayerBoundsWithContext, refreshMapAfterStepVisible → public/js/map/map-core.js

function drawParcel(geometry, properties = {}) {
  if (!state.map || !geometry) return;
  const feature = esriPolygonToGeoJSONFeature(geometry, { ...properties, role: 'parcel' });
  if (!feature) {
    console.warn("drawParcel: invalid rings", geometry);
    return;
  }
  // ESRI rings use CW exterior; GeoJSON / MapLibre require CCW exterior.
  // Without this rewind, MapLibre renders the complement (world minus parcel)
  // and turf.intersect gives wrong results.
  try { if (typeof turf !== 'undefined') turf.rewind(feature, { mutate: true }); } catch {}

  state.parcelGeometry = geometry;
  state.parcelFeature = feature;
  state.parcelLayer = feature;
  state.parcelProperties = feature.properties || properties || {};
  state.selectedParcel = feature;
  state.selectedParcelProperties = feature.properties || properties || {};

  withMapReady(() => {
    updateParcelSource();
    fitLayerBoundsWithContext(feature);
    reorderMapOverlays();
    requestAnimationFrame(() => state.map?.resize?.());
  });
}

// formatSqft, sqftToAcres, formatAcres, SQFT_PER_ACRE → public/js/utils/dom.js

// refreshAreaDisplays → public/js/map/mow-editor.js

// getBuildingFootprintsForParcel, calculateBuildingFootprintSqft, fallbackMowableRatio,
// calculateAutoMowableEstimate, setFormEstimateFields, applySuggestedMowableArea,
// adjustYardOutlineFromSuggestion, renderSuggestedMowablePanel,
// drawBuildingFootprintHelpers, updateAutoMowableEstimateForParcel
// → moved to mowable-estimate.js
// styleMowLayer, eachLatLng, translateLayerLatLngs, attachMowableMoveHandlers,
// finishMowableMove, eventLatLng, installMowableMoveMapHandlers
//   → public/js/map/mow-editor.js (Phase 12e)

// layerAreaSqFt → public/js/map/mow-editor.js

// clearEditHandles → public/js/map/mow-editor.js
// getEditableRings → public/js/map/mow-editor.js
// getRingByPath → public/js/map/mow-editor.js
// buildEditHandles → public/js/map/mow-editor.js

// startEditAiCutouts → public/js/ai/ai-detect.js

// startCutMowable → public/js/map/mow-editor.js (Phase 12d)


// getAllMowLayers → public/js/map/mow-editor.js

// totalMowAreaSqFt → public/js/map/mow-editor.js

// currentDrawnMowAreaSqFt → public/js/map/mow-editor.js

// clearStaleMowAreaWithoutPolygon → public/js/map/mow-editor.js

// updateMowAreaHelper → public/js/map/mow-editor.js

// syncMowAreaFromLayers → public/js/map/mow-editor.js

function stopToolModes() {
  if (getMapMode() === 'lasso' && window.TurfLynkLassoYard?.cancel) {
    try { window.TurfLynkLassoYard.cancel(); } catch {}
  }

  finishMowableMove();
  clearEditHandles();

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
  if (getMapMode() !== 'select') setMapMode('idle');
  setEditorModeLabel('Mode: Ready');
  updateQuoteFlowState();
}
window.stopToolModes = stopToolModes;

function clearMowLayer() {
  stopToolModes();
  if (removeSelectedMowableFeature()) {
    setEditorModeLabel('Mode: Selected area cleared');
    showSuccess('Selected area cleared');
    return;
  }
  clearMowableFeatures();
  state.editSnapshot = null;

  const form = byId('quoteForm');
  if (form) {
    form.elements.mowAreaSqft.value = '';
    if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = '';
    if (form.elements.lotSource) form.elements.lotSource.value = '';
  }
  state.pendingQuote = null;

  updateMowAreaHelper(Number(form?.elements?.lotAreaSqft?.value || 0), 0);
  saveQuoteDraft();
  setEstimateState('empty', { signature: form ? estimateSignatureFromPayload(buildQuotePayload(form)) : '', payload: null });
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
}

function cloneParcelAsMowable(options = {}) {
  const starter = options?.starter === true;
  const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
  if (!parcelRings.length || !state.map) {
    showResult('parcelInfo', '<strong>No parcel shape yet.</strong><br>Lookup the parcel first.');
    return;
  }

  const feature = esriPolygonToGeoJSONFeature(state.parcelGeometry, { role: 'mowable' });
  if (!feature) return;
  if (typeof turf !== 'undefined' && feature) {
    const _featureArea = Math.round(turf.area(feature));
    const _parcelArea = state.mowableEstimate?.parcelAreaSqft
      ? Math.round(state.mowableEstimate.parcelAreaSqft * 0.0929)
      : _featureArea;
    console.warn(
      '[MowableSource] source=parcel' +
      '  featureArea=' + _featureArea + ' m²' +
      '  parcelArea=' + _parcelArea + ' m²' +
      '  ratio=' + (_parcelArea > 0 ? (_featureArea / _parcelArea).toFixed(2) : '?') +
      '  (intentional: user chose Use Parcel Shape)'
    );
  }
  setMowableFeatures([feature]);

  fitLayerBoundsWithContext(feature);

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
  }
  updateQuoteFlowState();
}

// hasActiveMowableArea, setElementVisible, setMapToolPanelOpen → public/js/map/mow-editor.js

// estimateSignatureFromPayload, currentEstimateSignature → moved to estimate.js

function setEstimateState(status, details = {}) {
  const next = {
    status,
    estimate: Number(details.estimate || 0),
    breakdown: Array.isArray(details.breakdown) ? details.breakdown : [],
    signature: details.signature || '',
    payload: details.payload || null,
    error: details.error || '',
    updatedAt: status === 'fresh' ? Date.now() : state.currentEstimate?.updatedAt || null,
  };
  state.currentEstimate = next;

  if (status !== 'fresh') {
    state.pendingQuote = null;
    state.lastQuote = null;
  }

  renderEstimateState();
  updateQuoteFlowState({ skipStepper: true });
  return next;
}

// renderEstimateState() → public/js/quote/estimate.js

async function refreshEstimate(options = {}) {
  const form = byId('quoteForm');
  if (!form) return null;

  const payload = buildQuotePayload(form);
  const signature = estimateSignatureFromPayload(payload);
  const current = state.currentEstimate;
  if (!options.force && current?.status === 'fresh' && current.signature === signature) {
    renderEstimateState();
    if (options.navigate) showQuoteFlowStep('estimate');
    return current;
  }

  if (Number(payload.mowAreaSqft || 0) <= 0) {
    setEstimateState('empty', { signature, payload });
    if (options.navigate) showMissingMowableAreaPrompt('quoteResult');
    return null;
  }

  const requestSeq = ++estimateRequestSeq;
  setEstimateState('updating', { signature, payload });

  try {
    const data = await api('/api/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (requestSeq !== estimateRequestSeq) return state.currentEstimate;

    const latestSignature = currentEstimateSignature();
    if (latestSignature !== signature) {
      scheduleEstimateRefresh('changed-during-refresh');
      return state.currentEstimate;
    }

    const freshPayload = { ...payload, ...currentJobScopeSnapshotFields(), estimate: data.estimate };
    state.pendingQuote = freshPayload;
    state.lastQuote = null;
    saveQuoteDraft();
    const estimateState = setEstimateState('fresh', {
      signature,
      payload: freshPayload,
      estimate: data.estimate,
      breakdown: Array.isArray(data.breakdown) ? data.breakdown : [],
    });
    if (options.navigate) showQuoteFlowStep('estimate');
    return estimateState;
  } catch (error) {
    if (requestSeq !== estimateRequestSeq) return state.currentEstimate;
    setEstimateState('error', {
      signature,
      payload,
      error: prettyApiError(error),
    });
    if (options.navigate) showQuoteFlowStep('estimate');
    throw error;
  }
}

function scheduleEstimateRefresh(reason = 'change', options = {}) {
  const form = byId('quoteForm');
  if (!form) return;
  const payload = buildQuotePayload(form);
  const signature = estimateSignatureFromPayload(payload);
  const current = state.currentEstimate;

  if (Number(payload.mowAreaSqft || 0) <= 0) {
    if (estimateRefreshTimer) clearTimeout(estimateRefreshTimer);
    setEstimateState('empty', { signature, payload });
    return;
  }

  if (!options.force && current?.status === 'fresh' && current.signature === signature) {
    renderEstimateState();
    return;
  }

  setEstimateState('updating', { signature, payload, reason });
  if (estimateRefreshTimer) clearTimeout(estimateRefreshTimer);
  const delay = options.immediate ? 0 : ESTIMATE_DEBOUNCE_MS;
  estimateRefreshTimer = setTimeout(() => {
    estimateRefreshTimer = null;
    refreshEstimate({ force: options.force }).catch((error) => {
      showError(prettyApiError(error));
    });
  }, delay);
}

function showMissingMowableAreaPrompt(targetId = 'quoteResult') {
  showResult(
    targetId,
    '<strong>Draw your mowable area first.</strong><br>The parcel outline is only a property boundary and is not priced as mowing area.'
  );
  showWarning('Draw your mowable area first.');
}

// setAiDetectMowableStatus, aiDetectFallbackMessage, aiDetectGrassDraft → public/js/ai/ai-detect.js

// geoJsonFeaturesFromValue, isPolygonalGeometry, mowableFeaturesFromAiResponse,
// sanitizeAiMowableFeatures, aiDetectMowableArea → public/js/ai/ai-detect.js

// startDrawMowable → public/js/map/mow-editor.js (Phase 12b)
// startEditMowable → public/js/map/mow-editor.js (Phase 12c)

// aiRefineMowableArea, applyAiCutouts → public/js/ai/ai-detect.js

// startDeleteMowable → public/js/map/mow-editor.js (Phase 12c)


// applyCutToMowable → public/js/map/mow-editor.js (Phase 12d)

// initMap → public/js/map/map-core.js

window.TurfLynkAppState = state;
// window.setTurfLynkMapMode / getTurfLynkMapMode → public/js/map/map-core.js
// window.exposeTurfLynkMapGlobals → public/js/map/map-core.js
// window.setTurfLynkLassoTempLine → public/js/map/map-core.js
// window.esriPolygonToLatLngPairs → exported from parcel-utils.js
// window.esriPolygonToGeoJSONFeature → exported from parcel-utils.js
window.exposeCurrentParcelGeometryForAi = exposeCurrentParcelGeometryForAi;
window.syncMowAreaFromLayers = syncMowAreaFromLayers;
// window.startEditMowable → exported from public/js/map/mow-editor.js (Phase 12c)
// window.startDeleteMowable → exported from public/js/map/mow-editor.js (Phase 12c)
// window.startCutMowable → exported from public/js/map/mow-editor.js (Phase 12d)
// window.undoLastCut → exported from public/js/map/mow-editor.js (Phase 12d)
// window.applyTurfLynkCutFeature → exported from public/js/map/mow-editor.js (Phase 12d)
// window.setTurfLynkMowableFeatures → exported from public/js/map/mow-editor.js (Phase 12e)
window.selectTurfLynkMowableFeature = selectMowableFeature;
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
    scheduleEstimateRefresh('service-change');
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
  if (instant && state.map) setTimeout(() => state.map.resize?.(), 120);
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
    const serviceAddress = getCurrentServiceAddress(q);
    ['address', 'city', 'state', 'zip'].forEach((name) => {
      if (form.elements[name]) form.elements[name].value = serviceAddress[name] || (name === 'state' ? 'AR' : '');
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
  byId('openAppDrawer')?.setAttribute('aria-expanded', 'false');
}

function openAppDrawer() {
  byId('appDrawer')?.classList.remove('hidden');
  byId('appDrawerOverlay')?.classList.remove('hidden');
  byId('openAppDrawer')?.setAttribute('aria-expanded', 'true');
}

function revealSecondarySectionForTarget(targetId) {
  const target = byId(targetId);
  const section = target?.closest?.('[data-secondary-home-section]');
  if (!section) return target;
  section.hidden = false;
  section.classList.remove('hidden');
  if (target && 'hidden' in target) target.hidden = false;
  return target;
}

function navigateFromElement(el) {
  const view = el?.dataset?.jumpView || el?.dataset?.drawerView || el?.dataset?.view;
  const providerSection = el?.dataset?.providerSection || '';
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
  if (providerSection) state.providerAreaSection = providerSection;
  if (view) setActiveView(view);
  if (providerSection && view === 'providers') renderProviderArea(providerSection);
  if (requestedFlow === 'instant_mow') {
    setServiceFlow('instant_mow');
    setQuoteService(requestedService);
  }
  if (requestedFlow === 'live_bid') {
    setServiceFlow('live_bid');
    hydrateLiveBidForm(requestedService);
  }
  if (el?.dataset?.scrollTarget) {
    const target = revealSecondarySectionForTarget(el.dataset.scrollTarget);
    setTimeout(() => target?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
  if (el?.hasAttribute?.('data-drawer-contact') || el?.hasAttribute?.('data-mobile-contact')) {
    openAppDrawer();
    setTimeout(() => byId('drawerContactPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    return;
  }
  closeAppDrawer();
}

function setActiveView(view) {
  byId('accountPanel')?.classList.add('hidden');
  state.activeView = view;
  document.body.dataset.activeView = view;

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
    setTimeout(() => state.map.resize?.(), 100);
    showQuoteFlowStep(state.quoteFlowStep || 'property', { scroll: false });
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
    if (state.currentUser?.role === 'provider' || state.currentUser?.role === 'admin') {
      renderProviderArea(state.providerAreaSection || 'dashboard');
    }
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

  // Logo home buttons: always return to dashboard and clean up open overlays/quote state.
  $$('[data-logo-home]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeAppDrawer();
      if (state.activeView === 'dashboard') {
        byId('accountPanel')?.classList.add('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // Reset quote step before navigating away so re-entering quote starts fresh.
        if (state.activeView === 'quote') showQuoteFlowStep('property', { scroll: false });
        setActiveView('dashboard');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  const first = buttons.find((b) => b.classList.contains('active'))?.dataset.view || 'dashboard';
  setActiveView(first);
}

// renderCoverage, localContentData, setMetaDescription, bindLocalContentLinks,
// renderFaqItems, renderHomepageContent, findLocalEntry, renderLocalLanding,
// renderLocalLandingFromPath → moved to content.js

// sanitizeCustomerName, sanitizeJobForPublic, scopeAreaLabel, countGeoJsonFeatures,
// renderJobScopeSnapshot → public/js/jobs/jobs-ui.js

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
    setCurrentServiceAddress(getQuoteFormServiceAddress(), 'quote-draft');
    clearStaleMowAreaWithoutPolygon(byId('quoteForm'));
  }

  renderHomepageContent();
  renderCoverage();
  renderLocalLandingFromPath();
  hydrateRegionEditor();
  hydrateServiceEditor();
  scheduleEstimateRefresh('app-load');
}

// toggleAuthPanel, openAuth click, mobileAuthBtn click → public/js/auth/auth-ui.js
byId('openAppDrawer')?.addEventListener('click', openAppDrawer);
byId('mobileMoreBtn')?.addEventListener('click', openAppDrawer);
byId('closeAppDrawer')?.addEventListener('click', closeAppDrawer);
byId('appDrawerOverlay')?.addEventListener('click', closeAppDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeAppDrawer();
    toggleAuthPanel?.(false);
  }
});
document.querySelectorAll('[data-drawer-view], [data-drawer-contact], [data-mobile-contact]').forEach((btn) => {
  btn.addEventListener('click', () => navigateFromElement(btn));
});

// [data-provider-tab] forEach handler → public/js/provider/provider-ui.js

$$('[data-account-panel]').forEach((btn) => {
  btn.addEventListener('click', () => showAccountPanel());
});

// [data-open-auth], [data-social-auth], .facebook-login-link, [data-email-auth-target] → public/js/auth/auth-ui.js
// showAuthTab, loginForm submit, registerForm submit → public/js/auth/auth-ui.js

// friendlyAdminSaveError, hydrateRegionEditor, hydrateServiceEditor → public/js/admin/admin-ui.js

// populateProviderSetupChoices → public/js/provider/provider-ui.js

// loadProviderServiceAreas, PROVIDER_AREA_SECTIONS, isProviderUser, providerWorkspace,
// setProviderActiveTab, renderProviderArea, providerLoading, providerError, providerQuickButton,
// renderProviderDashboard, wireProviderActionButtons, providerJobAddress, providerPhotosHtml,
// providerJobActions, providerJobCard, wireProviderJobStatusButtons, renderProviderJobs,
// renderProviderJobHistory, renderProviderServices, saveProviderServices,
// renderProviderServiceAreas, saveProviderServiceAreas, renderProviderProfile,
// saveProviderProfile, renderProviderSettings → public/js/provider/provider-ui.js

async function updateEstimatePreview() {
  return refreshEstimate({ force: true });
}

// geocodeAddress, addressPartsFromGoogleComponents, addressPartsFromNominatim,
// reverseGeocodeServiceAddress, fillMissingServiceAddressFromReverseGeocode,
// parcelLookupPointFromGeometry, quoteFormLatLng, showPropertyConfirmationPanel,
// lookupParcel, lookupParcelByLatLng, setGpsStatus, setGpsButtonLocating,
// gpsErrorMessage, requestCurrentLocation
// → public/js/quote/property-lookup.js

/* ─────────────────────────────────────────────────────────────────────────
   PARCEL SELECT MODE  (tap/click map to pick a different parcel)
───────────────────────────────────────────────────────────────────────── */

function enterParcelSelectMode() {
  stopToolModes();
  state.parcelSelectMode = true;
  setMapMode('select');
  if (state.drawHandler?._enabled) state.drawHandler.disable();
  if (state.editHandler?._enabled) state.editHandler.disable();
  setEditorModeLabel('Mode: Tap a parcel on the map to select it');
  byId('selectParcelBtn')?.classList.add('active');
  byId('useThisParcelBar')?.classList.add('hidden');
}

function exitParcelSelectMode() {
  state.parcelSelectMode = false;
  state.parcelDblClick = false;
  if (getMapMode() === 'select') setMapMode('idle');
  state.pendingParcelPreviewFeature = null;
  updatePreviewParcelSource();
  state.pendingParcelPreviewLayer = null;
  state.pendingParcelFeature = null;
  setEditorModeLabel('Mode: Ready');
  byId('selectParcelBtn')?.classList.remove('active');
  byId('useThisParcelBar')?.classList.add('hidden');
}

async function applyParcelFromClick(latlng) {
  if (!state.parcelSelectMode) return;
  const { lat, lng } = latlng;
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
  const parcelProps = parcelPropertiesFromLookupData(data);
  data.lookupPoint = { lat, lng };
  state.pendingParcelPreviewFeature = esriPolygonToGeoJSONFeature(geometry, { ...parcelProps, role: 'parcel-preview' });
  state.pendingParcelPreviewLayer = state.pendingParcelPreviewFeature;
  updatePreviewParcelSource();
  state.pendingParcelFeature = data;
  if (state.parcelDblClick) {
    state.parcelDblClick = false;
    confirmParcelSelection().catch((error) => showError('Parcel selection failed: ' + prettyApiError(error)));
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

async function confirmParcelSelection() {
  if (!state.pendingParcelFeature) return;
  const data = state.pendingParcelFeature;
  const geometry = data.feature?.geometry;
  const normalized = data.normalized || {};
  const attrs = normalized.attributes || {};
  const parcelProps = parcelPropertiesFromLookupData(data);
  let parcelAddress = resolveServiceAddressFromParcel(parcelProps, getQuoteFormServiceAddress());
  parcelAddress = await fillMissingServiceAddressFromReverseGeocode(
    parcelAddress,
    data.lookupPoint || quoteFormLatLng() || parcelLookupPointFromGeometry(geometry) || {}
  );
  clearMowableFeatures();
  state.mowUndoStack = [];
  state.parcelProperties = parcelProps;
  state.selectedParcelProperties = parcelProps;
  state.selectedParcel = { type: 'Feature', geometry: null, properties: parcelProps };
  if (geometry) drawParcel(geometry, parcelProps);
  const quoteForm = byId('quoteForm');
  if (quoteForm) {
    quoteForm.elements.parcelId.value = normalized.parcelId || propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN') || '';
    const sqft = Number(normalized.areaSqft || 0)
      || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : 0);
    quoteForm.elements.lotAreaSqft.value = sqft || '';
    quoteForm.elements.mowAreaSqft.value = '';
    if (quoteForm.elements.customerAdjustedMowableSqft)
      quoteForm.elements.customerAdjustedMowableSqft.value = '';
    setCurrentServiceAddress(parcelAddress, 'manual-parcel-selection', {
      syncQuoteForm: true,
      clearQuoteFormMissing: true,
      replace: true,
    });
  }
  renderSuggestedMowablePanel(null);
  scheduleEstimateRefresh('parcel-selected');
  syncMowAreaFromLayers();
  saveQuoteDraft();
  updateQuoteFlowState();
  renderConfirmProperty({
    headline: 'Parcel selected. Boundary loaded.',
    parcelProps,
    normalized,
    attrs,
    serviceAddress: parcelAddress,
    method: data.method || '',
    parcelId: normalized.parcelId || propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN') || '',
    county: normalized.county || propText(attrs, 'countyid', 'county', 'COUNTY') || '',
    lotSqft: quoteForm ? Number(quoteForm.elements.lotAreaSqft.value || 0) : 0,
    mowSqft: quoteForm ? Number(quoteForm.elements.mowAreaSqft.value || 0) : 0,
  });
  showPropertyConfirmationPanel(true);
  exitParcelSelectMode();
  showQuoteFlowStep('property');
}

// loadProviders → public/js/provider/provider-ui.js

// loadJobs → moved to jobs-ui.js

// loadAdmin → public/js/admin/admin-ui.js

// loadAdminPaidJobs → public/js/admin/admin-ui.js

// loadProviderPaidJobs → public/js/provider/provider-ui.js

// quoteContactMissing → moved to checkout-request.js
// bookingAccessNotesRequired → moved to checkout-request.js
// bookingContactMissing → moved to checkout-request.js
// normalizeBookingContact → moved to checkout-request.js
// showBookingContactPanel → moved to checkout-request.js
// showQuoteContactRequest → moved to checkout-request.js
// renderFilePreview → moved to checkout-request.js
// updateExtraBidFields → moved to checkout-request.js
// updateExtraBidReview → moved to checkout-request.js
// uploadPhotoInput → moved to checkout-request.js
// submitBidRequest → moved to checkout-request.js

// renderEstimateResult() → public/js/quote/estimate.js

// showLeadRequestPanel → public/js/quote/checkout-request.js

// hideManualQuotePanel, showManualQuotePanel, buildManualQuoteRequestPayload → public/js/quote/checkout-request.js

async function generateGuestEstimate(form) {
  const _preBuildFormMow = Number(form?.elements?.mowAreaSqft?.value || 0);
  const payload = buildQuotePayload(form);
  const _genLot = Number(payload.lotAreaSqft || 0);
  const _genMow = Number(payload.mowAreaSqft || 0);
  const _genLayers = getMowableFeatureCount();
  const _genPct = _genLot > 0 ? Math.round((_genMow / _genLot) * 100) : null;
  console.log('[TurfLynk Area Trace] D. generateGuestEstimate | mowAreaSqft=' + _genMow + ' lotAreaSqft=' + _genLot + (_genPct !== null ? ' (' + _genPct + '% of parcel)' : '') + ' layers=' + _genLayers + ' formFieldBeforeBuild=' + _preBuildFormMow + ' source=buildQuotePayload→drawGroup');

  // Hard guard: mowAreaSqft is suspiciously close to lotAreaSqft but the form field
  // (set by syncMowAreaFromLayers) showed a much smaller area — indicates stale/wrong drawGroup read
  if (
    _genLot > 0 &&
    _genMow >= _genLot * 0.98 &&
    _preBuildFormMow > 0 &&
    _preBuildFormMow < _genLot * 0.95
  ) {
    console.error('[TurfLynk Area Trace] HARD GUARD triggered | drawGroup=' + _genMow + ' ≈ lot=' + _genLot + ' but formField showed ' + _preBuildFormMow + ' — blocking estimate');
    showError('Selected lawn area looks inconsistent. Please redraw or save the mowable area again.');
    return;
  }

  if (Number(payload.mowAreaSqft || 0) <= 0) {
    setEstimateState('empty', { signature: estimateSignatureFromPayload(payload), payload });
    showMissingMowableAreaPrompt('quoteResult');
    return;
  }

  await refreshEstimate({ force: true, navigate: true, toast: true });
}

async function acceptPendingQuote() {
  const form = byId('quoteForm');
  if (!form) return;

  const payload = {
    ...(state.pendingQuote || {}),
    ...buildQuotePayload(form),
    ...currentJobScopeSnapshotFields(),
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

// Weather refresh hook
setTimeout(() => {
  window.MowNWAWeatherScheduler?.refresh();
}, 300);

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
         Book &amp; Pay Securely
       </button><br>
       <span class="meta">Stripe test checkout enabled. Use card 4242 4242 4242 4242.</span>`
    );

    byId('bookJobBtn')?.addEventListener('click', bookQuoteAsJob);

    saveQuoteDraft();
    if (isAdmin()) await loadAdmin().catch(() => {});

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
// cutMowableBtn click → public/js/map/mow-editor.js (Phase 12d)
// undoCutBtn click → public/js/map/mow-editor.js (Phase 12d)
byId('mapToolsToggle')?.addEventListener('click', () => {
  const panel = byId('mapToolsPanel');
  setMapToolPanelOpen(panel?.classList.contains('hidden'));
});
byId('closeMapTools')?.addEventListener('click', () => setMapToolPanelOpen(false));
// drawManuallyBtn: secondary action in draw-ai-hero — opens the map tools panel
byId('drawManuallyBtn')?.addEventListener('click', () => setMapToolPanelOpen(true));
// continueToDrawBtn → public/js/quote/property-lookup.js
// requestServiceBtn click, manualQuoteBtn click → public/js/quote/checkout-request.js
// saveAreaBtn, cancelEditAreaBtn → public/js/map/mow-editor.js (Phase 12c)
// locateAddressBtn, lookupParcelBtn, requestCurrentLocation → public/js/quote/property-lookup.js

byId('propertyManualQuoteBtn')?.addEventListener('click', () => {
  hydrateLiveBidForm('other');
  setServiceFlow('live_bid');
  byId('liveBidPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// [data-use-current-location], gpsConfirmYesBtn, gpsConfirmNoBtn → public/js/quote/property-lookup.js
// aiDetectMowableBtn → public/js/ai/ai-detect.js
byId('useParcelShapeBtn')?.addEventListener('click', cloneParcelAsMowable);
// TODO: This listener manages UI state (exits parcel-select mode, sets quoteUiMode).
// It is NOT pure lasso drawing interaction; lasso arm is handled by lasso-yard.js bindBtn in attach().
// Leave here until a future phase covers the full quote-flow/parcel-select coordination.
byId('lassoYardBtn')?.addEventListener('click', () => {
  if (state.parcelSelectMode) exitParcelSelectMode();
  state.quoteUiMode = 'drawing';
  updateQuoteFlowState();
});
byId('drawMowableBtn')?.addEventListener('click', () => {
  if (getMowableFeatureCount()) clearMowLayer();
  startDrawMowable();
});
// editMowableBtn, deleteMowableBtn → public/js/map/mow-editor.js (Phase 12c)
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
  setCurrentServiceAddress({}, 'quote-reset', {
    syncQuoteForm: false,
    clearQuoteFormMissing: false,
  });
  setEstimateState('empty', { signature: '', payload: null });
  showPropertyConfirmationPanel(false);
  showQuoteFlowStep('property');
});

function quoteAddressFieldChanged(event) {
  if (!['address', 'city', 'state', 'zip'].includes(event?.target?.name || '')) return;
  setCurrentServiceAddress(getQuoteFormServiceAddress(), 'quote-form-input');
}

byId('quoteForm')?.addEventListener('input', (event) => {
  quoteAddressFieldChanged(event);
  saveQuoteDraft();
  scheduleEstimateRefresh('input');
});

byId('quoteForm')?.addEventListener('change', (event) => {
  quoteAddressFieldChanged(event);
  saveQuoteDraft();
  scheduleEstimateRefresh('change');
  updateMowAreaHelper(
    Number(byId('quoteForm')?.elements?.lotAreaSqft?.value || 0),
    Number(byId('quoteForm')?.elements?.mowAreaSqft?.value || 0)
  );
});

// providerForm submit, providerServiceAreaForm submit → public/js/provider/provider-ui.js

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

      if (!hasActiveSession()) {
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

// regionEditorSelect/serviceEditorSelect change, regionEditorForm/serviceEditorForm submit → public/js/admin/admin-ui.js

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
    const jobItems = (data.user?.role === 'admin' || data.user?.role === 'provider') ? [loadJobs()] : [];
    try { await Promise.allSettled([...jobItems, loadProviders(), ...adminItems]); } catch {}
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
    clearFrontendSessionState();
  }
});

// handleAccountLogout, logoutBtn, drawerLogoutBtn, authPanelSignOutBtn → public/js/auth/auth-ui.js

// aiRefineMowableBtn, applyAiCutoutsBtn → public/js/ai/ai-detect.js

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
// refreshAdmin click → public/js/admin/admin-ui.js
// editAiCutoutsBtn → public/js/ai/ai-detect.js

// closeleadRequestPanel, closeManualQuotePanel, cancelManualQuotePanel → public/js/quote/checkout-request.js

// manualQuoteForm submit → public/js/quote/checkout-request.js

// leadRequestForm submit → public/js/quote/checkout-request.js

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
    if (missingContact && !hasActiveSession()) {
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

// loadAdminLeads, refreshLeadsBtn/leadsStatusFilter/leadsServiceFilter/refreshAdminPaidJobsBtn → public/js/admin/admin-ui.js
byId('refreshProviderPaidJobsBtn')?.addEventListener('click', loadProviderPaidJobs);
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
  setEstimateState('empty', { signature: '', payload: null });
  setCurrentServiceAddress({}, 'address-reset', {
    syncQuoteForm: false,
    clearQuoteFormMissing: false,
  });
}

function selectedPlaceIsInArkansas(place) {
  const stateComponent = (place?.address_components || [])
    .find((component) => component.types?.includes('administrative_area_level_1'));

  return stateComponent?.short_name === 'AR' || stateComponent?.long_name === 'Arkansas';
}

function initAddressAutocomplete() {
  const input =
    byId('quoteAddressInput') ||
    document.querySelector('#quoteForm input[name="address"]');

  if (!input || !window.google?.maps?.places) {
    console.warn('Google Places not loaded � autocomplete disabled');
    return;
  }

  // Google componentRestrictions only restricts by country. Arkansas state limiting
  // is done with bounds/strictBounds plus a post-selection state check.
  const autocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'us' },
    bounds: ARKANSAS_BOUNDS,
    strictBounds: true,
    fields: ['formatted_address', 'geometry', 'address_components', 'place_id'],
    types: ['address'],
  });

  autocomplete.addListener('place_changed', () => {
    resetParcelQuoteStateForNewAddress();

    const place = autocomplete.getPlace();
    if (!place?.geometry?.location) return;

    if (!selectedPlaceIsInArkansas(place)) {
      showWarning('Please choose an Arkansas address for now.');
      return;
    }

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
    setCurrentServiceAddress(getQuoteFormServiceAddress(), 'google-places');

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    setLatLng(lat, lng);
    placeMarker(lat, lng);
    saveQuoteDraft();
    scheduleEstimateRefresh('address-autocomplete');

    setTimeout(() => {
      lookupParcel().catch((error) => {
        console.warn('Autocomplete parcel lookup failed', error);
      });
}, 100);
  });
}

// applyRoleVisibility() → public/js/auth/admin-visibility.js

// openAuthGate, closeAuthGate, showGateTab, gate form handlers → public/js/auth/auth-ui.js

// bookQuoteAsJob → public/js/quote/checkout-request.js

// showAccountRecommend, hideAccountRecommend, proceedToCheckout,
// accountRecommendGuestBtn/CreateBtn/LoginToggle/RegisterToggle handlers,
// accountRecommendRegisterForm/LoginForm submit → public/js/quote/checkout-request.js

async function handleAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  if (!auth) return false;

  if (auth === 'error') {
    const provider = params.get('provider') || 'account';
    showError(`${provider.charAt(0).toUpperCase() + provider.slice(1)} sign-in could not be completed. Please try email instead.`);
    return false;
  }

  if (auth !== 'success') return false;

  try {
    const meData = await api('/api/auth/me');
    state.currentUser = meData.user;
    updateSessionStatus(meData.user);
    applyRoleVisibility();
    showSuccess('Signed in');
  } catch {
    showError('Signed in, but the app could not restore your session yet.');
    return false;
  }

  const context = loadAuthReturnContext();
  const rawStep = params.get('step') || context?.step || context?.currentStep || 'request';
  const step = rawStep === 'manual' ? 'manual' : normalizeQuoteStep(rawStep);
  const source = context?.source || params.get('source') || 'none';

  if (context) {
    console.info('[Auth Resume] found context', {
      source: context.source,
      step: context.step,
      hasQuote: Boolean(context.quote?.estimate),
      hasGeoJSON: Boolean(context.drawnGeoJSON?.features?.length),
      hasCustomerName: Boolean(context.customerFields?.customerName),
    });
  }
  console.info(`[Auth Resume] restoring source=${source} step=${step}`);

  if (context?.quote) {
    state.pendingQuote = context.quote;
    state.lastQuote = context.quote;
  }

  if (context?.pendingCheckoutUrl) {
    state.pendingCheckoutUrl = context.pendingCheckoutUrl;
  }

  if (context?.quoteFormData) {
    const quoteForm = byId('quoteForm');
    if (quoteForm) {
      Object.entries(context.quoteFormData).forEach(([key, value]) => {
        const field = quoteForm.elements[key];
        if (!field || value == null) return;
        field.value = value;
      });
    }
  }

  // Restore drawn polygon to the map source so the lasso area re-appears on the map
  if (context?.drawnGeoJSON?.features?.length) {
    state.mowableFeatureCollection = cloneFeatureCollection(context.drawnGeoJSON);
    state.drawGroup = state.mowableFeatureCollection;
    window.mowableFeatureCollection = state.mowableFeatureCollection;
    updateMowableSource();
    console.info('[Auth Resume] restored mowable geometry', { features: state.mowableFeatureCollection.features.length });
  }

  // Restore parcel GeoJSON so scope snapshot captures it on submission after redirect
  if (context?.parcelGeoJSON) {
    state.parcelFeature = context.parcelGeoJSON;
    state.parcelLayer = context.parcelGeoJSON;
    if (state.pendingQuote && !state.pendingQuote.parcelGeoJSON) {
      state.pendingQuote = { ...state.pendingQuote, parcelGeoJSON: context.parcelGeoJSON };
      state.lastQuote = state.pendingQuote;
    }
    withMapReady(() => {
      updateParcelSource();
    });
    console.info('[Auth Resume] restored parcel GeoJSON');
  }

  // Pre-set the target step so setActiveView('quote') renders the right panel without flash
  state.quoteFlowStep = step === 'manual'
    ? 'estimate'
    : step === 'request'
      ? 'request'
      : step;

  setActiveView('quote');

  const quotePayload = context?.quote || state.pendingQuote || null;
  console.info('[Auth Resume] navigating to step=' + step);
  if (step === 'manual' && quotePayload) {
    showManualQuotePanel(quotePayload);
  } else if (step === 'request' && quotePayload) {
    showLeadRequestPanel(quotePayload);
  } else if (step === 'draw' || step === 'estimate' || step === 'property') {
    showQuoteFlowStep(step, { scroll: false });
  } else if (quotePayload) {
    showLeadRequestPanel(quotePayload);
  } else {
    showQuoteFlowStep('estimate', { scroll: false });
  }

  // Restore customer/job fields typed before social login redirect
  if (context?.customerFields) {
    const leadForm = byId('leadRequestForm');
    if (leadForm) {
      const cf = context.customerFields;
      if (cf.customerName) leadForm.elements.customerName.value = cf.customerName;
      if (cf.customerPhone) leadForm.elements.customerPhone.value = cf.customerPhone;
      if (cf.customerEmail && leadForm.elements.customerEmail) leadForm.elements.customerEmail.value = cf.customerEmail;
      if (cf.notes && leadForm.elements.notes) leadForm.elements.notes.value = cf.notes;
      if (cf.preferredDate && leadForm.elements.preferredDate) leadForm.elements.preferredDate.value = cf.preferredDate;
      if (cf.schedule_preference && leadForm.elements.schedule_preference) leadForm.elements.schedule_preference.value = cf.schedule_preference;
      if (Array.isArray(cf.available_days_json)) {
        $$('input[name="available_days_json"]', leadForm).forEach((cb) => {
          cb.checked = cf.available_days_json.includes(cb.value);
        });
      }
      console.info('[Auth Resume] restored forms', {
        customerName: Boolean(cf.customerName),
        customerPhone: Boolean(cf.customerPhone),
      });
    }
    const manualForm = byId('manualQuoteForm');
    if (manualForm) {
      const cf = context.customerFields;
      if (cf.customerName && manualForm.elements.name) manualForm.elements.name.value = cf.customerName;
      if (cf.customerPhone && manualForm.elements.phone) manualForm.elements.phone.value = cf.customerPhone;
      if (cf.customerEmail && manualForm.elements.email) manualForm.elements.email.value = cf.customerEmail;
      if (cf.notes && manualForm.elements.notes) manualForm.elements.notes.value = cf.notes;
      if (cf.preferredDayTime && manualForm.elements.preferredDayTime) manualForm.elements.preferredDayTime.value = cf.preferredDayTime;
    }
  }

  // Re-apply the single service address source after auth-return form restoration.
  if (quotePayload) setCurrentServiceAddress(getCurrentServiceAddress(quotePayload), 'auth-return');
  applyServiceAddressToLeadForm();
  // Fill name/email blanks from the freshly-loaded user profile
  hydrateLeadFormFromUser(state.currentUser);
  console.info('[Auth UI] showing signed-in controls after auth return');
  console.info(`[Auth Resume] restored step=${step}`);

  clearAuthReturnContext();
  console.info('[Auth Resume] cleared');

  params.delete('auth');
  params.delete('provider');
  params.delete('reason');
  params.delete('step');
  const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next || '/');

  return true;
}

/* ─────────────────────────────────────────────────────────────────────────
   MY BOOKINGS (customer) + OPEN JOBS (provider)
───────────────────────────────────────────────────────────────────────── */

// statusBadge, navLinksHtml, loadMyJobs → public/js/jobs/jobs-ui.js

// loadOpenJobsForProvider → public/js/provider/provider-ui.js

// acceptJob, showOpenJobsBtn handler, refreshMyJobs handler → public/js/provider/provider-ui.js

byId('selectParcelBtn')?.addEventListener('click', () => {
  if (state.parcelSelectMode) exitParcelSelectMode();
  else enterParcelSelectMode();
});

byId('useThisParcelConfirmBtn')?.addEventListener('click', () => {
  confirmParcelSelection().catch((error) => showError('Parcel selection failed: ' + prettyApiError(error)));
});
byId('useThisParcelCancelBtn')?.addEventListener('click', exitParcelSelectMode);

// copy-addr delegated handler → public/js/jobs/jobs-ui.js

window.addEventListener('popstate', () => {
  renderLocalLandingFromPath();
  setActiveView('dashboard');
});

// handleCheckoutReturn, renderCheckoutSuccess, submitSuccessSetPassword → public/js/quote/checkout-request.js

(async function init() {
  applySocialLoginVisibility();
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

  // Resolve current user so role-based UI works for bearer and cookie sessions.
  try {
    const meData = await api('/api/auth/me');
    state.currentUser = meData.user;
    updateSessionStatus(meData.user);
    hydrateLeadFormFromUser(meData.user); // pre-fill blanks for already-logged-in sessions
  } catch {
    clearFrontendSessionState();
  }
  applyRoleVisibility();
  const authResumed = await handleAuthReturn();
  const checkoutReturned = await window.handleCheckoutReturn?.();
  if (checkoutReturned) {
    console.log('[init] checkout return handled; skipping default property route');
    updateSessionStatus();
    return;
  }

  updateSessionStatus();
  // loadAdmin() and loadAdminLeads() are triggered by applyRoleVisibility() above when admin
  // loadJobs() is only for provider/admin — customers use loadMyJobs() via showAccountPanel()
  const _role = state.currentUser?.role;
  const _pageLoads = [loadProviders()];
  if (_role === 'provider' || _role === 'admin') _pageLoads.push(loadJobs());
  await Promise.allSettled(_pageLoads);

  const form = byId('quoteForm');
  const lat = form?.elements?.lat?.value;
  const lng = form?.elements?.lng?.value;

  if (lat && lng) {
    placeMarker(lat, lng);
    // Skip parcel lookup on auth return because it would navigate back to Property and undo the resume.
    if (!authResumed) lookupParcel().catch((error) => showWarning(prettyApiError(error)));
  } else if (!authResumed && !checkoutReturned) {
    updateMowAreaHelper(0, 0);
    showQuoteFlowStep(state.quoteFlowStep || 'property', { scroll: false });
  }
  updateQuoteFlowState();
})();




// Guard: keep property/parcel confirmation UI hidden outside quote flow
(function guardPropertyUiOutsideQuote() {
  function sync() {
    const isQuote = document.body?.dataset?.activeView === "quote";
    if (isQuote) return;
    showSearch();
  }

  document.addEventListener("DOMContentLoaded", sync);
  document.addEventListener("click", () => setTimeout(sync, 50));
  setInterval(sync, 1000);
})();
