// admin-ui.js - tabbed admin console.
// Depends on global helpers from the existing app: byId, api, escapeHtml, money,
// prettyApiError, showToast/showError/showSuccess/showResult, statusBadge.

const adminState = {
  tab: 'overview',
  jobs: [],
  quotes: [],
  users: [],
  providers: [],
  servicePricing: [],
  orphans: null,
  system: null,
};

function adminDebounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function adminText(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text) : `<span class="admin-muted">${escapeHtml(fallback)}</span>`;
}

function adminUiIcon(name, label) {
  return `<img src="/assets/icons/lucide/${name}.svg" alt="" class="ui-icon"><span class="ui-label">${escapeHtml(label)}</span>`;
}

function adminDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
}

function adminPayBadge(status) {
  const value = String(status || 'unpaid');
  return `<span class="admin-pill pay-${escapeHtml(value)}">${escapeHtml(value.replace(/_/g, ' '))}</span>`;
}

function adminPaymentMethodLabel(method) {
  const value = String(method || '').trim();
  if (!value) return '';
  const label = value === 'onsite_cash_check' ? 'Pay Onsite' : value.replace(/_/g, ' ');
  return `<div class="admin-meta">${escapeHtml(label)}</div>`;
}

function adminActiveBadge(active) {
  return active !== false
    ? '<span class="admin-pill is-active">Active</span>'
    : '<span class="admin-pill is-inactive">Inactive</span>';
}

function adminCurrentUserId() {
  try {
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : (state?.currentUser || state?.user || null);
    return user?.id || '';
  } catch {
    return '';
  }
}

function adminUserDisplayLabel(user = {}) {
  const first = user.firstName || user.first_name || '';
  const last = user.lastName || user.last_name || '';
  return [first, last].filter(Boolean).join(' ') || user.fullName || user.full_name || user.email || user.id || 'this user';
}

function adminAttachmentBadge(job) {
  return job.customerAttached || job.customerUserId
    ? '<span class="admin-pill is-active">Attached</span>'
    : '<span class="admin-pill is-warning">Unattached</span>';
}

function adminJobPhotoUrls(job = {}, category = 'before') {
  const key = category === 'after' ? 'afterPhotoUrls' : 'beforePhotoUrls';
  return Array.isArray(job[key]) ? job[key] : [];
}

function adminJobPhotoThumbs(job = {}, category = 'before') {
  const urls = adminJobPhotoUrls(job, category);
  if (!urls.length) return '<div class="admin-muted">No photos yet.</div>';
  return urls.map((url, index) => `
    <div class="job-photo-thumb">
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(`${category} photo ${index + 1}`)}" />
      </a>
      <button class="btn secondary small ui-icon-btn" type="button" data-admin-remove-job-photo="${escapeHtml(category)}" data-url="${escapeHtml(url)}">${adminUiIcon('trash', 'Remove')}</button>
    </div>
  `).join('');
}

function adminJobPhotoSection(job = {}, category = 'before', label = 'Before Photos') {
  return `
    <section class="job-photo-section">
      <div class="job-photo-section-head">
        <strong>${escapeHtml(label)}</strong>
        <label class="btn secondary small job-photo-upload">
          Upload
          <input type="file" multiple accept="image/*" data-admin-job-photo-upload="${escapeHtml(category)}" />
        </label>
      </div>
      <div class="job-photo-grid">${adminJobPhotoThumbs(job, category)}</div>
    </section>
  `;
}

function adminMergePhotoUrls(existing = [], incoming = []) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].filter(Boolean))];
}

function adminTable(headers, rows) {
  if (!rows.length) return '<div class="admin-empty">No records found.</div>';
  return `
    <table class="admin-table">
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `;
}

function adminFieldErrorHtml(field) {
  return `<div class="admin-field-error" data-field-error="${escapeHtml(field)}" hidden></div>`;
}

function clearAdminFormErrors(form) {
  if (!form) return;
  form.querySelectorAll('.admin-field-error').forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
  form.querySelectorAll('.admin-field-invalid').forEach((el) => el.classList.remove('admin-field-invalid'));
}

function showAdminFormError(form, error) {
  const field = error?.field || error?.data?.field || '';
  const message = prettyApiError(error);
  const input = field ? form?.elements?.[field] : null;
  const errorEl = field ? form?.querySelector(`[data-field-error="${field}"]`) : null;
  if (input) {
    input.classList.add('admin-field-invalid');
    input.focus();
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  } else {
    showError(message);
  }
}

function adminSelectedIds(wrapId, selector, buttonId, countId) {
  const wrap = byId(wrapId);
  const ids = wrap ? Array.from(wrap.querySelectorAll(`${selector}:checked`)).map((input) => input.dataset.id).filter(Boolean) : [];
  const countEl = byId(countId);
  const button = byId(buttonId);
  if (countEl) countEl.textContent = `${ids.length} selected`;
  if (button) button.disabled = ids.length === 0;
  return ids;
}

function updateAdminJobSelection() {
  return adminSelectedIds('adminMgmtJobsTable', '.admin-job-select', 'adminDeleteSelectedJobsBtn', 'adminJobsSelectedCount');
}

function updateAdminUserSelection() {
  return adminSelectedIds('adminMgmtUsersTable', '.admin-user-select', 'adminDeleteSelectedUsersBtn', 'adminUsersSelectedCount');
}

function adminProviderOptions(selectedId = '') {
  const opts = ['<option value="">Unassigned</option>'];
  adminState.providers
    .filter((provider) => provider.active !== false)
    .forEach((provider) => {
      const label = provider.business_name || provider.owner_name || provider.email || provider.id;
      opts.push(`<option value="${escapeHtml(provider.id)}" ${String(selectedId || '') === String(provider.id) ? 'selected' : ''}>${escapeHtml(label)}</option>`);
    });
  return opts.join('');
}

function adminUserOptions(selectedId = '') {
  return adminState.users.map((user) => {
    const name = [user.firstName || user.first_name, user.lastName || user.last_name].filter(Boolean).join(' ') || user.fullName || user.full_name || user.email;
    return `<option value="${escapeHtml(user.id)}" ${String(selectedId || '') === String(user.id) ? 'selected' : ''}>${escapeHtml(name)} - ${escapeHtml(user.email || '')}</option>`;
  }).join('');
}

function setAdminTab(tab) {
  adminState.tab = tab;
  document.querySelectorAll('.admin-tab').forEach((btn) => {
    const active = btn.dataset.adminTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-admin-tab-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.adminTabPanel === tab);
  });
  loadAdminTab(tab).catch((err) => showError(prettyApiError(err)));
}

async function loadAdminTab(tab = adminState.tab) {
  if (tab === 'overview') return loadAdmin();
  if (tab === 'jobs') return loadAdminMgmtJobs();
  if (tab === 'quotes') return loadAdminMgmtQuotes();
  if (tab === 'users') return loadAdminMgmtUsers();
  if (tab === 'providers') return loadAdminMgmtProviders();
  if (tab === 'pricing') return loadAdminPricing();
  if (tab === 'system') return loadAdminSystem();
}

