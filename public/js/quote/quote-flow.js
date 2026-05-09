// Quote step/state UI logic and form/payload helpers.
// Extracted from app.js — Phase 3 + Phase 13e modular refactor. Loads before app.js.
//
// Pre-load globals required:
//   state, QUOTE_STEP_ORDER                              → public/js/state.js
//   byId, $$, setElementVisible, escapeHtml             → public/js/utils/dom.js
//   SERVICE_CATALOG, EXTRA_SERVICE_OPTIONS,
//   AVAILABLE_DAY_OPTIONS                               → public/js/config.js
//
// Runtime globals called (resolved from app.js at call time):
//   setMapGestureCapture, setMapToolPanelOpen, getMapMode, setMapMode
//   stopToolModes, refreshMapAfterStepVisible, scheduleEstimateRefresh
//   hasActiveMowableArea, currentParcelGeoJSON, currentEstimateSignature
//   generateGuestEstimate, showMissingMowableAreaPrompt
//   prettyApiError, showResult, showError

function normalizeQuoteStep(step) {
  if (step === 'start' || step === 'parcel') return 'property';
  return QUOTE_STEP_ORDER.includes(step) ? step : 'property';
}

function quoteStepNumber(step = state.quoteFlowStep) {
  return Math.max(1, QUOTE_STEP_ORDER.indexOf(normalizeQuoteStep(step)) + 1);
}

function quoteFlowStepDebugEnabled() {
  try {
    return Boolean(window.DEBUG_QUOTE_FLOW)
      || localStorage.getItem('DEBUG_QUOTE_FLOW') === '1'
      || localStorage.getItem('DEBUG_QUOTE_FLOW') === 'true';
  } catch {
    return false;
  }
}

