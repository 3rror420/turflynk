// auth-ui.js — Authentication, session, and account UI helpers (Phase 6 modular refactor)
// Depends on: state (state.js), byId/$$ (utils/dom.js), api (core/api.js),
//   applyRoleVisibility (auth/admin-visibility.js)
// Must load after: config.js, state.js, utils/dom.js, auth/admin-visibility.js, core/api.js
// Must load before: quote/*, ai/*, app.js

// ── Token helpers ───────────────────────────────────────────────────────────

function setAuthToken(token) {
  if (token) localStorage.setItem('turflynk.authToken', token);
  else localStorage.removeItem('turflynk.authToken');
  updateSessionStatus();
}

function getAuthToken() {
  return localStorage.getItem('turflynk.authToken') || '';
}

function hasActiveSession() {
  return Boolean(getAuthToken() || state.currentUser?.id);
}

// ── User / display helpers ──────────────────────────────────────────────────

function getCurrentUser() {
  return state.currentUser || state.user || null;
}

function getUserDisplayName(user) {
  if (!user) return '';
  return user.fullName
    || user.displayName
    || user.name
    || [user.given_name, user.family_name].filter(Boolean).join(' ')
    || [user.first_name, user.last_name].filter(Boolean).join(' ')
    || user.profile?.name
    || user.facebook?.name
    || user.raw?.name
    || '';
}

function accountDisplayName(user = getCurrentUser()) {
  return user?.name
    || user?.fullName
    || user?.displayName
    || user?.profile?.name
    || user?.email
    || '';
}

function accountAvatarUrl(user = getCurrentUser()) {
  return user?.picture
    || user?.avatar
    || user?.avatarUrl
    || user?.avatar_url
    || user?.photoURL
    || user?.photoUrl
    || user?.profile_pic
    || user?.profilePicture
    || user?.photo
    || user?.profile?.picture
    || user?.profile?.avatar
    || '';
}

function accountInitials(user = getCurrentUser()) {
  const label = accountDisplayName(user);
  const source = label || 'Guest';
  const parts = String(source).replace(/@.*/, '').split(/\s+/).filter(Boolean);
  const chars = parts.length > 1
    ? [parts[0][0], parts[parts.length - 1][0]]
    : [source[0] || 'G'];
  return chars.join('').toUpperCase().slice(0, 2);
}

function renderAvatarElement(root, user = getCurrentUser()) {
  if (!root) return;
  const img = root.querySelector('[data-avatar-img]');
  const initials = root.querySelector('[data-avatar-initials]');
  const url = accountAvatarUrl(user);
  const loggedIn = Boolean(user?.email || user?.id);
  root.classList.toggle('is-logged-in', loggedIn);
  root.classList.toggle('has-image', Boolean(url));
  if (initials) initials.textContent = accountInitials(user);
  if (!img) return;
  if (url) {
    img.src = url;
    img.alt = accountDisplayName(user) ? `${accountDisplayName(user)} profile picture` : 'Profile picture';
    img.hidden = false;
  } else {
    img.removeAttribute('src');
    img.alt = '';
    img.hidden = true;
  }
}

function updateAccountAvatar(user = getCurrentUser()) {
  ['mobileAccountAvatar', 'authPanelAvatar', 'drawerAccountAvatar'].forEach((id) => {
    renderAvatarElement(byId(id), user);
  });
  const loggedIn = Boolean(user?.id || user?.email);
  const label = byId('mobileAuthLabel');
  if (label) label.textContent = loggedIn ? 'Account' : 'Login';
  const mobileAuth = byId('mobileAuthBtn');
  if (mobileAuth) {
    mobileAuth.setAttribute('aria-label', loggedIn ? 'Open account settings' : 'Login or sign up');
    mobileAuth.dataset.authState = loggedIn ? 'logged-in' : 'logged-out';
  }
  const drawerName = byId('drawerAccountName');
  if (drawerName) drawerName.textContent = accountDisplayName(user) || 'Account';
  const drawerMeta = byId('drawerAccountMeta');
  if (drawerMeta) drawerMeta.textContent = user?.email ? `${user.email}${user.role ? ` - ${user.role}` : ''}` : '';
}

// ── Session status rendering ────────────────────────────────────────────────