async function loadAdmin() {
  const metrics = byId('adminMetrics');
  const alerts = byId('adminAlerts');
  if (!metrics) return;
  try {
    const [overview, orphans] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/orphans').catch(() => null),
    ]);
    adminState.orphans = orphans;
    const m = overview.metrics || {};
    metrics.innerHTML = `
      <div class="metric"><strong>${m.totalQuotes ?? 0}</strong><span>Total quotes</span></div>
      <div class="metric"><strong>${m.totalJobs ?? 0}</strong><span>Total jobs</span></div>
      <div class="metric"><strong>${m.openJobs ?? 0}</strong><span>Open jobs</span></div>
      <div class="metric"><strong>${m.completedJobs ?? 0}</strong><span>Completed</span></div>
      <div class="metric"><strong>${m.providers ?? 0}</strong><span>Providers</span></div>
      <div class="metric"><strong>${money(m.revenuePipeline || 0)}</strong><span>Quote pipeline</span></div>
    `;
    const a = orphans?.alerts || overview.alerts || {};
    if (alerts) {
      alerts.innerHTML = [
        ['Orphan jobs', a.orphanJobs || 0, 'Jobs with no customer user attached.'],
        ['Missing contact', a.jobsMissingContact || 0, 'Jobs missing customer email or phone.'],
        ['Paid unattached', a.paidJobsNotAttached || 0, 'Paid jobs not attached to users.'],
        ['Unpaid completed', a.unpaidCompletedJobs || 0, 'Completed jobs still marked unpaid.'],
      ].map(([label, count, detail]) => `
        <button class="admin-alert-card ui-icon-btn" type="button" data-open-system="true">
          <img src="/assets/icons/lucide/triangle-alert.svg" alt="" class="ui-icon">
          <strong>${count}</strong>
          <span>${escapeHtml(label)}</span>
          <small>${escapeHtml(detail)}</small>
        </button>
      `).join('');
      alerts.querySelectorAll('[data-open-system]').forEach((btn) => btn.addEventListener('click', () => setAdminTab('system')));
    }
  } catch (err) {
    metrics.innerHTML = '<div class="metric"><strong>Locked</strong><span>Admin sign-in required</span></div>';
    if (alerts) alerts.innerHTML = '';
  }
}

