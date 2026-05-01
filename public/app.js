

// FIX: hide confirm UI when parcel not found
function handleParcelResult(result) {
  const gpsBar = document.getElementById('gpsConfirmBar');
  const parcelActions = document.querySelector('.parcel-actions-card');

  if (!result || result.ok === false || result.reason === 'not_found') {
    if (gpsBar) gpsBar.classList.add('hidden');
    if (parcelActions) parcelActions.classList.add('hidden');
    return;
  }

  if (gpsBar) gpsBar.classList.remove('hidden');
  if (parcelActions) parcelActions.classList.remove('hidden');
}

// byId, $$, all constants (QUOTE_DRAFT_KEY, EPSG*, SERVICE_CATALOG, etc.)
// are now defined in public/js/config.js and public/js/utils/dom.js — loaded before this file.

async function api(path, options = {}) {
  const token = localStorage.getItem('turflynk.authToken') || '';

  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json();
}

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

const ACCOUNT_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'profile', label: 'Profile' },
  { id: 'properties', label: 'Properties' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'payments', label: 'Payments' },
  { id: 'reputation', label: 'Reputation' },
  { id: 'support', label: 'Support' },
  { id: 'settings', label: 'Settings' },
];

// isAdmin, showAdminControls, hideAdminControls → public/js/auth/admin-visibility.js

