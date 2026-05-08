// jobs-ui.js — Customer jobs/quotes UI helpers (Phase 7 modular refactor)
// Depends on: state (state.js), byId/$$ (utils/dom.js), api (core/api.js),
//   escapeHtml/card/money/showSuccess/showError/showInfo (utils/dom.js),
//   hasActiveSession (auth/auth-ui.js), serviceLabel/regionLabel/accountEmptyMessage (app.js)
// Must load after: config.js, state.js, utils/dom.js, auth/auth-ui.js, core/api.js
// Must load before: app.js

/* ── Customer name / job sanitizers ─────────────────────────────────────── */

function jobsBindOnce(target, type, key, handler, options) {
  if (!target || typeof target.addEventListener !== 'function' || !key) return false;
  const registry = target.__turflynkListenerKeys || (target.__turflynkListenerKeys = new Set());
  const registryKey = `${type}:${key}`;
  if (registry.has(registryKey)) {
    console.info('[ListenerGuard] duplicate jobs listener skipped', registryKey);
    return false;
  }
  registry.add(registryKey);
  target.addEventListener(type, handler, options);
  return true;
}

function sanitizeCustomerName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Customer';
  const first = parts[0];
  const lastInitial = parts.length > 1 ? `${parts[parts.length - 1].charAt(0).toUpperCase()}.` : '';
  return [first, lastInitial].filter(Boolean).join(' ');
}

function sanitizeJobForPublic(job = {}) {
  const city = String(job.city || '').trim();
  const stateName = String(job.state || '').trim();
  const region = regionLabel(job.regionId || job.region_id || '');
  const location = [city, stateName].filter(Boolean).join(', ') || region || 'Service area';
  const amount = Number(job.paymentAmount || job.payment_amount || job.budget || job.estimate || job.estimatedPrice || 0);
  return {
    id: job.id || '',
    title: job.title || serviceLabel(job.serviceType || job.service_type || 'mowing'),
    customerName: sanitizeCustomerName(job.customerName || job.customer_name || job.name || ''),
    serviceType: job.serviceType || job.service_type || 'mowing',
    region,
    city,
    state: stateName,
    location,
    amount,
    status: job.status || 'open',
    paymentStatus: job.paymentStatus || job.payment_status || 'unpaid',
    paymentMethod: job.paymentMethod || job.payment_method || '',
    paidAt: job.paidAt || job.paid_at || '',
    stripeCheckoutSessionId: job.stripeCheckoutSessionId || job.stripe_checkout_session_id || '',
    preferredDate: job.preferredDate || job.preferred_date || '',
    postedAt: job.postedAt || job.createdAt || job.created_at || '',
  };
}

/* ── Scope snapshot helpers ──────────────────────────────────────────────── */

function scopeAreaLabel(sqft) {
  const value = Math.round(Number(sqft || 0));
  if (!value) return '';
  return `${value.toLocaleString()} sq ft`;
}

function countGeoJsonFeatures(geojson) {
  if (!geojson) return 0;
  if (geojson.type === 'FeatureCollection') return geojson.features?.length || 0;
  return geojson.type ? 1 : 0;
}