async function loadAdminMgmtJobs() {
  const wrap = byId('adminMgmtJobsTable');
  if (!wrap) return;
  wrap.innerHTML = '<div class="admin-empty">Loading jobs...</div>';
  const params = new URLSearchParams();
  const search = byId('adminJobsSearch')?.value || '';
  const status = byId('adminJobsStatusFilter')?.value || '';
  const payment = byId('adminJobsPaymentFilter')?.value || '';
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (payment) params.set('paymentStatus', payment);

  const [jobsData, providersData, usersData, orphansData] = await Promise.all([
    api('/api/admin/jobs' + (params.toString() ? `?${params}` : '')),
    api('/api/admin/providers').catch(() => ({ providers: [] })),
    api('/api/admin/users').catch(() => ({ users: [] })),
    api('/api/admin/orphans').catch(() => null),
  ]);
  adminState.jobs = jobsData.jobs || [];
  adminState.providers = providersData.providers || [];
  adminState.users = usersData.users || [];
  adminState.orphans = orphansData;

  const statusOptions = ['payment_pending','payment_failed','paid','open','assigned','scheduled','in_progress','completed','canceled','refunded'];
  const paymentOptions = ['unpaid','checkout_pending','onsite_pending','deposit_paid','paid','pending','failed','refunded'];
  const rows = adminState.jobs.map((job) => {
    const customer = `
      <strong>${adminText(job.customerName, 'No name')}</strong>
      <div class="admin-meta">${adminText(job.customerEmail, 'No email')}</div>
      <div class="admin-meta">${adminText(job.customerPhone, 'No phone')}</div>
      <div>${adminAttachmentBadge(job)}</div>
    `;
    const address = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');
    const statusSelect = `<select class="admin-job-status" data-job-id="${escapeHtml(job.id)}">${statusOptions.map((s) => `<option value="${s}" ${job.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>`;
    const paymentSelect = `<select class="admin-job-payment" data-job-id="${escapeHtml(job.id)}">${paymentOptions.map((p) => `<option value="${p}" ${job.paymentStatus === p ? 'selected' : ''}>${p.replace(/_/g, ' ')}</option>`).join('')}</select>`;
    const markPaid = job.paymentStatus === 'onsite_pending'
      ? `<button class="btn secondary small admin-job-mark-paid ui-icon-btn" data-job-id="${escapeHtml(job.id)}" type="button">${adminUiIcon('badge-dollar-sign', 'Mark Paid')}</button>`
      : '';
    const paymentCell = `${adminPayBadge(job.paymentStatus)}${adminPaymentMethodLabel(job.paymentMethod)}${paymentSelect}${markPaid ? `<div style="margin-top:6px">${markPaid}</div>` : ''}`;
    const providerSelect = `<select class="admin-job-provider" data-job-id="${escapeHtml(job.id)}">${adminProviderOptions(job.providerId)}</select>`;
    const attach = job.customerUserId ? '' : `<button class="btn secondary small admin-job-attach ui-icon-btn" data-job-id="${escapeHtml(job.id)}" type="button">${adminUiIcon('user', 'Attach')}</button>`;
    return [
      `<input class="admin-job-select" type="checkbox" data-id="${escapeHtml(job.id)}" aria-label="Select job ${escapeHtml(job.id)}" />`,
      `<code>${escapeHtml(job.id)}</code>`,
      customer,
      adminText(address),
      `${money(job.estimateAtBooking || job.budget || job.paymentAmount || 0)}`,
      paymentCell,
      statusSelect,
      providerSelect,
      adminDate(job.createdAt),
      `<button class="btn secondary small admin-job-view ui-icon-btn" data-job-id="${escapeHtml(job.id)}" type="button">${adminUiIcon('eye', 'View')}</button>
       <button class="btn secondary small admin-job-edit ui-icon-btn" data-job-id="${escapeHtml(job.id)}" type="button">${adminUiIcon('pencil', 'Edit Job')}</button>
       ${attach}`,
    ];
  });
  wrap.innerHTML = adminTable(['Select','ID','Customer','Address','Price','Payment','Status','Provider','Created','Actions'], rows);
  wireJobTable(wrap);
  updateAdminJobSelection();
}

function wireJobTable(wrap) {
  wrap.querySelectorAll('.admin-job-status').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await api(`/api/admin/jobs/${encodeURIComponent(sel.dataset.jobId)}`, { method: 'PATCH', body: JSON.stringify({ status: sel.value }) });
      showToast('Job status updated', 'success');
      loadAdminMgmtJobs().catch(() => {});
    });
  });
  wrap.querySelectorAll('.admin-job-payment').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await api(`/api/admin/jobs/${encodeURIComponent(sel.dataset.jobId)}`, { method: 'PATCH', body: JSON.stringify({ payment_status: sel.value }) });
      showToast('Payment status updated', 'success');
      loadAdminMgmtJobs().catch(() => {});
    });
  });
  wrap.querySelectorAll('.admin-job-mark-paid').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api(`/api/admin/jobs/${encodeURIComponent(btn.dataset.jobId)}/payment`, {
          method: 'PATCH',
          body: JSON.stringify({ payment_status: 'paid' })
        });
        showToast('Payment marked paid', 'success');
        loadAdminMgmtJobs().catch(() => {});
      } catch (error) {
        showError(prettyApiError(error));
        btn.disabled = false;
      }
    });
  });
  wrap.querySelectorAll('.admin-job-provider').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await api(`/api/admin/jobs/${encodeURIComponent(sel.dataset.jobId)}/assign-provider`, {
        method: 'PATCH',
        body: JSON.stringify({ provider_id: sel.value || null }),
      });
      showToast(sel.value ? 'Provider assigned' : 'Provider cleared', 'success');
      loadAdminMgmtJobs().catch(() => {});
    });
  });
  wrap.querySelectorAll('.admin-job-select').forEach((input) => input.addEventListener('change', updateAdminJobSelection));
  wrap.querySelectorAll('.admin-job-view').forEach((btn) => btn.addEventListener('click', () => showAdminJobDetails(btn.dataset.jobId)));
  wrap.querySelectorAll('.admin-job-edit').forEach((btn) => btn.addEventListener('click', () => showAdminJobEditor(btn.dataset.jobId)));
  wrap.querySelectorAll('.admin-job-attach').forEach((btn) => btn.addEventListener('click', () => showAdminJobAttach(btn.dataset.jobId)));
}

function suggestedUsersForJob(jobId) {
  const job = (adminState.orphans?.orphanJobs || []).find((item) => String(item.id) === String(jobId));
  return job?.suggestedUsers || [];
}

function showAdminJobDetails(jobId) {
  const panel = byId('adminJobDetailPanel');
  const job = adminState.jobs.find((item) => String(item.id) === String(jobId));
  if (!panel || !job) return;
  const address = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="admin-detail-head">
      <h3>Job ${escapeHtml(job.id)}</h3>
      <div class="admin-detail-actions">
        <button class="btn secondary small ui-icon-btn" type="button" data-edit-job>${adminUiIcon('pencil', 'Edit Job')}</button>
        <button class="btn secondary small ui-icon-btn" type="button" data-close-detail>${adminUiIcon('x', 'Close')}</button>
      </div>
    </div>
    <div class="admin-detail-grid">
      <div><span>Customer</span><strong>${adminText(job.customerName)}</strong><small>${adminText(job.customerEmail)}<br>${adminText(job.customerPhone)}</small></div>
      <div><span>Attachment</span><strong>${job.customerUserId ? escapeHtml(job.customerUserId) : 'Unattached'}</strong></div>
      <div><span>Address</span><strong>${adminText(address)}</strong></div>
      <div><span>Price</span><strong>${money(job.estimateAtBooking || job.budget || job.paymentAmount || 0)}</strong></div>
      <div><span>Status</span><strong>${adminText(job.status)}</strong></div>
      <div><span>Payment</span><strong>${adminText(job.paymentStatus)}</strong><small>${adminText(job.paymentMethod)}</small></div>
    </div>
    <div class="job-photo-manager">
      ${adminJobPhotoSection(job, 'before', 'Before Photos')}
      ${adminJobPhotoSection(job, 'after', 'After Photos')}
    </div>
    ${typeof renderJobScopeSnapshot === 'function' ? renderJobScopeSnapshot(job, job) : ''}
    ${job.details ? `<pre class="admin-detail-pre">${escapeHtml(job.details)}</pre>` : ''}
  `;
  panel.querySelector('[data-close-detail]')?.addEventListener('click', () => panel.classList.add('hidden'));
  panel.querySelector('[data-edit-job]')?.addEventListener('click', () => showAdminJobEditor(job.id));
  if (typeof initJobScopeSnapshotMaps === 'function') initJobScopeSnapshotMaps(panel);
  wireAdminJobPhotoControls(panel, job);
}

async function showAdminJobEditor(jobId) {
  const panel = byId('adminJobDetailPanel');
  if (!panel) return;
  let job = adminState.jobs.find((item) => String(item.id) === String(jobId));
  try {
    const data = await api(`/api/admin/jobs/${encodeURIComponent(jobId)}`);
    job = data.job || job;
  } catch {}
  if (!job) return showError('Job not found in the current list. Refresh and try again.');

  const statusOptions = ['payment_pending','payment_failed','cod_verification_pending','paid','open','assigned','scheduled','in_progress','completed','canceled','refunded'];
  const paymentOptions = ['unpaid','checkout_pending','checkout_created','onsite_pending','deposit_paid','paid','pending','failed','refunded'];
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="admin-detail-head">
      <h3>Edit Job ${escapeHtml(job.id)}</h3>
      <button class="btn secondary small ui-icon-btn" type="button" data-close-detail>${adminUiIcon('x', 'Close')}</button>
    </div>
    <form id="adminJobEditForm" class="admin-edit-form admin-job-edit-form">
      <label><span>Customer name</span><input name="customerName" value="${escapeHtml(job.customerName || '')}" /></label>
      <label><span>Email</span><input name="email" type="email" value="${escapeHtml(job.customerEmail || '')}" />${adminFieldErrorHtml('email')}</label>
      <label><span>Phone</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(job.customerPhone || '')}" />${adminFieldErrorHtml('phone')}</label>
      <label><span>Service address</span><input name="address" value="${escapeHtml(job.address || '')}" /></label>
      <label><span>City</span><input name="city" value="${escapeHtml(job.city || '')}" /></label>
      <label><span>State</span><input name="state" maxlength="2" value="${escapeHtml(job.state || '')}" /></label>
      <label><span>Zip</span><input name="zip" value="${escapeHtml(job.zip || '')}" /></label>
      <label><span>Status</span><select name="status">${statusOptions.map((s) => `<option value="${s}" ${job.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select></label>
      <label><span>Payment</span><select name="payment_status">${paymentOptions.map((p) => `<option value="${p}" ${job.paymentStatus === p ? 'selected' : ''}>${p.replace(/_/g, ' ')}</option>`).join('')}</select></label>
      <label class="admin-form-wide"><span>Notes</span><textarea name="details" rows="6">${escapeHtml(job.details || '')}</textarea></label>
      <div class="admin-form-actions">
        <button class="btn primary small ui-icon-btn" type="submit">${adminUiIcon('save', 'Save Job')}</button>
        <button class="btn secondary small ui-icon-btn" type="button" data-cancel-job-edit>${adminUiIcon('x', 'Cancel')}</button>
      </div>
    </form>
  `;
  panel.querySelector('[data-close-detail]')?.addEventListener('click', () => panel.classList.add('hidden'));
  panel.querySelector('[data-cancel-job-edit]')?.addEventListener('click', () => showAdminJobDetails(job.id));
  byId('adminJobEditForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearAdminFormErrors(form);
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const result = await api(`/api/admin/jobs/${encodeURIComponent(job.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          customerName: form.elements.customerName.value,
          customerEmail: form.elements.email.value,
          customerPhone: form.elements.phone.value,
          address: form.elements.address.value,
          city: form.elements.city.value,
          state: form.elements.state.value,
          zip: form.elements.zip.value,
          status: form.elements.status.value,
          payment_status: form.elements.payment_status.value,
          details: form.elements.details.value,
        }),
      });
      const index = adminState.jobs.findIndex((item) => String(item.id) === String(job.id));
      if (index !== -1 && result.job) adminState.jobs[index] = result.job;
      showToast('Job saved', 'success');
      await loadAdminMgmtJobs();
      showAdminJobDetails(job.id);
    } catch (error) {
      showAdminFormError(form, error);
      if (submit) submit.disabled = false;
    }
  });
}

async function uploadAdminJobPhotoFiles(job, category, files) {
  if (!files.length) return;
  const fd = new FormData();
  fd.append('jobId', job.id);
  fd.append('category', category);
  files.forEach((file) => fd.append('photos', file));
  const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
  const uploadText = await uploadRes.text();
  let uploadData = null;
  try {
    uploadData = JSON.parse(uploadText);
  } catch {
    throw new Error(`Upload did not return JSON: ${uploadText.slice(0, 120)}`);
  }
  if (!uploadRes.ok || !uploadData.ok) throw new Error(uploadData?.error || 'Upload failed');
  const uploadedUrls = (uploadData.files || []).map((file) => file.url).filter(Boolean);
  const beforePhotoUrls = category === 'before'
    ? adminMergePhotoUrls(adminJobPhotoUrls(job, 'before'), uploadedUrls)
    : adminJobPhotoUrls(job, 'before');
  const afterPhotoUrls = category === 'after'
    ? adminMergePhotoUrls(adminJobPhotoUrls(job, 'after'), uploadedUrls)
    : adminJobPhotoUrls(job, 'after');
  const result = await api(`/api/admin/jobs/${encodeURIComponent(job.id)}/photos`, {
    method: 'PATCH',
    body: JSON.stringify({ beforePhotoUrls, afterPhotoUrls }),
  });
  Object.assign(job, result.job || {}, {
    beforePhotoUrls: result.beforePhotoUrls || beforePhotoUrls,
    afterPhotoUrls: result.afterPhotoUrls || afterPhotoUrls,
  });
}

async function saveAdminJobPhotoRemoval(job, category, url) {
  const beforePhotoUrls = category === 'before'
    ? adminJobPhotoUrls(job, 'before').filter((item) => item !== url)
    : adminJobPhotoUrls(job, 'before');
  const afterPhotoUrls = category === 'after'
    ? adminJobPhotoUrls(job, 'after').filter((item) => item !== url)
    : adminJobPhotoUrls(job, 'after');
  const result = await api(`/api/admin/jobs/${encodeURIComponent(job.id)}/photos`, {
    method: 'PATCH',
    body: JSON.stringify({ beforePhotoUrls, afterPhotoUrls }),
  });
  Object.assign(job, result.job || {}, {
    beforePhotoUrls: result.beforePhotoUrls || beforePhotoUrls,
    afterPhotoUrls: result.afterPhotoUrls || afterPhotoUrls,
  });
}

function wireAdminJobPhotoControls(panel, job) {
  panel.querySelectorAll('[data-admin-job-photo-upload]').forEach((input) => {
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      input.disabled = true;
      try {
        await uploadAdminJobPhotoFiles(job, input.dataset.adminJobPhotoUpload, files);
        showToast('Job photos uploaded', 'success');
        showAdminJobDetails(job.id);
      } catch (error) {
        showError(prettyApiError(error));
        input.disabled = false;
      }
    });
  });
  panel.querySelectorAll('[data-admin-remove-job-photo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await saveAdminJobPhotoRemoval(job, btn.dataset.adminRemoveJobPhoto, btn.dataset.url);
        showToast('Job photo removed', 'success');
        showAdminJobDetails(job.id);
      } catch (error) {
        showError(prettyApiError(error));
        btn.disabled = false;
      }
    });
  });
}

function showAdminJobAttach(jobId) {
  const panel = byId('adminJobDetailPanel');
  const job = adminState.jobs.find((item) => String(item.id) === String(jobId));
  if (!panel || !job) return;
  const suggestions = suggestedUsersForJob(jobId);
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="admin-detail-head">
      <h3>Attach Job ${escapeHtml(job.id)}</h3>
      <button class="btn secondary small ui-icon-btn" type="button" data-close-detail>${adminUiIcon('x', 'Close')}</button>
    </div>
    <p class="section-copy">Suggested matches are based on email or phone. Choose a user and confirm before attaching.</p>
    ${suggestions.length ? `<div class="admin-suggestions">${suggestions.map((u) => `<button class="btn secondary small admin-suggest-user ui-icon-btn" data-user-id="${escapeHtml(u.id)}" type="button">${adminUiIcon('user', `${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email} (${u.email || u.phone || ''})`)}</button>`).join('')}</div>` : '<div class="admin-empty">No email or phone match found.</div>'}
    <label><span>User</span><select id="adminAttachUserSelect"><option value="">Select user</option>${adminUserOptions()}</select></label>
    <button class="btn primary small ui-icon-btn" id="adminAttachUserConfirm" type="button">${adminUiIcon('user', 'Attach Selected User')}</button>
  `;
  panel.querySelector('[data-close-detail]')?.addEventListener('click', () => panel.classList.add('hidden'));
  panel.querySelectorAll('.admin-suggest-user').forEach((btn) => {
    btn.addEventListener('click', () => { byId('adminAttachUserSelect').value = btn.dataset.userId; });
  });
  byId('adminAttachUserConfirm')?.addEventListener('click', async () => {
    const userId = byId('adminAttachUserSelect')?.value;
    if (!userId) return showError('Choose a user first.');
    if (!confirm('Attach this job to the selected user?')) return;
    await api(`/api/admin/jobs/${encodeURIComponent(jobId)}/attach-user`, { method: 'PATCH', body: JSON.stringify({ user_id: userId }) });
    showToast('Job attached to user', 'success');
    panel.classList.add('hidden');
    await loadAdminMgmtJobs();
  });
}

async function deleteSelectedAdminJobs() {
  const ids = updateAdminJobSelection();
  if (!ids.length) return showError('Select at least one job first.');
  if (!confirm(`Delete ${ids.length} selected job(s)? This cannot be undone.`)) return;
  const button = byId('adminDeleteSelectedJobsBtn');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/admin/jobs/delete-selected', {
      method: 'POST',
      body: JSON.stringify({ ids, confirm: 'DELETE_SELECTED_JOBS' }),
    });
    showToast(`Deleted ${result.deletedCount || 0} selected job(s)`, 'success');
    byId('adminJobDetailPanel')?.classList.add('hidden');
    await loadAdminMgmtJobs();
  } finally {
    updateAdminJobSelection();
  }
}

function adminQuoteAddress(quote = {}) {
  return [quote.address, quote.city, quote.state, quote.zip].filter(Boolean).join(', ');
}

function adminQuoteServiceLabel(quote = {}) {
  return String(quote.serviceType || quote.serviceId || 'mowing')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function filteredAdminQuotes() {
  const search = String(byId('adminQuotesSearch')?.value || '').toLowerCase().trim();
  const status = byId('adminQuotesStatusFilter')?.value || '';
  return adminState.quotes.filter((quote) => {
    if (status && String(quote.status || '') !== status) return false;
    if (!search) return true;
    const customer = quote.customer || {};
    return [
      quote.id,
      quote.name,
      quote.email,
      quote.phone,
      customer.name,
      customer.email,
      customer.phone,
      adminQuoteAddress(quote),
      quote.serviceType,
      quote.status,
      quote.convertedToJobId,
      quote.paymentId,
    ].some((value) => String(value || '').toLowerCase().includes(search));
  });
}

async function loadAdminMgmtQuotes() {
  const wrap = byId('adminMgmtQuotesTable');
  if (!wrap) return;
  wrap.innerHTML = '<div class="admin-empty">Loading quotes...</div>';
  try {
    const data = await api('/api/admin/quotes');
    adminState.quotes = data.quotes || [];
    renderAdminQuotes();
  } catch (error) {
    adminState.quotes = [];
    wrap.innerHTML = `<div class="admin-empty">Could not load quotes: ${escapeHtml(prettyApiError(error))}</div>`;
    showError(prettyApiError(error));
  }
}

function renderAdminQuotes() {
  const wrap = byId('adminMgmtQuotesTable');
  if (!wrap) return;
  const quotes = filteredAdminQuotes();
  if (!adminState.quotes.length) {
    wrap.innerHTML = '<div class="admin-empty">No quotes yet.</div>';
    byId('adminQuoteDetailPanel')?.classList.add('hidden');
    return;
  }
  if (!quotes.length) {
    wrap.innerHTML = '<div class="admin-empty">No quotes match the current filters.</div>';
    byId('adminQuoteDetailPanel')?.classList.add('hidden');
    return;
  }

  const rows = quotes.map((quote) => {
    const customer = quote.customer || {};
    const customerName = customer.name || quote.name || '';
    const contact = `
      <div>${adminText(quote.phone || customer.phone, 'No phone')}</div>
      <div class="admin-meta">${adminText(quote.email || customer.email, 'No email')}</div>
    `;
    const linkage = [
      quote.convertedToJobId ? `Job ${quote.convertedToJobId}` : '',
      quote.paymentId ? `Payment ${quote.paymentId}` : '',
    ].filter(Boolean).join('<br>');
    return [
      adminDate(quote.createdAt),
      `<strong>${adminText(customerName, 'No name')}</strong><div class="admin-meta"><code>${escapeHtml(quote.id || '')}</code></div>`,
      adminText(adminQuoteAddress(quote), 'No address'),
      adminText(adminQuoteServiceLabel(quote)),
      money(quote.estimate || 0),
      adminText(quote.status || 'new'),
      contact,
      `<button class="btn secondary small admin-quote-view ui-icon-btn" data-quote-id="${escapeHtml(quote.id)}" type="button">${adminUiIcon('eye', 'View Details')}</button>${linkage ? `<div class="admin-meta">${linkage}</div>` : ''}`,
    ];
  });
  wrap.innerHTML = adminTable(['Date','Customer','Address','Service','Estimate','Status','Phone/email','Actions'], rows);
  wrap.querySelectorAll('.admin-quote-view').forEach((btn) => {
    btn.addEventListener('click', () => showAdminQuoteDetails(btn.dataset.quoteId));
  });
}

function showAdminQuoteDetails(quoteId) {
  const panel = byId('adminQuoteDetailPanel');
  const quote = adminState.quotes.find((item) => String(item.id) === String(quoteId));
  if (!panel || !quote) return;
  const customer = quote.customer || {};
  const scope = quote.scope || {};
  const scopeDetails = [
    quote.lotSqft ? `Lot sqft: ${quote.lotSqft}` : '',
    quote.mowableSqft ? `Mowable sqft: ${quote.mowableSqft}` : '',
    quote.lotSource ? `Lot source: ${quote.lotSource}` : '',
    quote.propertyType ? `Property type: ${quote.propertyType}` : '',
    quote.parcelId ? `Parcel ID: ${quote.parcelId}` : '',
    ...Object.entries(scope).filter(([, value]) => value).map(([key]) => key.replace(/[A-Z]/g, (char) => ` ${char.toLowerCase()}`)),
  ].filter(Boolean);
  const detailPayload = {
    id: quote.id,
    customer: quote.customer,
    address: {
      address: quote.address,
      city: quote.city,
      state: quote.state,
      zip: quote.zip,
    },
    serviceType: quote.serviceType,
    estimate: quote.estimate,
    status: quote.status,
    createdAt: quote.createdAt,
    scope: {
      lotSqft: quote.lotSqft,
      mowableSqft: quote.mowableSqft,
      lotSource: quote.lotSource,
      propertyType: quote.propertyType,
      parcelId: quote.parcelId,
      notes: quote.notes,
      flags: quote.scope,
    },
    payment: quote.payment,
    convertedToJobId: quote.convertedToJobId,
    convertedAt: quote.convertedAt,
  };

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="admin-detail-head">
      <h3>Quote ${escapeHtml(quote.id)}</h3>
      <button class="btn secondary small ui-icon-btn" type="button" data-close-detail>${adminUiIcon('x', 'Close')}</button>
    </div>
    <div class="admin-detail-grid">
      <div><span>Customer</span><strong>${adminText(customer.name || quote.name)}</strong><small>${adminText(quote.email || customer.email)}<br>${adminText(quote.phone || customer.phone)}</small></div>
      <div><span>Address</span><strong>${adminText(adminQuoteAddress(quote))}</strong></div>
      <div><span>Service</span><strong>${adminText(adminQuoteServiceLabel(quote))}</strong></div>
      <div><span>Estimate</span><strong>${money(quote.estimate || 0)}</strong></div>
      <div><span>Status</span><strong>${adminText(quote.status || 'new')}</strong></div>
      <div><span>Created</span><strong>${adminDate(quote.createdAt)}</strong></div>
      <div><span>Payment</span><strong>${adminText(quote.paymentStatus || 'No payment')}</strong><small>${quote.paymentAmount ? money(quote.paymentAmount) : ''}</small></div>
      <div><span>Job Link</span><strong>${adminText(quote.convertedToJobId, 'Not converted')}</strong></div>
    </div>
    <div class="admin-detail-grid">
      <div><span>Scope</span><strong>${scopeDetails.length ? escapeHtml(scopeDetails.join(', ')) : 'No scope details'}</strong></div>
      <div><span>Notes</span><strong>${adminText(quote.notes, 'No notes')}</strong></div>
    </div>
    <pre class="admin-detail-pre">${escapeHtml(JSON.stringify(detailPayload, null, 2))}</pre>
  `;
  panel.querySelector('[data-close-detail]')?.addEventListener('click', () => panel.classList.add('hidden'));
}

async function loadAdminMgmtUsers() {
  const wrap = byId('adminMgmtUsersTable');
  if (!wrap) return;
  wrap.innerHTML = '<div class="admin-empty">Loading users...</div>';
  const params = new URLSearchParams();
  const search = byId('adminUsersSearch')?.value || '';
  const role = byId('adminUsersRoleFilter')?.value || '';
  const active = byId('adminUsersActiveFilter')?.value || '';
  if (search) params.set('search', search);
  if (role) params.set('role', role);
  if (active) params.set('active', active);
  const data = await api('/api/admin/users' + (params.toString() ? `?${params}` : ''));
  adminState.users = data.users || [];
  const currentUserId = adminCurrentUserId();
  const rows = adminState.users.map((u) => {
    const first = u.firstName || u.first_name || '';
    const last = u.lastName || u.last_name || '';
    const isSelf = currentUserId && String(currentUserId) === String(u.id);
    const selectBox = isSelf
      ? `<input class="admin-user-select" type="checkbox" data-id="${escapeHtml(u.id)}" aria-label="Select user ${escapeHtml(u.id)}" disabled title="You cannot delete your own account" />`
      : `<input class="admin-user-select" type="checkbox" data-id="${escapeHtml(u.id)}" aria-label="Select user ${escapeHtml(u.id)}" />`;
    const deleteButton = isSelf
      ? `<button class="btn secondary small ui-icon-btn" type="button" disabled title="You cannot delete your own account">${adminUiIcon('trash', 'Delete')}</button>`
      : `<button class="btn secondary small admin-user-delete ui-icon-btn" data-user-id="${escapeHtml(u.id)}" type="button">${adminUiIcon('trash', 'Delete')}</button>`;
    return [
      selectBox,
      adminText(first),
      adminText(last),
      adminText(u.email),
      adminText(u.phone),
      adminText(u.role || 'customer'),
      adminActiveBadge(u.active),
      String(u.job_count || 0),
      `<button class="btn secondary small admin-user-view ui-icon-btn" data-user-id="${escapeHtml(u.id)}" type="button">${adminUiIcon('eye', 'View')}</button>
       <button class="btn secondary small admin-user-edit ui-icon-btn" data-user-id="${escapeHtml(u.id)}" type="button">${adminUiIcon('pencil', 'Edit')}</button>
       <button class="btn secondary small admin-user-jobs ui-icon-btn" data-user-id="${escapeHtml(u.id)}" type="button">${adminUiIcon('clipboard-check', 'Jobs')}</button>
       <button class="btn secondary small admin-user-toggle ui-icon-btn" data-user-id="${escapeHtml(u.id)}" data-active="${u.active !== false ? '1' : '0'}" type="button">${adminUiIcon(u.active !== false ? 'x' : 'circle-check', u.active !== false ? 'Deactivate' : 'Activate')}</button>
       ${deleteButton}`,
    ];
  });
  wrap.innerHTML = adminTable(['Select','First','Last','Email','Phone','Role','Status','Jobs','Actions'], rows);
  updateAdminUserSelection();
  wrap.querySelectorAll('.admin-user-select').forEach((input) => input.addEventListener('change', updateAdminUserSelection));
  wrap.querySelectorAll('.admin-user-view').forEach((btn) => btn.addEventListener('click', () => showAdminUserEditor(btn.dataset.userId)));
  wrap.querySelectorAll('.admin-user-edit').forEach((btn) => btn.addEventListener('click', () => showAdminUserEditor(btn.dataset.userId)));
  wrap.querySelectorAll('.admin-user-jobs').forEach((btn) => btn.addEventListener('click', () => showAdminUserJobs(btn.dataset.userId)));
  wrap.querySelectorAll('.admin-user-delete').forEach((btn) => btn.addEventListener('click', () => showAdminUserDeleteConfirm(btn.dataset.userId)));
  wrap.querySelectorAll('.admin-user-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/users/${encodeURIComponent(btn.dataset.userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: btn.dataset.active !== '1' }),
      });
      showToast('User status updated', 'success');
      await loadAdminMgmtUsers();
    });
  });
}

function ensureAdminUserDeleteModal() {
  let modal = byId('adminUserDeleteModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'adminUserDeleteModal';
  modal.className = 'modal-overlay hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'adminUserDeleteTitle');
  document.body.appendChild(modal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeAdminUserDeleteModal();
  });
  return modal;
}

function closeAdminUserDeleteModal() {
  const modal = byId('adminUserDeleteModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.innerHTML = '';
}

function showAdminUserDeleteConfirm(userId) {
  const user = adminState.users.find((item) => String(item.id) === String(userId));
  if (!user) return showError('User not found in the current list. Refresh and try again.');
  if (adminCurrentUserId() && String(adminCurrentUserId()) === String(userId)) {
    return showError('You cannot delete your own admin account.');
  }

  const modal = ensureAdminUserDeleteModal();
  const label = adminUserDisplayLabel(user);
  const email = user.email || 'No email';
  modal.innerHTML = `
    <div class="modal-box">
      <h3 id="adminUserDeleteTitle">Delete User</h3>
      <p>Delete ${escapeHtml(label)} (${escapeHtml(email)})?</p>
      <p class="meta">This deactivates the account and keeps job history intact.</p>
      <div class="admin-form-actions">
        <button class="btn secondary small ui-icon-btn" type="button" data-cancel-delete-user>${adminUiIcon('x', 'Cancel')}</button>
        <button class="btn primary small ui-icon-btn" type="button" data-confirm-delete-user>${adminUiIcon('trash', 'Yes, delete this user')}</button>
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.querySelector('[data-cancel-delete-user]')?.addEventListener('click', closeAdminUserDeleteModal);
  modal.querySelector('[data-confirm-delete-user]')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      closeAdminUserDeleteModal();
      const message = result.mode === 'deactivated' ? 'User deleted and deactivated' : 'User deleted';
      showToast(message, 'success');
      adminState.users = adminState.users.filter((item) => String(item.id) !== String(userId));
      byId('adminUserDetailPanel')?.classList.add('hidden');
      await loadAdminMgmtUsers();
    } catch (error) {
      btn.disabled = false;
      btn.textContent = 'Yes, delete this user';
      showError(prettyApiError(error));
    }
  });
}

async function deleteSelectedAdminUsers() {
  const ids = updateAdminUserSelection();
  if (!ids.length) return showError('Select at least one user first.');
  if (!confirm(`Delete ${ids.length} selected user(s)? Users with paid/completed jobs will be blocked.`)) return;
  const button = byId('adminDeleteSelectedUsersBtn');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/admin/users/delete-selected', {
      method: 'POST',
      body: JSON.stringify({ ids, confirm: 'DELETE_SELECTED_USERS' }),
    });
    const blockedCount = result.blockedCount || 0;
    const message = blockedCount
      ? `Deleted ${result.deletedCount || 0}; blocked ${blockedCount} user(s)`
      : `Deleted ${result.deletedCount || 0} selected user(s)`;
    showToast(message, blockedCount ? 'info' : 'success');
    byId('adminUserDetailPanel')?.classList.add('hidden');
    await loadAdminMgmtUsers();
  } finally {
    updateAdminUserSelection();
  }
}