function getCurrentUser() {
  return state.currentUser || state.user || null;
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

function prettyApiError(error) {
  try {
    const parsed = JSON.parse(error.message || '{}');
    return parsed.error || parsed.detail || error.message;
  } catch {
    return error.message || 'Something went wrong';
  }
}

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidLookingPhone(value) {
  const digits = phoneDigits(value);
  return digits.length >= 10 && digits.length <= 15;
}

function bookingPhoneValue(payload = {}) {
  return String(payload.phone || payload.customerPhone || '').trim();
}

function focusBookingPhoneField() {
  const phoneField = byId('leadPhone')
    || byId('leadRequestForm')?.elements?.customerPhone
    || byId('manualQuoteForm')?.elements?.phone
    || byId('quoteForm')?.elements?.phone
    || null;
  phoneField?.focus?.();
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

function rememberProfilePhoneIfBlank(phone) {
  const trimmed = String(phone || '').trim();
  if (!trimmed || !state.currentUser || String(state.currentUser.phone || '').trim()) return;
  state.currentUser = { ...state.currentUser, phone: trimmed };
  hydrateLeadFormFromUser(state.currentUser);
}

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

function hideAllPanels() {
  $$('[data-view-panel]').forEach((panel) => {
    panel.classList.remove('active');
    panel.style.display = 'none';
  });
  const accountPanel = byId('accountPanel');
  if (accountPanel) accountPanel.classList.add('hidden');
  byId('authPanel')?.classList.add('hidden');
}

function showAccountPanel(section = 'overview') {
  if (!hasActiveSession()) {
    closeAppDrawer?.();
    toggleAuthPanel?.(true);
    return;
  }

  const activeSection = ACCOUNT_SECTIONS.some((s) => s.id === section) ? section : 'overview';
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
  menu.innerHTML = ACCOUNT_SECTIONS.map((s) => `
    <button class="account-menu-item ${s.id === active ? 'active' : ''}"
      onclick="showAccountPanel('${s.id}')">
      ${s.label}
    </button>
  `).join('');
}

function accountEmptyMessage(text) {
  return `<div class="account-empty">${escapeHtml(text)}</div>`;
}

function renderAccountSection(section) {
  const el = byId('accountContent');
  if (!el) return;
  el.innerHTML = '';
  const user = accountUser() || {};
  const name = getUserDisplayName(user) || accountDisplayName(user);
  const phone = user.phone || user.phoneNumber || user.mobilePhone || '';

  if (section === 'overview') {
    el.innerHTML = `
      <h3>Overview</h3>
      <div id="accountOverview" class="account-overview-grid">
        <div class="account-summary-card">
          <span>Profile</span>
          <strong>${escapeHtml(name || 'Signed in')}</strong>
        </div>
        <div class="account-summary-card">
          <span>Email</span>
          <strong>${escapeHtml(user.email || 'Not added')}</strong>
        </div>
        <div class="account-summary-card">
          <span>Phone</span>
          <strong>${escapeHtml(phone || 'Not added')}</strong>
        </div>
      </div>
    `;
  } else if (section === 'profile') {
    el.innerHTML = `
      <h3>Profile</h3>
      <div class="account-card">
        <div class="account-field"><span class="field-label">Name</span><strong>${escapeHtml(name || 'Not set')}</strong></div>
        <div class="account-field"><span class="field-label">Email</span><strong>${escapeHtml(user.email || 'Not set')}</strong></div>
        <div class="account-field"><span class="field-label">Phone</span><strong>${escapeHtml(phone || 'Not set')}</strong></div>
      </div>
    `;
  } else if (section === 'jobs') {
    el.innerHTML = '<h3>Jobs</h3><div id="accountJobs" class="card-list"></div>';
    loadMyJobs('accountJobs');
  } else if (section === 'quotes') {
    el.innerHTML = '<h3>Quotes</h3><div id="accountQuotes" class="card-list"></div>';
    loadMyQuotes();
  } else if (section === 'payments') {
    el.innerHTML = `<h3>Payments</h3><div id="accountPayments" class="account-card">${accountEmptyMessage('No payment history yet.')}</div>`;
  } else if (section === 'reputation') {
    el.innerHTML = `
      <h3>Reputation</h3>
      <div id="accountReputation" class="account-card">${accountEmptyMessage('Reputation details will appear here after completed jobs.')}</div>
    `;
  } else if (section === 'properties') {
    el.innerHTML = `<h3>Properties</h3><div id="accountProperties" class="account-card">${accountEmptyMessage('Saved service properties will appear here.')}</div>`;
  } else if (section === 'support') {
    el.innerHTML = `
      <h3>Support</h3>
      <div class="account-card">${accountEmptyMessage('Need help? Use the Contact option in the menu to reach MowNWA support.')}</div>
    `;
  } else if (section === 'settings') {
    el.innerHTML = `
      <h3>Settings</h3>
      <div class="account-card">${accountEmptyMessage('Notification and privacy settings coming soon.')}</div>
    `;
  }
}

async function loadMyQuotes() {
  const list = byId('accountQuotes');
  if (!list) return;

  if (!hasActiveSession()) {
    list.innerHTML = accountEmptyMessage('Sign in to see your quotes.');
    return;
  }

  list.innerHTML = accountEmptyMessage('Loading quotes...');

  try {
    const data = await api('/api/quotes');
    const quotes = data.quotes || data.latestQuotes || [];
    list.innerHTML = '';

    if (!quotes.length) {
      list.innerHTML = accountEmptyMessage('No quotes yet.');
      return;
    }

    quotes.forEach((quote) => {
      const service = quote.serviceType || quote.service_type || '';
      const region = quote.regionId || quote.region_id || '';
      const estimate = quote.estimate || quote.amount || quote.price || 0;
      list.append(card(`
        <h4>${escapeHtml(quote.name || quote.title || 'Lawn Quote')}</h4>
        <div class="meta">${escapeHtml(serviceLabel(service))} &middot; ${escapeHtml(regionLabel(region))}</div>
        <div class="meta">${escapeHtml(quote.address || '')}</div>
        <div class="meta">Estimate: <strong>${money(estimate)}</strong></div>
      `));
    });
  } catch {
    list.innerHTML = accountEmptyMessage('Quotes are not available yet.');
  }
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

function getCheckoutAddressFieldElements() {
  const form = byId('leadRequestForm');
  return {
    addressEl: byId('leadAddress') || form?.elements?.address || null,
    cityEl: byId('leadCity') || form?.elements?.city || null,
    stateEl: byId('leadState') || form?.elements?.state || null,
    zipEl: byId('leadZip') || form?.elements?.zip || null,
  };
}

function propText(props = {}, ...keys) {
  if (!props || typeof props !== 'object') return '';
  for (const key of keys) {
    if (!key) continue;
    const direct = firstTextValue(props[key]);
    if (direct) return direct;
    const foundKey = Object.keys(props).find((candidate) => candidate.toLowerCase() === String(key).toLowerCase());
    const found = foundKey ? firstTextValue(props[foundKey]) : '';
    if (found) return found;
  }
  return '';
}

function propTextByNormalizedKeys(props = {}, keys = []) {
  if (!props || typeof props !== 'object') return '';
  const wanted = new Set(keys.map((key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const [key, value] of Object.entries(props)) {
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (wanted.has(normalized)) {
      const text = firstTextValue(value);
      if (text) return text;
    }
  }
  return '';
}

function propTextByAddressIntent(props = {}, intent = '') {
  if (!props || typeof props !== 'object') return '';
  const nonServiceKey = /(owner|mail|mailing|billing|tax|payer|grantee|grantor)/i;
  const matchers = {
    city: (key) => (
      key.includes('city') ||
      key.includes('municipality') ||
      key === 'mun' ||
      key.startsWith('muni') ||
      key.startsWith('mun')
    ),
    state: (key) => key.includes('state') || key === 'st',
    zip: (key) => key.includes('zip') || key.includes('postal') || key.includes('postcode'),
  };
  const matches = matchers[intent];
  if (!matches) return '';

  for (const [key, value] of Object.entries(props)) {
    if (nonServiceKey.test(String(key))) continue;
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (matches(normalized)) {
      const text = firstTextValue(value);
      if (intent === 'city' && !/[A-Za-z]/.test(text)) continue;
      if (intent === 'state' && !/[A-Za-z]/.test(text)) continue;
      if (intent === 'zip' && !/\d{5}/.test(text)) continue;
      if (text) return text;
    }
  }
  return '';
}

function parcelAddressFieldCandidates(props = {}) {
  if (!props || typeof props !== 'object') return [];
  const addressKey = /(city|zip|postal|situs|site|physical|location|mun|municipality|mail|adr)/i;
  return Object.entries(props)
    .filter(([key, value]) => addressKey.test(String(key)) && firstTextValue(value))
    .map(([key, value]) => ({ key, value }));
}

function parcelFullAddressFromProps(props = {}) {
  return propText(
    props,
    'adrlabel',
    'adr_label',
    'situsaddress',
    'situs_address',
    'situsaddr',
    'situs_addr',
    'situsfulladdress',
    'situs_full_address',
    'siteaddress',
    'site_address',
    'siteaddr',
    'site_addr',
    'physicaladdress',
    'physical_address',
    'locationaddress',
    'location_address',
    'propertyaddress',
    'property_address',
    'fulladdress',
    'fullAddress',
    'full_address',
    'address'
  ).replace(/\s+/g, ' ').trim();
}

function parcelStructuredAddressFromProps(props = {}) {
  const city = firstTextValue(
    propTextByNormalizedKeys(props, [
      'adrcity', 'adr_city', 'situscity', 'situs_city', 'sitecity', 'site_city',
      'physicalcity', 'physical_city', 'locationcity', 'location_city',
      'propertycity', 'property_city', 'servicecity', 'service_city',
      'municipality', 'muni', 'munname', 'muniname', 'locality', 'city'
    ]),
    propTextByAddressIntent(props, 'city')
  );
  const stateValue = firstTextValue(
    propTextByNormalizedKeys(props, [
      'adrstate', 'adr_state', 'situsstate', 'situs_state', 'sitestate', 'site_state',
      'physicalstate', 'physical_state', 'locationstate', 'location_state',
      'propertystate', 'property_state', 'servicestate', 'service_state', 'state'
    ]),
    propTextByAddressIntent(props, 'state')
  );
  const zip = firstTextValue(
    propTextByNormalizedKeys(props, [
      'adrzip5', 'adrzip', 'adr_zip', 'adr_zip5', 'situszip', 'situs_zip',
      'situszip5', 'situs_zip5', 'sitezip', 'site_zip', 'sitezip5', 'site_zip5',
      'physicalzip', 'physical_zip', 'physicalzip5', 'physical_zip5', 'locationzip',
      'location_zip', 'propertyzip', 'property_zip', 'servicezip', 'service_zip',
      'zipcode', 'zip_code', 'postalcode', 'postal_code', 'postcode', 'zip'
    ]),
    propTextByAddressIntent(props, 'zip')
  );

  return normalizeServiceAddressParts({
    address: parcelFullAddressFromProps(props),
    city,
    state: stateValue,
    zip,
  });
}

function sameLeadingStreetNumber(left = '', right = '') {
  const leftNumber = String(left || '').trim().match(/^\d+/)?.[0] || '';
  const rightNumber = String(right || '').trim().match(/^\d+/)?.[0] || '';
  return Boolean(leftNumber && rightNumber && leftNumber === rightNumber);
}

function parseFullServiceAddress(str) {
  const raw = String(str || '').trim();
  if (!raw) return normalizeServiceAddressParts();

  const withCommas = raw.match(/^\s*(.+?),\s*([^,]+?),\s*([A-Za-z]{2})[,\s]+(\d{5}(?:-\d{4})?)\s*$/);
  if (withCommas) {
    return normalizeServiceAddressParts({
      address: withCommas[1],
      city: withCommas[2],
      state: withCommas[3],
      zip: withCommas[4],
    });
  }

  const parsed = parseCityStateZipFromAddress(raw);
  return normalizeServiceAddressParts({
    address: raw,
    city: parsed.city || '',
    state: parsed.state || '',
    zip: parsed.zip || '',
  });
}

function resolveServiceAddressFromParcel(props = {}, fallbackAddress = '') {
  console.log('[PARCEL PROPS FULL]', props);
  console.log('[PARCEL PROPS ADDRESS KEYS]', parcelAddressFieldCandidates(props));

  const fallbackParts = typeof fallbackAddress === 'string'
    ? parseFullServiceAddress(fallbackAddress)
    : normalizeServiceAddressParts(fallbackAddress || {});
  const structured = parcelStructuredAddressFromProps(props);
  const parcelStreet = firstTextValue(structured.street, structured.address, parcelFullAddressFromProps(props));
  const fallbackStreet = firstTextValue(fallbackParts.street, fallbackParts.address);
  const street = sameLeadingStreetNumber(parcelStreet, fallbackStreet)
    ? fallbackStreet
    : firstTextValue(parcelStreet, fallbackStreet);

  let parsed = { city: '', state: '', zip: '' };
  if (parcelStreet) {
    parsed = parseCityStateZipFromAddress(parcelStreet);
  }

  const city = firstTextValue(structured.city, parsed.city, fallbackParts.city);
  const stateValue = firstTextValue(structured.state, parsed.state, fallbackParts.state, 'AR');
  const zip = firstTextValue(structured.zip, parsed.zip, fallbackParts.zip);
  const full = [street, city, [stateValue, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  console.log('[Service Address RESOLVED]', {
    adrlabel: parcelStreet,
    structured,
    parsed,
    final: { city, state: stateValue, zip }
  });

  return {
    street,
    address: street,
    city,
    state: stateValue,
    zip,
    full: full || parcelStreet,
    source: 'parcel-resolver'
  };
}

function parcelPropertiesFromLookupData(data = {}) {
  const normalized = data.normalized || {};
  const attrs = {
    ...(data.feature?.properties || {}),
    ...(data.feature?.attributes || {}),
    ...(normalized.attributes || {}),
  };
  const structured = parcelStructuredAddressFromProps(attrs);
  const derived = {
    parcelId: normalized.parcelId || propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN') || '',
    county: normalized.county || propText(attrs, 'countyid', 'county', 'COUNTY', 'COUNTY_NAME') || '',
    areaSqft: normalized.areaSqft || '',
    acres: normalized.acres || '',
    adrlabel: propText(attrs, 'adrlabel', 'situsaddress', 'siteaddress', 'propertyaddress', 'address') || normalized.address || '',
    adrcity: structured.city || normalized.city || '',
    adrstate: structured.state || normalized.state || 'AR',
    adrzip5: structured.zip || normalized.zip || '',
  };
  return Object.fromEntries(
    Object.entries({ ...attrs, ...derived }).filter(([, value]) => value !== undefined && value !== null)
  );
}

function checkoutParcelProps() {
  const candidates = [
    state.selectedParcelProperties,
    state.parcelProperties,
    state.parcelFeature?.properties,
    state.selectedParcel?.properties,
    state.pendingParcelFeature?.normalized?.attributes,
    state.pendingParcelFeature?.feature?.attributes,
    state.pendingParcelFeature?.properties,
  ];
  return candidates.find((props) => {
    if (!props || typeof props !== 'object') return false;
    return [
      parcelFullAddressFromProps(props),
      propText(props, 'adrcity', 'city', 'situscity', 'propertycity'),
      propText(props, 'adrzip5', 'adrzip', 'zip', 'zipcode', 'postalCode', 'postal_code'),
    ].some((value) => String(value || '').trim());
  }) || {};
}

function firstTextValue(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && !/^n\/?a$/i.test(text)) return text;
  }
  return '';
}

function addressPartsFromParcelProps(props = {}) {
  const fullAddress = parcelFullAddressFromProps(props);
  const parsed = parseFullServiceAddress(fullAddress);
  const structured = parcelStructuredAddressFromProps(props);
  return normalizeServiceAddressParts({
    address: structured.address || parsed.address || fullAddress,
    city: firstTextValue(structured.city, parsed.city),
    state: firstTextValue(structured.state, parsed.state, 'AR'),
    zip: firstTextValue(structured.zip, parsed.zip),
  });
}

function addressPartsFromQuote(quote = {}) {
  const fullAddress = firstTextValue(
    quote.parcelAddressLabel,
    quote.address,
    quote.serviceAddress,
    quote.customerAddress,
    quote.fullAddress,
    quote.full_address,
    quote.formattedAddress,
    quote.formatted_address
  );
  const parsed = parseFullServiceAddress(fullAddress);
  return normalizeServiceAddressParts({
    address: parsed.address || fullAddress,
    city: firstTextValue(quote.parcelCity, quote.city, quote.serviceCity, quote.customerCity, parsed.city),
    state: firstTextValue(quote.parcelState, quote.state, quote.serviceState, quote.customerState, parsed.state, 'AR'),
    zip: firstTextValue(quote.parcelZip, quote.zip, quote.serviceZip, quote.customerZip, quote.postalCode, quote.postal_code, parsed.zip),
  });
}

function mergeAddressResolution(target, candidate) {
  const parts = normalizeServiceAddressParts(candidate.parts || {});
  const beforeCity = target.parts.city;
  const beforeZip = target.parts.zip;
  if (!target.parts.address && parts.address) {
    target.parts.address = parts.address;
    target.addressSource = candidate.source;
  }
  if (!target.parts.city && parts.city) {
    target.parts.city = parts.city;
    target.citySource = candidate.source;
  }
  if ((!target.parts.state || target.parts.state === 'AR') && parts.state) {
    target.parts.state = parts.state;
    target.stateSource = candidate.source;
  }
  if (!target.parts.zip && parts.zip) {
    target.parts.zip = parts.zip;
    target.zipSource = candidate.source;
  }
  if ((target.parts.city && !beforeCity) || (target.parts.zip && !beforeZip)) {
    target.rawAddress = candidate.rawAddress || target.rawAddress;
    target.parsed = candidate.parsed || target.parsed;
    target.parcelProps = candidate.parcelProps || target.parcelProps;
  }
}

function resolveCheckoutAddressSource(quote = {}) {
  const quoteParcelProps = quote.parcelProperties || quote.selectedParcelProperties || {};
  const parcelFeatureProps = state.parcelFeature?.properties || {};
  const selectedParcelProps = state.selectedParcel?.properties || state.selectedParcelProperties || {};
  const pendingQuote = state.pendingQuote || {};
  const props =
    quote.parcelProperties ||
    state.parcelFeature?.properties ||
    state.selectedParcel?.properties ||
    {};
  const parcelFeatureRaw = parcelFullAddressFromProps(parcelFeatureProps);
  const selectedRaw = parcelFullAddressFromProps(selectedParcelProps);
  const target = {
    parts: { address: '', city: '', state: '', zip: '' },
    addressSource: '',
    citySource: '',
    stateSource: '',
    zipSource: '',
    rawAddress: '',
    parsed: {},
    parcelProps: quoteParcelProps || parcelFeatureProps || selectedParcelProps || {},
  };

  const adrlabel = firstTextValue(
    quote.parcelAddressLabel,
    props?.adrlabel,
    props?.full_address,
    props?.site_address,
    parcelFullAddressFromProps(props),
    parcelFullAddressFromProps(quoteParcelProps),
    parcelFeatureRaw,
    selectedRaw
  );
  let parsedParcelLabel = { city: '', state: '', zip: '' };
  const missingParcelCity = !firstTextValue(quote.parcelCity);
  const missingParcelZip = !firstTextValue(quote.parcelZip);
  if (adrlabel && (missingParcelCity || missingParcelZip)) {
    const parsed = parseCityStateZipFromAddress(adrlabel);
    parsedParcelLabel = { city: parsed.city || '', state: parsed.state || '', zip: parsed.zip || '' };
  }
  const quoteParcelRaw = adrlabel;
  const parsedQuoteParcelRaw = parseFullServiceAddress(quoteParcelRaw);
  const propsParts = addressPartsFromParcelProps(props);
  const parcelFeatureParts = addressPartsFromParcelProps(parcelFeatureProps);
  const selectedParcelParts = addressPartsFromParcelProps(selectedParcelProps);
  const parcelFieldParts = {
    address: firstTextValue(propsParts.address, parsedQuoteParcelRaw.address, quoteParcelRaw),
    city: firstTextValue(quote.parcelCity, propsParts.city, parcelFeatureParts.city, selectedParcelParts.city, parsedParcelLabel.city),
    state: firstTextValue(quote.parcelState, propsParts.state, parcelFeatureParts.state, selectedParcelParts.state, parsedParcelLabel.state),
    zip: firstTextValue(quote.parcelZip, propsParts.zip, parcelFeatureParts.zip, selectedParcelParts.zip, parsedParcelLabel.zip),
  };
  console.log('[FINAL PARCEL RESOLVE]', {
    adrlabel,
    parsed: parsedParcelLabel,
    final: { city: parcelFieldParts.city, state: parcelFieldParts.state, zip: parcelFieldParts.zip },
  });
  mergeAddressResolution(target, {
    source: 'quote.parcelFields',
    rawAddress: quoteParcelRaw,
    parsed: parsedParcelLabel,
    parcelProps: props,
    parts: parcelFieldParts,
  });

  const parsedQuoteLabel = parseFullServiceAddress(quoteParcelRaw);
  mergeAddressResolution(target, {
    source: 'quote.parcelAddressLabel',
    rawAddress: quoteParcelRaw,
    parsed: parsedQuoteLabel,
    parcelProps: quoteParcelProps,
    parts: parsedQuoteLabel,
  });

  const parsedFeatureLabel = parseFullServiceAddress(parcelFeatureRaw);
  mergeAddressResolution(target, {
    source: 'state.parcelFeature.properties.adrlabel',
    rawAddress: parcelFeatureRaw,
    parsed: parsedFeatureLabel,
    parcelProps: parcelFeatureProps,
    parts: parsedFeatureLabel,
  });

  mergeAddressResolution(target, {
    source: 'state.parcelFeature.properties',
    rawAddress: parcelFeatureRaw,
    parsed: parsedFeatureLabel,
    parcelProps: parcelFeatureProps,
    parts: addressPartsFromParcelProps(parcelFeatureProps),
  });

  const parsedSelected = parseFullServiceAddress(selectedRaw);
  mergeAddressResolution(target, {
    source: 'state.selectedParcel.properties',
    rawAddress: selectedRaw,
    parsed: parsedSelected,
    parcelProps: selectedParcelProps,
    parts: addressPartsFromParcelProps(selectedParcelProps),
  });

  const currentRaw = firstTextValue(state.currentServiceAddress?.address);
  const parsedCurrent = parseFullServiceAddress(currentRaw);
  mergeAddressResolution(target, {
    source: 'state.currentServiceAddress',
    rawAddress: currentRaw,
    parsed: parsedCurrent,
    parcelProps: target.parcelProps,
    parts: state.currentServiceAddress || {},
  });

  const quoteRaw = firstTextValue(quote.address, quote.serviceAddress, quote.customerAddress);
  const parsedQuote = parseFullServiceAddress(quoteRaw);
  mergeAddressResolution(target, {
    source: 'quote.addressFields',
    rawAddress: quoteRaw,
    parsed: parsedQuote,
    parcelProps: target.parcelProps,
    parts: {
      address: quoteRaw,
      city: firstTextValue(quote.city, quote.serviceCity, quote.customerCity, parsedQuote.city),
      state: firstTextValue(quote.state, quote.serviceState, quote.customerState, parsedQuote.state),
      zip: firstTextValue(quote.zip, quote.serviceZip, quote.customerZip, parsedQuote.zip),
    },
  });

  const pendingRaw = firstTextValue(pendingQuote.address, pendingQuote.serviceAddress);
  const parsedPending = parseFullServiceAddress(pendingRaw);
  mergeAddressResolution(target, {
    source: 'pendingQuote',
    rawAddress: pendingRaw,
    parsed: parsedPending,
    parcelProps: target.parcelProps,
    parts: {
      address: pendingRaw,
      city: firstTextValue(pendingQuote.city, pendingQuote.serviceCity, parsedPending.city),
      state: firstTextValue(pendingQuote.state, pendingQuote.serviceState, parsedPending.state),
      zip: firstTextValue(pendingQuote.zip, pendingQuote.serviceZip, parsedPending.zip),
    },
  });

  target.parts = normalizeServiceAddressParts(target.parts);
  const cityZipSource = target.citySource || target.zipSource;
  const source = cityZipSource || (target.addressSource === 'pendingQuote' ? 'pendingQuote-address-only' : target.addressSource || 'none');
  return {
    source,
    rawAddress: target.rawAddress || quoteParcelRaw || parcelFeatureRaw || selectedRaw || currentRaw || quoteRaw || pendingRaw,
    parsed: target.parsed || {},
    parcelProps: target.parcelProps || {},
    parts: target.parts,
  };
}

function fillBlankCheckoutAddressParts(elements, parts) {
  // Deprecated no-op. applyServiceAddressToLeadForm() is the single lead address writer.
}

function hydrateCheckoutAddressFieldsFromQuote(quote) {
  // Deprecated: keep for older callers, but do not write lead address fields here.
  // The single writer is applyServiceAddressToLeadForm().
  const resolvedSource = resolveCheckoutAddressSource(quote || {});
  const resolved = resolvedSource.parts;

  console.log('[Checkout Address Source]', {
    source: resolvedSource.source,
    rawAddress: resolvedSource.rawAddress,
    parsed: resolvedSource.parsed,
    parcelProps: resolvedSource.parcelProps,
  });

  if (resolved.address || resolved.city || resolved.zip) {
    setCurrentServiceAddress(resolved, 'deprecated-checkout-hydrate');
  }

  console.log('[Checkout Address Hydrate]', {
    currentServiceAddress: state.currentServiceAddress,
    quote,
    parcelProps: state.parcelFeature?.properties || state.selectedParcel?.properties,
  });
}

function hydrateLeadFormFromQuoteContext(quote) {
  if (!quote) return;

  // Deprecated: keep for older callers, but do not write lead address fields here.
  // The single writer is applyServiceAddressToLeadForm().
  // Robust selectors — falls back through known IDs then name attributes
  const cityEl =
    document.getElementById('leadCity') ||
    document.getElementById('customerCity') ||
    document.querySelector('[name="city"]') ||
    document.querySelector('[name="customerCity"]');
  const stateEl =
    document.getElementById('leadState') ||
    document.getElementById('customerState') ||
    document.querySelector('[name="state"]') ||
    document.querySelector('[name="customerState"]');
  const zipEl =
    document.getElementById('leadZip') ||
    document.getElementById('customerZip') ||
    document.querySelector('[name="zip"]') ||
    document.querySelector('[name="postalCode"]') ||
    document.querySelector('[name="customerZip"]');
  const addressEl =
    document.getElementById('leadAddress') ||
    document.querySelector('[name="address"]');

  // If none of the target fields exist, the form isn't in the DOM yet; bail silently.
  if (!addressEl && !cityEl && !stateEl && !zipEl) return;

  const resolvedSource = resolveCheckoutAddressSource(quote || {});
  const src = resolvedSource.parts;
  const source = resolvedSource.source;

  console.log('[Quote Hydrate Debug]', {
    fieldIds: { city: cityEl?.id, state: stateEl?.id, zip: zipEl?.id, address: addressEl?.id },
    fieldNames: { city: cityEl?.name, state: stateEl?.name, zip: zipEl?.name, address: addressEl?.name },
    quote,
    currentServiceAddress: state.currentServiceAddress,
    parcelProps: state.parcelFeature?.properties || state.selectedParcel?.properties,
    addressInput: document.getElementById('addressInput')?.value,
  });
  console.log('[Checkout Address Source]', {
    source,
    rawAddress: resolvedSource.rawAddress,
    parsed: resolvedSource.parsed,
    parcelProps: resolvedSource.parcelProps,
  });

  if (src.address || src.city || src.zip) setCurrentServiceAddress(src, 'deprecated-quote-context');

  console.info('[Quote Hydrate] resolved city=' + (src.city || '(empty)') + ' state=' + src.state + ' zip=' + (src.zip || '(empty)') + ' source=' + source);
}

function clearFrontendSessionState() {
  state.currentUser = null;
  localStorage.removeItem('turflynk.authToken');
  updateSessionStatus(null);
  if (typeof applyRoleVisibility === 'function') applyRoleVisibility();
  const authResult = byId('authResult');
  if (authResult) authResult.classList.add('hidden');
  updateQuoteFlowState?.();
}

async function signOut() {
  try {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch (error) {
    console.warn('Logout request failed; clearing local session anyway.', error);
  }
  clearFrontendSessionState();
  clearAuthReturnContext();
  closeAppDrawer?.();
  toggleAuthPanel?.(false);
  showSuccess('Signed out');
}

// money() → public/js/utils/dom.js

const ESTIMATE_DEBOUNCE_MS = 350;
const AUTH_RETURN_KEY = 'turflynk.authReturn.v1';
let estimateRefreshTimer = null;
let estimateRequestSeq = 0;

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

function aiPhotoPlaceholder(overrides = {}) {
  return { ...AI_PHOTO_PLACEHOLDER, ...overrides };
}

function buildQuotePayload(form) {
  const payload = formToObject(form);
  const _formMowArea = Number(payload.mowAreaSqft || 0);
  const drawnMowAreaSqft = currentDrawnMowAreaSqFt();
  const _dbgLot = Number(form?.elements?.lotAreaSqft?.value || 0);
  const _dbgLayers = getMowableFeatureCount();
  const _pct = _dbgLot > 0 ? Math.round((drawnMowAreaSqft / _dbgLot) * 100) : null;
  const _mismatch = _formMowArea > 0 && Math.abs(_formMowArea - drawnMowAreaSqft) > 50;
  console.log('[TurfLynk Area Trace] C. buildQuotePayload | formField=' + _formMowArea + ' drawGroup=' + drawnMowAreaSqft + ' lotAreaSqft=' + _dbgLot + (_pct !== null ? ' (' + _pct + '% of parcel)' : '') + ' layers=' + _dbgLayers + (_mismatch ? ' ⚠ MISMATCH' : '') + ' source=' + (drawnMowAreaSqft > 0 ? 'drawGroup' : 'none(no polygon)'));
  payload.mowAreaSqft = drawnMowAreaSqft > 0 ? drawnMowAreaSqft : 0;
  payload.areaSqft = payload.mowAreaSqft;
  if (form?.elements?.mowAreaSqft) form.elements.mowAreaSqft.value = payload.mowAreaSqft || '';
  if (form?.elements?.customerAdjustedMowableSqft) {
    form.elements.customerAdjustedMowableSqft.value = payload.mowAreaSqft || '';
  }
  payload.quote_type = state.serviceFlow || 'instant_mow';
  payload.quoteType = payload.quote_type;
  payload.selected_yard_areas = checkedValues('selected_yard_areas', form);
  payload.selectedYardAreas = payload.selected_yard_areas;
  payload.requested_tasks = checkedValues('requested_tasks', form);
  payload.requestedTasks = payload.requested_tasks;
  payload.obstacles_list = checkedValues('obstacles_list', form);
  payload.available_days_json = checkedValues('available_days_json', form);
  payload.availableDays = payload.available_days_json;
  payload.gate_size_category = payload.gate_size_category || payload.gate_access_type || '';
  payload.yard_access_notes = payload.yard_access_notes || payload.access_notes || '';
  payload.community_access_private = Boolean(payload.community_access_instructions);
  payload.pets = payload.pets || 'none';
  payload.obstacles = Boolean(payload.obstacles || payload.obstacles_list.length);
  payload.included_tasks_json = INCLUDED_MOW_TASKS;
  payload.excluded_tasks_json = EXCLUDED_MOW_TASKS;
  payload.scope_locked = Boolean(payload.standardMowScopeAck);
  payload.final_price = Number(payload.estimate || payload.final_price || 0);
  payload.status = payload.status || 'estimate_ready';
  const parcelProps = checkoutParcelProps();
  const parcelParts = addressPartsFromParcelProps(parcelProps);
  const parcelAddressLabel = parcelFullAddressFromProps(parcelProps);
  if (Object.keys(parcelProps).length) {
    const serviceAddress = resolveServiceAddressFromParcel(parcelProps, getQuoteFormServiceAddress());
    if (hasServiceAddress(serviceAddress)) setCurrentServiceAddress(serviceAddress, 'build-quote-payload');
    payload.parcelAddressLabel = parcelAddressLabel;
    payload.parcelCity = parcelParts.city || '';
    payload.parcelState = parcelParts.state || 'AR';
    payload.parcelZip = parcelParts.zip || '';
    payload.parcelProperties = parcelProps;
    payload.selectedParcelProperties = parcelProps;
  }
  const serviceAddress = getCurrentServiceAddress(payload);
  if (hasServiceAddress(serviceAddress)) {
    setCurrentServiceAddress(serviceAddress, 'build-quote-payload-final');
    payload.street = state.currentServiceAddress.street || state.currentServiceAddress.address || '';
    payload.address = state.currentServiceAddress.street || state.currentServiceAddress.address || payload.address || '';
    payload.city = state.currentServiceAddress.city || payload.city || '';
    payload.state = state.currentServiceAddress.state || payload.state || 'AR';
    payload.zip = state.currentServiceAddress.zip || payload.zip || '';
    payload.full = state.currentServiceAddress.full || payload.full || '';
  }
  return payload;
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
  if (gate === 'wide_48') return 'Recommended equipment: smaller walk-behind; verify before dispatch. Large zero-turn access: unlikely.';
  if (gate === 'double_60_plus') return 'Recommended equipment: larger decks may fit; provider should verify gate and turns.';
  if (gate === 'not_sure') return 'Recommended equipment: small-gate capable mower or request gate photo/confirmation.';
  if (gate === 'other_size') return 'Recommended equipment: verify custom gate width before dispatch.';
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

// showResult, showToast, showSuccess/Error/Warning/Info, card, escapeHtml → public/js/utils/dom.js

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

// state, QUOTE_STEP_ORDER → public/js/state.js

function normalizeQuoteStep(step) {
  if (step === 'start' || step === 'parcel') return 'property';
  return QUOTE_STEP_ORDER.includes(step) ? step : 'property';
}

function quoteStepNumber(step = state.quoteFlowStep) {
  return Math.max(1, QUOTE_STEP_ORDER.indexOf(normalizeQuoteStep(step)) + 1);
}

function setMapGestureCapture(enabled) {
  if (!state.map) return;
  ['dragPan', 'scrollZoom', 'boxZoom', 'keyboard', 'doubleClickZoom', 'dragRotate'].forEach((key) => {
    const control = state.map[key];
    if (!control) return;
    try {
      if (enabled && typeof control.enable === 'function') control.enable();
      if (!enabled && typeof control.disable === 'function') control.disable();
    } catch {}
  });
}

const MAP_MODES = new Set(['idle', 'lasso', 'select', 'edit', 'pan']);

function setMapMode(mode = 'idle') {
  const nextMode = MAP_MODES.has(mode) ? mode : 'idle';
  state.mapMode = nextMode;
  document.body.dataset.mapMode = nextMode;
  return nextMode;
}

function getMapMode() {
  return MAP_MODES.has(state.mapMode) ? state.mapMode : 'idle';
}

const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_TILE_ATTRIBUTION = 'Tiles Esri';
const EMPTY_FEATURE_COLLECTION = () => ({ type: 'FeatureCollection', features: [] });
const MAP_SOURCES = {
  parcel: 'parcel-source',
  mowable: 'mowable-source',
  building: 'building-footprint-source',
  cutout: 'cutout-source',
  lasso: 'lasso-temp-source',
  previewParcel: 'preview-parcel-source',
  addressMarker: 'address-marker-source',
  gpsMarker: 'gps-marker-source',
};

function latLngToLngLat(center = DEFAULT_MAP_CENTER) {
  return [Number(center[1]), Number(center[0])];
}

function cloneFeatureCollection(collection) {
  return {
    type: 'FeatureCollection',
    features: (collection?.features || []).map((feature) => {
      try {
        return JSON.parse(JSON.stringify(feature));
      } catch {
        return feature;
      }
    }),
  };
}

function cloneGeoJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function currentParcelGeoJSON() {
  if (state.parcelFeature) return cloneGeoJson(state.parcelFeature);
  const feature = esriPolygonToGeoJSONFeature(state.parcelGeometry, state.selectedParcelProperties || state.parcelProperties || {});
  return cloneGeoJson(feature);
}

function currentMapScopeSnapshot() {
  if (!state.map) return {};
  const center = state.map.getCenter?.();
  const bounds = state.map.getBounds?.();
  const snapshot = {};
  if (center) {
    snapshot.mapCenter = {
      lng: Number(center.lng ?? center[0]),
      lat: Number(center.lat ?? center[1]),
      zoom: Number(state.map.getZoom?.() || 0) || undefined,
    };
  }
  if (bounds) {
    snapshot.mapBounds = {
      west: Number(bounds.getWest?.() ?? bounds._sw?.lng),
      south: Number(bounds.getSouth?.() ?? bounds._sw?.lat),
      east: Number(bounds.getEast?.() ?? bounds._ne?.lng),
      north: Number(bounds.getNorth?.() ?? bounds._ne?.lat),
    };
  }
  return snapshot;
}

function currentJobScopeSnapshotFields() {
  return {
    parcelGeoJSON: currentParcelGeoJSON(),
    selectedMowableGeoJSON: cloneFeatureCollection(state.mowableFeatureCollection),
    mowableGeoJSON: cloneFeatureCollection(state.mowableFeatureCollection),
    excludedGeoJSON: state.aiCutoutFeatureCollection?.features?.length
      ? cloneFeatureCollection(state.aiCutoutFeatureCollection)
      : null,
    ...currentMapScopeSnapshot(),
  };
}

function asFeature(featureOrGeometry, properties = {}) {
  if (!featureOrGeometry) return null;
  if (featureOrGeometry.type === 'Feature') {
    return {
      ...featureOrGeometry,
      properties: { ...(featureOrGeometry.properties || {}), ...properties },
    };
  }
  if (featureOrGeometry.type && featureOrGeometry.coordinates) {
    return { type: 'Feature', properties, geometry: featureOrGeometry };
  }
  return null;
}

function setSourceData(sourceId, data = EMPTY_FEATURE_COLLECTION()) {
  const source = state.map?.getSource?.(sourceId);
  if (source?.setData) source.setData(data);
}

function updateMowableSource() {
  markSelectedMowableFeature();
  setSourceData(MAP_SOURCES.mowable, state.mowableFeatureCollection || EMPTY_FEATURE_COLLECTION());
}

function updateCutoutSource() {
  setSourceData(MAP_SOURCES.cutout, state.aiCutoutFeatureCollection || EMPTY_FEATURE_COLLECTION());
}

function updateBuildingFootprintSource() {
  setSourceData(MAP_SOURCES.building, state.buildingFootprintFeatureCollection || EMPTY_FEATURE_COLLECTION());
}

function updateParcelSource() {
  setSourceData(MAP_SOURCES.parcel, state.parcelFeature ? {
    type: 'FeatureCollection',
    features: [state.parcelFeature],
  } : EMPTY_FEATURE_COLLECTION());
}

function updatePreviewParcelSource() {
  setSourceData(MAP_SOURCES.previewParcel, state.pendingParcelPreviewFeature ? {
    type: 'FeatureCollection',
    features: [state.pendingParcelPreviewFeature],
  } : EMPTY_FEATURE_COLLECTION());
}

function setLassoTempLine(points = []) {
  const coords = points.map((point) => [point.lng, point.lat]);
  setSourceData(MAP_SOURCES.lasso, coords.length > 1 ? {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    }],
  } : EMPTY_FEATURE_COLLECTION());
}

function setPointSource(sourceId, lng, lat) {
  const hasPoint = Number.isFinite(Number(lng)) && Number.isFinite(Number(lat));
  setSourceData(sourceId, hasPoint ? {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    }],
  } : EMPTY_FEATURE_COLLECTION());
}

function ensureMapLayer(id, config, beforeId) {
  if (state.map.getLayer(id)) return;
  state.map.addLayer({ id, ...config }, beforeId);
}

function ensureMapLibreSourcesAndLayers() {
  if (!state.map || !state.map.isStyleLoaded?.()) return false;
  Object.values(MAP_SOURCES).forEach((id) => {
    if (!state.map.getSource(id)) {
      state.map.addSource(id, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION() });
    }
  });

  ensureMapLayer('parcel-fill', {
    type: 'fill',
    source: MAP_SOURCES.parcel,
    paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.08 },
  });
  ensureMapLayer('parcel-line', {
    type: 'line',
    source: MAP_SOURCES.parcel,
    paint: { 'line-color': '#38bdf8', 'line-width': 3 },
  });
  ensureMapLayer('building-footprint-fill', {
    type: 'fill',
    source: MAP_SOURCES.building,
    paint: { 'fill-color': '#f97316', 'fill-opacity': 0.24 },
  });
  ensureMapLayer('building-footprint-line', {
    type: 'line',
    source: MAP_SOURCES.building,
    paint: { 'line-color': '#f97316', 'line-width': 2 },
  });
  ensureMapLayer('mowable-fill', {
    type: 'fill',
    source: MAP_SOURCES.mowable,
    paint: {
      'fill-color': ['case', ['boolean', ['get', 'selected'], false], '#22c55e', '#16a34a'],
      'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.36, 0.22],
    },
  });
  ensureMapLayer('mowable-line', {
    type: 'line',
    source: MAP_SOURCES.mowable,
    paint: {
      'line-color': ['case', ['boolean', ['get', 'selected'], false], '#facc15', '#16a34a'],
      'line-width': ['case', ['boolean', ['get', 'selected'], false], 5, 3],
    },
  });
  ensureMapLayer('cutout-fill', {
    type: 'fill',
    source: MAP_SOURCES.cutout,
    paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 },
  });
  ensureMapLayer('cutout-line', {
    type: 'line',
    source: MAP_SOURCES.cutout,
    paint: { 'line-color': '#ef4444', 'line-width': 3 },
  });
  ensureMapLayer('preview-parcel-fill', {
    type: 'fill',
    source: MAP_SOURCES.previewParcel,
    paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.15 },
  });
  ensureMapLayer('preview-parcel-line', {
    type: 'line',
    source: MAP_SOURCES.previewParcel,
    paint: { 'line-color': '#f59e0b', 'line-width': 3 },
  });
  ensureMapLayer('lasso-temp-line', {
    type: 'line',
    source: MAP_SOURCES.lasso,
    paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-opacity': 0.9 },
  });
  ensureMapLayer('address-marker', {
    type: 'circle',
    source: MAP_SOURCES.addressMarker,
    paint: {
      'circle-radius': 7,
      'circle-color': '#2563eb',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
  ensureMapLayer('gps-marker', {
    type: 'circle',
    source: MAP_SOURCES.gpsMarker,
    paint: {
      'circle-radius': 8,
      'circle-color': '#f59e0b',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });

  updateParcelSource();
  updateMowableSource();
  updateCutoutSource();
  updateBuildingFootprintSource();
  updatePreviewParcelSource();
  setLassoTempLine([]);
  return true;
}

function withMapReady(fn) {
  if (!state.map) return;
  if (ensureMapLibreSourcesAndLayers()) {
    fn();
    return;
  }
  state.map.once('load', () => {
    ensureMapLibreSourcesAndLayers();
    fn();
  });
}

function showQuoteFlowStep(step, options = {}) {
  const nextStep = normalizeQuoteStep(step);
  state.quoteFlowStep = nextStep;
  document.body.dataset.quoteFlowStep = nextStep;
  const manualPanel = byId('manualQuotePanel');
  if (manualPanel) {
    manualPanel.classList.add('hidden');
    manualPanel.hidden = true;
    manualPanel.setAttribute('aria-hidden', 'true');
  }

  $$('[data-quote-step-panel]').forEach((panel) => {
    const active = panel.dataset.quoteStepPanel === nextStep;
    panel.classList.toggle('is-active', active);
    panel.classList.toggle('is-hidden', !active);
    panel.classList.toggle('hidden', !active);
    panel.hidden = !active;
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
  updateQuoteFlowState({ skipStepper: true });

  if (nextStep === 'estimate') {
    scheduleEstimateRefresh('estimate-step', { immediate: true });
  }

  if (options.scroll !== false) {
    const activePanel = document.querySelector(`[data-quote-step-panel="${nextStep}"]`);
    activePanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function normalizeRegion(region) {
  return {
    ...region,
    id: region.id,
    label: region.label || region.name || region.id || 'Region',
    name: region.name || region.label || region.id || 'Region',
    enabled: region.enabled ?? region.active ?? true,
    featuredCities: Array.isArray(region.featuredCities) ? region.featuredCities : [],
    counties: Array.isArray(region.counties) ? region.counties : [],
    metro: region.metro || '',
    marketMultiplier: Number(region.marketMultiplier ?? 1),
    travelFee: Number(region.travelFee ?? 0),
    minimumJob: Number(region.minimumJob ?? 0),
  };
}

function normalizeService(service) {
  return {
    ...service,
    id: service.id,
    label: service.label || service.name || service.id || 'Service',
    name: service.name || service.label || service.id || 'Service',
    baseFee: Number(service.baseFee ?? 0),
    ratePer1000Sqft: Number(service.ratePer1000Sqft ?? 0),
    minimumPrice: Number(service.minimumPrice ?? 0),
  };
}

function regionLabel(regionId) {
  return state.regions.find((item) => item.id === regionId)?.label || regionId || 'Unassigned';
}

function serviceLabel(serviceId) {
  return state.services.find((item) => item.id === serviceId)?.label || serviceId || 'Service';
}

function fillSelect(select, items, includeBlank = false) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';

  if (includeBlank) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select...';
    select.append(blank);
  }

  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label || item.name || item.id;
    select.append(option);
  });

  if (previous && Array.from(select.options).some((option) => option.value === previous)) {
    select.value = previous;
  }

  if (!select.value && select.options.length) {
    select.selectedIndex = 0;
  }
}

function saveQuoteDraft() {
  const form = byId('quoteForm');
  if (!form) return;
  localStorage.setItem(QUOTE_DRAFT_KEY, JSON.stringify(formToObject(form)));
}

function saveAuthReturnContext(step = 'request', sourceOverride = '') {
  const form = byId('quoteForm');
  const quoteFormData = form ? formToObject(form) : null;
  let quote = state.pendingQuote || state.lastQuote || null;
  if (!quote && form) {
    try {
      quote = buildQuotePayload(form);
    } catch {
      quote = quoteFormData;
    }
  }

  // Capture customer fields the user already typed in the request form
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

  // Capture drawn mowable GeoJSON so the polygon can be restored on return
  const drawnGeoJSON = (state.mowableFeatureCollection?.features?.length > 0)
    ? cloneFeatureCollection(state.mowableFeatureCollection)
    : null;

  // Capture parcel GeoJSON so scope snapshot includes parcel after auth redirect
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
  } catch {
    localStorage.removeItem(AUTH_RETURN_KEY);
    return null;
  }
}

function clearAuthReturnContext() {
  localStorage.removeItem(AUTH_RETURN_KEY);
}

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
  const params = new URLSearchParams({
    source,
    step,
  });
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
  saveQuoteDraft();
  saveAuthReturnContext(currentStep, currentSource);
  const route = facebookAuthStartPath(currentSource, currentStep);
  console.info(`[Facebook Login] mobile=${mobile}`);
  console.info(`[Facebook Login] redirect=${route}`);
  window.location.href = route;
}

function beginSocialAuth(provider, step = 'request') {
  if (provider === 'google' && !GOOGLE_LOGIN_ENABLED) {
    showWarning('Google sign-in is not available yet. Please use Facebook or email.');
    return;
  }
  saveQuoteDraft();
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

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error('No Google Maps API key'));

    if (window.google?.maps?.places) {
      return resolve();
    }

    const existing = document.querySelector('script[data-google-maps-loader="true"]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.dataset.googleMapsLoader = 'true';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
}

function loadQuoteDraft() {
  try {
    return JSON.parse(localStorage.getItem(QUOTE_DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearQuoteDraft() {
  localStorage.removeItem(QUOTE_DRAFT_KEY);
}

function setEditorModeLabel(text) {
  const el = byId('mowEditorMode');
  if (!el) return;
  el.textContent = text;
}

function placeMarker(lat, lng) {
  if (!state.map) return;
  state.marker = { lat: Number(lat), lng: Number(lng) };
  withMapReady(() => setPointSource(MAP_SOURCES.addressMarker, lng, lat));
  state.map.flyTo({ center: [Number(lng), Number(lat)], zoom: 15, essential: true });
  setTimeout(() => state.map?.resize?.(), 100);
}

function placeCurrentLocationMarker(lat, lng) {
  if (!state.map) return;
  state.gpsMarker = { lat: Number(lat), lng: Number(lng) };
  withMapReady(() => setPointSource(MAP_SOURCES.gpsMarker, lng, lat));
  state.map.flyTo({ center: [Number(lng), Number(lat)], zoom: Math.max(state.map.getZoom() || 15, 17), essential: true });
  setTimeout(() => state.map?.resize?.(), 100);
}

function setLatLng(lat, lng) {
  const form = byId('quoteForm');
  if (!form) return;
  form.elements.lat.value = Number(lat).toFixed(6);
  form.elements.lng.value = Number(lng).toFixed(6);
  saveQuoteDraft();
}

function normalizeServiceAddressParts(parts = {}) {
  const clean = (value) => {
    const text = String(value || '').trim();
    return /^n\/?a$/i.test(text) ? '' : text;
  };
  const street = clean(parts.street || parts.address);
  const address = street;
  const city = clean(parts.city);
  const stateValue = clean(parts.state);
  const zip = clean(parts.zip);
  const full = clean(parts.full || parts.formattedAddress || parts.formatted_address);
  return {
    street,
    address,
    city,
    state: stateValue || 'AR',
    zip,
    full,
  };
}

function parseCityStateZipFromAddress(str = '') {
  const empty = { city: '', state: '', zip: '' };
  if (!str) return empty;

  const cleaned = String(str).replace(/\s+/g, ' ').trim();

  // Match: CITY, ST ZIP
  let match = cleaned.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/i);

  if (!match) {
    // Match: CITY ST ZIP (no commas)
    match = cleaned.match(/\b([A-Za-z\s]+)\s+([A-Z]{2})\s+(\d{5})$/);
  }

  if (match) {
    const result = {
      city: match[1].trim(),
      state: match[2].trim().toUpperCase(),
      zip: match[3].trim()
    };

    console.log('[PARSE TEST]', {
      input: str,
      result
    });

    return result;
  }

  console.warn('[Address Parse Failed]', str);
  console.log('[PARSE TEST]', {
    input: str,
    result: empty
  });

  return empty;
}

function hasServiceAddress(parts = {}) {
  return Boolean(String(parts.street || parts.address || parts.city || parts.zip || parts.full || '').trim());
}

function serviceAddressBlocksFallback(parts = {}) {
  return ['gps-location', 'manual-parcel-selection', 'parcel-no-address', 'quote-reset', 'address-reset']
    .includes(parts.source || '');
}

function getQuoteFormServiceAddress() {
  const form = byId('quoteForm');
  if (!form) return normalizeServiceAddressParts();
  return normalizeServiceAddressParts({
    street: form.elements.address?.value || '',
    address: form.elements.address?.value || '',
    city: form.elements.city?.value || '',
    state: form.elements.state?.value || 'AR',
    zip: form.elements.zip?.value || '',
  });
}

function parcelAddressFromNormalized(normalized = {}) {
  return addressPartsFromParcelProps({
    ...(normalized.attributes || {}),
    address: normalized.address || '',
    city: normalized.city || '',
    zip: normalized.zip || '',
  });
}

function applyServiceAddressToQuoteForm(address, options = {}) {
  const form = byId('quoteForm');
  if (!form) return;
  const next = normalizeServiceAddressParts(address);
  const clearMissing = Boolean(options.clearMissing);
  ['address', 'city', 'state', 'zip'].forEach((name) => {
    const field = form.elements[name];
    if (!field) return;
    if (next[name] || clearMissing || name === 'state') field.value = next[name] || (name === 'state' ? 'AR' : '');
  });
}

function clearStaleServiceAddressFields() {
  // Deprecated: do not clear lead address fields. currentServiceAddress is the source of truth.
  const liveBidForm = byId('liveBidForm');
  if (liveBidForm) {
    ['address', 'city', 'state', 'zip'].forEach((name) => {
      const field = liveBidForm.elements[name];
      if (!field) return;
      field.value = name === 'state' ? 'AR' : '';
    });
  }
}

function setCurrentServiceAddress(address, source = 'unknown', options = {}) {
  const next = normalizeServiceAddressParts(address);
  const incoming = Object.fromEntries(
    Object.entries({
      street: next.street,
      address: next.street,
      city: next.city,
      state: next.state,
      zip: next.zip,
      full: next.full,
    }).filter(([, value]) => value)
  );
  const hasIncoming = Object.keys(incoming).some((key) => key !== 'state' || incoming[key] !== 'AR');
  if (!hasIncoming && ['quote-reset', 'address-reset', 'gps-location'].includes(source)) {
    state.currentServiceAddress = { street: '', address: '', city: '', state: 'AR', zip: '', full: '', source, updatedAt: Date.now() };
  } else {
    state.currentServiceAddress = {
      ...(state.currentServiceAddress || {}),
      ...incoming,
      source,
      updatedAt: Date.now(),
    };
  }
  console.log('[Service Address] set', source, state.currentServiceAddress);
  if (options.syncQuoteForm) {
    applyServiceAddressToQuoteForm(state.currentServiceAddress, { clearMissing: options.clearQuoteFormMissing });
  }
  return normalizeServiceAddressParts(state.currentServiceAddress);
}

function getCurrentServiceAddress(fallback = {}) {
  const current = normalizeServiceAddressParts(state.currentServiceAddress || {});
  if (hasServiceAddress(current)) return current;
  if (serviceAddressBlocksFallback(state.currentServiceAddress || {})) return current;

  const formAddress = getQuoteFormServiceAddress();
  if (hasServiceAddress(formAddress)) return formAddress;

  return normalizeServiceAddressParts(fallback);
}

function syncServiceAddressFields(fallback = {}) {
  // Deprecated: this used to write lead address fields directly.
  // Keep it as a state resolver only; applyServiceAddressToLeadForm() is the single writer.
  const next = getCurrentServiceAddress(fallback);
  if (hasServiceAddress(next)) setCurrentServiceAddress(next, 'deprecated-sync-service-address');
  const liveBidForm = byId('liveBidForm');
  if (liveBidForm) {
    ['address', 'city', 'state', 'zip'].forEach((name) => {
      const field = liveBidForm.elements[name];
      if (!field) return;
      if (next[name]) {
        field.value = next[name];
      } else if (name === 'state' && !field.value) {
        field.value = 'AR';
      }
    });
  }
  return next;
}

function applyServiceAddressToLeadForm(address = state.currentServiceAddress) {
  const next = normalizeServiceAddressParts(address || {});
  const addressEl = document.getElementById('leadAddress');
  const cityEl = document.getElementById('leadCity');
  const stateEl = document.getElementById('leadState');
  const zipEl = document.getElementById('leadZip');

  if (addressEl && next.street) addressEl.value = next.street;
  if (cityEl && next.city) cityEl.value = next.city;
  if (stateEl && next.state) stateEl.value = next.state;
  if (zipEl && next.zip) zipEl.value = next.zip;

  console.log('[Service Address] applied to lead form', {
    address: addressEl?.value,
    city: cityEl?.value,
    state: stateEl?.value,
    zip: zipEl?.value
  });
}

function snapshotMowLayersForUndo() {
  const features = cloneFeatureCollection(state.mowableFeatureCollection).features;

  state.mowUndoStack = state.mowUndoStack || [];
  state.mowUndoStack.push(features);

  // keep it light
  if (state.mowUndoStack.length > 10) {
    state.mowUndoStack.shift();
  }
}

function restoreMowLayersFromSnapshot(features) {
  if (!Array.isArray(features)) return;
  setMowableFeatures(features);

  syncMowAreaFromLayers();
  setTimeout(() => {
    startEditMowable();
  }, 0);
}

function undoLastCut() {
  const stack = state.mowUndoStack || [];

  if (!stack.length) {
    showResult('parcelInfo', '<strong>Nothing to undo.</strong>');
    return;
  }

  const last = stack.pop();
  restoreMowLayersFromSnapshot(last);

  showResult('parcelInfo', '<strong>Last cut undone.</strong>');
}

function clearParcelLayer() {
  state.parcelFeature = null;
  state.parcelLayer = null;
  state.parcelProperties = null;
  state.selectedParcel = null;
  state.selectedParcelProperties = null;
  state.buildingFootprintFeatureCollection = EMPTY_FEATURE_COLLECTION();
  updateParcelSource();
  updateBuildingFootprintSource();
  state.parcelLayer = null;
  state.parcelGeometry = null;
  state.mowableEstimate = null;
  renderSuggestedMowablePanel(null);
}

function setMowableFeatures(features = []) {
  const previousSelectedId = state.selectedMowableFeatureId;
  state.mowableFeatureCollection = {
    type: 'FeatureCollection',
    features: features.map((feature, index) => {
      const normalized = asFeature(feature);
      if (!normalized) return null;
      const id = normalized.id || normalized.properties?.id || `mowable-${index}-${Date.now()}`;
      return {
        ...normalized,
        id,
        properties: {
          ...(normalized.properties || {}),
          id,
          role: 'mowable',
        },
      };
    }).filter((feature) => feature?.geometry),
  };
  if (previousSelectedId && !state.mowableFeatureCollection.features.some((feature) => String(feature.id || feature.properties?.id) === String(previousSelectedId))) {
    state.selectedMowableFeatureId = null;
  }
  state.drawGroup = state.mowableFeatureCollection;
  window.mowableFeatureCollection = state.mowableFeatureCollection;
  updateMowableSource();
}

function clearMowableFeatures() {
  state.selectedMowableFeatureId = null;
  setMowableFeatures([]);
}

function setCutoutFeatures(features = []) {
  state.aiCutoutFeatureCollection = {
    type: 'FeatureCollection',
    features: features.map((feature, index) => {
      const normalized = asFeature(feature);
      if (!normalized) return null;
      return {
        ...normalized,
        id: normalized.id || `cutout-${index}-${Date.now()}`,
        properties: {
          ...(normalized.properties || {}),
          role: 'cutout',
        },
      };
    }).filter((feature) => feature?.geometry),
  };
  state.aiCutoutGroup = state.aiCutoutFeatureCollection;
  updateCutoutSource();
}

function clearCutoutFeatures() {
  setCutoutFeatures([]);
}

function getMowableFeatureCount() {
  return state.mowableFeatureCollection?.features?.length || 0;
}

function mowableFeatureId(feature) {
  return feature?.id || feature?.properties?.id || '';
}

function markSelectedMowableFeature() {
  const selectedId = state.selectedMowableFeatureId ? String(state.selectedMowableFeatureId) : '';
  (state.mowableFeatureCollection?.features || []).forEach((feature) => {
    feature.properties = feature.properties || {};
    feature.properties.selected = Boolean(selectedId && String(mowableFeatureId(feature)) === selectedId);
  });
}

function selectMowableFeature(featureId) {
  state.selectedMowableFeatureId = featureId ? String(featureId) : null;
  markSelectedMowableFeature();
  updateMowableSource();
  updateQuoteFlowState();
  if (featureId) setEditorModeLabel('Mode: Area selected');
}

function removeSelectedMowableFeature() {
  const selectedId = state.selectedMowableFeatureId ? String(state.selectedMowableFeatureId) : '';
  if (!selectedId) return false;
  const features = getAllMowLayers().filter((feature) => String(mowableFeatureId(feature)) !== selectedId);
  if (features.length === getMowableFeatureCount()) return false;
  state.selectedMowableFeatureId = null;
  setMowableFeatures(features);
  syncMowAreaFromLayers();
  return true;
}

function getCutoutFeatureCount() {
  return state.aiCutoutFeatureCollection?.features?.length || 0;
}

function geometryLooksProjected(geometry) {
  const rings = geometry?.rings || geometry?.coordinates || [];
  const firstRing = rings.find((ring) => Array.isArray(ring) && ring.length);
  const firstPoint = firstRing?.find((pt) => Array.isArray(pt) && pt.length >= 2);
  if (!firstPoint) return false;
  const x = Number(firstPoint[0]);
  const y = Number(firstPoint[1]);
  return Math.abs(x) > 180 || Math.abs(y) > 90;
}

function ringToLngLatCoords(ring, geometry) {
  const projected = geometryLooksProjected(geometry);
  return ring.map(([xRaw, yRaw]) => {
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    if (projected) {
      const [lng, lat] = proj4(EPSG26915, EPSG4326, [x, y]);
      return [lng, lat];
    }

    return [x, y];
  }).filter(Boolean);
}

function closeRing(coords) {
  if (!coords.length) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return coords.concat([[first[0], first[1]]]);
}

function esriPolygonToGeoJSONFeature(geometry, properties = {}) {
  const rings = geometry?.rings || geometry?.coordinates || [];
  const coordinates = rings
    .map((ring) => closeRing(ringToLngLatCoords(ring, geometry)))
    .filter((ring) => ring.length >= 4);
  if (!coordinates.length) return null;
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates },
  };
}

function esriPolygonToLatLngPairs(geometry) {
  const feature = esriPolygonToGeoJSONFeature(geometry);
  return (feature?.geometry?.coordinates || []).map((ring) => ring.map(([lng, lat]) => [lat, lng]));
}

function exposeTurfLynkMapGlobals() {
  if (state.map) window.map = state.map;
  window.mowableFeatureCollection = state.mowableFeatureCollection;
  window.drawnItems = state.mowableFeatureCollection;
  window.mowLayerGroup = state.mowableFeatureCollection;
  if (state.parcelLayer) window.parcelLayer = state.parcelLayer;
}

function exposeCurrentParcelGeometryForAi() {
  // Convert Arkansas GIS ESRI rings into normal GeoJSON Polygon geometry.
  // /api/ai/detect-grass expects GeoJSON lon/lat coordinates.
  try {
    const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
    if (!parcelRings.length) return null;
    const geoJsonGeometry = esriPolygonToGeoJSONFeature(state.parcelGeometry)?.geometry;
    if (!geoJsonGeometry) return null;
    window.currentParcelGeometry = geoJsonGeometry;
    window.parcelGeometry = geoJsonGeometry;
    return geoJsonGeometry;
  } catch (error) {
    console.warn('Could not expose parcel geometry for AI detection', error);
    return null;
  }
}

function exposeTurfLynkQuoteGlobals() {
  // Adapter used by /js/ai-detect-grass.js after it draws returned polygons.
  window.updateMowAreaSqft = function updateMowAreaSqftFromAi(sqft) {
    const form = byId('quoteForm');
    const rounded = Math.round(Number(sqft || 0));

    if (form) {
      form.elements.mowAreaSqft.value = rounded || '';
      if (!form.elements.lotAreaSqft.value && state.parcelLayer) {
        form.elements.lotAreaSqft.value = layerAreaSqFt(state.parcelLayer) || '';
      }
      form.elements.lotSource.value = 'ai_detected';
    }

    updateMowAreaHelper(Number(form?.elements?.lotAreaSqft?.value || 0), rounded);
    saveQuoteDraft();
    scheduleEstimateRefresh('ai-area');
  };
}

function reorderMapOverlays() {
  ensureMapLibreSourcesAndLayers();
}

function fitBoundsWithContext(boundsOrFeature, options = {}) {
  if (!state.map || !boundsOrFeature) return;
  const fitOptions = { ...PARCEL_FIT_OPTIONS, ...options };
  let bounds = boundsOrFeature;
  if (boundsOrFeature.type === 'Feature' || boundsOrFeature.type === 'FeatureCollection' || boundsOrFeature.type === 'Polygon' || boundsOrFeature.type === 'MultiPolygon') {
    try {
      const bbox = turf.bbox(boundsOrFeature);
      if (bbox.some((value) => !Number.isFinite(value))) return;
      bounds = [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
    } catch {
      return;
    }
  }

  state.map.resize?.();
  state.map.fitBounds(bounds, fitOptions);

  setTimeout(() => {
    if (!state.map) return;
    state.map.resize?.();
    state.map.fitBounds(bounds, fitOptions);
  }, 100);
}

function fitLayerBoundsWithContext(layer, options = {}) {
  fitBoundsWithContext(layer, options);
}

function refreshMapAfterStepVisible(reason = 'unknown') {
  if (!state.map) return;

  requestAnimationFrame(() => {
    try { state.map.resize?.(); } catch {}
  });

  setTimeout(() => {
    try {
      state.map.resize?.();

      if (state.parcelFeature || state.parcelLayer) {
        updateParcelSource();
        console.log('[Parcel Layer] render from state source=', reason);
      }
      if (state.mowableFeatureCollection?.features?.length) {
        updateMowableSource();
      }

      const parcel = state.parcelFeature || state.parcelLayer;
      if (parcel) {
        fitLayerBoundsWithContext(parcel);
        console.log('[Map Refresh] fit bounds parcel');
      } else {
        console.log('[Map Refresh] no parcel geometry found');
      }

      console.log('[Map Refresh] complete reason=', reason);
    } catch (err) {
      console.warn('[Map Refresh] failed reason=', reason, err);
    }
  }, 80);
}

function drawParcel(geometry, properties = {}) {
  if (!state.map || !geometry) return;
  const feature = esriPolygonToGeoJSONFeature(geometry, { ...properties, role: 'parcel' });
  if (!feature) {
    console.warn("drawParcel: invalid rings", geometry);
    return;
  }
  // ESRI rings use CW exterior; GeoJSON / MapLibre require CCW exterior.
  // Without this rewind, MapLibre renders the complement (world minus parcel)
  // and turf.intersect gives wrong results.
  try { if (typeof turf !== 'undefined') turf.rewind(feature, { mutate: true }); } catch {}

  state.parcelGeometry = geometry;
  state.parcelFeature = feature;
  state.parcelLayer = feature;
  state.parcelProperties = feature.properties || properties || {};
  state.selectedParcel = feature;
  state.selectedParcelProperties = feature.properties || properties || {};

  withMapReady(() => {
    updateParcelSource();
    fitLayerBoundsWithContext(feature);
    reorderMapOverlays();
    requestAnimationFrame(() => state.map?.resize?.());
  });
}

function formatSqft(value) {
  const n = Math.round(Number(value || 0));
  return n > 0 ? `${n.toLocaleString()} sq ft` : 'n/a';
}

const SQFT_PER_ACRE = 43560;
function sqftToAcres(sqft) { return Math.round(Number(sqft || 0)) / SQFT_PER_ACRE; }
function formatAcres(sqft) { const n = Math.round(Number(sqft || 0)); return n > 0 ? `${sqftToAcres(n).toFixed(2)} acres` : 'n/a'; }

function refreshAreaDisplays(lotSqft, mowSqft) {
  const lotEl = byId('lotAreaAcresDisplay');
  const mowEl = byId('mowAreaAcresDisplay');
  if (lotEl) {
    const n = Math.round(Number(lotSqft || 0));
    lotEl.textContent = n > 0 ? `${sqftToAcres(n).toFixed(2)} acres  ·  ${n.toLocaleString()} sq ft` : '';
  }
  if (mowEl) {
    const n = Math.round(Number(mowSqft || 0));
    mowEl.textContent = n > 0 ? `${sqftToAcres(n).toFixed(2)} acres  ·  ${n.toLocaleString()} sq ft` : '';
  }
}

async function getBuildingFootprintsForParcel(_parcelGeometry) {
  return {
    footprints: [],
    source: 'fallback',
  };
}

function calculateBuildingFootprintSqft(footprints) {
  if (!Array.isArray(footprints) || !footprints.length) return 0;

  return Math.round(footprints.reduce((sum, footprint) => {
    try {
      const feature = footprint?.type === 'Feature'
        ? footprint
        : footprint?.geometry
          ? { type: 'Feature', properties: footprint.properties || {}, geometry: footprint.geometry }
          : null;
      return feature ? sum + turf.area(feature) * 10.7639 : sum;
    } catch {
      return sum;
    }
  }, 0));
}

function fallbackMowableRatio(parcelAreaSqft) {
  if (parcelAreaSqft <= 12000) return 0.65;
  if (parcelAreaSqft <= 30000) return 0.55;
  return 0.35;
}

function calculateAutoMowableEstimate(parcelAreaSqft, buildingFootprintSqft, source = 'building_footprints') {
  const parcelArea = Math.max(0, Math.round(Number(parcelAreaSqft || 0)));
  const footprintArea = Math.max(0, Math.round(Number(buildingFootprintSqft || 0)));

  if (parcelArea <= 0) {
    return {
      parcelAreaSqft: 0,
      buildingFootprintSqft: footprintArea,
      buildingAdjustedSqft: 0,
      estimatedNonMowableSqft: 0,
      autoEstimatedMowableSqft: 0,
      mowableEstimateConfidence: 'low',
      buildingFootprintsSource: 'fallback',
    };
  }

  if (footprintArea > 0) {
    const buildingAdjustedSqft = Math.round(footprintArea * 1.25);
    return {
      parcelAreaSqft: parcelArea,
      buildingFootprintSqft: footprintArea,
      buildingAdjustedSqft,
      estimatedNonMowableSqft: buildingAdjustedSqft,
      autoEstimatedMowableSqft: Math.max(0, parcelArea - buildingAdjustedSqft),
      mowableEstimateConfidence: 'medium',
      buildingFootprintsSource: source || 'building_footprints',
    };
  }

  const autoEstimatedMowableSqft = Math.round(parcelArea * fallbackMowableRatio(parcelArea));
  return {
    parcelAreaSqft: parcelArea,
    buildingFootprintSqft: 0,
    buildingAdjustedSqft: 0,
    estimatedNonMowableSqft: Math.max(0, parcelArea - autoEstimatedMowableSqft),
    autoEstimatedMowableSqft,
    mowableEstimateConfidence: 'low',
    buildingFootprintsSource: 'fallback',
  };
}

function setFormEstimateFields(form, estimate) {
  if (!form || !estimate) return;
  MOWABLE_ESTIMATE_FIELDS.forEach((name) => {
    if (form.elements[name]) form.elements[name].value = estimate[name] ?? '';
  });
}

function applySuggestedMowableArea() {
  const form = byId('quoteForm');
  const estimate = state.mowableEstimate;
  if (!form || !estimate) return;

  setFormEstimateFields(form, estimate);
  form.elements.lotAreaSqft.value = estimate.parcelAreaSqft || '';
  form.elements.mowAreaSqft.value = '';
  if (form.elements.lotSource) form.elements.lotSource.value = 'auto_building_estimate';
  if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = '';

  updateMowAreaHelper(estimate.parcelAreaSqft, 0);
  saveQuoteDraft();
  scheduleEstimateRefresh('suggested-mowable');
  updateQuoteFlowState();
  showWarning('Draw your mowable area first.');
}

function adjustYardOutlineFromSuggestion() {
  if (!getMowableFeatureCount() && state.parcelGeometry) {
    cloneParcelAsMowable();
    return;
  }
  if (getMowableFeatureCount()) startEditMowable();
  else startDrawMowable();
}

function renderSuggestedMowablePanel(estimate) {
  const panel = byId('suggestedMowablePanel');
  if (!panel) return;

  if (!estimate || !estimate.parcelAreaSqft) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  const buildingLine = estimate.buildingFootprintSqft > 0
    ? `<div class="suggested-mowable-metric"><span>Building footprint</span><strong>${formatAcres(estimate.buildingFootprintSqft)}</strong></div>`
    : `<div class="suggested-mowable-metric"><span>Building footprint</span><strong>Not detected</strong></div>`;

  panel.innerHTML = `
    <div>
      <h4>Suggested mowable area</h4>
      <p>We estimated your mowable area from property and building footprint data. Adjust the outline if needed.</p>
    </div>
    <div class="suggested-mowable-grid">
      <div class="suggested-mowable-metric"><span>Parcel size</span><strong>${formatAcres(estimate.parcelAreaSqft)}</strong></div>
      ${buildingLine}
      <div class="suggested-mowable-metric"><span>Suggested mowable</span><strong>${formatAcres(estimate.autoEstimatedMowableSqft)}</strong></div>
      <div class="suggested-mowable-metric"><span>Confidence</span><strong>${escapeHtml(estimate.mowableEstimateConfidence || 'low')}</strong></div>
    </div>
    <div class="suggested-mowable-actions">
      <button class="btn primary small" type="button" id="useSuggestedMowableBtn">Use Suggested Area</button>
      <button class="btn secondary small" type="button" id="adjustYardOutlineBtn">Adjust Yard Outline</button>
    </div>
  `;
  panel.classList.remove('hidden');

  byId('useSuggestedMowableBtn')?.addEventListener('click', applySuggestedMowableArea);
  byId('adjustYardOutlineBtn')?.addEventListener('click', adjustYardOutlineFromSuggestion);
}

function drawBuildingFootprintHelpers(footprints) {
  if (!Array.isArray(footprints)) return;
  state.buildingFootprintFeatureCollection = {
    type: 'FeatureCollection',
    features: footprints.map((footprint) => asFeature(footprint)).filter(Boolean),
  };
  state.buildingFootprintGroup = state.buildingFootprintFeatureCollection;
  updateBuildingFootprintSource();

  reorderMapOverlays();
}

async function updateAutoMowableEstimateForParcel(parcelAreaHint = 0) {
  const form = byId('quoteForm');
  if (!state.parcelGeometry || !form) return null;

  const parcelAreaSqft = Math.round(Number(parcelAreaHint || 0))
    || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : 0);
  const footprintResult = await getBuildingFootprintsForParcel(state.parcelGeometry);
  const footprints = footprintResult?.footprints || [];
  const buildingFootprintSqft = calculateBuildingFootprintSqft(footprints);
  const estimate = calculateAutoMowableEstimate(
    parcelAreaSqft,
    buildingFootprintSqft,
    buildingFootprintSqft > 0 ? (footprintResult?.source || 'building_footprints') : 'fallback'
  );

  state.mowableEstimate = estimate;
  setFormEstimateFields(form, estimate);
  if (!Number(form.elements.lotAreaSqft.value || 0)) form.elements.lotAreaSqft.value = estimate.parcelAreaSqft || '';
  renderSuggestedMowablePanel(estimate);
  drawBuildingFootprintHelpers(footprints);
  return estimate;
}
function styleMowLayer(layer) {
  return asFeature(layer, { role: 'mowable' });
}

function eachLatLng(latlngs, fn) {
  latlngs.forEach((item) => {
    if (Array.isArray(item)) eachLatLng(item, fn);
    else if (item && Number.isFinite(item.lat) && Number.isFinite(item.lng)) fn(item);
  });
}

function translateLayerLatLngs(layer, fromLatLng, toLatLng) {
  if (!state.map || !layer?.getLatLngs || !layer.setLatLngs) return;

  const from = state.map.project(fromLatLng);
  const to = state.map.project(toLatLng);
  const delta = to.subtract(from);
  const latlngs = layer.getLatLngs();

  eachLatLng(latlngs, (latlng) => {
    const point = state.map.project(latlng).add(delta);
    const moved = state.map.unproject(point);
    latlng.lat = moved.lat;
    latlng.lng = moved.lng;
  });

  layer.setLatLngs(latlngs);
}

function attachMowableMoveHandlers(layer) {
  return layer;
}

function finishMowableMove() {
  if (!state.moveDrag) return;
  const moved = state.moveDrag.moved;
  state.moveDrag = null;

  if (moved) {
    syncMowAreaFromLayers();
  }

  setEditorModeLabel('Mode: Editing mowable areas');
}

function eventLatLng(event) {
  if (event?.latlng) return event.latlng;
  const lngLat = event?.lngLat;
  return lngLat ? { lat: lngLat.lat, lng: lngLat.lng } : null;
}

function installMowableMoveMapHandlers() {
  if (!state.map || state._mowMoveHandlersInstalled) return;
  state._mowMoveHandlersInstalled = true;
}

function layerAreaSqFt(feature) {
  if (!feature) return 0;
  try {
    const sqm = turf.area(feature);
    return Math.round(sqm * 10.7639);
  } catch {
    return 0;
  }
}

function clearEditHandles() {
  (state.editMarkers || []).forEach((marker) => {
    try { marker.remove(); } catch {}
  });
  state.editMarkers = [];
}

function getEditableRings(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring, ringIndex) => ({ ring, path: [ringIndex] }));
  }
  if (geometry.type === 'MultiPolygon') {
    const rings = [];
    geometry.coordinates.forEach((polygon, polygonIndex) => {
      polygon.forEach((ring, ringIndex) => rings.push({ ring, path: [polygonIndex, ringIndex] }));
    });
    return rings;
  }
  return [];
}

