'use strict';

(function () {
  const WIDTH = 320;
  const HEIGHT = 180;
  const PAD = 14;
  const FALLBACK_CENTER = [-94.1288, 36.1867];
  const FALLBACK_ZOOM = 17;
  const FALLBACK_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const FALLBACK_TILE_ATTRIBUTION = 'Tiles Esri';
  const scopeRegistry = new Map();
  const activeMaps = new Set();
  let scopeIdCounter = 0;

  function cloneJson(value) {
    if (!value) return null;
    try {
      return typeof value === 'string' ? JSON.parse(value) : JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function asFeatureCollection(value) {
    const geo = cloneJson(value);
    if (!geo || typeof geo !== 'object') return null;
    if (geo.type === 'FeatureCollection') {
      return { type: 'FeatureCollection', features: Array.isArray(geo.features) ? geo.features.filter(Boolean) : [] };
    }
    if (geo.type === 'Feature') return { type: 'FeatureCollection', features: [geo] };
    if (['Polygon', 'MultiPolygon'].includes(geo.type)) {
      return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: geo }] };
    }
    return null;
  }

  function featureCount(value) {
    const fc = asFeatureCollection(value);
    return fc?.features?.length || 0;
  }

  function snapshotFromJob(job = {}) {
    return cloneJson(job.scopeSnapshot || job.job_scope_snapshot || job.scope_snapshot || {});
  }

  function snapshotHasGeo(scope = {}) {
    return Boolean(
      featureCount(scope.selectedMowableGeoJSON || scope.selectedMowableGeoJson || scope.mowableGeoJSON || scope.mowableGeoJson)
      || featureCount(scope.parcelGeoJSON || scope.parcelGeoJson)
    );
  }

  function moneyValue(scope = {}) {
    const value = Number(scope.estimateAmountShownAtBooking || scope.paidAmount || scope.finalAmount || 0);
    if (!value) return '';
    return `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }

  function areaLabel(value) {
    const sqft = Math.round(Number(value || 0));
    return sqft > 0 ? `${sqft.toLocaleString()} sq ft` : '';
  }

  function escapeText(value) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function collectRingsFromGeometry(geometry = {}) {
    if (geometry.type === 'Polygon') return geometry.coordinates || [];
    if (geometry.type === 'MultiPolygon') return (geometry.coordinates || []).flat();
    return [];
  }

  function collectPoints(scope = {}) {
    const values = [
      scope.parcelGeoJSON || scope.parcelGeoJson,
      scope.selectedMowableGeoJSON || scope.selectedMowableGeoJson || scope.mowableGeoJSON || scope.mowableGeoJson,
      scope.excludedGeoJSON || scope.excludedGeoJson,
    ];
    const points = [];
    values.forEach((value) => {
      const fc = asFeatureCollection(value);
      (fc?.features || []).forEach((feature) => {
        collectRingsFromGeometry(feature.geometry || {}).forEach((ring) => {
          (ring || []).forEach((point) => {
            const lng = Number(point?.[0]);
            const lat = Number(point?.[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) points.push([lng, lat]);
          });
        });
      });
    });
    return points;
  }

  function boundsFromPoints(points = []) {
    if (!points.length) return null;
    return points.reduce((bounds, point) => ({
      west: Math.min(bounds.west, point[0]),
      south: Math.min(bounds.south, point[1]),
      east: Math.max(bounds.east, point[0]),
      north: Math.max(bounds.north, point[1]),
    }), { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity });
  }

  function normalizeBounds(bounds) {
    if (!bounds) return null;
    const next = { ...bounds };
    const lngPad = Math.max((next.east - next.west) * 0.08, 0.00008);
    const latPad = Math.max((next.north - next.south) * 0.08, 0.00008);
    next.west -= lngPad;
    next.east += lngPad;
    next.south -= latPad;
    next.north += latPad;
    return next;
  }

  function projectPoint(point, bounds) {
    const lngSpan = Math.max(bounds.east - bounds.west, 0.000001);
    const latSpan = Math.max(bounds.north - bounds.south, 0.000001);
    const x = PAD + ((Number(point[0]) - bounds.west) / lngSpan) * (WIDTH - PAD * 2);
    const y = HEIGHT - PAD - ((Number(point[1]) - bounds.south) / latSpan) * (HEIGHT - PAD * 2);
    return [Math.max(PAD, Math.min(WIDTH - PAD, x)), Math.max(PAD, Math.min(HEIGHT - PAD, y))];
  }

  function pathForRing(ring = [], bounds) {
    const commands = (ring || [])
      .map((point) => projectPoint(point, bounds))
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    return commands.length ? `${commands.join(' ')} Z` : '';
  }

  function pathsForGeoJson(value, bounds, className) {
    const fc = asFeatureCollection(value);
    return (fc?.features || []).flatMap((feature) => (
      collectRingsFromGeometry(feature.geometry || {}).map((ring) => pathForRing(ring, bounds)).filter(Boolean)
    )).map((path) => `<path class="${className}" d="${escapeText(path)}"></path>`).join('');
  }

  function staticScopeSvgInner(scope = {}) {
    const bounds = boundsFromPoints(collectPoints(scope));
    if (!bounds) return `<div class="job-scope-unavailable">${escapeText('Map snapshot saved, but geometry could not be displayed.')}</div>`;

    const parcel = pathsForGeoJson(scope.parcelGeoJSON || scope.parcelGeoJson, bounds, 'job-scope-static-parcel');
    const mowable = pathsForGeoJson(
      scope.selectedMowableGeoJSON || scope.selectedMowableGeoJson || scope.mowableGeoJSON || scope.mowableGeoJson,
      bounds,
      'job-scope-static-mowable'
    );
    const cutout = pathsForGeoJson(scope.excludedGeoJSON || scope.excludedGeoJson, bounds, 'job-scope-static-cutout');

    return `
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Paid job scope outline" focusable="false">
        <rect class="job-scope-static-bg" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="6"></rect>
        ${parcel}
        ${mowable}
        ${cutout}
      </svg>
    `;
  }

  function staticScopeSvg(scope = {}) {
    return `
      <div class="job-scope-map job-scope-static-map" data-job-scope-static-map aria-label="Read-only paid job scope map">
        ${staticScopeSvgInner(scope)}
      </div>
    `;
  }

  function registerScope(scope = {}) {
    const id = `job-scope-${Date.now().toString(36)}-${scopeIdCounter += 1}`;
    scopeRegistry.set(id, cloneJson(scope) || {});
    return id;
  }

  function snapshotCenter(scope = {}) {
    const points = collectPoints(scope);
    const bounds = boundsFromPoints(points);
    if (!bounds) return FALLBACK_CENTER;
    return [
      (bounds.west + bounds.east) / 2,
      (bounds.south + bounds.north) / 2,
    ];
  }

  function isVisibleMapHost(container) {
    if (!container || !container.isConnected) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(container) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = container.getBoundingClientRect();
    return rect.width >= 40 && rect.height >= 40;
  }

  function ensureMapHostSize(container) {
    if (!container) return;
    container.style.minHeight = container.style.minHeight || '260px';
    container.style.height = container.style.height || '';
  }

  function jobScopeMapStyle() {
    return {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tiles: [window.SATELLITE_TILE_URL || FALLBACK_TILE_URL],
          tileSize: 256,
          attribution: window.SATELLITE_TILE_ATTRIBUTION || FALLBACK_TILE_ATTRIBUTION,
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    };
  }

  function upsertGeoJsonSource(map, id, data) {
    if (!data) return false;
    const source = map.getSource(id);
    if (source?.setData) {
      source.setData(data);
      return true;
    }
    map.addSource(id, { type: 'geojson', data });
    return true;
  }

  function addFillAndLineLayers(map, sourceId, fillId, lineId, fillColor, lineColor, lineWidth) {
    if (!map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': fillColor,
          'fill-opacity': 0.38,
        },
      });
    }
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': lineColor,
          'line-width': lineWidth,
        },
      });
    }
  }

  function renderScopeLayers(map, scope = {}) {
    const parcel = asFeatureCollection(scope.parcelGeoJSON || scope.parcelGeoJson);
    const mowable = asFeatureCollection(scope.selectedMowableGeoJSON || scope.selectedMowableGeoJson || scope.mowableGeoJSON || scope.mowableGeoJson);
    const cutout = asFeatureCollection(scope.excludedGeoJSON || scope.excludedGeoJson);

    if (upsertGeoJsonSource(map, 'job-scope-parcel', parcel)) {
      addFillAndLineLayers(map, 'job-scope-parcel', 'job-scope-parcel-fill', 'job-scope-parcel-line', '#38bdf8', '#e0f2fe', 2);
    }
    if (upsertGeoJsonSource(map, 'job-scope-mowable', mowable)) {
      addFillAndLineLayers(map, 'job-scope-mowable', 'job-scope-mowable-fill', 'job-scope-mowable-line', '#22c55e', '#dcfce7', 3);
    }
    if (upsertGeoJsonSource(map, 'job-scope-cutout', cutout)) {
      addFillAndLineLayers(map, 'job-scope-cutout', 'job-scope-cutout-fill', 'job-scope-cutout-line', '#ef4444', '#fecaca', 2);
    }

    const fit = normalizeBounds(boundsFromPoints(collectPoints(scope)));
    if (fit && typeof maplibregl !== 'undefined') {
      map.fitBounds(
        new maplibregl.LngLatBounds([fit.west, fit.south], [fit.east, fit.north]),
        { padding: 34, maxZoom: 19, duration: 0 }
      );
    }
  }

  function resizeJobScopeMap(map) {
    if (!map?.resize) return;
    requestAnimationFrame(() => {
      try { map.resize(); } catch {}
    });
    setTimeout(() => {
      try { map.resize(); } catch {}
    }, 180);
  }

  function fallbackToStaticMap(container, scope = {}) {
    if (!container) return;
    container.classList.add('job-scope-static-map');
    container.innerHTML = staticScopeSvgInner(scope);
  }

  function cleanupDetachedMaps() {
    activeMaps.forEach((entry) => {
      if (entry.container?.isConnected) return;
      try { entry.map?.remove?.(); } catch {}
      activeMaps.delete(entry);
    });
  }

  function createJobScopeMap(container, scope = {}) {
    if (!container || container.__jobScopeMap) {
      resizeJobScopeMap(container?.__jobScopeMap);
      return;
    }
    if (typeof maplibregl === 'undefined') {
      fallbackToStaticMap(container, scope);
      return;
    }
    if (!isVisibleMapHost(container)) {
      scheduleJobScopeMap(container, scope);
      return;
    }

    ensureMapHostSize(container);
    container.classList.remove('job-scope-static-map');
    container.innerHTML = '';

    const map = new maplibregl.Map({
      container,
      center: snapshotCenter(scope),
      zoom: FALLBACK_ZOOM,
      attributionControl: false,
      style: jobScopeMapStyle(),
    });
    container.__jobScopeMap = map;
    activeMaps.add({ container, map });

    try {
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    } catch {}

    map.on('load', () => {
      renderScopeLayers(map, scope);
      resizeJobScopeMap(map);
    });
    resizeJobScopeMap(map);
  }

  function scheduleJobScopeMap(container, scope = {}) {
    if (!container || container.__jobScopeMapScheduled) return;
    container.__jobScopeMapScheduled = true;

    const tryInit = () => {
      if (!container.isConnected) return;
      if (!isVisibleMapHost(container)) return;
      container.__jobScopeMapScheduled = false;
      createJobScopeMap(container, scope);
      resizeJobScopeMap(container.__jobScopeMap);
    };

    requestAnimationFrame(tryInit);
    [80, 180, 420, 900].forEach((delay) => setTimeout(tryInit, delay));

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (container.__jobScopeMap) {
          resizeJobScopeMap(container.__jobScopeMap);
          return;
        }
        tryInit();
        if (container.__jobScopeMap || !container.isConnected) ro.disconnect();
      });
      ro.observe(container);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(() => {
        tryInit();
        if (container.__jobScopeMap || !container.isConnected) io.disconnect();
      });
      io.observe(container);
    }
  }

  function scopeSnapshotMapHtml(jobOrScope = {}, options = {}) {
    const scope = jobOrScope.scopeSnapshot || jobOrScope.scope_snapshot || jobOrScope.job_scope_snapshot
      ? snapshotFromJob(jobOrScope)
      : cloneJson(jobOrScope);
    if (!scope || !Object.keys(scope).length) {
      return `<div class="job-scope-unavailable">${escapeText(options.unavailableText || 'Scope snapshot unavailable for this older job.')}</div>`;
    }

    const mowSqft = areaLabel(scope.mowableSqft || scope.mowableAreaSqFt || scope.mowAreaSqft);
    const lotSqft = areaLabel(scope.lotSqft || scope.lotAreaSqFt || scope.lotAreaSqft);
    const price = moneyValue(scope);
    const label = scope.parcelLabel || scope.addressLabel || scope.address?.full || '';
    const noGeo = !snapshotHasGeo(scope);
    const scopeId = noGeo ? '' : registerScope(scope);

    return `
      <div class="job-scope-map-card" data-job-scope-card>
        <div class="job-scope-map-head">
          <strong>Paid scope snapshot</strong>
          <span>${escapeText([mowSqft ? `Mowable ${mowSqft}` : '', lotSqft ? `Lot ${lotSqft}` : '', price].filter(Boolean).join(' · '))}</span>
        </div>
        ${label ? `<div class="meta">${escapeText(label)}</div>` : ''}
        ${noGeo
          ? `<div class="job-scope-unavailable">${escapeText(options.noGeoText || 'Scope snapshot unavailable for this older job.')}</div>`
          : `<div class="job-scope-map" data-job-scope-map="${escapeText(scopeId)}" aria-label="Read-only paid job scope map"><div class="job-scope-map-loading">Loading map...</div></div>`}
      </div>
    `;
  }

  function initJobScopeSnapshotMaps(root = document) {
    const scopeRoot = root?.querySelectorAll ? root : document;
    cleanupDetachedMaps();
    const containers = Array.from(scopeRoot.querySelectorAll('[data-job-scope-map]'));
    containers.forEach((container) => {
      ensureMapHostSize(container);
      const scope = scopeRegistry.get(container.dataset.jobScopeMap) || {};
      scheduleJobScopeMap(container, scope);
      if (container.__jobScopeMap) resizeJobScopeMap(container.__jobScopeMap);
    });
    console.info('[JobScopeMap] job detail map hosts initialized', { maps: containers.length });
    window.turflynkCanvasDiagnostics?.('job scope map hosts', { maps: containers.length });
  }

  window.jobScopeSnapshotFeatureCount = featureCount;
  window.jobScopeSnapshotHasGeo = snapshotHasGeo;
  window.jobScopeSnapshotMapHtml = scopeSnapshotMapHtml;
  window.initJobScopeSnapshotMaps = initJobScopeSnapshotMaps;
})();