async function showAdminUserEditor(userId) {
  const panel = byId('adminUserDetailPanel');
  if (!panel) return;
  const data = await api(`/api/admin/users/${encodeURIComponent(userId)}`);
  const u = data.user;
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="admin-detail-head">
      <h3>Edit User</h3>
      <button class="btn secondary small ui-icon-btn" type="button" data-close-detail>${adminUiIcon('x', 'Close')}</button>
    </div>
    <form id="adminUserEditForm" class="admin-edit-form">
      <label><span>First name</span><input name="firstName" value="${escapeHtml(u.firstName || u.first_name || '')}" /></label>
      <label><span>Last name</span><input name="lastName" value="${escapeHtml(u.lastName || u.last_name || '')}" /></label>
      <label><span>Email</span><input name="email" type="email" value="${escapeHtml(u.email || '')}" />${adminFieldErrorHtml('email')}</label>
      <label><span>Phone</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(u.phone || '')}" />${adminFieldErrorHtml('phone')}</label>
      <label><span>Role</span><select name="role"><option value="customer" ${u.role === 'customer' ? 'selected' : ''}>Customer</option><option value="provider" ${u.role === 'provider' ? 'selected' : ''}>Provider</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
      <label><span>Status</span><select name="active"><option value="true" ${u.active !== false ? 'selected' : ''}>Active</option><option value="false" ${u.active === false ? 'selected' : ''}>Inactive</option></select></label>
      <div class="admin-form-actions">
        <button class="btn primary small ui-icon-btn" type="submit">${adminUiIcon('save', 'Save User')}</button>
        <button class="btn secondary small ui-icon-btn" id="adminAttachMatchingJobsBtn" type="button">${adminUiIcon('clipboard-check', 'Attach Matching Orphan Jobs')}</button>
      </div>
    </form>
    <div id="adminUserJobsList"></div>
  `;
  panel.querySelector('[data-close-detail]')?.addEventListener('click', () => panel.classList.add('hidden'));
  byId('adminUserEditForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    clearAdminFormErrors(form);
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: form.elements.firstName.value,
          lastName: form.elements.lastName.value,
          email: form.elements.email.value,
          phone: form.elements.phone.value,
          role: form.elements.role.value,
          active: form.elements.active.value === 'true',
        }),
      });
      showToast('User saved', 'success');
      await loadAdminMgmtUsers();
    } catch (error) {
      showAdminFormError(form, error);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  byId('adminAttachMatchingJobsBtn')?.addEventListener('click', async () => {
    if (!confirm('Attach orphan jobs that match this user email or phone?')) return;
    const result = await api(`/api/admin/users/${encodeURIComponent(userId)}/attach-matching-jobs`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
    showToast(`Attached ${result.attached || 0} jobs`, 'success');
    await showAdminUserJobs(userId);
  });
}

async function showAdminUserJobs(userId) {
  const panel = byId('adminUserDetailPanel');
  if (!panel) return;
  const data = await api(`/api/admin/users/${encodeURIComponent(userId)}/jobs`);
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="admin-detail-head">
      <h3>User Jobs</h3>
      <button class="btn secondary small ui-icon-btn" type="button" data-close-detail>${adminUiIcon('x', 'Close')}</button>
    </div>
    ${adminTable(['ID','Address','Price','Payment','Status','Created'], (data.jobs || []).map((job) => [
      `<code>${escapeHtml(job.id)}</code>`,
      adminText([job.address, job.city, job.state].filter(Boolean).join(', ')),
      money(job.estimateAtBooking || job.budget || job.paymentAmount || 0),
      adminPayBadge(job.paymentStatus),
      adminText(job.status),
      adminDate(job.createdAt),
    ]))}
  `;
  panel.querySelector('[data-close-detail]')?.addEventListener('click', () => panel.classList.add('hidden'));
}