function getRingByPath(feature, path) {
  if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates[path[0]];
  return feature.geometry.coordinates[path[0]][path[1]];
}

function buildEditHandles() {
  clearEditHandles();
  if (!state.map || typeof maplibregl === 'undefined') return;
  getAllMowLayers().forEach((feature, featureIndex) => {
    getEditableRings(feature).forEach(({ ring, path }) => {
      ring.slice(0, -1).forEach((coord, coordIndex) => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'maplibre-edit-handle';
        handle.setAttribute('aria-label', 'Move vertex');
        const marker = new maplibregl.Marker({ element: handle, draggable: true })
          .setLngLat(coord)
          .addTo(state.map);
        marker.on('drag', () => {
          const next = marker.getLngLat();
          const targetFeature = state.mowableFeatureCollection.features[featureIndex];
          const targetRing = getRingByPath(targetFeature, path);
          targetRing[coordIndex] = [next.lng, next.lat];
          if (coordIndex === 0) targetRing[targetRing.length - 1] = [next.lng, next.lat];
          updateMowableSource();
          updateMowAreaHelper(
            Number(byId('quoteForm')?.elements?.lotAreaSqft?.value || 0),
            currentDrawnMowAreaSqFt()
          );
        });
        marker.on('dragend', () => {
          syncMowAreaFromLayers();
        });
        state.editMarkers.push(marker);
      });
    });
  });
}

function startEditAiCutouts() {
  if (!state.map || !getCutoutFeatureCount()) {
    showResult('parcelInfo', '<strong>No AI cutouts to edit.</strong>');
    return;
  }

  stopToolModes();
  setEditorModeLabel('Mode: Editing AI cutouts');
}

function startCutMowable() {
  if (!state.map || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to cut.</strong>');
    return;
  }

  stopToolModes();
  state.quoteUiMode = 'drawing';
  if (window.TurfLynkLassoYard?.armCut) window.TurfLynkLassoYard.armCut();
  setEditorModeLabel('Mode: Draw area to CUT OUT');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}


function getAllMowLayers() {
  return state.mowableFeatureCollection?.features || [];
}

function totalMowAreaSqFt() {
  return getAllMowLayers().reduce((sum, feature) => sum + layerAreaSqFt(feature), 0);
}

function currentDrawnMowAreaSqFt() {
  return Math.round(totalMowAreaSqFt());
}

function clearStaleMowAreaWithoutPolygon(form = byId('quoteForm')) {
  if (!form || currentDrawnMowAreaSqFt() > 0) return;
  form.elements.mowAreaSqft.value = '';
  if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = '';
  state.pendingQuote = null;
}

function updateMowAreaHelper(parcelSqFt, mowSqFt) {
  refreshAreaDisplays(parcelSqFt, mowSqFt);
  const helper = byId('mowAreaHelper');
  if (!helper) return;

  if (!mowSqFt) {
    helper.textContent = 'Drag around the grass area. Lift your finger to finish.';
    return;
  }

  const pct = parcelSqFt ? Math.round((mowSqFt / parcelSqFt) * 100) : null;
  helper.textContent = `Area selected: ${formatAcres(mowSqFt)}${pct ? ` (${pct}% of parcel)` : ''}. Use Edit or Redraw if needed.`;
}

function syncMowAreaFromLayers() {
  const form = byId('quoteForm');
  if (!form) return;

  const totalSqFt = currentDrawnMowAreaSqFt();
  const _syncLayers = getMowableFeatureCount();
  const _syncLot = Number(form.elements.lotAreaSqft?.value || 0);
  const _syncPct = _syncLot > 0 ? Math.round((totalSqFt / _syncLot) * 100) : null;
  console.log('[TurfLynk Area Trace] B. syncMowAreaFromLayers | mowAreaSqft=' + totalSqFt + ' lotAreaSqft=' + _syncLot + (_syncPct !== null ? ' (' + _syncPct + '% of parcel)' : '') + ' layers=' + _syncLayers + ' source=drawGroup');
  form.elements.mowAreaSqft.value = totalSqFt || '';
  if (form.elements.customerAdjustedMowableSqft) {
    form.elements.customerAdjustedMowableSqft.value = totalSqFt || '';
  }
  if (form.elements.lotSource) {
    form.elements.lotSource.value = 'customer_adjusted_outline';
  }
  state.pendingQuote = null;

  updateMowAreaHelper(
    Number(form.elements.lotAreaSqft.value || 0),
    totalSqFt
  );

  saveQuoteDraft();
  scheduleEstimateRefresh('mow-area-sync');
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
}

