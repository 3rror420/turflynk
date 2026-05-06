// provider-ui.js — Provider dashboard/profile/jobs/services/areas UI (Phase 8 modular refactor)
// Depends on: state (state.js), byId/$$/card/escapeHtml/money/showSuccess/showError/showResult (utils/dom.js),
//   api/prettyApiError (core/api.js), hasActiveSession/openAuthGate (auth/auth-ui.js),
//   isAdmin (auth/admin-visibility.js), SERVICE_CATALOG/SERVICE_AREA_OPTIONS (config.js),
//   sanitizeJobForPublic/statusBadge/renderJobScopeSnapshot (jobs-ui.js),
//   accountEmptyMessage/serviceLabel/regionLabel/selectedServiceMeta/formToObject/
//   multiSelectValues/checkedValues/loadMyJobs/loadAdmin (app.js)
// Must load after: config.js, state.js, utils/dom.js, auth/auth-ui.js, core/api.js, jobs-ui.js
// Must load before: app.js

/* ── Provider setup helpers ──────────────────────────────────────────────── */

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

  if (!hasActiveSession()) {
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

/* ── Provider area navigation ────────────────────────────────────────────── */

const PROVIDER_AREA_SECTIONS = new Set(['dashboard', 'jobs', 'history', 'services', 'areas', 'profile', 'settings']);

function isProviderUser() {
  return state.currentUser?.role === 'provider' || state.currentUser?.role === 'admin';
}

function providerWorkspace() {
  return byId('providerWorkspaceContent');
}

function setProviderActiveTab(section) {
  $$('[data-provider-tab]').forEach((btn) => {
    const active = btn.dataset.providerTab === section;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function renderProviderArea(section = 'dashboard') {
  const nextSection = PROVIDER_AREA_SECTIONS.has(section) ? section : 'dashboard';
  state.providerAreaSection = nextSection;
  setProviderActiveTab(nextSection);
  const el = providerWorkspace();
  if (!el) return;
  if (!isProviderUser()) {
    el.innerHTML = accountEmptyMessage('Sign in as a provider to use the Provider Area.');
    return;
  }

  if (nextSection === 'dashboard') return renderProviderDashboard();
  if (nextSection === 'jobs') return renderProviderJobs('active');
  if (nextSection === 'history') return renderProviderJobHistory('history');
  if (nextSection === 'services') return renderProviderServices();
  if (nextSection === 'areas') return renderProviderServiceAreas();
  if (nextSection === 'profile') return renderProviderProfile();
  if (nextSection === 'settings') return renderProviderSettings();
}

function providerLoading(title) {
  const el = providerWorkspace();
  if (el) el.innerHTML = `<h3>${escapeHtml(title)}</h3><div class="account-card">${accountEmptyMessage('Loading...')}</div>`;
}

function providerError(title, error) {
  const el = providerWorkspace();
  if (el) el.innerHTML = `<h3>${escapeHtml(title)}</h3><div class="account-card">${accountEmptyMessage(prettyApiError(error))}</div>`;
}

function providerQuickButton(label, section) {
  return `<button class="btn secondary small" type="button" data-provider-action="${escapeHtml(section)}">${escapeHtml(label)}</button>`;
}

/* ── Provider dashboard ──────────────────────────────────────────────────── */

async function renderProviderDashboard() {
  providerLoading('Provider Dashboard');
  try {
    const data = await api('/api/provider/overview');
    const metrics = data.metrics || {};
    const el = providerWorkspace();
    if (!el) return;
    el.innerHTML = `
      <h3>Provider Dashboard</h3>
      <div class="metrics provider-metrics">
        <div class="metric"><strong>${Number(metrics.openAssignedJobs || 0)}</strong><span>Open / assigned</span></div>
        <div class="metric"><strong>${Number(metrics.upcomingJobs || 0)}</strong><span>Upcoming</span></div>
        <div class="metric"><strong>${Number(metrics.completedJobs || 0)}</strong><span>Completed</span></div>
        <div class="metric"><strong>${money(metrics.estimatedRevenuePipeline || 0)}</strong><span>Pipeline</span></div>
      </div>
      <div class="provider-quick-actions">
        ${providerQuickButton('View My Jobs', 'jobs')}
        ${providerQuickButton('Edit Services', 'services')}
        ${providerQuickButton('Edit Service Areas', 'areas')}
        ${providerQuickButton('Provider Profile', 'profile')}
      </div>
      <h3>Recent Jobs</h3>
      <div id="providerRecentJobs" class="card-list"></div>
    `;
    wireProviderActionButtons(el);
    const list = byId('providerRecentJobs');
    if (!data.recentJobs?.length) {
      list.innerHTML = accountEmptyMessage('No assigned jobs yet.');
      return;
    }
    data.recentJobs.forEach((job) => list.append(providerJobCard(job, { compact: true })));
  } catch (error) {
    providerError('Provider Dashboard', error);
  }
}

function wireProviderActionButtons(root = document) {
  $$('[data-provider-action]', root).forEach((btn) => {
    btn.addEventListener('click', () => renderProviderArea(btn.dataset.providerAction));
  });
}

/* ── Provider job card helpers ───────────────────────────────────────────── */

function providerJobAddress(job = {}) {
  return [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');
}

function providerPhotosHtml(job = {}) {
  const photos = Array.isArray(job.photos) ? job.photos : [];
  if (!photos.length) return '';
  const links = photos.map((photo, index) => {
    const url = typeof photo === 'string' ? photo : (photo.url || photo.fileUrl || photo.file_url || '');
    if (!url) return '';
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Photo ${index + 1}</a>`;
  }).filter(Boolean).join(' ');
  return links ? `<div class="meta">Photos: ${links}</div>` : '';
}

function providerJobActions(job = {}) {
  const id = escapeHtml(job.id || '');
  const status = job.status || '';
  const actions = [];
  if (['assigned', 'claimed'].includes(status)) actions.push(['scheduled', 'Mark scheduled']);
  if (['assigned', 'claimed', 'scheduled'].includes(status)) actions.push(['in_progress', 'Mark in progress']);
  if (['assigned', 'claimed', 'scheduled', 'in_progress'].includes(status)) actions.push(['completed', 'Mark completed']);
  if (!['completed', 'canceled', 'cancelled', 'refunded'].includes(status)) actions.push(['canceled', 'Cancel / decline']);
  return actions.length ? `
    <div class="provider-job-actions">
      ${actions.map(([nextStatus, label]) => `<button class="btn secondary small" type="button" data-provider-job-status="${escapeHtml(nextStatus)}" data-provider-job-id="${id}">${escapeHtml(label)}</button>`).join('')}
    </div>
  ` : '';
}

function providerJobCard(job = {}, options = {}) {
  const safe = sanitizeJobForPublic(job);
  const address = providerJobAddress(job) || safe.location;
  const created = job.createdAt || job.postedAt || safe.postedAt;
  const details = String(job.details || '').trim();
  const access = [job.yard_access_notes ? `Access: ${job.yard_access_notes}` : '', job.mower_access ? `Mower access: ${job.mower_access}` : ''].filter(Boolean).join(' - ');
  const html = `
    <div class="provider-job-card-head">
      <div>
        <h4>${escapeHtml(safe.title || 'Lawn Service')}</h4>
        <div class="meta">${escapeHtml(serviceLabel(safe.serviceType))} &middot; ${statusBadge(safe.status)}</div>
      </div>
      <strong>${money(safe.amount)}</strong>
    </div>
    <div class="account-field"><span>Customer</span><strong>${escapeHtml(job.customerName || safe.customerName || 'Customer')}</strong></div>
    ${job.customerPhone || job.customerEmail ? `<div class="meta">${escapeHtml([job.customerPhone, job.customerEmail].filter(Boolean).join(' - '))}</div>` : ''}
    <div class="meta">${escapeHtml(address || 'Address pending')}</div>
    <div class="meta">Preferred: ${escapeHtml(safe.preferredDate || 'Flexible')} &middot; Created: ${created ? escapeHtml(new Date(created).toLocaleDateString()) : 'n/a'}</div>
    ${access ? `<div class="meta">${escapeHtml(access)}</div>` : ''}
    ${providerPhotosHtml(job)}
    ${options.compact ? '' : `<details class="provider-job-details"><summary>View details</summary><pre>${escapeHtml(details || 'No notes yet.')}</pre>${renderJobScopeSnapshot(job, safe)}</details>`}
    ${options.readonly ? '' : providerJobActions(job)}
  `;
  const item = card(html);
  item.classList.add('provider-job-card');
  return item;
}

function wireProviderJobStatusButtons(root = document, reload = () => renderProviderJobs('active')) {
  $$('[data-provider-job-status]', root).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.providerJobStatus;
      const jobId = btn.dataset.providerJobId;
      const reason = status === 'canceled' ? (window.prompt('Reason for canceling or declining this job?') || '') : '';
      btn.disabled = true;
      try {
        await api(`/api/provider/jobs/${encodeURIComponent(jobId)}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status, reason })
        });
        showSuccess('Job updated');
        await reload();
      } catch (error) {
        showError(prettyApiError(error));
        btn.disabled = false;
      }
    });
  });
}