async function loadAdminMgmtProviders() {
  const wrap = byId('adminMgmtProvidersTable');
  if (!wrap) return;
  wrap.innerHTML = '<div class="admin-empty">Loading providers...</div>';
  const params = new URLSearchParams();
  const search = byId('adminProvidersSearch')?.value || '';
  const active = byId('adminProvidersActiveFilter')?.value || '';
  if (search) params.set('search', search);
  if (active) params.set('active', active);
  const data = await api('/api/admin/providers' + (params.toString() ? `?${params}` : ''));
  adminState.providers = data.providers || [];
  const rows = adminState.providers.map((p) => [
    adminText(p.business_name || p.owner_name),
    adminText(p.email),
    adminText(p.phone),
    adminActiveBadge(p.active),
    String(p.open_job_count || 0),
    String(p.completed_job_count || 0),
    `<button class="btn secondary small admin-provider-jobs ui-icon-btn" data-provider-id="${escapeHtml(p.id)}" type="button">${adminUiIcon('clipboard-check', 'Jobs')}</button>
     <button class="btn secondary small admin-provider-toggle ui-icon-btn" data-provider-id="${escapeHtml(p.id)}" data-active="${p.active !== false ? '1' : '0'}" type="button">${adminUiIcon(p.active !== false ? 'x' : 'circle-check', p.active !== false ? 'Deactivate' : 'Activate')}</button>`,
  ]);
  wrap.innerHTML = adminTable(['Provider','Email','Phone','Status','Open','Completed','Actions'], rows);
  wrap.querySelectorAll('.admin-provider-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/providers/${encodeURIComponent(btn.dataset.providerId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: btn.dataset.active !== '1' }),
      });
      showToast('Provider status updated', 'success');
      await loadAdminMgmtProviders();
    });
  });
  wrap.querySelectorAll('.admin-provider-jobs').forEach((btn) => btn.addEventListener('click', () => showAdminProviderJobs(btn.dataset.providerId)));
}

