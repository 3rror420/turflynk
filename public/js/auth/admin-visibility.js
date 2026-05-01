// Admin and role visibility helpers — extracted from app.js (Phase 1 modular refactor)
// Depends on: state (state.js), byId/$$ (utils/dom.js)
// applyRoleVisibility() calls loadAdminLeads() and loadAdmin() which live in app.js —
// safe because this function is only ever called after all scripts have loaded.

function isAdmin() {
  return state.currentUser?.role === 'admin';
}

function showAdminControls() {
  $$('.admin-only').forEach((el) => { el.style.display = 'block'; });
}

function hideAdminControls() {
  $$('.admin-only').forEach((el) => { el.style.display = 'none'; });
}

function applyRoleVisibility() {
  const isAdmin = state.currentUser?.role === 'admin';
  const isProvider = state.currentUser?.role === 'provider';
  const isLoggedIn = Boolean(state.currentUser);

  // Admin nav buttons: only visible to admins
  $$('.admin-only-nav').forEach((el) => {
    el.style.display = isAdmin ? '' : 'none';
  });
  const drawerAdminLogin = byId('drawerAdminLogin');
  if (drawerAdminLogin) drawerAdminLogin.style.display = isAdmin ? 'none' : '';

  // Provider section: visible to providers and admins
  $$('.provider-only-nav').forEach((el) => {
    el.style.display = (isProvider || isAdmin) ? '' : 'none';
  });

  // Logged-in customer section: My Bookings etc.
  $$('.customer-logged-in-nav').forEach((el) => {
    el.style.display = isLoggedIn ? '' : 'none';
  });

  // Admin view: show controls or auth wall
  const wall = byId('adminAuthWall');
  const wrap = byId('adminControlsWrap');
  const paidPanel = byId('adminPaidJobsPanel');
  if (wall) wall.style.display = isAdmin ? 'none' : '';
  if (wrap) wrap.style.display = isAdmin ? '' : 'none';
  if (paidPanel) paidPanel.style.display = isAdmin ? '' : 'none';

  // Admin-only panels (e.g., dashboard metrics, recent activity)
  $$('.admin-only').forEach((el) => { el.style.display = isAdmin ? 'block' : 'none'; });

  // Leads panel is always shown in admin view but loads data only if admin
  if (isAdmin) loadAdminLeads().catch(() => {});
  if (isAdmin) loadAdmin().catch(() => {});
  if (isAdmin) loadAdminPaidJobs().catch(() => {});

  // Provider paid jobs panel: show to providers and admins
  const providerWorkspacePanel = byId('providerWorkspacePanel');
  if (providerWorkspacePanel) {
    const showWorkspace = isProvider || isAdmin;
    providerWorkspacePanel.classList.toggle('hidden', !showWorkspace);
    providerWorkspacePanel.style.display = showWorkspace ? '' : 'none';
    if (showWorkspace && typeof renderProviderArea === 'function' && state.activeView === 'providers') {
      renderProviderArea(state.providerAreaSection || 'dashboard');
    }
  }

  const providerPaidPanel = byId('providerPaidJobsPanel');
  if (providerPaidPanel) {
    const showPanel = isProvider || isAdmin;
    providerPaidPanel.classList.toggle('hidden', !showPanel);
    providerPaidPanel.style.display = showPanel ? '' : 'none';
    if (showPanel) loadProviderPaidJobs().catch(() => {});
  }
}