function updateSessionStatus(user) {
  const el = byId('sessionStatus');
  if (user !== undefined) {
    state.currentUser = user || null;
    state.user = user || null;
  }
  const currentUser = getCurrentUser();
  updateAccountAvatar(currentUser || null);

  const loggedIn = Boolean(currentUser?.id || currentUser?.email);
  document.body.dataset.sessionState = loggedIn ? 'logged-in' : 'logged-out';
  const landingLogin = byId('openAuth');
  if (landingLogin) {
    landingLogin.hidden = loggedIn;
    landingLogin.style.display = loggedIn ? 'none' : '';
  }
  if (loggedIn) {
    console.info('[Auth UI] logged in user=' + (currentUser.email || currentUser.id));
  }
  if (typeof applyRoleVisibility === 'function') applyRoleVisibility();

  if (!el) return;
  if (currentUser?.email) {
    el.textContent = `${accountDisplayName(currentUser)} - ${currentUser.role || 'user'}`;
    el.classList.add('ok');
    return;
  }
  const token = getAuthToken();
  if (!token) {
    el.textContent = 'Guest mode';
    el.classList.remove('ok');
    return;
  }
  el.textContent = 'Session saved';
  el.classList.add('ok');
}

function accountUser() {
  return getCurrentUser();
}

function renderAccountUserInfo() {
  const el = byId('accountUserInfo');
  if (!el) return;
  const user = accountUser();
  if (!user) {
    el.innerHTML = '<div class="meta">Guest mode</div>';
    return;
  }
  const name = accountDisplayName(user) || getUserDisplayName(user) || 'Account';
  const role = user.role ? ` - ${user.role}` : '';
  el.innerHTML = `
    <div class="account-user-name">${escapeHtml(name)}</div>
    <div class="meta">${escapeHtml(user.email || '')}${escapeHtml(role)}</div>
  `;
}

// ── Lead form hydration from auth user ─────────────────────────────────────

function hydrateLeadFormFromUser(user) {
  if (!user) return;
  const userKeys = Object.keys(user).join(', ');
  const name = getUserDisplayName(user);
  const email = user.email || '';
  const phone = user.phone || user.phoneNumber || '';

  console.info('[Auth Hydrate] user keys=' + userKeys);
  console.info('[Auth Hydrate] resolved name=' + (name || '(empty)') + ' email=' + (email ? 'yes' : 'no') + ' phone=' + (phone ? 'yes' : 'no'));

  let filled = false;
  const fillBlank = (el, value) => {
    if (el && value && !el.value) { el.value = value; filled = true; }
  };

  const leadForm = byId('leadRequestForm');
  if (leadForm) {
    fillBlank(leadForm.elements.customerName, name);
    fillBlank(leadForm.elements.customerEmail, email);
    fillBlank(leadForm.elements.customerPhone, phone);
  }

  const manualForm = byId('manualQuoteForm');
  if (manualForm) {
    fillBlank(manualForm.elements.name, name);
    fillBlank(manualForm.elements.email, email);
    fillBlank(manualForm.elements.phone, phone);
  }

  if (filled) {
    console.info('[Auth Hydrate] filled name/email/phone blanks from user profile', {
      name: Boolean(name), email: Boolean(email), phone: Boolean(phone),
    });
  }
}

// ── Frontend session clear + sign out ──────────────────────────────────────

function clearFrontendSessionState() {
  state.currentUser = null;
  localStorage.removeItem('turflynk.authToken');
  updateSessionStatus(null);
  if (typeof applyRoleVisibility === 'function') applyRoleVisibility();
  const authResult = byId('authResult');
  if (authResult) authResult.classList.add('hidden');
  if (typeof updateQuoteFlowState === 'function') updateQuoteFlowState();
}