function stopToolModes() {
  if (getMapMode() === 'lasso' && window.TurfLynkLassoYard?.cancel) {
    try { window.TurfLynkLassoYard.cancel(); } catch {}
  }

  finishMowableMove();
  clearEditHandles();

  if (state.drawHandler) {
    try { state.drawHandler.disable(); } catch {}
    state.drawHandler = null;
  }
  if (state.editHandler) {
    try { state.editHandler.disable(); } catch {}
    state.editHandler = null;
  }
  if (state.deleteHandler) {
    try { state.deleteHandler.disable(); } catch {}
    state.deleteHandler = null;
  }
  state.quoteUiMode = 'idle';
  if (getMapMode() !== 'select') setMapMode('idle');
  setEditorModeLabel('Mode: Ready');
  updateQuoteFlowState();
}

function clearMowLayer() {
  stopToolModes();
  if (removeSelectedMowableFeature()) {
    setEditorModeLabel('Mode: Selected area cleared');
    showSuccess('Selected area cleared');
    return;
  }
  clearMowableFeatures();
  state.editSnapshot = null;

  const form = byId('quoteForm');
  if (form) {
    form.elements.mowAreaSqft.value = '';
    if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = '';
    if (form.elements.lotSource) form.elements.lotSource.value = '';
  }
  state.pendingQuote = null;

  updateMowAreaHelper(Number(form?.elements?.lotAreaSqft?.value || 0), 0);
  saveQuoteDraft();
  setEstimateState('empty', { signature: form ? estimateSignatureFromPayload(buildQuotePayload(form)) : '', payload: null });
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
}

function cloneParcelAsMowable(options = {}) {
  const starter = options?.starter === true;
  const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
  if (!parcelRings.length || !state.map) {
    showResult('parcelInfo', '<strong>No parcel shape yet.</strong><br>Lookup the parcel first.');
    return;
  }

  const feature = esriPolygonToGeoJSONFeature(state.parcelGeometry, { role: 'mowable' });
  if (!feature) return;
  if (typeof turf !== 'undefined' && feature) {
    const _featureArea = Math.round(turf.area(feature));
    const _parcelArea = state.mowableEstimate?.parcelAreaSqft
      ? Math.round(state.mowableEstimate.parcelAreaSqft * 0.0929)
      : _featureArea;
    console.warn(
      '[MowableSource] source=parcel' +
      '  featureArea=' + _featureArea + ' m²' +
      '  parcelArea=' + _parcelArea + ' m²' +
      '  ratio=' + (_parcelArea > 0 ? (_featureArea / _parcelArea).toFixed(2) : '?') +
      '  (intentional: user chose Use Parcel Shape)'
    );
  }
  setMowableFeatures([feature]);

  fitLayerBoundsWithContext(feature);

  const totalSqFt = totalMowAreaSqFt();
  const parcelSqFt = state.mowableEstimate?.parcelAreaSqft
    || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : totalSqFt);
  const form = byId('quoteForm');

  if (form && !starter) {
    form.elements.lotAreaSqft.value = parcelSqFt || totalSqFt || '';
    form.elements.mowAreaSqft.value = totalSqFt || '';
    form.elements.lotSource.value = 'parcel';
    if (form.elements.customerAdjustedMowableSqft) form.elements.customerAdjustedMowableSqft.value = totalSqFt || '';
  }

  if (starter) {
    reorderMapOverlays();
    updateMowAreaHelper(parcelSqFt, Number(form?.elements?.mowAreaSqft?.value || 0));
  } else {
    syncMowAreaFromLayers();
    setTimeout(() => {
      startEditMowable();
    }, 0);
  }
  updateQuoteFlowState();
}

function hasActiveMowableArea() {
  return currentDrawnMowAreaSqFt() > 0;
}

function setElementVisible(id, visible) {
  const el = byId(id);
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

function setMapToolPanelOpen(open) {
  const panel = byId('mapToolsPanel');
  if (!panel) return;
  const allowOpen = Boolean(open && state.parcelLayer);
  panel.classList.toggle('hidden', !allowOpen);
  setElementVisible('mapToolsToggle', Boolean(state.parcelLayer && state.quoteFlowStep === 'draw' && !allowOpen));
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

function setEstimateState(status, details = {}) {
  const next = {
    status,
    estimate: Number(details.estimate || 0),
    signature: details.signature || '',
    payload: details.payload || null,
    error: details.error || '',
    updatedAt: status === 'fresh' ? Date.now() : state.currentEstimate?.updatedAt || null,
  };
  state.currentEstimate = next;

  if (status !== 'fresh') {
    state.pendingQuote = null;
    state.lastQuote = null;
  }

  renderEstimateState();
  updateQuoteFlowState({ skipStepper: true });
  return next;
}

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
    sub = money(estimateState.estimate);
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

async function refreshEstimate(options = {}) {
  const form = byId('quoteForm');
  if (!form) return null;

  const payload = buildQuotePayload(form);
  const signature = estimateSignatureFromPayload(payload);
  const current = state.currentEstimate;
  if (!options.force && current?.status === 'fresh' && current.signature === signature) {
    renderEstimateState();
    if (options.navigate) showQuoteFlowStep('estimate');
    return current;
  }

  if (Number(payload.mowAreaSqft || 0) <= 0) {
    setEstimateState('empty', { signature, payload });
    if (options.navigate) showMissingMowableAreaPrompt('quoteResult');
    return null;
  }

  const requestSeq = ++estimateRequestSeq;
  setEstimateState('updating', { signature, payload });

  try {
    const data = await api('/api/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (requestSeq !== estimateRequestSeq) return state.currentEstimate;

    const latestSignature = currentEstimateSignature();
    if (latestSignature !== signature) {
      scheduleEstimateRefresh('changed-during-refresh');
      return state.currentEstimate;
    }

    const freshPayload = { ...payload, ...currentJobScopeSnapshotFields(), estimate: data.estimate };
    state.pendingQuote = freshPayload;
    state.lastQuote = null;
    saveQuoteDraft();
    const estimateState = setEstimateState('fresh', {
      signature,
      payload: freshPayload,
      estimate: data.estimate,
    });
    if (options.navigate) showQuoteFlowStep('estimate');
    return estimateState;
  } catch (error) {
    if (requestSeq !== estimateRequestSeq) return state.currentEstimate;
    setEstimateState('error', {
      signature,
      payload,
      error: prettyApiError(error),
    });
    if (options.navigate) showQuoteFlowStep('estimate');
    throw error;
  }
}

function scheduleEstimateRefresh(reason = 'change', options = {}) {
  const form = byId('quoteForm');
  if (!form) return;
  const payload = buildQuotePayload(form);
  const signature = estimateSignatureFromPayload(payload);
  const current = state.currentEstimate;

  if (Number(payload.mowAreaSqft || 0) <= 0) {
    if (estimateRefreshTimer) clearTimeout(estimateRefreshTimer);
    setEstimateState('empty', { signature, payload });
    return;
  }

  if (!options.force && current?.status === 'fresh' && current.signature === signature) {
    renderEstimateState();
    return;
  }

  setEstimateState('updating', { signature, payload, reason });
  if (estimateRefreshTimer) clearTimeout(estimateRefreshTimer);
  const delay = options.immediate ? 0 : ESTIMATE_DEBOUNCE_MS;
  estimateRefreshTimer = setTimeout(() => {
    estimateRefreshTimer = null;
    refreshEstimate({ force: options.force }).catch((error) => {
      showError(prettyApiError(error));
    });
  }, delay);
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

  setElementVisible('mapToolsToggle', parcelLoaded && state.quoteFlowStep === 'draw' && byId('mapToolsPanel')?.classList.contains('hidden'));
  if (!parcelLoaded || state.quoteFlowStep !== 'draw') setMapToolPanelOpen(false);

  const aiDetectBtn = byId('aiDetectMowableBtn');
  const parcelGeoJson = parcelLoaded ? currentParcelGeoJSON() : null;
  const aiDetectReady = Boolean(parcelGeoJson && !editing && !drawing && !state.aiDetectMowableLoading);
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
          : 'AI Detect Yard (Beta)';
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
    requestBtn.disabled = !estimateFresh;
    requestBtn.classList.toggle('disabled', !estimateFresh);
  }
  const manualQuoteBtn = byId('manualQuoteBtn');
  if (manualQuoteBtn) {
    manualQuoteBtn.classList.toggle('hidden', !mowSelected);
    manualQuoteBtn.disabled = !estimateFresh;
    manualQuoteBtn.classList.toggle('disabled', !estimateFresh);
  }
  byId('checkoutTestModeNote')?.classList.toggle('hidden', !estimateFresh);

  if (!options.skipStepper) updateQuoteStepper();
}

function showMissingMowableAreaPrompt(targetId = 'quoteResult') {
  showResult(
    targetId,
    '<strong>Draw your mowable area first.</strong><br>The parcel outline is only a property boundary and is not priced as mowing area.'
  );
  showWarning('Draw your mowable area first.');
}

function setAiDetectMowableStatus(status) {
  if (state.aiDetectMowableStatusTimer) clearTimeout(state.aiDetectMowableStatusTimer);
  state.aiDetectMowableStatus = status || '';
  state.aiDetectMowableStatusTimer = null;
  if (status) {
    state.aiDetectMowableStatusTimer = setTimeout(() => {
      state.aiDetectMowableStatus = '';
      state.aiDetectMowableStatusTimer = null;
      updateQuoteFlowState();
    }, 2500);
  }
  updateQuoteFlowState();
}

function aiDetectFallbackMessage(data = {}) {
  return data.message || data.warning || 'AI Detect completed. Please review and adjust the selected area.';
}

async function aiDetectGrassDraft() {
  console.log('REAL AI grass detect fired');

  const parcelRings = state.parcelGeometry?.rings || state.parcelGeometry?.coordinates || [];
  if (!parcelRings.length || !state.map) {
    showResult(
      'parcelInfo',
      '<strong>No parcel shape yet.</strong><br>Lookup the parcel first.'
    );
    return;
  }

  exposeTurfLynkMapGlobals();
  exposeTurfLynkQuoteGlobals();

  const geoJsonGeometry = exposeCurrentParcelGeometryForAi();
  if (!geoJsonGeometry) {
    showResult(
      'parcelInfo',
      '<strong>AI setup error.</strong><br>Could not convert parcel geometry for detection.'
    );
    return;
  }

  if (!window.TurfLynkAiGrass || typeof window.TurfLynkAiGrass.detectGrass !== 'function') {
    showResult(
      'parcelInfo',
      '<strong>AI detector script not loaded.</strong><br>Check that /js/ai-detect-grass.js exists and loads after /app.js.'
    );
    return;
  }

  stopToolModes();

  state.mowUndoStack = [];

  clearMowableFeatures();

  try {
    showResult('parcelInfo', '<strong>AI detecting grass...</strong><br>Analyzing satellite imagery for likely mowable area.');
    const result = await window.TurfLynkAiGrass.detectGrass();

    exposeTurfLynkMapGlobals();

    const detectedSqFt = Math.round(Number(result?.mowableAreaSqFt || byId('quoteForm')?.elements?.mowAreaSqft?.value || 0));
    const parcelSqFt = state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : Number(byId('quoteForm')?.elements?.lotAreaSqft?.value || 0);

    const form = byId('quoteForm');
    if (form) {
      form.elements.lotAreaSqft.value = parcelSqFt || '';
      form.elements.mowAreaSqft.value = detectedSqFt || '';
      form.elements.lotSource.value = 'ai_detected';
    }

    updateMowAreaHelper(parcelSqFt, detectedSqFt);
    saveQuoteDraft();
    await refreshEstimate({ force: true });

    reorderMapOverlays();

    showResult(
      'parcelInfo',
      `<strong>AI mowable area detected.</strong><br>
      Detected Mow Area: ${formatAcres(detectedSqFt)}<br>
      Green shapes are editable. Adjust them if trees, roofs, driveways, or shadows were misread.`
    );
  } catch (error) {
    console.error('AI grass detection failed', error);
    showResult('parcelInfo', `<strong>AI detection failed.</strong><br>${escapeHtml(error.message || error)}`);
  }
}

function geoJsonFeaturesFromValue(value, properties = {}) {
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value.features.map((feature) => asFeature(feature, properties)).filter((feature) => feature?.geometry);
  }
  const feature = asFeature(value, properties);
  return feature?.geometry ? [feature] : [];
}

function isPolygonalGeometry(geometry) {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

function mowableFeaturesFromAiResponse(data = {}) {
  if (data.featureCollection?.type === 'FeatureCollection') {
    return geoJsonFeaturesFromValue(data.featureCollection);
  }
  if (Array.isArray(data.features)) {
    return data.features.map((feature) => asFeature(feature)).filter((feature) => feature?.geometry);
  }
  return [];
}

function sanitizeAiMowableFeatures(data = {}, parcelGeoJson = null) {
  const source = String(data.source || '').toLowerCase();
  const parcelFeatures = geoJsonFeaturesFromValue(parcelGeoJson);
  const parcelFeature = parcelFeatures.find((feature) => isPolygonalGeometry(feature.geometry)) || null;
  const parcelAreaSqFt = parcelFeature ? layerAreaSqFt(parcelFeature) : 0;
  const cleaned = [];
  const isFallbackSource = source.includes('fallback') || source.includes('parcel') || source.includes('copy') || source.includes('placeholder');
  const confidenceLabelRaw = String(data.confidence || data.diagnostics?.confidence || data.diagnostics?.confidenceLabel || '');
  const confidence = confidenceLabelRaw === 'beta_low' ? 0.25 : confidenceLabelRaw === 'beta_medium' ? 0.6 : confidenceLabelRaw === 'beta_high' ? 0.9 : Number(data.confidenceScore ?? data.score ?? data.modelConfidence ?? data.mowableConfidence ?? data.confidence);

  if (isFallbackSource) {
    console.warn('[AI Detect] rejected fallback mowable response', { source: data.source });
    return cleaned;
  }

  mowableFeaturesFromAiResponse(data).forEach((feature) => {
    const featureSource = String(feature.properties?.source || '').toLowerCase();
    if (feature.properties?.draft === true || featureSource.includes('fallback') || featureSource.includes('parcel') || featureSource.includes('copy') || featureSource.includes('placeholder')) {
      console.warn('[AI Detect] rejected fallback mowable feature', { source: feature.properties?.source });
      return;
    }

    const normalized = asFeature(feature, {
      source: data.source || feature.properties?.source || 'vision',
      draft: data.source === 'fallback' || feature.properties?.draft === true,
    });
    if (!normalized || !isPolygonalGeometry(normalized.geometry)) return;

    let candidate = normalized;
    if (parcelFeature && source !== 'fallback' && typeof turf !== 'undefined' && typeof turf.intersect === 'function') {
      try {
        const clipped = turf.intersect(normalized, parcelFeature);
        if (clipped?.geometry && isPolygonalGeometry(clipped.geometry)) {
          candidate = asFeature(clipped, normalized.properties);
        }
      } catch (error) {
        console.warn('[AI Detect] could not clip detected feature to parcel', error);
      }
    }

    const areaSqFt = layerAreaSqFt(candidate);
    if (areaSqFt <= 0) return;
    if (parcelAreaSqFt > 0 && areaSqFt > parcelAreaSqFt * 0.97) {
      console.warn('[AI Detect] rejected parcel-sized mowable feature', { areaSqFt, parcelAreaSqFt });
      return;
    }

    cleaned.push(candidate);
  });

  const totalAreaSqFt = cleaned.reduce((sum, feature) => sum + layerAreaSqFt(feature), 0);
  if (parcelAreaSqFt > 0 && totalAreaSqFt > parcelAreaSqFt * 0.97) {
    console.warn('[AI Detect] rejected parcel-sized mowable response', { totalAreaSqFt, parcelAreaSqFt });
    return [];
  }

  return cleaned;
}

async function aiDetectMowableArea() {
  console.log('[AI Detect] clicked');

  const parcelGeoJson = currentParcelGeoJSON();
  if (!parcelGeoJson || !state.map) {
    showResult('parcelInfo', '<strong>No parcel shape yet.</strong><br>Lookup the parcel first.');
    updateQuoteFlowState();
    return;
  }

  const center = state.map.getCenter?.();
  const form = byId('quoteForm');
  const payload = {
    parcelGeoJson,
    parcelFeature: state.parcelFeature || null,
    center: center ? {
      lng: Number(center.lng ?? center[0]),
      lat: Number(center.lat ?? center[1]),
    } : null,
    lng: center ? Number(center.lng ?? center[0]) : null,
    lat: center ? Number(center.lat ?? center[1]) : null,
    zoom: Number(state.map.getZoom?.() || 0) || null,
    address: form ? [form.elements.address?.value, form.elements.city?.value, form.elements.state?.value, form.elements.zip?.value].filter(Boolean).join(', ') : '',
    source: 'maplibre',
    imageSource: {
      type: 'tile',
      provider: 'esri-world-imagery',
      tileUrl: SATELLITE_TILE_URL,
      attribution: SATELLITE_TILE_ATTRIBUTION,
    },
  };

  console.log('[AI Detect] request body', payload);

  stopToolModes();
  setAiDetectMowableStatus('');
  state.aiDetectMowableLoading = true;
  const loadingStartedAt = Date.now();
  updateQuoteFlowState();
  showResult('parcelInfo', '<strong>Detecting yard (Beta)...</strong><br>Building an editable mowable-area draft.');

  try {
    const token = localStorage.getItem('turflynk.authToken') || '';
    const response = await fetch('/api/ai/detect-mowable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    console.log('[AI Detect] response status', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn('[AI Detect] error', errText || `HTTP ${response.status}`);
      const msg = aiDetectFallbackMessage();
      setAiDetectMowableStatus('fallback');
      showResult('parcelInfo', `<strong>Use Lasso Yard</strong><br>${escapeHtml(msg)}`);
      showToast(msg, 'warning', { duration: 6000 });
      return;
    }

    const data = await response.json();
    console.log('[AI Detect] response json', data);
    const diag = data.diagnostics || data.diagnostic || {};
    console.log('[AI Detect] diagnostics', JSON.stringify({
      failureStage: diag.failureStage,
      reason: data.reason || diag.reason || diag.guardrailReason || '',
      parcelAreaSqft: diag.parcelAreaSqft,
      parcelBounds: diag.parcelBounds,
      imageBounds: diag.imageBounds,
      requestedImageWidth: diag.requestedImageWidth,
      requestedImageHeight: diag.requestedImageHeight,
      actualImageWidth: diag.actualImageWidth,
      actualImageHeight: diag.actualImageHeight,
      pixelCount: diag.pixelCount,
      metersPerPixel: diag.metersPerPixel,
      vegetationPixels: diag.vegetationPixels,
      vegetationCandidatePixels: diag.vegetationCandidatePixels,
      hardscapePixels: diag.hardscapePixels,
      polygonCountBeforeFiltering: diag.polygonCountBeforeFiltering,
      polygonCountAfterFiltering: diag.polygonCountAfterFiltering,
      keptComponentCount: diag.keptComponentCount,
      detectedRatio: diag.detectedRatio,
      strictDetectedRatio: diag.strictDetectedRatio,
      softDetectedRatio: diag.softDetectedRatio,
      confidence: diag.confidence,
      lowConfidenceCandidateReturned: diag.lowConfidenceCandidateReturned,
      fallbackSoftMaskUsed: diag.fallbackSoftMaskUsed,
      selectedCandidate: diag.selectedCandidate,
      debugRunDir: diag.debugRunDir,
    }));

    let features = sanitizeAiMowableFeatures(data, parcelGeoJson);
    const serverFeaturesCount = Array.isArray(data.features) ? data.features.length : (Array.isArray(data.featureCollection?.features) ? data.featureCollection.features.length : 0);
    console.log('[AI Detect] server features count', serverFeaturesCount, '| sanitized features count', features.length);
if (serverFeaturesCount > 0 && features.length === 0) {
  console.warn('[AI Detect] forcing fallback features through for manual review');
  const rawFeatures = Array.isArray(data.features) && data.features.length
    ? data.features
    : (Array.isArray(data.featureCollection?.features) ? data.featureCollection.features : []);
  features = rawFeatures
    .filter(f => f && f.geometry)
    .map(f => ({
      type: 'Feature',
      properties: { ...(f.properties || {}), source: 'ai-detect-beta-low-manual-review' },
      geometry: f.geometry
    }));
}

    if (!data?.ok) {
      const rejectionReason = data.reason || diag.reason || diag.guardrailReason || '';
      const failureStage = diag.failureStage || '';
      console.warn('[AI Detect] no usable features - reason:', rejectionReason, 'failureStage:', failureStage);
      let msg;
      if (rejectionReason && rejectionReason !== 'vision service unavailable') {
        msg = `AI detection completed but no confident vegetation area was found. Reason: ${rejectionReason}. Use Lasso Yard to outline the mowable area.`;
      } else {
        msg = aiDetectFallbackMessage(data);
      }
      setAiDetectMowableStatus('fallback');
      showResult('parcelInfo', `<strong>AI Detect: no result</strong><br>${escapeHtml(msg)}`);
      showToast(msg, 'warning', { duration: 8000 });
      return;
    }

    state.mowUndoStack = [];
    state.selectedMowableFeatureId = null;
    setMowableFeatures(features);
    clearCutoutFeatures();
    reorderMapOverlays();
    syncMowAreaFromLayers();

    if (getMowableFeatureCount() === 0) {
      const msg = 'AI returned a yard suggestion, but it could not be displayed. Use Lasso Yard to quickly outline the mowable grass area.';
      setAiDetectMowableStatus('fallback');
      showResult('parcelInfo', `<strong>Use Lasso Yard</strong><br>${escapeHtml(msg)}`);
      showToast(msg, 'warning', { duration: 6000 });
      return;
    }

    await refreshEstimate({ force: true }).catch((error) => {
      showError(prettyApiError(error));
    });

    const isFallback = data.source === 'fallback' || features.some((feature) => feature.properties?.source === 'fallback');
    const confidenceLabel = String(data.confidence || data.diagnostics?.confidence || data.diagnostics?.confidenceLabel || '').toLowerCase();
    const isLowConfidence = confidenceLabel === 'beta_low' || Number(data.confidenceScore || 0) < 0.42;
    const successMsg = isFallback
      ? 'AI used a parcel-based draft. Please adjust before booking.'
      : isLowConfidence
        ? 'AI Detect found a low-confidence area. Please review and edit before booking.'
        : 'Beta AI selected likely mowable vegetation by excluding buildings, pavement, roads, and other hard surfaces. Please review and edit before booking.';
    console.log('[AI Detect] success confidenceLabel:', confidenceLabel, 'isLowConfidence:', isLowConfidence, 'features:', features.length);
    setAiDetectMowableStatus('success');
    showResult('parcelInfo', successMsg);
    showToast(successMsg, isFallback || isLowConfidence ? 'info' : 'success', { duration: 6000 });
  } catch (error) {
    console.error('[AI Detect] error', error);
    const msg = aiDetectFallbackMessage();
    setAiDetectMowableStatus('fallback');
    showResult('parcelInfo', `<strong>Use Lasso Yard</strong><br>${escapeHtml(msg)}`);
    showToast(msg, 'warning', { duration: 6000 });
  } finally {
    const remainingLoadingMs = 700 - (Date.now() - loadingStartedAt);
    if (remainingLoadingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingLoadingMs));
    state.aiDetectMowableLoading = false;
    updateQuoteFlowState();
  }
}

function startDrawMowable() {
  if (!state.map) return;
  stopToolModes();
  state.quoteUiMode = 'drawing';
  if (window.TurfLynkLassoYard?.arm) window.TurfLynkLassoYard.arm();
  setEditorModeLabel('Mode: Drag on map to draw');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}

function startEditMowable() {
  if (!state.map || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to edit.</strong><br>Use Parcel Shape, Smart Draft, or Draw Area first.');
    return;
  }

  stopToolModes();
  setMapMode('edit');
  state.quoteUiMode = 'editing';
  state.editSnapshot = cloneFeatureCollection(state.mowableFeatureCollection).features;
  buildEditHandles();
  setEditorModeLabel('Mode: Drag green handles to adjust the mowable area');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}



async function aiRefineMowableArea() {
  if (!state.map || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to refine.</strong>');
    return;
  }

  try {
    showResult(
      'parcelInfo',
      '<strong>AI refining area...</strong><br>Looking for house, driveway, pool, shed, or other non-mowable areas.'
    );

    const mowableFeatures = cloneFeatureCollection(state.mowableFeatureCollection).features;
    const parcelGeometry = exposeCurrentParcelGeometryForAi();

    const payload = {
      parcelGeometry,
      mowableFeatures,
      center: state.map.getCenter(),
      zoom: state.map.getZoom()
    };

    const data = await api('/api/ai/refine-mowable', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const cutouts = data.cutouts || [];

    if (!data.ok || !cutouts.length) {
      showResult(
        'parcelInfo',
        '<strong>AI did not find obvious cutouts.</strong><br>You can still use Cut Out Area manually.'
      );
      return;
    }

    setCutoutFeatures(cutouts);

    showResult(
      'parcelInfo',
      `<strong>AI suggested ${cutouts.length} cutouts.</strong><br>Edit red shapes, then click Apply Cutouts.`
    );
  } catch (error) {
    console.error('AI refine failed', error);
    showResult(
      'parcelInfo',
      `<strong>AI refine failed.</strong><br>${escapeHtml(error.message || error)}`
    );
  }
}

function applyAiCutouts() {
  if (!getCutoutFeatureCount()) {
    showResult('parcelInfo', '<strong>No AI cutouts to apply.</strong>');
    return;
  }

  snapshotMowLayersForUndo();
  state.skipNextCutUndoSnapshot = true;

  try {
    state.aiCutoutFeatureCollection.features.forEach(feature => {
      applyCutToMowable(feature);
    });
  } finally {
    state.skipNextCutUndoSnapshot = false;
  }

  clearCutoutFeatures();
  syncMowAreaFromLayers();

  showResult('parcelInfo', '<strong>AI cutouts applied.</strong>');
}

function startDeleteMowable() {
  if (!state.map || !getAllMowLayers().length) {
    showResult('parcelInfo', '<strong>No mowable area to delete.</strong>');
    return;
  }

  stopToolModes();
  if (removeSelectedMowableFeature()) {
    state.quoteUiMode = 'idle';
    setEditorModeLabel('Mode: Selected area deleted');
    setMapToolPanelOpen(true);
    updateQuoteFlowState();
    showSuccess('Selected area deleted');
    return;
  }
  setMapMode('edit');
  state.editSnapshot = null;
  clearMowableFeatures();
  syncMowAreaFromLayers();
  state.quoteUiMode = 'idle';
  setEditorModeLabel('Mode: Mowable areas deleted');
  setMapToolPanelOpen(true);
  updateQuoteFlowState();
}


function applyCutToMowable(cutLayer) {
  try {
    if (!state.skipNextCutUndoSnapshot) {
      snapshotMowLayersForUndo();
    }

    const cutGeo = asFeature(cutLayer);
    if (!cutGeo) return;
    const newFeatures = [];

    getAllMowLayers().forEach((gj) => {

      try {
        const diff = turf.difference(gj, cutGeo);

        if (!diff) return;

        if (diff.geometry.type === 'Polygon') {
          newFeatures.push(diff);
        } else if (diff.geometry.type === 'MultiPolygon') {
          newFeatures.push(diff);
        }
      } catch (err) {
        console.warn('Cut failed on layer', err);
      }
    });

    setMowableFeatures(newFeatures);

    syncMowAreaFromLayers();
  } catch (err) {
    console.error('applyCutToMowable failed', err);
  }
}

function initMap() {
  const mapEl = byId('quoteMap');
  if (!mapEl || typeof maplibregl === 'undefined') return;

  state.map = new maplibregl.Map({
    container: 'quoteMap',
    center: latLngToLngLat(DEFAULT_MAP_CENTER),
    zoom: DEFAULT_MAP_ZOOM,
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tiles: [SATELLITE_TILE_URL],
          tileSize: 256,
          attribution: SATELLITE_TILE_ATTRIBUTION,
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    },
  });
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  setMapGestureCapture(false);
  state.drawGroup = state.mowableFeatureCollection;
  state.aiCutoutGroup = state.aiCutoutFeatureCollection;
  state.buildingFootprintGroup = state.buildingFootprintFeatureCollection;

  state.map.on('load', () => {
    ensureMapLibreSourcesAndLayers();
    installMowableMoveMapHandlers();
    exposeTurfLynkMapGlobals();
    exposeTurfLynkQuoteGlobals();
  });

  exposeTurfLynkMapGlobals();

  state.map.on('click', (e) => {
    if (getMapMode() !== 'select' || !state.parcelSelectMode) return;
    e.preventDefault?.();
    applyParcelFromClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  });

  if (!state._mowableSelectionHandlersInstalled) {
    state._mowableSelectionHandlersInstalled = true;
    state.map.on('click', 'mowable-fill', (e) => {
      if (getMapMode() === 'lasso' || state.quoteUiMode === 'drawing') return;
      const feature = e.features?.[0];
      const featureId = feature?.properties?.id || feature?.id;
      if (!featureId) return;
      e.preventDefault?.();
      selectMowableFeature(featureId);
      setMapToolPanelOpen(true);
    });
    state.map.on('mouseenter', 'mowable-fill', () => {
      try { state.map.getCanvas().style.cursor = 'pointer'; } catch {}
    });
    state.map.on('mouseleave', 'mowable-fill', () => {
      try { state.map.getCanvas().style.cursor = ''; } catch {}
    });
  }

  state.map.on('dblclick', (e) => {
    if (getMapMode() !== 'select' || !state.parcelSelectMode) return;
    e.preventDefault?.();
    state.parcelDblClick = true;
    if (state.pendingParcelFeature) {
      state.parcelDblClick = false;
      confirmParcelSelection().catch((error) => showError('Parcel selection failed: ' + prettyApiError(error)));
    }
  });
}

window.TurfLynkAppState = state;
window.setTurfLynkMapMode = setMapMode;
window.getTurfLynkMapMode = getMapMode;
window.esriPolygonToLatLngPairs = esriPolygonToLatLngPairs;
window.esriPolygonToGeoJSONFeature = esriPolygonToGeoJSONFeature;
window.exposeCurrentParcelGeometryForAi = exposeCurrentParcelGeometryForAi;
window.exposeTurfLynkMapGlobals = exposeTurfLynkMapGlobals;
window.syncMowAreaFromLayers = syncMowAreaFromLayers;
window.startEditMowable = startEditMowable;
window.setTurfLynkMowableFeatures = setMowableFeatures;
window.selectTurfLynkMowableFeature = selectMowableFeature;
window.applyTurfLynkCutFeature = applyCutToMowable;
window.setTurfLynkLassoTempLine = setLassoTempLine;
window.updateEstimatePreview = updateEstimatePreview;
window.showToast = showToast;
window.showSuccess = showSuccess;
window.showError = showError;
window.showWarning = showWarning;
window.showInfo = showInfo;

function setQuoteService(serviceType) {
  const select = byId('quoteServiceSelect');
  if (!serviceType || !select) return;
  const value = serviceType === 'recurring_lawn_care' ? 'mowing' : serviceType;
  if (Array.from(select.options).some((option) => option.value === value)) {
    select.value = value;
    saveQuoteDraft();
    scheduleEstimateRefresh('service-change');
  }
}

function setServiceFlow(flow) {
  state.serviceFlow = flow || 'instant_mow';
  const instant = state.serviceFlow === 'instant_mow';
  byId('quoteForm')?.classList.toggle('hidden', !instant);
  byId('leadRequestPanel')?.classList.add('hidden');
  byId('liveBidPanel')?.classList.toggle('hidden', instant);
  if (byId('viewTitle')) byId('viewTitle').textContent = instant ? 'Instant Mow Quote' : 'Live Bid Request';
  if (byId('mobileViewTitle')) byId('mobileViewTitle').textContent = instant ? 'Instant Mow' : 'Live Bid';
  if (instant && state.map) setTimeout(() => state.map.resize?.(), 120);
}

function hydrateLiveBidForm(serviceId) {
  const service = selectedServiceMeta(serviceId);
  const form = byId('liveBidForm');
  if (!form) return;

  if (byId('liveBidServiceType')) byId('liveBidServiceType').value = service.id;
  const badge = byId('liveBidBadge');
  if (badge) badge.textContent = service.badge;
  const taskWrap = byId('liveBidTaskChecks');
  if (taskWrap) taskWrap.innerHTML = serviceTaskCheckboxes('requested_tasks', [service.id]);

  const quoteForm = byId('quoteForm');
  if (quoteForm) {
    const q = formToObject(quoteForm);
    const serviceAddress = getCurrentServiceAddress(q);
    ['address', 'city', 'state', 'zip'].forEach((name) => {
      if (form.elements[name]) form.elements[name].value = serviceAddress[name] || (name === 'state' ? 'AR' : '');
    });
    if (form.elements.customerName && q.name) form.elements.customerName.value = q.name;
    if (form.elements.customerPhone && q.phone) form.elements.customerPhone.value = q.phone;
    if (form.elements.customerEmail && q.email) form.elements.customerEmail.value = q.email;
  }
}

function selectServiceCard(serviceId) {
  const service = selectedServiceMeta(serviceId);
  setActiveView('quote');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (service.quoteType === 'instant_mow') {
    setServiceFlow('instant_mow');
    setQuoteService(service.id);
    const frequency = byId('quoteForm')?.elements?.service_frequency;
    if (frequency && service.id === 'recurring_lawn_care') frequency.value = 'biweekly';
    showInfo(`${service.title} uses the instant mowing estimate.`);
    return;
  }

  setServiceFlow('live_bid');
  hydrateLiveBidForm(service.id);
  showInfo(`${service.title} is handled as a live bid.`);
}

function closeAppDrawer() {
  byId('appDrawer')?.classList.add('hidden');
  byId('appDrawerOverlay')?.classList.add('hidden');
  byId('openAppDrawer')?.setAttribute('aria-expanded', 'false');
}

function openAppDrawer() {
  byId('appDrawer')?.classList.remove('hidden');
  byId('appDrawerOverlay')?.classList.remove('hidden');
  byId('openAppDrawer')?.setAttribute('aria-expanded', 'true');
}

function revealSecondarySectionForTarget(targetId) {
  const target = byId(targetId);
  const section = target?.closest?.('[data-secondary-home-section]');
  if (!section) return target;
  section.hidden = false;
  section.classList.remove('hidden');
  if (target && 'hidden' in target) target.hidden = false;
  return target;
}

function navigateFromElement(el) {
  const view = el?.dataset?.jumpView || el?.dataset?.drawerView || el?.dataset?.view;
  const providerSection = el?.dataset?.providerSection || '';
  let requestedFlow = null;
  let requestedService = null;
  if (el?.dataset?.serviceType) {
    const meta = selectedServiceMeta(el.dataset.serviceType);
    if (meta.quoteType === 'instant_mow') {
      requestedFlow = 'instant_mow';
      requestedService = el.dataset.serviceType;
    } else {
      requestedFlow = 'live_bid';
      requestedService = meta.id;
    }
  }
  if (providerSection) state.providerAreaSection = providerSection;
  if (view) setActiveView(view);
  if (providerSection && view === 'providers') renderProviderArea(providerSection);
  if (requestedFlow === 'instant_mow') {
    setServiceFlow('instant_mow');
    setQuoteService(requestedService);
  }
  if (requestedFlow === 'live_bid') {
    setServiceFlow('live_bid');
    hydrateLiveBidForm(requestedService);
  }
  if (el?.dataset?.scrollTarget) {
    const target = revealSecondarySectionForTarget(el.dataset.scrollTarget);
    setTimeout(() => target?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
  if (el?.hasAttribute?.('data-drawer-contact') || el?.hasAttribute?.('data-mobile-contact')) {
    openAppDrawer();
    setTimeout(() => byId('drawerContactPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    return;
  }
  closeAppDrawer();
}

function setActiveView(view) {
  byId('accountPanel')?.classList.add('hidden');
  state.activeView = view;
  document.body.dataset.activeView = view;

  $$('[data-view-panel]').forEach((el) => {
    const visible = el.dataset.viewPanel === view;
    el.classList.toggle('active', visible);
    el.style.display = visible ? '' : 'none';
  });

  $$('[data-view]').forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });

  $$('[data-jump-view]').forEach((btn) => {
    btn.onclick = () => navigateFromElement(btn);
  });

  const title = byId('viewTitle');
  if (title) {
    const titles = {
      dashboard: 'Home',
      quote: 'Get a Quote',
      jobs: 'Jobs',
      providers: 'Providers',
      admin: 'Admin Dashboard',
    };
    title.textContent = titles[view] || 'MowNWA';
    if (byId('mobileViewTitle')) byId('mobileViewTitle').textContent = titles[view] || 'MowNWA';
  }

  if (view === 'quote' && state.map) {
    setTimeout(() => state.map.resize?.(), 100);
    showQuoteFlowStep(state.quoteFlowStep || 'property', { scroll: false });
    updateQuoteFlowState();
  }

  if (view === 'admin') {
    if (isAdmin()) loadAdminLeads().catch(() => {});
    // Populate service filter dropdown if empty
    const sf = byId('leadsServiceFilter');
    if (sf && sf.options.length <= 1) {
      state.services.forEach((svc) => {
        const opt = document.createElement('option');
        opt.value = svc.id;
        opt.textContent = svc.label || svc.name;
        sf.append(opt);
      });
    }
  }

  if (view === 'jobs') {
    // Auto-load appropriate job list based on role
    const role = state.currentUser?.role;
    if (role === 'provider') {
      byId('myBookingsPanelTitle') && (byId('myBookingsPanelTitle').textContent = 'Open Jobs');
      loadOpenJobsForProvider().catch(() => {});
    } else {
      loadMyJobs().catch(() => {});
    }
  }

  if (view === 'providers') {
    populateProviderSetupChoices();
    loadProviderServiceAreas().catch(() => {});
    if (state.currentUser?.role === 'provider' || state.currentUser?.role === 'admin') {
      renderProviderArea(state.providerAreaSection || 'dashboard');
    }
  }
}

function initNavigation() {
  const buttons = $$('[data-view]');
  const sections = $$('[data-view-panel]');
  if (!buttons.length || !sections.length) return;

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateFromElement(btn);
    });
  });

  $$('[data-jump-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateFromElement(btn);
    });
  });

  const first = buttons.find((b) => b.classList.contains('active'))?.dataset.view || 'dashboard';
  setActiveView(first);
}