/* ── Provider job views ──────────────────────────────────────────────────── */

async function renderProviderJobs(filter = 'active') {
  providerLoading('My Jobs');
  try {
    const data = await api(`/api/provider/jobs?filter=${encodeURIComponent(filter)}`);
    const el = providerWorkspace();
    if (!el) return;
    el.innerHTML = `
      <div class="provider-section-head">
        <h3>My Jobs</h3>
        <button class="btn secondary small" type="button" id="refreshProviderJobsBtn">Refresh</button>
      </div>
      <div id="providerJobsList" class="card-list"></div>
    `;
    byId('refreshProviderJobsBtn')?.addEventListener('click', () => renderProviderJobs(filter));
    const list = byId('providerJobsList');
    if (!data.jobs?.length) {
      list.innerHTML = accountEmptyMessage('No active assigned jobs right now.');
      return;
    }
    data.jobs.forEach((job) => list.append(providerJobCard(job)));
    wireProviderJobStatusButtons(list, () => renderProviderJobs(filter));
  } catch (error) {
    providerError('My Jobs', error);
  }
}

async function renderProviderJobHistory(filter = 'history') {
  providerLoading('Job History');
  try {
    const data = await api(`/api/provider/jobs?filter=${encodeURIComponent(filter)}`);
    const el = providerWorkspace();
    if (!el) return;
    const filters = [
      ['active', 'Active jobs'],
      ['upcoming', 'Upcoming jobs'],
      ['completed', 'Completed jobs'],
      ['canceled', 'Canceled jobs'],
      ['history', 'All history']
    ];
    el.innerHTML = `
      <h3>Job History</h3>
      <div class="provider-filter-row">
        ${filters.map(([value, label]) => `<button class="account-menu-item ${value === filter ? 'active' : ''}" type="button" data-provider-history-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('')}
      </div>
      <div id="providerHistoryList" class="card-list"></div>
    `;
    $$('[data-provider-history-filter]', el).forEach((btn) => {
      btn.addEventListener('click', () => renderProviderJobHistory(btn.dataset.providerHistoryFilter));
    });
    const list = byId('providerHistoryList');
    if (!data.jobs?.length) {
      list.innerHTML = accountEmptyMessage('No jobs match this filter.');
      return;
    }
    data.jobs.forEach((job) => list.append(providerJobCard(job, { readonly: ['completed', 'canceled', 'cancelled', 'refunded'].includes(job.status) })));
    wireProviderJobStatusButtons(list, () => renderProviderJobHistory(filter));
  } catch (error) {
    providerError('Job History', error);
  }
}

/* ── Provider services ───────────────────────────────────────────────────── */

async function renderProviderServices() {
  providerLoading('Services');
  try {
    const data = await api('/api/provider/services');
    const services = data.services || [];
    const el = providerWorkspace();
    if (!el) return;
    el.innerHTML = `
      <h3>Services</h3>
      <form id="providerServicesForm" class="stack provider-services-form">
        ${services.map((service) => `
          <section class="account-card provider-service-row" data-provider-service-id="${escapeHtml(service.id)}">
            <label class="provider-service-toggle"><input type="checkbox" name="enabled" ${service.enabled ? 'checked' : ''} /> <strong>${escapeHtml(service.label || service.id)}</strong></label>
            <div class="grid-3">
              <label><span>Base / minimum price</span><input name="basePrice" type="number" min="0" step="1" value="${escapeHtml(service.basePrice || service.minimumPrice || '')}" /></label>
              <label><span>Minimum price</span><input name="minimumPrice" type="number" min="0" step="1" value="${escapeHtml(service.minimumPrice || '')}" /></label>
              <label><span>Rate per sq ft</span><input name="ratePerSqft" type="number" min="0" step="0.001" value="${escapeHtml(service.ratePerSqft || '')}" /></label>
            </div>
            <label><span>Notes</span><textarea name="notes" rows="2">${escapeHtml(service.notes || '')}</textarea></label>
          </section>
        `).join('')}
        <button class="btn primary" type="submit">Save Services</button>
      </form>
      <div id="providerServicesResult" class="result hidden"></div>
    `;
    byId('providerServicesForm')?.addEventListener('submit', saveProviderServices);
  } catch (error) {
    providerError('Services', error);
  }
}

async function saveProviderServices(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const services = $$('.provider-service-row', form).map((row) => ({
    id: row.dataset.providerServiceId,
    enabled: Boolean(row.querySelector('[name="enabled"]')?.checked),
    basePrice: Number(row.querySelector('[name="basePrice"]')?.value || 0),
    minimumPrice: Number(row.querySelector('[name="minimumPrice"]')?.value || 0),
    ratePerSqft: Number(row.querySelector('[name="ratePerSqft"]')?.value || 0),
    notes: row.querySelector('[name="notes"]')?.value || ''
  }));
  try {
    await api('/api/provider/services', { method: 'PUT', body: JSON.stringify({ services }) });
    showResult('providerServicesResult', '<strong>Saved.</strong> Services updated.');
    showSuccess('Services saved');
  } catch (error) {
    showResult('providerServicesResult', `<strong>Failed:</strong> ${escapeHtml(prettyApiError(error))}`);
  }
}

/* ── Provider service areas ──────────────────────────────────────────────── */

async function renderProviderServiceAreas() {
  providerLoading('Service Areas');
  try {
    const data = await api('/api/provider/service-areas');
    const cities = new Set((data.cities || []).map((item) => item.city || item));
    const counties = (data.counties || []).join(', ');
    const settings = data.service_area_settings || {};
    const prefs = data.preferences || {};
    const el = providerWorkspace();
    if (!el) return;
    el.innerHTML = `
      <h3>Service Areas</h3>
      <form id="providerAreasForm" class="stack">
        <div class="checks compact-checks provider-city-checks">
          ${SERVICE_AREA_OPTIONS.map((city) => `<label><input type="checkbox" name="cities" value="${escapeHtml(city)}" ${cities.has(city) ? 'checked' : ''} /> ${escapeHtml(city)}</label>`).join('')}
        </div>
        <div class="grid-2">
          <label><span>Counties served</span><input name="counties" value="${escapeHtml(counties)}" placeholder="Benton, Washington" /></label>
          <label><span>Radius from base</span><input name="radiusMiles" type="number" min="0" step="1" value="${escapeHtml(settings.radius_miles ?? '')}" /></label>
        </div>
        <div class="grid-2">
          <label><span>Base address / ZIP</span><input name="baseAddress" value="${escapeHtml(settings.base_address || '')}" placeholder="Street or ZIP" /></label>
          <label><span>Base city</span><input name="baseCity" value="${escapeHtml(settings.base_city || '')}" placeholder="Bentonville" /></label>
        </div>
        <div class="grid-2">
          <label><span>Nearby jobs</span><select name="acceptsNearbyJobs"><option value="false">Only selected areas</option><option value="true" ${prefs.accepts_nearby_jobs ? 'selected' : ''}>Show nearby jobs too</option></select></label>
          <label><span>Pause new jobs</span><select name="serviceAreasPaused"><option value="false">Active</option><option value="true" ${prefs.service_areas_paused ? 'selected' : ''}>Paused</option></select></label>
        </div>
        <label><span>Notes</span><textarea name="notes" rows="3">${escapeHtml(settings.notes || '')}</textarea></label>
        <button class="btn primary" type="submit">Save Service Areas</button>
      </form>
      <div id="providerAreasResult" class="result hidden"></div>
    `;
    byId('providerAreasForm')?.addEventListener('submit', saveProviderServiceAreas);
  } catch (error) {
    providerError('Service Areas', error);
  }
}

async function saveProviderServiceAreas(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    cities: checkedValues('cities', form),
    counties: String(form.elements.counties?.value || '').split(',').map((item) => item.trim()).filter(Boolean),
    radiusMiles: form.elements.radiusMiles?.value || '',
    baseAddress: form.elements.baseAddress?.value || '',
    baseCity: form.elements.baseCity?.value || '',
    acceptsNearbyJobs: form.elements.acceptsNearbyJobs?.value === 'true',
    serviceAreasPaused: form.elements.serviceAreasPaused?.value === 'true',
    notes: form.elements.notes?.value || ''
  };
  try {
    await api('/api/provider/service-areas', { method: 'PUT', body: JSON.stringify(payload) });
    showResult('providerAreasResult', '<strong>Saved.</strong> Service areas updated.');
    showSuccess('Service areas saved');
  } catch (error) {
    showResult('providerAreasResult', `<strong>Failed:</strong> ${escapeHtml(prettyApiError(error))}`);
  }
}

/* ── Provider profile / settings ─────────────────────────────────────────── */

async function renderProviderProfile() {
  providerLoading('Provider Profile');
  try {
    const data = await api('/api/provider/profile');
    const profile = data.profile || {};
    const el = providerWorkspace();
    if (!el) return;
    el.innerHTML = `
      <h3>Provider Profile</h3>
      <form id="providerProfileForm" class="stack">
        <div class="grid-2">
          <label><span>Business name</span><input name="businessName" value="${escapeHtml(profile.businessName || '')}" /></label>
          <label><span>Contact name</span><input name="contactName" value="${escapeHtml(profile.contactName || profile.user?.fullName || '')}" /></label>
        </div>
        <div class="grid-2">
          <label><span>Phone</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(profile.phone || '')}" /></label>
          <label><span>Email</span><input name="email" type="email" value="${escapeHtml(profile.email || profile.user?.email || '')}" /></label>
        </div>
        <div class="grid-2">
          <label><span>Business address / base ZIP</span><input name="businessAddress" value="${escapeHtml(profile.businessAddress || '')}" /></label>
          <label><span>Base city</span><input name="baseCity" value="${escapeHtml(profile.baseCity || '')}" /></label>
        </div>
        <div class="grid-2">
          <label><span>Deck size / mower size</span><input name="mowerDeckSizeInches" type="number" min="0" step="1" value="${escapeHtml(profile.mowerDeckSizeInches || profile.deckSize || '')}" /></label>
          <label><span>Photo / logo URL</span><input name="logoUrl" value="${escapeHtml(profile.logoUrl || '')}" /></label>
        </div>
        <label><span>Equipment</span><input name="equipment" value="${escapeHtml(profile.equipment || '')}" /></label>
        <label><span>Bio / notes</span><textarea name="bio" rows="4">${escapeHtml(profile.bio || '')}</textarea></label>
        <button class="btn primary" type="submit">Save Provider Profile</button>
      </form>
      <div id="providerProfileResult" class="result hidden"></div>
    `;
    byId('providerProfileForm')?.addEventListener('submit', saveProviderProfile);
  } catch (error) {
    providerError('Provider Profile', error);
  }
}

async function saveProviderProfile(event) {
  event.preventDefault();
  const payload = formToObject(event.currentTarget);
  try {
    await api('/api/provider/profile', { method: 'PUT', body: JSON.stringify(payload) });
    showResult('providerProfileResult', '<strong>Saved.</strong> Provider profile updated.');
    showSuccess('Provider profile saved');
  } catch (error) {
    showResult('providerProfileResult', `<strong>Failed:</strong> ${escapeHtml(prettyApiError(error))}`);
  }
}

function renderProviderSettings() {
  const el = providerWorkspace();
  if (!el) return;
  el.innerHTML = `
    <h3>Settings</h3>
    <div class="account-card">
      <div class="account-field"><span>Email notifications</span><strong>On</strong></div>
      <div class="account-field"><span>SMS notifications</span><strong>Use profile phone</strong></div>
      <div class="account-field"><span>Job matching</span><strong>Based on service areas and services</strong></div>
    </div>
    <div class="provider-quick-actions">
      ${providerQuickButton('Edit Profile', 'profile')}
      ${providerQuickButton('Edit Service Areas', 'areas')}
      ${providerQuickButton('Edit Services', 'services')}
    </div>
  `;
  wireProviderActionButtons(el);
}

/* ── Provider marketplace / paid jobs ───────────────────────────────────── */

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
      <div class="meta">${escapeHtml(provider.ownerName || '')} · Rating ${escapeHtml(provider.rating || 'n/a')}</div>
      <div class="meta">Regions: ${escapeHtml((provider.regions || []).map(regionLabel).join(', '))}</div>
      <div class="meta">Cities: ${escapeHtml((provider.cities || []).join(', '))}</div>
      <div class="meta">Services: ${escapeHtml((provider.servicesOffered || provider.services || []).map((id) => selectedServiceMeta(id).title || serviceLabel(id)).join(', '))}</div>
      <p>${escapeHtml(provider.bio || 'No bio yet.')}</p>
      <div class="meta">Equipment: ${escapeHtml(provider.equipment || 'n/a')}</div>
      <div class="meta">Main deck: ${provider.mowerDeckSizeInches || 'n/a'} in · Small-gate mower: ${provider.hasSmallGateMower ? 'yes' : 'no'}</div>
    `));
  });
}