async function showAdminProviderJobs(providerId) {
  const panel = byId('adminProviderJobsPanel');
  if (!panel) return;
  const data = await api(`/api/admin/providers/${encodeURIComponent(providerId)}/jobs`);
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="admin-detail-head">
      <h3>Provider Jobs</h3>
      <button class="btn secondary small ui-icon-btn" type="button" data-close-detail>${adminUiIcon('x', 'Close')}</button>
    </div>
    ${adminTable(['ID','Customer','Address','Price','Payment','Status','Created'], (data.jobs || []).map((job) => [
      `<code>${escapeHtml(job.id)}</code>`,
      `${adminText(job.customerName)}<div class="admin-meta">${adminText(job.customerPhone)}</div>`,
      adminText([job.address, job.city, job.state].filter(Boolean).join(', ')),
      money(job.estimateAtBooking || job.budget || job.paymentAmount || 0),
      adminPayBadge(job.paymentStatus),
      adminText(job.status),
      adminDate(job.createdAt),
    ]))}
  `;
  panel.querySelector('[data-close-detail]')?.addEventListener('click', () => panel.classList.add('hidden'));
}

async function loadAdminPricing() {
  const summary = byId('adminPricingSummary');
  if (!summary) return;
  const [data, servicePricing] = await Promise.all([
    api('/api/config'),
    api('/api/admin/settings/services'),
  ]);
  const settings = data.settings || {};
  const rules = settings.complexityRules || {};
  const regions = settings.regions || [];
  const services = servicePricing.services || settings.services || [];
  adminState.servicePricing = services.map(normalizeService);
  summary.innerHTML = `
    <div class="mini-card">
      <strong>Minimum charge</strong>
      <span>${money(settings.minimumCutPrice || 0)}</span>
      <small>Service minimums may override this per service.</small>
    </div>
    <div class="mini-card">
      <strong>Rounding</strong>
      <span>Nearest $5</span>
      <small>Implemented in <code>server/index.js</code> via <code>roundToNearestFive</code>.</small>
    </div>
    <div class="mini-card">
      <strong>Market adjustment</strong>
      <span>${regions.length ? `${regions.length} regions` : 'No regions'}</span>
      <small>${escapeHtml(regions.map((r) => `${r.name || r.id}: ${r.marketMultiplier || 1}x`).join(', ') || 'Pricing controls coming soon.')}</small>
    </div>
    <div class="mini-card">
      <strong>Access upcharges</strong>
      <span>Fenced ${money(rules.fencedUpcharge || 0)}</span>
      <small>Limited access ${money(rules.limitedAccessUpcharge || 0)}; gate handling ${money(rules.gateHandlingUpcharge || 0)}.</small>
    </div>
    <div class="mini-card">
      <strong>Services</strong>
      <span>${services.length}</span>
      <small>${escapeHtml(services.map((s) => `${s.name || s.id}: min ${money(s.minimumPrice || 0)}`).join(', ') || 'Service pricing controls coming soon.')}</small>
    </div>
  `;
  hydrateRegionEditor();
  renderServicePricingTable();
}

async function loadAdminSystem() {
  const info = byId('adminSystemInfo');
  if (!info) return;
  info.innerHTML = '<div class="admin-empty">Loading system info...</div>';
  const [system, orphans] = await Promise.all([
    api('/api/admin/system'),
    api('/api/admin/orphans').catch(() => null),
  ]);
  adminState.system = system;
  adminState.orphans = orphans;
  const db = system.db || {};
  info.innerHTML = `
    <div class="mini-card"><strong>DB jobs</strong><span>${db.jobs ?? 0}</span></div>
    <div class="mini-card"><strong>DB users</strong><span>${db.users ?? 0}</span></div>
    <div class="mini-card"><strong>Providers</strong><span>${db.providers ?? 0}</span></div>
    <div class="mini-card"><strong>Payments file</strong><span>${system.files?.payments ?? 0}</span></div>
    <div class="mini-card"><strong>Legacy leads</strong><span>${system.files?.leads ?? 0}</span></div>
    <div class="mini-card"><strong>Stripe mismatches</strong><span>${system.stripeSessionMismatches?.length ?? 0}</span></div>
    <div class="mini-card admin-system-wide">
      <strong>Orphan Review</strong>
      <span>${orphans?.orphanJobs?.length || 0} unattached jobs</span>
      <div class="admin-orphan-list">${(orphans?.orphanJobs || []).slice(0, 12).map((job) => `
        <div><code>${escapeHtml(job.id)}</code> ${adminText(job.customerEmail || job.customerPhone, 'No contact')} ${job.suggestedUsers?.length ? `<small>${job.suggestedUsers.length} suggested match</small>` : ''}</div>
      `).join('') || '<div class="admin-muted">No orphan jobs found.</div>'}</div>
    </div>
  `;
}

function friendlyAdminSaveError(error) {
  const message = prettyApiError(error);
  if (/missing auth token|unauthorized|invalid session|forbidden/i.test(message)) return 'Please log in as an admin to save pricing changes.';
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

function renderServicePricingTable() {
  const wrap = byId('adminServicePricingTable');
  if (!wrap) return;
  const services = adminState.servicePricing;
  if (!services.length) {
    wrap.innerHTML = '<div class="admin-empty">No services found.</div>';
    return;
  }
  const rows = services.map((service) => [
    `<strong>${escapeHtml(service.label || service.name || service.id)}</strong><div class="admin-meta">${escapeHtml(service.id)}</div>`,
    `<input class="admin-service-price-input" data-field="baseFee" type="number" min="0" step="0.01" value="${escapeHtml(service.baseFee ?? 0)}" aria-label="Base fee for ${escapeHtml(service.label || service.id)}" />`,
    `<input class="admin-service-price-input" data-field="ratePer1000Sqft" type="number" min="0" step="0.01" value="${escapeHtml(service.ratePer1000Sqft ?? 0)}" aria-label="Rate per 1000 square feet for ${escapeHtml(service.label || service.id)}" />`,
    `<input class="admin-service-price-input" data-field="minimumPrice" type="number" min="0" step="0.01" value="${escapeHtml(service.minimumPrice ?? 0)}" aria-label="Minimum price for ${escapeHtml(service.label || service.id)}" />`,
    `<input class="admin-service-active-input" data-field="active" type="checkbox" ${service.active !== false ? 'checked' : ''} aria-label="Active service ${escapeHtml(service.label || service.id)}" />`,
    `<button class="btn primary small admin-service-save ui-icon-btn" type="button">${adminUiIcon('save', 'Save')}</button>`,
  ]);
  wrap.innerHTML = adminTable(['Service','Base Fee','Rate / 1k sq ft','Minimum Price','Active','Save button'], rows);
  wrap.querySelectorAll('tbody tr').forEach((row, index) => {
    row.dataset.serviceId = services[index]?.id || '';
  });
  wrap.querySelectorAll('.admin-service-save').forEach((button) => {
    button.addEventListener('click', () => saveServicePricing(button).catch((error) => showError(friendlyAdminSaveError(error))));
  });
}

function collectServicePricingRows() {
  const wrap = byId('adminServicePricingTable');
  if (!wrap) return adminState.servicePricing;
  return adminState.servicePricing.map((service) => {
    const row = Array.from(wrap.querySelectorAll('tr[data-service-id]'))
      .find((item) => item.dataset.serviceId === String(service.id));
    if (!row) return service;
    const next = { ...service };
    row.querySelectorAll('.admin-service-price-input').forEach((input) => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${service.label || service.id} has an invalid ${input.dataset.field}.`);
      }
      next[input.dataset.field] = value;
    });
    const active = row.querySelector('.admin-service-active-input');
    next.active = Boolean(active?.checked);
    return next;
  });
}