function renderCoverage() {
  const grid = byId('coverageGrid');
  if (!grid) return;

  grid.innerHTML = '';
  const localCities = window.TurfLynkLocalContent?.cities || [];
  const localAreas = window.TurfLynkLocalContent?.areas || [];

  if (localCities.length || localAreas.length) {
    localAreas.slice(0, 3).forEach((area) => {
      grid.append(card(`
        <h4>${escapeHtml(area.name || 'Arkansas service area')}</h4>
        <div class="meta">${escapeHtml(area.shortDescription || 'Request lawn care estimates in this area.')}</div>
        <div class="meta">Counties: ${escapeHtml((area.counties || []).join(', '))}</div>
        <div class="meta">Cities: ${escapeHtml((area.neighborhoodsOrNearbyAreas || []).slice(0, 6).join(', '))}</div>
        <button class="btn secondary small" type="button" data-local-path="/areas/${escapeHtml(area.slug)}">View area</button>
      `));
    });

    localCities.slice(0, 9).forEach((city) => {
      grid.append(card(`
        <h4>${escapeHtml(city.name)}, ${escapeHtml(city.state || 'AR')}</h4>
        <div class="meta">${escapeHtml(city.shortDescription || `${city.name} lawn care estimates.`)}</div>
        <div class="meta">Common needs: ${escapeHtml((city.commonServices || []).slice(0, 4).join(', '))}</div>
        <div class="meta">Nearby: ${escapeHtml((city.neighborhoodsOrNearbyAreas || []).slice(0, 5).join(', '))}</div>
        <button class="btn secondary small" type="button" data-local-path="/cities/${escapeHtml(city.slug)}">View ${escapeHtml(city.name)}</button>
      `));
    });
    bindLocalContentLinks(grid);
    return;
  }

  state.regions.forEach((region) => {
    grid.append(card(`
      <h4>${escapeHtml(region.label)}</h4>
      <div class="meta">${escapeHtml(region.metro || '')}</div>
      <div class="meta">Counties: ${escapeHtml((region.counties || []).join(', '))}</div>
      <div class="meta">Cities: ${escapeHtml((region.featuredCities || []).join(', '))}</div>
      <div class="meta">Multiplier ${region.marketMultiplier} � Travel ${money(region.travelFee)} � Minimum ${money(region.minimumJob)}</div>
    `));
  });
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
    preferredDate: job.preferredDate || job.preferred_date || '',
    postedAt: job.postedAt || job.createdAt || job.created_at || '',
  };
}

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

function localContentData() {
  return window.TurfLynkLocalContent || { homepage: {}, cities: [], areas: [], services: [] };
}

function setMetaDescription(description) {
  const text = String(description || '').trim();
  if (!text) return;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);
  }
  meta.content = text;
}

function bindLocalContentLinks(root = document) {
  root.querySelectorAll('[data-local-path]').forEach((btn) => {
    if (btn.dataset.localBound) return;
    btn.dataset.localBound = '1';
    btn.addEventListener('click', () => {
      const path = btn.dataset.localPath;
      if (!path) return;
      history.pushState({}, '', path);
      renderLocalLandingFromPath();
      setActiveView('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function renderFaqItems(faqs = []) {
  return faqs.map((faq) => `
    <div class="card">
      <h4>${escapeHtml(faq.question || 'Question')}</h4>
      <p>${escapeHtml(faq.answer || 'Details may vary by location and service request.')}</p>
    </div>
  `).join('');
}

function renderHomepageContent() {
  const data = localContentData();
  const homepage = data.homepage || {};

  if (byId('homeHeroTitle')) byId('homeHeroTitle').innerHTML = 'FAST LAWN QUOTES.<br>EASY ONLINE BOOKING.';
  if (byId('homeHeroSubtitle')) byId('homeHeroSubtitle').innerHTML = 'No calls. No waiting.<br>Just simple, transparent pricing.';
  const tags = byId('homeServiceTags');
  if (tags) {
    tags.innerHTML = ['Mowing', 'Cleanup', 'Bush Trimming', 'Leaf Removal', 'Pressure Washing', 'Gutter Cleaning']
      .map((item) => `<span class="pill muted">${escapeHtml(item)}</span>`)
      .join('');
  }

  const servicesGrid = byId('popularServicesGrid');
  if (servicesGrid) {
    servicesGrid.innerHTML = '';
    const groups = [...new Set(SERVICE_CATALOG.map((service) => service.group || 'Services'))];
    groups.forEach((group) => {
      const heading = document.createElement('div');
      heading.className = 'service-group-title';
      heading.textContent = group;
      servicesGrid.append(heading);
      SERVICE_CATALOG.filter((service) => (service.group || 'Services') === group).forEach((service) => {
        servicesGrid.append(card(`
        <div class="service-card-head">
          <h4>${escapeHtml(service.title)}</h4>
          <span class="service-badge ${service.quoteType === 'instant_mow' ? 'instant' : 'bid'}">${escapeHtml(service.badge)}</span>
        </div>
        <p>${escapeHtml(service.description)}</p>
        <button class="btn ${service.quoteType === 'instant_mow' ? 'primary' : 'secondary'} small service-select-btn" type="button" data-service-card="${escapeHtml(service.id)}">Continue</button>
      `));
      });
    });
    servicesGrid.querySelectorAll('[data-service-card]').forEach((btn) => {
      btn.addEventListener('click', () => selectServiceCard(btn.dataset.serviceCard));
    });
  }

  const steps = byId('howItWorksGrid');
  if (steps) {
    steps.innerHTML = '';
    (homepage.howItWorks || []).forEach((step, index) => {
      steps.append(card(`
        <h4>${index + 1}. ${escapeHtml(step)}</h4>
        <p>${escapeHtml(index === 0 ? 'Start with the property address.' : index === 1 ? 'Use parcel lookup, lasso, and edit tools for the yard area.' : index === 2 ? 'Review the estimate before creating an account.' : 'Share contact details only when you are ready to continue.')}</p>
      `));
    });
  }

  const faqGrid = byId('homeFaqGrid');
  if (faqGrid) faqGrid.innerHTML = renderFaqItems(homepage.faqs || []);
}

function findLocalEntry(type, slug) {
  const data = localContentData();
  const list = type === 'services' ? data.services : type === 'areas' ? data.areas : data.cities;
  return (list || []).find((item) => item.slug === slug) || null;
}

function renderLocalLanding(entry, type) {
  const panel = byId('localLandingPanel');
  if (!panel) return;

  if (!entry) {
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="pill muted">Arkansas lawn care</div>
      <h2>Local lawn care estimates</h2>
      <p class="section-copy">That page is not available yet, but you can still start an estimate with your Arkansas address.</p>
      <button class="btn primary" type="button" data-jump-view="quote">Get a lawn care estimate</button>
    `;
    panel.querySelectorAll('[data-jump-view]').forEach((btn) => {
      btn.addEventListener('click', () => setActiveView(btn.dataset.jumpView));
    });
    return;
  }

  document.title = entry.seoTitle || entry.heroTitle || 'TurfLynk';
  setMetaDescription(entry.seoDescription || entry.shortDescription || '');

  const included = type === 'services'
    ? (entry.whatIsIncluded || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : (entry.commonServices || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const nearby = (entry.neighborhoodsOrNearbyAreas || entry.bestFor || []).map((item) => `<span class="pill muted">${escapeHtml(item)}</span>`).join('');
  const priceFactors = (entry.priceFactors || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');

  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="pill">${escapeHtml(type === 'services' ? 'Service guide' : entry.regionName || 'Arkansas service area')}</div>
    <h2>${escapeHtml(entry.heroTitle || entry.name || 'Local lawn care estimates')}</h2>
    <p class="section-copy">${escapeHtml(entry.heroSubtitle || entry.shortDescription || 'Start with an address and review an estimate before continuing.')}</p>
    <div class="local-landing-actions">
      <button class="btn primary" type="button" data-jump-view="quote">${escapeHtml(entry.ctaText || 'Get an estimate')}</button>
      <button class="btn secondary" type="button" data-local-path="/">Back to Northwest Arkansas</button>
    </div>
    <div class="section-grid two-up local-detail-grid">
      <div class="mini-card">
        <h3>${escapeHtml(type === 'services' ? 'What is included' : 'Common lawn care needs')}</h3>
        <ul>${included || '<li>Service details vary by property and provider availability.</li>'}</ul>
      </div>
      <div class="mini-card">
        <h3>${escapeHtml(type === 'services' ? 'Good fit for' : 'Nearby areas')}</h3>
        <div class="local-pill-row">${nearby || '<span class="pill muted">Nearby Arkansas areas</span>'}</div>
        <p>${escapeHtml(entry.localNotes || entry.estimateNotes || 'Availability, coverage, and pricing may vary by location and job details.')}</p>
      </div>
    </div>
    ${type === 'services' ? `
      <div class="section-grid two-up local-detail-grid">
        <div class="mini-card">
          <h3>When customers need it</h3>
          <p>${escapeHtml(entry.whenNeeded || 'This service can help when regular yard care, cleanup, or a one-time request fits the property.')}</p>
        </div>
        <div class="mini-card">
          <h3>What affects price</h3>
          <ul>${priceFactors || '<li>Property size, access, selected services, and local availability.</li>'}</ul>
        </div>
      </div>
    ` : ''}
    <h3>FAQ</h3>
    <div class="card-grid">${renderFaqItems(entry.faqs || [])}</div>
  `;

  bindLocalContentLinks(panel);
  panel.querySelectorAll('[data-jump-view]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveView(btn.dataset.jumpView));
  });
}

function renderLocalLandingFromPath() {
  const panel = byId('localLandingPanel');
  if (!panel) return;

  const path = window.location.pathname.replace(/\/+$/, '');
  const match = path.match(/^\/(cities|areas|services)\/([a-z0-9-]+)$/);

  if (!match) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    renderHomepageContent();
    const homepage = localContentData().homepage || {};
    document.title = homepage.seoTitle || 'TurfLynk Arkansas';
    setMetaDescription(homepage.seoDescription || homepage.heroSubtitle || '');
    return;
  }

  const [, type, slug] = match;
  renderLocalLanding(findLocalEntry(type, slug), type);
}

async function loadConfig() {
  const data = await api('/api/config');
  state.config = data;
  state.regions = (data.settings?.regions || []).map(normalizeRegion);
  state.services = (data.settings?.services || []).map(normalizeService);

  if (byId('regionCountStat')) byId('regionCountStat').textContent = String(state.regions.length);
  if (byId('serviceCountStat')) byId('serviceCountStat').textContent = String(state.services.length);

  fillSelect(byId('quoteRegionSelect'), state.regions);
  fillSelect(byId('jobRegionSelect'), state.regions);
  fillSelect(byId('regionEditorSelect'), state.regions);
  fillSelect(byId('quoteServiceSelect'), state.services);
  fillSelect(byId('jobServiceSelect'), state.services);
  fillSelect(byId('serviceEditorSelect'), state.services);

  const providerRegions = byId('providerRegions');
  if (providerRegions) {
    providerRegions.innerHTML = '';
    state.regions.forEach((region) => {
      const option = document.createElement('option');
      option.value = region.id;
      option.textContent = region.label;
      providerRegions.append(option);
    });
  }
  populateProviderSetupChoices();

  const draft = loadQuoteDraft();
  if (draft && byId('quoteForm')) {
    fillForm(byId('quoteForm'), draft);
    setCurrentServiceAddress(getQuoteFormServiceAddress(), 'quote-draft');
    clearStaleMowAreaWithoutPolygon(byId('quoteForm'));
  }

  renderHomepageContent();
  renderCoverage();
  renderLocalLandingFromPath();
  hydrateRegionEditor();
  hydrateServiceEditor();
  scheduleEstimateRefresh('app-load');
}

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
    showAccountPanel('overview');
    return;
  }
  toggleAuthPanel(true);
});
byId('openAppDrawer')?.addEventListener('click', openAppDrawer);
byId('mobileMoreBtn')?.addEventListener('click', openAppDrawer);
byId('closeAppDrawer')?.addEventListener('click', closeAppDrawer);
byId('appDrawerOverlay')?.addEventListener('click', closeAppDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeAppDrawer();
    toggleAuthPanel?.(false);
  }
});
document.querySelectorAll('[data-drawer-view], [data-drawer-contact], [data-mobile-contact]').forEach((btn) => {
  btn.addEventListener('click', () => navigateFromElement(btn));
});

$$('[data-provider-tab]').forEach((btn) => {
  btn.addEventListener('click', () => renderProviderArea(btn.dataset.providerTab));
});

$$('[data-account-panel]').forEach((btn) => {
  btn.addEventListener('click', () => showAccountPanel());
});