function renderJobScopeSnapshot(job = {}, safe = sanitizeJobForPublic(job)) {
  const scope = job.scopeSnapshot || job.scope_snapshot || {};
  if (!scope || !Object.keys(scope).length) {
    return '<div class="job-scope-snapshot"><div class="job-scope-unavailable">Scope snapshot unavailable for this older job.</div></div>';
  }
  const access = scope.access || {};
  const options = scope.serviceOptions || {};
  const mowSqft = Number(scope.mowableAreaSqFt || scope.mowAreaSqft || 0);
  const lotSqft = Number(scope.lotAreaSqFt || scope.lotAreaSqft || 0);
  const price = Number(scope.paidAmount || scope.finalAmount || safe.amount || 0);
  const tip = Number(scope.tipAmount || 0);
  const mapHtml = typeof jobScopeSnapshotMapHtml === 'function'
    ? jobScopeSnapshotMapHtml(scope)
    : `<div class="map-placeholder">${escapeHtml([
        countGeoJsonFeatures(scope.parcelGeoJSON) ? 'parcel saved' : '',
        countGeoJsonFeatures(scope.selectedMowableGeoJSON) ? `${countGeoJsonFeatures(scope.selectedMowableGeoJSON)} mowable area${countGeoJsonFeatures(scope.selectedMowableGeoJSON) === 1 ? '' : 's'} saved` : '',
        countGeoJsonFeatures(scope.excludedGeoJSON) ? `${countGeoJsonFeatures(scope.excludedGeoJSON)} cutout${countGeoJsonFeatures(scope.excludedGeoJSON) === 1 ? '' : 's'} saved` : '',
      ].filter(Boolean).join(' · ') || 'Map snapshot saved for this job.')}</div>`;
  const accessText = [
    access.gateSize ? `Gate: ${access.gateSize}` : '',
    access.gateWidthInches ? `Gate width: ${access.gateWidthInches} in` : '',
    access.mowerAccess ? `Mower access: ${access.mowerAccess}` : '',
    access.yardAccessNotes ? `Access notes: ${access.yardAccessNotes}` : '',
    access.communityAccessType && access.communityAccessType !== 'no' ? `Community access: ${access.communityAccessType}` : '',
    access.communityAccessPrivate ? 'Community instructions saved privately' : '',
  ].filter(Boolean).join(' · ');
  const serviceText = [
    options.scopeLocked ? 'Standard mowing scope locked' : '',
    options.selectedYardAreas?.length ? `Areas: ${options.selectedYardAreas.join(', ')}` : '',
    options.grassHeight ? `Grass: ${options.grassHeight}` : '',
    options.frequency ? `Frequency: ${options.frequency}` : '',
    options.pets && options.pets !== 'none' ? `Pets: ${options.pets}` : '',
    options.obstacles?.length ? `Obstacles: ${options.obstacles.join(', ')}` : '',
  ].filter(Boolean).join(' · ');

  return `
    <div class="job-scope-snapshot" aria-label="Booking scope snapshot">
      <div class="meta"><strong>Booking scope:</strong> ${escapeHtml(serviceText || `${serviceLabel(scope.serviceType || safe.serviceType)} from MowNWA`)}</div>
      ${mowSqft ? `<div class="meta">Mowable area: <strong>${escapeHtml(scopeAreaLabel(mowSqft))}</strong>${lotSqft ? ` · Lot: ${escapeHtml(scopeAreaLabel(lotSqft))}` : ''}</div>` : ''}
      <div class="meta">Price: <strong>${money(price)}</strong>${tip > 0 ? ` · Tip: <strong>${money(tip)}</strong>` : ''}</div>
      ${accessText ? `<div class="meta">Service/access: ${escapeHtml(accessText)}</div>` : ''}
      ${scope.customerNotes ? `<div class="meta">Customer notes: ${escapeHtml(scope.customerNotes)}</div>` : ''}
      ${mapHtml}
    </div>
  `;
}

/* ── Status badge ────────────────────────────────────────────────────────── */

function statusBadge(status) {
  return `<span class="status-badge ${escapeHtml(status || 'open')}">${escapeHtml(status || 'open')}</span>`;
}

function uiIcon(name, label) {
  return `<img src="/assets/icons/lucide/${name}.svg" alt="" class="ui-icon"><span class="ui-label">${escapeHtml(label)}</span>`;
}

/* ── Customer display helpers ────────────────────────────────────────────── */

function formatCustomerDate(value) {
  if (!value) return 'n/a';
  try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return 'n/a'; }
}

function formatCustomerMoney(value) {
  const n = Number(value || 0);
  return n > 0 ? money(n) : '—';
}