async function saveServicePricing(button) {
  const services = collectServicePricingRows();
  if (button) button.disabled = true;
  try {
    const data = await api('/api/admin/settings/services', {
      method: 'PUT',
      body: JSON.stringify({ services }),
    });
    adminState.servicePricing = (data.services || []).map(normalizeService);
    showSuccess('Service pricing saved');
    await loadConfig();
    await loadAdminPricing();
  } finally {
    if (button) button.disabled = false;
  }
}

function initCleanupModal() {
  const modal = byId('adminCleanupModal');
  const input = byId('cleanupConfirmInput');
  const cancelBtn = byId('cleanupCancelBtn');
  const confirmBtn = byId('cleanupConfirmBtn');
  const resultEl = byId('cleanupModalResult');
  const openBtn = byId('cleanupTestJobsBtn');
  if (!modal || !openBtn) return;
  openBtn.addEventListener('click', () => {
    if (input) input.value = '';
    if (resultEl) resultEl.textContent = '';
    modal.style.display = 'flex';
  });
  cancelBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.style.display = 'none'; });
  confirmBtn?.addEventListener('click', async () => {
    if (!input || input.value.trim() !== 'DELETE') {
      if (resultEl) resultEl.textContent = 'Type DELETE to confirm.';
      return;
    }
    confirmBtn.disabled = true;
    if (resultEl) resultEl.textContent = 'Deleting...';
    try {
      const data = await api('/api/admin/jobs/cleanup', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) });
      if (resultEl) resultEl.textContent = `Done: removed ${data.total} jobs (${data.deletedLeads} leads, ${data.deletedDb} DB).`;
      await loadAdminSystem();
      if (adminState.tab === 'jobs') await loadAdminMgmtJobs();
    } catch (err) {
      if (resultEl) resultEl.textContent = 'Error: ' + prettyApiError(err);
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

byId('regionEditorSelect')?.addEventListener('change', hydrateRegionEditor);
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
        featuredCities: String(byId('regionFeaturedCities')?.value || '').split(',').map((v) => v.trim()).filter(Boolean),
        enabled: byId('regionEnabled')?.value === 'true',
      }),
    });
    showResult('regionEditorResult', '<strong>Region pricing saved.</strong>');
    await loadConfig();
    await loadAdminPricing();
  } catch (error) {
    showResult('regionEditorResult', `<strong>Could not save:</strong> ${escapeHtml(friendlyAdminSaveError(error))}`);
  }
});