async function signOut() {
  try {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch (error) {
    console.warn('Logout request failed; clearing local session anyway.', error);
  }
  clearFrontendSessionState();
  clearAuthReturnContext();
  if (typeof closeAppDrawer === 'function') closeAppDrawer();
  toggleAuthPanel(false);
  if (typeof showSuccess === 'function') showSuccess('Signed out');
}

// ── Auth return context (localStorage bookmark before OAuth redirect) ───────

const AUTH_RETURN_KEY = 'turflynk.authReturn.v1';

function saveAuthReturnContext(step = 'request', sourceOverride = '') {
  const form = byId('quoteForm');
  const quoteFormData = form ? Object.fromEntries(new FormData(form)) : null;
  let quote = state.pendingQuote || state.lastQuote || null;
  if (!quote && form) {
    try {
      quote = typeof buildQuotePayload === 'function' ? buildQuotePayload(form) : quoteFormData;
    } catch (err) {
      quote = quoteFormData;
    }
  }

  const leadForm = byId('leadRequestForm');
  let customerFields = null;
  if (leadForm) {
    customerFields = {
      customerName: leadForm.elements.customerName?.value || '',
      customerPhone: leadForm.elements.customerPhone?.value || '',
      customerEmail: leadForm.elements.customerEmail?.value || '',
      notes: leadForm.elements.notes?.value || '',
      preferredDate: leadForm.elements.preferredDate?.value || '',
      schedule_preference: leadForm.elements.schedule_preference?.value || '',
      available_days_json: checkedValues('available_days_json', leadForm),
    };
  }

  const manualForm = byId('manualQuoteForm');
  if (manualForm) {
    customerFields = {
      ...(customerFields || {}),
      customerName: customerFields?.customerName || manualForm.elements.name?.value || '',
      customerPhone: customerFields?.customerPhone || manualForm.elements.phone?.value || '',
      customerEmail: customerFields?.customerEmail || manualForm.elements.email?.value || '',
      notes: customerFields?.notes || manualForm.elements.notes?.value || '',
      preferredDayTime: manualForm.elements.preferredDayTime?.value || '',
    };
  }

  const drawnGeoJSON = (state.mowableFeatureCollection?.features?.length > 0)
    ? cloneFeatureCollection(state.mowableFeatureCollection)
    : null;

  const parcelGeoJSON = currentParcelGeoJSON() || null;

  const currentStep = step || state.quoteFlowStep || 'request';
  const source = sourceOverride || ((step === 'request' || step === 'manual') ? 'checkout' : 'account');
  console.info('[Auth Resume] saved', {
    source,
    step: currentStep,
    hasEstimate: Boolean(quote?.estimate),
    hasGeoJSON: Boolean(drawnGeoJSON?.features?.length),
    hasParcelGeoJSON: Boolean(parcelGeoJSON),
    hasCustomerName: Boolean(customerFields?.customerName),
  });

  localStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({
    step: currentStep,
    source,
    quote,
    quoteFormData,
    customerFields,
    drawnGeoJSON,
    parcelGeoJSON,
    pendingCheckoutUrl: state.pendingCheckoutUrl || '',
    selectedService: quote?.serviceType || quoteFormData?.serviceType || '',
    savedAt: Date.now(),
  }));
}

function loadAuthReturnContext() {
  try {
    const context = JSON.parse(localStorage.getItem(AUTH_RETURN_KEY) || 'null');
    if (!context || Date.now() - Number(context.savedAt || 0) > 30 * 60 * 1000) {
      localStorage.removeItem(AUTH_RETURN_KEY);
      return null;
    }
    return context;
  } catch (err) {
    localStorage.removeItem(AUTH_RETURN_KEY);
    return null;
  }
}

function clearAuthReturnContext() {
  localStorage.removeItem(AUTH_RETURN_KEY);
}

// ── Social / OAuth helpers ──────────────────────────────────────────────────

function isMobileFacebookLoginFlow() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const smallScreen = Boolean(window.matchMedia?.('(max-width: 820px)').matches || window.innerWidth <= 820);
  const mobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
  const touchDevice = Boolean(
    navigator.maxTouchPoints > 0
    || navigator.msMaxTouchPoints > 0
    || window.matchMedia?.('(pointer: coarse)').matches
    || 'ontouchstart' in window
  );
  return Boolean(smallScreen || mobileUA || touchDevice);
}

function facebookAuthStartPath(source = 'account', step = 'request') {
  const params = new URLSearchParams({ source, step });
  return `/api/auth/facebook?${params.toString()}`;
}

function authReturnStep(defaultStep = 'request') {
  const rawStep = defaultStep || state.quoteFlowStep || 'request';
  if (['manual', 'request', 'estimate', 'property', 'draw', 'start'].includes(rawStep)) return rawStep;
  return state.quoteFlowStep || 'request';
}

function startFacebookLogin(step = 'request', source = '') {
  const currentStep = authReturnStep(step);
  const currentSource = source || ((currentStep === 'manual' || currentStep === 'request') ? 'checkout' : 'account');
  const mobile = isMobileFacebookLoginFlow();
  if (typeof saveQuoteDraft === 'function') saveQuoteDraft();
  saveAuthReturnContext(currentStep, currentSource);
  const route = facebookAuthStartPath(currentSource, currentStep);
  console.info(`[Facebook Login] mobile=${mobile}`);
  console.info(`[Facebook Login] redirect=${route}`);
  window.location.href = route;
}