function humanCustomerJobStatus(status) {
  const map = { open: 'Open', cod_verification_pending: 'Pending Verification', assigned: 'Assigned', scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled', canceled: 'Cancelled' };
  return map[status] || status || 'Open';
}

function humanCustomerPaymentStatus(status) {
  const map = { unpaid: 'Unpaid', checkout_pending: 'Checkout Started', checkout_created: 'Payment Pending', onsite_pending: 'Reserved - Pay Onsite', paid: 'Paid' };
  return map[status] || status || 'Unpaid';
}

function paymentStatusBadge(status) {
  const normalized = normalizeCustomerPaymentStatus(status);
  return `<span class="payment-badge ${escapeHtml(normalized || 'unpaid')}">${escapeHtml(humanCustomerPaymentStatus(normalized))}</span>`;
}

function normalizeCustomerPaymentStatus(status) {
  return String(status || 'unpaid').trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeCustomerJobStatus(status) {
  return String(status || 'open').trim().toLowerCase().replace(/\s+/g, '_');
}

function isCustomerPaidJob(item = {}) {
  const payStatus = normalizeCustomerPaymentStatus(item.paymentStatus || item.payment_status);
  const jobStatus = normalizeCustomerJobStatus(item.status);
  return payStatus === 'paid'
    || payStatus === 'deposit_paid'
    || jobStatus === 'paid'
    || Boolean(item.paidAt || item.paid_at);
}

function customerJobNeedsCodVerification(item = {}) {
  const jobStatus = normalizeCustomerJobStatus(item.status);
  const codStatus = normalizeCustomerPaymentStatus(item.codVerificationStatus || item.cod_verification_status);
  return jobStatus === 'cod_verification_pending' || codStatus === 'pending';
}

function customerJobNeedsCheckout(item = {}) {
  if (isCustomerPaidJob(item)) return false;
  if (customerJobNeedsCodVerification(item)) return false;

  const payStatus = normalizeCustomerPaymentStatus(item.paymentStatus || item.payment_status);
  if (payStatus === 'onsite_pending') return false;
  const jobStatus = normalizeCustomerJobStatus(item.status);
  if (['refunded', 'canceled', 'cancelled'].includes(payStatus) || ['canceled', 'cancelled', 'completed'].includes(jobStatus)) {
    return false;
  }

  const paymentDueStatuses = new Set(['unpaid', 'checkout_pending', 'checkout_created', 'payment_pending', 'pending', 'failed', 'payment_failed']);
  const checkoutJobStatuses = new Set(['draft', 'quote', 'quote_pending', 'payment_pending', 'checkout_pending', 'checkout_created', 'payment_failed']);
  return paymentDueStatuses.has(payStatus)
    && (checkoutJobStatuses.has(jobStatus) || Boolean(item.stripeCheckoutSessionId || item.stripe_checkout_session_id));
}

function getCustomerCardAction(item) {
  const jobStatus = normalizeCustomerJobStatus(item.status);
  if (customerJobNeedsCodVerification(item)) {
    return { label: 'Verify phone', cls: 'primary', kind: 'verify_phone' };
  }
  if (isCustomerPaidJob(item)) {
    return { label: 'View Paid Scope', cls: 'secondary', kind: 'paid_scope' };
  }
  if (customerJobNeedsCheckout(item)) {
    return { label: 'Continue to Checkout', cls: 'primary', kind: 'checkout' };
  }
  const payStatus = normalizeCustomerPaymentStatus(item.paymentStatus || item.payment_status);
  if (payStatus === 'onsite_pending') return { label: 'Pay Onsite', cls: 'ghost', disabled: true };
  if (jobStatus === 'completed') return { label: 'Completed', cls: 'ghost', disabled: true };
  if (jobStatus === 'cancelled' || jobStatus === 'canceled') return null;
  if (jobStatus === 'scheduled') return { label: 'Scheduled', cls: 'ghost', disabled: true };
  if (jobStatus === 'in_progress') return { label: 'In Progress', cls: 'ghost', disabled: true };
  return { label: 'Waiting for Provider', cls: 'ghost', disabled: true };
}

function customerJobActionHtml(action, jobId) {
  if (!action) return '';
  if (action.disabled) return `<span class="customer-status-label">${escapeHtml(action.label)}</span>`;
  if (action.kind === 'verify_phone') {
    return `<button class="btn ${escapeHtml(action.cls)} small ui-icon-btn" type="button" data-focus-cod-verification="${escapeHtml(jobId || '')}">${uiIcon('shield-check', action.label)}</button>`;
  }
  if (action.kind === 'paid_scope') {
    return `<button class="btn ${escapeHtml(action.cls)} small ui-icon-btn" type="button" data-view-paid-scope="${escapeHtml(jobId || '')}">${uiIcon('clipboard-check', action.label)}</button>`;
  }
  if (action.kind === 'checkout') {
    return `<button class="btn ${escapeHtml(action.cls)} small ui-icon-btn" type="button" onclick="setActiveView('quote')">${uiIcon('credit-card', action.label)}</button>`;
  }
  return '';
}

function customerCodVerificationControlsHtml(jobId) {
  return `
    <div class="cod-verification-panel customer-cod-verification" data-cod-verification-panel data-job-id="${escapeHtml(jobId || '')}">
      <strong>Verify your phone</strong>
      <p class="meta">We sent a verification code by text.</p>
      <label><span>6-digit code</span><input name="codVerificationCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" /></label>
      <div class="checkout-action-bar">
        <button class="btn primary small ui-icon-btn" type="button" data-confirm-cod-code>${uiIcon('circle-check', 'Verify')}</button>
        <button class="btn secondary small ui-icon-btn" type="button" data-resend-cod-code>${uiIcon('refresh-cw', 'Resend code')}</button>
      </div>
      <p class="meta cod-verification-note">Your job is reserved but won’t be opened until the phone number is verified.</p>
      <div class="meta" data-cod-verification-message></div>
    </div>
  `;
}

/* ── Nav link helper (copy-address buttons) ─────────────────────────────── */

function navLinksHtml(job) {
  const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');
  if (!addr.trim()) return '';
  const enc = encodeURIComponent(addr);
  return `<div class="nav-link-row">
    <a class="nav-link-btn ui-icon-btn" href="https://www.google.com/maps/search/?api=1&query=${enc}" target="_blank" rel="noopener">${uiIcon('map-pin', 'Google Maps')}</a>
    <a class="nav-link-btn ui-icon-btn" href="https://maps.apple.com/?q=${enc}" target="_blank" rel="noopener">${uiIcon('map', 'Apple Maps')}</a>
    <a class="nav-link-btn ui-icon-btn" href="https://waze.com/ul?q=${enc}&navigate=yes" target="_blank" rel="noopener">${uiIcon('navigation', 'Waze')}</a>
    <button class="nav-link-btn ui-icon-btn" type="button" data-copy-addr="${escapeHtml(addr)}">${uiIcon('clipboard-check', 'Copy Address')}</button>
  </div>`;
}

/* ── Customer quotes loader ──────────────────────────────────────────────── */

async function loadMyQuotes() {
  const list = byId('accountQuotes');
  if (!list) return;

  if (!hasActiveSession()) {
    list.innerHTML = accountEmptyMessage('Sign in to see your quotes.');
    return;
  }

  list.innerHTML = accountEmptyMessage('Loading quotes...');

  try {
    const data = await api('/api/customer/quotes');
    const quotes = data.quotes || [];
    list.innerHTML = '';

    if (!quotes.length) {
      list.innerHTML = `<div class="customer-empty-state">
        <p>No lawn quotes yet.</p>
        <p>Start a quote to get instant pricing for your property.</p>
        <button class="btn primary ui-icon-btn" onclick="setActiveView('quote')">${uiIcon('calculator', 'Start New Quote')}</button>
      </div>`;
      return;
    }

    quotes.forEach((quote) => {
      const service = quote.serviceType || quote.service_type || 'mowing';
      const addr = [quote.address, quote.city, quote.state].filter(Boolean).join(', ') || '—';
      const estimate = quote.estimate || quote.amount || quote.price || 0;
      const quoteStatus = quote.status || 'new';
      const actionLabel = (quoteStatus === 'new' || quoteStatus === 'manual_requested') ? 'Review Quote' : 'Continue Checkout';
      list.append(card(`
        <div class="customer-card-head">
          <h4>${escapeHtml(serviceLabel(service))}</h4>
          ${statusBadge(quoteStatus)}
        </div>
        <div class="meta">${escapeHtml(addr)}</div>
        <div class="meta">Estimate: <strong>${formatCustomerMoney(estimate)}</strong></div>
        <div class="meta customer-date">Requested: ${escapeHtml(formatCustomerDate(quote.created_at || quote.createdAt))}</div>
        <div class="customer-card-footer">
          <button class="btn primary small ui-icon-btn" onclick="setActiveView('quote')">${uiIcon(actionLabel.includes('Checkout') ? 'credit-card' : 'calculator', actionLabel)}</button>
        </div>
      `));
    });
  } catch {
    list.innerHTML = accountEmptyMessage('Quotes are not available yet.');
  }
}

/* ── Customer jobs loader ────────────────────────────────────────────────── */

async function loadMyJobs(targetId = 'myJobsList') {
  const list = byId(targetId);
  if (!list) return;

  if (!hasActiveSession()) {
    list.innerHTML = '<div class="account-empty">Sign in to see your bookings.</div>';
    return;
  }

  list.innerHTML = '<div class="account-empty">Loading…</div>';

  try {
    const data = await api('/api/jobs/my');
    const jobs = data.jobs || [];
    list.innerHTML = '';

    if (!jobs.length) {
      list.innerHTML = `<div class="customer-empty-state">
        <p>No lawn jobs yet.</p>
        <p>Start a quote to get instant pricing for your property.</p>
        <button class="btn primary ui-icon-btn" onclick="setActiveView('quote')">${uiIcon('calculator', 'Start New Quote')}</button>
      </div>`;
      return;
    }

    jobs.forEach((job) => {
      const safe = sanitizeJobForPublic(job);
      const addr = [job.address, safe.city, safe.state].filter(Boolean).join(', ') || safe.location || '—';
      const amount = job.paidAmount || job.estimateAtBooking || safe.amount || 0;
      const payStatus = normalizeCustomerPaymentStatus(job.paymentStatus || job.payment_status || safe.paymentStatus);
      const action = getCustomerCardAction({ ...job, ...safe, paymentStatus: payStatus });
      const actionHtml = customerJobActionHtml(action, safe.id);
      const codVerificationHtml = customerJobNeedsCodVerification(job)
        ? customerCodVerificationControlsHtml(safe.id)
        : '';
      const c = card(`
        <div class="customer-card-head">
          <h4>${escapeHtml(serviceLabel(safe.serviceType))}</h4>
          ${statusBadge(safe.status)}
        </div>
        <div class="meta">${escapeHtml(addr)}</div>
        <div class="meta">Amount: <strong>${formatCustomerMoney(amount)}</strong> &nbsp; ${paymentStatusBadge(payStatus)}</div>
        <div class="meta customer-date">Booked: ${escapeHtml(formatCustomerDate(job.createdAt || safe.postedAt))}</div>
        ${renderJobScopeSnapshot(job, safe)}
        ${codVerificationHtml}
        <div class="customer-card-footer">${actionHtml}</div>
      `);
      list.append(c);
    });
    if (typeof initJobScopeSnapshotMaps === 'function') initJobScopeSnapshotMaps(list);
  } catch {
    list.innerHTML = '<div class="account-empty">Could not load bookings. Please sign in and try again.</div>';
  }
}

/* ── Jobs tab event handler ──────────────────────────────────────────────── */

jobsBindOnce(byId('showMyJobsBtn'), 'click', 'show-my-jobs', () => {
  byId('myBookingsPanelTitle') && (byId('myBookingsPanelTitle').textContent = 'My Jobs');
  loadMyJobs();
});

/* ── Copy-address delegated handler ─────────────────────────────────────── */

jobsBindOnce(document, 'click', 'copy-address', (e) => {
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

jobsBindOnce(document, 'click', 'view-paid-scope', (e) => {
  const btn = e.target.closest('[data-view-paid-scope]');
  if (!btn) return;
  const cardEl = btn.closest('.card');
  const scopeEl = cardEl?.querySelector('.job-scope-snapshot');
  if (scopeEl) {
    scopeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    scopeEl.classList.add('is-highlighted');
    setTimeout(() => scopeEl.classList.remove('is-highlighted'), 1200);
  }
});

jobsBindOnce(document, 'click', 'focus-cod-verification', (e) => {
  const btn = e.target.closest('[data-focus-cod-verification]');
  if (!btn) return;
  const cardEl = btn.closest('.card');
  const panel = cardEl?.querySelector('[data-cod-verification-panel]');
  const input = panel?.querySelector('input[name="codVerificationCode"]');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (input) setTimeout(() => input.focus(), 250);
});

/* ── Public job photo preview (Phase 13f) ────────────────────────────────── */

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

/* ── Public open-jobs board loader (Phase 13f) ───────────────────────────── */

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

  const jobs = data.jobs || [];
  list.innerHTML = '';

  if (!jobs.length) {
    list.append(card('<h4>No open jobs yet</h4><div class="meta">Post a job to seed the marketplace board.</div>'));
    return;
  }

  jobs.forEach((job) => {
    const safe = sanitizeJobForPublic(job);
    list.append(card(`
      <h4>${escapeHtml(safe.title)}</h4>
      <div class="meta">${escapeHtml(serviceLabel(safe.serviceType))} &middot; ${escapeHtml(safe.location)}</div>
      <div class="meta">Estimate ${money(safe.amount)} &middot; Preferred ${escapeHtml(safe.preferredDate || 'Flexible')} &middot; ${statusBadge(safe.status)}</div>
    `));
  });
}

/* ── Window exports (referenced from app.js and auth-ui.js) ─────────────── */

window.loadMyJobs = loadMyJobs;
window.loadMyQuotes = loadMyQuotes;
window.sanitizeJobForPublic = sanitizeJobForPublic;
window.sanitizeCustomerName = sanitizeCustomerName;
window.renderJobScopeSnapshot = renderJobScopeSnapshot;
window.statusBadge = statusBadge;
window.renderJobPhotoPreview = renderJobPhotoPreview;
window.loadJobs = loadJobs;
window.formatCustomerDate = formatCustomerDate;
window.formatCustomerMoney = formatCustomerMoney;
window.humanCustomerJobStatus = humanCustomerJobStatus;
window.humanCustomerPaymentStatus = humanCustomerPaymentStatus;
window.paymentStatusBadge = paymentStatusBadge;
window.getCustomerCardAction = getCustomerCardAction;
window.normalizeCustomerPaymentStatus = normalizeCustomerPaymentStatus;
window.isCustomerPaidJob = isCustomerPaidJob;
window.customerJobNeedsCheckout = customerJobNeedsCheckout;