$$('[data-open-auth]').forEach((btn) => {
  btn.addEventListener('click', () => {
    closeAppDrawer();
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
    showSuccess('Signed in');
    const adminTasks = json.user?.role === 'admin' ? [loadAdmin().catch(() => {}), loadAdminLeads().catch(() => {})] : [];
    await Promise.allSettled([loadProviders(), loadJobs(), loadMyJobs(), ...adminTasks]);
  } else {
    showError(json.error);
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
    showSuccess('Account created. Now log in.');
    showAuthTab('login');
  } else {
    showError(json.error);
  }
});

function friendlyAdminSaveError(error) {
  const message = prettyApiError(error);
  if (/missing auth token|unauthorized|invalid session|forbidden/i.test(message)) {
    return 'Please log in as an admin to save pricing changes.';
  }
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

function hydrateServiceEditor() {
  const select = byId('serviceEditorSelect');
  const service = state.services.find((item) => item.id === select?.value) || state.services[0];
  if (!service) return;

  if (byId('serviceBaseFee')) byId('serviceBaseFee').value = service.baseFee ?? 0;
  if (byId('serviceRate')) byId('serviceRate').value = service.ratePer1000Sqft ?? 0;
  if (byId('serviceMinimum')) byId('serviceMinimum').value = service.minimumPrice ?? 0;
}

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
          <label><span>Phone</span><input name="phone" type="tel" value="${escapeHtml(profile.phone || '')}" /></label>
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

async function updateEstimatePreview() {
  return refreshEstimate({ force: true });
}

async function geocodeAddress() {
  const form = byId('quoteForm');
  if (!form) return;

  const payload = formToObject(form);
  const q = [payload.address, payload.city, payload.state || 'AR', payload.zip]
    .filter(Boolean)
    .join(', ');

  if (!q.trim()) {
    showPropertyConfirmationPanel(true);
    return showResult('parcelInfo', '<strong>Enter an address first.</strong>');
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();

  if (!Array.isArray(data) || !data.length) {
    showPropertyConfirmationPanel(true);
    return showResult(
      'parcelInfo',
      '<strong>Address not found.</strong> Try adding city/state or use autocomplete.'
    );
  }

  const { lat, lon } = data[0];
  setCurrentServiceAddress(getQuoteFormServiceAddress(), 'typed-address');
  setLatLng(lat, lon);
  placeMarker(lat, lon);

  showResult(
    'parcelInfo',
    `<strong>Address located.</strong><br />Lat: ${Number(lat).toFixed(6)} � Lng: ${Number(lon).toFixed(6)}`
  );
}

function addressPartsFromGoogleComponents(components = []) {
  const getLong = (type) => components.find((component) => component.types?.includes(type))?.long_name || '';
  const getShort = (type) => components.find((component) => component.types?.includes(type))?.short_name || '';
  return normalizeServiceAddressParts({
    address: `${getLong('street_number')} ${getLong('route')}`.trim(),
    city:
      getLong('locality') ||
      getLong('sublocality') ||
      getLong('administrative_area_level_3') ||
      getLong('administrative_area_level_2') ||
      '',
    state: getShort('administrative_area_level_1') || 'AR',
    zip: getLong('postal_code') || '',
  });
}

function addressPartsFromNominatim(data = {}) {
  const address = data.address || {};
  const stateValue = address.state_code || (address.state === 'Arkansas' ? 'AR' : address.state);
  return normalizeServiceAddressParts({
    address: [address.house_number, address.road].filter(Boolean).join(' '),
    city:
      address.city ||
      address.town ||
      address.village ||
      address.hamlet ||
      address.municipality ||
      '',
    state: stateValue || 'AR',
    zip: address.postcode || '',
    full: data.display_name || '',
  });
}

async function reverseGeocodeServiceAddress(lat, lng) {
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return normalizeServiceAddressParts();

  if (window.google?.maps?.Geocoder) {
    try {
      const geocoder = new google.maps.Geocoder();
      const results = await new Promise((resolve, reject) => {
        geocoder.geocode({ location: point }, (items, status) => {
          if (status === 'OK') resolve(items || []);
          else reject(new Error(status || 'Google reverse geocode failed'));
        });
      });
      const first = results[0];
      if (first) {
        const parts = addressPartsFromGoogleComponents(first.address_components || []);
        parts.full = first.formatted_address || parts.full;
        return parts;
      }
    } catch (error) {
      console.warn('[Reverse Geocode Failed] google', error);
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lng)}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      return addressPartsFromNominatim(await res.json());
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.warn('[Reverse Geocode Failed] nominatim', error);
    return normalizeServiceAddressParts();
  }
}

async function fillMissingServiceAddressFromReverseGeocode(address, point = {}) {
  const current = normalizeServiceAddressParts(address || {});
  if (current.city && current.zip) return current;
  const reverse = await reverseGeocodeServiceAddress(point.lat, point.lng);
  if (!reverse.city && !reverse.zip) return current;

  const merged = normalizeServiceAddressParts({
    street: current.street || reverse.street,
    address: current.address || reverse.address,
    city: current.city || reverse.city,
    state: current.state || reverse.state || 'AR',
    zip: current.zip || reverse.zip,
    full: current.full || reverse.full,
  });

  console.log('[Service Address Reverse Geocode Fallback]', {
    point,
    reverse,
    final: merged,
  });

  return merged;
}

function parcelLookupPointFromGeometry(geometry = null) {
  const ring = geometry?.rings?.[0] || geometry?.coordinates?.[0]?.[0] || geometry?.coordinates?.[0] || [];
  const points = Array.isArray(ring) ? ring : [];
  const totals = points.reduce((acc, point) => {
    const lng = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return acc;
    acc.lat += lat;
    acc.lng += lng;
    acc.count += 1;
    return acc;
  }, { lat: 0, lng: 0, count: 0 });
  if (!totals.count) return null;
  return { lat: totals.lat / totals.count, lng: totals.lng / totals.count };
}

function quoteFormLatLng() {
  const form = byId('quoteForm');
  const lat = Number(form?.elements?.lat?.value || 0);
  const lng = Number(form?.elements?.lng?.value || 0);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat && lng ? { lat, lng } : null;
}

function showPropertyConfirmationPanel(visible = true) {
  byId('quoteParcelScreen')?.classList.toggle('hidden', !visible);
}

async function lookupParcel(options = {}) {
  const quoteForm = byId('quoteForm');
  const parcelInfo = byId('parcelInfo');
  if (!quoteForm || !parcelInfo) return;

  const lat = quoteForm.elements.lat.value;
  const lng = quoteForm.elements.lng.value;

  if (!lat || !lng) {
    showPropertyConfirmationPanel(true);
    return showResult(
      'parcelInfo',
      '<strong>No coordinates yet.</strong> Use Find Address or autocomplete first.'
    );
  }

  const address = quoteForm.elements.address?.value || '';
  const city = quoteForm.elements.city?.value || '';
  const zip = quoteForm.elements.zip?.value || '';

  const qs = new URLSearchParams({ lat, lng, address, city, zip });
  const data = await api(`/api/parcel/lookup?${qs.toString()}`);

  if (!data.ok) {
    const message = options.notFoundMessage || 'Parcel boundary not found. You can still draw the mowable area manually.';
    parcelInfo.innerHTML = options.hideNotFoundDetails
      ? `<strong>${escapeHtml(message)}</strong>`
      : `
        <strong>${escapeHtml(message)}</strong><br>
        Reason: ${escapeHtml(data.reason || 'unknown')}<br>
        You can still draw the mowable area manually.
      `;
    parcelInfo.classList.remove('hidden');
    showPropertyConfirmationPanel(true);
    clearParcelLayer();
    updateQuoteFlowState();
    if (!options.suppressNotFoundToast) {
      showWarning('Parcel lookup failed. You can still draw the area manually.');
    }
    return;
  }

  const normalized = data.normalized || {};
  const attrs = normalized.attributes || {};
  const parcelProps = parcelPropertiesFromLookupData(data);
  const fallbackAddress = options.allowAddressFallback === false ? {} : getQuoteFormServiceAddress();
  let serviceAddress = resolveServiceAddressFromParcel(parcelProps, fallbackAddress);
  serviceAddress = await fillMissingServiceAddressFromReverseGeocode(serviceAddress, { lat, lng });

  const parcelId = normalized.parcelId || propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN') || '';
  const ownerName = attrs.ownername || 'n/a';
  const addressLabel = propText(parcelProps, 'adrlabel') || 'n/a';
  const county = normalized.county || propText(attrs, 'countyid', 'county', 'COUNTY') || 'n/a';
  const geometry = data.feature?.geometry || null;
  state.parcelProperties = parcelProps;
  state.selectedParcelProperties = parcelProps;
  state.selectedParcel = { type: 'Feature', geometry: null, properties: parcelProps };

  quoteForm.elements.parcelId.value = parcelId;
  quoteForm.elements.lotAreaSqft.value = '';
  quoteForm.elements.mowAreaSqft.value = '';
  if (quoteForm.elements.customerAdjustedMowableSqft) quoteForm.elements.customerAdjustedMowableSqft.value = '';
  const serviceAddressSource = hasServiceAddress(serviceAddress)
    ? `parcel-${data.method || 'lookup'}`
    : options.allowAddressFallback === false
      ? 'parcel-no-address'
      : `parcel-${data.method || 'lookup'}`;
  setCurrentServiceAddress(serviceAddress, serviceAddressSource, {
    syncQuoteForm: true,
    clearQuoteFormMissing: true,
  });

  if (geometry) {
    drawParcel(geometry, parcelProps);
    const parcelAreaSqft = Number(normalized.areaSqft || 0)
      || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : 0);
    quoteForm.elements.lotAreaSqft.value = parcelAreaSqft || '';
    renderSuggestedMowablePanel(null);
    scheduleEstimateRefresh('parcel-loaded');
  }

  updateMowAreaHelper(
    Number(quoteForm.elements.lotAreaSqft.value || 0),
    Number(quoteForm.elements.mowAreaSqft.value || 0)
  );

  const lotSqft = Number(quoteForm.elements.lotAreaSqft.value || 0);
  const mowSqft = Number(quoteForm.elements.mowAreaSqft.value || 0);
  const customerLines = [
    '<strong>Parcel found. Boundary loaded.</strong>',
    addressLabel && addressLabel !== 'n/a' ? `Address: ${escapeHtml(addressLabel)}` : null,
    lotSqft > 0 ? `<span class="parcel-customer-acres">Lot Area: ${formatAcres(lotSqft)}</span>` : null,
    mowSqft > 0 ? `<span class="parcel-customer-acres">Mowable Area: ${formatAcres(mowSqft)}</span>` : null,
    'Use <strong>Lasso Yard</strong> to draw the mowable area.',
  ].filter(Boolean);
  const techLines = [
    `Match: ${escapeHtml(data.method || 'n/a')}`,
    `County: ${escapeHtml(county)}`,
    `Parcel ID: ${escapeHtml(parcelId || 'n/a')}`,
  ].join('<br>');

  parcelInfo.innerHTML = customerLines.join('<br>')
    + `<details class="parcel-tech-details"><summary>Advanced parcel details</summary>${techLines}</details>`;
  parcelInfo.classList.remove('hidden');
  showPropertyConfirmationPanel(true);

  saveQuoteDraft();
  scheduleEstimateRefresh('parcel-loaded');
  updateQuoteFlowState();
  showQuoteFlowStep('property');
}

async function lookupParcelByLatLng(lat, lng) {
  clearParcelLayer();
  clearMowLayer();
  renderSuggestedMowablePanel(null);
  setCurrentServiceAddress({}, 'gps-location', {
    syncQuoteForm: true,
    clearQuoteFormMissing: true,
  });
  setLatLng(lat, lng);
  placeCurrentLocationMarker(lat, lng);
  await lookupParcel({
    notFoundMessage: 'We found your location, but could not match a parcel here. Try typing the address.',
    hideNotFoundDetails: true,
    suppressNotFoundToast: true,
    allowAddressFallback: false,
  });
}

function setGpsStatus(message) {
  const statusEl = byId('gpsStatusMsg');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.classList.toggle('hidden', !message);
}

function setGpsButtonLocating(isLocating) {
  $$('[data-use-current-location]').forEach((btn) => {
    if (isLocating) {
      btn.dataset.originalText = btn.textContent || 'Use Current Location';
      btn.textContent = 'Finding your location...';
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || 'Use Current Location';
    delete btn.dataset.originalText;
  });
}

function gpsErrorMessage(error) {
  if (error?.code === 1) {
    return 'Location permission was denied. You can still type your address.';
  }
  return 'Could not get your location. Try again or type your address.';
}

/* ─────────────────────────────────────────────────────────────────────────
   PARCEL SELECT MODE  (tap/click map to pick a different parcel)
───────────────────────────────────────────────────────────────────────── */

function enterParcelSelectMode() {
  stopToolModes();
  state.parcelSelectMode = true;
  setMapMode('select');
  if (state.drawHandler?._enabled) state.drawHandler.disable();
  if (state.editHandler?._enabled) state.editHandler.disable();
  setEditorModeLabel('Mode: Tap a parcel on the map to select it');
  byId('selectParcelBtn')?.classList.add('active');
  byId('useThisParcelBar')?.classList.add('hidden');
}

function exitParcelSelectMode() {
  state.parcelSelectMode = false;
  state.parcelDblClick = false;
  if (getMapMode() === 'select') setMapMode('idle');
  state.pendingParcelPreviewFeature = null;
  updatePreviewParcelSource();
  state.pendingParcelPreviewLayer = null;
  state.pendingParcelFeature = null;
  setEditorModeLabel('Mode: Ready');
  byId('selectParcelBtn')?.classList.remove('active');
  byId('useThisParcelBar')?.classList.add('hidden');
}

async function applyParcelFromClick(latlng) {
  if (!state.parcelSelectMode) return;
  const { lat, lng } = latlng;
  let data;
  try {
    const qs = new URLSearchParams({ lat, lng });
    data = await api(`/api/parcel/lookup?${qs.toString()}`);
  } catch (err) {
    showError('Parcel lookup failed: ' + err.message);
    return;
  }
  if (!data.ok || !data.feature?.geometry) {
    showWarning('No parcel found here. Try tapping closer to a property boundary.');
    return;
  }
  const geometry = data.feature.geometry;
  const parcelProps = parcelPropertiesFromLookupData(data);
  data.lookupPoint = { lat, lng };
  state.pendingParcelPreviewFeature = esriPolygonToGeoJSONFeature(geometry, { ...parcelProps, role: 'parcel-preview' });
  state.pendingParcelPreviewLayer = state.pendingParcelPreviewFeature;
  updatePreviewParcelSource();
  state.pendingParcelFeature = data;
  if (state.parcelDblClick) {
    state.parcelDblClick = false;
    confirmParcelSelection().catch((error) => showError('Parcel selection failed: ' + prettyApiError(error)));
    return;
  }
  const bar = byId('useThisParcelBar');
  const addrEl = byId('useThisParcelAddr');
  if (bar && addrEl) {
    const attrs = data.normalized?.attributes || {};
    addrEl.textContent = attrs.adrlabel
      || [data.normalized?.address, data.normalized?.city].filter(Boolean).join(', ')
      || 'Parcel found';
    bar.classList.remove('hidden');
  }
}

async function confirmParcelSelection() {
  if (!state.pendingParcelFeature) return;
  const data = state.pendingParcelFeature;
  const geometry = data.feature?.geometry;
  const normalized = data.normalized || {};
  const attrs = normalized.attributes || {};
  const parcelProps = parcelPropertiesFromLookupData(data);
  let parcelAddress = resolveServiceAddressFromParcel(parcelProps, getQuoteFormServiceAddress());
  parcelAddress = await fillMissingServiceAddressFromReverseGeocode(
    parcelAddress,
    data.lookupPoint || quoteFormLatLng() || parcelLookupPointFromGeometry(geometry) || {}
  );
  clearMowableFeatures();
  state.mowUndoStack = [];
  state.parcelProperties = parcelProps;
  state.selectedParcelProperties = parcelProps;
  state.selectedParcel = { type: 'Feature', geometry: null, properties: parcelProps };
  if (geometry) drawParcel(geometry, parcelProps);
  const quoteForm = byId('quoteForm');
  if (quoteForm) {
    quoteForm.elements.parcelId.value = normalized.parcelId || propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN') || '';
    const sqft = Number(normalized.areaSqft || 0)
      || (state.parcelLayer ? layerAreaSqFt(state.parcelLayer) : 0);
    quoteForm.elements.lotAreaSqft.value = sqft || '';
    quoteForm.elements.mowAreaSqft.value = '';
    if (quoteForm.elements.customerAdjustedMowableSqft)
      quoteForm.elements.customerAdjustedMowableSqft.value = '';
    setCurrentServiceAddress(parcelAddress, 'manual-parcel-selection', {
      syncQuoteForm: true,
      clearQuoteFormMissing: true,
    });
  }
  renderSuggestedMowablePanel(null);
  scheduleEstimateRefresh('parcel-selected');
  syncMowAreaFromLayers();
  saveQuoteDraft();
  updateQuoteFlowState();
  const parcelInfo = byId('parcelInfo');
  if (parcelInfo) {
    const selQf = byId('quoteForm');
    const selAddrLabel = propText(parcelProps, 'adrlabel') || '';
    const selLotSqft = selQf ? Number(selQf.elements.lotAreaSqft.value || 0) : 0;
    const selCustomerLines = [
      '<strong>Parcel selected. Boundary loaded.</strong>',
      selAddrLabel ? `Address: ${escapeHtml(selAddrLabel)}` : null,
      selLotSqft > 0 ? `<span class="parcel-customer-acres">Lot Area: ${formatAcres(selLotSqft)}</span>` : null,
      'Use <strong>Lasso Yard</strong> to draw the mowable area.',
    ].filter(Boolean);
    const selTechLines = [
      `County: ${escapeHtml(normalized.county || propText(attrs, 'countyid', 'county', 'COUNTY') || 'n/a')}`,
      `Parcel ID: ${escapeHtml(normalized.parcelId || propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN') || 'n/a')}`,
    ].join('<br>');
    parcelInfo.innerHTML = selCustomerLines.join('<br>')
      + `<details class="parcel-tech-details"><summary>Advanced parcel details</summary>${selTechLines}</details>`;
    parcelInfo.classList.remove('hidden');
    showPropertyConfirmationPanel(true);
  }
  exitParcelSelectMode();
  showQuoteFlowStep('property');
}

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
      <div class="meta">${escapeHtml(provider.ownerName || '')} � Rating ${escapeHtml(provider.rating || 'n/a')}</div>
      <div class="meta">Regions: ${escapeHtml((provider.regions || []).map(regionLabel).join(', '))}</div>
      <div class="meta">Cities: ${escapeHtml((provider.cities || []).join(', '))}</div>
      <div class="meta">Services: ${escapeHtml((provider.servicesOffered || provider.services || []).map((id) => selectedServiceMeta(id).title || serviceLabel(id)).join(', '))}</div>
      <p>${escapeHtml(provider.bio || 'No bio yet.')}</p>
      <div class="meta">Equipment: ${escapeHtml(provider.equipment || 'n/a')}</div>
      <div class="meta">Main deck: ${provider.mowerDeckSizeInches || 'n/a'} in · Small-gate mower: ${provider.hasSmallGateMower ? 'yes' : 'no'}</div>
    `));
  });
}

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

  list.innerHTML = '';

  if (!data.jobs.length) {
    list.append(card('<h4>No open jobs yet</h4><div class="meta">Post a job to seed the marketplace board.</div>'));
    return;
  }

  data.jobs.forEach((job) => {
    const safe = sanitizeJobForPublic(job);
    list.append(card(`
      <h4>${escapeHtml(safe.title)}</h4>
      <div class="meta">${escapeHtml(serviceLabel(safe.serviceType))} &middot; ${escapeHtml(safe.location)}</div>
      <div class="meta">Estimate ${money(safe.amount)} &middot; Preferred ${escapeHtml(safe.preferredDate || 'Flexible')} &middot; ${statusBadge(safe.status)}</div>
    `));
  });
}

async function loadAdmin() {
  const metrics = byId('adminMetrics');
  if (!metrics) return;

  let data;
  try {
    data = await api('/api/admin/overview');
  } catch {
    metrics.innerHTML = '<div class="metric"><strong>�</strong><span>Sign in for admin metrics</span></div>';
    return;
  }

  metrics.innerHTML = `
    <div class="metric"><strong>${data.metrics.totalQuotes}</strong><span>Total quotes</span></div>
    <div class="metric"><strong>${data.metrics.openJobs}</strong><span>Open jobs</span></div>
    <div class="metric"><strong>${data.metrics.providers}</strong><span>Providers</span></div>
    <div class="metric"><strong>${money(data.metrics.revenuePipeline)}</strong><span>Revenue pipeline</span></div>
  `;

  const latestQuotes = byId('latestQuotes');
  if (latestQuotes) {
    latestQuotes.innerHTML = '';
    (data.latestQuotes.length
      ? data.latestQuotes
      : [{ name: 'No quotes yet', address: 'Start with the quote form.', estimate: 0, region_id: '', service_type: '' }]).forEach((quote) => {
        latestQuotes.append(card(`
          <h4>${escapeHtml(quote.name)}</h4>
          <div class="meta">${escapeHtml(regionLabel(quote.regionId || quote.region_id))} � ${escapeHtml(serviceLabel(quote.serviceType || quote.service_type))}</div>
          <div class="meta">${escapeHtml(quote.address || '')}</div>
          <div class="meta">Estimate ${money(quote.estimate)}</div>
        `));
    });
  }

  const latestJobs = byId('latestJobs');
  if (latestJobs) {
    latestJobs.innerHTML = '';
    (data.latestJobs.length
      ? data.latestJobs
      : [{ title: 'No jobs yet', details: 'Post a job to see it here.', regionId: '', serviceType: '' }]).forEach((job) => {
        latestJobs.append(card(`
          <h4>${escapeHtml(job.title)}</h4>
          <div class="meta">${escapeHtml(regionLabel(job.regionId || job.region_id))} � ${escapeHtml(serviceLabel(job.serviceType || job.service_type))}</div>
          <p>${escapeHtml(job.details || '')}</p>
        `));
    });
  }

  const latestProviders = byId('latestProviders');
  if (latestProviders) {
    latestProviders.innerHTML = '';
    (data.latestProviders?.length
      ? data.latestProviders
      : [{ businessName: 'No providers yet', ownerName: 'Invite local crews to join.' }]).forEach((provider) => {
        latestProviders.append(card(`
          <h4>${escapeHtml(provider.businessName)}</h4>
          <div class="meta">${escapeHtml(provider.ownerName || '')}</div>
        `));
    });
  }
}

async function loadAdminPaidJobs() {
  const list = byId('adminPaidJobsList');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--muted);padding:12px">Loading...</div>';
  try {
    const data = await api('/api/admin/paid-jobs');
    if (!data.jobs?.length) {
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No paid jobs found.</div>';
      return;
    }
    list.innerHTML = '';
    data.jobs.forEach((job) => {
      const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');
      list.append(card(`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px">
          <div>
            <h4 style="margin:0">${escapeHtml(job.title || 'Mowing job')}</h4>
            <div class="meta">${escapeHtml(addr)}</div>
            <div class="meta">Amount: <strong>${job.paymentAmount ? money(job.paymentAmount) : money(job.budget)}</strong> &middot; Service: ${escapeHtml(serviceLabel(job.serviceType))}</div>
            ${job.yard_access_notes ? `<div class="meta">Access: ${escapeHtml(job.yard_access_notes)}</div>` : ''}
            <div class="meta">Job ID: <code>${escapeHtml(job.id)}</code> &middot; ${statusBadge(job.status)}</div>
            ${job.paidAt ? `<div class="meta">Paid: ${escapeHtml(new Date(job.paidAt).toLocaleString())}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <select class="admin-job-status-select" data-job-id="${escapeHtml(job.id)}" style="width:auto;padding:6px 8px;font-size:13px">
              <option value="">Move to...</option>
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
        </div>
      `));
    });
    list.querySelectorAll('.admin-job-status-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const status = sel.value;
        const jobId = sel.dataset.jobId;
        if (!status || !jobId) return;
        sel.disabled = true;
        try {
          await api(`/api/admin/jobs/${encodeURIComponent(jobId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
          showSuccess(`Job ${jobId} moved to ${status}`);
          await loadAdminPaidJobs();
        } catch (err) {
          showError(prettyApiError(err));
          sel.disabled = false;
          sel.value = '';
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="color:var(--muted);padding:12px">Could not load paid jobs: ${escapeHtml(err.message)}</div>`;
  }
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
  return {
    ...payload,
    ...(hasServiceAddress(serviceAddress) ? serviceAddress : {}),
    name: payload.name || payload.customerName || '',
    phone,
    email: payload.email || payload.customerEmail || '',
    customerName: payload.customerName || payload.name || '',
    customerPhone: phone,
    customerEmail: payload.customerEmail || payload.email || '',
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
     <button class="btn primary" type="button" id="acceptQuoteBtn">Book &amp; Pay Securely</button>`
  );

  byId('acceptQuoteBtn')?.addEventListener('click', acceptPendingQuote);
}

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

function renderEstimateResult(payload) {
  const area = Number(payload.mowAreaSqft || 0);
  console.log('[TurfLynk Area Trace] E. renderEstimateResult | mowAreaSqft=' + area + ' lotAreaSqft=' + Number(payload.lotAreaSqft || 0) + ' estimate=' + payload.estimate + ' source=pendingQuote');
  if (area <= 0) {
    showMissingMowableAreaPrompt('quoteResult');
    return;
  }

  showResult(
    'quoteResult',
    `<div class="estimate-card">
      <div class="estimate-head">
        <div>
          <span class="pill">Instant mow estimate</span>
          <h3>${money(payload.estimate)}</h3>
          <p>${formatAcres(area)} mowable area. Standard mowing only.</p>
        </div>
        <div class="preview-pill"><span>Mowable area</span><strong>${formatSqft(area)}</strong></div>
      </div>
      <div class="scope-grid">
        <div>
          <h4>Includes</h4>
          <ul>${INCLUDED_MOW_TASKS.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
        <div>
          <h4>Not included</h4>
          <ul>${EXCLUDED_MOW_TASKS.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="final-review">
        <h4>Access review</h4>
        <div class="meta">Price shown: ${money(payload.estimate)}.</div>
        <div class="meta">${escapeHtml(buildAccessSummary(payload) || 'Gate/access: no special access entered.')}</div>
        <div class="meta">${escapeHtml(equipmentRecommendation(payload) || '')}</div>
      </div>
    </div>`
  );
}

function showLeadRequestPanel(payload) {
  const panel = byId('leadRequestPanel');
  if (!panel) return;

  const estimate = payload.estimate || 0;
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
    submitBtn.textContent = 'Book & Pay Securely';
  }
  const leadForm = byId('leadRequestForm');
  if (leadForm) {
    const fillBlank = (name, value) => {
      const field = leadForm.elements[name];
      if (field && !String(field.value || '').trim() && value) field.value = value;
    };
    fillBlank('customerName', payload.customerName || payload.name || '');
    fillBlank('customerPhone', payload.customerPhone || payload.phone || '');
    fillBlank('customerEmail', payload.customerEmail || payload.email || '');
  }

  panel.classList.remove('hidden');
  showQuoteFlowStep('request');
  updateQuoteStepper();

  // Fill blank customer fields from logged-in user profile (does not overwrite typed values)
  hydrateLeadFormFromUser(state.currentUser);
  if (state.currentUser) console.info('[Auth UI] showing signed-in controls on request panel');

  applyServiceAddressToLeadForm();
  console.log('[FINAL FORM STATE]', {
    city: document.getElementById('leadCity')?.value,
    state: document.getElementById('leadState')?.value,
    zip: document.getElementById('leadZip')?.value
  });
}

function hideManualQuotePanel() {
  const panel = byId('manualQuotePanel');
  if (panel) {
    panel.classList.add('hidden');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
  }
  showQuoteFlowStep('estimate');
  updateQuoteStepper();
}

function showManualQuotePanel(payload = {}) {
  const panel = byId('manualQuotePanel');
  if (!panel) return;

  const quoteForm = byId('quoteForm');
  const quoteFields = quoteForm ? formToObject(quoteForm) : {};
  const estimate = Number(payload.estimate || state.currentEstimate?.estimate || 0);
  syncServiceAddressFields(payload);

  const display = byId('manualQuoteEstimateDisplay');
  if (display) display.textContent = estimate > 0 ? money(estimate) : '-';

  const form = byId('manualQuoteForm');
  if (form) {
    if (form.elements.name) form.elements.name.value = payload.name || payload.customerName || form.elements.name.value || '';
    if (form.elements.phone) form.elements.phone.value = payload.phone || payload.customerPhone || form.elements.phone.value || '';
    if (form.elements.email) form.elements.email.value = payload.email || payload.customerEmail || form.elements.email.value || '';
    if (form.elements.notes) form.elements.notes.value = form.elements.notes.value || quoteFields.notes || '';
  }

  byId('manualQuoteResult')?.classList.add('hidden');
  $$('[data-quote-step-panel]').forEach((stepPanel) => {
    stepPanel.classList.remove('is-active');
    stepPanel.classList.add('is-hidden', 'hidden');
    stepPanel.hidden = true;
    stepPanel.setAttribute('aria-hidden', 'true');
  });
  panel.classList.remove('hidden');
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildManualQuoteRequestPayload(form) {
  const fd = new FormData(form);
  const contact = Object.fromEntries(fd.entries());
  const quoteForm = byId('quoteForm');
  const quotePayload = quoteForm ? buildQuotePayload(quoteForm) : {};
  const serviceAddress = getCurrentServiceAddress(quotePayload);
  const estimate = Number(state.currentEstimate?.estimate || state.pendingQuote?.estimate || quotePayload.estimate || 0);
  const preferredDayTime = String(contact.preferredDayTime || '').trim();
  const customerNotes = String(contact.notes || '').trim();
  const notes = [
    'Manual quote requested.',
    preferredDayTime ? `Preferred day/time: ${preferredDayTime}` : '',
    customerNotes ? `Customer notes: ${customerNotes}` : '',
    quotePayload.yard_access_notes ? `Yard access notes: ${quotePayload.yard_access_notes}` : '',
  ].filter(Boolean).join('\n');

  return {
    ...quotePayload,
    name: String(contact.name || '').trim(),
    phone: String(contact.phone || '').trim(),
    email: String(contact.email || '').trim(),
    customerName: String(contact.name || '').trim(),
    customerPhone: String(contact.phone || '').trim(),
    customerEmail: String(contact.email || '').trim(),
    preferredDayTime,
    notes,
    address: serviceAddress.address || quotePayload.address || '',
    city: serviceAddress.city || quotePayload.city || '',
    state: serviceAddress.state || quotePayload.state || 'AR',
    zip: serviceAddress.zip || quotePayload.zip || '',
    quote_type: 'manual_quote',
    quoteType: 'manual_quote',
    status: 'manual_requested',
    estimate,
    final_price: estimate,
  };
}

async function generateGuestEstimate(form) {
  const _preBuildFormMow = Number(form?.elements?.mowAreaSqft?.value || 0);
  const payload = buildQuotePayload(form);
  const _genLot = Number(payload.lotAreaSqft || 0);
  const _genMow = Number(payload.mowAreaSqft || 0);
  const _genLayers = getMowableFeatureCount();
  const _genPct = _genLot > 0 ? Math.round((_genMow / _genLot) * 100) : null;
  console.log('[TurfLynk Area Trace] D. generateGuestEstimate | mowAreaSqft=' + _genMow + ' lotAreaSqft=' + _genLot + (_genPct !== null ? ' (' + _genPct + '% of parcel)' : '') + ' layers=' + _genLayers + ' formFieldBeforeBuild=' + _preBuildFormMow + ' source=buildQuotePayload→drawGroup');

  // Hard guard: mowAreaSqft is suspiciously close to lotAreaSqft but the form field
  // (set by syncMowAreaFromLayers) showed a much smaller area — indicates stale/wrong drawGroup read
  if (
    _genLot > 0 &&
    _genMow >= _genLot * 0.98 &&
    _preBuildFormMow > 0 &&
    _preBuildFormMow < _genLot * 0.95
  ) {
    console.error('[TurfLynk Area Trace] HARD GUARD triggered | drawGroup=' + _genMow + ' ≈ lot=' + _genLot + ' but formField showed ' + _preBuildFormMow + ' — blocking estimate');
    showError('Selected lawn area looks inconsistent. Please redraw or save the mowable area again.');
    return;
  }

  if (Number(payload.mowAreaSqft || 0) <= 0) {
    setEstimateState('empty', { signature: estimateSignatureFromPayload(payload), payload });
    showMissingMowableAreaPrompt('quoteResult');
    return;
  }

  await refreshEstimate({ force: true, navigate: true, toast: true });
}

async function acceptPendingQuote() {
  const form = byId('quoteForm');
  if (!form) return;

  const payload = {
    ...(state.pendingQuote || {}),
    ...buildQuotePayload(form),
    ...currentJobScopeSnapshotFields(),
  };

  try {
    if (Number(payload.mowAreaSqft || 0) <= 0) {
      showMissingMowableAreaPrompt('quoteResult');
      return;
    }
    const scopeAcknowledged = Boolean(payload.standardMowScopeAck || byId('standardMowScopeAck')?.checked);
    if (!scopeAcknowledged) {
      showWarning('Please confirm the standard mowing scope before booking.');
      byId('standardMowScopeAck')?.focus();
      return;
    }
    payload.standardMowScopeAck = true;
    payload.scope_locked = true;

    const estimateData = await api('/api/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    payload.estimate = estimateData.estimate;
    state.pendingQuote = payload;

    const missing = quoteContactMissing(payload);
    if (missing.length) {
      showQuoteContactRequest(missing);
      return;
    }

    const btn = byId('acceptQuoteBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Accepting...';
    }

    const data = await api('/api/quotes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    // Merge API response with form data so bookQuoteAsJob has everything it needs
    state.lastQuote = { ...payload, ...data.quote };
    state.pendingQuote = null;

    showResult(
      'quoteResult',
      `<strong>Quote accepted.</strong><br>
       Estimated starting price: <strong>${money(data.quote.estimate)}</strong><br>
       Quote ID: ${escapeHtml(data.quote.id)}<br>
       Region: ${escapeHtml(regionLabel(data.quote.regionId || data.quote.region_id))}<br>
       Service: ${escapeHtml(serviceLabel(data.quote.serviceType || data.quote.service_type))}<br><br>
       <button class="btn primary" type="button" id="bookJobBtn" style="margin-top:4px">
         Book &amp; Pay Securely
       </button><br>
       <span class="meta">Stripe test checkout enabled. Use card 4242 4242 4242 4242.</span>`
    );

    byId('bookJobBtn')?.addEventListener('click', bookQuoteAsJob);

    saveQuoteDraft();
    if (isAdmin()) await loadAdmin().catch(() => {});

  } catch (error) {
    showResult('quoteResult', `<strong>Could not accept quote:</strong> ${escapeHtml(prettyApiError(error))}`);
    const btn = byId('acceptQuoteBtn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Accept Quote';
    }
  }
}

byId('quoteForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await generateGuestEstimate(event.target);
  } catch (error) {
    showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
    showError(prettyApiError(error));
  }
});

byId('previewEstimateBtn')?.addEventListener('click', async () => {
  const form = byId('quoteForm');
  if (!form) return;
  try {
    await generateGuestEstimate(form);
  } catch (error) {
    showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
    showError(prettyApiError(error));
  }
});
byId('cutMowableBtn')?.addEventListener('click', startCutMowable);
byId('undoCutBtn')?.addEventListener('click', undoLastCut);
byId('mapToolsToggle')?.addEventListener('click', () => {
  const panel = byId('mapToolsPanel');
  setMapToolPanelOpen(panel?.classList.contains('hidden'));
});
byId('closeMapTools')?.addEventListener('click', () => setMapToolPanelOpen(false));
byId('continueToDrawBtn')?.addEventListener('click', () => {
  if (!state.parcelLayer) {
    showWarning('Lookup the parcel before drawing.');
    return;
  }
  showQuoteFlowStep('draw');
});
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
byId('requestServiceBtn')?.addEventListener('click', async () => {
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
    showLeadRequestPanel(state.pendingQuote || buildQuotePayload(form));
  } catch (error) {
    showResult('quoteResult', `<strong>Estimate failed:</strong> ${escapeHtml(prettyApiError(error))}`);
    showError(prettyApiError(error));
  }
});

byId('manualQuoteBtn')?.addEventListener('click', async () => {
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
$$('[data-quote-back]').forEach((btn) => {
  btn.addEventListener('click', () => showQuoteFlowStep(btn.dataset.quoteBack || 'property'));
});
byId('saveAreaBtn')?.addEventListener('click', () => {
  stopToolModes();
  state.editSnapshot = null;
  syncMowAreaFromLayers();
  setMapToolPanelOpen(true);
});
byId('cancelEditAreaBtn')?.addEventListener('click', () => {
  const shouldRestoreEdit = state.quoteUiMode === 'editing' && Array.isArray(state.editSnapshot);
  stopToolModes();
  if (shouldRestoreEdit) {
    setMowableFeatures(state.editSnapshot);
    state.editSnapshot = null;
    syncMowAreaFromLayers();
  }
  state.quoteUiMode = 'idle';
  updateQuoteFlowState();
});
byId('locateAddressBtn')?.addEventListener('click', async () => {
  byId('gpsConfirmBar')?.classList.add('hidden');
  try {
    await geocodeAddress();
    await lookupParcel();
  } catch (error) {
    showError(prettyApiError(error));
  }
});

byId('lookupParcelBtn')?.addEventListener('click', () => {
  byId('gpsConfirmBar')?.classList.add('hidden');
  resetParcelQuoteStateForNewAddress();
  showPropertyConfirmationPanel(false);
  showQuoteFlowStep('property');
  byId('quoteForm')?.elements?.address?.focus?.();
});

async function requestCurrentLocation() {
  if (!navigator.geolocation) {
    setGpsStatus('GPS location is not supported on this device/browser.');
    return;
  }

  setGpsButtonLocating(true);
  setGpsStatus('Finding your location...');
  byId('gpsConfirmBar')?.classList.add('hidden');
  showPropertyConfirmationPanel(false);

  // Browser geolocation requires HTTPS in production, or localhost during development.
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude: lat, longitude: lng } = position.coords;
      setGpsStatus('Location found. Checking parcel...');
      try {
        await lookupParcelByLatLng(lat, lng);
        if (state.parcelLayer) {
          setGpsStatus('');
          showPropertyConfirmationPanel(true);
          if (state.serviceFlow === 'live_bid') hydrateLiveBidForm(byId('liveBidServiceType')?.value || 'other');
          byId('gpsConfirmBar')?.classList.remove('hidden');
        } else {
          setGpsStatus('We found your location, but could not match a parcel here. Try typing the address.');
        }
      } catch (err) {
        const message = prettyApiError(err) || 'Could not get your location. Try again or type your address.';
        setGpsStatus(message);
        showError(message);
      } finally {
        setGpsButtonLocating(false);
      }
    },
    (geoError) => {
      setGpsButtonLocating(false);
      const message = gpsErrorMessage(geoError);
      setGpsStatus(message);
      showError(message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

byId('propertyManualQuoteBtn')?.addEventListener('click', () => {
  hydrateLiveBidForm('other');
  setServiceFlow('live_bid');
  byId('liveBidPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$$('[data-use-current-location]').forEach((btn) => btn.addEventListener('click', requestCurrentLocation));

byId('gpsConfirmYesBtn')?.addEventListener('click', () => {
  byId('gpsConfirmBar')?.classList.add('hidden');
  showQuoteFlowStep('draw');
});

byId('gpsConfirmNoBtn')?.addEventListener('click', () => {
  byId('gpsConfirmBar')?.classList.add('hidden');
  clearParcelLayer();
  clearMowLayer();
  byId('gpsStatusMsg')?.classList.add('hidden');
  showPropertyConfirmationPanel(false);
  showQuoteFlowStep('property');
});
byId('aiDetectMowableBtn')?.addEventListener('click', aiDetectMowableArea);
byId('useParcelShapeBtn')?.addEventListener('click', cloneParcelAsMowable);
byId('lassoYardBtn')?.addEventListener('click', () => {
  if (state.parcelSelectMode) exitParcelSelectMode();
  state.quoteUiMode = 'drawing';
  updateQuoteFlowState();
});
byId('drawMowableBtn')?.addEventListener('click', () => {
  if (getMowableFeatureCount()) clearMowLayer();
  startDrawMowable();
});
byId('editMowableBtn')?.addEventListener('click', startEditMowable);
byId('deleteMowableBtn')?.addEventListener('click', startDeleteMowable);
byId('clearMowableBtn')?.addEventListener('click', clearMowLayer);
byId('clearMowAreaBtn')?.addEventListener('click', clearMowLayer);

byId('clearQuoteDraftBtn')?.addEventListener('click', () => {
  byId('quoteForm')?.reset();
  clearQuoteDraft();
  clearParcelLayer();
  clearMowLayer();
  byId('parcelInfo')?.classList.add('hidden');
  byId('quoteResult')?.classList.add('hidden');
  byId('leadRequestPanel')?.classList.add('hidden');
  renderSuggestedMowablePanel(null);
  setCurrentServiceAddress({}, 'quote-reset', {
    syncQuoteForm: false,
    clearQuoteFormMissing: false,
  });
  setEstimateState('empty', { signature: '', payload: null });
  showPropertyConfirmationPanel(false);
  showQuoteFlowStep('property');
});

function quoteAddressFieldChanged(event) {
  if (!['address', 'city', 'state', 'zip'].includes(event?.target?.name || '')) return;
  setCurrentServiceAddress(getQuoteFormServiceAddress(), 'quote-form-input');
}

byId('quoteForm')?.addEventListener('input', (event) => {
  quoteAddressFieldChanged(event);
  saveQuoteDraft();
  scheduleEstimateRefresh('input');
});

byId('quoteForm')?.addEventListener('change', (event) => {
  quoteAddressFieldChanged(event);
  saveQuoteDraft();
  scheduleEstimateRefresh('change');
  updateMowAreaHelper(
    Number(byId('quoteForm')?.elements?.lotAreaSqft?.value || 0),
    Number(byId('quoteForm')?.elements?.mowAreaSqft?.value || 0)
  );
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

byId('jobForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const form = event.target;
    const payload = formToObject(form);

    let photoUrls = [];
    const fileInput = byId('jobPhotos');

    if (fileInput && fileInput.files && fileInput.files.length) {
      const fd = new FormData();

      for (const file of fileInput.files) {
        fd.append('photos', file);
      }

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: fd
      });

      const uploadText = await uploadRes.text();
      let uploadData;

      try {
        uploadData = JSON.parse(uploadText);
      } catch {
        throw new Error(`Upload did not return JSON: ${uploadText.slice(0, 120)}`);
      }

      if (!uploadRes.ok || !uploadData.ok) {
        throw new Error(uploadData?.error || 'Upload failed');
      }

      photoUrls = (uploadData.files || []).map((f) => f.url);
    }

    payload.photos = photoUrls;

      if (!hasActiveSession()) {
        openAuthGate(() => form.requestSubmit());
        return;
      }

    const data = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    showResult(
      'jobResult',
      `<strong>Job posted.</strong><br />${escapeHtml(data.job.title)} is now live in ${escapeHtml(regionLabel(data.job.regionId || data.job.region_id))}.`
    );

    form.reset();
    await loadJobs();
    if (isAdmin()) await loadAdmin().catch(() => {});
  } catch (error) {
    showResult('jobResult', `<strong>Failed:</strong> ${escapeHtml(error.message)}`);
  }
});

byId('regionEditorSelect')?.addEventListener('change', hydrateRegionEditor);
byId('serviceEditorSelect')?.addEventListener('change', hydrateServiceEditor);

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
        featuredCities: String(byId('regionFeaturedCities')?.value || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        enabled: byId('regionEnabled')?.value === 'true',
      }),
    });

    showResult('regionEditorResult', '<strong>Region pricing saved.</strong>');
    await loadConfig();
  } catch (error) {
    showResult('regionEditorResult', `<strong>Could not save:</strong> ${escapeHtml(friendlyAdminSaveError(error))}`);
  }
});

byId('serviceEditorForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = byId('serviceEditorSelect')?.value;
  if (!id) return;

  try {
    await api(`/api/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        baseFee: Number(byId('serviceBaseFee')?.value || 0),
        ratePer1000Sqft: Number(byId('serviceRate')?.value || 0),
        minimumPrice: Number(byId('serviceMinimum')?.value || 0),
      }),
    });

    showResult('serviceEditorResult', '<strong>Service pricing saved.</strong>');
    await loadConfig();
  } catch (error) {
    showResult('serviceEditorResult', `<strong>Could not save:</strong> ${escapeHtml(friendlyAdminSaveError(error))}`);
  }
});

