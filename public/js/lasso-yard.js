console.info("[Lasso] loaded boundary-fix-v5-exit-enter-fat-thumb");

(function () {

  let armed = false;
  let drawing = false;
  let drawPurpose = 'mowable';
  let points = [];
  let activePointerId = null;

  const SNAP_DIST_METERS = 4;
  const BOUNDARY_EPS_METERS = 0.45;
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
    if (drawPurpose !== 'cut') return point;
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

  function boundarySegmentOptions(ring, startInfo, endInfo) {
    if (!ring || ring.length < 4) return [[startInfo.coord, endInfo.coord]];
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

    return [walkForward(), walkBackward()];
  }

  function pointToSegmentDistanceMeters(point, a, b) {
    const midLat = (((a[1] + b[1] + point.lat) / 3) * Math.PI) / 180;
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(midLat);
    const ax = a[0] * metersPerDegLng, ay = a[1] * metersPerDegLat;
    const bx = b[0] * metersPerDegLng, by = b[1] * metersPerDegLat;
    const px = point.lng * metersPerDegLng, py = point.lat * metersPerDegLat;
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function pointToPathDistanceMeters(point, coords) {
    if (!coords || coords.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 1; i < coords.length; i++) {
      best = Math.min(best, pointToSegmentDistanceMeters(point, coords[i - 1], coords[i]));
    }
    return best;
  }

  function chooseBoundaryArc(ring, startInfo, endInfo, outsidePoints) {
    const options = boundarySegmentOptions(ring, startInfo, endInfo);
    if (!outsidePoints || outsidePoints.length === 0) {
      return pathDistance(options[0]) <= pathDistance(options[1]) ? options[0] : options[1];
    }

    function score(coords) {
      const sample = outsidePoints.length > 40
        ? outsidePoints.filter(function (_, index) { return index % Math.ceil(outsidePoints.length / 40) === 0; })
        : outsidePoints;
      const avgDistance = sample.reduce(function (sum, point) {
        return sum + pointToPathDistanceMeters(point, coords);
      }, 0) / Math.max(1, sample.length);
      return avgDistance + pathDistance(coords) * 0.01;
    }

    return score(options[0]) <= score(options[1]) ? options[0] : options[1];
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

  // Remove consecutive duplicate or near-duplicate points produced by clipping.
  function deduplicateAdjacentPoints(inputPoints) {
    if (inputPoints.length < 2) return inputPoints;
    const out = [inputPoints[0]];
    for (let i = 1; i < inputPoints.length; i++) {
      if (distanceMeters(out[out.length - 1], inputPoints[i]) > 0.1) out.push(inputPoints[i]);
    }
    return out.length >= 3 ? out : inputPoints;
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

    // Validate first coord before closing the ring.
    const first = coords[0];
    if (!first || !Number.isFinite(first[0]) || !Number.isFinite(first[1])) {
      console.error('[Lasso] polygonFeatureFromPoints: invalid first coord:', first);
      if (typeof window.showError === 'function') window.showError('Lasso start point invalid – try again.');
      return null;
    }

    // Close ring with a copy of the first coord (not the same array reference).
    coords.push([first[0], first[1]]);
    const last = coords[coords.length - 1];
    const closed = (first[0] === last[0] && first[1] === last[1]);

    console.log(
      '[Lasso] Ring: ' + coords.length + ' coords' +
      '  first=[' + first[0].toFixed(6) + ',' + first[1].toFixed(6) + ']' +
      '  last=[' + last[0].toFixed(6) + ',' + last[1].toFixed(6) + ']' +
      '  closed=' + closed
    );

    if (coords.length < 4) {
      console.error('[Lasso] polygonFeatureFromPoints: ring too short (' + coords.length + ' coords, need ≥4)');
      if (typeof window.showError === 'function') window.showError('Lasso area too small – draw a larger outline.');
      return null;
    }

    if (!closed) {
      console.error('[Lasso] polygonFeatureFromPoints: ring not closed – first ' + JSON.stringify(first) + ' != last ' + JSON.stringify(last));
      if (typeof window.showError === 'function') window.showError('Lasso did not close properly – try again.');
      return null;
    }

    try {
      const poly = turf.polygon([coords], { source: drawPurpose === 'cut' ? 'mowable_cut' : 'mowable_lasso' });
      return poly;
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

  function closeCoordRing(coords) {
    if (!coords || coords.length < 3) return null;
    const out = [];
    coords.forEach(function (coord) {
      if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return;
      const next = [coord[0], coord[1]];
      if (!out.length || coordDistanceMeters(out[out.length - 1], next) > 0.1) out.push(next);
    });
    if (out.length < 3) return null;
    if (out.length > 1 && coordDistanceMeters(out[0], out[out.length - 1]) <= 0.1) out.pop();
    if (out.length < 3) return null;
    if (!sameCoord(out[0], out[out.length - 1])) out.push([out[0][0], out[0][1]]);
    return out.length >= 4 ? out : null;
  }

  function lineFeatureFromPoints(inputPoints) {
    if (!window.turf || !inputPoints || inputPoints.length < 2) return null;
    const coords = inputPoints
      .map(function (point) { return [point.lng, point.lat]; })
      .filter(function (coord) {
        return Number.isFinite(coord[0]) && Number.isFinite(coord[1]);
      });
    if (coords.length < 2) return null;
    try { return turf.lineString(coords); } catch { return null; }
  }

  function bboxCoverageRatio(innerFeature, outerFeature) {
    if (!window.turf || !innerFeature || !outerFeature) return 0;
    try {
      const inner = turf.bbox(innerFeature);
      const outer = turf.bbox(outerFeature);
      const innerLng = Math.max(0, Math.min(inner[2], outer[2]) - Math.max(inner[0], outer[0]));
      const innerLat = Math.max(0, Math.min(inner[3], outer[3]) - Math.max(inner[1], outer[1]));
      const outerLng = Math.max(0, outer[2] - outer[0]);
      const outerLat = Math.max(0, outer[3] - outer[1]);
      const outerBoxArea = outerLng * outerLat;
      return outerBoxArea > 0 ? (innerLng * innerLat) / outerBoxArea : 0;
    } catch {
      return 0;
    }
  }

  function isUsablePolygonFeature(feature) {
    return !!(feature?.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'));
  }

  function rawLassoCoversMostParcel(rawLasso, parcel) {
    if (!rawLasso || !parcel) return false;
    return bboxCoverageRatio(rawLasso, parcel) >= 0.82;
  }

  function selectedResultIsSuspicious(selected, rawLasso, parcel, rawLassoArea, parcelArea, useRawAreaGuard) {
    if (!selected || !parcelArea || parcelArea <= 0) return true;
    let selectedArea = 0;
    try { selectedArea = turf.area(selected); } catch { return true; }
    if (selectedArea <= 0) return true;
    const selectedRatio = selectedArea / parcelArea;
    const rawRatio = parcelArea > 0 && rawLassoArea > 0 ? rawLassoArea / parcelArea : 0;
    if (selectedRatio > 0.85 && !rawLassoCoversMostParcel(rawLasso, parcel)) return true;
    if (useRawAreaGuard && rawLassoArea > 0 && selectedArea > rawLassoArea * 1.25 && rawRatio < 0.85) return true;
    return false;
  }

  function vertexCount(feature) {
    if (!feature?.geometry) return 0;
    if (feature.geometry.type === 'Polygon') {
      return feature.geometry.coordinates.reduce(function (sum, ring) {
        return sum + Math.max(0, ring.length - 1);
      }, 0);
    }
    if (feature.geometry.type === 'MultiPolygon') {
      return feature.geometry.coordinates.reduce(function (sum, polygon) {
        return sum + polygon.reduce(function (polySum, ring) {
          return polySum + Math.max(0, ring.length - 1);
        }, 0);
      }, 0);
    }
    return 0;
  }

  function finalSimplifyToleranceMeters(feature) {
    const fallback = 1.1;
    if (!feature?.geometry) return fallback;
    try {
      const center = turf.centroid(feature).geometry.coordinates;
      const point = { lng: center[0], lat: center[1] };
      const map = getMap();
      if (!map?.project || !map?.unproject) return fallback;
      const px = map.project([point.lng, point.lat]);
      const next = map.unproject([px.x + 2.5, px.y]);
      return Math.max(0.45, Math.min(2.4, distanceMeters(point, { lng: next.lng, lat: next.lat })));
    } catch {
      return fallback;
    }
  }

  function simplifyCoordRing(ring, toleranceMeters) {
    if (!ring || ring.length <= 12) return closeCoordRing(ring);
    const open = sameCoord(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring.slice();
    if (open.length <= 8) return closeCoordRing(open);
    const points = open.map(function (coord) { return { lng: coord[0], lat: coord[1] }; });
    let simplified;
    try { simplified = douglasPeucker(points, toleranceMeters); }
    catch { simplified = points; }
    if (simplified.length < 4) simplified = points;
    return closeCoordRing(simplified.map(function (point) { return [point.lng, point.lat]; }));
  }

  function simplifyPolygonCoords(coords, toleranceMeters) {
    if (!coords || !coords.length) return coords;
    return coords.map(function (ring) {
      return simplifyCoordRing(ring, toleranceMeters) || ring;
    }).filter(function (ring) { return ring && ring.length >= 4; });
  }

  function simplifyFinalMowableFeature(feature) {
    if (!isUsablePolygonFeature(feature)) return feature;
    const before = vertexCount(feature);
    const originalArea = turf.area(feature);
    let tolerance = finalSimplifyToleranceMeters(feature);
    let best = feature;

    for (let attempt = 0; attempt < 3; attempt++) {
      let candidate = null;
      try {
        if (feature.geometry.type === 'Polygon') {
          const coords = simplifyPolygonCoords(feature.geometry.coordinates, tolerance);
          if (coords && coords[0] && coords[0].length >= 4) {
            candidate = turf.polygon(coords, Object.assign({}, feature.properties || {}));
          }
        } else if (feature.geometry.type === 'MultiPolygon') {
          const polygons = feature.geometry.coordinates
            .map(function (coords) { return simplifyPolygonCoords(coords, tolerance); })
            .filter(function (coords) { return coords && coords[0] && coords[0].length >= 4; });
          if (polygons.length) candidate = turf.multiPolygon(polygons, Object.assign({}, feature.properties || {}));
        }
      } catch (e) {
        console.warn('[Lasso] final simplify failed:', e && e.message);
      }

      if (candidate && isUsablePolygonFeature(candidate)) {
        const area = turf.area(candidate);
        const areaDelta = originalArea > 0 ? Math.abs(area - originalArea) / originalArea : 0;
        if (area > 0 && areaDelta <= 0.025) {
          best = candidate;
          break;
        }
      }
      tolerance *= 0.5;
    }

    const after = vertexCount(best);
    console.log(
      '[Lasso] final simplify: verticesBefore=' + before +
      ' verticesAfter=' + after +
      ' toleranceMeters=' + tolerance.toFixed(2)
    );
    return best;
  }

  function outsideEnclosingSelection(rawLasso, parcel, parcelArea, rawCoverageFeature, rawLassoArea) {
    if (!rawLasso || !parcel || !window.turf) return null;
    let selected = null;
    try {
      selected = largestPolygonFeature(turf.intersect(parcel, rawLasso));
    } catch (e) {
      console.warn('[Lasso] outside-enclosing intersect failed:', e && e.message);
      return null;
    }
    if (!isUsablePolygonFeature(selected)) return null;

    const selectedArea = turf.area(selected);
    const ratio = parcelArea > 0 ? selectedArea / parcelArea : 0;
    const rawCoversMost = rawLassoCoversMostParcel(rawCoverageFeature || rawLasso, parcel);
    if (ratio > 0.85 && !rawCoversMost) {
      console.warn(
        '[Lasso] outside-enclosing fallback rejected: selected=' + Math.round(ratio * 100) +
        '% of parcel but raw bbox does not cover most parcel'
      );
      return null;
    }
    if (rawLassoArea > 0 && selectedArea > rawLassoArea * 1.35 && !rawCoversMost) {
      console.warn('[Lasso] outside-enclosing fallback rejected: selected area much larger than raw lasso');
      return null;
    }
    console.log(
      '[Lasso] outside-enclosing fallback selectedArea=' + Math.round(selectedArea) + ' m²' +
      ' percentParcel=' + (parcelArea > 0 ? Math.round(ratio * 100) : '?') + '%'
    );
    return selected;
  }

  function intersectCandidateWithParcel(candidate, parcel) {
    try {
      const clipped = turf.intersect(parcel, candidate);
      return largestPolygonFeature(clipped);
    } catch (e) {
      console.warn('[Lasso] fallback candidate intersect failed:', e && e.message);
      return null;
    }
  }

  function fatThumbToleranceMeters(point) {
    const map = getMap();
    if (!map?.project || !map?.unproject) return 5;
    try {
      const px = map.project([point.lng, point.lat]);
      const pxDistance = Math.max(8, Math.min(16, 12 * (window.devicePixelRatio || 1)));
      const next = map.unproject([px.x + pxDistance, px.y]);
      return Math.max(1.25, Math.min(12, distanceMeters(point, { lng: next.lng, lat: next.lat })));
    } catch {
      return 5;
    }
  }

  function classifyParcelPoint(point, parcel, parcelLine) {
    const boundary = nearestBoundaryInfo(point, parcelLine);
    const onBoundary = !!(boundary && boundary.dist <= BOUNDARY_EPS_METERS);
    let insideStrict = false;
    let insideOrBoundary = onBoundary;
    try {
      const pt = turf.point([point.lng, point.lat]);
      insideStrict = turf.booleanPointInPolygon(pt, parcel, { ignoreBoundary: true });
      insideOrBoundary = insideStrict || onBoundary || turf.booleanPointInPolygon(pt, parcel, { ignoreBoundary: false });
    } catch {}
    return { inside: insideOrBoundary, insideStrict, onBoundary, boundary };
  }

  function interpolatePoint(a, b, t) {
    return {
      lng: a.lng + (b.lng - a.lng) * t,
      lat: a.lat + (b.lat - a.lat) * t,
    };
  }

  function segmentBoundaryIntersections(a, b, ring, parcelLine) {
    if (!ring || ring.length < 4) return [];
    const ax = a.lng, ay = a.lat;
    const dx1 = b.lng - ax, dy1 = b.lat - ay;
    const out = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const cx = ring[i][0], cy = ring[i][1];
      const dx2 = ring[i + 1][0] - cx, dy2 = ring[i + 1][1] - cy;
      const denom = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(denom) < 1e-14) continue;
      const ddx = cx - ax, ddy = cy - ay;
      const t = (ddx * dy2 - ddy * dx2) / denom;
      const s = (ddx * dy1 - ddy * dx1) / denom;
      if (t <= 1e-7 || t >= 1 - 1e-7 || s < -1e-7 || s > 1 + 1e-7) continue;
      const point = { lng: ax + t * dx1, lat: ay + t * dy1 };
      if (out.some(function (hit) { return Math.abs(hit.t - t) < 1e-6 || distanceMeters(hit.point, point) < 0.15; })) continue;
      out.push({
        t,
        point,
        info: nearestBoundaryInfo(point, parcelLine) || { coord: [point.lng, point.lat], index: i, dist: 0 },
      });
    }
    return out.sort(function (left, right) { return left.t - right.t; });
  }

  function prepareFatThumbPath(inputPoints, parcel, parcelLine, parcelRing) {
    const base = deduplicateAdjacentPoints(inputPoints.slice());
    const records = base.map(function (point, index) {
      const info = nearestBoundaryInfo(point, parcelLine);
      const tolerance = fatThumbToleranceMeters(point);
      return { index, point, info, tolerance, near: !!(info && info.dist <= tolerance) };
    });

    const snapIndexes = new Set();
    let i = 0;
    while (i < records.length) {
      if (!records[i].near) { i++; continue; }
      let j = i + 1;
      while (j < records.length && records[j].near) j++;
      let best = records[i];
      for (let k = i + 1; k < j; k++) {
        if (records[k].info.dist < best.info.dist) best = records[k];
      }
      snapIndexes.add(best.index);
      i = j;
    }

    const snapped = records.map(function (record) {
      if (!snapIndexes.has(record.index) || !record.info) return record.point;
      return { lng: record.info.coord[0], lat: record.info.coord[1] };
    });

    const withSegmentTouches = [];
    let segmentInsertions = 0;
    for (let k = 0; k < snapped.length; k++) {
      const a = snapped[k];
      const b = snapped[(k + 1) % snapped.length];
      withSegmentTouches.push(a);
      const hasCrossing = segmentBoundaryIntersections(a, b, parcelRing, parcelLine).length > 0;
      if (hasCrossing) continue;
      const aInfo = nearestBoundaryInfo(a, parcelLine);
      const bInfo = nearestBoundaryInfo(b, parcelLine);
      const endpointAlreadyHandled = (aInfo && aInfo.dist <= fatThumbToleranceMeters(a)) ||
        (bInfo && bInfo.dist <= fatThumbToleranceMeters(b));
      if (endpointAlreadyHandled) continue;

      const mid = interpolatePoint(a, b, 0.5);
      const info = nearestBoundaryInfo(mid, parcelLine);
      if (info && info.dist <= fatThumbToleranceMeters(mid)) {
        withSegmentTouches.push({ lng: info.coord[0], lat: info.coord[1] });
        segmentInsertions++;
      }
    }

    const output = deduplicateAdjacentPoints(withSegmentTouches);
    console.log(
      '[Lasso] fat-thumb path: input=' + inputPoints.length +
      ' pointSnaps=' + snapIndexes.size +
      ' segmentInsertions=' + segmentInsertions +
      ' output=' + output.length
    );
    return output;
  }

  function buildExitEnterNodes(inputPoints, parcel, parcelRing, parcelLine) {
    const nodes = [];
    let crossingCount = 0;
    let outsideCount = 0;

    function pushNode(point, source, info) {
      const state = classifyParcelPoint(point, parcel, parcelLine);
      const node = {
        point,
        inside: state.inside,
        onBoundary: state.onBoundary || source === 'crossing' || source === 'snap',
        boundary: info || state.boundary,
        source,
      };
      if (!node.inside) outsideCount++;
      const prev = nodes[nodes.length - 1];
      if (prev && distanceMeters(prev.point, node.point) < 0.12 && prev.inside === node.inside) {
        if (node.onBoundary) {
          prev.onBoundary = true;
          prev.boundary = node.boundary || prev.boundary;
        }
        return;
      }
      nodes.push(node);
    }

    for (let i = 0; i < inputPoints.length; i++) {
      const a = inputPoints[i];
      const b = inputPoints[(i + 1) % inputPoints.length];
      if (i === 0) pushNode(a, 'drawn');
      segmentBoundaryIntersections(a, b, parcelRing, parcelLine).forEach(function (hit) {
        crossingCount++;
        pushNode(hit.point, 'crossing', hit.info);
      });
      if (i < inputPoints.length - 1) pushNode(b, 'drawn');
    }

    if (nodes.length > 1 && distanceMeters(nodes[0].point, nodes[nodes.length - 1].point) < 0.12) {
      const last = nodes.pop();
      nodes[0].onBoundary = nodes[0].onBoundary || last.onBoundary;
      nodes[0].boundary = nodes[0].boundary || last.boundary;
      nodes[0].inside = nodes[0].inside || last.inside;
    }

    nodes.forEach(function (node, index) {
      node.index = index;
    });

    const transitions = [];
    for (let i = 0; i < nodes.length; i++) {
      const curr = nodes[i];
      const next = nodes[(i + 1) % nodes.length];
      if (curr.inside && !next.inside) {
        transitions.push({ type: 'EXIT', node: curr });
        console.log('[Lasso] EXIT point=[' + curr.point.lng.toFixed(7) + ',' + curr.point.lat.toFixed(7) + ']');
      } else if (!curr.inside && next.inside) {
        transitions.push({ type: 'ENTER', node: next });
        console.log('[Lasso] ENTER point=[' + next.point.lng.toFixed(7) + ',' + next.point.lat.toFixed(7) + ']');
      }
    }

    console.log(
      '[Lasso] boundary crossing count=' + crossingCount +
      ' outsideNodeCount=' + outsideCount +
      ' transitions=' + transitions.length
    );
    return { nodes, crossingCount, outsideCount, transitions };
  }

  function splitInsideNodeRuns(nodes) {
    if (!nodes.length || nodes.every(function (node) { return node.inside; })) return [];
    const start = nodes.findIndex(function (node, index) {
      const prev = nodes[(index - 1 + nodes.length) % nodes.length];
      return node.inside && !prev.inside;
    });
    if (start < 0) return [];

    const ordered = nodes.slice(start).concat(nodes.slice(0, start));
    const runs = [];
    let current = [];
    ordered.forEach(function (node) {
      if (node.inside) {
        current.push(node);
      } else if (current.length) {
        runs.push(current);
        current = [];
      }
    });
    if (current.length) runs.push(current);
    return runs.filter(function (run) { return run.length >= 2; });
  }

  function nodesBetween(nodes, fromIndex, toIndex) {
    const out = [];
    if (!nodes.length) return out;
    let i = (fromIndex + 1) % nodes.length;
    let guard = 0;
    while (i !== toIndex && guard <= nodes.length) {
      if (!nodes[i].inside) out.push(nodes[i].point);
      i = (i + 1) % nodes.length;
      guard++;
    }
    return out;
  }

  function pointInExpandedBBox(coord, bbox, padRatio) {
    if (!bbox) return true;
    const lngPad = Math.max((bbox[2] - bbox[0]) * padRatio, 0.000002);
    const latPad = Math.max((bbox[3] - bbox[1]) * padRatio, 0.000002);
    return coord[0] >= bbox[0] - lngPad && coord[0] <= bbox[2] + lngPad &&
      coord[1] >= bbox[1] - latPad && coord[1] <= bbox[3] + latPad;
  }

  function rawBBoxArea(rawCoverageFeature) {
    if (!rawCoverageFeature || !window.turf) return 0;
    try { return turf.area(turf.bboxPolygon(turf.bbox(rawCoverageFeature))); } catch { return 0; }
  }

  function reconstructMowableFromExitEnter(inputPoints, parcel, parcelArea, rawCoverageFeature, rawLassoArea) {
    const parcelRing = getParcelRing(parcel);
    const parcelLine = getParcelLine(parcel);
    if (!parcel || !parcelRing || !parcelLine || !window.turf) return { feature: null, used: false };

    const path = prepareFatThumbPath(inputPoints, parcel, parcelLine, parcelRing);
    const analysis = buildExitEnterNodes(path, parcel, parcelRing, parcelLine);
    const rawCoversMost = rawLassoCoversMostParcel(rawCoverageFeature, parcel);
    let rawBBox = null;
    try { rawBBox = rawCoverageFeature ? turf.bbox(rawCoverageFeature) : null; } catch {}
    const rawBoxArea = rawBBoxArea(rawCoverageFeature);

    if (analysis.crossingCount === 0 && analysis.outsideCount === 0) {
      return { feature: null, used: false, path, analysis };
    }

    const runs = splitInsideNodeRuns(analysis.nodes);
    console.log('[Lasso] exit-enter reconstruction: inside runs=' + runs.length);
    const boundaryPerimeter = pathDistance(sameCoord(parcelRing[0], parcelRing[parcelRing.length - 1]) ? parcelRing : parcelRing.concat([parcelRing[0]]));
    const candidates = [];

    runs.forEach(function (run, runIndex) {
      const enter = run[0];
      const exit = run[run.length - 1];
      const enterInfo = enter.boundary || nearestBoundaryInfo(enter.point, parcelLine);
      const exitInfo = exit.boundary || nearestBoundaryInfo(exit.point, parcelLine);
      if (!enterInfo || !exitInfo) return;

      const outsidePoints = nodesBetween(analysis.nodes, exit.index, enter.index);
      const arc = chooseBoundaryArc(parcelRing, exitInfo, enterInfo, outsidePoints);
      const arcLength = pathDistance(arc);
      console.log(
        '[Lasso] candidate ' + runIndex +
        ' boundarySegmentLength=' + Math.round(arcLength) + 'm' +
        ' runPoints=' + run.length
      );

      if (boundaryPerimeter > 0 && arcLength >= boundaryPerimeter * 0.95 && !rawCoversMost) {
        console.warn('[Lasso] candidate rejected: boundary segment is effectively whole parcel ring');
        return;
      }

      const coords = run.map(function (node) { return [node.point.lng, node.point.lat]; });
      for (let i = 1; i < arc.length; i++) coords.push([arc[i][0], arc[i][1]]);
      const ring = closeCoordRing(coords);
      if (!ring) return;

      let candidate;
      try { candidate = turf.polygon([ring], { source: 'mowable_lasso_exit_enter', runIndex }); }
      catch (e) {
        console.warn('[Lasso] candidate polygon failed:', e && e.message);
        return;
      }

      const selected = intersectCandidateWithParcel(candidate, parcel);
      if (!isUsablePolygonFeature(selected)) return;
      const area = turf.area(selected);
      const ratio = parcelArea > 0 ? area / parcelArea : 0;
      if (area <= 0) return;
      if (ratio > 0.85 && !rawCoversMost) {
        console.warn('[Lasso] candidate rejected: >85% parcel without broad raw bbox');
        return;
      }

      let centroidInRawBBox = true;
      try {
        centroidInRawBBox = pointInExpandedBBox(turf.centroid(selected).geometry.coordinates, rawBBox, 0.25);
      } catch {}

      let score = area;
      if (!centroidInRawBBox) score *= 0.18;
      if (rawBoxArea > 0 && area > rawBoxArea * 1.75 && !rawCoversMost) score *= 0.35;
      candidates.push({ feature: selected, area, ratio, runIndex, score, centroidInRawBBox });
    });

    candidates.sort(function (a, b) { return b.score - a.score || b.area - a.area; });
    if (!candidates.length) return { feature: null, used: true, path, analysis };

    const best = candidates[0];
    console.log(
      '[Lasso] exit-enter reconstruction selected candidate=' + best.runIndex +
      ' area=' + Math.round(best.area) + ' m²' +
      ' percentParcel=' + Math.round(best.ratio * 100) + '%' +
      ' centroidInRawBBox=' + best.centroidInRawBBox
    );
    return { feature: best.feature, used: true, path, analysis };
  }

  function selectedMowableFeatureFromLasso(inputPoints) {
    console.log('[Lasso] selectedMowableFeatureFromLasso called: raw point count=' + inputPoints.length);
    if (!window.turf) {
      console.warn('[Lasso] turf not available');
      return null;
    }

    const rawLasso = polygonFeatureFromPoints(inputPoints);
    let rawLassoArea = 0;
    if (rawLasso) {
      try { rawLassoArea = turf.area(rawLasso); } catch (e) {
        console.warn('[Lasso] raw lasso area failed:', e && e.message);
      }
    } else {
      console.warn('[Lasso] could not build raw lasso polygon');
    }
    const rawCoverageFeature = rawLasso || lineFeatureFromPoints(inputPoints);

    if (drawPurpose === 'cut') {
      if (!rawLasso || rawLassoArea <= 0) {
        console.warn('[Lasso] cut lasso polygon invalid');
        if (typeof window.showWarning === 'function') window.showWarning('Cut shape too small - try again.');
        return null;
      }
      return rawLasso;
    }

    const parcel = getParcel();
    if (!parcel) return rawLasso;

    let parcelClone;
    try {
      parcelClone = JSON.parse(JSON.stringify(parcel));
    } catch (e) {
      console.error('[Lasso] failed to clone parcel:', e);
      if (typeof window.showError === 'function') window.showError('Property boundary error – try again.');
      return null;
    }

    const parcelArea = turf.area(parcelClone);
    console.log(
      '[Lasso] parcelArea=' + Math.round(parcelArea) + ' m²' +
      '  rawLassoArea=' + Math.round(rawLassoArea) + ' m²' +
      '  rawPercentOfParcel=' + (parcelArea > 0 ? Math.round(rawLassoArea / parcelArea * 100) : '?') + '%'
    );

    const reconstruction = reconstructMowableFromExitEnter(inputPoints, parcelClone, parcelArea, rawCoverageFeature, rawLassoArea);
    const workingPath = reconstruction.path || inputPoints;
    const workingLasso = polygonFeatureFromPoints(workingPath);
    const workingCoverageFeature = workingLasso || rawCoverageFeature || lineFeatureFromPoints(workingPath);
    let selected = null;
    let boundaryReconstructionUsed = false;
    let outsideEnclosingFallbackUsed = false;
    let failureReason = workingLasso ? '' : 'working polygon invalid';

    if (reconstruction.feature) {
      selected = reconstruction.feature;
      boundaryReconstructionUsed = true;
    } else if (reconstruction.used) {
      boundaryReconstructionUsed = true;
      selected = outsideEnclosingSelection(rawLasso, parcelClone, parcelArea, rawCoverageFeature, rawLassoArea);
      outsideEnclosingFallbackUsed = !!selected;
      failureReason = selected ? '' : 'exit/enter reconstruction produced no safe candidate';
    } else if (workingLasso) {
      try {
        selected = largestPolygonFeature(turf.intersect(parcelClone, workingLasso));
      } catch (e) {
        failureReason = 'intersect threw: ' + (e && e.message ? e.message : 'unknown');
        console.warn('[Lasso] ' + failureReason);
      }

      if (!selected) {
        failureReason = failureReason || 'intersect returned no polygon';
      } else if (selectedResultIsSuspicious(selected, workingCoverageFeature, parcelClone, rawLassoArea, parcelArea, true)) {
        const selectedArea = turf.area(selected);
        failureReason = 'result suspicious: selectedArea=' + Math.round(selectedArea) +
          ' m² (' + Math.round((parcelArea > 0 ? selectedArea / parcelArea : 0) * 100) + '% of parcel)';
        console.warn('[Lasso] ' + failureReason);
        selected = null;
      }
    } else {
      failureReason = failureReason || 'working lasso unavailable';
    }

    if (selected && selectedResultIsSuspicious(selected, workingCoverageFeature, parcelClone, rawLassoArea, parcelArea, false)) {
      const selectedArea = turf.area(selected);
      failureReason = 'final result suspicious: selectedArea=' + Math.round(selectedArea) +
        ' m² (' + Math.round((parcelArea > 0 ? selectedArea / parcelArea : 0) * 100) + '% of parcel)';
      console.error('[Lasso] ' + failureReason);
      selected = null;
    }

    console.log('[Lasso] outside-enclosing fallback used: ' + outsideEnclosingFallbackUsed);

    if (!isUsablePolygonFeature(selected)) {
      console.error('[Lasso] lasso could not be resolved without selecting whole/opposite parcel: ' + failureReason);
      if (typeof window.showError === 'function') {
        window.showError('Lasso crossed the parcel boundary in a way that could not be resolved. Try drawing just inside the boundary.');
      }
      return null;
    }

    const verticesBeforeFinalSimplify = vertexCount(selected);
    selected = simplifyFinalMowableFeature(selected);
    const verticesAfterFinalSimplify = vertexCount(selected);
    const selectedArea = turf.area(selected);
    console.log(
      '[Lasso] final selectedArea=' + Math.round(selectedArea) + ' m²' +
      '  rawLassoArea=' + Math.round(rawLassoArea) + ' m²' +
      '  parcelArea=' + Math.round(parcelArea) + ' m²' +
      '  percentParcelSelected=' + (parcelArea > 0 ? Math.round(selectedArea / parcelArea * 100) : '?') + '%' +
      '  boundaryReconstructionUsed=' + boundaryReconstructionUsed +
      '  outsideEnclosingFallbackUsed=' + outsideEnclosingFallbackUsed +
      '  verticesBeforeFinalSimplify=' + verticesBeforeFinalSimplify +
      '  verticesAfterFinalSimplify=' + verticesAfterFinalSimplify
    );
    selected.properties = selected.properties || {};
    selected.properties._turfLynkLassoAllowLarge = rawLassoCoversMostParcel(workingCoverageFeature, parcelClone);
    return selected;
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

    console.log('[Lasso] finishLasso called: raw points=' + points.length + ' purpose=' + drawPurpose);

    let cleaned;
    if (drawPurpose === 'cut') {
      cleaned = snapFullEdges(points.slice());
      console.log('[Lasso] finishLasso: cut after snapFullEdges=' + cleaned.length + ' pts');
      cleaned = simplifyPoints(cleaned, SMOOTH_TOLERANCE_METERS);
      if (cleaned.length > MAX_POINTS) cleaned = simplifyPoints(cleaned, STRONG_SMOOTH_TOLERANCE_METERS);
      if (cleaned.length > MAX_POINTS) cleaned = simplifyPoints(cleaned, STRONG_SMOOTH_TOLERANCE_METERS + 1.5);
      console.log('[Lasso] finishLasso: cut after simplify=' + cleaned.length + ' pts');
      cleaned = deduplicateAdjacentPoints(cleaned);
    } else {
      cleaned = deduplicateAdjacentPoints(dropTinySteps(points.slice(), 0.35));
    }
    console.log('[Lasso] finishLasso: after dedup=' + cleaned.length + ' pts');

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

    // Kill switch: proof that no whole-parcel result can reach setMowable.
    if (window.turf) {
      const _parcel = getParcel();
      if (_parcel) {
        const _parcelArea = turf.area(_parcel);
        const _selectedArea = turf.area(selectedFeature);
        const _ratio = _parcelArea > 0 ? _selectedArea / _parcelArea : 0;
        console.log(
          '[Lasso] FINAL source=lasso' +
          '  selectedArea=' + Math.round(_selectedArea) + ' m² (' + Math.round(_ratio * 100) + '% of parcel)' +
          '  parcelArea=' + Math.round(_parcelArea) + ' m²'
        );
        if (_parcelArea > 0 && _ratio >= 0.85 && !selectedFeature.properties?._turfLynkLassoAllowLarge) {
          console.error(
            '[Lasso] KILL SWITCH: selected area ' + Math.round(_ratio * 100) + '% ≥ 85% of parcel – blocked.' +
            ' Whole-parcel lasso must not reach setMowable.'
          );
          if (typeof window.showError === 'function') {
            window.showError('Lasso crossed the parcel boundary in a way that could not be resolved. Try drawing just inside the boundary.');
          }
          setStatus('Mode: Draw a smaller lasso inside the yard');
          return;
        }
      }
    }

    if (typeof window.setTurfLynkMowableFeatures === 'function') {
      const existingFeatures = window.TurfLynkAppState?.mowableFeatureCollection?.features || [];
      const nextId = selectedFeature.id || selectedFeature.properties?.id || ('mowable-lasso-' + Date.now() + '-' + existingFeatures.length);
      selectedFeature.id = nextId;
      selectedFeature.properties = selectedFeature.properties || {};
      selectedFeature.properties.id = nextId;
      window.setTurfLynkMowableFeatures(existingFeatures.concat([selectedFeature]));
      if (typeof window.selectTurfLynkMowableFeature === 'function') {
        window.selectTurfLynkMowableFeature(nextId);
      }
    }
    recalc();
    setStatus('Mode: Area added');
  }

  function armLasso(purpose) {
    const map = getMap();
    if (!map) { setStatus('Mode: Map not ready'); return; }

    // Verify parcel geometry is available before allowing a mowable lasso.
    if ((purpose || 'mowable') !== 'cut' && !getParcel()) {
      setStatus('Mode: No property loaded');
      if (typeof window.showWarning === 'function') window.showWarning('Load a property first, then draw the mowable area.');
      return;
    }

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
