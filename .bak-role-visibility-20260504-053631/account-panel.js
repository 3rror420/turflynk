// Account panel / app shell UI
// Extracted from app.js — Phase 13h
// Dependencies (global): byId, $$, state, escapeHtml, hasActiveSession,
//   closeAppDrawer, toggleAuthPanel, renderAccountUserInfo,
//   accountUser, accountDisplayName, getUserDisplayName,
//   loadMyJobs, loadMyQuotes

const ACCOUNT_SECTIONS = [
  { id: 'quotes', label: 'Active Quotes' },
  { id: 'jobs', label: 'My Jobs' },
  { id: 'account', label: 'Account Info' },
];

function accountEmptyMessage(text) {
  return `<div class="account-empty">${escapeHtml(text)}</div>`;
}

function hideAllPanels() {
  $$('[data-view-panel]').forEach((panel) => {
    panel.classList.remove('active');
    panel.style.display = 'none';
  });
  const accountPanel = byId('accountPanel');
  if (accountPanel) accountPanel.classList.add('hidden');
  byId('authPanel')?.classList.add('hidden');
}

function showAccountPanel(section = 'quotes') {
  if (!hasActiveSession()) {
    closeAppDrawer?.();
    toggleAuthPanel?.(true);
    return;
  }

  const activeSection = ACCOUNT_SECTIONS.some((s) => s.id === section) ? section : 'quotes';
  hideAllPanels();
  state.activeView = 'account';
  document.body.dataset.activeView = 'account';
  byId('accountPanel')?.classList.remove('hidden');
  if (byId('viewTitle')) byId('viewTitle').textContent = 'My Account';
  if (byId('mobileViewTitle')) byId('mobileViewTitle').textContent = 'My Account';
  $$('[data-view]').forEach((btn) => {
    btn.classList.remove('active');
    btn.setAttribute('aria-current', 'false');
  });
  closeAppDrawer?.();
  renderAccountUserInfo();
  renderAccountMenu(activeSection);
  renderAccountSection(activeSection);
  byId('accountPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderAccountMenu(active) {
  const menu = byId('accountMenu');
  if (!menu) return;
  const user = accountUser() || {};
  const name = getUserDisplayName(user) || accountDisplayName(user) || '';
  const firstName = name.split(/\s+/)[0] || 'there';
  menu.innerHTML = `
    <div class="customer-dashboard-hero">
      <p class="customer-welcome">Welcome back, ${escapeHtml(firstName)}!</p>
      <p class="customer-welcome-sub">Manage your lawn quotes and mowing jobs.</p>
      <button class="btn primary small" onclick="setActiveView('quote')">Start New Quote</button>
    </div>
    <div class="customer-tab-row">
      ${ACCOUNT_SECTIONS.map((s) => `
        <button class="account-menu-item ${s.id === active ? 'active' : ''}"
          onclick="showAccountPanel('${s.id}')">
          ${s.label}
        </button>
      `).join('')}
    </div>
  `;
}

function renderAccountSection(section) {
  const el = byId('accountContent');
  if (!el) return;
  el.innerHTML = '';
  const user = accountUser() || {};
  const name = getUserDisplayName(user) || accountDisplayName(user);
  const phone = user.phone || user.phoneNumber || user.mobilePhone || '';

  if (section === 'quotes') {
    el.innerHTML = '<div id="accountQuotes" class="card-list"></div>';
    if (typeof loadMyQuotes === 'function') loadMyQuotes();
  } else if (section === 'jobs') {
    el.innerHTML = '<div id="accountJobs" class="card-list"></div>';
    if (typeof loadMyJobs === 'function') loadMyJobs('accountJobs');
  } else if (section === 'account') {
    el.innerHTML = `
      <div class="account-card">
        <div class="account-field"><span class="field-label">Name</span><strong>${escapeHtml(name || 'Not set')}</strong></div>
        <div class="account-field"><span class="field-label">Email</span><strong>${escapeHtml(user.email || 'Not set')}</strong></div>
        <div class="account-field"><span class="field-label">Phone</span><strong>${escapeHtml(phone || 'Not set')}</strong></div>
      </div>
    `;
  }
}
