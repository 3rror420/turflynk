// jobs-ui.js — Customer jobs/quotes UI helpers (Phase 7 modular refactor)
// Depends on: state (state.js), byId/$$ (utils/dom.js), api (core/api.js),
//   escapeHtml/card/money/showSuccess/showError/showInfo (utils/dom.js),
//   hasActiveSession (auth/auth-ui.js), serviceLabel/regionLabel/accountEmptyMessage (app.js)
// Must load after: config.js, state.js, utils/dom.js, auth/auth-ui.js, core/api.js
// Must load before: app.js

/* ── Customer name / job sanitizers ─────────────────────────────────────── */

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
  if (!scope || !Object.keys(scope).length) return '';
  const access = scope.access || {};
  const options = scope.serviceOptions || {};
  const mowSqft = Number(scope.mowableAreaSqFt || scope.mowAreaSqft || 0);
  const lotSqft = Number(scope.lotAreaSqFt || scope.lotAreaSqft || 0);
  const price = Number(scope.paidAmount || scope.finalAmount || safe.amount || 0);
  const tip = Number(scope.tipAmount || 0);
  const mapItems = [
    countGeoJsonFeatures(scope.parcelGeoJSON) ? 'parcel saved' : '',
    countGeoJsonFeatures(scope.selectedMowableGeoJSON) ? `${countGeoJsonFeatures(scope.selectedMowableGeoJSON)} mowable area${countGeoJsonFeatures(scope.selectedMowableGeoJSON) === 1 ? '' : 's'} saved` : '',
    countGeoJsonFeatures(scope.excludedGeoJSON) ? `${countGeoJsonFeatures(scope.excludedGeoJSON)} cutout${countGeoJsonFeatures(scope.excludedGeoJSON) === 1 ? '' : 's'} saved` : '',
  ].filter(Boolean).join(' · ');
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
    <div class="job-scope-snapshot" aria-label="Paid scope snapshot">
      <div class="meta"><strong>Paid scope:</strong> ${escapeHtml(serviceText || `${serviceLabel(scope.serviceType || safe.serviceType)} from MowNWA`)}</div>
      ${mowSqft ? `<div class="meta">Mowable area: <strong>${escapeHtml(scopeAreaLabel(mowSqft))}</strong>${lotSqft ? ` · Lot: ${escapeHtml(scopeAreaLabel(lotSqft))}` : ''}</div>` : ''}
      <div class="meta">Price: <strong>${money(price)}</strong>${tip > 0 ? ` · Tip: <strong>${money(tip)}</strong>` : ''}</div>
      ${accessText ? `<div class="meta">Service/access: ${escapeHtml(accessText)}</div>` : ''}
      ${scope.customerNotes ? `<div class="meta">Customer notes: ${escapeHtml(scope.customerNotes)}</div>` : ''}
      <div class="map-placeholder">${escapeHtml(mapItems || 'Map snapshot saved for this job.')}</div>
    </div>
  `;
}

/* ── Status badge ────────────────────────────────────────────────────────── */

function statusBadge(status) {
  return `<span class="status-badge ${escapeHtml(status || 'open')}">${escapeHtml(status || 'open')}</span>`;
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
  const map = { open: 'Open', assigned: 'Assigned', scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled', canceled: 'Cancelled' };
  return map[status] || status || 'Open';
}

function humanCustomerPaymentStatus(status) {
  const map = { unpaid: 'Unpaid', checkout_pending: 'Checkout Started', checkout_created: 'Payment Pending', paid: 'Paid' };
  return map[status] || status || 'Unpaid';
}

function paymentStatusBadge(status) {
  return `<span class="payment-badge ${escapeHtml(status || 'unpaid')}">${escapeHtml(humanCustomerPaymentStatus(status))}</span>`;
}

function getCustomerCardAction(item) {
  const payStatus = item.paymentStatus || item.payment_status || 'unpaid';
  const jobStatus = item.status || 'open';
  if (payStatus === 'unpaid' || payStatus === 'checkout_pending' || payStatus === 'checkout_created') {
    return { label: 'Continue Checkout', cls: 'primary' };
  }
  if (jobStatus === 'completed') return { label: 'Completed', cls: 'ghost', disabled: true };
  if (jobStatus === 'cancelled' || jobStatus === 'canceled') return null;
  if (jobStatus === 'scheduled') return { label: 'Scheduled', cls: 'ghost', disabled: true };
  if (jobStatus === 'in_progress') return { label: 'In Progress', cls: 'ghost', disabled: true };
  return { label: 'Waiting for Provider', cls: 'ghost', disabled: true };
}

/* ── Nav link helper (copy-address buttons) ─────────────────────────────── */

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
        <button class="btn primary" onclick="setActiveView('quote')">Start New Quote</button>
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
          <button class="btn primary small" onclick="setActiveView('quote')">${escapeHtml(actionLabel)}</button>
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
        <button class="btn primary" onclick="setActiveView('quote')">Start New Quote</button>
      </div>`;
      return;
    }

    jobs.forEach((job) => {
      const safe = sanitizeJobForPublic(job);
      const addr = [job.address, safe.city, safe.state].filter(Boolean).join(', ') || safe.location || '—';
      const amount = job.paidAmount || job.estimateAtBooking || safe.amount || 0;
      const payStatus = job.paymentStatus || safe.paymentStatus || 'unpaid';
      const action = getCustomerCardAction({ ...safe, paymentStatus: payStatus });
      const actionHtml = action
        ? action.disabled
          ? `<span class="customer-status-label">${escapeHtml(action.label)}</span>`
          : `<button class="btn ${escapeHtml(action.cls)} small" onclick="setActiveView('quote')">${escapeHtml(action.label)}</button>`
        : '';
      const c = card(`
        <div class="customer-card-head">
          <h4>${escapeHtml(serviceLabel(safe.serviceType))}</h4>
          ${statusBadge(safe.status)}
        </div>
        <div class="meta">${escapeHtml(addr)}</div>
        <div class="meta">Amount: <strong>${formatCustomerMoney(amount)}</strong> &nbsp; ${paymentStatusBadge(payStatus)}</div>
        <div class="meta customer-date">Booked: ${escapeHtml(formatCustomerDate(job.createdAt || safe.postedAt))}</div>
        <div class="customer-card-footer">${actionHtml}</div>
      `);
      list.append(c);
    });
  } catch {
    list.innerHTML = '<div class="account-empty">Could not load bookings. Please sign in and try again.</div>';
  }
}

/* ── Jobs tab event handler ──────────────────────────────────────────────── */

byId('showMyJobsBtn')?.addEventListener('click', () => {
  byId('myBookingsPanelTitle') && (byId('myBookingsPanelTitle').textContent = 'My Jobs');
  loadMyJobs();
});

/* ── Copy-address delegated handler ─────────────────────────────────────── */

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