function beginSocialAuth(provider, step = 'request') {
  if (provider === 'google' && !GOOGLE_LOGIN_ENABLED) {
    if (typeof showWarning === 'function') showWarning('Google sign-in is not available yet. Please use Facebook or email.');
    return;
  }
  if (typeof saveQuoteDraft === 'function') saveQuoteDraft();
  if (provider === 'facebook') {
    const currentStep = authReturnStep(step);
    const source = currentStep === 'manual' || currentStep === 'request' ? 'checkout' : 'account';
    startFacebookLogin(currentStep, source);
    return;
  }
  saveAuthReturnContext(step);
  const returnTo = `/?auth=success&view=quote&step=${encodeURIComponent(step)}`;
  window.location.href = `/auth/${encodeURIComponent(provider)}?returnTo=${encodeURIComponent(returnTo)}`;
}

function applySocialLoginVisibility() {
  document.body.dataset.googleLoginEnabled = GOOGLE_LOGIN_ENABLED ? 'true' : 'false';
  $$('[data-social-auth="google"]').forEach((btn) => {
    btn.hidden = !GOOGLE_LOGIN_ENABLED;
    btn.classList.toggle('hidden', !GOOGLE_LOGIN_ENABLED);
    btn.setAttribute('aria-hidden', GOOGLE_LOGIN_ENABLED ? 'false' : 'true');
  });
}

// ── Auth panel open/close/toggle ────────────────────────────────────────────

function toggleAuthPanel(forceOpen) {
  const panel = document.getElementById('authPanel');
  if (!panel) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
}

document.getElementById('openAuth')?.addEventListener('click', () => {
  toggleAuthPanel();
});

byId('mobileAuthBtn')?.addEventListener('click', () => {
  if (hasActiveSession()) {
    if (typeof showAccountPanel === 'function') showAccountPanel('quotes');
    return;
  }
  toggleAuthPanel(true);
});

$$('[data-open-auth]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (typeof closeAppDrawer === 'function') closeAppDrawer();
    toggleAuthPanel(true);
  });
});

$$('[data-social-auth]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const provider = btn.dataset.socialAuth;
    const isFacebook = provider === 'facebook';
    e.preventDefault();
    if (isFacebook) console.info('[Facebook Login] clicked');
    beginSocialAuth(provider, btn.dataset.authReturnStep || 'request');
  });
});

$$('.facebook-login-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    console.info('[Facebook Login] clicked');
    const href = new URL(link.getAttribute('href') || '/api/auth/facebook?source=account', window.location.origin);
    const source = href.searchParams.get('source') || 'account';
    const step = href.searchParams.get('step') || state.quoteFlowStep || 'request';
    startFacebookLogin(step, source);
  });
});

$$('[data-email-auth-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const form = byId(btn.dataset.emailAuthTarget);
    const firstInput = form?.querySelector('input:not([type="hidden"]), textarea, select');
    firstInput?.focus();
    form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

// ── Auth panel tabs + email login/register forms ────────────────────────────

function showAuthTab(tab) {
  document.getElementById('loginForm')?.classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm')?.classList.toggle('hidden', tab !== 'register');
}

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });

  const json = await res.json();
  if (json.ok) {
    setAuthToken(json.token);
    state.currentUser = json.user;
    updateSessionStatus(json.user);
    applyRoleVisibility();
    toggleAuthPanel(false);
    if (typeof showSuccess === 'function') showSuccess('Signed in');
    const adminTasks = json.user?.role === 'admin' ? [loadAdmin().catch(() => {}), loadAdminLeads().catch(() => {})] : [];
    const jobBoardTask = (json.user?.role === 'admin' || json.user?.role === 'provider') ? [loadJobs()] : [];
    await Promise.allSettled([loadProviders(), ...jobBoardTask, loadMyJobs(), ...adminTasks]);
  } else {
    if (typeof showError === 'function') showError(json.error);
  }
});

document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));

  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });

  const json = await res.json();
  if (json.ok) {
    if (typeof showSuccess === 'function') showSuccess('Account created. Now log in.');
    showAuthTab('login');
  } else {
    if (typeof showError === 'function') showError(json.error);
  }
});

// ── Logout handlers ─────────────────────────────────────────────────────────

async function handleAccountLogout() {
  await signOut();
  if (typeof setActiveView === 'function') setActiveView('quote');
  if (typeof showQuoteFlowStep === 'function') showQuoteFlowStep('property');
}

byId('logoutBtn') && (byId('logoutBtn').onclick = handleAccountLogout);
byId('drawerLogoutBtn') && (byId('drawerLogoutBtn').onclick = handleAccountLogout);

byId('authPanelSignOutBtn')?.addEventListener('click', async () => {
  toggleAuthPanel(false);
  await signOut();
});