function showQuoteFlowStep(step, options = {}) {
  const trace = quoteFlowStepDebugEnabled();
  const traceLabel = trace ? `[QuoteFlow] showQuoteFlowStep ${state.quoteFlowStep || 'none'} -> ${step}` : '';
  if (trace) {
    console.time(traceLabel);
    console.log('[QuoteFlow] showQuoteFlowStep:start', {
      from: state.quoteFlowStep || '',
      to: step,
      options,
    });
  }
  const nextStep = normalizeQuoteStep(step);
  state.quoteFlowStep = nextStep;
  document.body.dataset.quoteFlowStep = nextStep;
  const manualPanel = byId('manualQuotePanel');
  if (manualPanel) {
    manualPanel.classList.remove('is-active');
    manualPanel.classList.add('hidden', 'is-hidden');
    manualPanel.hidden = true;
    manualPanel.setAttribute('aria-hidden', 'true');
  }

  $$('[data-quote-step-panel]').forEach((panel) => {
    const active = panel.dataset.quoteStepPanel === nextStep;
    const keepMapHostVisible = nextStep === 'draw'
      && panel.dataset.quoteStepPanel === 'property'
      && Boolean(panel.querySelector('#quoteMap'));
    const visible = active || keepMapHostVisible;
    panel.classList.toggle('is-active', active);
    panel.classList.toggle('is-map-host-visible', keepMapHostVisible);
    panel.classList.toggle('is-hidden', !visible);
    panel.classList.toggle('hidden', !visible);
    panel.hidden = !visible;
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });

  const drawing = nextStep === 'draw';
  setMapGestureCapture(drawing);
  setMapToolPanelOpen(drawing);
  if (drawing && !['lasso', 'select', 'edit'].includes(getMapMode())) setMapMode('idle');
  if (drawing && state.map) {
    console.log('[Map Refresh] draw-step-visible');
    refreshMapAfterStepVisible('draw-step-visible');
  } else if (!drawing) {
    stopToolModes();
  }

  updateQuoteStepper();
  // Dynamic header — hide on draw/estimate/request (those screens own their heading)
  const isConfirming = nextStep === 'property'
    && Boolean(document.getElementById('quoteStartScreen')?.classList.contains('is-confirming'));
  updateQuoteStepHeader(nextStep, isConfirming ? 'confirm' : 'search');
  updateQuoteFlowState({ skipStepper: true });

  if (nextStep === 'estimate') {
    scheduleEstimateRefresh('estimate-step', { immediate: true });
  }
  window.turflynkCanvasDiagnostics?.(`quote step:${nextStep}`);

  if (options.scroll !== false) {
    const activePanel = document.querySelector(`[data-quote-step-panel="${nextStep}"]`);
    activePanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  requestAnimationFrame(() => {
    try { (window.turflynkMap || state.map)?.resize?.(); } catch {}
  });
  if (trace) {
    console.log('[QuoteFlow] showQuoteFlowStep:end', {
      step: nextStep,
      activePanel: Boolean(document.querySelector(`[data-quote-step-panel="${nextStep}"].is-active`)),
    });
    console.timeEnd(traceLabel);
  }
}

// Step-aware header content
const _QUOTE_STEP_HEADS = {
  'property-search': {
    region: 'NORTHWEST ARKANSAS',
    title: 'Find Your Property',
    sub: 'Enter your address to begin your lawn quote.',
    chip: 'Find Property',
  },
  'property-confirm': {
    region: 'NORTHWEST ARKANSAS',
    title: 'Confirm Your Property',
    sub: 'Verify we found the correct parcel.',
    chip: 'Confirm Property',
  },
  'draw': {
    chip: 'Select Lawn Area',
  },
  'estimate': {
    chip: 'Review Quote',
  },
  'request': {
    chip: 'Complete Booking',
  },
};

function updateQuoteStepHeader(step, subState) {
  const header = byId('quoteStepDynamicHeader');
  const chipEl = byId('mobileViewTitle');

  const key = step === 'property' ? `property-${subState || 'search'}` : step;
  const head = _QUOTE_STEP_HEADS[key];

  // Sync compact chip in app-topbar for all steps
  if (chipEl && head?.chip) chipEl.textContent = head.chip;

  if (!header) return;
  if (head?.title) {
    const regionEl = header.querySelector('.qsf-region');
    const titleEl = byId('quoteStepTitle');
    const subEl = byId('quoteStepSub');
    if (regionEl) regionEl.textContent = head.region || '';
    if (titleEl) titleEl.textContent = head.title;
    if (subEl) subEl.textContent = head.sub || '';
    header.hidden = false;
    header.removeAttribute('aria-hidden');
  } else {
    header.hidden = true;
    header.setAttribute('aria-hidden', 'true');
  }
}
window.updateQuoteStepHeader = updateQuoteStepHeader;

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

function updateQuoteFlowState(options = {}) {
  const form = byId('quoteForm');
  const parcelLoaded = Boolean(state.parcelLayer);
  const mowSelected = hasActiveMowableArea();
  const editing = state.quoteUiMode === 'editing' || state.quoteUiMode === 'deleting';
  const drawing = state.quoteUiMode === 'drawing';
  const estimateState = state.currentEstimate || {};
  const estimateFresh = mowSelected
    && estimateState.status === 'fresh'
    && estimateState.estimate > 0
    && estimateState.signature === currentEstimateSignature();

  document.body.dataset.quoteState = editing
    ? 'editing'
    : mowSelected
      ? 'mowable-selected'
      : parcelLoaded
        ? 'parcel-loaded'
        : 'empty';

  const panelHidden = byId('mapToolsPanel')?.classList.contains('hidden') ?? true;
  setElementVisible('mapToolsToggle', parcelLoaded && state.quoteFlowStep === 'draw' && panelHidden);
  if (!parcelLoaded || state.quoteFlowStep !== 'draw') setMapToolPanelOpen(false);

  const parcelGeoJson = parcelLoaded ? currentParcelGeoJSON() : null;
  const aiDetectReady = Boolean(parcelGeoJson && !editing && !drawing && !state.aiDetectMowableLoading);
  const onDrawStep = state.quoteFlowStep === 'draw';

  // Hero: primary AI action — visible on draw step when panel is closed and not in an edit/draw mode
  setElementVisible('drawAiHero', parcelLoaded && onDrawStep && !editing && !drawing && panelHidden);
  const aiPrimaryBtn = byId('aiDetectPrimaryBtn');
  if (aiPrimaryBtn) {
    aiPrimaryBtn.disabled = !aiDetectReady;
    aiPrimaryBtn.classList.toggle('disabled', !aiDetectReady);
    aiPrimaryBtn.textContent = state.aiDetectMowableLoading ? 'Detecting yard...' : 'Auto Detect My Yard';
  }

  const aiDetectBtn = byId('aiDetectMowableBtn');
  setElementVisible('aiDetectMowableBtn', parcelLoaded && !editing && !drawing);
  if (aiDetectBtn) {
    aiDetectBtn.disabled = !aiDetectReady;
    aiDetectBtn.classList.toggle('disabled', !aiDetectReady);
    aiDetectBtn.textContent = state.aiDetectMowableLoading
      ? 'Detecting yard...'
      : state.aiDetectMowableStatus === 'success'
        ? 'AI detected yard'
        : state.aiDetectMowableStatus === 'fallback'
          ? 'Use Lasso Yard'
          : 'Auto Detect Lawn';
  }

  setElementVisible('useParcelShapeBtn', parcelLoaded && !mowSelected && !editing && !drawing);
  setElementVisible('lassoYardBtn', parcelLoaded && !editing && !drawing);
  setElementVisible('finishLassoBtn', parcelLoaded && drawing);
  setElementVisible('drawMowableBtn', false);
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
  if (requestBtn) {
    requestBtn.classList.toggle('hidden', !mowSelected);
    requestBtn.classList.toggle('disabled', !estimateFresh);
  }
  const manualQuoteBtn = byId('manualQuoteBtn');
  if (manualQuoteBtn) {
    manualQuoteBtn.classList.toggle('hidden', !mowSelected);
    manualQuoteBtn.classList.toggle('disabled', !estimateFresh);
  }
  byId('checkoutTestModeNote')?.classList.toggle('hidden', !estimateFresh);

  if (!options.skipStepper) updateQuoteStepper();
}

// --- Form / payload helpers (moved from app.js — Phase 13e) ---

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
  if (gate === 'wide_48') return 'Recommended equipment: smaller walk-behind. Gate clearance to be confirmed before scheduling. Large zero-turn access: unlikely.';
  if (gate === 'double_60_plus') return 'Recommended equipment: larger decks may fit. Gate and turning clearance to be confirmed before scheduling.';
  if (gate === 'not_sure') return 'Recommended equipment: small-gate capable mower or request gate photo/confirmation.';
  if (gate === 'other_size') return 'Recommended equipment: gate width to be confirmed before scheduling.';
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

// Restart the quote flow from the beginning — called by any "Get Lawn Quote" button.
// options.fresh (default true): clears parcel/address state so property step shows
// address input, not Confirm Your Property. Pass { fresh: false } only if the
// caller wants to return to the property step without wiping address state.
function restartQuoteFlow(source, options = {}) {
  const fresh = options.fresh !== false;
  console.log('[QuoteFlow] quote restart requested', { source: source || 'button', fresh });

  if (typeof stopToolModes === 'function') stopToolModes();

  if (fresh) {
    // Clear parcel layer, mow layer, form parcel fields, estimate state, service address
    if (typeof resetParcelQuoteStateForNewAddress === 'function') {
      resetParcelQuoteStateForNewAddress();
    } else {
      // Fallback if app.js hasn't loaded yet
      state.parcelLayer = null;
      state.parcelFeature = null;
      state.parcelProperties = null;
      state.selectedParcel = null;
      state.selectedParcelProperties = null;
      state.parcelGeometry = null;
      state.mowableEstimate = null;
    }

    // Clear pending parcel preview/selection state
    state.pendingParcelFeature = null;
    state.pendingParcelPreviewLayer = null;
    state.pendingParcelPreviewFeature = null;
    state.selectedServiceLocation = null;

    // Clear address form inputs so user starts from a blank search
    const form = byId('quoteForm');
    if (form) {
      ['address', 'city', 'state', 'zip', 'lat', 'lng'].forEach((field) => {
        if (form.elements[field]) form.elements[field].value = '';
      });
    }

    // Hide parcel confirmation panel → show address input screen
    if (typeof showPropertyConfirmationPanel === 'function') showPropertyConfirmationPanel(false);

    // Hide GPS confirm bar
    byId('gpsConfirmBar')?.classList.add('hidden');

    // Clear parcel info result panel
    const parcelInfo = byId('parcelInfo');
    if (parcelInfo) {
      parcelInfo.innerHTML = '';
      parcelInfo.classList.add('hidden');
    }

    console.log('[QuoteFlow] fresh quote state cleared');
  }

  showQuoteFlowStep('property');
  console.log('[QuoteFlow] showing address input');
}
window.restartQuoteFlow = restartQuoteFlow;

if (!window.__turflynkQuoteFlowListenersInstalled) {
  window.__turflynkQuoteFlowListenersInstalled = true;

  // Back button delegation
  $$('[data-quote-back]').forEach((btn) => {
    btn.addEventListener('click', () => showQuoteFlowStep(btn.dataset.quoteBack || 'property'));
  });

  // Draw step continue button
  byId('drawContinueBtn')?.addEventListener('click', async () => {
    const form = byId('quoteForm');
    if (!form) return;
    if (!hasActiveMowableArea()) {
      showMissingMowableAreaPrompt('parcelInfo');
      return;
    }
    try {
      stopToolModes();
      await generateGuestEstimate(form);
    } catch (error) {
      showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
      showError(prettyApiError(error));
    }
  });
}

// Expose globally — called from app.js and inline onclick handlers
window.normalizeQuoteStep = normalizeQuoteStep;
window.quoteStepNumber = quoteStepNumber;
window.showQuoteFlowStep = showQuoteFlowStep;
window.updateQuoteStepper = updateQuoteStepper;
window.updateQuoteFlowState = updateQuoteFlowState;
window.restartQuoteFlow = restartQuoteFlow;
