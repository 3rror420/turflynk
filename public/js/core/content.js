// Homepage / local content rendering — extracted from app.js (Phase 13b)
// Depends on globals: escapeHtml, card (dom.js), byId (dom.js), $$  (dom.js),
//   state, SERVICE_CATALOG (config.js), setActiveView, selectServiceCard (app.js)

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
      <div class="meta">Multiplier ${region.marketMultiplier} · Travel ${money(region.travelFee)} · Minimum ${money(region.minimumJob)}</div>
    `));
  });
}