byId('jobPhotos')?.addEventListener('change', renderJobPhotoPreview);

byId('authForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = formToObject(event.target);
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {},
    });
    setAuthToken(data.token);
    showResult('authResult', `<strong>Signed in.</strong><br />${escapeHtml(data.user.email)} � ${escapeHtml(data.user.role)}`);
    const adminItems = data.user?.role === 'admin' ? [loadAdmin().catch(() => {})] : [];
    try { await Promise.allSettled([loadJobs(), loadProviders(), ...adminItems]); } catch {}
  } catch (error) {
    showResult('authResult', `<strong>Failed:</strong> ${escapeHtml(prettyApiError(error))}`);
  }
});

byId('whoAmIBtn')?.addEventListener('click', async () => {
  try {
    const data = await api('/api/auth/me');
    updateSessionStatus(data.user);
    showResult('authResult', `<strong>Session active.</strong><br />${escapeHtml(data.user.email)} � ${escapeHtml(data.user.role)}`);
  } catch (error) {
    showResult('authResult', `<strong>No active session.</strong><br />${escapeHtml(prettyApiError(error))}`);
    clearFrontendSessionState();
  }
});

async function handleAccountLogout() {
  await signOut();
  setActiveView('quote');
  showQuoteFlowStep('property');
}

byId('logoutBtn') && (byId('logoutBtn').onclick = handleAccountLogout);
byId('drawerLogoutBtn') && (byId('drawerLogoutBtn').onclick = handleAccountLogout);

byId('authPanelSignOutBtn')?.addEventListener('click', async () => {
  toggleAuthPanel(false);
  await signOut();
});

byId('aiRefineMowableBtn')?.addEventListener('click', aiRefineMowableArea);

byId('applyAiCutoutsBtn')?.addEventListener('click', applyAiCutouts);

byId('refreshProviders')?.addEventListener('click', loadProviders);

byId('quoteForm')?.elements?.lotAreaSqft?.addEventListener('input', () => {
  const form = byId('quoteForm');
  refreshAreaDisplays(form.elements.lotAreaSqft.value, form.elements.mowAreaSqft.value);
});
byId('quoteForm')?.elements?.mowAreaSqft?.addEventListener('input', () => {
  const form = byId('quoteForm');
  refreshAreaDisplays(form.elements.lotAreaSqft.value, form.elements.mowAreaSqft.value);
});
byId('refreshJobs')?.addEventListener('click', loadJobs);
byId('refreshRegions')?.addEventListener('click', loadConfig);
byId('refreshServices')?.addEventListener('click', loadConfig);
byId('refreshAdmin')?.addEventListener('click', loadAdmin);
byId('editAiCutoutsBtn')?.addEventListener('click', startEditAiCutouts);

/* ─────────────────────────────────────────────────────────────────────────
   LEAD REQUEST FORM — public service request submission
───────────────────────────────────────────────────────────────────────── */

byId('closeleadRequestPanel')?.addEventListener('click', () => {
  byId('leadRequestPanel')?.classList.add('hidden');
  showQuoteFlowStep('estimate');
  updateQuoteStepper();
});

byId('closeManualQuotePanel')?.addEventListener('click', hideManualQuotePanel);
byId('cancelManualQuotePanel')?.addEventListener('click', hideManualQuotePanel);

