'use strict';
// checkout-request.js — Checkout, lead/service request, manual quote, and account
// recommendation logic. Extracted from app.js — Phase 10 modular refactor.
// Loads before app.js.
//
// Pre-load globals required:
//   state                              → public/js/state.js
//   byId, $$                           → public/js/utils/dom.js
//   phoneDigits                        → public/js/utils/phone.js
//   api                                → public/js/core/api.js
//   escapeHtml, prettyApiError         → public/js/core/api.js
//   money, formatAcres                 → public/js/config.js
//   showResult, showError, showSuccess, showWarning → public/js/utils/dom.js
//   setActiveView                      → app.js (called at runtime)
//   showQuoteFlowStep, updateQuoteStepper → public/js/quote/quote-flow.js
//   hasActiveMowableArea, currentEstimateSignature → app.js (resolved at call-time)
//   refreshEstimate                    → app.js (resolved at call-time)
//   buildQuotePayload                  → app.js (resolved at call-time)
//   bookingContactMissing, quoteContactMissing → defined in this file (Phase 13c)
//   normalizeBookingContact            → defined in this file (Phase 13c)
//   buildAccessSummary, buildScheduleSummary → app.js (resolved at call-time)
//   currentJobScopeSnapshotFields      → app.js (resolved at call-time)
//   sanitizeJobForPublic, sanitizeCustomerName → app.js (resolved at call-time)
//   serviceLabel, regionLabel          → public/js/config.js
//   isValidLookingPhone, showPhoneRequiredError → defined in this file (Phase 13c)
//   formToObject, checkedValues        → app.js (resolved at call-time)
//   syncServiceAddressFields, getCurrentServiceAddress → app.js (resolved at call-time)
//   setCurrentServiceAddress, applyServiceAddressToLeadForm → app.js (resolved at call-time)
//   resolveServiceAddressFromParcel, hasServiceAddress → app.js (resolved at call-time)
//   hydrateLeadFormFromUser, rememberProfilePhoneIfBlank → app.js (resolved at call-time)
//   equipmentRecommendation            → app.js (resolved at call-time)
//   showMissingMowableAreaPrompt       → app.js (resolved at call-time)
//   setAuthToken                       → public/js/auth/auth-ui.js
//   updateSessionStatus                → public/js/auth/auth-ui.js
//   applyRoleVisibility                → public/js/auth/admin-visibility.js
//   hasActiveSession                   → public/js/auth/auth-ui.js
//   isAdmin, loadAdmin                 → app.js (resolved at call-time)
//   loadMyJobs                         → public/js/jobs/jobs-ui.js
//   submitBidRequest, uploadPhotoInput → defined in this file (Phase 13c)
//   aiPhotoPlaceholder                 → app.js (resolved at call-time)
//   saveQuoteDraft                     → app.js (resolved at call-time)
//   INCLUDED_MOW_TASKS, EXCLUDED_MOW_TASKS, MOWABLE_ESTIMATE_FIELDS → public/js/config.js

/* ─────────────────────────────────────────────────────────────────────────
   SHOW / HIDE LEAD REQUEST PANEL
───────────────────────────────────────────────────────────────────────── */

function checkoutUiIcon(name, label) {
  return `<img src="/assets/icons/lucide/${name}.svg" alt="" class="ui-icon"><span class="ui-label">${escapeHtml(label)}</span>`;
}

function checkoutBindOnce(target, type, key, handler, options) {
  if (!target || typeof target.addEventListener !== 'function' || !key) return false;
  const registry = target.__turflynkListenerKeys || (target.__turflynkListenerKeys = new Set());
  const registryKey = `${type}:${key}`;
  if (registry.has(registryKey)) {
    console.info('[ListenerGuard] duplicate checkout listener skipped', registryKey);
    return false;
  }
  registry.add(registryKey);
  target.addEventListener(type, handler, options);
  return true;
}

const SMS_CONSENT_TEXT = 'I agree to receive SMS messages from MowNWA.com about my quote, booking, scheduling, job updates, payment/COD verification, and customer support. Message frequency may vary. Msg & data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. View our Privacy Policy and Terms of Service.';
const SMS_CONSENT_REQUIRED_MESSAGE = 'SMS consent is required before we can send verification texts.';
const PHONE_VERIFICATION_CODE_SENT_MESSAGE = 'Text code sent. Enter the 6-digit code below.';
const MANUAL_QUOTE_SUCCESS_MESSAGE = 'Your in-person quote request was submitted. We’ll contact you to review the job.';
const CHECKOUT_PII_STORAGE_KEYS = ['turflynk.authReturn.v1', 'turflynk.quoteDraft.v5'];
const CHECKOUT_CONTACT_NAMES = new Set(['customerName', 'customerPhone', 'customerEmail', 'name', 'phone', 'email', 'fullName']);
const CHECKOUT_ADDRESS_NAMES = new Set(['address', 'city', 'state', 'zip', 'lat', 'lng', 'parcelId']);

function checkoutPhoneForDisplay(value) {
  return typeof formatUsPhoneNumber === 'function' ? formatUsPhoneNumber(value) : String(value || '').trim();
}