async function loadProviderPaidJobs() {
  const list = byId('providerPaidJobsList');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--muted);padding:12px">Loading...</div>';
  try {
    const data = await api('/api/provider/paid-jobs');
    if (!data.jobs?.length) {
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No paid jobs available in your area.</div>';
      return;
    }
    list.innerHTML = '';
    data.jobs.forEach((job) => {
      const safe = sanitizeJobForPublic(job);
      list.append(card(`
        <h4 style="margin:0">${escapeHtml(safe.title || 'Mowing job')}</h4>
        <div class="meta">${escapeHtml(serviceLabel(safe.serviceType))} &middot; ${escapeHtml(safe.location)}</div>
        <div class="meta">Estimate: <strong>${money(safe.amount)}</strong> &middot; Preferred ${escapeHtml(safe.preferredDate || 'Flexible')}</div>
        <div class="meta">${statusBadge(safe.status)}</div>
        <button class="btn primary small" type="button" data-claim-paid-job="${escapeHtml(safe.id)}" style="margin-top:8px">Claim Job</button>
      `));
    });
    list.querySelectorAll('[data-claim-paid-job]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Claiming...';
        try {
          await api(`/api/jobs/${encodeURIComponent(btn.dataset.claimPaidJob)}/claim`, { method: 'POST', body: '{}' });
          showSuccess('Job claimed');
          await loadProviderPaidJobs();
          if (state.providerAreaSection === 'jobs') await renderProviderJobs('active');
        } catch (error) {
          showError(prettyApiError(error));
          btn.disabled = false;
          btn.textContent = 'Claim Job';
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="color:var(--muted);padding:12px">Could not load paid jobs: ${escapeHtml(err.message)}</div>`;
  }
}

/* ── Open jobs (provider view) + accept ─────────────────────────────────── */

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
      const safe = sanitizeJobForPublic(job);
      const isProvider = state.currentUser?.role === 'provider';
      const c = card(`
        <h4>${escapeHtml(safe.title || 'Lawn Service')}</h4>
        <div class="meta">${escapeHtml(serviceLabel(safe.serviceType))} &middot; ${escapeHtml(safe.location)}</div>
        <div class="meta">Estimate: <strong>${money(safe.amount)}</strong> &nbsp;&middot;&nbsp; ${statusBadge(safe.status)}</div>
        <div class="meta" style="font-size:.85rem">Posted: ${safe.postedAt ? new Date(safe.postedAt).toLocaleDateString() : 'n/a'}</div>
        ${isProvider ? `<button class="btn primary small" data-accept-job="${escapeHtml(safe.id)}" style="margin-top:8px">Accept Job</button>` : ''}
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
  if (!hasActiveSession()) {
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

/* ── Provider event handlers ─────────────────────────────────────────────── */

$$('[data-provider-tab]').forEach((btn) => {
  btn.addEventListener('click', () => renderProviderArea(btn.dataset.providerTab));
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

byId('showOpenJobsBtn')?.addEventListener('click', () => {
  byId('myBookingsPanelTitle') && (byId('myBookingsPanelTitle').textContent = 'Open Jobs');
  loadOpenJobsForProvider();
});

byId('refreshMyJobs')?.addEventListener('click', () => {
  const title = byId('myBookingsPanelTitle')?.textContent || '';
  if (title.includes('Open')) loadOpenJobsForProvider();
  else loadMyJobs();
});

/* ── Window exports (referenced from app.js and auth-ui.js) ─────────────── */

window.loadProviders = loadProviders;
window.loadProviderServiceAreas = loadProviderServiceAreas;
window.renderProviderArea = renderProviderArea;
window.loadOpenJobsForProvider = loadOpenJobsForProvider;
window.populateProviderSetupChoices = populateProviderSetupChoices;
window.renderProviderJobs = renderProviderJobs;
window.loadProviderPaidJobs = loadProviderPaidJobs;