document.querySelectorAll('.admin-tab').forEach((btn) => btn.addEventListener('click', () => setAdminTab(btn.dataset.adminTab)));
byId('adminConsoleRefresh')?.addEventListener('click', () => loadAdminTab().catch((err) => showError(prettyApiError(err))));
byId('refreshAdminAlertsBtn')?.addEventListener('click', () => setAdminTab('system'));
byId('refreshServices')?.addEventListener('click', () => loadAdminPricing().catch((err) => showError(prettyApiError(err))));
byId('refreshMgmtJobsBtn')?.addEventListener('click', () => loadAdminMgmtJobs().catch((err) => showError(prettyApiError(err))));
byId('adminDeleteSelectedJobsBtn')?.addEventListener('click', () => deleteSelectedAdminJobs().catch((err) => showError(prettyApiError(err))));
byId('refreshMgmtQuotesBtn')?.addEventListener('click', () => loadAdminMgmtQuotes().catch((err) => showError(prettyApiError(err))));
byId('refreshMgmtUsersBtn')?.addEventListener('click', () => loadAdminMgmtUsers().catch((err) => showError(prettyApiError(err))));
byId('adminDeleteSelectedUsersBtn')?.addEventListener('click', () => deleteSelectedAdminUsers().catch((err) => showError(prettyApiError(err))));
byId('refreshMgmtProvidersBtn')?.addEventListener('click', () => loadAdminMgmtProviders().catch((err) => showError(prettyApiError(err))));
byId('refreshAdminSystemBtn')?.addEventListener('click', () => loadAdminSystem().catch((err) => showError(prettyApiError(err))));

['adminJobsSearch','adminJobsStatusFilter','adminJobsPaymentFilter'].forEach((id) => byId(id)?.addEventListener(id.endsWith('Search') ? 'input' : 'change', adminDebounce(() => loadAdminMgmtJobs().catch(() => {}))));
['adminQuotesSearch','adminQuotesStatusFilter'].forEach((id) => byId(id)?.addEventListener(id.endsWith('Search') ? 'input' : 'change', adminDebounce(() => renderAdminQuotes())));
['adminUsersSearch','adminUsersRoleFilter','adminUsersActiveFilter'].forEach((id) => byId(id)?.addEventListener(id.endsWith('Search') ? 'input' : 'change', adminDebounce(() => loadAdminMgmtUsers().catch(() => {}))));
['adminProvidersSearch','adminProvidersActiveFilter'].forEach((id) => byId(id)?.addEventListener(id.endsWith('Search') ? 'input' : 'change', adminDebounce(() => loadAdminMgmtProviders().catch(() => {}))));

initCleanupModal();

async function loadAdminLeads() {
  return loadAdminMgmtJobs();
}

async function loadAdminPaidJobs() {
  return loadAdminMgmtJobs();
}

window.loadAdmin = loadAdmin;
window.loadAdminLeads = loadAdminLeads;
window.loadAdminPaidJobs = loadAdminPaidJobs;
window.loadAdminMgmtJobs = loadAdminMgmtJobs;
window.loadAdminMgmtQuotes = loadAdminMgmtQuotes;
window.loadAdminMgmtUsers = loadAdminMgmtUsers;
window.loadAdminMgmtProviders = loadAdminMgmtProviders;
