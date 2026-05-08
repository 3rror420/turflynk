// Estimate rendering helpers.
// Extracted from app.js — Phase 2 modular refactor. Loads before app.js.
//
// Pre-load globals required (satisfied by earlier script tags):
//   state           → public/js/state.js
//   byId, money, formatAcres, formatSqft, escapeHtml, showResult
//                   → public/js/utils/dom.js
//   INCLUDED_MOW_TASKS, EXCLUDED_MOW_TASKS
//                   → public/js/config.js
//
// Runtime globals called (resolved from app.js at call time):
//   showMissingMowableAreaPrompt, buildAccessSummary, equipmentRecommendation

function renderEstimateState() {
  const estimateState = state.currentEstimate || { status: 'empty' };
  const preview = byId('quotePreview');
  const mirror = byId('quotePreviewMirror');
  const leadDisplay = byId('leadEstimateDisplay');
  const result = byId('quoteResult');
  const estimateActive = state.quoteFlowStep === 'estimate';

  let main = 'Draw area';
  let sub = 'Draw area';

  if (estimateState.status === 'fresh' && estimateState.estimate > 0) {
    main = money(estimateState.estimate);
    sub = 'Standard mowing only';
  } else if (estimateState.status === 'updating' || estimateState.status === 'stale') {
    main = 'Updating...';
    sub = 'Updating estimate...';
  } else if (estimateState.status === 'error') {
    main = 'Unavailable';
    sub = 'Estimate unavailable';
  }

  if (preview) preview.textContent = main;
  if (mirror) mirror.textContent = sub;
  if (leadDisplay) leadDisplay.textContent = estimateState.status === 'fresh' ? money(estimateState.estimate) : main;

  if (!result) return;
  if (estimateState.status === 'fresh' && estimateState.payload) {
    renderEstimateResult(estimateState.payload);
    return;
  }
  setQuoteScopeSection(false);
  if (!estimateActive) {
    result.classList.add('hidden');
    return;
  }
  if (estimateState.status === 'updating' || estimateState.status === 'stale') {
    showResult('quoteResult', '<strong>Updating estimate...</strong><br>Checking the latest yard and service details.');
  } else if (estimateState.status === 'error') {
    showResult('quoteResult', `<strong>Estimate unavailable.</strong><br>${escapeHtml(estimateState.error || 'Please try recalculating.')}`);
  } else {
    result.classList.add('hidden');
  }
}

function setQuoteScopeSection(visible) {
  const section = byId('quoteScopeSection');
  const grid = byId('quoteScopeGrid');
  if (!section) return;
  section.hidden = !visible;
  if (!visible && grid) grid.innerHTML = '';
}

function estimateSignatureFromPayload(payload = {}) {
  const sorted = (value) => Array.isArray(value) ? value.slice().sort() : [];
  return JSON.stringify({
    serviceType: payload.serviceType || payload.service_type || 'mowing',
    regionId: payload.regionId || payload.region_id || '',
    mowAreaSqft: Math.round(Number(payload.mowAreaSqft || 0)),
    lotAreaSqft: Math.round(Number(payload.lotAreaSqft || 0)),
    grassHeight: payload.grass_height_range || '',
    frequency: payload.service_frequency || '',
    yardAreas: sorted(payload.selected_yard_areas || payload.selectedYardAreas),
    gateSize: payload.gate_size_category || payload.gate_access_type || '',
    gateWidth: payload.gate_width_inches || '',
    mowerAccess: payload.mower_access || '',
    communityAccess: payload.community_access_type || '',
    pets: payload.pets || '',
    petWaste: payload.pet_waste_level || '',
    propertyType: payload.propertyType || '',
    obstacles: sorted(payload.obstacles_list),
    rushJob: Boolean(payload.rushJob),
    limitedAccess: Boolean(payload.limitedAccess),
    slopedTerrain: Boolean(payload.slopedTerrain),
    denseVegetation: Boolean(payload.denseVegetation),
  });
}

function currentEstimateSignature() {
  const form = byId('quoteForm');
  if (!form) return '';
  return estimateSignatureFromPayload(buildQuotePayload(form));
}

function renderMowScopeGridContent() {
  return `
    <div class="quote-scope-item">
      <h4>Includes</h4>
      <ul>${INCLUDED_MOW_TASKS.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
    <div class="quote-scope-item">
      <h4>Not Included</h4>
      <ul>${EXCLUDED_MOW_TASKS.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
    <p class="quote-scope-provider-notice">If a provider cannot complete the quoted standard mow, the job is canceled and fully refunded.</p>`;
}

function renderEstimateResult(payload) {
  const area = Number(payload.mowAreaSqft || 0);
  console.log('[TurfLynk Area Trace] E. renderEstimateResult | mowAreaSqft=' + area + ' lotAreaSqft=' + Number(payload.lotAreaSqft || 0) + ' estimate=' + payload.estimate + ' source=pendingQuote');
  if (area <= 0) {
    setQuoteScopeSection(false);
    showMissingMowableAreaPrompt('quoteResult');
    return;
  }

  const scopeGrid = byId('quoteScopeGrid');
  if (scopeGrid) scopeGrid.innerHTML = renderMowScopeGridContent();
  setQuoteScopeSection(true);

  showResult(
    'quoteResult',
    `<div class="estimate-card">
      <div class="estimate-head quote-result-summary">
        <div>
          <p><strong>${formatSqft(area)}</strong> mowable area. Standard mowing only.</p>
        </div>
        <div class="preview-pill"><span>Area</span><strong>${formatAcres(area)}</strong></div>
      </div>
      <p class="estimate-reassurance">No contracts. Cancel anytime before service is assigned.</p>
    </div>`
  );
}
