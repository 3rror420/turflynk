(function () {
  let armed = false;
  let drawing = false;
  let drawPurpose = 'mowable';
  let points = [];
  let activePointerId = null;

  const SNAP_DIST_METERS = 4;
  const EDGE_RUN_MIN_POINTS = 3;
  const MIN_POINT_SPACING_METERS = 1.25;
  const SMOOTH_TOLERANCE_METERS = 1.75;
  const STRONG_SMOOTH_TOLERANCE_METERS = 2.75;
  const MAX_POINTS = 48;

  function getMap() {
    return window.map || window.TurfLynkAppState?.map || null;
  }

  function getParcel() {
    const appState = window.TurfLynkAppState;
    if (appState?.parcelFeature) return appState.parcelFeature;
    const geom = window.currentParcelGeometry || window.parcelGeometry;
    if (geom) return geom.type === 'Feature' ? geom : { type: 'Feature', properties: {}, geometry: geom };
    return null;
  }

  function setStatus(text) {
    const el = document.getElementById('mowEditorMode');
    if (el) el.textContent = text;
  }

  function setAppMapMode(mode) {
    if (typeof window.setTurfLynkMapMode === 'function') window.setTurfLynkMapMode(mode);
    else if (window.TurfLynkAppState) window.TurfLynkAppState.mapMode = mode;
    document.body.dataset.mapMode = mode;
  }

  function getAppMapMode() {
    if (typeof window.getTurfLynkMapMode === 'function') return window.getTurfLynkMapMode();
    return window.TurfLynkAppState?.mapMode || 'idle';
  }

  function setAppQuoteUiMode(mode) {
    if (window.TurfLynkAppState) window.TurfLynkAppState.quoteUiMode = mode;
    if (typeof window.updateQuoteFlowState === 'function') {
      try { window.updateQuoteFlowState(); } catch {}
    }
  }

  function setLassoTempLine(nextPoints = []) {
    if (typeof window.setTurfLynkLassoTempLine === 'function') {
      window.setTurfLynkLassoTempLine(nextPoints);
    }
  }

  function setMapDrawingGestures(enabled) {
    const map = getMap();
    if (!map) return;
    try {
      if (enabled) map.dragPan.disable();
      else map.dragPan.enable();
    } catch {}
    try {
      if (enabled) map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
    } catch {}
    try {
      if (enabled) map.dragRotate.disable();
      else map.dragRotate.enable();
    } catch {}
  }

  function lockScroll() {
    document.body.dataset.lassoDrawing = 'true';
  }

  function unlockScroll() {
    delete document.body.dataset.lassoDrawing;
    const map = getMap();
    if (map) setTimeout(function () { map.resize(); }, 60);
  }

  function setArmedState(nextArmed) {
    armed = nextArmed;
    if (nextArmed) document.body.dataset.lassoArmed = 'true';
    else delete document.body.dataset.lassoArmed;
  }

  function isLassoMode() {
    return armed && getAppMapMode() === 'lasso';
  }

  function recalc() {
    if (typeof window.syncMowAreaFromLayers === 'function') {
      window.syncMowAreaFromLayers();
      return;
    }
    const appState = window.TurfLynkAppState;
    const form = document.getElementById('quoteForm');
    if (!appState?.mowableFeatureCollection || !form || !window.turf) return;
    const totalSqFt = Math.round(turf.area(appState.mowableFeatureCollection) * 10.7639);
    if (form.elements.mowAreaSqft) form.elements.mowAreaSqft.value = totalSqFt || '';
  }

  function getParcelRing(parcel) {
    if (!parcel?.geometry) return null;
    if (parcel.geometry.type === 'Polygon') return parcel.geometry.coordinates[0];
    if (parcel.geometry.type === 'MultiPolygon') return parcel.geometry.coordinates[0][0];
    return null;
  }

  function getParcelLine(parcel) {
    if (!parcel || !window.turf) return null;
    try { return turf.polygonToLine(parcel); } catch { return null; }
  }

  function nearestBoundaryInfo(point, parcelLine) {
    if (!window.turf || !parcelLine) return null;
    const snapped = turf.nearestPointOnLine(parcelLine, turf.point([point.lng, point.lat]), { units: 'meters' });
    return {
      dist: snapped.properties.dist,
      index: snapped.properties.index || 0,
      coord: snapped.geometry.coordinates,
    };
  }

  function snapPointLive(point) {
    const line = getParcelLine(getParcel());
    if (!line) return point;
    const info = nearestBoundaryInfo(point, line);
    if (!info || info.dist > SNAP_DIST_METERS) return point;
    return { lng: info.coord[0], lat: info.coord[1] };
  }

  function sameCoord(a, b) {
    return Math.abs(a[0] - b[0]) < 0.00000001 && Math.abs(a[1] - b[1]) < 0.00000001;
  }

  function distanceMeters(a, b) {
    const map = getMap();
    if (map) {
      const pa = map.project([a.lng, a.lat]);
      const pb = map.project([b.lng, b.lat]);
      const metersPerPixel = 40075016.686 * Math.cos((a.lat * Math.PI) / 180) / Math.pow(2, map.getZoom() + 8);
      return Math.hypot(pb.x - pa.x, pb.y - pa.y) * metersPerPixel;
    }
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const x = dLng * Math.cos((lat1 + lat2) / 2);
    return Math.sqrt(x * x + dLat * dLat) * 6371008.8;
  }

  function coordDistanceMeters(a, b) {
    return distanceMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
  }

  function pathDistance(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) total += coordDistanceMeters(coords[i - 1], coords[i]);
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

  function snapFullEdges(inputPoints) {
    const parcel = getParcel();
    const ring = getParcelRing(parcel);
    const line = getParcelLine(parcel);
    if (!parcel || !ring || !line || !window.turf) return inputPoints;

    const records = inputPoints.map(function (point) {
      const info = nearestBoundaryInfo(point, line);
      return { point, info, near: info && info.dist <= SNAP_DIST_METERS };
    });

    const output = [];
    let i = 0;
    while (i < records.length) {
      if (!records[i].near) {
        output.push(records[i].point);
        i++;
        continue;
      }
      let j = i;
      while (j < records.length && records[j].near) j++;
      if (j - i >= EDGE_RUN_MIN_POINTS) {
        boundarySegment(ring, records[i].info, records[j - 1].info).forEach(function (coord) {
          output.push({ lng: coord[0], lat: coord[1] });
        });
      } else {
        for (let k = i; k < j; k++) {
          const coord = records[k].info.coord;
          output.push({ lng: coord[0], lat: coord[1] });
        }
      }
      i = j;
    }
    return output;
  }

  function perpendicularDistanceMeters(point, a, b) {
    const midLat = (((a.lat + b.lat + point.lat) / 3) * Math.PI) / 180;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(midLat);
    const ax = a.lng * metersPerDegLng, ay = a.lat * metersPerDegLat;
    const bx = b.lng * metersPerDegLng, by = b.lat * metersPerDegLat;
    const px = point.lng * metersPerDegLng, py = point.lat * metersPerDegLat;
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function dropTinySteps(inputPoints, minDistanceMeters) {
    if (inputPoints.length < 3) return inputPoints;
    const out = [inputPoints[0]];
    for (let i = 1; i < inputPoints.length - 1; i++) {
      if (distanceMeters(out[out.length - 1], inputPoints[i]) >= minDistanceMeters) out.push(inputPoints[i]);
    }
    const last = inputPoints[inputPoints.length - 1];
    if (distanceMeters(out[out.length - 1], last) >= minDistanceMeters * 0.5) out.push(last);
    return out.length >= 3 ? out : inputPoints;
  }

  function douglasPeucker(inputPoints, toleranceMeters) {
    if (inputPoints.length <= 3) return inputPoints;
    let maxDist = 0, index = 0;
    const start = inputPoints[0], end = inputPoints[inputPoints.length - 1];
    for (let i = 1; i < inputPoints.length - 1; i++) {
      const dist = perpendicularDistanceMeters(inputPoints[i], start, end);
      if (dist > maxDist) { index = i; maxDist = dist; }
    }
    if (maxDist > toleranceMeters) {
      const left = douglasPeucker(inputPoints.slice(0, index + 1), toleranceMeters);
      const right = douglasPeucker(inputPoints.slice(index), toleranceMeters);
      return left.slice(0, -1).concat(right);
    }
    return [start, end];
  }

  function simplifyPoints(inputPoints, toleranceMeters) {
    if (inputPoints.length < 4) return inputPoints;
    try {
      const opened = dropTinySteps(inputPoints, MIN_POINT_SPACING_METERS);
      const simplified = douglasPeucker(opened, toleranceMeters || SMOOTH_TOLERANCE_METERS);
      return simplified.length >= 3 ? simplified : inputPoints;
    } catch {
      return inputPoints;
    }
  }

  function polygonFeatureFromPoints(inputPoints) {
    if (!window.turf || !inputPoints || inputPoints.length < 3) return null;
    const coords = inputPoints.map(function (point) { return [point.lng, point.lat]; });
    coords.push(coords[0]);
    try {
      return turf.polygon([coords], { source: drawPurpose === 'cut' ? 'mowable_cut' : 'mowable_lasso' });
    } catch {
      return null;
    }
  }

  function largestPolygonFeature(feature) {
    if (!feature?.geometry || !window.turf) return null;
    if (feature.geometry.type === 'Polygon') return feature;
    if (feature.geometry.type !== 'MultiPolygon') return null;
    return feature.geometry.coordinates
      .map(function (coords) { return turf.polygon(coords, feature.properties || {}); })
      .sort(function (a, b) { return turf.area(b) - turf.area(a); })[0] || null;
  }

  function selectedMowableFeatureFromLasso(inputPoints) {
    const lasso = polygonFeatureFromPoints(inputPoints);
    const parcel = getParcel();
    if (!lasso || !window.turf || !parcel || drawPurpose === 'cut') return lasso;

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
      if (lassoArea > 0 && selectedArea > lassoArea * 1.15 && selectedArea > parcelArea * 0.5) return lasso;
      if (parcelArea > 0 && lassoArea <= parcelArea * 0.90 && selectedArea >= parcelArea * 0.95) return lasso;
      return selected;
    } catch {
      return lasso;
    }
  }

  function cancelLasso() {
    points = [];
    drawing = false;
    activePointerId = null;
    setLassoTempLine([]);
    setArmedState(false);
    unlockScroll();
    setMapDrawingGestures(false);
    setAppQuoteUiMode('idle');
    setAppMapMode('idle');
  }

  function clearMowAreas() {
    cancelLasso();
    if (typeof window.setTurfLynkMowableFeatures === 'function') window.setTurfLynkMowableFeatures([]);
    recalc();
    setStatus('Mode: Ready');
  }

  function finishLasso() {
    if (points.length < 6) {
      cancelLasso();
      setStatus('Mode: Area too small - try again');
      return;
    }

    let cleaned = snapFullEdges(points.slice());
    cleaned = simplifyPoints(cleaned, SMOOTH_TOLERANCE_METERS);
    if (cleaned.length > MAX_POINTS) cleaned = simplifyPoints(cleaned, STRONG_SMOOTH_TOLERANCE_METERS);
    if (cleaned.length > MAX_POINTS) cleaned = simplifyPoints(cleaned, STRONG_SMOOTH_TOLERANCE_METERS + 1.5);

    const selectedFeature = selectedMowableFeatureFromLasso(cleaned);
    cancelLasso();

    if (!selectedFeature) {
      setStatus('Mode: Could not close shape - try again');
      return;
    }

    if (drawPurpose === 'cut') {
      if (typeof window.applyTurfLynkCutFeature === 'function') window.applyTurfLynkCutFeature(selectedFeature);
      setStatus('Mode: Cut applied');
      return;
    }

    if (typeof window.setTurfLynkMowableFeatures === 'function') window.setTurfLynkMowableFeatures([selectedFeature]);
    recalc();
    setTimeout(function () {
      if (typeof window.startEditMowable === 'function') window.startEditMowable();
    }, 120);
  }

  function armLasso(purpose) {
    const map = getMap();
    if (!map) { setStatus('Mode: Map not ready'); return; }
    drawPurpose = purpose || 'mowable';
    setAppMapMode('lasso');
    setArmedState(true);
    drawing = false;
    activePointerId = null;
    points = [];
    setLassoTempLine([]);
    setMapDrawingGestures(true);
    setAppQuoteUiMode('drawing');
    setStatus(drawPurpose === 'cut' ? 'Mode: Drag to cut out area' : 'Mode: Drag on map to draw');
    const helper = document.getElementById('mowAreaHelper');
    if (helper) helper.textContent = drawPurpose === 'cut'
      ? 'Drag around the area to remove from mowing.'
      : 'Drag around the grass area. Lift your finger to finish.';
  }

  function eventToLngLat(event) {
    const map = getMap();
    if (!map) return null;
    const rect = map.getCanvas().getBoundingClientRect();
    return map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
  }

  function startDrawing(point) {
    drawing = true;
    points = [snapPointLive(point)];
    lockScroll();
    setMapDrawingGestures(true);
    setAppMapMode('lasso');
    setStatus(drawPurpose === 'cut' ? 'Mode: Cutting' : 'Mode: Drawing');
  }

  function addPoint(point) {
    if (!drawing) return;
    const snapped = snapPointLive(point);
    const last = points[points.length - 1];
    if (last && distanceMeters(last, snapped) < 0.8) return;
    points.push(snapped);
    setLassoTempLine(points);
  }

  function handlePointerDown(event) {
    if (!isLassoMode()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = eventToLngLat(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerId = event.pointerId;
    try { event.currentTarget.setPointerCapture(activePointerId); } catch {}
    startDrawing({ lng: point.lng, lat: point.lat });
  }

  function handlePointerMove(event) {
    if (!drawing || getAppMapMode() !== 'lasso' || event.pointerId !== activePointerId) return;
    const point = eventToLngLat(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    addPoint({ lng: point.lng, lat: point.lat });
  }

  function handlePointerUp(event) {
    if (!drawing || getAppMapMode() !== 'lasso' || event.pointerId !== activePointerId) return;
    const point = eventToLngLat(event);
    if (point) addPoint({ lng: point.lng, lat: point.lat });
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.releasePointerCapture(activePointerId); } catch {}
    finishLasso();
  }

  function handlePointerCancel(event) {
    if (!drawing || event.pointerId !== activePointerId) return;
    cancelLasso();
    setStatus('Mode: Ready');
  }

  function handleMouseDown(event) {
    if (!isLassoMode() || drawing || event.button !== 0) return;
    const point = eventToLngLat(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerId = 'mouse';
    startDrawing({ lng: point.lng, lat: point.lat });
  }

  function handleMouseMove(event) {
    if (!drawing || activePointerId !== 'mouse' || getAppMapMode() !== 'lasso') return;
    const point = eventToLngLat(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    addPoint({ lng: point.lng, lat: point.lat });
  }

  function handleMouseUp(event) {
    if (!drawing || activePointerId !== 'mouse' || getAppMapMode() !== 'lasso') return;
    const point = eventToLngLat(event);
    if (point) addPoint({ lng: point.lng, lat: point.lat });
    event.preventDefault();
    event.stopPropagation();
    finishLasso();
  }

  function touchPoint(event) {
    const touch = event.changedTouches?.[0] || event.touches?.[0];
    return touch ? eventToLngLat(touch) : null;
  }

  function handleTouchStart(event) {
    if (!isLassoMode() || drawing || event.touches.length !== 1) return;
    const point = touchPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerId = 'touch';
    startDrawing({ lng: point.lng, lat: point.lat });
  }

  function handleTouchMove(event) {
    if (!drawing || activePointerId !== 'touch' || getAppMapMode() !== 'lasso' || event.touches.length !== 1) return;
    const point = touchPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    addPoint({ lng: point.lng, lat: point.lat });
  }

  function handleTouchEnd(event) {
    if (!drawing || activePointerId !== 'touch' || getAppMapMode() !== 'lasso') return;
    const point = touchPoint(event);
    if (point) addPoint({ lng: point.lng, lat: point.lat });
    event.preventDefault();
    event.stopPropagation();
    finishLasso();
  }

  function handleTouchCancel(event) {
    if (!drawing || activePointerId !== 'touch') return;
    event.preventDefault();
    event.stopPropagation();
    cancelLasso();
    setStatus('Mode: Ready');
  }

  function attach() {
    const map = getMap();
    if (!map?.getCanvas) {
      setTimeout(attach, 600);
      return;
    }

    ['aiDetectGrassBtn', 'detectGrassBtn', 'autoDetectGrassBtn', 'aiGrassBtn'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.ai-detect-btn, .ai-grass-btn, [data-ai-grass]').forEach(function (el) {
      el.style.display = 'none';
    });
    window.TURFLYNK_AI_GRASS_ENABLED = false;

    const canvas = map.getCanvas();
    if (!canvas.dataset.turflynkLassoBound) {
      canvas.dataset.turflynkLassoBound = '1';
      canvas.addEventListener('touchmove', function (event) {
        if (drawing && getAppMapMode() === 'lasso' && event.touches.length === 1) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, { passive: false });
      canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
      canvas.addEventListener('pointermove', handlePointerMove, { passive: false });
      canvas.addEventListener('pointerup', handlePointerUp, { passive: false });
      canvas.addEventListener('pointercancel', handlePointerCancel, { passive: false });
      canvas.addEventListener('mousedown', handleMouseDown, { passive: false });
      window.addEventListener('mousemove', handleMouseMove, { passive: false });
      window.addEventListener('mouseup', handleMouseUp, { passive: false });
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
      canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
      canvas.addEventListener('touchcancel', handleTouchCancel, { passive: false });
    }

    function bindBtn(id, fn) {
      const el = document.getElementById(id);
      if (el && !el.dataset.lassoBound) {
        el.dataset.lassoBound = '1';
        el.addEventListener('click', fn);
      }
    }

    bindBtn('lassoYardBtn', function () { armLasso('mowable'); });
    bindBtn('finishLassoBtn', finishLasso);
    bindBtn('clearMowAreaBtn', clearMowAreas);

    window.TurfLynkLassoYard = {
      arm: function () { armLasso('mowable'); },
      armCut: function () { armLasso('cut'); },
      finish: finishLasso,
      clear: clearMowAreas,
      cancel: cancelLasso,
      enableEditing: function () {},
      disableEditing: function () {},
    };
  }

  setTimeout(attach, 800);
})();
