(function () {
  let armed = false;
  let drawing = false;
  let points = [];
  let tempLine = null;
  let scrollLocked = false;
  let savedScrollY = 0;
  let activeLayer = null;

  const SNAP_DIST_METERS = 4;
  const EDGE_RUN_MIN_POINTS = 3;
  const CLOSE_DIST_METERS = 5;
  const MIN_POINT_SPACING_METERS = 1.25;
  const SMOOTH_TOLERANCE_METERS = 1.75;
  const STRONG_SMOOTH_TOLERANCE_METERS = 2.75;
  const MAX_POINTS = 48;

  function getMap() {
    return window.map ||
      (window.TurfLynkAppState && window.TurfLynkAppState.map) ||
      null;
  }

  function getGroup() {
    return window.drawnItems ||
      window.mowLayerGroup ||
      (window.TurfLynkAppState && window.TurfLynkAppState.drawGroup) ||
      null;
  }

  function getParcel() {
    // Prefer live layer (most accurate)
    if (window.parcelLayer && window.parcelLayer.toGeoJSON) {
      return window.parcelLayer.toGeoJSON();
    }
    const appState = window.TurfLynkAppState;
    if (appState && appState.parcelLayer && appState.parcelLayer.toGeoJSON) {
      return appState.parcelLayer.toGeoJSON();
    }
    // Fall back to raw geometry stored by exposeCurrentParcelGeometryForAi
    const geom = window.currentParcelGeometry || window.parcelGeometry;
    if (geom) {
      return geom.type === 'Feature'
        ? geom
        : { type: 'Feature', geometry: geom, properties: {} };
    }
    return null;
  }

  function setStatus(text) {
    const el = document.getElementById('mowEditorMode');
    if (el) el.textContent = text;
  }

  function recalc() {
    if (typeof window.syncMowAreaFromLayers === 'function') {
      var _grp = getGroup();
      var _layerCount = _grp ? _grp.getLayers().length : 0;
      console.log('[TurfLynk Area Trace] A. lasso recalc() → syncMowAreaFromLayers | layers=' + _layerCount + ' source=lasso-yard.js');
      window.syncMowAreaFromLayers();
      return;
    }
    // Fallback: manual area calc
    const group = getGroup();
    const form = document.getElementById('quoteForm');
    if (!group || !form) return;
    let totalSqFt = 0;
    group.getLayers().forEach(function (layer) {
      try {
        if (!layer.toGeoJSON || !window.turf) return;
        totalSqFt += Math.round(turf.area(layer.toGeoJSON()) * 10.7639);
      } catch {}
    });
    console.log('[TurfLynk Area Trace] A. lasso recalc() fallback | layers=' + group.getLayers().length + ' totalSqFt=' + totalSqFt + ' source=lasso-yard.js');
    if (form.elements.mowAreaSqft) form.elements.mowAreaSqft.value = totalSqFt || '';
    if (typeof window.updateEstimatePreview === 'function') window.updateEstimatePreview();
  }

  // Use position:fixed scroll lock to avoid layout shift / map resize
  function lockScroll() {
    if (scrollLocked) return;
    scrollLocked = true;
    savedScrollY = window.scrollY || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.style.width = '100%';
  }

  function unlockScroll() {
    if (!scrollLocked) return;
    scrollLocked = false;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, savedScrollY);
    // Repair Leaflet map size after body reflow
    const map = getMap();
    if (map) setTimeout(function () { map.invalidateSize(); }, 60);
  }

  // ── Parcel geometry helpers ───────────────────────────────────────────────

  function getParcelRing(parcel) {
    if (!parcel || !parcel.geometry) return null;
    if (parcel.geometry.type === 'Polygon') return parcel.geometry.coordinates[0];
    if (parcel.geometry.type === 'MultiPolygon') return parcel.geometry.coordinates[0][0];
    return null;
  }

  function getParcelLine(parcel) {
    if (!parcel || !window.turf) return null;
    try { return turf.polygonToLine(parcel); } catch { return null; }
  }

  function nearestBoundaryInfo(latlng, parcelLine) {
    if (!window.turf || !parcelLine) return null;
    const snapped = turf.nearestPointOnLine(
      parcelLine,
      turf.point([latlng.lng, latlng.lat]),
      { units: 'meters' }
    );
    return {
      dist: snapped.properties.dist,
      index: snapped.properties.index || 0,
      coord: snapped.geometry.coordinates
    };
  }

  function snapPointLive(latlng) {
    const line = getParcelLine(getParcel());
    if (!line) return latlng;
    const info = nearestBoundaryInfo(latlng, line);
    if (!info || info.dist > SNAP_DIST_METERS) return latlng;
    return L.latLng(info.coord[1], info.coord[0]);
  }

  function sameCoord(a, b) {
    return Math.abs(a[0] - b[0]) < 0.00000001 && Math.abs(a[1] - b[1]) < 0.00000001;
  }

  function pathDistance(coords) {
    const map = getMap();
    if (!map) return 999999;
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += map.distance(
        L.latLng(coords[i - 1][1], coords[i - 1][0]),
        L.latLng(coords[i][1], coords[i][0])
      );
    }
    return total;
  }

  function boundarySegment(ring, startInfo, endInfo) {
    if (!ring || ring.length < 4) return [startInfo.coord, endInfo.coord];
    const closed = sameCoord(ring[0], ring[ring.length - 1]) ? ring : ring.concat([ring[0]]);
    const n = closed.length - 1;
    const startIndex = Math.max(0, Math.min(startInfo.index, n - 1));
    const endIndex = Math.max(0, Math.min(endInfo.index, n - 1));

    function walkForward() {
      const out = [startInfo.coord];
      let i = (startIndex + 1) % n;
      while (true) {
        out.push(closed[i]);
        if (i === endIndex) break;
        i = (i + 1) % n;
        if (out.length > n + 3) break;
      }
      out.push(endInfo.coord);
      return out;
    }

    function walkBackward() {
      const out = [startInfo.coord];
      let i = startIndex;
      while (true) {
        out.push(closed[i]);
        if (i === (endIndex + 1) % n) break;
        i = (i - 1 + n) % n;
        if (out.length > n + 3) break;
      }
      out.push(endInfo.coord);
      return out;
    }

    const forward = walkForward();
    const backward = walkBackward();
    return pathDistance(forward) <= pathDistance(backward) ? forward : backward;
  }

  function snapFullEdges(latlngs) {
    const parcel = getParcel();
    const ring = getParcelRing(parcel);
    const line = getParcelLine(parcel);
    if (!parcel || !ring || !line || !window.turf) return latlngs;

    const records = latlngs.map(function (p) {
      const info = nearestBoundaryInfo(p, line);
      return { latlng: p, info: info, near: info && info.dist <= SNAP_DIST_METERS };
    });

    const output = [];
    let i = 0;
    while (i < records.length) {
      if (!records[i].near) {
        output.push(records[i].latlng);
        i++;
        continue;
      }
      let j = i;
      while (j < records.length && records[j].near) j++;
      if (j - i >= EDGE_RUN_MIN_POINTS) {
        boundarySegment(ring, records[i].info, records[j - 1].info).forEach(function (c) {
          output.push(L.latLng(c[1], c[0]));
        });
      } else {
        for (let k = i; k < j; k++) {
          const c = records[k].info.coord;
          output.push(L.latLng(c[1], c[0]));
        }
      }
      i = j;
    }
    return output;
  }

  function distanceMeters(a, b) {
    const map = getMap();
    if (map) return map.distance(a, b);
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const x = dLng * Math.cos((lat1 + lat2) / 2);
    const y = dLat;
    return Math.sqrt(x * x + y * y) * 6371008.8;
  }

  function perpendicularDistanceMeters(p, a, b) {
    const midLat = (((a.lat + b.lat + p.lat) / 3) * Math.PI) / 180;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(midLat);
    const ax = a.lng * metersPerDegLng, ay = a.lat * metersPerDegLat;
    const bx = b.lng * metersPerDegLng, by = b.lat * metersPerDegLat;
    const px = p.lng * metersPerDegLng, py = p.lat * metersPerDegLat;
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function dropTinySteps(latlngs, minDistanceMeters) {
    if (latlngs.length < 3) return latlngs;
    const out = [latlngs[0]];
    for (let i = 1; i < latlngs.length - 1; i++) {
      if (distanceMeters(out[out.length - 1], latlngs[i]) >= minDistanceMeters) {
        out.push(latlngs[i]);
      }
    }
    const last = latlngs[latlngs.length - 1];
    if (distanceMeters(out[out.length - 1], last) >= minDistanceMeters * 0.5) out.push(last);
    return out.length >= 3 ? out : latlngs;
  }

  function douglasPeucker(pointsIn, toleranceMeters) {
    if (pointsIn.length <= 3) return pointsIn;
    let maxDist = 0, index = 0;
    const start = pointsIn[0], end = pointsIn[pointsIn.length - 1];
    for (let i = 1; i < pointsIn.length - 1; i++) {
      const dist = perpendicularDistanceMeters(pointsIn[i], start, end);
      if (dist > maxDist) { index = i; maxDist = dist; }
    }
    if (maxDist > toleranceMeters) {
      const left = douglasPeucker(pointsIn.slice(0, index + 1), toleranceMeters);
      const right = douglasPeucker(pointsIn.slice(index), toleranceMeters);
      return left.slice(0, -1).concat(right);
    }
    return [start, end];
  }

  function simplifyLatLngs(latlngs, toleranceMeters) {
    if (latlngs.length < 4) return latlngs;
    try {
      const opened = dropTinySteps(latlngs, MIN_POINT_SPACING_METERS);
      const simplified = douglasPeucker(opened, toleranceMeters || SMOOTH_TOLERANCE_METERS);
      return simplified.length >= 3 ? simplified : latlngs;
    } catch { return latlngs; }
  }

  function clipToParcel(latlngs) {
    const parcel = getParcel();
    if (!parcel || !window.turf || latlngs.length < 4) return latlngs;
    try {
      const coords = latlngs.map(function (p) { return [p.lng, p.lat]; });
      coords.push(coords[0]);
      const poly = turf.polygon([coords]);
      let clipped = null;
      try { clipped = turf.intersect(poly, parcel); } catch {
        clipped = turf.intersect(turf.featureCollection([poly, parcel]));
      }
      if (!clipped) return latlngs;
      if (clipped.geometry.type === 'Polygon') {
        return clipped.geometry.coordinates[0].slice(0, -1).map(function (c) {
          return L.latLng(c[1], c[0]);
        });
      }
      if (clipped.geometry.type === 'MultiPolygon') {
        const biggest = clipped.geometry.coordinates
          .map(function (c) { return turf.polygon(c); })
          .sort(function (a, b) { return turf.area(b) - turf.area(a); })[0];
        return biggest.geometry.coordinates[0].slice(0, -1).map(function (c) {
          return L.latLng(c[1], c[0]);
        });
      }
    } catch {}
    return latlngs;
  }

  function polygonFeatureFromLatLngs(latlngs) {
    if (!window.turf || !latlngs || latlngs.length < 3) return null;
    const coords = latlngs.map(function (p) { return [p.lng, p.lat]; });
    coords.push(coords[0]);
    try {
      return turf.polygon([coords], { source: 'mowable_lasso' });
    } catch {
      return null;
    }
  }

  function largestPolygonFeature(feature) {
    if (!feature || !feature.geometry || !window.turf) return null;
    if (feature.geometry.type === 'Polygon') return feature;
    if (feature.geometry.type !== 'MultiPolygon') return null;

    return feature.geometry.coordinates
      .map(function (coords) {
        return turf.polygon(coords, feature.properties || {});
      })
      .sort(function (a, b) {
        return turf.area(b) - turf.area(a);
      })[0] || null;
  }

  function selectedMowableFeatureFromLasso(latlngs) {
    const lasso = polygonFeatureFromLatLngs(latlngs);
    const parcel = getParcel();
    if (!lasso || !window.turf || !parcel) return lasso;

    try {
      let clipped = null;
      try { clipped = turf.intersect(parcel, lasso); } catch {
        clipped = turf.intersect(turf.featureCollection([parcel, lasso]));
      }

      const selected = largestPolygonFeature(clipped);
      if (!selected) return lasso;

      const lassoArea = turf.area(lasso);
      const selectedArea = turf.area(selected);
      const parcelArea = turf.area(parcel);

      console.log('[TurfLynk Area Trace] A. lasso intersect: lassoArea=' + Math.round(lassoArea * 10.7639) + ' selectedArea=' + Math.round(selectedArea * 10.7639) + ' parcelArea=' + Math.round(parcelArea * 10.7639) + ' sqft | source=selectedMowableFeatureFromLasso');

      // Guard 1: A true intersection cannot be materially larger than the lasso.
      // If Turf returns a parcel-sized shape from an invalid/self-crossed trace,
      // keep the user-drawn lasso instead of pricing the inverse area.
      if (lassoArea > 0 && selectedArea > lassoArea * 1.15 && selectedArea > parcelArea * 0.5) {
        console.log('[TurfLynk Area Trace] A. guard1 fired: intersection bigger than lasso, using lasso sqft=' + Math.round(lassoArea * 10.7639));
        return lasso;
      }

      // Guard 2: If the user drew a clearly smaller lasso (≤90% of parcel) but the
      // intersection returned nearly the full parcel (≥95%), bad geometry occurred.
      // Keep the original lasso polygon instead of pricing the whole lot.
      if (parcelArea > 0 && lassoArea <= parcelArea * 0.90 && selectedArea >= parcelArea * 0.95) {
        console.log('[TurfLynk Area Trace] A. guard2 fired: small lasso produced full-parcel intersection, using lasso sqft=' + Math.round(lassoArea * 10.7639));
        return lasso;
      }

      return selected;
    } catch {
      return lasso;
    }
  }

  // ── Drawing state helpers ─────────────────────────────────────────────────

  function stopTempLine() {
    const map = getMap();
    if (tempLine && map) map.removeLayer(tempLine);
    tempLine = null;
  }

  function isNearStart(latlng) {
    const map = getMap();
    if (!map || points.length < 8) return false;
    return map.distance(points[0], latlng) <= CLOSE_DIST_METERS;
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────

  function disableActiveEditing() {
    if (activeLayer && activeLayer.editing) {
      try { activeLayer.editing.disable(); } catch {}
    }
    activeLayer = null;
    // Also clear any app-level edit toolbar handler
    const appState = window.TurfLynkAppState;
    if (appState && appState.editHandler) {
      try { appState.editHandler.disable(); } catch {}
      appState.editHandler = null;
    }
  }

  function enableEditing(layer) {
    disableActiveEditing();
    activeLayer = layer;
    // Prefer direct polygon editing (no Save/Cancel toolbar required)
    if (layer.editing) {
      try {
        layer.editing.enable();
        layer.on('edit', recalc);
        setStatus('Mode: Drag vertices to adjust — draw again to replace');
        return;
      } catch (e) {
        console.warn('lasso: direct editing failed', e);
      }
    }
    // Fallback: use the app-level L.EditToolbar.Edit
    if (typeof window.startEditMowable === 'function') {
      setTimeout(window.startEditMowable, 100);
    }
  }

  // ── Core lasso actions ────────────────────────────────────────────────────

  function clearMowAreas() {
    disableActiveEditing();
    stopTempLine();
    points = [];
    drawing = false;
    armed = false;
    unlockScroll();
    const map = getMap();
    if (map) {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      if (map.touchZoom) map.touchZoom.enable();
    }
    const group = getGroup();
    if (group) group.clearLayers();
    recalc();
    setStatus('Mode: Ready');
  }

  function finishLasso() {
    const map = getMap();
    const group = getGroup();
    if (!map || !group) return;

    armed = false;
    drawing = false;
    unlockScroll();
    map.dragging.enable();
    map.doubleClickZoom.enable();
    if (map.touchZoom) map.touchZoom.enable();
    stopTempLine();

    if (points.length < 6) {
      points = [];
      setStatus('Mode: Area too small — try again');
      return;
    }

    let cleaned = points.slice();
    cleaned = simplifyLatLngs(cleaned, SMOOTH_TOLERANCE_METERS);
    if (cleaned.length > MAX_POINTS) cleaned = simplifyLatLngs(cleaned, STRONG_SMOOTH_TOLERANCE_METERS);
    if (cleaned.length > MAX_POINTS) cleaned = simplifyLatLngs(cleaned, STRONG_SMOOTH_TOLERANCE_METERS + 1.5);

    if (cleaned.length < 3) {
      points = [];
      setStatus('Mode: Could not close shape — try again');
      return;
    }

    const selectedFeature = selectedMowableFeatureFromLasso(cleaned);
    if (!selectedFeature) {
      points = [];
      setStatus('Mode: Could not close shape — try again');
      return;
    }

    // Replace any previous lasso — one active mowable polygon at a time
    disableActiveEditing();
    group.clearLayers();
    let activeMowableLayer = null;
    L.geoJSON(selectedFeature, {
      style: {
        color: '#16a34a',
        weight: 3,
        fillOpacity: 0.22
      }
    }).eachLayer(function (layer) {
      activeMowableLayer = activeMowableLayer || layer;
      group.addLayer(layer);
    });

    const appState = window.TurfLynkAppState;
    if (appState && appState.parcelLayer && appState.parcelLayer.bringToBack) {
      appState.parcelLayer.bringToBack();
    }
    if (activeMowableLayer && activeMowableLayer.bringToFront) activeMowableLayer.bringToFront();

    recalc();
    points = [];

    // Auto-enable vertex editing so the polygon is immediately adjustable
    if (activeMowableLayer) setTimeout(function () { enableEditing(activeMowableLayer); }, 150);
  }

  function armLasso() {
    const map = getMap();
    if (!map) { setStatus('Mode: Map not ready'); return; }
    disableActiveEditing();
    armed = true;
    drawing = false;
    points = [];
    stopTempLine();
    setStatus('Mode: Click map to START drawing');

    // Update the helper text if available
    const helper = document.getElementById('mowAreaHelper');
    if (helper) helper.textContent = 'Click once to start. Move cursor/finger to trace the yard. Click again to finish.';
  }

  function startDrawing(latlng) {
    const map = getMap();
    if (!map) return;
    drawing = true;
    points = [snapPointLive(latlng)];
    lockScroll();
    map.dragging.disable();
    map.doubleClickZoom.disable();
    if (map.touchZoom) map.touchZoom.disable();
    setStatus('Mode: Drawing — move to trace, click to finish');
  }

  function addPoint(latlng) {
    if (!drawing) return;
    const map = getMap();
    if (!map) return;

    latlng = snapPointLive(latlng);
    const last = points[points.length - 1];
    if (last && map.distance(last, latlng) < 0.8) return;

    if (isNearStart(latlng)) {
      finishLasso();
      return;
    }

    points.push(latlng);

    if (!tempLine) {
      tempLine = L.polyline(points, { color: '#22c55e', weight: 3, opacity: 0.9 }).addTo(map);
    } else {
      tempLine.setLatLngs(points);
    }
  }

  // ── Map event handlers ────────────────────────────────────────────────────

  function handleMapClick(e) {
    if (!armed) return;
    if (!drawing) { startDrawing(e.latlng); return; }
    finishLasso();
  }

  function handleMove(e) {
    if (!drawing) return;
    addPoint(e.latlng);
  }

  function handleTouchMove(e) {
    if (!drawing || !e.originalEvent || !e.originalEvent.touches || !e.originalEvent.touches.length) return;
    const map = getMap();
    if (!map) return;
    const touch = e.originalEvent.touches[0];
    const containerPoint = map.mouseEventToContainerPoint(touch);
    const latlng = map.containerPointToLatLng(containerPoint);
    addPoint(latlng);
  }

  // ── Attach ────────────────────────────────────────────────────────────────

  function attach() {
    const map = getMap();
    if (!map) {
      // Retry once if map isn't ready yet
      setTimeout(attach, 600);
      return;
    }

    // Suppress AI grass UI (not yet implemented)
    ['aiDetectGrassBtn', 'detectGrassBtn', 'autoDetectGrassBtn', 'aiGrassBtn'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.ai-detect-btn, .ai-grass-btn, [data-ai-grass]').forEach(function (el) {
      el.style.display = 'none';
    });
    window.TURFLYNK_AI_GRASS_ENABLED = false;

    const container = map.getContainer();
    container.addEventListener('touchmove', function (e) {
      if (drawing) e.preventDefault();
    }, { passive: false });

    map.on('click', handleMapClick);
    map.on('mousemove', handleMove);
    map.on('touchmove', handleTouchMove);
    container.addEventListener('pointercancel', unlockScroll);
    container.addEventListener('pointerleave', function () {
      // Only unlock on pointer leave if we're drawing (not editing)
      if (drawing) unlockScroll();
    });

    function bindBtn(id, fn) {
      const el = document.getElementById(id);
      if (el && !el.dataset.lassoBound) {
        el.dataset.lassoBound = '1';
        el.addEventListener('click', fn);
      }
    }

    bindBtn('lassoYardBtn', armLasso);
    bindBtn('finishLassoBtn', finishLasso);
    bindBtn('clearMowAreaBtn', clearMowAreas);

    window.TurfLynkLassoYard = {
      arm: armLasso,
      finish: finishLasso,
      clear: clearMowAreas,
      enableEditing: enableEditing,
      disableEditing: disableActiveEditing
    };
  }

  setTimeout(attach, 800);
})();