// ── Auth gate (shown when unauthenticated user tries to book) ───────────────

function openAuthGate(onSuccess) {
  state._authGateCallback = onSuccess;
  const el = byId('authGateModal');
  if (el) { el.classList.remove('hidden'); el.style.display = 'flex'; }
  byId('gateLoginForm')?.reset();
  byId('gateRegisterForm')?.reset();

  const quote = state.lastQuote || state.pendingQuote || {};
  const loginForm = byId('gateLoginForm');
  const registerForm = byId('gateRegisterForm');
  if (loginForm?.elements?.email && quote.email) loginForm.elements.email.value = quote.email;
  if (registerForm) {
    if (registerForm.elements.fullName && quote.name) registerForm.elements.fullName.value = quote.name;
    if (registerForm.elements.email && quote.email) registerForm.elements.email.value = quote.email;
    if (registerForm.elements.phone && quote.phone) registerForm.elements.phone.value = quote.phone;
  }

  showGateTab('login');
}

function closeAuthGate() {
  const el = byId('authGateModal');
  if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
  state._authGateCallback = null;
}

function showGateTab(tab) {
  byId('gateLoginForm')?.classList.toggle('hidden', tab !== 'login');
  byId('gateRegisterForm')?.classList.toggle('hidden', tab !== 'register');
  byId('gateLoginTab')?.classList.toggle('active', tab === 'login');
  byId('gateRegisterTab')?.classList.toggle('active', tab !== 'login');
}

byId('closeAuthGateBtn')?.addEventListener('click', closeAuthGate);

byId('authGateModal')?.addEventListener('click', (e) => {
  if (e.target === byId('authGateModal')) closeAuthGate();
});

byId('gateLoginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const { email, password } = Object.fromEntries(new FormData(e.target));
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Login failed');
    setAuthToken(json.token);
    state.currentUser = json.user;
    applyRoleVisibility();
    const callback = state._authGateCallback;
    closeAuthGate();
    if (typeof callback === 'function') callback();
  } catch (err) {
    if (typeof showError === 'function') showError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

byId('gateRegisterForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const { fullName, email, phone, password } = Object.fromEntries(new FormData(e.target));
    const regRes = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, phone, password, role: 'customer' }),
    });
    const regJson = await regRes.json();
    if (!regJson.ok) throw new Error(regJson.error || 'Registration failed');
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginJson = await loginRes.json();
    if (!loginJson.ok) throw new Error('Account created — please log in.');
    setAuthToken(loginJson.token);
    state.currentUser = loginJson.user;
    applyRoleVisibility();
    const callback = state._authGateCallback;
    closeAuthGate();
    if (typeof callback === 'function') callback();
  } catch (err) {
    if (typeof showError === 'function') showError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

// ── Window exports (for app.js and inline HTML handlers) ────────────────────
window.setAuthToken = setAuthToken;
window.getAuthToken = getAuthToken;
window.hasActiveSession = hasActiveSession;
window.getCurrentUser = getCurrentUser;
window.getUserDisplayName = getUserDisplayName;
window.accountDisplayName = accountDisplayName;
window.accountAvatarUrl = accountAvatarUrl;
window.accountInitials = accountInitials;
window.renderAvatarElement = renderAvatarElement;
window.updateAccountAvatar = updateAccountAvatar;
window.updateSessionStatus = updateSessionStatus;
window.accountUser = accountUser;
window.renderAccountUserInfo = renderAccountUserInfo;
window.hydrateLeadFormFromUser = hydrateLeadFormFromUser;
window.clearFrontendSessionState = clearFrontendSessionState;
window.signOut = signOut;
window.AUTH_RETURN_KEY = AUTH_RETURN_KEY;
window.saveAuthReturnContext = saveAuthReturnContext;
window.loadAuthReturnContext = loadAuthReturnContext;
window.clearAuthReturnContext = clearAuthReturnContext;
window.isMobileFacebookLoginFlow = isMobileFacebookLoginFlow;
window.facebookAuthStartPath = facebookAuthStartPath;
window.authReturnStep = authReturnStep;
window.startFacebookLogin = startFacebookLogin;
window.beginSocialAuth = beginSocialAuth;
window.applySocialLoginVisibility = applySocialLoginVisibility;
window.toggleAuthPanel = toggleAuthPanel;
window.showAuthTab = showAuthTab;
window.handleAccountLogout = handleAccountLogout;
window.openAuthGate = openAuthGate;
window.closeAuthGate = closeAuthGate;
window.showGateTab = showGateTab;