function checkoutPhoneForBackend(value) {
  const raw = String(value || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  const digits = phoneDigits(raw);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return raw;
}

function checkoutSetVisiblePhone(input, value) {
  if (!input) return;
  input.value = checkoutPhoneForDisplay(value);
  if (typeof normalizeUsPhoneInput === 'function') normalizeUsPhoneInput(input);
}

function checkoutSetInputValue(input, value) {
  if (!input) return;
  const isPhone = input.matches?.('input[name="customerPhone"], input[name="phone"]')
    || String(input.type || '').toLowerCase() === 'tel';
  if (isPhone) {
    checkoutSetVisiblePhone(input, value);
    return;
  }
  input.value = value || '';
}

function checkoutClearFormPii(form, options = {}) {
  if (!form?.elements) return;
  const clearAddress = Boolean(options.clearAddress);
  Array.from(form.elements).forEach((field) => {
    const name = field?.name || '';
    if (!name || field.type === 'hidden' && !clearAddress) return;
    if (!CHECKOUT_CONTACT_NAMES.has(name) && !(clearAddress && CHECKOUT_ADDRESS_NAMES.has(name))) return;
    if (field.type === 'checkbox' || field.type === 'radio') field.checked = false;
    else field.value = name === 'state' ? 'AR' : '';
  });
}

function clearCheckoutPii(options = {}) {
  const clearAddress = Boolean(options.clearAddress);
  const clearStorage = options.clearStorage !== false;
  const clearQuoteState = options.clearQuoteState !== false;

  if (clearStorage) {
    if (typeof clearAuthReturnContext === 'function') clearAuthReturnContext();
    if (typeof clearQuoteDraft === 'function') clearQuoteDraft();
    CHECKOUT_PII_STORAGE_KEYS.forEach((key) => {
      try { localStorage.removeItem(key); } catch {}
      try { sessionStorage.removeItem(key); } catch {}
    });
  }

  ['leadRequestForm', 'manualQuoteForm', 'accountRecommendRegisterForm', 'accountRecommendLoginForm', 'gateLoginForm', 'gateRegisterForm'].forEach((id) => {
    checkoutClearFormPii(byId(id), { clearAddress });
  });
  if (clearAddress) checkoutClearFormPii(byId('quoteForm'), { clearAddress: true });

  if (clearQuoteState) {
    state.lastQuote = null;
    state.pendingQuote = null;
    state.pendingCheckoutUrl = null;
    state.pendingCheckoutResume = false;
    if (state.currentEstimate) state.currentEstimate = { ...state.currentEstimate, payload: null, status: 'empty' };
    if (clearAddress) state.currentServiceAddress = { street: '', address: '', city: '', state: 'AR', zip: '', full: '', source: options.reason || 'checkout-pii-clear', updatedAt: Date.now() };
  }

  if (typeof checkoutPhoneVerificationState !== 'undefined') {
    checkoutPhoneVerificationState.phone = '';
    checkoutPhoneVerificationState.verifiedAt = 0;
    checkoutPhoneVerificationState.resendLockedUntil = 0;
    clearPendingPhoneVerificationResumes();
  }

  if (typeof applyUsPhoneFormatting === 'function') applyUsPhoneFormatting(document);
}

function checkoutOtpInputHtml(name, placeholder = '123456') {
  return `<input name="${escapeHtml(name)}" type="text" inputmode="numeric" autocomplete="one-time-code" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="10" placeholder="${escapeHtml(placeholder)}" pattern="\\d{4,10}" data-otp="true" />`;
}

function checkoutVerificationCodeValue(input) {
  return String(input?.value || '').replace(/\D/g, '');
}

function checkoutRefreshMapPreview(reason = 'checkout-visible') {
  const refresh = () => {
    const map = window.turflynkMap || state.map;
    const mapEl = byId('quoteMap');
    if (!map || typeof map.resize !== 'function') return;
    if (!mapEl || !mapEl.offsetWidth || !mapEl.offsetHeight) return;
    try { map.resize(); } catch {}
  };
  requestAnimationFrame(refresh);
  setTimeout(refresh, 80);
  setTimeout(() => {
    refresh();
    if (typeof refreshMapAfterStepVisible === 'function') refreshMapAfterStepVisible(reason);
  }, 160);
}

function showLeadRequestPanel(payload) {
  const panel = byId('leadRequestPanel');
  if (!panel) return;

  const estimate = payload.estimate || 0;

// Weather refresh hook
setTimeout(() => {
  window.MowNWAWeatherScheduler?.refresh();
}, 300);

  const quoteForm = byId('quoteForm');
  const quoteFields = quoteForm ? formToObject(quoteForm) : {};
  const payloadServiceAddress = payload?.parcelProperties
    ? resolveServiceAddressFromParcel(payload.parcelProperties, payload)
    : getCurrentServiceAddress(payload);
  if (hasServiceAddress(payloadServiceAddress)) setCurrentServiceAddress(payloadServiceAddress, 'show-lead-request');

  // Populate hidden fields from the estimate payload
  const set = (id, val) => { const el = byId(id); if (el) el.value = val || ''; };
  set('leadEstimatedPrice', estimate);
  set('leadMowAreaSqft', payload.mowAreaSqft || 0);
  set('leadLotAreaSqft', payload.lotAreaSqft || 0);
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
    const submitLabel = submitBtn.querySelector('.ui-label');
    if (submitLabel) submitLabel.textContent = 'Book & Pay Securely';
  }
  const scopeGrid = byId('leadScopeGrid');
  if (scopeGrid) {
    scopeGrid.innerHTML = '';
    scopeGrid.hidden = true;
  }
  const leadForm = byId('leadRequestForm');
  if (leadForm) {
    const fillBlank = (name, value) => {
      const field = leadForm.elements[name];
      if (field && !String(field.value || '').trim() && value) checkoutSetInputValue(field, value);
    };
    fillBlank('customerName', payload.customerName || payload.name || '');
    fillBlank('customerPhone', payload.customerPhone || payload.phone || '');
    fillBlank('customerEmail', payload.customerEmail || payload.email || '');
  }

  panel.classList.remove('hidden');
  showQuoteFlowStep('request');
  checkoutRefreshMapPreview('checkout-request-visible');
  window.turflynkCanvasDiagnostics?.('checkout open');
  updateQuoteStepper();

  // Scroll panel into view so users on desktop (where the button is below the fold) see the form
  requestAnimationFrame(() => {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Fill blank customer fields from logged-in user profile (does not overwrite typed values)
  hydrateLeadFormFromUser(state.currentUser);
  if (state.currentUser) console.info('[Auth UI] showing signed-in controls on request panel');

  applyServiceAddressToLeadForm();
  window.MowNWAWeatherScheduler?.scheduleRefresh?.('checkout-request-visible', { initialDelay: 120 });
  console.log('[FINAL FORM STATE]', {
    city: document.getElementById('leadCity')?.value,
    state: document.getElementById('leadState')?.value,
    zip: document.getElementById('leadZip')?.value
  });
}

function hideManualQuotePanel() {
  const panel = byId('manualQuotePanel');
  if (panel) {
    panel.classList.remove('is-active');
    panel.classList.add('hidden', 'is-hidden');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
  }
  showQuoteFlowStep('estimate');
  updateQuoteStepper();
}

/* ─────────────────────────────────────────────────────────────────────────
   SHOW / HIDE MANUAL QUOTE PANEL
───────────────────────────────────────────────────────────────────────── */

function checkoutArrayFromMaybe(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function checkoutHumanize(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function checkoutQuoteBreakdownRows(breakdown = []) {
  if (!Array.isArray(breakdown) || !breakdown.length) return '';
  const rows = breakdown.slice(0, 6).map((item) => {
    const label = item.label || item.name || item.title || item.description || 'Line item';
    const amountValue = item.amount ?? item.price ?? item.value ?? item.total;
    const amount = Number.isFinite(Number(amountValue)) ? money(Number(amountValue)) : String(amountValue || '');
    return `<li><span>${escapeHtml(label)}</span>${amount ? `<strong>${escapeHtml(amount)}</strong>` : ''}</li>`;
  }).join('');
  return rows ? `<div class="manual-quote-context-breakdown"><strong>Quote breakdown</strong><ul>${rows}</ul></div>` : '';
}

function manualQuoteContextHtml(payload = {}) {
  const current = state.currentEstimate || {};
  const breakdown = checkoutArrayFromMaybe(payload.quoteBreakdown || payload.breakdown || current.breakdown);
  const address = payload.full || payload.addressLabel || payload.parcelAddressLabel || [payload.address, payload.city, payload.state, payload.zip].filter(Boolean).join(', ');
  const estimate = Number(payload.estimate || current.estimate || 0);
  const mowArea = Number(payload.mowAreaSqft || 0);
  const lotArea = Number(payload.lotAreaSqft || payload.parcelAreaSqft || 0);
  const selectedLocation = payload.selectedServiceLocation || state.selectedServiceLocation || {};
  const parcelLabel = selectedLocation.displayAddress || selectedLocation.parcelId || payload.parcelId || '';
  const items = [
    ['Property', address || parcelLabel || 'Selected property'],
    ['Mowable area', mowArea > 0 ? `${formatAcres(mowArea)} (${Math.round(mowArea).toLocaleString()} sq ft)` : 'Not selected'],
    ['Lot area', lotArea > 0 ? `${formatAcres(lotArea)} (${Math.round(lotArea).toLocaleString()} sq ft)` : 'Not available'],
    ['Estimate', estimate > 0 ? money(estimate) : 'Manual review'],
    ['Service', serviceLabel(payload.serviceType || 'mowing')],
    ['Grass height', checkoutHumanize(payload.grass_height_range || '')],
    ['Frequency', checkoutHumanize(payload.service_frequency || '')],
  ].filter(([, value]) => String(value || '').trim());
  return `
    <div class="manual-quote-context-card" aria-label="Selected quote summary">
      <div class="section-label">Selected quote summary</div>
      <dl>${items.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      ${checkoutQuoteBreakdownRows(breakdown)}
    </div>`;
}

function currentManualQuoteBasePayload(payload = {}) {
  const quoteForm = byId('quoteForm');
  const quotePayload = quoteForm ? buildQuotePayload(quoteForm) : {};
  const estimateState = state.currentEstimate || {};
  const currentScope = typeof currentJobScopeSnapshotFields === 'function' ? currentJobScopeSnapshotFields() : {};
  const estimate = Number(payload.estimate || state.pendingQuote?.estimate || estimateState.estimate || quotePayload.estimate || 0);
  return {
    ...quotePayload,
    ...(estimateState.payload || {}),
    ...(state.pendingQuote || {}),
    ...(state.lastQuote || {}),
    ...payload,
    ...currentScope,
    selectedServiceLocation: payload.selectedServiceLocation || state.pendingQuote?.selectedServiceLocation || quotePayload.selectedServiceLocation || state.selectedServiceLocation || null,
    quoteBreakdown: payload.quoteBreakdown || payload.breakdown || estimateState.breakdown || [],
    breakdown: payload.breakdown || payload.quoteBreakdown || estimateState.breakdown || [],
    estimate,
    final_price: estimate,
  };
}

function showManualQuotePanel(payload = {}) {
  const panel = byId('manualQuotePanel');
  if (!panel) {
    showQuoteFlowStep('estimate', { scroll: false });
    showError('Could not open the in-person quote form. Your quote is still available.');
    return;
  }

  if (document.body?.dataset?.activeView !== 'quote') setActiveView('quote');

  try {
    const basePayload = currentManualQuoteBasePayload(payload);
    const quoteForm = byId('quoteForm');
    const quoteFields = quoteForm ? formToObject(quoteForm) : {};
    const estimate = Number(basePayload.estimate || 0);
    syncServiceAddressFields(basePayload);

    const display = byId('manualQuoteEstimateDisplay');
    if (display) display.textContent = estimate > 0 ? money(estimate) : '-';
    const context = byId('manualQuoteContext');
    if (context) context.innerHTML = manualQuoteContextHtml(basePayload);

    const form = byId('manualQuoteForm');
    if (form) {
      form.dataset.requestMode = 'manual_quote';
      if (form.elements.name) form.elements.name.value = basePayload.name || basePayload.customerName || form.elements.name.value || '';
      if (form.elements.phone && (basePayload.phone || basePayload.customerPhone || !form.elements.phone.value)) checkoutSetVisiblePhone(form.elements.phone, basePayload.phone || basePayload.customerPhone || form.elements.phone.value || '');
      if (form.elements.email) form.elements.email.value = basePayload.email || basePayload.customerEmail || form.elements.email.value || '';
      if (form.elements.notes) form.elements.notes.value = form.elements.notes.value || quoteFields.notes || '';
    }

    state.requestMode = 'manual_quote';
    state.manualQuoteContext = basePayload;
    byId('manualQuoteResult')?.classList.add('hidden');
    $$('[data-quote-step-panel]').forEach((stepPanel) => {
      stepPanel.classList.remove('is-active');
      stepPanel.classList.add('is-hidden', 'hidden');
      stepPanel.hidden = true;
      stepPanel.setAttribute('aria-hidden', 'true');
    });
    byId('leadRequestPanel')?.classList.add('hidden');
    byId('liveBidPanel')?.classList.add('hidden');
    panel.classList.remove('hidden', 'is-hidden');
    panel.classList.add('is-active');
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    window.turflynkCanvasDiagnostics?.('checkout manual quote open');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('[manualQuote] render failed', error);
    showQuoteFlowStep('estimate', { scroll: false });
    showError('Could not open the in-person quote form. Your quote is still available.');
  }
}

function buildManualQuoteRequestPayload(form) {
  const fd = new FormData(form);
  const contact = Object.fromEntries(fd.entries());
  const quotePayload = currentManualQuoteBasePayload(state.manualQuoteContext || {});
  const serviceAddress = getCurrentServiceAddress(quotePayload);
  const estimate = Number(quotePayload.estimate || state.currentEstimate?.estimate || state.pendingQuote?.estimate || 0);
  const preferredDayTime = String(contact.preferredDayTime || '').trim();
  const preferredContactMethod = String(contact.preferredContactMethod || '').trim();
  const preferredTimeWindow = String(contact.preferredTimeWindow || '').trim();
  const preferredDays = checkedValues('available_days_json', form);
  const extras = checkedValues('manual_quote_extras', form);
  const customerNotes = String(contact.notes || '').trim();
  const notes = [
    'Manual quote requested.',
    preferredContactMethod ? `Preferred contact method: ${preferredContactMethod}` : '',
    preferredDays.length ? `Preferred days: ${preferredDays.join(', ')}` : '',
    preferredTimeWindow ? `Preferred time window: ${preferredTimeWindow}` : '',
    preferredDayTime ? `Preferred day/time: ${preferredDayTime}` : '',
    extras.length ? `Needs reviewed: ${extras.map(checkoutHumanize).join(', ')}` : '',
    customerNotes ? `Customer notes: ${customerNotes}` : '',
    quotePayload.yard_access_notes ? `Yard access notes: ${quotePayload.yard_access_notes}` : '',
  ].filter(Boolean).join('\n');

  return applySmsConsentToPayload({
    ...quotePayload,
    name: String(contact.name || '').trim(),
    phone: String(contact.phone || '').trim(),
    email: String(contact.email || '').trim(),
    customerName: String(contact.name || '').trim(),
    customerPhone: String(contact.phone || '').trim(),
    customerEmail: String(contact.email || '').trim(),
    preferredContactMethod,
    preferredDayTime,
    preferredTimeWindow,
    preferredDays,
    available_days_json: preferredDays.length ? preferredDays : quotePayload.available_days_json || [],
    availableDays: preferredDays.length ? preferredDays : quotePayload.availableDays || [],
    manualQuoteExtras: extras,
    requested_tasks: extras,
    requestMode: 'manual_quote',
    notes,
    address: serviceAddress.address || quotePayload.address || '',
    city: serviceAddress.city || quotePayload.city || '',
    state: serviceAddress.state || quotePayload.state || 'AR',
    zip: serviceAddress.zip || quotePayload.zip || '',
    quote_type: 'manual_quote',
    quoteType: 'manual_quote',
    status: 'manual_requested',
    selectedServiceLocation: quotePayload.selectedServiceLocation || state.selectedServiceLocation || null,
    quoteBreakdown: quotePayload.quoteBreakdown || state.currentEstimate?.breakdown || [],
    breakdown: quotePayload.breakdown || quotePayload.quoteBreakdown || state.currentEstimate?.breakdown || [],
    parcelGeoJSON: quotePayload.parcelGeoJSON || quotePayload.parcelGeoJson || null,
    selectedMowableGeoJSON: quotePayload.selectedMowableGeoJSON || null,
    mowableGeoJSON: quotePayload.mowableGeoJSON || quotePayload.selectedMowableGeoJSON || null,
    estimate,
    final_price: estimate,
    overgrown: quotePayload.overgrown || extras.includes('overgrown_grass'),
    pet_waste_level: extras.includes('pet_waste') ? 'review_needed' : (quotePayload.pet_waste_level || ''),
    limitedAccess: quotePayload.limitedAccess || extras.includes('locked_gate_access_issue'),
  }, form);
}

function checkoutArkansasValidationPoint(payload = {}) {
  const point = parcelLookupPointFromGeometry(state.parcelGeometry) || {
    lat: Number(payload.lat || 0),
    lng: Number(payload.lng || 0),
  };
  return { ...point, state: payload.state || state.currentServiceAddress?.state || '' };
}

function checkoutArkansasValidationAccepted(payload = {}) {
  if (state.selectedServiceLocation) {
    return validateArkansasSelectedServiceLocation(state.selectedServiceLocation).accepted;
  }
  return isLngLatInArkansas(checkoutArkansasValidationPoint(payload));
}

function blockCheckoutOutsideArkansas(resultId = 'quoteResult') {
  showArkansasOnlyPropertyBlock({ resultId, toast: { force: true } });
}

/* ─────────────────────────────────────────────────────────────────────────
   CLOSE HANDLERS — lead request and manual quote panels
───────────────────────────────────────────────────────────────────────── */

checkoutBindOnce(byId('closeleadRequestPanel'), 'click', 'close-lead-request-panel', () => {
  byId('leadRequestPanel')?.classList.add('hidden');
  showQuoteFlowStep('estimate');
  updateQuoteStepper();
});

checkoutBindOnce(byId('closeManualQuotePanel'), 'click', 'close-manual-quote-panel', hideManualQuotePanel);
checkoutBindOnce(byId('cancelManualQuotePanel'), 'click', 'cancel-manual-quote-panel', hideManualQuotePanel);

/* ─────────────────────────────────────────────────────────────────────────
   REQUEST SERVICE BTN — delegated click handler (survives DOM re-renders)
───────────────────────────────────────────────────────────────────────── */

if (!window.__requestServiceDelegatedHandlerBound) {
  window.__requestServiceDelegatedHandlerBound = true;
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#requestServiceBtn');
    if (!btn) return;
    e.preventDefault();
    const form = byId('quoteForm');
    if (!form) { showError('Quote form not found.'); return; }
    try {
      if (!hasActiveMowableArea()) {
        showMissingMowableAreaPrompt('quoteResult');
        return;
      }
      const signature = currentEstimateSignature();
      if (
        !state.pendingQuote?.estimate ||
        !state.currentEstimate ||
        state.currentEstimate.status !== 'fresh' ||
        state.currentEstimate.signature !== signature
      ) {
        await refreshEstimate({ force: true, navigate: false });
      }
      const q = state.pendingQuote || buildQuotePayload(form);

      // Terrain guardrail — block instant booking if terrain requires manual review
      const terrainGuardrail = state.currentEstimate?.terrain?.terrainGuardrail;
      if (terrainGuardrail?.manualReviewRequired) {
        if (typeof renderTerrainGuardrailCard === 'function') {
          renderTerrainGuardrailCard(state.currentEstimate.terrain);
        }
        const card = byId('terrainGuardrailCard');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const missing = bookingContactMissing(q);
      if (missing.length) {
        showBookingContactPanel(q);
        return;
      }
      state.lastQuote = state.pendingQuote || q;
      state.pendingQuote = state.lastQuote;
      await bookQuoteAsJob(btn);
    } catch (error) {
      console.error('[requestServiceBtn] checkout error', error);
      showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
      showError(prettyApiError(error));
    }
  });
}

checkoutBindOnce(byId('manualQuoteBtn'), 'click', 'manual-quote-button', async () => {
  const form = byId('quoteForm');
  if (!form) return;
  try {
    if (!hasActiveMowableArea()) {
      showMissingMowableAreaPrompt('quoteResult');
      return;
    }
    const signature = currentEstimateSignature();
    if (
      !state.pendingQuote?.estimate ||
      !state.currentEstimate ||
      state.currentEstimate.status !== 'fresh' ||
      state.currentEstimate.signature !== signature
    ) {
      await refreshEstimate({ force: true, navigate: false });
    }
    showManualQuotePanel(state.pendingQuote || buildQuotePayload(form));
  } catch (error) {
    showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
    showError(prettyApiError(error));
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   MANUAL QUOTE FORM submit
───────────────────────────────────────────────────────────────────────── */

async function submitManualQuoteRequest(payload) {
  const btn = byId('manualQuoteSubmitBtn');
  const result = byId('manualQuoteResult');
  const originalText = btn?.textContent || 'Submit Request';

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }

  try {
    const requestPayload = {
      ...payload,
      phone: checkoutPhoneForBackend(payload.phone),
      customerPhone: checkoutPhoneForBackend(payload.customerPhone || payload.phone),
    };

    const data = await api('/api/quotes', {
      method: 'POST',
      body: JSON.stringify(requestPayload),
    });

    state.lastQuote = { ...payload, ...data.quote, requestMode: 'manual_quote' };
    state.pendingQuote = state.lastQuote;
    rememberProfilePhoneIfBlank(requestPayload.phone);
    clearPendingManualQuoteSubmission();
    if (result) {
      const quoteId = data.quote?.id ? `<br><span class="meta">Quote ID: ${escapeHtml(data.quote.id)}</span>` : '';
      result.innerHTML = `<strong>${escapeHtml(MANUAL_QUOTE_SUCCESS_MESSAGE)}</strong>${quoteId}<br><span class="meta">No payment was started.</span>`;
      result.classList.remove('hidden');
    }
    showSuccess(MANUAL_QUOTE_SUCCESS_MESSAGE);
    if (isAdmin()) await loadAdmin().catch(() => {});
    return data;
  } catch (err) {
    if (result) {
      result.innerHTML = `<strong>Could not submit:</strong> ${escapeHtml(prettyApiError(err))}`;
      result.classList.remove('hidden');
    }
    showError(prettyApiError(err));
    throw err;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function resumePendingManualQuoteAfterPhoneVerification() {
  if (!checkoutPhoneVerificationState.pendingManualQuoteResume) return false;
  if (checkoutPhoneVerificationState.resumingManualQuote) return true;
  const payload = checkoutPhoneVerificationState.resumeManualQuotePayload;
  if (!payload) {
    clearPendingManualQuoteSubmission();
    return false;
  }
  checkoutPhoneVerificationState.resumingManualQuote = true;
  await submitManualQuoteRequest(payload);
  return true;
}

checkoutBindOnce(byId('manualQuoteForm'), 'submit', 'manual-quote-form-submit', async (e) => {
  e.preventDefault();
  const btn = byId('manualQuoteSubmitBtn');
  const result = byId('manualQuoteResult');
  const originalText = btn?.textContent || 'Submit Request';

  try {
    const payload = buildManualQuoteRequestPayload(e.target);
    if (!checkoutArkansasValidationAccepted(payload)) {
      blockCheckoutOutsideArkansas('manualQuoteResult');
      return;
    }

    const missing = [];
    if (!payload.name) missing.push('name');
    if (!isValidLookingPhone(payload.phone)) missing.push('phone');
    const manualEmail = String(payload.email || '').trim();
    if (manualEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualEmail)) missing.push('a valid email address');
    if (!payload.preferredContactMethod) missing.push('preferred contact method');
    if (missing.length) {
      if (missing.includes('phone')) showPhoneRequiredError('manualQuoteResult');
      else showError(`Add ${missing.join(', ')} to request an in-person quote.`);
      return;
    }
    if (!smsConsentAccepted(payload)) {
      showSmsConsentRequiredError('manualQuoteResult', e.target);
      return;
    }

    const verifiedPhone = checkoutPhoneForBackend(payload.phone || payload.customerPhone || '');
    if (!checkoutPhoneVerificationMatches(verifiedPhone, PHONE_VERIFICATION_PURPOSE_MANUAL_QUOTE)) {
      rememberPendingManualQuoteSubmission({
        ...payload,
        phone: verifiedPhone,
        customerPhone: verifiedPhone,
      });
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending code...';
      }
      try {
        await showPhoneVerificationPanel(verifiedPhone, {
          resultId: 'manualQuoteResult',
          purpose: PHONE_VERIFICATION_PURPOSE_MANUAL_QUOTE,
          message: PHONE_VERIFICATION_CODE_SENT_MESSAGE,
          refreshReason: 'manual-quote-phone-verification-visible',
        });
        showSuccess(PHONE_VERIFICATION_CODE_SENT_MESSAGE);
      } catch (error) {
        clearPendingManualQuoteSubmission();
        const message = phoneVerificationErrorMessage(error);
        if (result) {
          result.innerHTML = `<strong>Could not send verification code:</strong> ${escapeHtml(message)}`;
          result.classList.remove('hidden');
        }
        showError(message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }
      return;
    }

    await submitManualQuoteRequest({
      ...payload,
      phone: verifiedPhone,
      customerPhone: verifiedPhone,
    });
  } catch (err) {
    if (result) {
      result.innerHTML = `<strong>Could not submit:</strong> ${escapeHtml(prettyApiError(err))}`;
      result.classList.remove('hidden');
    }
    showError(prettyApiError(err));
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   LEAD REQUEST FORM — public service request submission
───────────────────────────────────────────────────────────────────────── */

checkoutBindOnce(byId('leadRequestForm'), 'submit', 'lead-request-form-submit', async (e) => {
  e.preventDefault();
  console.log('[Checkout Trace] button click fired');
  console.log('[Checkout Trace] leadRequestForm submit fired');
  const isPayOnsite = e.submitter?.id === 'leadPayOnsiteBtn';
  const btn = isPayOnsite ? byId('leadPayOnsiteBtn') : byId('leadSubmitBtn');

  try {
    const form = e.target;
    const currentServiceAddress = syncServiceAddressFields();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    applySmsConsentToPayload(payload, form);
    Object.assign(payload, currentCheckoutContactAliases({ form, includeBlank: true, visibleOnly: false }));
    const requestAvailableDays = checkedValues('available_days_json', form);

    // Merge in the quote form address/service data from hidden fields
    const quoteForm = byId('quoteForm');
    if (quoteForm) {
      const qd = buildQuotePayload(quoteForm);
      if (Number(qd.mowAreaSqft || 0) <= 0) {
        console.log('[MowNWA Checkout Debug] mowAreaSqft=0, blocking checkout');
        const resultEl = byId('leadRequestResult');
        if (resultEl) {
          resultEl.innerHTML = '<strong>No lawn area selected.</strong> Go back and draw your mowable area first.';
          resultEl.classList.remove('hidden');
        }
        showMissingMowableAreaPrompt('quoteResult');
        return;
      }
      payload.address = currentServiceAddress.address || payload.address || qd.address || '';
      payload.city = currentServiceAddress.city || payload.city || qd.city || '';
      payload.state = currentServiceAddress.state || payload.state || qd.state || 'AR';
      payload.zip = currentServiceAddress.zip || payload.zip || qd.zip || '';
      payload.regionId = payload.regionId || qd.regionId || '';
      payload.serviceType = payload.serviceType || qd.serviceType || 'mowing';
      payload.mowAreaSqft = qd.mowAreaSqft;
      payload.lotAreaSqft = payload.lotAreaSqft || qd.lotAreaSqft || 0;
      payload.quote_type = qd.quote_type || 'instant_mow';
      payload.quoteType = payload.quote_type;
      payload.service_frequency = qd.service_frequency || '';
      payload.grass_height_range = qd.grass_height_range || '';
      payload.selected_yard_areas = checkedValues('selected_yard_areas', quoteForm);
      // Prefer Step 4 (leadRequestForm) values over hidden quoteForm defaults
      payload.gate_size_category = payload.gate_size_category || qd.gate_size_category || '';
      payload.gate_access_type = payload.gate_size_category || qd.gate_size_category || qd.gate_access_type || '';
      console.log('[MowNWA Checkout Debug] Step 4 property fields | gate=' + payload.gate_size_category + ' pets=' + payload.pets + ' obstacles=' + (Array.isArray(payload.obstacles_list) ? payload.obstacles_list.join(',') : payload.obstacles_list || '') + ' notes=' + (payload.notes ? String(payload.notes).slice(0, 60) : ''));
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
      payload.pets = payload.pets || qd.pets || '';
      payload.pet_waste_level = payload.pet_waste_level || qd.pet_waste_level || '';
      const leadObstaclesList = checkedValues('obstacles_list', form).filter((value) => value && value !== 'none');
      payload.obstacles_list = leadObstaclesList.length ? leadObstaclesList : qd.obstacles_list;
      payload.fenced = qd.fenced === true;
      payload.overgrown = qd.overgrown === true;
      payload.obstacles = qd.obstacles === true;
      payload.rushJob = qd.rushJob === true;
      payload.limitedAccess = qd.limitedAccess === true;
      payload.slopedTerrain = qd.slopedTerrain === true;
      payload.denseVegetation = qd.denseVegetation === true;
      payload.gates = qd.gates === true;
      payload.gateHandling = qd.gateHandling === true;
      payload.requested_tasks = checkedValues('requested_tasks', quoteForm);
      payload.included_tasks_json = INCLUDED_MOW_TASKS;
      payload.excluded_tasks_json = EXCLUDED_MOW_TASKS;
      payload.scope_locked = Boolean(qd.standardMowScopeAck);
      MOWABLE_ESTIMATE_FIELDS.forEach((name) => {
        payload[name] = payload[name] || qd[name] || '';
      });
    }

    const estimate = Number(payload.estimatedPrice || state.pendingQuote?.estimate || state.lastQuote?.estimate || 0);
    const bookingQuote = normalizeBookingContact({
      ...(state.pendingQuote || state.lastQuote || {}),
      ...payload,
      ...currentCheckoutContactAliases({ form, includeBlank: true, visibleOnly: false }),
      estimate,
      final_price: estimate,
      scope_locked: true,
      standardMowScopeAck: true,
    });

    console.log('[Checkout Trace] payload built', {
      serviceType: bookingQuote.serviceType,
      hasPhone: Boolean(bookingQuote.phone || bookingQuote.customerPhone),
      hasEmail: Boolean(bookingQuote.email || bookingQuote.customerEmail),
      mowAreaSqft: Number(bookingQuote.mowAreaSqft || 0),
      paymentMethod: isPayOnsite ? 'onsite_cash_check' : 'stripe'
    });
    const missing = bookingContactMissing(bookingQuote);
    console.log('[Checkout Trace] bookingContactMissing result:', missing);
    if (missing.length) {
      if (missing.includes('phone')) showPhoneRequiredError('leadRequestResult');
      else showError(`Add ${missing.join(', ')} to ${isPayOnsite ? 'reserve and pay onsite' : 'continue to secure checkout'}.`);
      return;
    }
    if (isPayOnsite && !smsConsentAccepted(bookingQuote)) {
      showSmsConsentRequiredError('leadRequestResult', form);
      return;
    }

    // Validation passed — disable button now
    if (btn) {
      btn.disabled = true;
      const btnLabel = btn.querySelector('.ui-label') || btn;
      btnLabel.textContent = isPayOnsite ? 'Reserving...' : 'Opening checkout...';
    }

    state.lastQuote = bookingQuote;
    state.pendingQuote = bookingQuote;
    await bookQuoteAsJob(btn, { payOnsite: isPayOnsite });

  } catch (err) {
    const result = byId('leadRequestResult');
    if (result) {
      result.innerHTML = `<strong>Could not submit:</strong> ${escapeHtml(err.message)}`;
      result.classList.remove('hidden');
    }
    showError(err.message);
    if (btn) {
      btn.disabled = false;
      const btnLabel = btn.querySelector('.ui-label') || btn;
      btnLabel.textContent = isPayOnsite ? 'Reserve & Pay Onsite' : 'Book & Pay Securely';
    }
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   QUOTE → JOB BOOKING
───────────────────────────────────────────────────────────────────────── */

function checkoutMetaPixelKeyPart(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180) || 'unknown';
}

function checkoutMetaPixelNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function trackInitiateCheckoutForQuote(payload = {}) {
  const value = checkoutMetaPixelNumber(payload.final_price || payload.estimate || payload.job?.budget);
  const params = {
    content_name: 'Instant Mow Checkout',
    content_category: 'Lawn Service',
    currency: 'USD',
  };
  if (value !== null) params.value = value;
  window.trackMetaEvent?.('InitiateCheckout', params);
}

function trackPurchaseForCheckoutSuccess(session = {}, context = {}) {
  const s = session || {};
  const job = s.job || {};
  const service = s.service || {};
  const sessionId = context.sessionId || s.stripe_checkout_session_id || s.id || '';
  const jobId = context.jobId || s.job_id || job.id || '';
  const keySeed = sessionId || jobId || context.fallbackUrl || window.location.href;
  const storageKey = `mownwa_meta_purchase_tracked_${checkoutMetaPixelKeyPart(keySeed)}`;
  try {
    if (sessionStorage.getItem(storageKey)) return;
    const value = checkoutMetaPixelNumber(s.amount || job.budget || service.estimate, 45);
    window.trackMetaEvent?.('Purchase', {
      content_name: 'Lawn Booking Paid',
      content_category: 'Lawn Service',
      value,
      currency: 'USD',
    });
    sessionStorage.setItem(storageKey, '1');
  } catch (error) {
    const value = checkoutMetaPixelNumber(s.amount || job.budget || service.estimate, 45);
    window.trackMetaEvent?.('Purchase', {
      content_name: 'Lawn Booking Paid',
      content_category: 'Lawn Service',
      value,
      currency: 'USD',
    });
  }
}

function codVerificationJobId(checkout = {}) {
  return checkout.job?.id
    || checkout.jobId
    || checkout.job_id
    || checkout.id
    || checkout.payment?.job_id
    || checkout.payment?.jobId
    || '';
}

function codVerificationPanelHtml(jobId) {
  return `
    <div class="cod-verification-panel stack" data-cod-verification-panel data-job-id="${escapeHtml(jobId || '')}" style="gap:10px">
      <strong>Verify your phone</strong>
      <p class="meta">${PHONE_VERIFICATION_CODE_SENT_MESSAGE}</p>
      <label><span>Verification code</span>${checkoutOtpInputHtml('codVerificationCode')}</label>
      <div class="checkout-action-bar" style="justify-content:flex-start">
        <button class="btn primary small ui-icon-btn" type="button" data-confirm-cod-code>${checkoutUiIcon('circle-check', 'Verify')}</button>
        <button class="btn secondary small ui-icon-btn" type="button" data-resend-cod-code>${checkoutUiIcon('refresh-cw', 'Resend code')}</button>
      </div>
      <p class="meta cod-verification-note">Your job is reserved but won’t be opened until the phone number is verified.</p>
      <div class="meta" data-cod-verification-message></div>
    </div>
  `;
}

const PHONE_VERIFICATION_PURPOSE_COD = 'cod_checkout';
const PHONE_VERIFICATION_PURPOSE_MANUAL_QUOTE = 'manual_quote';
const PHONE_VERIFICATION_UNAVAILABLE_MESSAGE = 'Phone verification is temporarily unavailable. Please try again shortly.';
const checkoutPhoneVerificationState = {
  phone: '',
  purpose: PHONE_VERIFICATION_PURPOSE_COD,
  verifiedAt: 0,
  resendLockedUntil: 0,
  pendingCodResume: false,
  resumingCodBooking: false,
  resumeButtonId: '',
  resumeQuote: null,
  pendingManualQuoteResume: false,
  resumingManualQuote: false,
  resumeManualQuotePayload: null,
};

function phoneVerificationErrorMessage(error) {
  if (
    error?.data?.code === 'PHONE_VERIFICATION_UNAVAILABLE'
    || error?.status === 502
    || error?.status === 503
  ) {
    return PHONE_VERIFICATION_UNAVAILABLE_MESSAGE;
  }
  return prettyApiError(error);
}

function checkoutPhoneVerificationPhone(value) {
  return checkoutPhoneForBackend(value);
}

function checkoutPhoneVerificationMatches(value, purpose = PHONE_VERIFICATION_PURPOSE_COD) {
  const phone = checkoutPhoneVerificationPhone(value);
  return Boolean(
    phone
    && checkoutPhoneVerificationState.phone === phone
    && checkoutPhoneVerificationState.purpose === purpose
    && checkoutPhoneVerificationState.verifiedAt
    && Date.now() - checkoutPhoneVerificationState.verifiedAt < 30 * 60 * 1000
  );
}

function rememberPendingCodBookingResume(button) {
  const quote = state.lastQuote || state.pendingQuote || null;
  checkoutPhoneVerificationState.pendingCodResume = true;
  checkoutPhoneVerificationState.resumingCodBooking = false;
  checkoutPhoneVerificationState.resumeButtonId = button?.id || 'leadPayOnsiteBtn';
  checkoutPhoneVerificationState.resumeQuote = quote ? { ...quote } : null;
}

function clearPendingCodBookingResume() {
  checkoutPhoneVerificationState.pendingCodResume = false;
  checkoutPhoneVerificationState.resumingCodBooking = false;
  checkoutPhoneVerificationState.resumeButtonId = '';
  checkoutPhoneVerificationState.resumeQuote = null;
}

function rememberPendingManualQuoteSubmission(payload) {
  checkoutPhoneVerificationState.pendingManualQuoteResume = true;
  checkoutPhoneVerificationState.resumingManualQuote = false;
  checkoutPhoneVerificationState.resumeManualQuotePayload = payload ? { ...payload } : null;
}

function clearPendingManualQuoteSubmission() {
  checkoutPhoneVerificationState.pendingManualQuoteResume = false;
  checkoutPhoneVerificationState.resumingManualQuote = false;
  checkoutPhoneVerificationState.resumeManualQuotePayload = null;
}

function clearPendingPhoneVerificationResumes() {
  clearPendingCodBookingResume();
  clearPendingManualQuoteSubmission();
}

async function resumePendingCodBookingAfterPhoneVerification() {
  if (!checkoutPhoneVerificationState.pendingCodResume) return false;
  if (checkoutPhoneVerificationState.resumingCodBooking) return true;

  checkoutPhoneVerificationState.resumingCodBooking = true;
  if (!state.lastQuote && checkoutPhoneVerificationState.resumeQuote) {
    state.lastQuote = checkoutPhoneVerificationState.resumeQuote;
  }
  if (!state.pendingQuote && checkoutPhoneVerificationState.resumeQuote) {
    state.pendingQuote = checkoutPhoneVerificationState.resumeQuote;
  }

  const btn = byId(checkoutPhoneVerificationState.resumeButtonId) || byId('leadPayOnsiteBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Reserving...';
  }

  try {
    await bookQuoteAsJob(btn, { payOnsite: true });
    return true;
  } finally {
    clearPendingCodBookingResume();
  }
}

function phoneVerificationPanelHtml(phone, message = '', purpose = PHONE_VERIFICATION_PURPOSE_COD) {
  return `
    <div class="cod-verification-panel stack" data-phone-verification-panel data-phone="${escapeHtml(phone || '')}" data-purpose="${escapeHtml(purpose || PHONE_VERIFICATION_PURPOSE_COD)}" style="gap:10px">
      <strong>Verify your phone</strong>
      <p class="meta">${escapeHtml(message || PHONE_VERIFICATION_CODE_SENT_MESSAGE)}</p>
      <label><span>Verification code</span>${checkoutOtpInputHtml('phoneVerificationCode')}</label>
      <div class="checkout-action-bar" style="justify-content:flex-start">
        <button class="btn primary small ui-icon-btn" type="button" data-confirm-phone-code>${checkoutUiIcon('circle-check', 'Verify')}</button>
        <button class="btn secondary small ui-icon-btn" type="button" data-resend-phone-code>${checkoutUiIcon('refresh-cw', 'Resend code')}</button>
      </div>
      <div class="meta" data-phone-verification-message>${escapeHtml(message || '')}</div>
    </div>
  `;
}

async function showPhoneVerificationPanel(phone, options = {}) {
  const resultEl = byId(options.resultId || 'leadRequestResult');
  const purpose = options.purpose || PHONE_VERIFICATION_PURPOSE_COD;
  const normalizedPhone = checkoutPhoneVerificationPhone(phone);
  if (!resultEl || !normalizedPhone) return false;
  resultEl.innerHTML = phoneVerificationPanelHtml(normalizedPhone, options.message || PHONE_VERIFICATION_CODE_SENT_MESSAGE, purpose);
  resultEl.classList.remove('hidden');
  checkoutRefreshMapPreview(options.refreshReason || 'phone-verification-panel-visible');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const data = await api('/api/phone-verification/start', {
    method: 'POST',
    body: JSON.stringify({ phone: normalizedPhone, purpose }),
  });
  const messageEl = resultEl.querySelector('[data-phone-verification-message]');
  if (messageEl) messageEl.textContent = data.message || PHONE_VERIFICATION_CODE_SENT_MESSAGE;
  checkoutPhoneVerificationState.phone = normalizedPhone;
  checkoutPhoneVerificationState.purpose = purpose;
  checkoutPhoneVerificationState.verifiedAt = 0;
  checkoutPhoneVerificationState.resendLockedUntil = Date.now() + 60 * 1000;
  const codeInput = resultEl.querySelector('input[name="phoneVerificationCode"]');
  codeInput?.focus();
  checkoutScrollFieldIntoView(codeInput, { delay: 160 });
  return true;
}

async function showPhoneVerificationPanelForCod(phone) {
  return showPhoneVerificationPanel(phone, {
    resultId: 'leadRequestResult',
    purpose: PHONE_VERIFICATION_PURPOSE_COD,
    message: PHONE_VERIFICATION_CODE_SENT_MESSAGE,
    refreshReason: 'phone-verification-panel-visible',
  });
}

function checkoutIsMobileViewport() {
  return window.matchMedia?.('(max-width: 640px)').matches || window.innerWidth <= 640;
}

function checkoutScrollFieldIntoView(field, options = {}) {
  if (!field || !field.isConnected || !checkoutIsMobileViewport()) return;
  if (!field.closest?.('#leadRequestForm, [data-cod-verification-panel], [data-phone-verification-panel]')) return;
  const delay = Number.isFinite(options.delay) ? options.delay : 90;
  window.setTimeout(() => {
    if (!field.isConnected || !checkoutIsMobileViewport()) return;
    field.scrollIntoView({
      behavior: options.behavior || 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  }, delay);
}

function showCodVerificationPanel(checkout = {}) {
  const resultEl = byId('leadRequestResult');
  if (!resultEl) return;
  const jobId = codVerificationJobId(checkout);
  resultEl.innerHTML = codVerificationPanelHtml(jobId);
  resultEl.classList.remove('hidden');
  checkoutRefreshMapPreview('cod-verification-panel-visible');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const codeInput = resultEl.querySelector('input[name="codVerificationCode"]');
  codeInput?.focus();
  checkoutScrollFieldIntoView(codeInput, { delay: 160 });
}

function checkoutHideFlowForCodSuccess() {
  $$('[data-quote-step-panel]').forEach((panel) => {
    panel.classList.remove('is-active');
    panel.classList.add('is-hidden', 'hidden');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
  });
  ['leadRequestPanel', 'manualQuotePanel'].forEach((id) => {
    const panel = byId(id);
    if (!panel) return;
    panel.classList.add('hidden');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
  });
  byId('liveBidPanel')?.classList.add('hidden');
  ['accountRecommendPanel', 'checkoutCancelPanel'].forEach((id) => {
    const panel = byId(id);
    if (!panel) return;
    panel.classList.add('hidden');
    panel.style.display = 'none';
  });
  const stepper = byId('quoteStepper');
  if (stepper) stepper.style.display = 'none';
  const leadResult = byId('leadRequestResult');
  if (leadResult) {
    leadResult.innerHTML = '';
    leadResult.classList.add('hidden');
  }
}

function hideCodSuccessPanel() {
  const successPanel = byId('checkoutSuccessPanel');
  if (successPanel) {
    successPanel.style.display = 'none';
    successPanel.classList.add('hidden');
  }
  const stepper = byId('quoteStepper');
  if (stepper) stepper.style.display = '';
}

function checkoutRestoreQuoteFlowStart() {
  const stepper = byId('quoteStepper');
  if (stepper) stepper.style.display = '';
  hideCodSuccessPanel();
  if (typeof setServiceFlow === 'function') setServiceFlow('instant_mow');
  checkoutUseAppView('quote');
  checkoutUseQuoteStep('property', { scroll: true });
}

async function renderCodVerifiedSuccess(response = {}, options = {}) {
  const isLoggedIn = typeof hasActiveSession === 'function' && hasActiveSession();
  const job = response.job || {};
  const jobId = options.jobId || response.jobId || response.job_id || job.id || '';
  const successPanel = byId('checkoutSuccessPanel');

  if (!successPanel) {
    if (options.allowReloadFallback !== false) window.location.href = '/?cod_verified=1';
    return false;
  }

  checkoutUseAppView('quote');
  checkoutHideFlowForCodSuccess();

  successPanel.hidden = false;
  successPanel.style.display = '';
  successPanel.classList.remove('hidden');
  successPanel.setAttribute('aria-hidden', 'false');
  successPanel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Job confirmed</h2>
        <p class="section-copy" style="margin:0">Your onsite-payment job is confirmed.</p>
      </div>
    </div>
    <div style="padding:4px 0">
      <div class="estimate-card" style="margin:0">
        <div class="estimate-head">
          <div>
            <span class="pill">Onsite payment confirmed</span>
            <h3>Your onsite-payment job is confirmed.</h3>
            <p>We'll review the details and contact you if anything else is needed.</p>
          </div>
        </div>
        <div class="final-review" style="margin-top:12px">
          <h4>${isLoggedIn ? 'Track this job from your account' : 'Create an account to track this job'}</h4>
          <p class="meta">${isLoggedIn
            ? 'Open your jobs list to see this booking and future updates.'
            : 'Create or sign in to an account so you can track this job and manage future bookings.'}</p>
          ${jobId ? `<p class="meta">Booking ID: <strong>${escapeHtml(jobId)}</strong></p>` : ''}
        </div>
        <div class="quote-support-row quote-support-row--left" aria-label="Booking support">
          <img src="/assets/icons/lucide/life-buoy.svg" alt="" class="contact-icon">
          <span>Questions about this booking?</span>
          <span class="contact-link-pair"><a href="tel:4792740412">Call</a><span>or</span><a href="sms:4792740412">text 479-274-0412</a></span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          ${isLoggedIn
            ? `<button class="btn primary small ui-icon-btn" type="button" data-cod-success-action="jobs">${checkoutUiIcon('clipboard-check', 'View My Jobs')}</button>`
            : `<button class="btn primary small ui-icon-btn" type="button" data-cod-success-action="account">${checkoutUiIcon('user', 'Create account to track this job')}</button>
               <button class="btn secondary small ui-icon-btn" type="button" data-cod-success-action="home">${checkoutUiIcon('home', 'Continue as guest')}</button>`}
          <button class="btn ghost small ui-icon-btn" type="button" data-cod-success-action="another">${checkoutUiIcon('calculator', 'Get another quote')}</button>
          <button class="btn ghost small ui-icon-btn" type="button" data-cod-success-action="home">${checkoutUiIcon('home', 'Back to home')}</button>
        </div>
      </div>
    </div>`;

  successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showSuccess(response.message || 'Your onsite-payment job is confirmed.');

  if (isLoggedIn && typeof loadMyJobs === 'function') {
    await loadMyJobs().catch(() => {});
  }
  clearCheckoutPii({ reason: 'completed-cod-checkout', clearAddress: true });
  return true;
}

function handleCodSuccessAction(action) {
  if (action === 'jobs') {
    hideCodSuccessPanel();
    if (typeof showAccountPanel === 'function') {
      showAccountPanel('jobs');
      return;
    }
    if (typeof checkoutUseAppView === 'function') checkoutUseAppView('jobs');
    return;
  }
  if (action === 'account') {
    if (typeof toggleAuthPanel === 'function') {
      toggleAuthPanel(true);
      return;
    }
    byId('openAuth')?.click();
    return;
  }
  if (action === 'another') {
    clearCheckoutPii({ reason: 'cod-start-another', clearAddress: true });
    checkoutRestoreQuoteFlowStart();
    return;
  }
  if (action === 'home') {
    clearCheckoutPii({ reason: 'cod-home', clearAddress: true });
    hideCodSuccessPanel();
    checkoutUseAppView('dashboard');
  }
}

function isCheckoutAccountContactConflict(error) {
  return error?.status === 409 || error?.data?.code === 'ACCOUNT_CONTACT_CONFLICT';
}

function checkoutContactInputSelectors(field) {
  return field === 'phone'
    ? [
        '#leadRequestForm [name="customerPhone"]',
        '#leadRequestForm [name="phone"]',
        '#manualQuoteForm [name="phone"]',
        '#quoteForm [name="customerPhone"]',
        '#quoteForm [name="phone"]',
      ]
    : [
        '#leadRequestForm [name="customerEmail"]',
        '#leadRequestForm [name="email"]',
        '#manualQuoteForm [name="email"]',
        '#quoteForm [name="customerEmail"]',
        '#quoteForm [name="email"]',
      ];
}

function checkoutInputVisible(input) {
  return Boolean(input && input.type !== 'hidden' && (input.offsetWidth || input.offsetHeight || input.getClientRects().length));
}

function findCheckoutContactInput(field, options = {}) {
  const selectors = checkoutContactInputSelectors(field);
  const roots = options.form ? [options.form] : [];
  roots.push(document);

  for (const root of roots) {
    const candidates = selectors.flatMap((selector) => Array.from(root.querySelectorAll?.(selector) || []));
    const input = options.visibleOnly
      ? candidates.find((candidate) => checkoutInputVisible(candidate))
      : candidates[0];
    if (input) return input;
  }
  return null;
}

function currentCheckoutContactAliases(options = {}) {
  const includeBlank = Boolean(options.includeBlank);
  const visibleOnly = options.visibleOnly !== false && !options.form;
  const emailInput = findCheckoutContactInput('email', { form: options.form, visibleOnly });
  const phoneInput = findCheckoutContactInput('phone', { form: options.form, visibleOnly });
  const contact = {};

  if (emailInput) {
    const email = String(emailInput.value || '').trim().toLowerCase();
    emailInput.value = email;
    if (includeBlank || email) {
      contact.email = email;
      contact.customerEmail = email;
    }
  }

  if (phoneInput) {
    const phone = typeof normalizeUsPhoneInput === 'function'
      ? normalizeUsPhoneInput(phoneInput)
      : String(phoneInput.value || '').trim();
    phoneInput.value = phone;
    if (includeBlank || phone) {
      contact.phone = phone;
      contact.customerPhone = phone;
    }
  }

  return contact;
}

function checkoutConflictField(error) {
  const field = error?.data?.field || error?.field || '';
  return field === 'phone' ? 'phone' : 'email';
}

function focusCheckoutConflictField(field) {
  document.querySelectorAll('[data-checkout-contact-conflict="true"]').forEach((input) => {
    input.removeAttribute('aria-invalid');
    input.style.borderColor = '';
    input.removeAttribute('data-checkout-contact-conflict');
  });

  const input = findCheckoutContactInput(field, { visibleOnly: true }) || findCheckoutContactInput(field);
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('data-checkout-contact-conflict', 'true');
  input.style.borderColor = 'var(--danger, #b91c1c)';
  input.focus?.();
}

function openCheckoutConflictSignIn() {
  if (typeof toggleAuthPanel === 'function') {
    toggleAuthPanel(true);
    return;
  }
  byId('openAuth')?.click();
}

function showCheckoutAccountContactConflict(error) {
  const message = prettyApiError(error);
  const field = checkoutConflictField(error);
  const resultEl = byId('leadRequestResult');
  if (resultEl) {
    resultEl.innerHTML = `<strong>Sign in needed.</strong><br>${escapeHtml(message)} <button type="button" class="link-btn" data-checkout-conflict-signin>Sign in</button>`;
    resultEl.dataset.checkoutContactConflict = 'true';
    resultEl.classList.remove('hidden');
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    checkoutBindOnce(resultEl.querySelector('[data-checkout-conflict-signin]'), 'click', 'checkout-conflict-signin', openCheckoutConflictSignIn);
  }
  showResult('quoteResult', `<strong>Sign in needed:</strong> ${escapeHtml(message)}`);
  showError(message);
  focusCheckoutConflictField(field);
}

function clearCheckoutContactConflict() {
  document.querySelectorAll('[data-checkout-contact-conflict="true"]').forEach((input) => {
    input.removeAttribute('aria-invalid');
    input.style.borderColor = '';
    input.removeAttribute('data-checkout-contact-conflict');
  });

  const resultEl = byId('leadRequestResult');
  if (resultEl?.dataset.checkoutContactConflict === 'true') {
    resultEl.innerHTML = '';
    resultEl.classList.add('hidden');
    delete resultEl.dataset.checkoutContactConflict;
  }

  const submitBtn = byId('leadSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = false;
    const submitLabel = submitBtn.querySelector('.ui-label');
    if (submitLabel) submitLabel.textContent = 'Book & Pay Securely';
  }
  const payOnsiteBtn = byId('leadPayOnsiteBtn');
  if (payOnsiteBtn) {
    payOnsiteBtn.disabled = false;
    const payOnsiteLabel = payOnsiteBtn.querySelector('.ui-label');
    if (payOnsiteLabel) payOnsiteLabel.textContent = 'Reserve & Pay Onsite';
  }
}

checkoutBindOnce(document, 'input', 'checkout-contact-conflict-clear-input', (event) => {
  const target = event.target;
  const autocomplete = String(target?.getAttribute?.('autocomplete') || '').toLowerCase();
  const name = String(target?.getAttribute?.('name') || '').toLowerCase();
  const id = String(target?.getAttribute?.('id') || '').toLowerCase();
  if (target?.hasAttribute?.('data-otp') || autocomplete.includes('one-time-code') || name.includes('code') || id.includes('code')) {
    const digits = checkoutVerificationCodeValue(target);
    if (target.value !== digits) target.value = digits;
    return;
  }
  if (!event.target?.matches?.('input[name="customerEmail"], input[name="email"], input[name="customerPhone"], input[name="phone"]')) return;
  if (!event.target.closest?.('#leadRequestForm, #manualQuoteForm, #quoteForm')) return;
  if (event.target.matches('input[name="customerPhone"], input[name="phone"]')) {
    checkoutPhoneVerificationState.verifiedAt = 0;
    clearPendingPhoneVerificationResumes();
  }
  clearCheckoutContactConflict();
});

checkoutBindOnce(document, 'change', 'checkout-contact-conflict-clear-change', (event) => {
  const target = event.target;
  const autocomplete = String(target?.getAttribute?.('autocomplete') || '').toLowerCase();
  const name = String(target?.getAttribute?.('name') || '').toLowerCase();
  const id = String(target?.getAttribute?.('id') || '').toLowerCase();
  if (target?.hasAttribute?.('data-otp') || autocomplete.includes('one-time-code') || name.includes('code') || id.includes('code')) return;
  if (!event.target?.matches?.('input[name="customerEmail"], input[name="email"], input[name="customerPhone"], input[name="phone"]')) return;
  if (!event.target.closest?.('#leadRequestForm, #manualQuoteForm, #quoteForm')) return;
  if (event.target.matches('input[name="customerPhone"], input[name="phone"]')) {
    checkoutPhoneVerificationState.verifiedAt = 0;
    clearPendingPhoneVerificationResumes();
  }
  clearCheckoutContactConflict();
});

document.addEventListener('turflynk:auth-identity-change', (event) => {
  const reason = event.detail?.reason || 'account-switch';
  clearCheckoutPii({ reason, clearAddress: true });
});

checkoutBindOnce(document, 'focusin', 'checkout-scroll-focused-field', (event) => {
  const field = event.target;
  if (!field?.matches?.('input, select, textarea')) return;
  checkoutScrollFieldIntoView(field);
});

checkoutBindOnce(document, 'click', 'checkout-cod-success-actions', (event) => {
  const button = event.target.closest?.('[data-cod-success-action]');
  if (!button) return;
  event.preventDefault();
  handleCodSuccessAction(button.dataset.codSuccessAction || '');
});

checkoutBindOnce(document, 'click', 'checkout-phone-verification-actions', async (event) => {
  const confirmPhoneBtn = event.target.closest('[data-confirm-phone-code]');
  const resendPhoneBtn = event.target.closest('[data-resend-phone-code]');
  if (!confirmPhoneBtn && !resendPhoneBtn) return;

  const panel = event.target.closest('[data-phone-verification-panel]');
  const phone = panel?.dataset?.phone || checkoutPhoneVerificationState.phone || '';
  const purpose = panel?.dataset?.purpose || checkoutPhoneVerificationState.purpose || PHONE_VERIFICATION_PURPOSE_COD;
  const messageEl = panel?.querySelector('[data-phone-verification-message]');
  if (!panel || !phone) return;

  try {
    if (confirmPhoneBtn) {
      const code = checkoutVerificationCodeValue(panel.querySelector('input[name="phoneVerificationCode"]'));
      if (!/^\d{4,10}$/.test(code)) {
        if (messageEl) messageEl.textContent = 'Enter the code from your text message.';
        return;
      }
      confirmPhoneBtn.disabled = true;
      const data = await api('/api/phone-verification/check', {
        method: 'POST',
        body: JSON.stringify({ phone, code, purpose }),
      });
      checkoutPhoneVerificationState.phone = checkoutPhoneVerificationPhone(phone);
      checkoutPhoneVerificationState.purpose = purpose;
      checkoutPhoneVerificationState.verifiedAt = Date.now();
      if (messageEl) messageEl.textContent = purpose === PHONE_VERIFICATION_PURPOSE_MANUAL_QUOTE
        ? 'Phone verified. Submitting your in-person quote request...'
        : 'Phone verified. Reserving your onsite-payment job...';
      showSuccess(data.message || 'Phone verified');
      const resumed = purpose === PHONE_VERIFICATION_PURPOSE_MANUAL_QUOTE
        ? await resumePendingManualQuoteAfterPhoneVerification()
        : await resumePendingCodBookingAfterPhoneVerification();
      if (!resumed) {
        if (messageEl) messageEl.textContent = purpose === PHONE_VERIFICATION_PURPOSE_MANUAL_QUOTE
          ? 'Phone verified. Select Submit Request to continue.'
          : 'Phone verified. Select Reserve & Pay Onsite to continue.';
        if (purpose === PHONE_VERIFICATION_PURPOSE_MANUAL_QUOTE) byId('manualQuoteSubmitBtn')?.focus();
        else byId('leadPayOnsiteBtn')?.focus();
      }
      return;
    }

    if (Date.now() < Number(checkoutPhoneVerificationState.resendLockedUntil || 0)) {
      if (messageEl) messageEl.textContent = 'Please wait before requesting another code.';
      return;
    }
    resendPhoneBtn.disabled = true;
    const data = await api('/api/phone-verification/start', {
      method: 'POST',
      body: JSON.stringify({ phone, purpose }),
    });
    checkoutPhoneVerificationState.resendLockedUntil = Date.now() + 60 * 1000;
    if (messageEl) messageEl.textContent = data.message || PHONE_VERIFICATION_CODE_SENT_MESSAGE;
    showSuccess(data.message || PHONE_VERIFICATION_CODE_SENT_MESSAGE);
  } catch (error) {
    const unavailable = error?.data?.code === 'PHONE_VERIFICATION_UNAVAILABLE' || error?.status === 502 || error?.status === 503;
    const message = confirmPhoneBtn && !unavailable
      ? 'We could not verify that code. Please try again.'
      : phoneVerificationErrorMessage(error);
    if (messageEl) messageEl.textContent = message;
    showError(message);
  } finally {
    if (confirmPhoneBtn) confirmPhoneBtn.disabled = false;
    if (resendPhoneBtn) setTimeout(() => { resendPhoneBtn.disabled = false; }, 1000);
  }
});

checkoutBindOnce(document, 'click', 'checkout-cod-verification-actions', async (event) => {
  const confirmBtn = event.target.closest('[data-confirm-cod-code]');
  const resendBtn = event.target.closest('[data-resend-cod-code]');
  if (!confirmBtn && !resendBtn) return;

  const panel = event.target.closest('[data-cod-verification-panel]');
  const jobId = panel?.dataset?.jobId || '';
  const messageEl = panel?.querySelector('[data-cod-verification-message]');
  if (!panel || !jobId) return;

  try {
    if (confirmBtn) {
      const code = checkoutVerificationCodeValue(panel.querySelector('input[name="codVerificationCode"]'));
      if (!/^\d{6}$/.test(code)) {
        if (messageEl) messageEl.textContent = 'Enter the 6-digit code from your text message.';
        return;
      }
      confirmBtn.disabled = true;
      const data = await api(`/api/jobs/${encodeURIComponent(jobId)}/verify-cod`, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      await renderCodVerifiedSuccess(data, { jobId });
      return;
    }

    resendBtn.disabled = true;
    const data = await api(`/api/jobs/${encodeURIComponent(jobId)}/resend-cod-code`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (messageEl) messageEl.textContent = data.message || 'A new verification code was sent.';
    showSuccess(data.message || 'A new verification code was sent.');
  } catch (error) {
    const message = phoneVerificationErrorMessage(error);
    if (messageEl) messageEl.textContent = message;
    showError(message);
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
    if (resendBtn) setTimeout(() => { resendBtn.disabled = false; }, 1000);
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   RESERVE & PAY ONSITE — separate consent + verification flow
───────────────────────────────────────────────────────────────────────── */

function onsiteConsentPanelHtml(quote) {
  const estimate = Number(quote.estimate || quote.final_price || 0);
  const address = quote.address || '';
  return `
    <div class="onsite-consent-panel stack" data-onsite-consent-panel style="gap:12px;padding:12px 0">
      <strong style="font-size:1.05em">Reserve &amp; Pay Onsite</strong>
      ${estimate > 0 ? `<div class="price-hero compact" style="margin:0"><span>Estimate</span><strong>${escapeHtml(money(estimate))}</strong></div>` : ''}
      ${address ? `<p class="meta" style="margin:0">${escapeHtml(address)}</p>` : ''}
      <p class="meta" style="margin:0">Cash or check is collected at time of service. Phone verification is required before your reservation is confirmed.</p>
      <label class="sms-consent-control">
        <input type="checkbox" id="onsiteSmsConsentCheck" data-onsite-sms-consent />
        <span>${escapeHtml(SMS_CONSENT_TEXT)}</span>
      </label>
      <div id="onsiteConsentError" class="result hidden" style="margin-top:4px"></div>
      <div class="checkout-action-bar" style="margin-top:4px">
        <button class="btn primary small ui-icon-btn" type="button" id="onsiteConfirmReserveBtn" data-onsite-confirm-reserve>${checkoutUiIcon('circle-check', 'Confirm &amp; Verify Phone')}</button>
        <button class="btn ghost small ui-icon-btn" type="button" data-onsite-cancel-consent>${checkoutUiIcon('x', 'Cancel')}</button>
      </div>
    </div>
  `;
}

checkoutBindOnce(byId('leadPayOnsiteBtn'), 'click', 'lead-pay-onsite-btn-click', async () => {
  const form = byId('leadRequestForm');
  if (!form) return;
  try {
    const currentServiceAddress = syncServiceAddressFields();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    Object.assign(payload, currentCheckoutContactAliases({ form, includeBlank: true, visibleOnly: false }));
    const requestAvailableDays = checkedValues('available_days_json', form);

    const quoteForm = byId('quoteForm');
    if (quoteForm) {
      const qd = buildQuotePayload(quoteForm);
      if (Number(qd.mowAreaSqft || 0) <= 0) {
        showMissingMowableAreaPrompt('quoteResult');
        return;
      }
      payload.address = currentServiceAddress.address || payload.address || qd.address || '';
      payload.city = currentServiceAddress.city || payload.city || qd.city || '';
      payload.state = currentServiceAddress.state || payload.state || qd.state || 'AR';
      payload.zip = currentServiceAddress.zip || payload.zip || qd.zip || '';
      payload.regionId = payload.regionId || qd.regionId || '';
      payload.serviceType = payload.serviceType || qd.serviceType || 'mowing';
      payload.mowAreaSqft = qd.mowAreaSqft;
      payload.lotAreaSqft = payload.lotAreaSqft || qd.lotAreaSqft || 0;
      payload.quote_type = qd.quote_type || 'instant_mow';
      payload.available_days_json = requestAvailableDays.length
        ? requestAvailableDays
        : checkedValues('available_days_json', quoteForm);
      MOWABLE_ESTIMATE_FIELDS.forEach((name) => {
        payload[name] = payload[name] || qd[name] || '';
      });
    }

    const estimate = Number(payload.estimatedPrice || state.pendingQuote?.estimate || state.lastQuote?.estimate || 0);
    const bookingQuote = normalizeBookingContact({
      ...(state.pendingQuote || state.lastQuote || {}),
      ...payload,
      ...currentCheckoutContactAliases({ form, includeBlank: true, visibleOnly: false }),
      estimate,
      final_price: estimate,
    });

    const missing = bookingContactMissing(bookingQuote);
    if (missing.length) {
      if (missing.includes('phone')) showPhoneRequiredError('leadRequestResult');
      else showError(`Add ${missing.join(', ')} to reserve onsite.`);
      return;
    }

    state.lastQuote = bookingQuote;
    state.pendingQuote = bookingQuote;

    const resultEl = byId('leadRequestResult');
    if (resultEl) {
      resultEl.innerHTML = onsiteConsentPanelHtml(bookingQuote);
      resultEl.classList.remove('hidden');
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (err) {
    showError(err.message || 'Could not open onsite reservation.');
  }
});

checkoutBindOnce(document, 'click', 'onsite-confirm-reserve', async (event) => {
  if (!event.target.closest('[data-onsite-confirm-reserve]')) return;
  const panel = event.target.closest('[data-onsite-consent-panel]');
  const consentCheck = panel?.querySelector('[data-onsite-sms-consent]') || byId('onsiteSmsConsentCheck');
  const errorEl = panel?.querySelector('#onsiteConsentError') || byId('onsiteConsentError');
  if (!consentCheck?.checked) {
    if (errorEl) {
      errorEl.textContent = SMS_CONSENT_REQUIRED_MESSAGE;
      errorEl.classList.remove('hidden');
    }
    showError(SMS_CONSENT_REQUIRED_MESSAGE);
    consentCheck?.focus();
    return;
  }
  if (state.lastQuote) {
    state.lastQuote.smsConsent = true;
    state.lastQuote.sms_consent = true;
    state.lastQuote.smsConsentText = SMS_CONSENT_TEXT;
  }
  if (state.pendingQuote) {
    state.pendingQuote.smsConsent = true;
    state.pendingQuote.sms_consent = true;
    state.pendingQuote.smsConsentText = SMS_CONSENT_TEXT;
  }
  const confirmBtn = event.target.closest('[data-onsite-confirm-reserve]');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Reserving...'; }
  await bookQuoteAsJob(byId('leadPayOnsiteBtn'), { payOnsite: true });
});

checkoutBindOnce(document, 'click', 'onsite-cancel-consent', (event) => {
  if (!event.target.closest('[data-onsite-cancel-consent]')) return;
  const resultEl = byId('leadRequestResult');
  if (resultEl) { resultEl.innerHTML = ''; resultEl.classList.add('hidden'); }
});

async function bookQuoteAsJob(explicitBtn, options = {}) {
  if (!state.lastQuote && state.pendingQuote) {
    state.lastQuote = state.pendingQuote;
  }

  if (!state.lastQuote) {
    showResult('quoteResult', '<strong>Get an estimate, then continue to secure checkout.</strong>');
    return;
  }

  const btn = explicitBtn || byId('bookJobBtn') || byId('leadSubmitBtn') || byId('requestServiceBtn');
  const payOnsite = Boolean(options.payOnsite);
  const btnLabel = btn?.querySelector?.('.ui-label');
  const originalText = payOnsite
    ? 'Reserve & Pay Onsite'
    : btn?.id === 'leadSubmitBtn' ? 'Book & Pay Securely' : (btnLabel?.textContent || btn?.textContent || 'Continue to Secure Checkout');
  console.log('[MowNWA Checkout Debug] bookQuoteAsJob start | btn=' + (btn?.id || 'none'));

  try {
    const q = normalizeBookingContact({
      ...state.lastQuote,
      ...currentCheckoutContactAliases(),
    });
    if (!checkoutArkansasValidationAccepted(q)) {
      blockCheckoutOutsideArkansas('leadRequestResult');
      return;
    }

    const missing = bookingContactMissing(q);
    if (missing.length) {
      showBookingContactPanel(q);
      if (missing.includes('phone')) {
        showPhoneRequiredError('leadRequestResult');
      } else {
        showWarning(`Add ${missing.join(', ')} to continue to secure checkout.`);
      }
      if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
      return;
    }
    if (payOnsite && !smsConsentAccepted(q)) {
      showBookingContactPanel(q);
      showSmsConsentRequiredError('leadRequestResult', byId('leadRequestForm'));
      if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
      return;
    }
    if (payOnsite && !checkoutPhoneVerificationMatches(q.phone || q.customerPhone || '')) {
      if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
      rememberPendingCodBookingResume(btn);
      try {
        await showPhoneVerificationPanelForCod(q.phone || q.customerPhone || '');
        showSuccess(PHONE_VERIFICATION_CODE_SENT_MESSAGE);
      } catch (error) {
        clearPendingCodBookingResume();
        const resultEl = byId('leadRequestResult');
        const message = phoneVerificationErrorMessage(error);
        if (resultEl) {
          resultEl.innerHTML = `<strong>Could not send verification code:</strong> ${escapeHtml(message)}`;
          resultEl.classList.remove('hidden');
        }
        showError(message);
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      const loadingLabel = btn.querySelector('.ui-label') || btn;
      loadingLabel.textContent = payOnsite ? 'Reserving...' : 'Opening checkout...';
    }

    const svcLabel = q.serviceType
      ? String(q.serviceType).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
      : 'Mowing';
    const currentScopeFields = currentJobScopeSnapshotFields();
    const backendPhone = checkoutPhoneForBackend(q.phone || q.customerPhone || '');

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
      title: `${svcLabel} — ${q.address || 'Property'}`,
      customerName: q.customerName || q.name || '',
      customerPhone: backendPhone,
      customerEmail: q.email || q.customerEmail || '',
      name: q.name || q.customerName || '',
      phone: backendPhone,
      email: q.email || q.customerEmail || '',
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
      parcelId: q.parcelId || currentScopeFields.parcelId || '',
      parcelLabel: q.parcelLabel || currentScopeFields.parcelLabel || '',
      addressLabel: q.addressLabel || currentScopeFields.addressLabel || '',

      // Critical for server-side Stripe pricing.
      // The checkout route recalculates from mowAreaSqft/settings and must not receive zero area.
      mowAreaSqft: Number(q.mowAreaSqft || 0),
      lotAreaSqft: Number(q.lotAreaSqft || 0),
      areaSqft: Number(q.mowAreaSqft || 0),

      final_price: Number(q.estimate || 0),
      payment_status: payOnsite ? 'onsite_pending' : 'checkout_pending',
      payment_method: payOnsite ? 'onsite_cash_check' : 'stripe',
      smsConsent: true,
      sms_consent: true,
      smsConsentText: SMS_CONSENT_TEXT,
      sms_consent_text: SMS_CONSENT_TEXT,
      scope_locked: true,
      included_tasks_json: INCLUDED_MOW_TASKS,
      excluded_tasks_json: EXCLUDED_MOW_TASKS,
      parcelGeoJSON: q.parcelGeoJSON || currentScopeFields.parcelGeoJSON,
      selectedMowableGeoJSON: q.selectedMowableGeoJSON || q.mowableGeoJSON || currentScopeFields.selectedMowableGeoJSON,
      mowableGeoJSON: q.mowableGeoJSON || q.selectedMowableGeoJSON || currentScopeFields.mowableGeoJSON,
      excludedGeoJSON: q.excludedGeoJSON || q.cutoutGeoJSON || currentScopeFields.excludedGeoJSON,
      mapCenter: q.mapCenter || currentScopeFields.mapCenter || null,
      mapBounds: q.mapBounds || currentScopeFields.mapBounds || null,
    };

    const checkoutBody = {
      quote_id: q.id || q.quote_id || '',
      serviceType: q.serviceType || 'mowing',
      email: q.email || '',
      customerEmail: q.email || '',
      phone: backendPhone,
      customerPhone: backendPhone,
      estimate: Number(q.estimate || 0),
      final_price: Number(q.estimate || 0),
      mowAreaSqft: Number(q.mowAreaSqft || 0),
      lotAreaSqft: Number(q.lotAreaSqft || 0),
      smsConsent: true,
      sms_consent: true,
      smsConsentText: SMS_CONSENT_TEXT,
      sms_consent_text: SMS_CONSENT_TEXT,
      job: payload,
    };
    const checkoutEndpoint = payOnsite ? '/api/checkout/pay-onsite' : '/api/checkout/instant-mow';
    console.log('[Checkout Trace] calling checkout endpoint', checkoutEndpoint);
    console.log('[Checkout Trace] payload to checkout endpoint | mowAreaSqft=' + checkoutBody.mowAreaSqft + ' estimate=' + checkoutBody.estimate);
    if (!payOnsite) trackInitiateCheckoutForQuote(checkoutBody);
    const checkout = await api(checkoutEndpoint, {
      method: 'POST',
      body: JSON.stringify(checkoutBody),
    });
    rememberProfilePhoneIfBlank(backendPhone);
    console.log('[Checkout Trace] checkout response status', checkout.ok);
    console.log('[Checkout Trace] checkout response body', {
      ok: checkout.ok,
      jobId: codVerificationJobId(checkout),
      paymentStatus: checkout.paymentStatus || '',
      paymentMethod: checkout.paymentMethod || '',
      hasCheckoutUrl: Boolean(checkout.checkoutUrl || checkout.url),
      verificationRequired: Boolean(checkout.verification_required || checkout.verificationRequired)
    });
    const stripeUrl = checkout.checkoutUrl || checkout.url;
    if (payOnsite && checkout.ok) {
      payload.payment_status = checkout.paymentStatus || 'onsite_pending';
      payload.payment_method = checkout.paymentMethod || 'onsite_cash_check';
      state.lastQuote = { ...payload, ...checkout.job };
      state.pendingQuote = state.lastQuote;
      if (checkout.verification_required || checkout.verificationRequired) {
        showCodVerificationPanel(checkout);
        showSuccess('Verification code sent');
        if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
        if (hasActiveSession() && typeof loadMyJobs === 'function') {
          loadMyJobs().catch(() => {});
        }
        return;
      } else {
        const rendered = await renderCodVerifiedSuccess(checkout, {
          jobId: codVerificationJobId(checkout),
          allowReloadFallback: false,
        });
        if (rendered) {
          if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
          return;
        }
        const resultEl = byId('leadRequestResult');
        if (resultEl) {
          resultEl.innerHTML = `<strong>Reserved.</strong> Cash or check will be collected at time of service.<br><span class="meta">Booking ID: ${escapeHtml(codVerificationJobId(checkout))}</span>`;
          resultEl.classList.remove('hidden');
        }
        showSuccess('Reserved - pay onsite');
      }
      if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
      if (hasActiveSession() && typeof showAccountPanel === 'function') {
        await loadMyJobs().catch(() => {});
        showAccountPanel('jobs');
      }
      return;
    }
    if (stripeUrl) {
      console.log('[Checkout Trace] redirecting to Stripe', stripeUrl);
      if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
      window.location.assign(stripeUrl);
      return;
    }
    // Stripe not configured or no URL returned — surface an explicit error
    if (checkout.ok && !stripeUrl) {
      const resultEl = byId('quoteResult');
      if (resultEl) {
        resultEl.innerHTML = '<strong>Checkout unavailable.</strong> Online payment is not currently configured. Please request an in-person quote or contact us.';
        resultEl.classList.remove('hidden');
      }
      if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
      return;
    }
    payload.payment_status = checkout.paymentStatus || 'checkout_pending';

    const data = checkout.job
      ? { ok: true, job: checkout.job }
      : await api('/api/jobs', {
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
        customerPhone: backendPhone,
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
       Service area: ${escapeHtml(sanitizeJobForPublic(data.job).location)}<br>
       Price: <strong>${money(data.job.budget)}</strong><br>
       Status: <span class="status-badge ${escapeHtml(data.job.status)}">${escapeHtml(data.job.status)}</span>${extraBidMessage}<br><br>
       <button class="btn secondary small ui-icon-btn" type="button"
         onclick="showAccountPanel('jobs')">${checkoutUiIcon('clipboard-check', 'View My Bookings')}</button>`
    );

    await loadMyJobs();
    if (isAdmin()) await loadAdmin().catch(() => {});
  } catch (error) {
    const errMsg = prettyApiError(error);
    console.log('[Checkout Trace] checkout error', error.message);
    if (isCheckoutAccountContactConflict(error)) {
      showCheckoutAccountContactConflict(error);
      if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
      return;
    }
    const resultEl = byId('leadRequestResult');
    if (resultEl) {
      resultEl.innerHTML = `<strong>Booking failed:</strong> ${escapeHtml(errMsg)}`;
      resultEl.classList.remove('hidden');
    }
    showResult('quoteResult', `<strong>Booking failed:</strong> ${escapeHtml(errMsg)}`);
    showError(errMsg);
    if (btn) { btn.disabled = false; (btnLabel || btn).textContent = originalText; }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   ACCOUNT RECOMMENDATION (shown before Stripe redirect for guests)
───────────────────────────────────────────────────────────────────────── */

function showAccountRecommend(checkoutUrl, estimate) {
  state.pendingCheckoutUrl = checkoutUrl;
  const panel = byId('accountRecommendPanel');
  const estimateEl = byId('accountRecommendEstimate');
  if (estimateEl && estimate > 0) estimateEl.textContent = money(estimate);
  const quote = state.lastQuote || state.pendingQuote || {};
  const registerForm = byId('accountRecommendRegisterForm');
  if (registerForm) {
    if (registerForm.elements.fullName && quote.name && !registerForm.elements.fullName.value) registerForm.elements.fullName.value = quote.name;
    if (registerForm.elements.email && quote.email && !registerForm.elements.email.value) registerForm.elements.email.value = quote.email;
    if (registerForm.elements.phone && (quote.phone || quote.customerPhone) && !registerForm.elements.phone.value) {
      checkoutSetVisiblePhone(registerForm.elements.phone, quote.phone || quote.customerPhone);
    }
  }
  // Hide other panels
  byId('leadRequestPanel')?.classList.add('hidden');
  byId('checkoutSuccessPanel')?.classList.add('hidden');
  if (panel) {
    panel.style.display = '';
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  setActiveView('quote');
}

function hideAccountRecommend() {
  const panel = byId('accountRecommendPanel');
  if (panel) { panel.style.display = 'none'; panel.classList.add('hidden'); }
}

function proceedToCheckout() {
  const url = state.pendingCheckoutUrl;
  const pending = state.lastQuote || state.pendingQuote || {};
  state.pendingCheckoutUrl = null;
  hideAccountRecommend();
  if (url) {
    window.turflynkCanvasDiagnostics?.('checkout open');
    trackInitiateCheckoutForQuote({
      estimate: pending.estimate || pending.final_price || pending.budget,
    });
    window.location.href = url;
  }
}

checkoutBindOnce(byId('accountRecommendGuestBtn'), 'click', 'account-recommend-guest', () => {
  if (state.pendingCheckoutResume) {
    showError('Please log in or create an account to continue to payment.');
    return;
  }
  proceedToCheckout();
});

checkoutBindOnce(byId('accountRecommendCreateBtn'), 'click', 'account-recommend-create', () => {
  const authForm = byId('accountRecommendAuthForm');
  if (authForm) authForm.classList.toggle('hidden');
});

checkoutBindOnce(byId('accountRecommendLoginToggle'), 'click', 'account-recommend-login-toggle', () => {
  byId('accountRecommendRegisterForm')?.classList.add('hidden');
  byId('accountRecommendLoginForm')?.classList.remove('hidden');
});

checkoutBindOnce(byId('accountRecommendRegisterToggle'), 'click', 'account-recommend-register-toggle', () => {
  byId('accountRecommendLoginForm')?.classList.add('hidden');
  byId('accountRecommendRegisterForm')?.classList.remove('hidden');
});

function clearAccountRecommendSignupError(form) {
  form?.querySelectorAll('[aria-invalid="true"]').forEach((input) => {
    input.removeAttribute('aria-invalid');
    input.style.borderColor = '';
  });
}

function showAccountRecommendSignupError(form, error, result) {
  const payload = error?.data || {};
  const message = prettyApiError(error);
  if (result) {
    result.innerHTML = `<strong>Could not create account:</strong> ${escapeHtml(message)} <button type="button" class="link-btn" data-account-signin-instead>Sign in instead</button>`;
    result.classList.remove('hidden');
    checkoutBindOnce(result.querySelector('[data-account-signin-instead]'), 'click', 'account-signin-instead', () => {
      byId('accountRecommendRegisterForm')?.classList.add('hidden');
      byId('accountRecommendLoginForm')?.classList.remove('hidden');
    });
  }
  const field = payload.field && form?.elements?.[payload.field];
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.style.borderColor = 'var(--danger, #b91c1c)';
    field.focus();
  }
}

checkoutBindOnce(byId('accountRecommendRegisterForm'), 'submit', 'account-recommend-register-submit', async (e) => {
  e.preventDefault();
  clearAccountRecommendSignupError(e.target);
  const btn = byId('accountRecommendRegisterBtn');
  const result = byId('accountRecommendAuthResult');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }
  if (result) { result.classList.add('hidden'); result.textContent = ''; }
  try {
    const fd = new FormData(e.target);
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName: fd.get('fullName'), email: fd.get('email'), phone: checkoutPhoneForBackend(fd.get('phone')), password: fd.get('password') }),
    });
    window.trackMetaEvent?.('CompleteRegistration', {
      content_name: 'Customer Account Created',
    });
    // Auto-login after register
    const loginData = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
    });
    setAuthToken(loginData.token);
    state.currentUser = loginData.user;
    updateSessionStatus(loginData.user);
    applyRoleVisibility();
    if (state.pendingCheckoutResume) {
      state.pendingCheckoutResume = false;
      hideAccountRecommend();
      await bookQuoteAsJob();
    } else {
      proceedToCheckout();
    }
  } catch (err) {
    showAccountRecommendSignupError(e.target, err, result);
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account & Proceed to Checkout'; }
  }
});

checkoutBindOnce(byId('accountRecommendLoginForm'), 'submit', 'account-recommend-login-submit', async (e) => {
  e.preventDefault();
  const btn = byId('accountRecommendLoginBtn');
  const result = byId('accountRecommendAuthResult');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
  try {
    const fd = new FormData(e.target);
    const loginData = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
    });
    setAuthToken(loginData.token);
    state.currentUser = loginData.user;
    updateSessionStatus(loginData.user);
    applyRoleVisibility();
    if (state.pendingCheckoutResume) {
      state.pendingCheckoutResume = false;
      hideAccountRecommend();
      await bookQuoteAsJob();
    } else {
      proceedToCheckout();
    }
  } catch (err) {
    if (result) {
      result.innerHTML = `<strong>Could not sign in:</strong> ${escapeHtml(prettyApiError(err))}`;
      result.classList.remove('hidden');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In & Proceed to Checkout'; }
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   CHECKOUT RETURN — success / cancel UI helpers
───────────────────────────────────────────────────────────────────────── */

function isCheckoutCancelSignal(params = new URLSearchParams(window.location.search)) {
  const checkout = String(params.get('checkout') || '').toLowerCase();
  const canceled = String(params.get('canceled') || params.get('cancelled') || '').toLowerCase();
  return ['cancel', 'canceled', 'cancelled'].includes(checkout)
    || ['1', 'true', 'yes', 'cancel', 'canceled', 'cancelled'].includes(canceled)
    || params.has('checkout_canceled')
    || params.has('checkout_cancelled')
    || params.has('payment_canceled')
    || params.has('payment_cancelled');
}

function checkoutHasSavedQuoteState() {
  const quote = state.lastQuote || state.pendingQuote || state.currentEstimate?.payload || null;
  if (quote && Object.keys(quote).length) return true;
  const draft = typeof loadQuoteDraft === 'function' ? loadQuoteDraft() : null;
  if (draft && Object.keys(draft).some((key) => String(draft[key] || '').trim())) return true;
  const form = byId('quoteForm');
  if (!form) return false;
  return ['address', 'city', 'zip', 'lat', 'lng', 'mowAreaSqft', 'lotAreaSqft'].some((name) => {
    return String(form.elements?.[name]?.value || '').trim();
  });
}

function checkoutManualSetActiveView(view) {
  state.activeView = view;
  document.body.dataset.activeView = view;
  $$('[data-view-panel]').forEach((panel) => {
    const visible = panel.dataset.viewPanel === view;
    panel.classList.toggle('active', visible);
    panel.style.display = visible ? '' : 'none';
  });
  $$('[data-view]').forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function checkoutManualShowQuoteStep(step) {
  const nextStep = ['property', 'draw', 'estimate', 'request'].includes(step) ? step : 'property';
  state.quoteFlowStep = nextStep;
  document.body.dataset.quoteFlowStep = nextStep;
  $$('[data-quote-step-panel]').forEach((panel) => {
    const active = panel.dataset.quoteStepPanel === nextStep;
    panel.classList.toggle('is-active', active);
    panel.classList.toggle('is-hidden', !active);
    panel.classList.toggle('hidden', !active);
    panel.hidden = !active;
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if (typeof updateQuoteStepper === 'function') updateQuoteStepper();
}

function checkoutHideQuoteStepsForCancel() {
  $$('[data-quote-step-panel]').forEach((panel) => {
    panel.classList.remove('is-active');
    panel.classList.add('is-hidden', 'hidden');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
  });
  byId('leadRequestPanel')?.classList.add('hidden');
  byId('manualQuotePanel')?.classList.add('hidden');
  byId('accountRecommendPanel')?.classList.add('hidden');
}

function checkoutUseAppView(view) {
  if (typeof setActiveView === 'function') {
    try {
      setActiveView(view);
      return true;
    } catch (error) {
      console.warn('[Checkout Cancel] setActiveView fallback:', error.message);
    }
  }
  checkoutManualSetActiveView(view);
  return false;
}

function checkoutUseQuoteStep(step, options = {}) {
  if (typeof showQuoteFlowStep === 'function') {
    try {
      showQuoteFlowStep(step, options);
      return true;
    } catch (error) {
      console.warn('[Checkout Cancel] showQuoteFlowStep fallback:', error.message);
    }
  }
  checkoutManualShowQuoteStep(step);
  if (options.scroll !== false) {
    document.querySelector(`[data-quote-step-panel="${state.quoteFlowStep}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return false;
}

function hideCheckoutCancelPanel() {
  const cancelPanel = byId('checkoutCancelPanel');
  if (!cancelPanel) return;
  cancelPanel.style.display = 'none';
  cancelPanel.classList.add('hidden');
}

function renderCheckoutCancel() {
  checkoutUseAppView('quote');
  checkoutHideQuoteStepsForCancel();
  const successPanel = byId('checkoutSuccessPanel');
  const cancelPanel = byId('checkoutCancelPanel');
  if (successPanel) { successPanel.style.display = 'none'; successPanel.classList.add('hidden'); }
  if (!cancelPanel) return false;

  cancelPanel.style.display = '';
  cancelPanel.classList.remove('hidden');
  const contentEl = byId('checkoutCancelContent');
  if (contentEl) {
    contentEl.innerHTML = `<p><strong>Payment was canceled.</strong> No charge was made. You can return to your quote, start over, or open your jobs/account.</p>
      <div class="quote-support-row quote-support-row--left" aria-label="Checkout support">
        <img src="/assets/icons/lucide/life-buoy.svg" alt="" class="contact-icon">
        <span>Need help finishing checkout?</span>
        <span class="contact-link-pair"><a href="tel:4792740412">Call</a><span>or</span><a href="sms:4792740412">text 479-274-0412</a></span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn primary ui-icon-btn" type="button" data-checkout-cancel-action="return-quote">${checkoutUiIcon('calculator', 'Return to Quote')}</button>
        <button class="btn ghost ui-icon-btn" type="button" data-checkout-cancel-action="start-over">${checkoutUiIcon('rotate-ccw', 'Start Over')}</button>
        <button class="btn secondary ui-icon-btn" type="button" data-checkout-cancel-action="account-jobs">${checkoutUiIcon('clipboard-check', 'My Jobs / Account')}</button>
      </div>`;
  }
  cancelPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

function handleCheckoutCancelAction(action) {
  if (action === 'return-quote') {
    hideCheckoutCancelPanel();
    checkoutUseAppView('quote');
    checkoutUseQuoteStep(checkoutHasSavedQuoteState() ? 'estimate' : 'property');
    return;
  }
  if (action === 'start-over') {
    hideCheckoutCancelPanel();
    clearCheckoutPii({ reason: 'checkout-cancel-start-over', clearAddress: true });
    checkoutUseAppView('quote');
    checkoutUseQuoteStep('property');
    return;
  }
  if (action === 'account-jobs') {
    if (typeof showAccountPanel === 'function') {
      showAccountPanel('jobs');
      return;
    }
    if (typeof toggleAuthPanel === 'function' && !(typeof hasActiveSession === 'function' && hasActiveSession())) {
      toggleAuthPanel(true);
      return;
    }
    window.location.href = '/';
  }
}

function bindCheckoutCancelActions() {
  if (window.__checkoutCancelActionsBound) return;
  window.__checkoutCancelActionsBound = true;
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-checkout-cancel-action]');
    if (!button) return;
    event.preventDefault();
    handleCheckoutCancelAction(button.dataset.checkoutCancelAction || '');
  });
}

function renderCheckoutCancelFromUrlEarly() {
  if (!isCheckoutCancelSignal()) return;
  renderCheckoutCancel();
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const returnUrl = window.location.href;
  const checkout = params.get('checkout');
  const sessionId = params.get('session_id');
  const jobId = params.get('job_id');
  const successFlag = params.get('success') || params.get('payment');
  const codVerifiedFlag = String(params.get('cod_verified') || '').toLowerCase();

  // Detect any payment-return signal
  const isCancel = isCheckoutCancelSignal(params);
  const isSuccess = checkout === 'success' || Boolean(sessionId)
    || successFlag === 'true' || successFlag === 'success';
  const isCodVerified = ['1', 'true', 'yes', 'success'].includes(codVerifiedFlag);

  if (!isSuccess && !isCancel && !isCodVerified) return false;

  // Clear URL params early so refresh doesn't re-trigger
  window.history.replaceState({}, '', window.location.pathname);

  if (isCodVerified && !isSuccess && !isCancel) {
    await renderCodVerifiedSuccess(
      { message: 'Your onsite-payment job is confirmed.' },
      { jobId: params.get('job_id') || '', allowReloadFallback: false }
    );
    return true;
  }

  if (isSuccess) {
    let successSession = null;
    if (sessionId) {
      try {
        const data = await api(`/api/payments/session/${encodeURIComponent(sessionId)}`);
        successSession = data.session || null;
      } catch {}
    }
    trackPurchaseForCheckoutSuccess(successSession, { sessionId, jobId, fallbackUrl: returnUrl });
    clearCheckoutPii({ reason: 'completed-checkout', clearAddress: true });

    const isLoggedIn = hasActiveSession();
    const successPanel = byId('checkoutSuccessPanel');
    const cancelPanel = byId('checkoutCancelPanel');
    if (cancelPanel) { cancelPanel.style.display = 'none'; cancelPanel.classList.add('hidden'); }

    if (isLoggedIn) {
      // Logged-in user: go directly to their bookings — do NOT enter the quote flow
      if (successPanel) { successPanel.style.display = 'none'; successPanel.classList.add('hidden'); }
      loadMyJobs().catch(() => {});
      showAccountPanel('jobs');
      return true;
    }

    // Guest: show post-payment success panel without the quote step UI
    setActiveView('quote');
    // Suppress quote step panels so the success panel is the primary content shown
    $$('[data-quote-step-panel]').forEach((p) => {
      p.classList.add('is-hidden', 'hidden');
      p.hidden = true;
      p.setAttribute('aria-hidden', 'true');
    });
    if (successPanel) {
      successPanel.style.display = '';
      successPanel.classList.remove('hidden');
      const contentEl = byId('checkoutSuccessContent');
      if (contentEl) contentEl.innerHTML = '<div style="color:var(--muted);padding:12px">Loading receipt…</div>';
      successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (sessionId && successSession) {
      renderCheckoutSuccess(successSession);
    } else if (sessionId) {
      _showGuestPostPaymentContent();
    } else {
      _showGuestPostPaymentContent();
    }
    return true;
  }

  renderCheckoutCancel();
  showWarning('Checkout canceled. Your card was not charged.');
  return true;
}

function _showGuestPostPaymentContent() {
  const panel = byId('checkoutSuccessPanel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Payment received</h2>
        <p class="section-copy" style="margin:0">Your booking was received. We’ll review your access details and schedule your mow.</p>
      </div>
    </div>
    <div style="padding:4px 0">
      <p class="meta" style="margin-top:12px">Create an account to track your job, get updates, and manage bookings.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn primary small ui-icon-btn" type="button" id="postPayGuestCreateBtn">${checkoutUiIcon('user', 'Create Account')}</button>
        <button class="btn ghost small ui-icon-btn" type="button" onclick="setActiveView('dashboard')">${checkoutUiIcon('home', 'Continue as Guest / Return Home')}</button>
      </div>
    </div>`;
  byId('postPayGuestCreateBtn')?.addEventListener('click', () => { byId('openAuth')?.click(); });
}

function renderCheckoutSuccess(session) {
  const contentEl = byId('checkoutSuccessContent');
  if (!contentEl) return;

  const s = session || {};
  const job = s.job || {};
  const svc = s.service || {};
  const customer = s.customer || {};

  const formatSqftLocal = (n) => n > 0 ? `${Number(n).toLocaleString()} sq ft` : '';
  const acresLocal = (n) => n > 0 ? `${(n / 43560).toFixed(3)} acres` : '';
  const moneyLocal = (n) => n > 0 ? `$${Number(n).toFixed(2)}` : '';

  const safeJob = sanitizeJobForPublic({
    ...svc,
    ...job,
    city: job.city || svc.city,
    state: job.state || svc.state,
    serviceType: job.serviceType || svc.serviceType,
    budget: s.amount || job.budget || svc.estimate,
  });
  const mowSqft = Number(svc.mowAreaSqft || 0);
  const lotSqft = Number(svc.lotAreaSqft || 0);
  const isGuest = !hasActiveSession();
  const accountSetup = s.accountSetup || {};
  const canSetPassword = Boolean(accountSetup.token);
  const setupEmail = accountSetup.email || customer.email || '';

  contentEl.innerHTML = `
    <div class="estimate-card" style="margin:0">
      <div class="estimate-head">
        <div>
          <span class="pill">Your booking is confirmed</span>
          <h3>${moneyLocal(s.amount) || 'Payment received'}</h3>
          <p>Payment status: <strong>${escapeHtml(s.status || 'paid')}</strong></p>
        </div>
        ${mowSqft > 0 ? `<div class="preview-pill"><span>Mowable area</span><strong>${formatSqftLocal(mowSqft)}</strong></div>` : ''}
      </div>
      <div style="margin-top:12px;display:grid;gap:6px">
        ${s.job_id ? `<div><span class="meta">Booking ID:</span> <strong>${escapeHtml(s.job_id)}</strong></div>` : ''}
        ${safeJob.location ? `<div><span class="meta">Service area:</span> ${escapeHtml(safeJob.location)}</div>` : ''}
        ${safeJob.serviceType ? `<div><span class="meta">Service:</span> ${escapeHtml(serviceLabel(safeJob.serviceType))}</div>` : ''}
        ${mowSqft > 0 ? `<div><span class="meta">Mowable area:</span> ${formatSqftLocal(mowSqft)}${acresLocal(mowSqft) ? ` (${acresLocal(mowSqft)})` : ''}</div>` : ''}
        ${lotSqft > 0 ? `<div><span class="meta">Lot area:</span> ${formatSqftLocal(lotSqft)}</div>` : ''}
        ${customer.name ? `<div><span class="meta">Name:</span> ${escapeHtml(sanitizeCustomerName(customer.name))}</div>` : ''}
        ${(job.preferredDate || svc.preferredDate) ? `<div><span class="meta">Preferred date:</span> ${escapeHtml(job.preferredDate || svc.preferredDate)}</div>` : ''}
        ${s.paid_at ? `<div><span class="meta">Paid:</span> ${escapeHtml(new Date(s.paid_at).toLocaleString())}</div>` : ''}
        ${job.status ? `<div><span class="meta">Job status:</span> <span class="status-badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></div>` : ''}
      </div>
      <div class="final-review" style="margin-top:12px">
        <h4>${canSetPassword ? 'Set your password to manage your jobs' : hasActiveSession() ? 'Manage your booking' : accountSetup.existingUser ? 'Log in to manage your jobs' : 'Next steps'}</h4>
        <p class="meta">${canSetPassword
          ? `We created an account for ${escapeHtml(setupEmail)} after payment. Set a password to view this booking, receipts, and future jobs.`
          : accountSetup.existingUser
            ? `This booking is linked to ${escapeHtml(setupEmail)}. Log in to manage your jobs.`
            : `We'll review your access details and schedule your mow. You'll be contacted to confirm the appointment.`}</p>
        ${canSetPassword ? `
          <button class="btn primary small ui-icon-btn" type="button" id="successCreateAccountBtn">${checkoutUiIcon('user', 'Create Account / Set Password')}</button>
          <form id="successSetPasswordForm" class="stack hidden" style="gap:10px;margin-top:12px">
            <input type="hidden" name="token" value="${escapeHtml(accountSetup.token)}" />
            <label><span>Password</span><input name="password" type="password" autocomplete="new-password" required minlength="8" /></label>
            <label><span>Confirm Password</span><input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" /></label>
            <button class="btn primary ui-icon-btn" type="submit" id="successSetPasswordSubmitBtn">${checkoutUiIcon('shield', 'Set Password')}</button>
            <div id="successSetPasswordResult" class="result hidden"></div>
          </form>
        ` : ''}
      </div>
      <div class="quote-support-row quote-support-row--left" aria-label="Booking support">
        <img src="/assets/icons/lucide/life-buoy.svg" alt="" class="contact-icon">
        <span>Need help with your booking?</span>
        <span class="contact-link-pair"><a href="tel:4792740412">Call</a><span>or</span><a href="sms:4792740412">text 479-274-0412</a></span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${hasActiveSession() ? `<button class="btn secondary small ui-icon-btn" type="button" onclick="showAccountPanel('jobs')">${checkoutUiIcon('clipboard-check', 'View My Bookings')}</button>` : ''}
        ${isGuest && !canSetPassword ? `<button class="btn secondary small ui-icon-btn" type="button" id="successCreateAccountBtn">${checkoutUiIcon('user', 'Log In / Create Account')}</button>` : ''}
        <button class="btn ghost small ui-icon-btn" type="button" onclick="setActiveView('quote')">${checkoutUiIcon('home', 'Return Home')}</button>
      </div>
    </div>`;

  if (canSetPassword) {
    byId('successCreateAccountBtn')?.addEventListener('click', () => {
      byId('successSetPasswordForm')?.classList.toggle('hidden');
    });
    byId('successSetPasswordForm')?.addEventListener('submit', submitSuccessSetPassword);
  } else if (isGuest) {
    byId('successCreateAccountBtn')?.addEventListener('click', () => {
      byId('openAuth')?.click();
    });
  }
}

async function submitSuccessSetPassword(event) {
  event.preventDefault();
  const form = event.target;
  const btn = byId('successSetPasswordSubmitBtn');
  const result = byId('successSetPasswordResult');
  const fd = new FormData(form);
  const password = String(fd.get('password') || '');
  const confirmPassword = String(fd.get('confirmPassword') || '');

  if (password !== confirmPassword) {
    if (result) {
      result.innerHTML = '<strong>Passwords do not match.</strong>';
      result.classList.remove('hidden');
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Setting password...'; }
  try {
    const data = await api('/api/auth/set-password', {
      method: 'POST',
      body: JSON.stringify({ token: fd.get('token'), password }),
    });
    setAuthToken(data.token);
    state.currentUser = data.user;
    updateSessionStatus(data.user);
    applyRoleVisibility();
    window.trackMetaEvent?.('CompleteRegistration', {
      content_name: 'Customer Account Created',
    });
    if (result) {
      result.innerHTML = '<strong>Password set.</strong> You can now manage your bookings.';
      result.classList.remove('hidden');
    }
    form.querySelectorAll('input,button').forEach((el) => { el.disabled = true; });
    await loadMyJobs().catch(() => {});
    showSuccess('Account ready');
  } catch (error) {
    if (result) {
      result.innerHTML = `<strong>Could not set password:</strong> ${escapeHtml(prettyApiError(error))}`;
      result.classList.remove('hidden');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Set Password'; }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   PHONE HELPERS — moved from app.js (Phase 13c)
───────────────────────────────────────────────────────────────────────── */

function isValidLookingPhone(value) {
  const digits = phoneDigits(value);
  return digits.length >= 10 && digits.length <= 15;
}

function bookingPhoneValue(payload = {}) {
  return String(payload.customerPhone || payload.phone || '').trim();
}

function focusBookingPhoneField() {
  const phoneField = byId('leadPhone')
    || byId('leadRequestForm')?.elements?.customerPhone
    || byId('manualQuoteForm')?.elements?.phone
    || byId('quoteForm')?.elements?.phone
    || null;
  phoneField?.focus?.();
}

function smsConsentAccepted(payload = {}) {
  return payload.smsConsent === true
    || payload.sms_consent === true
    || String(payload.smsConsent || '').toLowerCase() === 'true'
    || String(payload.sms_consent || '').toLowerCase() === 'true';
}

function applySmsConsentToPayload(payload = {}, form) {
  const checked = Boolean(form?.elements?.smsConsent?.checked);
  payload.smsConsent = checked;
  payload.sms_consent = checked;
  payload.smsConsentText = SMS_CONSENT_TEXT;
  payload.sms_consent_text = SMS_CONSENT_TEXT;
  return payload;
}

function focusSmsConsentField(form) {
  const field = form?.elements?.smsConsent
    || byId('leadRequestForm')?.elements?.smsConsent
    || byId('manualQuoteForm')?.elements?.smsConsent
    || byId('liveBidForm')?.elements?.smsConsent
    || null;
  field?.focus?.();
}

function showSmsConsentRequiredError(resultId = 'leadRequestResult', form) {
  const result = byId(resultId);
  if (result) {
    result.innerHTML = `<strong>SMS consent required.</strong><br>${escapeHtml(SMS_CONSENT_REQUIRED_MESSAGE)}`;
    result.classList.remove('hidden');
  }
  showError(SMS_CONSENT_REQUIRED_MESSAGE);
  focusSmsConsentField(form);
}

function showPhoneRequiredError(resultId = 'leadRequestResult') {
  const message = 'Enter a valid phone number before booking or payment.';
  const result = byId(resultId);
  if (result) {
    result.innerHTML = `<strong>Phone needed.</strong><br>${escapeHtml(message)}`;
    result.classList.remove('hidden');
  }
  showError(message);
  focusBookingPhoneField();
}

/* ─────────────────────────────────────────────────────────────────────────
   CONTACT VALIDATION HELPERS — moved from app.js (Phase 13c)
───────────────────────────────────────────────────────────────────────── */

function quoteContactMissing(payload) {
  const missing = [];
  if (!String(payload.name || '').trim()) missing.push('name');
  if (!String(payload.email || '').trim()) missing.push('email');
  if (!isValidLookingPhone(payload.phone || '')) missing.push('phone');
  return missing;
}

function bookingAccessNotesRequired(payload = {}) {
  const gate = payload.gate_size_category || payload.gate_access_type || '';
  const mowerAccess = payload.mower_access || '';
  const community = payload.community_access_type || '';
  return (
    (gate && gate !== 'no_gate_open_access') ||
    (mowerAccess && mowerAccess !== 'yes') ||
    (community && community !== 'no')
  );
}

function bookingContactMissing(payload = {}) {
  const missing = [];
  if (!String(payload.name || payload.customerName || '').trim()) missing.push('name');
  if (!isValidLookingPhone(payload.phone || payload.customerPhone || '')) missing.push('phone');
  if (!String(payload.email || payload.customerEmail || '').trim()) missing.push('email');
  if (!String(payload.address || '').trim()) missing.push('address');
  const accessNotes = payload.yard_access_notes || payload.access_notes || payload.notes || payload.community_access_instructions || '';
  if (bookingAccessNotesRequired(payload) && !String(accessNotes).trim()) missing.push('access notes');
  return missing;
}

function normalizeBookingContact(payload = {}) {
  const serviceAddress = getCurrentServiceAddress(payload);
  const phone = bookingPhoneValue(payload);
  const email = String(payload.customerEmail || payload.email || '').trim().toLowerCase();
  return {
    ...payload,
    ...(hasServiceAddress(serviceAddress) ? serviceAddress : {}),
    name: payload.name || payload.customerName || '',
    phone,
    email,
    customerName: payload.customerName || payload.name || '',
    customerPhone: phone,
    customerEmail: email,
  };
}

function showBookingContactPanel(payload = {}) {
  showLeadRequestPanel(payload);
  showWarning('Add booking details to continue to secure checkout.');
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
     <button class="btn primary ui-icon-btn" type="button" id="acceptQuoteBtn">${checkoutUiIcon('credit-card', 'Book & Pay Securely')}</button>`
  );

  byId('acceptQuoteBtn')?.addEventListener('click', acceptPendingQuote);
}

/* ─────────────────────────────────────────────────────────────────────────
   FILE PREVIEW / EXTRA BID HELPERS — moved from app.js (Phase 13c)
───────────────────────────────────────────────────────────────────────── */

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
  if (!smsConsentAccepted(payload)) {
    showSmsConsentRequiredError(resultId, byId('liveBidForm'));
    throw new Error(SMS_CONSENT_REQUIRED_MESSAGE);
  }
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

/* ─────────────────────────────────────────────────────────────────────────
   WINDOW EXPORTS — functions called from app.js or other modules
───────────────────────────────────────────────────────────────────────── */

bindCheckoutCancelActions();
renderCheckoutCancelFromUrlEarly();

window.showLeadRequestPanel = showLeadRequestPanel;
window.showManualQuotePanel = showManualQuotePanel;
window.hideManualQuotePanel = hideManualQuotePanel;
window.buildManualQuoteRequestPayload = buildManualQuoteRequestPayload;
window.showAccountRecommend = showAccountRecommend;
window.hideAccountRecommend = hideAccountRecommend;
window.proceedToCheckout = proceedToCheckout;
window.bookQuoteAsJob = bookQuoteAsJob;
window.handleCheckoutReturn = handleCheckoutReturn;
window.renderCheckoutCancel = renderCheckoutCancel;
window.renderCheckoutSuccess = renderCheckoutSuccess;
window.submitSuccessSetPassword = submitSuccessSetPassword;
window.clearCheckoutPii = clearCheckoutPii;
window.checkoutPhoneForBackend = checkoutPhoneForBackend;
window.checkoutPhoneForDisplay = checkoutPhoneForDisplay;
// phone / contact / bid helpers (moved from app.js Phase 13c)
window.phoneDigits = phoneDigits;
window.isValidLookingPhone = isValidLookingPhone;
window.bookingPhoneValue = bookingPhoneValue;
window.focusBookingPhoneField = focusBookingPhoneField;
window.smsConsentAccepted = smsConsentAccepted;
window.applySmsConsentToPayload = applySmsConsentToPayload;
window.showSmsConsentRequiredError = showSmsConsentRequiredError;
window.showPhoneRequiredError = showPhoneRequiredError;
window.quoteContactMissing = quoteContactMissing;
window.bookingAccessNotesRequired = bookingAccessNotesRequired;
window.bookingContactMissing = bookingContactMissing;
window.normalizeBookingContact = normalizeBookingContact;
window.showBookingContactPanel = showBookingContactPanel;
window.showQuoteContactRequest = showQuoteContactRequest;
window.renderFilePreview = renderFilePreview;
window.updateExtraBidFields = updateExtraBidFields;
window.updateExtraBidReview = updateExtraBidReview;
window.uploadPhotoInput = uploadPhotoInput;
window.submitBidRequest = submitBidRequest;