byId('manualQuoteForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = byId('manualQuoteSubmitBtn');
  const result = byId('manualQuoteResult');
  const originalText = btn?.textContent || 'Submit Request';

  try {
    const payload = buildManualQuoteRequestPayload(e.target);
    const missing = [];
    if (!payload.name) missing.push('name');
    if (!isValidLookingPhone(payload.phone)) missing.push('phone');
    if (missing.length) {
      if (missing.includes('phone')) showPhoneRequiredError('manualQuoteResult');
      else showError(`Add ${missing.join(', ')} to request an in-person quote.`);
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting...';
    }

    const data = await api('/api/quotes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    state.lastQuote = { ...payload, ...data.quote };
    state.pendingQuote = state.lastQuote;
    rememberProfilePhoneIfBlank(payload.phone);
    if (result) {
      result.innerHTML = `<strong>Request sent.</strong><br>Quote ID: ${escapeHtml(data.quote?.id || '')}<br><span class="meta">No payment was started.</span>`;
      result.classList.remove('hidden');
    }
    showSuccess('In-person quote request sent');
    if (isAdmin()) await loadAdmin().catch(() => {});
  } catch (err) {
    if (result) {
      result.innerHTML = `<strong>Could not submit:</strong> ${escapeHtml(prettyApiError(err))}`;
      result.classList.remove('hidden');
    }
    showError(prettyApiError(err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
});

byId('leadRequestForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  console.log('[MowNWA Checkout Debug] leadRequestForm submit fired');
  const btn = byId('leadSubmitBtn');

  try {
    const form = e.target;
    const currentServiceAddress = syncServiceAddressFields();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    if (form.elements.customerPhone) form.elements.customerPhone.value = String(form.elements.customerPhone.value || '').trim();
    payload.customerPhone = String(payload.customerPhone || '').trim();
    payload.phone = payload.customerPhone;
    const requestAvailableDays = checkedValues('available_days_json', form);

    // Merge in the quote form address/service data from hidden fields
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
      payload.quoteType = payload.quote_type;
      payload.service_frequency = qd.service_frequency || '';
      payload.grass_height_range = qd.grass_height_range || '';
      payload.selected_yard_areas = checkedValues('selected_yard_areas', quoteForm);
      payload.gate_size_category = qd.gate_size_category || '';
      payload.gate_access_type = qd.gate_size_category || qd.gate_access_type || '';
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
      payload.pets = qd.pets || '';
      payload.pet_waste_level = qd.pet_waste_level || '';
      payload.obstacles_list = checkedValues('obstacles_list', quoteForm);
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
      estimate,
      final_price: estimate,
      scope_locked: true,
      standardMowScopeAck: true,
    });

    const missing = bookingContactMissing(bookingQuote);
    console.log('[MowNWA Checkout Debug] bookingContactMissing result:', missing);
    if (missing.length) {
      if (missing.includes('phone')) showPhoneRequiredError('leadRequestResult');
      else showError(`Add ${missing.join(', ')} to continue to secure checkout.`);
      return;
    }

    // Validation passed — disable button now
    if (btn) { btn.disabled = true; btn.textContent = 'Opening checkout...'; }

    state.lastQuote = bookingQuote;
    state.pendingQuote = bookingQuote;
    await bookQuoteAsJob(btn);

  } catch (err) {
    const result = byId('leadRequestResult');
    if (result) {
      result.innerHTML = `<strong>Could not submit:</strong> ${escapeHtml(err.message)}`;
      result.classList.remove('hidden');
    }
    showError(err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Book & Pay Securely'; }
  }
});

byId('liveBidPhotos')?.addEventListener('change', () => {
  renderFilePreview(byId('liveBidPhotos'), byId('liveBidPhotoPreview'));
});

byId('liveBidForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = byId('liveBidSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const form = e.target;
    const payload = formToObject(form);
    const photoUrls = await uploadPhotoInput(byId('liveBidPhotos'));
    const tasks = checkedValues('requested_tasks', form);
    payload.quote_type = payload.quote_type || 'live_bid';
    payload.quoteType = payload.quote_type;
    payload.service_types = tasks.length ? tasks : [payload.serviceType || 'other_outdoor_work'];
    payload.requested_tasks = payload.service_types;
    payload.available_days_json = checkedValues('available_days_json', form);
    payload.gate_access_type = payload.gate_size_category || payload.gate_access_type || '';
    payload.yard_access_notes = payload.yard_access_notes || payload.access_notes || '';
    payload.community_access_private = Boolean(payload.community_access_instructions);
    payload.photos = photoUrls;
    payload.photo_count = photoUrls.length;
    payload.status = 'new';
    payload.ai_summary_json = aiPhotoPlaceholder({
      detected_services: payload.service_types,
      live_bid_recommended: true,
    });
    payload.access_summary = buildAccessSummary(payload);

    const missingContact = !payload.customerName || !payload.customerPhone;
    if (missingContact && !hasActiveSession()) {
      state.pendingExtraBid = payload;
      openAuthGate(async () => {
        await submitBidRequest(payload, 'liveBidResult');
        form.reset();
        renderFilePreview(byId('liveBidPhotos'), byId('liveBidPhotoPreview'));
      });
      return;
    }

    await submitBidRequest(payload, 'liveBidResult');
    form.reset();
    renderFilePreview(byId('liveBidPhotos'), byId('liveBidPhotoPreview'));
    showSuccess('Bid request submitted');
  } catch (err) {
    showResult('liveBidResult', `<strong>Could not submit:</strong> ${escapeHtml(err.message)}`);
    showError(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Bid Request'; }
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   ADMIN LEADS DASHBOARD
───────────────────────────────────────────────────────────────────────── */

async function loadAdminLeads() {
  const list = byId('leadsList');
  if (!list) return;

  if (!hasActiveSession()) {
    list.innerHTML = '<div style="color:var(--muted);padding:12px">Sign in as admin to view leads. Use the ADMIN_API_KEY as your Bearer token.</div>';
    return;
  }

  list.innerHTML = '<div style="color:var(--muted);padding:12px">Loading leads...</div>';

  try {
    const statusFilter = byId('leadsStatusFilter')?.value || '';
    const serviceFilter = byId('leadsServiceFilter')?.value || '';
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (serviceFilter) params.set('serviceType', serviceFilter);
    const qs = params.toString() ? '?' + params.toString() : '';

    const [data, bidData] = await Promise.all([
      api('/api/admin/jobs' + qs),
      api('/api/admin/bid-requests' + qs).catch(() => ({ bidRequests: [] })),
    ]);
    list.innerHTML = '';

    if ((!data.jobs || !data.jobs.length) && (!bidData.bidRequests || !bidData.bidRequests.length)) {
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No leads yet. Customer service requests will appear here after submission.</div>';
      return;
    }

    const instantBookings = (data.jobs || []).filter((lead) => (lead.quote_type || lead.quoteType || 'instant_mow') === 'instant_mow');
    const otherLeads = (data.jobs || []).filter((lead) => (lead.quote_type || lead.quoteType || 'instant_mow') !== 'instant_mow');

    if (instantBookings.length) {
      const heading = document.createElement('div');
      heading.className = 'admin-group-title';
      heading.textContent = 'Instant mow bookings';
      list.append(heading);
    }

    [...instantBookings, ...otherLeads].forEach((lead) => {
      const estimateText = lead.estimatedPrice > 0 ? money(lead.estimatedPrice) : (lead.suggestedBudget > 0 ? `Budget: ${money(lead.suggestedBudget)}` : 'No estimate');
      const mowText = lead.mowAreaSqft > 0 ? `${formatAcres(lead.mowAreaSqft)} (${Number(lead.mowAreaSqft).toLocaleString()} sq ft) mowable` : '';
      const autoText = lead.autoEstimatedMowableSqft > 0 ? `${formatAcres(lead.autoEstimatedMowableSqft)} (${Number(lead.autoEstimatedMowableSqft).toLocaleString()} sq ft) suggested` : '';
      const parcelText = lead.parcelAreaSqft > 0 ? `${formatAcres(lead.parcelAreaSqft)} (${Number(lead.parcelAreaSqft).toLocaleString()} sq ft) parcel` : '';
      const dateText = lead.preferredDate ? `Preferred: ${lead.preferredDate}` : 'Date flexible';
      const accessText = buildAccessSummary(lead);
      const scheduleText = buildScheduleSummary(lead);
      const equipmentText = equipmentRecommendation(lead);
      const requestedTasks = (lead.requested_tasks || lead.requestedTasks || []).join(', ');

      const c = card(`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <h4 style="margin:0 0 4px">${escapeHtml(lead.customerName || 'Anonymous')}</h4>
            <div class="meta">${escapeHtml(lead.customerPhone || '')}${lead.customerEmail ? ' &nbsp;&middot;&nbsp; ' + escapeHtml(lead.customerEmail) : ''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${statusBadge(lead.status)}
            <select class="lead-status-select" data-lead-id="${escapeHtml(lead.id)}" style="padding:7px 10px;border-radius:10px;font-size:.85rem;width:auto">
              <option value="new" ${lead.status === 'new' ? 'selected' : ''}>New</option>
              <option value="quoted" ${lead.status === 'quoted' ? 'selected' : ''}>Quoted</option>
              <option value="bidding" ${lead.status === 'bidding' ? 'selected' : ''}>Bidding</option>
              <option value="scheduled" ${lead.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
              <option value="completed" ${lead.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="canceled" ${lead.status === 'canceled' ? 'selected' : ''}>Canceled</option>
            </select>
          </div>
        </div>
        <div class="meta" style="margin-top:8px">${escapeHtml(lead.address || '')}${lead.city ? ', ' + escapeHtml(lead.city) : ''}${lead.zip ? ' ' + escapeHtml(lead.zip) : ''}</div>
        <div class="meta">${escapeHtml(serviceLabel(lead.serviceType))} &nbsp;&middot;&nbsp; ${escapeHtml(lead.quote_type || 'instant_mow')} &nbsp;&middot;&nbsp; ${estimateText}${mowText ? ' &nbsp;&middot;&nbsp; ' + escapeHtml(mowText) : ''}</div>
        ${(autoText || parcelText || lead.mowableEstimateConfidence || lead.buildingFootprintsSource) ? `<div class="meta">${escapeHtml([parcelText, autoText, lead.mowableEstimateConfidence ? `confidence: ${lead.mowableEstimateConfidence}` : '', lead.buildingFootprintsSource ? `source: ${lead.buildingFootprintsSource}` : ''].filter(Boolean).join(' - '))}</div>` : ''}
        ${accessText ? `<div class="meta">Gate/access: ${escapeHtml(accessText)}</div>` : ''}
        ${scheduleText ? `<div class="meta">Scheduling: ${escapeHtml(scheduleText)}</div>` : ''}
        ${equipmentText ? `<div class="meta">${escapeHtml(equipmentText)}</div>` : ''}
        ${requestedTasks ? `<div class="meta">Requested tasks: ${escapeHtml(requestedTasks)}</div>` : ''}
        ${lead.photos?.length ? `<div class="meta">Photos: ${lead.photos.length}</div>` : ''}
        ${lead.aiSummaryJson ? `<div class="mini-card notice admin-ai-note"><strong>AI notes placeholder</strong><span>${escapeHtml(lead.aiSummaryJson.customer_summary || 'Rough photo guidance only. Provider bid required.')}</span></div>` : ''}
        <div class="meta">${dateText} &nbsp;&middot;&nbsp; ${new Date(lead.createdAt).toLocaleString()}</div>
        ${lead.notes ? `<p style="margin:6px 0 0;font-size:.9rem">${escapeHtml(lead.notes)}</p>` : ''}
        <div class="tool-row admin-actions"><button class="btn secondary small" type="button">Create bid / assign provider</button></div>
        <div class="meta" style="font-size:.8rem;margin-top:4px">ID: ${escapeHtml(lead.id)} &nbsp;&middot;&nbsp; Source: ${escapeHtml(lead.sourceBrand || 'MowNWA')}</div>
      `);

      list.append(c);
    });

    if (bidData.bidRequests?.length) {
      const heading = document.createElement('div');
      heading.className = 'admin-group-title';
      heading.textContent = 'Live bid requests';
      list.append(heading);

      bidData.bidRequests.forEach((bid) => {
        const services = (bid.service_types || []).join(', ') || 'other_outdoor_work';
        const aiSummary = bid.ai_summary_json || {};
        const bidAccess = buildAccessSummary(bid);
        const bidSchedule = buildScheduleSummary(bid);
        const c = card(`
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div>
              <h4 style="margin:0 0 4px">${escapeHtml(bid.customerName || 'Live bid request')}</h4>
              <div class="meta">${escapeHtml(bid.customerPhone || '')}${bid.customerEmail ? ' &nbsp;&middot;&nbsp; ' + escapeHtml(bid.customerEmail) : ''}</div>
            </div>
            ${statusBadge(bid.status || 'new')}
          </div>
          <div class="meta" style="margin-top:8px">${escapeHtml(bid.address || '')}${bid.city ? ', ' + escapeHtml(bid.city) : ''}${bid.zip ? ' ' + escapeHtml(bid.zip) : ''}</div>
          <div class="meta">Services: ${escapeHtml(services)} &nbsp;&middot;&nbsp; Photos: ${(bid.photos || []).length} &nbsp;&middot;&nbsp; Quoted separately</div>
          ${bidAccess ? `<div class="meta">Gate/access: ${escapeHtml(bidAccess)}</div>` : ''}
          ${bidSchedule ? `<div class="meta">Scheduling: ${escapeHtml(bidSchedule)}</div>` : ''}
          <div class="photo-preview-grid">${(bid.photos || []).map((url) => `<img src="${escapeHtml(url)}" alt="Bid request photo" class="job-photo" />`).join('')}</div>
          <div class="mini-card notice admin-ai-note"><strong>AI notes placeholder</strong><span>${escapeHtml(aiSummary.customer_summary || 'Rough photo guidance only. Final amount should come from provider bid.')}</span></div>
          ${bid.notes ? `<p style="margin:6px 0 0;font-size:.9rem">${escapeHtml(bid.notes)}</p>` : ''}
          <div class="tool-row admin-actions"><button class="btn primary small" type="button">Create bid</button><button class="btn secondary small" type="button">Assign provider</button></div>
          <div class="meta" style="font-size:.8rem;margin-top:4px">ID: ${escapeHtml(bid.id)}${bid.related_job_id ? ' &nbsp;&middot;&nbsp; Job: ' + escapeHtml(bid.related_job_id) : ''}</div>
        `);
        list.append(c);
      });
    }

    // Wire status dropdowns
    list.querySelectorAll('.lead-status-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const leadId = sel.dataset.leadId;
        const status = sel.value;
        try {
          await api(`/api/admin/jobs/${leadId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status }),
          });
          await loadAdminLeads();
        } catch (err) {
          showError('Could not update status: ' + err.message);
        }
      });
    });

  } catch (err) {
    list.innerHTML = `<div style="color:var(--muted);padding:12px">Could not load leads: ${escapeHtml(err.message)}</div>`;
  }
}

byId('refreshLeadsBtn')?.addEventListener('click', loadAdminLeads);
byId('leadsStatusFilter')?.addEventListener('change', loadAdminLeads);
byId('leadsServiceFilter')?.addEventListener('change', loadAdminLeads);
byId('refreshAdminPaidJobsBtn')?.addEventListener('click', loadAdminPaidJobs);
byId('refreshProviderPaidJobsBtn')?.addEventListener('click', loadProviderPaidJobs);
function resetParcelQuoteStateForNewAddress() {
  const form = byId('quoteForm');

  clearParcelLayer();
  clearMowLayer();

  if (form) {
    form.elements.parcelId.value = '';
    form.elements.lotAreaSqft.value = '';
    form.elements.mowAreaSqft.value = '';
    form.elements.lotSource.value = '';
    MOWABLE_ESTIMATE_FIELDS.forEach((name) => {
      if (form.elements[name]) form.elements[name].value = '';
    });
  }

  updateMowAreaHelper(0, 0);
  renderSuggestedMowablePanel(null);
  setEstimateState('empty', { signature: '', payload: null });
  setCurrentServiceAddress({}, 'address-reset', {
    syncQuoteForm: false,
    clearQuoteFormMissing: false,
  });
}

function selectedPlaceIsInArkansas(place) {
  const stateComponent = (place?.address_components || [])
    .find((component) => component.types?.includes('administrative_area_level_1'));

  return stateComponent?.short_name === 'AR' || stateComponent?.long_name === 'Arkansas';
}

function initAddressAutocomplete() {
  const input =
    byId('quoteAddressInput') ||
    document.querySelector('#quoteForm input[name="address"]');

  if (!input || !window.google?.maps?.places) {
    console.warn('Google Places not loaded � autocomplete disabled');
    return;
  }

  // Google componentRestrictions only restricts by country. Arkansas state limiting
  // is done with bounds/strictBounds plus a post-selection state check.
  const autocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'us' },
    bounds: ARKANSAS_BOUNDS,
    strictBounds: true,
    fields: ['formatted_address', 'geometry', 'address_components', 'place_id'],
    types: ['address'],
  });

  autocomplete.addListener('place_changed', () => {
    resetParcelQuoteStateForNewAddress();

    const place = autocomplete.getPlace();
    if (!place?.geometry?.location) return;

    if (!selectedPlaceIsInArkansas(place)) {
      showWarning('Please choose an Arkansas address for now.');
      return;
    }

    const form = byId('quoteForm');
    if (!form) return;

    const components = place.address_components || [];

    const getLong = (type) =>
      components.find((c) => c.types.includes(type))?.long_name || '';

    const getShort = (type) =>
      components.find((c) => c.types.includes(type))?.short_name || '';

    form.elements.address.value =
      `${getLong('street_number')} ${getLong('route')}`.trim() ||
      place.formatted_address ||
      input.value;

    form.elements.city.value =
      getLong('locality') ||
      getLong('sublocality') ||
      getLong('administrative_area_level_3') ||
      '';

    form.elements.state.value =
      getShort('administrative_area_level_1') || 'AR';

    form.elements.zip.value = getLong('postal_code') || '';
    setCurrentServiceAddress(getQuoteFormServiceAddress(), 'google-places');

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    setLatLng(lat, lng);
    placeMarker(lat, lng);
    saveQuoteDraft();
    scheduleEstimateRefresh('address-autocomplete');

    setTimeout(() => {
      lookupParcel().catch((error) => {
        console.warn('Autocomplete parcel lookup failed', error);
      });
}, 100);
  });
}

// applyRoleVisibility() → public/js/auth/admin-visibility.js

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

/* ─────────────────────────────────────────────────────────────────────────
   AUTH GATE — shown when unauthenticated user tries to book a service
───────────────────────────────────────────────────────────────────────── */

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

// Close on backdrop click
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
    showError(err.message);
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
    // Auto-login after register
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
    showError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   QUOTE → JOB BOOKING
───────────────────────────────────────────────────────────────────────── */

async function bookQuoteAsJob(explicitBtn) {
  if (!state.lastQuote && state.pendingQuote) {
    state.lastQuote = state.pendingQuote;
  }

  if (!state.lastQuote) {
    showResult('quoteResult', '<strong>Get an estimate, then continue to secure checkout.</strong>');
    return;
  }

  const btn = explicitBtn || byId('bookJobBtn') || byId('leadSubmitBtn') || byId('requestServiceBtn');
  const originalText = btn?.id === 'leadSubmitBtn' ? 'Book & Pay Securely' : (btn?.textContent || 'Book & Pay Securely');
  console.log('[MowNWA Checkout Debug] bookQuoteAsJob start | btn=' + (btn?.id || 'none'));

  try {
    const q = normalizeBookingContact(state.lastQuote);
    const missing = bookingContactMissing(q);
    if (missing.length) {
      showBookingContactPanel(q);
      if (missing.includes('phone')) {
        showPhoneRequiredError('leadRequestResult');
      } else {
        showWarning(`Add ${missing.join(', ')} to continue to secure checkout.`);
      }
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Opening checkout...'; }

    const serviceLabel = q.serviceType
      ? String(q.serviceType).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
      : 'Mowing';
    const currentScopeFields = currentJobScopeSnapshotFields();

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
      title: `${serviceLabel} — ${q.address || 'Property'}`,
      customerName: q.customerName || q.name || '',
      customerPhone: q.customerPhone || q.phone || '',
      customerEmail: q.customerEmail || q.email || '',
      name: q.name || q.customerName || '',
      phone: q.phone || q.customerPhone || '',
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

      // Critical for server-side Stripe pricing.
      // The checkout route recalculates from mowAreaSqft/settings and must not receive zero area.
      mowAreaSqft: Number(q.mowAreaSqft || 0),
      lotAreaSqft: Number(q.lotAreaSqft || 0),
      areaSqft: Number(q.mowAreaSqft || 0),

      final_price: Number(q.estimate || 0),
      payment_status: 'checkout_pending',
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
      estimate: Number(q.estimate || 0),
      final_price: Number(q.estimate || 0),
      mowAreaSqft: Number(q.mowAreaSqft || 0),
      lotAreaSqft: Number(q.lotAreaSqft || 0),
      job: payload,
    };
    console.log('[MowNWA Checkout Debug] payload to /api/checkout/instant-mow | mowAreaSqft=' + checkoutBody.mowAreaSqft + ' lotAreaSqft=' + checkoutBody.lotAreaSqft);
    const checkout = await api('/api/checkout/instant-mow', {
      method: 'POST',
      body: JSON.stringify(checkoutBody),
    });
    rememberProfilePhoneIfBlank(q.phone || q.customerPhone);
    console.log('[MowNWA Checkout Debug] checkout API response | ok=' + checkout.ok + ' session=' + (checkout.checkoutSessionId ? checkout.checkoutSessionId.slice(0, 12) + '...' : 'none') + ' url=' + (checkout.checkoutUrl ? 'present' : 'missing'));
    if (checkout.checkoutUrl) {
      if (btn) { btn.disabled = false; btn.textContent = btn.id === 'leadSubmitBtn' ? 'Book & Pay Securely' : (btn.textContent || 'Book & Pay Securely'); }
      window.location.href = checkout.checkoutUrl;
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
        customerPhone: q.phone || '',
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
       <button class="btn secondary small" type="button"
         onclick="setActiveView('jobs')">View My Bookings &rarr;</button>`
    );

    await loadMyJobs();
    if (isAdmin()) await loadAdmin().catch(() => {});
  } catch (error) {
    showResult('quoteResult', `<strong>Booking failed:</strong> ${escapeHtml(error.message)}`);
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
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
  state.pendingCheckoutUrl = null;
  hideAccountRecommend();
  if (url) window.location.href = url;
}

byId('accountRecommendGuestBtn')?.addEventListener('click', () => {
  proceedToCheckout();
});

byId('accountRecommendCreateBtn')?.addEventListener('click', () => {
  const authForm = byId('accountRecommendAuthForm');
  if (authForm) authForm.classList.toggle('hidden');
});

byId('accountRecommendLoginToggle')?.addEventListener('click', () => {
  byId('accountRecommendRegisterForm')?.classList.add('hidden');
  byId('accountRecommendLoginForm')?.classList.remove('hidden');
});

byId('accountRecommendRegisterToggle')?.addEventListener('click', () => {
  byId('accountRecommendLoginForm')?.classList.add('hidden');
  byId('accountRecommendRegisterForm')?.classList.remove('hidden');
});

byId('accountRecommendRegisterForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = byId('accountRecommendRegisterBtn');
  const result = byId('accountRecommendAuthResult');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }
  try {
    const fd = new FormData(e.target);
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName: fd.get('fullName'), email: fd.get('email'), password: fd.get('password') }),
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
    proceedToCheckout();
  } catch (err) {
    if (result) {
      result.innerHTML = `<strong>Could not create account:</strong> ${escapeHtml(prettyApiError(err))}`;
      result.classList.remove('hidden');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account & Proceed to Checkout'; }
  }
});

byId('accountRecommendLoginForm')?.addEventListener('submit', async (e) => {
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
    proceedToCheckout();
  } catch (err) {
    if (result) {
      result.innerHTML = `<strong>Could not sign in:</strong> ${escapeHtml(prettyApiError(err))}`;
      result.classList.remove('hidden');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In & Proceed to Checkout'; }
  }
});

async function handleAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  if (!auth) return false;

  if (auth === 'error') {
    const provider = params.get('provider') || 'account';
    showError(`${provider.charAt(0).toUpperCase() + provider.slice(1)} sign-in could not be completed. Please try email instead.`);
    return false;
  }

  if (auth !== 'success') return false;

  try {
    const meData = await api('/api/auth/me');
    state.currentUser = meData.user;
    updateSessionStatus(meData.user);
    applyRoleVisibility();
    showSuccess('Signed in');
  } catch {
    showError('Signed in, but the app could not restore your session yet.');
    return false;
  }

  const context = loadAuthReturnContext();
  const rawStep = params.get('step') || context?.step || context?.currentStep || 'request';
  const step = rawStep === 'manual' ? 'manual' : normalizeQuoteStep(rawStep);
  const source = context?.source || params.get('source') || 'none';

  if (context) {
    console.info('[Auth Resume] found context', {
      source: context.source,
      step: context.step,
      hasQuote: Boolean(context.quote?.estimate),
      hasGeoJSON: Boolean(context.drawnGeoJSON?.features?.length),
      hasCustomerName: Boolean(context.customerFields?.customerName),
    });
  }
  console.info(`[Auth Resume] restoring source=${source} step=${step}`);

  if (context?.quote) {
    state.pendingQuote = context.quote;
    state.lastQuote = context.quote;
  }

  if (context?.pendingCheckoutUrl) {
    state.pendingCheckoutUrl = context.pendingCheckoutUrl;
  }

  if (context?.quoteFormData) {
    const quoteForm = byId('quoteForm');
    if (quoteForm) {
      Object.entries(context.quoteFormData).forEach(([key, value]) => {
        const field = quoteForm.elements[key];
        if (!field || value == null) return;
        field.value = value;
      });
    }
  }

  // Restore drawn polygon to the map source so the lasso area re-appears on the map
  if (context?.drawnGeoJSON?.features?.length) {
    state.mowableFeatureCollection = cloneFeatureCollection(context.drawnGeoJSON);
    state.drawGroup = state.mowableFeatureCollection;
    window.mowableFeatureCollection = state.mowableFeatureCollection;
    updateMowableSource();
    console.info('[Auth Resume] restored mowable geometry', { features: state.mowableFeatureCollection.features.length });
  }

  // Restore parcel GeoJSON so scope snapshot captures it on submission after redirect
  if (context?.parcelGeoJSON) {
    state.parcelFeature = context.parcelGeoJSON;
    state.parcelLayer = context.parcelGeoJSON;
    if (state.pendingQuote && !state.pendingQuote.parcelGeoJSON) {
      state.pendingQuote = { ...state.pendingQuote, parcelGeoJSON: context.parcelGeoJSON };
      state.lastQuote = state.pendingQuote;
    }
    withMapReady(() => {
      updateParcelSource();
    });
    console.info('[Auth Resume] restored parcel GeoJSON');
  }

  // Pre-set the target step so setActiveView('quote') renders the right panel without flash
  state.quoteFlowStep = step === 'manual'
    ? 'estimate'
    : step === 'request'
      ? 'request'
      : step;

  setActiveView('quote');

  const quotePayload = context?.quote || state.pendingQuote || null;
  console.info('[Auth Resume] navigating to step=' + step);
  if (step === 'manual' && quotePayload) {
    showManualQuotePanel(quotePayload);
  } else if (step === 'request' && quotePayload) {
    showLeadRequestPanel(quotePayload);
  } else if (step === 'draw' || step === 'estimate' || step === 'property') {
    showQuoteFlowStep(step, { scroll: false });
  } else if (quotePayload) {
    showLeadRequestPanel(quotePayload);
  } else {
    showQuoteFlowStep('estimate', { scroll: false });
  }

  // Restore customer/job fields typed before social login redirect
  if (context?.customerFields) {
    const leadForm = byId('leadRequestForm');
    if (leadForm) {
      const cf = context.customerFields;
      if (cf.customerName) leadForm.elements.customerName.value = cf.customerName;
      if (cf.customerPhone) leadForm.elements.customerPhone.value = cf.customerPhone;
      if (cf.customerEmail && leadForm.elements.customerEmail) leadForm.elements.customerEmail.value = cf.customerEmail;
      if (cf.notes && leadForm.elements.notes) leadForm.elements.notes.value = cf.notes;
      if (cf.preferredDate && leadForm.elements.preferredDate) leadForm.elements.preferredDate.value = cf.preferredDate;
      if (cf.schedule_preference && leadForm.elements.schedule_preference) leadForm.elements.schedule_preference.value = cf.schedule_preference;
      if (Array.isArray(cf.available_days_json)) {
        $$('input[name="available_days_json"]', leadForm).forEach((cb) => {
          cb.checked = cf.available_days_json.includes(cb.value);
        });
      }
      console.info('[Auth Resume] restored forms', {
        customerName: Boolean(cf.customerName),
        customerPhone: Boolean(cf.customerPhone),
      });
    }
    const manualForm = byId('manualQuoteForm');
    if (manualForm) {
      const cf = context.customerFields;
      if (cf.customerName && manualForm.elements.name) manualForm.elements.name.value = cf.customerName;
      if (cf.customerPhone && manualForm.elements.phone) manualForm.elements.phone.value = cf.customerPhone;
      if (cf.customerEmail && manualForm.elements.email) manualForm.elements.email.value = cf.customerEmail;
      if (cf.notes && manualForm.elements.notes) manualForm.elements.notes.value = cf.notes;
      if (cf.preferredDayTime && manualForm.elements.preferredDayTime) manualForm.elements.preferredDayTime.value = cf.preferredDayTime;
    }
  }

  // Re-apply the single service address source after auth-return form restoration.
  if (quotePayload) setCurrentServiceAddress(getCurrentServiceAddress(quotePayload), 'auth-return');
  applyServiceAddressToLeadForm();
  // Fill name/email blanks from the freshly-loaded user profile
  hydrateLeadFormFromUser(state.currentUser);
  console.info('[Auth UI] showing signed-in controls after auth return');
  console.info(`[Auth Resume] restored step=${step}`);

  clearAuthReturnContext();
  console.info('[Auth Resume] cleared');

  params.delete('auth');
  params.delete('provider');
  params.delete('reason');
  params.delete('step');
  const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next || '/');

  return true;
}

/* ─────────────────────────────────────────────────────────────────────────
   MY BOOKINGS (customer) + OPEN JOBS (provider)
───────────────────────────────────────────────────────────────────────── */

function statusBadge(status) {
  return `<span class="status-badge ${escapeHtml(status || 'open')}">${escapeHtml(status || 'open')}</span>`;
}

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

async function loadMyJobs(targetId = 'myJobsList') {
  const list = byId(targetId);
  if (!list) return;

  if (!hasActiveSession()) {
    list.innerHTML = '<div style="color:var(--muted);padding:12px">Sign in to see your bookings.</div>';
    return;
  }

  list.innerHTML = '<div style="color:var(--muted);padding:12px">Loading…</div>';

  try {
    const data = await api('/api/jobs/my');
    list.innerHTML = '';

    if (!data.jobs.length) {
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No bookings yet. Get an estimate, accept the quote, then book service.</div>';
      return;
    }

    data.jobs.forEach((job) => {
      const safe = sanitizeJobForPublic(job);
      const scopeHtml = renderJobScopeSnapshot(job, safe);
      const c = card(`
        <h4>${escapeHtml(safe.title || 'Lawn Service')}</h4>
        <div class="meta">${escapeHtml(serviceLabel(safe.serviceType))} &middot; ${escapeHtml(safe.location)}</div>
        <div class="meta">Price: <strong>${money(safe.amount)}</strong> &nbsp;&middot;&nbsp; ${statusBadge(safe.status)}</div>
        ${scopeHtml}
        <div class="meta" style="font-size:.85rem">Booked: ${safe.postedAt ? new Date(safe.postedAt).toLocaleDateString() : 'n/a'}</div>
      `);
      list.append(c);
    });
  } catch {
    list.innerHTML = '<div style="color:var(--muted);padding:12px">Could not load bookings (sign in required).</div>';
  }
}

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

// Wire My Bookings panel buttons
byId('showMyJobsBtn')?.addEventListener('click', () => {
  byId('myBookingsPanelTitle') && (byId('myBookingsPanelTitle').textContent = 'My Bookings');
  loadMyJobs();
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

byId('selectParcelBtn')?.addEventListener('click', () => {
  if (state.parcelSelectMode) exitParcelSelectMode();
  else enterParcelSelectMode();
});

byId('useThisParcelConfirmBtn')?.addEventListener('click', () => {
  confirmParcelSelection().catch((error) => showError('Parcel selection failed: ' + prettyApiError(error)));
});
byId('useThisParcelCancelBtn')?.addEventListener('click', exitParcelSelectMode);

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

window.addEventListener('popstate', () => {
  renderLocalLandingFromPath();
  setActiveView('dashboard');
});

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (!checkout) return;

  const sessionId = params.get('session_id');
  const jobId = params.get('job_id');

  // Clear URL params early so refresh doesn't re-trigger
  window.history.replaceState({}, '', window.location.pathname);

  if (checkout === 'success') {
    setActiveView('quote');
    showQuoteFlowStep('estimate');
    const successPanel = byId('checkoutSuccessPanel');
    const cancelPanel = byId('checkoutCancelPanel');
    if (cancelPanel) { cancelPanel.style.display = 'none'; cancelPanel.classList.add('hidden'); }
    if (successPanel) {
      successPanel.style.display = '';
      successPanel.classList.remove('hidden');
      const contentEl = byId('checkoutSuccessContent');
      if (contentEl) contentEl.innerHTML = '<div style="color:var(--muted);padding:12px">Loading receipt&hellip;</div>';
      successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (sessionId) {
      try {
        const data = await api(`/api/payments/session/${encodeURIComponent(sessionId)}`);
        renderCheckoutSuccess(data.session);
      } catch {
        const contentEl = byId('checkoutSuccessContent');
        if (contentEl) {
          contentEl.innerHTML = `<p><strong>Payment received.</strong> Your mow is booked.</p>
            <p class="meta">Your receipt is being processed. Check My Bookings for status.</p>
            <button class="btn secondary small" type="button" onclick="setActiveView('jobs')">View My Bookings</button>`;
        }
      }
    }
    if (hasActiveSession()) loadMyJobs().catch(() => {});
  } else if (checkout === 'cancel') {
    setActiveView('quote');
    showQuoteFlowStep('estimate');
    const successPanel = byId('checkoutSuccessPanel');
    const cancelPanel = byId('checkoutCancelPanel');
    if (successPanel) { successPanel.style.display = 'none'; successPanel.classList.add('hidden'); }
    if (cancelPanel) {
      cancelPanel.style.display = '';
      cancelPanel.classList.remove('hidden');
      const contentEl = byId('checkoutCancelContent');
      if (contentEl) {
        contentEl.innerHTML = `<p>Your card was not charged. You can return to the quote and book when ready.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button class="btn primary" type="button" onclick="showQuoteFlowStep('estimate')">Return to Quote</button>
            <button class="btn ghost" type="button" onclick="setActiveView('quote')">Start Over</button>
          </div>`;
      }
      cancelPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    showWarning('Checkout canceled. Your card was not charged.');
  }
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
          <button class="btn primary small" type="button" id="successCreateAccountBtn">Create Account / Set Password</button>
          <form id="successSetPasswordForm" class="stack hidden" style="gap:10px;margin-top:12px">
            <input type="hidden" name="token" value="${escapeHtml(accountSetup.token)}" />
            <label><span>Password</span><input name="password" type="password" autocomplete="new-password" required minlength="8" /></label>
            <label><span>Confirm Password</span><input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" /></label>
            <button class="btn primary" type="submit" id="successSetPasswordSubmitBtn">Set Password</button>
            <div id="successSetPasswordResult" class="result hidden"></div>
          </form>
        ` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${hasActiveSession() ? `<button class="btn secondary small" type="button" onclick="setActiveView('jobs')">View My Bookings</button>` : ''}
        ${isGuest && !canSetPassword ? `<button class="btn secondary small" type="button" id="successCreateAccountBtn">Log In / Create Account</button>` : ''}
        <button class="btn ghost small" type="button" onclick="setActiveView('quote')">Return Home</button>
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

(async function init() {
  applySocialLoginVisibility();
  initNavigation();
  initMap();

  renderHomepageContent();
  renderCoverage();
  renderLocalLandingFromPath();

  try {
    await loadConfig();
  } catch (error) {
    console.warn('Could not load pricing/config yet; showing local landing content only.', error);
  }

  if (state.config?.maps?.googleApiKey) {
    try {
      await loadGoogleMaps(state.config.maps.googleApiKey);
      initAddressAutocomplete();
    } catch (e) {
      console.warn('Google Maps failed to load', e);
    }
  } else {
    console.warn('No Google Maps API key returned from /api/config');
  }

  // Resolve current user so role-based UI works for bearer and cookie sessions.
  try {
    const meData = await api('/api/auth/me');
    state.currentUser = meData.user;
    updateSessionStatus(meData.user);
    hydrateLeadFormFromUser(meData.user); // pre-fill blanks for already-logged-in sessions
  } catch {
    clearFrontendSessionState();
  }
  applyRoleVisibility();
  const authResumed = await handleAuthReturn();
  handleCheckoutReturn();

  updateSessionStatus();
  // loadAdmin() and loadAdminLeads() are triggered by applyRoleVisibility() above when admin
  await Promise.allSettled([loadProviders(), loadJobs()]);

  const form = byId('quoteForm');
  const lat = form?.elements?.lat?.value;
  const lng = form?.elements?.lng?.value;

  if (lat && lng) {
    placeMarker(lat, lng);
    // Skip parcel lookup on auth return because it would navigate back to Property and undo the resume.
    if (!authResumed) lookupParcel().catch((error) => showWarning(prettyApiError(error)));
  } else if (!authResumed) {
    updateMowAreaHelper(0, 0);
    showQuoteFlowStep(state.quoteFlowStep || 'property', { scroll: false });
  }
  updateQuoteFlowState();
})();




// Guard: keep property/parcel confirmation UI hidden outside quote flow
(function guardPropertyUiOutsideQuote() {
  function sync() {
    const isQuote = document.body?.dataset?.activeView === "quote";
    if (isQuote) return;

    for (const id of ["gpsConfirmBar", "parcelInfo"]) {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    }

    document.querySelectorAll(".parcel-actions-card").forEach((el) => {
      el.classList.add("hidden");
    });
  }

  document.addEventListener("DOMContentLoaded", sync);
  document.addEventListener("click", () => setTimeout(sync, 50));
  setInterval(sync, 1000);
})();
