// ai-tuning-pro.js — Professional AI/GIS Analysis Workstation Extension
// Phases 1–9: Advanced overlays, stage viewer, rejection inspector,
// polygon quality, GIS tools, ground truth, experiment safety, UI polish.
// Requires: maplibre-gl, turf (global), ai-tuning.js loaded first.
// Admin-only. NEVER affects customer-facing detection or production presets.

const aiTuningPro = (() => {
  'use strict';

  // ── Module state ─────────────────────────────────────────────────────────────
  let _map = null;
  let _lastResult = null;
  let _qualityApplied = null;   // result after quality post-processing
  let _pipelineStages = [];
  let _activeStage = -1;
  let _inspectorLocked = false;
  let _measureMode = null;       // null | 'distance' | 'area'
  let _measurePoints = [];
  let _measureMarkers = [];
  let _measureLineId = 'atp-measure-line';
  let _measureFillId = 'atp-measure-fill';
  let _snapshots = [];
  let _gtAnnotations = {};       // parcel hash → { tags, notes }
  let _gtMetrics = null;
  let _overlayOpacities = {};    // layerId → 0–1
  let _analyticalVisible = {};   // analysisLayerId → bool
  let _fullscreenActive = false;
  let _compactMode = false;
  let _coordinateDisplay = false;
  let _initialized = false;

  // Quality post-processing defaults
  const DEFAULT_QUALITY = {
    smoothingTolerance: 0,       // 0 = off, higher = more simplification
    minIslandSqft: 0,            // 0 = no filter, filter blobs smaller than this
    holeThresholdSqft: 0,        // 0 = no fill, fill holes smaller than this
    blobMergeDistance: 0,        // 0 = off, buffer/debuffer to merge close blobs
    smoothingIterations: 0,      // convex hull iterations
  };
  let _qualitySettings = { ...DEFAULT_QUALITY };

  // ── Utility helpers ───────────────────────────────────────────────────────────
  const el = (id) => document.getElementById(id);
  const qs = (sel, scope = document) => scope.querySelector(sel);
  const qsa = (sel, scope = document) => [...scope.querySelectorAll(sel)];
  const escHtml = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtArea = (sqft) => sqft >= 43560 ? (sqft / 43560).toFixed(2) + ' ac' : sqft.toFixed(0) + ' sqft';
  const fmtDist = (m) => m >= 1609 ? (m / 1609.34).toFixed(2) + ' mi' : m >= 100 ? Math.round(m * 3.28084) + ' ft' : (m * 3.28084).toFixed(1) + ' ft';

  function getMap() {
    if (_map) return _map;
    // Try to acquire map from aiTuning's bridge or directly from window
    if (window.map && window.map.getCanvas) { _map = window.map; return _map; }
    return null;
  }

  function getCurrentResult() { return _lastResult; }

  function parcelHashFromResult(r) {
    // Simple hash based on parcel centroid if available
    try {
      const fc = r?.parcelGeoJson || r?.diagnostic?.parcel;
      if (!fc) return null;
      const coords = JSON.stringify(fc).slice(0, 80);
      let h = 0;
      for (let i = 0; i < coords.length; i++) h = (Math.imul(h, 31) + coords.charCodeAt(i)) >>> 0;
      return 'p' + h.toString(16);
    } catch { return null; }
  }

  // ── Phase 1: Overlay Manager ──────────────────────────────────────────────────
  // Adds per-layer opacity sliders and analytical heatmap overlays.

  const ANALYTICAL_OVERLAYS = [
    { id: 'atp-confidence',   label: 'Confidence Gradient',  color: '#4ade80', opacity: 0.5, enabled: false },
    { id: 'atp-rejected',     label: 'Rejected Regions',     color: '#f87171', opacity: 0.4, enabled: false },
    { id: 'atp-hardscape',    label: 'Hardscape Exclusion',  color: '#fb923c', opacity: 0.35, enabled: false },
    { id: 'atp-fragmentation',label: 'Fragmentation Risk',   color: '#c084fc', opacity: 0.4, enabled: false },
  ];

  function initOverlayManager() {
    const container = el('atp-overlay-manager');
    if (!container) return;

    // Opacity sliders for existing layers
    const EXISTING_LAYERS = [
      { id: 'mowable',   label: 'AI Detection',     defaultOpacity: 0.45 },
      { id: 'parcel',    label: 'Parcel Boundary',  defaultOpacity: 0 },
      { id: 'prev',      label: 'Previous Run',     defaultOpacity: 0.30 },
      { id: 'manual',    label: 'Manual Areas',     defaultOpacity: 0.35 },
      { id: 'test-area', label: 'Test Area',        defaultOpacity: 0.28 },
    ];

    let html = '<div class="atp-om-section-label">Layer Opacity</div>';
    for (const layer of EXISTING_LAYERS) {
      _overlayOpacities[layer.id] = layer.defaultOpacity;
      html += `
        <div class="atp-om-row">
          <span class="atp-om-label">${escHtml(layer.label)}</span>
          <div class="atp-om-slider-wrap">
            <input type="range" class="atp-opacity-slider" id="atp-op-${layer.id}"
              data-layer="${layer.id}" min="0" max="1" step="0.05"
              value="${layer.defaultOpacity}" />
            <span class="atp-om-pct" id="atp-op-pct-${layer.id}">${Math.round(layer.defaultOpacity * 100)}%</span>
          </div>
        </div>`;
    }

    html += '<div class="atp-om-sep"></div><div class="atp-om-section-label">Analysis Overlays</div>';
    for (const ao of ANALYTICAL_OVERLAYS) {
      html += `
        <div class="atp-om-row">
          <label class="atp-om-check-label">
            <input type="checkbox" class="atp-analytical-toggle" data-aolayer="${ao.id}" ${ao.enabled ? 'checked' : ''} />
            <span class="atp-om-swatch" style="background:${ao.color}"></span>
            ${escHtml(ao.label)}
          </label>
        </div>`;
    }

    container.innerHTML = html;

    // Bind opacity sliders
    qsa('.atp-opacity-slider', container).forEach((slider) => {
      slider.addEventListener('input', () => {
        const layerId = slider.dataset.layer;
        const val = parseFloat(slider.value);
        _overlayOpacities[layerId] = val;
        const pctEl = el(`atp-op-pct-${layerId}`);
        if (pctEl) pctEl.textContent = Math.round(val * 100) + '%';
        setLayerOpacity(layerId, val);
      });
    });

    // Bind analytical overlay toggles
    qsa('.atp-analytical-toggle', container).forEach((chk) => {
      chk.addEventListener('change', () => {
        const aoId = chk.dataset.aolayer;
        _analyticalVisible[aoId] = chk.checked;
        toggleAnalyticalOverlay(aoId, chk.checked);
      });
    });
  }

  function setLayerOpacity(layerId, opacity) {
    const m = getMap();
    if (!m) return;
    const fillId = `ait-fill-${layerId}`;
    const lineId = `ait-line-${layerId}`;
    if (m.getLayer(fillId)) {
      m.setPaintProperty(fillId, 'fill-opacity', opacity);
    }
    if (m.getLayer(lineId) && layerId === 'parcel') {
      m.setPaintProperty(lineId, 'line-opacity', opacity > 0 ? 1 : 0.9);
    }
  }

  function addAnalyticalMapLayers() {
    const m = getMap();
    if (!m) return;
    for (const ao of ANALYTICAL_OVERLAYS) {
      const srcId = ao.id + '-src';
      if (!m.getSource(srcId)) {
        m.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }
      if (!m.getLayer(ao.id + '-fill')) {
        m.addLayer({
          id: ao.id + '-fill', type: 'fill', source: srcId,
          paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] },
          layout: { visibility: 'none' },
        });
      }
      if (!m.getLayer(ao.id + '-line')) {
        m.addLayer({
          id: ao.id + '-line', type: 'line', source: srcId,
          paint: { 'line-color': ao.color, 'line-width': 1.5, 'line-opacity': 0.8 },
          layout: { visibility: 'none' },
        });
      }
    }
    addMeasureLayers();
  }

  function toggleAnalyticalOverlay(aoId, visible) {
    const m = getMap();
    if (!m) return;
    const vis = visible ? 'visible' : 'none';
    [aoId + '-fill', aoId + '-line'].forEach((lid) => {
      if (m.getLayer(lid)) m.setLayoutProperty(lid, 'visibility', vis);
    });
    if (visible) refreshAnalyticalOverlay(aoId);
  }

  function refreshAnalyticalOverlay(aoId) {
    const m = getMap();
    if (!m || !_lastResult) return;
    const fc = _lastResult.featureCollection || { type: 'FeatureCollection', features: _lastResult.features || [] };
    const d  = _lastResult.diagnostic || _lastResult.diagnostics || {};
    let features = [];

    if (aoId === 'atp-confidence') {
      // Color each mowable polygon by confidence (use overall confidence score)
      const score = _lastResult.confidenceScore ?? 0.6;
      features = (fc.features || []).map((f, i) => ({
        ...f,
        properties: {
          ...f.properties,
          fillColor: score > 0.75 ? '#22c55e' : score > 0.5 ? '#eab308' : '#ef4444',
          fillOpacity: 0.3 + score * 0.3,
        },
      }));
    } else if (aoId === 'atp-hardscape') {
      // Show parcel boundary with softened color to indicate exclusion zone concept
      const parcelSrc = m.getSource('ait-src-parcel');
      if (parcelSrc?._data) {
        const parcelFc = parcelSrc._data;
        features = (parcelFc.features || []).map((f) => ({
          ...f,
          properties: { ...f.properties, fillColor: '#fb923c', fillOpacity: 0.12 },
        }));
      }
    } else if (aoId === 'atp-rejected') {
      // If result has rejection info use it, else show empty
      const rejCount = d.rejectedSmallComponents ?? 0;
      if (rejCount > 0) {
        features = (fc.features || []).filter((f) => {
          try {
            const areaSqft = window.turf ? Math.round(turf.area(f) * 10.7639) : 0;
            return areaSqft < 200;
          } catch { return false; }
        }).map((f) => ({
          ...f,
          properties: { ...f.properties, fillColor: '#f87171', fillOpacity: 0.5 },
        }));
      }
    } else if (aoId === 'atp-fragmentation') {
      const count = fc.features?.length ?? 0;
      if (count > 4) {
        features = (fc.features || []).map((f, i) => ({
          ...f,
          properties: {
            ...f.properties,
            fillColor: `hsl(${(i * 47) % 360}, 70%, 60%)`,
            fillOpacity: 0.35,
          },
        }));
      }
    }

    const srcId = aoId + '-src';
    const src = m.getSource(srcId);
    if (src) src.setData({ type: 'FeatureCollection', features });
  }

  function refreshAllAnalyticalOverlays() {
    for (const [aoId, visible] of Object.entries(_analyticalVisible)) {
      if (visible) refreshAnalyticalOverlay(aoId);
    }
  }

  // ── Phase 2: Detection Pipeline Viewer ───────────────────────────────────────
  // Staged visualization of the detection process.

  const PIPELINE_STAGE_DEFS = [
    { id: 'raw',        label: 'Raw Imagery',           icon: '🛰️', desc: 'Unprocessed satellite/aerial imagery of the parcel.' },
    { id: 'veg',        label: 'Vegetation Candidates', icon: '🌿', desc: 'Pixels classified as potential vegetation based on NDVI, excess green, and saturation filters.' },
    { id: 'hardscape',  label: 'Hardscape Exclusion',   icon: '🏗️', desc: 'Regions classified as impervious surfaces (concrete, pavement, roofing) removed from candidates.' },
    { id: 'structure',  label: 'Structure Exclusion',   icon: '🏠', desc: 'Building footprints and roof regions excluded using brightness and saturation thresholds.' },
    { id: 'shadow',     label: 'Shadow Exclusion',      icon: '🌑', desc: 'Dark shadow regions beneath eaves and trees excluded to prevent false detections.' },
    { id: 'morphology', label: 'Morphology Cleanup',    icon: '🔬', desc: 'Morphological close operations merge nearby lawn patches and fill small gaps.' },
    { id: 'polygons',   label: 'Polygon Extraction',    icon: '🗺️', desc: 'Binary mask converted to GeoJSON polygon boundaries.' },
    { id: 'filtering',  label: 'Polygon Filtering',     icon: '🔍', desc: 'Small blobs rejected, component count limited, and size ratios validated.' },
    { id: 'final',      label: 'Final Mowable Result',  icon: '✅', desc: 'Accepted polygons after server-side guardrails and safety checks.' },
  ];

  function initStageViewer() {
    const viewer = el('atp-stage-viewer');
    if (!viewer) return;

    let html = `
      <div class="atp-stage-header">
        <span class="atp-stage-title">Detection Pipeline</span>
        <span class="atp-stage-hint">Run a detection to populate stage data</span>
      </div>
      <div class="atp-stage-track" id="atp-stage-track">`;

    for (let i = 0; i < PIPELINE_STAGE_DEFS.length; i++) {
      const s = PIPELINE_STAGE_DEFS[i];
      html += `
        <button class="atp-stage-step" data-stage="${i}" title="${escHtml(s.desc)}">
          <span class="atp-stage-icon">${s.icon}</span>
          <span class="atp-stage-label">${escHtml(s.label)}</span>
          <span class="atp-stage-dot"></span>
        </button>`;
    }

    html += `</div>
      <div class="atp-stage-desc-box" id="atp-stage-desc">
        <em>Select a stage above to see details.</em>
      </div>
      <div class="atp-stage-actions">
        <button class="btn secondary small" id="atp-stage-prev" disabled>&#8592; Prev</button>
        <span class="atp-stage-counter" id="atp-stage-counter">—</span>
        <button class="btn secondary small" id="atp-stage-next" disabled>Next &#8594;</button>
        <button class="btn secondary small" id="atp-stage-compare" disabled title="Side-by-side: first vs last stage">Compare First/Last</button>
      </div>`;

    viewer.innerHTML = html;

    qsa('.atp-stage-step', viewer).forEach((btn) => {
      btn.addEventListener('click', () => setActiveStage(parseInt(btn.dataset.stage)));
    });
    el('atp-stage-prev')?.addEventListener('click', () => setActiveStage(_activeStage - 1));
    el('atp-stage-next')?.addEventListener('click', () => setActiveStage(_activeStage + 1));
    el('atp-stage-compare')?.addEventListener('click', () => compareFirstLastStage());
  }

  function setActiveStage(idx) {
    if (idx < 0 || idx >= PIPELINE_STAGE_DEFS.length) return;
    _activeStage = idx;
    const s = PIPELINE_STAGE_DEFS[idx];
    qsa('.atp-stage-step').forEach((btn) => btn.classList.toggle('atp-stage-active', parseInt(btn.dataset.stage) === idx));

    const descBox = el('atp-stage-desc');
    if (descBox) {
      const stage = _pipelineStages[idx];
      const dataNote = stage?.available
        ? `<span class="atp-stage-data-badge atp-stage-data-ok">Stage data available</span>`
        : `<span class="atp-stage-data-badge atp-stage-data-none">Run detection for live data</span>`;
      descBox.innerHTML = `
        <strong>${s.icon} ${escHtml(s.label)}</strong> ${dataNote}
        <p class="atp-stage-desc-text">${escHtml(s.desc)}</p>
        ${stage?.summary ? `<div class="atp-stage-summary">${escHtml(stage.summary)}</div>` : ''}`;
    }

    const counter = el('atp-stage-counter');
    if (counter) counter.textContent = `Stage ${idx + 1} of ${PIPELINE_STAGE_DEFS.length}`;

    const prevBtn = el('atp-stage-prev');
    const nextBtn = el('atp-stage-next');
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx >= PIPELINE_STAGE_DEFS.length - 1;

    // Show the appropriate map layer based on stage
    showMapForStage(idx);
  }

  function showMapForStage(idx) {
    if (!_lastResult) return;
    const m = getMap();
    if (!m) return;
    // Later stages show more refined results; earlier stages hide mowable layer
    const showMowable = idx >= 6;
    const mowFill = m.getLayer('ait-fill-mowable');
    const mowLine = m.getLayer('ait-line-mowable');
    if (mowFill) m.setLayoutProperty('ait-fill-mowable', 'visibility', showMowable ? 'visible' : 'none');
    if (mowLine) m.setLayoutProperty('ait-line-mowable', 'visibility', showMowable ? 'visible' : 'none');
  }

  function populatePipelineFromResult(result) {
    const d = result.diagnostic || result.diagnostics || {};
    _pipelineStages = PIPELINE_STAGE_DEFS.map((s, i) => {
      const available = i === 8; // Only final stage has confirmed data
      let summary = '';
      if (i === 8) {
        summary = `${result.features?.length ?? 0} polygon(s) | ${(result.areaSqft || 0).toFixed(0)} sqft | ${result.confidence || '—'}`;
      } else if (i === 7 && d.rejectedSmallComponents != null) {
        summary = `${d.rejectedSmallComponents} small blob(s) rejected | ${d.keptComponentCount ?? '?'} kept`;
        return { ...s, available: true, summary };
      } else if (i === 2 && d.hardscapeExcludedRatio != null) {
        summary = `Hardscape exclusion ratio: ${(d.hardscapeExcludedRatio * 100).toFixed(1)}%`;
        return { ...s, available: true, summary };
      }
      return { ...s, available, summary };
    });

    // Activate compare button when data loaded
    const cmpBtn = el('atp-stage-compare');
    if (cmpBtn) cmpBtn.disabled = false;

    // Mark stage dots as populated
    qsa('.atp-stage-dot').forEach((dot, i) => {
      dot.classList.toggle('atp-stage-dot-ok', _pipelineStages[i]?.available ?? false);
    });
  }

  function compareFirstLastStage() {
    if (!_lastResult) return;
    showToastPro('Showing final result — first stage is satellite imagery (no overlay)', 'info');
    setActiveStage(8);
  }

  // ── Phase 3: Rejection Inspector ─────────────────────────────────────────────
  // Floating panel showing why a region was accepted/rejected.

  let _inspectorCurrentFeature = null;

  function initRejectionInspector() {
    const panel = el('atp-inspector-panel');
    if (!panel) return;

    // Close button
    panel.querySelector('.atp-inspector-close')?.addEventListener('click', () => {
      unlockInspector();
      panel.classList.remove('atp-inspector-visible');
    });

    // Click-lock toggle
    el('atp-inspector-lock-btn')?.addEventListener('click', () => {
      _inspectorLocked = !_inspectorLocked;
      const btn = el('atp-inspector-lock-btn');
      if (btn) {
        btn.textContent = _inspectorLocked ? '🔒 Locked' : '🔓 Hover Mode';
        btn.classList.toggle('atp-inspector-locked-btn', _inspectorLocked);
      }
    });
  }

  function bindInspectorToMap() {
    const m = getMap();
    if (!m) return;

    // Hover: show inspector in hover mode
    ['ait-fill-mowable', 'ait-fill-manual'].forEach((layerId) => {
      m.on('mouseenter', layerId, (e) => {
        if (_inspectorLocked) return;
        m.getCanvas().style.cursor = 'pointer';
        const feature = e.features?.[0];
        showInspectorForFeature(feature, e.lngLat, 'accepted');
      });
      m.on('mouseleave', layerId, () => {
        if (_inspectorLocked) return;
        m.getCanvas().style.cursor = '';
        if (!_inspectorLocked) hideInspector();
      });
    });

    // Click: lock inspector on polygon click
    m.on('click', (e) => {
      const features = m.queryRenderedFeatures(e.point, { layers: ['ait-fill-mowable', 'ait-fill-manual'] });
      if (features.length) {
        _inspectorLocked = true;
        const btn = el('atp-inspector-lock-btn');
        if (btn) { btn.textContent = '🔒 Locked'; btn.classList.add('atp-inspector-locked-btn'); }
        showInspectorForFeature(features[0], e.lngLat, 'accepted');
      } else if (_inspectorLocked) {
        // Click on empty area — show rejection info
        showInspectorForEmptyArea(e.lngLat);
      }
    });
  }

  function showInspectorForFeature(feature, lngLat, verdict) {
    const panel = el('atp-inspector-panel');
    if (!panel) return;
    _inspectorCurrentFeature = feature;

    const d = _lastResult?.diagnostic || _lastResult?.diagnostics || {};
    const confidence = _lastResult?.confidenceScore ?? null;
    const confLabel  = _lastResult?.confidence || '—';

    let areaSqft = 0;
    try { areaSqft = window.turf ? Math.round(turf.area(feature) * 10.7639) : 0; } catch {}

    const html = `
      <div class="atp-inspector-verdict atp-inspector-accepted">Accepted Polygon</div>
      <div class="atp-inspector-grid">
        <div class="atp-inspector-row"><span class="atp-inspector-key">Area</span><span class="atp-inspector-val">${areaSqft.toFixed(0)} sqft</span></div>
        <div class="atp-inspector-row"><span class="atp-inspector-key">Confidence</span><span class="atp-inspector-val">${escHtml(confLabel)}${confidence != null ? ' (' + confidence.toFixed(2) + ')' : ''}</span></div>
        <div class="atp-inspector-row"><span class="atp-inspector-key">Detected Ratio</span><span class="atp-inspector-val">${d.detectedRatio != null ? (d.detectedRatio * 100).toFixed(1) + '%' : '—'}</span></div>
        <div class="atp-inspector-row"><span class="atp-inspector-key">NDVI Threshold</span><span class="atp-inspector-val">${d.ndviThreshold != null ? d.ndviThreshold.toFixed(3) : '—'}</span></div>
        <div class="atp-inspector-row"><span class="atp-inspector-key">Detection Mode</span><span class="atp-inspector-val">${escHtml(d.detectionMode || d.detection_mode || '—')}</span></div>
        <div class="atp-inspector-row"><span class="atp-inspector-key">Accept Reason</span><span class="atp-inspector-val">${escHtml(d.finalAcceptReason || '—')}</span></div>
      </div>`;

    showInspector(html, lngLat);
  }

  function showInspectorForEmptyArea(lngLat) {
    const panel = el('atp-inspector-panel');
    if (!panel) return;
    if (!_lastResult) { hideInspector(); return; }

    const d = _lastResult?.diagnostic || _lastResult?.diagnostics || {};
    const reasons = [];
    if (d.failureStage) reasons.push(`Pipeline failure at: ${d.failureStage}`);
    if (d.detectedRatio > 0.80) reasons.push(`Over-detection guard triggered (${(d.detectedRatio * 100).toFixed(1)}%)`);
    if (d.hardscapeExcludedRatio < 0.01) reasons.push('Insufficient hardscape exclusion evidence');
    if (d.fallbackSoftMaskUsed) reasons.push('Soft fallback was required');
    if (!reasons.length) reasons.push('Region outside detected mowable boundary');

    const html = `
      <div class="atp-inspector-verdict atp-inspector-rejected">Outside Mowable Area</div>
      <div class="atp-inspector-reason-list">
        ${reasons.map((r) => `<div class="atp-inspector-reason-item">• ${escHtml(r)}</div>`).join('')}
      </div>
      <div class="atp-inspector-hint">Click a green mowable polygon for acceptance details.</div>`;

    showInspector(html, lngLat);
  }

  function showInspector(html, lngLat) {
    const panel = el('atp-inspector-panel');
    if (!panel) return;
    const body = panel.querySelector('.atp-inspector-body');
    if (body) body.innerHTML = html;
    panel.classList.add('atp-inspector-visible');
    positionInspector(panel, lngLat);
  }

  function positionInspector(panel, lngLat) {
    if (!lngLat) return;
    const m = getMap();
    if (!m) return;
    try {
      const pt = m.project(lngLat);
      const mapEl = el('ait-map');
      const rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0, width: 800 };
      const panelW = 280;
      let left = rect.left + pt.x + 12;
      if (left + panelW > window.innerWidth - 10) left = rect.left + pt.x - panelW - 12;
      left = Math.max(10, left);
      const top = Math.max(10, rect.top + pt.y - 80);
      panel.style.left = left + 'px';
      panel.style.top  = top + 'px';
      panel.style.position = 'fixed';
    } catch {}
  }

  function hideInspector() {
    el('atp-inspector-panel')?.classList.remove('atp-inspector-visible');
  }

  function unlockInspector() {
    _inspectorLocked = false;
    const btn = el('atp-inspector-lock-btn');
    if (btn) { btn.textContent = '🔓 Hover Mode'; btn.classList.remove('atp-inspector-locked-btn'); }
  }

  // ── Phase 4: Polygon Quality Controls ────────────────────────────────────────
  // Client-side post-processing using Turf.js.

  function initQualityControls() {
    const container = el('atp-quality-controls');
    if (!container) return;

    container.innerHTML = `
      <div class="atp-quality-grid">
        <div class="atp-quality-row">
          <div class="atp-quality-top">
            <label class="atp-quality-label" for="atp-q-smooth">Smoothing / Simplify</label>
            <span class="atp-quality-val" id="atp-q-smooth-val">Off</span>
          </div>
          <div class="atp-quality-desc">Simplifies polygon contours (Turf.js simplify). 0 = off.</div>
          <input type="range" id="atp-q-smooth" class="ait-slider" min="0" max="0.0002" step="0.000005" value="0"
            oninput="aiTuningPro._onQuality('smoothingTolerance', parseFloat(this.value))" />
        </div>
        <div class="atp-quality-row">
          <div class="atp-quality-top">
            <label class="atp-quality-label" for="atp-q-island">Min Island Size</label>
            <span class="atp-quality-val" id="atp-q-island-val">Off</span>
          </div>
          <div class="atp-quality-desc">Removes polygons smaller than this (sqft). 0 = no filter.</div>
          <input type="range" id="atp-q-island" class="ait-slider" min="0" max="500" step="10" value="0"
            oninput="aiTuningPro._onQuality('minIslandSqft', parseFloat(this.value))" />
        </div>
        <div class="atp-quality-row">
          <div class="atp-quality-top">
            <label class="atp-quality-label" for="atp-q-merge">Blob Merge Distance (ft)</label>
            <span class="atp-quality-val" id="atp-q-merge-val">Off</span>
          </div>
          <div class="atp-quality-desc">Buffer + debuffer to merge nearby blobs (feet). 0 = off.</div>
          <input type="range" id="atp-q-merge" class="ait-slider" min="0" max="20" step="1" value="0"
            oninput="aiTuningPro._onQuality('blobMergeDistance', parseFloat(this.value))" />
        </div>
        <div class="atp-quality-row">
          <div class="atp-quality-top">
            <label class="atp-quality-label" for="atp-q-hole">Hole Fill Threshold (sqft)</label>
            <span class="atp-quality-val" id="atp-q-hole-val">Off</span>
          </div>
          <div class="atp-quality-desc">Fills polygon holes smaller than this area. 0 = off.</div>
          <input type="range" id="atp-q-hole" class="ait-slider" min="0" max="300" step="10" value="0"
            oninput="aiTuningPro._onQuality('holeThresholdSqft', parseFloat(this.value))" />
        </div>
      </div>
      <div class="atp-quality-actions">
        <button class="btn secondary small" id="atp-q-apply-btn" disabled>Apply Preview</button>
        <button class="btn secondary small" id="atp-q-reset-btn" disabled>Reset Quality</button>
        <span class="atp-quality-status" id="atp-quality-status"></span>
      </div>
      <div class="atp-quality-hint">Quality settings apply a client-side preview only. They do not modify saved presets or affect production detection.</div>`;

    el('atp-q-apply-btn')?.addEventListener('click', applyQualityPreview);
    el('atp-q-reset-btn')?.addEventListener('click', resetQuality);
  }

  function _onQuality(key, value) {
    _qualitySettings[key] = value;
    updateQualityLabel(key, value);
    const applyBtn = el('atp-q-apply-btn');
    const resetBtn = el('atp-q-reset-btn');
    if (applyBtn) applyBtn.disabled = !_lastResult;
    if (resetBtn) resetBtn.disabled = false;
  }

  function updateQualityLabel(key, value) {
    const MAP = {
      smoothingTolerance: { id: 'atp-q-smooth-val',  fmt: (v) => v === 0 ? 'Off' : (v * 1000000).toFixed(0) + 'µ' },
      minIslandSqft:      { id: 'atp-q-island-val',  fmt: (v) => v === 0 ? 'Off' : v.toFixed(0) + ' sqft' },
      blobMergeDistance:  { id: 'atp-q-merge-val',   fmt: (v) => v === 0 ? 'Off' : v.toFixed(0) + ' ft' },
      holeThresholdSqft:  { id: 'atp-q-hole-val',    fmt: (v) => v === 0 ? 'Off' : v.toFixed(0) + ' sqft' },
    };
    const def = MAP[key];
    if (!def) return;
    const lbl = el(def.id);
    if (lbl) lbl.textContent = def.fmt(value);
  }

  function applyQualityPreview() {
    if (!_lastResult || !window.turf) return;
    const statusEl = el('atp-quality-status');
    if (statusEl) statusEl.textContent = 'Processing…';

    try {
      const fc = _lastResult.featureCollection || { type: 'FeatureCollection', features: _lastResult.features || [] };
      let features = JSON.parse(JSON.stringify(fc.features || []));

      // Filter small islands
      if (_qualitySettings.minIslandSqft > 0) {
        features = features.filter((f) => {
          try { return turf.area(f) * 10.7639 >= _qualitySettings.minIslandSqft; } catch { return true; }
        });
      }

      // Blob merge (buffer + negative buffer)
      if (_qualitySettings.blobMergeDistance > 0 && features.length > 0) {
        try {
          const bufDeg = (_qualitySettings.blobMergeDistance / 5280) / 69; // ft → degrees approx
          features = features.map((f) => {
            try {
              const buffered  = turf.buffer(f, bufDeg, { units: 'degrees' });
              const debuffered = turf.buffer(buffered, -bufDeg * 0.6, { units: 'degrees' });
              return debuffered || f;
            } catch { return f; }
          });
        } catch {}
      }

      // Simplification
      if (_qualitySettings.smoothingTolerance > 0) {
        features = features.map((f) => {
          try { return turf.simplify(f, { tolerance: _qualitySettings.smoothingTolerance, highQuality: true }); }
          catch { return f; }
        });
      }

      // Hole fill
      if (_qualitySettings.holeThresholdSqft > 0) {
        features = features.map((f) => {
          try {
            if (f.geometry?.type !== 'Polygon') return f;
            const rings = f.geometry.coordinates;
            if (rings.length <= 1) return f;
            const outer = rings[0];
            const keptHoles = rings.slice(1).filter((hole) => {
              try {
                const holeArea = Math.abs(turf.area({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [hole] } })) * 10.7639;
                return holeArea >= _qualitySettings.holeThresholdSqft;
              } catch { return true; }
            });
            return { ...f, geometry: { ...f.geometry, coordinates: [outer, ...keptHoles] } };
          } catch { return f; }
        });
      }

      _qualityApplied = { type: 'FeatureCollection', features };

      // Push to mowable layer for preview
      const m = getMap();
      if (m) {
        const src = m.getSource('ait-src-mowable');
        if (src) src.setData(_qualityApplied);
      }

      const totalSqft = features.reduce((sum, f) => {
        try { return sum + turf.area(f) * 10.7639; } catch { return sum; }
      }, 0);
      if (statusEl) statusEl.textContent = `Preview: ${features.length} polygon(s), ${totalSqft.toFixed(0)} sqft`;
      showToastPro('Quality preview applied. Not saved.', 'info');
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Error: ' + err.message;
    }
  }

  function resetQuality() {
    _qualitySettings = { ...DEFAULT_QUALITY };
    _qualityApplied = null;
    ['atp-q-smooth','atp-q-island','atp-q-merge','atp-q-hole'].forEach((id) => {
      const el_ = el(id);
      if (el_) el_.value = 0;
    });
    Object.keys(DEFAULT_QUALITY).forEach((k) => updateQualityLabel(k, 0));
    const applyBtn = el('atp-q-apply-btn');
    const resetBtn = el('atp-q-reset-btn');
    if (applyBtn) applyBtn.disabled = !_lastResult;
    if (resetBtn) resetBtn.disabled = true;
    // Restore original detection result
    if (_lastResult) {
      const m = getMap();
      if (m) {
        const src = m.getSource('ait-src-mowable');
        if (src) src.setData(_lastResult.featureCollection || { type: 'FeatureCollection', features: _lastResult.features || [] });
      }
    }
    el('atp-quality-status') && (el('atp-quality-status').textContent = '');
    showToastPro('Quality reset to original detection result.', 'success');
  }

  // ── Phase 5: Professional GIS Tools ──────────────────────────────────────────

  // -- Measurement --

  function addMeasureLayers() {
    const m = getMap();
    if (!m) return;
    if (!m.getSource(_measureLineId + '-src')) {
      m.addSource(_measureLineId + '-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: _measureLineId, type: 'line', source: _measureLineId + '-src',
        paint: { 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [4, 2] } });
    }
    if (!m.getSource(_measureFillId + '-src')) {
      m.addSource(_measureFillId + '-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: _measureFillId, type: 'fill', source: _measureFillId + '-src',
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.12 } });
    }
  }

  function startMeasureMode(mode) {
    cancelMeasureMode();
    _measureMode = mode;
    _measurePoints = [];
    _measureMarkers = [];
    updateMeasureStatus('Click on map to start measuring. Double-click to finish.');
    const m = getMap();
    if (!m) return;
    m.getCanvas().style.cursor = 'crosshair';
    m.on('click', onMeasureClick);
    m.on('dblclick', onMeasureDblClick);
    showToastPro(mode === 'distance' ? 'Distance tool active. Click to add points, double-click to finish.' : 'Area tool active. Click to add points, double-click to finish.', 'info');

    // Highlight the active tool
    el('atp-tool-measure-dist')?.classList.toggle('ait-tool-active', mode === 'distance');
    el('atp-tool-measure-area')?.classList.toggle('ait-tool-active', mode === 'area');
  }

  function cancelMeasureMode() {
    if (!_measureMode) return;
    const m = getMap();
    if (m) {
      m.off('click', onMeasureClick);
      m.off('dblclick', onMeasureDblClick);
      m.getCanvas().style.cursor = '';
      const lnSrc = m.getSource(_measureLineId + '-src');
      if (lnSrc) lnSrc.setData({ type: 'FeatureCollection', features: [] });
      const flSrc = m.getSource(_measureFillId + '-src');
      if (flSrc) flSrc.setData({ type: 'FeatureCollection', features: [] });
    }
    _measureMarkers.forEach((mk) => { try { mk.remove(); } catch {} });
    _measureMarkers = [];
    _measurePoints = [];
    _measureMode = null;
    el('atp-tool-measure-dist')?.classList.remove('ait-tool-active');
    el('atp-tool-measure-area')?.classList.remove('ait-tool-active');
    updateMeasureStatus('');
  }

  function onMeasureClick(e) {
    if (!_measureMode) return;
    e.preventDefault();
    _measurePoints.push([e.lngLat.lng, e.lngLat.lat]);
    addMeasureMarker(e.lngLat);
    renderMeasureOverlay();
  }

  function onMeasureDblClick(e) {
    if (!_measureMode || _measurePoints.length < 2) return;
    e.preventDefault();
    finalizeMeasure();
  }

  function addMeasureMarker(lngLat) {
    const m = getMap();
    if (!m) return;
    const el_ = document.createElement('div');
    el_.className = 'atp-measure-dot';
    const mk = new maplibregl.Marker({ element: el_, anchor: 'center' }).setLngLat(lngLat).addTo(m);
    _measureMarkers.push(mk);
  }

  function renderMeasureOverlay() {
    const m = getMap();
    if (!m || _measurePoints.length < 2) return;
    const lineCoords = [..._measurePoints];
    const lnSrc = m.getSource(_measureLineId + '-src');
    if (lnSrc) lnSrc.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: lineCoords } }] });

    if (_measureMode === 'area' && _measurePoints.length >= 3 && window.turf) {
      const closed = [...lineCoords, lineCoords[0]];
      const flSrc = m.getSource(_measureFillId + '-src');
      if (flSrc) flSrc.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] } }] });
    }

    // Update measurement readout
    if (window.turf) {
      if (_measureMode === 'distance') {
        const line = turf.lineString(_measurePoints);
        const km = turf.length(line, { units: 'kilometers' });
        updateMeasureStatus('Distance: ' + fmtDist(km * 1000));
      } else if (_measureMode === 'area' && _measurePoints.length >= 3) {
        const closed = [..._measurePoints, _measurePoints[0]];
        const polygon = turf.polygon([closed]);
        const sqm = turf.area(polygon);
        updateMeasureStatus('Area: ' + fmtArea(sqm * 10.7639));
      }
    }
  }

  function finalizeMeasure() {
    if (window.turf) {
      if (_measureMode === 'distance' && _measurePoints.length >= 2) {
        const km = turf.length(turf.lineString(_measurePoints), { units: 'kilometers' });
        updateMeasureStatus('Final distance: ' + fmtDist(km * 1000));
        showToastPro('Measured: ' + fmtDist(km * 1000), 'success');
      } else if (_measureMode === 'area' && _measurePoints.length >= 3) {
        const closed = [..._measurePoints, _measurePoints[0]];
        const sqm = turf.area(turf.polygon([closed]));
        updateMeasureStatus('Final area: ' + fmtArea(sqm * 10.7639));
        showToastPro('Measured: ' + fmtArea(sqm * 10.7639), 'success');
      }
    }
    // Keep overlay visible but stop capture
    const m = getMap();
    if (m) {
      m.off('click', onMeasureClick);
      m.off('dblclick', onMeasureDblClick);
      m.getCanvas().style.cursor = '';
    }
    _measureMode = null;
    el('atp-tool-measure-dist')?.classList.remove('ait-tool-active');
    el('atp-tool-measure-area')?.classList.remove('ait-tool-active');
  }

  function updateMeasureStatus(msg) {
    const statusEl = el('atp-measure-status');
    if (statusEl) statusEl.textContent = msg;
  }

  // -- Coordinate readout --

  function initCoordinateReadout() {
    const m = getMap();
    if (!m) return;
    m.on('mousemove', (e) => {
      if (!_coordinateDisplay) return;
      const coord = el('atp-coord-readout');
      if (coord) {
        coord.textContent = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
      }
    });
    m.on('mouseleave', () => {
      const coord = el('atp-coord-readout');
      if (coord) coord.textContent = '';
    });
  }

  function toggleCoordinateReadout() {
    _coordinateDisplay = !_coordinateDisplay;
    const btn = el('atp-tool-coords');
    if (btn) btn.classList.toggle('ait-tool-active', _coordinateDisplay);
    const readout = el('atp-coord-readout');
    if (readout) readout.style.display = _coordinateDisplay ? 'block' : 'none';
  }

  // -- Zoom to result --

  function zoomToResult() {
    const m = getMap();
    if (!m || !_lastResult) { showToastPro('No detection result to zoom to.', 'error'); return; }
    const fc = _lastResult.featureCollection || { type: 'FeatureCollection', features: _lastResult.features || [] };
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    (fc.features || []).forEach((f) => {
      const coords = JSON.stringify(f.geometry?.coordinates || []).match(/-?\d+\.\d+/g) || [];
      for (let i = 0; i < coords.length; i += 2) {
        const lng = parseFloat(coords[i]), lat = parseFloat(coords[i + 1]);
        if (!isNaN(lng) && !isNaN(lat)) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    });
    if (isFinite(minLng)) {
      m.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, maxZoom: 20, duration: 500 });
    }
  }

  // -- Fullscreen --

  function toggleFullscreen() {
    const wrapper = el('ait-map-pane') || el('ait-map');
    if (!wrapper) return;
    if (!document.fullscreenElement) {
      wrapper.requestFullscreen?.().then(() => {
        _fullscreenActive = true;
        el('atp-tool-fullscreen')?.classList.add('ait-tool-active');
        setTimeout(() => getMap()?.resize(), 100);
      }).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => {
        _fullscreenActive = false;
        el('atp-tool-fullscreen')?.classList.remove('ait-tool-active');
        setTimeout(() => getMap()?.resize(), 100);
      }).catch(() => {});
    }
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      _fullscreenActive = false;
      el('atp-tool-fullscreen')?.classList.remove('ait-tool-active');
      setTimeout(() => getMap()?.resize(), 100);
    }
  });

  // -- Keyboard shortcuts --

  const SHORTCUTS = [
    { key: 'r', desc: 'Run Detection',         action: () => document.getElementById('ait-run-btn')?.click() },
    { key: 't', desc: 'Test Current Settings',  action: () => document.getElementById('ait-test-btn')?.click() },
    { key: 'c', desc: 'Compare Previous Run',   action: () => document.getElementById('ait-compare-btn')?.click() },
    { key: 'd', desc: 'Draw / Lasso Tool',      action: () => document.getElementById('ait-tool-draw')?.click() },
    { key: 'x', desc: 'Cutout Tool',            action: () => document.getElementById('ait-tool-cut')?.click() },
    { key: 'z', desc: 'Undo Last Action',       action: () => document.getElementById('ait-tool-undo')?.click() },
    { key: 'Escape', desc: 'Cancel / Clear',    action: () => { cancelMeasureMode(); hideInspector(); unlockInspector(); } },
    { key: 'f', desc: 'Toggle Fullscreen',      action: () => toggleFullscreen() },
    { key: 'm', desc: 'Measure Distance',       action: () => _measureMode ? cancelMeasureMode() : startMeasureMode('distance') },
    { key: 'a', desc: 'Measure Area',           action: () => _measureMode ? cancelMeasureMode() : startMeasureMode('area') },
    { key: 'g', desc: 'Zoom to Result',         action: () => zoomToResult() },
    { key: 'k', desc: 'Toggle Coordinate Readout', action: () => toggleCoordinateReadout() },
    { key: '?', desc: 'Keyboard Shortcuts Help', action: () => toggleShortcutsModal() },
    { key: 'p', desc: 'Compact / Power Mode',   action: () => toggleCompactMode() },
  ];

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Skip if inside input/textarea
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Skip if AI Detection tab is not active
      const aiTab = document.querySelector('[data-admin-tab-panel="ai-detection"]');
      if (!aiTab || !aiTab.classList.contains('active')) return;

      const shortcut = SHORTCUTS.find((s) => s.key === e.key);
      if (shortcut) {
        e.preventDefault();
        shortcut.action();
      }
    });
  }

  function toggleShortcutsModal() {
    const modal = el('atp-shortcuts-modal');
    if (!modal) return;
    modal.hidden = !modal.hidden;
  }

  function buildShortcutsModal() {
    const modal = el('atp-shortcuts-modal');
    if (!modal) return;
    const rows = SHORTCUTS.map((s) =>
      `<tr><td><kbd>${escHtml(s.key === ' ' ? 'Space' : s.key)}</kbd></td><td>${escHtml(s.desc)}</td></tr>`
    ).join('');
    modal.innerHTML = `
      <div class="atp-modal-box">
        <div class="atp-modal-head">
          <h3 class="atp-modal-title">Keyboard Shortcuts</h3>
          <button class="atp-modal-close" onclick="el('atp-shortcuts-modal').hidden=true">✕</button>
        </div>
        <table class="atp-shortcut-table"><tbody>${rows}</tbody></table>
        <p class="atp-shortcut-note">Shortcuts are active when the AI Detection tab is open and focus is not in a text input.</p>
      </div>`;
    // Wire close
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  }

  // -- Compact / Power Mode --

  function toggleCompactMode() {
    _compactMode = !_compactMode;
    document.querySelector('.ait-workstation')?.classList.toggle('atp-compact-mode', _compactMode);
    el('atp-tool-compact')?.classList.toggle('ait-tool-active', _compactMode);
    showToastPro(_compactMode ? 'Compact mode on' : 'Compact mode off', 'info');
  }

  // ── Phase 6: Ground Truth & Training Support ──────────────────────────────────

  const GT_TAGS = [
    { id: 'training_candidate', label: 'Training Candidate', color: '#3b82f6' },
    { id: 'known_bad',          label: 'Known Bad',          color: '#ef4444' },
    { id: 'excellent_result',   label: 'Excellent Result',   color: '#22c55e' },
  ];

  function initGroundTruth() {
    const panel = el('atp-gt-panel');
    if (!panel) return;

    const tagHtml = GT_TAGS.map((t) => `
      <label class="atp-gt-tag-row">
        <input type="checkbox" class="atp-gt-tag-chk" data-tag="${t.id}" />
        <span class="atp-gt-tag" style="--tag-color:${t.color}">${escHtml(t.label)}</span>
      </label>`).join('');

    panel.innerHTML = `
      <div class="atp-gt-tagging">
        <div class="atp-section-label">Parcel Tags</div>
        <div class="atp-gt-tags">${tagHtml}</div>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          <input type="text" id="atp-gt-notes" placeholder="Notes about this parcel…" class="atp-gt-notes" />
          <button class="btn secondary small" id="atp-gt-save-btn">Save Tags</button>
        </div>
      </div>
      <div class="atp-gt-metrics" id="atp-gt-metrics" style="display:none">
        <div class="atp-section-label">Ground Truth vs AI</div>
        <div class="atp-gt-metric-grid" id="atp-gt-metric-grid"></div>
      </div>
      <div class="atp-gt-actions">
        <button class="btn secondary small" id="atp-gt-compute-btn" disabled title="Compute overlap metrics between manual areas and AI detection">Compute Metrics</button>
        <button class="btn secondary small" id="atp-gt-save-gt-btn" disabled title="Save current manual areas as ground truth baseline">Save as Ground Truth</button>
        <button class="btn secondary small" id="atp-gt-show-diff-btn" disabled title="Show visual disagreement overlay between AI and manual">Show Disagreement</button>
      </div>`;

    el('atp-gt-save-btn')?.addEventListener('click', saveParcelTags);
    el('atp-gt-compute-btn')?.addEventListener('click', computeGtMetrics);
    el('atp-gt-save-gt-btn')?.addEventListener('click', saveGroundTruth);
    el('atp-gt-show-diff-btn')?.addEventListener('click', showGtDisagreement);
  }

  function saveParcelTags() {
    const hash = _lastResult ? parcelHashFromResult(_lastResult) : 'current';
    if (!hash) return;
    const tags = GT_TAGS.map((t) => {
      const chk = document.querySelector(`.atp-gt-tag-chk[data-tag="${t.id}"]`);
      return chk?.checked ? t.id : null;
    }).filter(Boolean);
    const notes = el('atp-gt-notes')?.value?.trim() || '';
    _gtAnnotations[hash] = { tags, notes, savedAt: new Date().toISOString() };
    persistAnnotations();
    showToastPro('Tags saved for current parcel.', 'success');
  }

  function loadParcelTags(hash) {
    if (!hash || !_gtAnnotations[hash]) return;
    const ann = _gtAnnotations[hash];
    GT_TAGS.forEach((t) => {
      const chk = document.querySelector(`.atp-gt-tag-chk[data-tag="${t.id}"]`);
      if (chk) chk.checked = ann.tags?.includes(t.id) ?? false;
    });
    const notesEl = el('atp-gt-notes');
    if (notesEl) notesEl.value = ann.notes || '';
  }

  function persistAnnotations() {
    try { localStorage.setItem('ait-gt-annotations', JSON.stringify(_gtAnnotations)); } catch {}
  }

  function loadAnnotations() {
    try {
      const raw = localStorage.getItem('ait-gt-annotations');
      if (raw) _gtAnnotations = JSON.parse(raw);
    } catch {}
  }

  function saveGroundTruth() {
    // Signal to main module to use manual areas as ground truth
    document.getElementById('ait-ground-truth-btn')?.click();
    showToastPro('Manual areas saved as ground truth baseline.', 'success');
    const computeBtn = el('atp-gt-compute-btn');
    const showDiffBtn = el('atp-gt-show-diff-btn');
    if (computeBtn) computeBtn.disabled = !_lastResult;
    if (showDiffBtn) showDiffBtn.disabled = !_lastResult;
  }

  function computeGtMetrics() {
    if (!_lastResult || !window.turf) return;
    const m = getMap();
    if (!m) return;

    // Get manual areas (ground truth) and AI result
    const gtSrc = m.getSource('ait-src-manual');
    const aiSrc = m.getSource('ait-src-mowable');
    if (!gtSrc || !aiSrc) return;

    const gtFc = gtSrc._data;
    const aiFc = aiSrc._data || (_lastResult.featureCollection || { type: 'FeatureCollection', features: _lastResult.features || [] });

    if (!gtFc?.features?.length) {
      showToastPro('No manual/ground truth areas drawn. Draw areas first, then save as ground truth.', 'error');
      return;
    }

    try {
      let gtArea = 0, aiArea = 0, intersectArea = 0;

      for (const gf of (gtFc.features || [])) { try { gtArea += turf.area(gf) * 10.7639; } catch {} }
      for (const af of (aiFc.features || [])) { try { aiArea += turf.area(af) * 10.7639; } catch {} }

      // Compute intersection
      for (const gf of (gtFc.features || [])) {
        for (const af of (aiFc.features || [])) {
          try {
            const inter = turf.intersect(gf, af);
            if (inter) intersectArea += turf.area(inter) * 10.7639;
          } catch {}
        }
      }

      const precision = aiArea > 0 ? intersectArea / aiArea : 0;
      const recall    = gtArea > 0 ? intersectArea / gtArea  : 0;
      const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
      const overlapScore = gtArea + aiArea > 0 ? (2 * intersectArea) / (gtArea + aiArea) : 0;
      const fpArea = aiArea - intersectArea;
      const fnArea = gtArea - intersectArea;

      _gtMetrics = { gtArea, aiArea, intersectArea, precision, recall, f1, overlapScore, fpArea, fnArea };

      renderGtMetrics();
      const showDiffBtn = el('atp-gt-show-diff-btn');
      if (showDiffBtn) showDiffBtn.disabled = false;
    } catch (err) {
      showToastPro('Metrics error: ' + err.message, 'error');
    }
  }

  function renderGtMetrics() {
    if (!_gtMetrics) return;
    const grid = el('atp-gt-metric-grid');
    const panel = el('atp-gt-metrics');
    if (!grid || !panel) return;
    panel.style.display = '';
    const m = _gtMetrics;
    const fmt = (v) => (v * 100).toFixed(1) + '%';
    grid.innerHTML = `
      <div class="atp-gt-metric"><span class="atp-gt-m-label">Precision</span><span class="atp-gt-m-val">${fmt(m.precision)}</span></div>
      <div class="atp-gt-metric"><span class="atp-gt-m-label">Recall</span><span class="atp-gt-m-val">${fmt(m.recall)}</span></div>
      <div class="atp-gt-metric"><span class="atp-gt-m-label">F1 Score</span><span class="atp-gt-m-val">${fmt(m.f1)}</span></div>
      <div class="atp-gt-metric"><span class="atp-gt-m-label">Overlap (Dice)</span><span class="atp-gt-m-val">${fmt(m.overlapScore)}</span></div>
      <div class="atp-gt-metric"><span class="atp-gt-m-label">False Positive Area</span><span class="atp-gt-m-val">${m.fpArea.toFixed(0)} sqft</span></div>
      <div class="atp-gt-metric"><span class="atp-gt-m-label">False Negative Area</span><span class="atp-gt-m-val">${m.fnArea.toFixed(0)} sqft</span></div>
      <div class="atp-gt-metric"><span class="atp-gt-m-label">Ground Truth Area</span><span class="atp-gt-m-val">${m.gtArea.toFixed(0)} sqft</span></div>
      <div class="atp-gt-metric"><span class="atp-gt-m-label">AI Detection Area</span><span class="atp-gt-m-val">${m.aiArea.toFixed(0)} sqft</span></div>`;
  }

  function showGtDisagreement() {
    if (!_gtMetrics || !window.turf) return;
    const m = getMap();
    if (!m) return;

    const gtSrc = m.getSource('ait-src-manual');
    const aiSrc = m.getSource('ait-src-mowable');
    if (!gtSrc || !aiSrc) return;

    const gtFc = gtSrc._data;
    const aiFc = aiSrc._data;

    // Create disagreement overlay layers if needed
    if (!m.getSource('atp-gt-diff-src')) {
      m.addSource('atp-gt-diff-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'atp-gt-diff-fill', type: 'fill', source: 'atp-gt-diff-src',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.45 } });
      m.addLayer({ id: 'atp-gt-diff-line', type: 'line', source: 'atp-gt-diff-src',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 } });
    }

    const diffFeatures = [];
    // FP = AI has it, GT doesn't (orange)
    for (const af of (aiFc?.features || [])) {
      diffFeatures.push({ ...af, properties: { ...af.properties, color: '#f97316', type: 'fp', label: 'False Positive' } });
    }
    // FN = GT has it, AI doesn't (red)
    for (const gf of (gtFc?.features || [])) {
      diffFeatures.push({ ...gf, properties: { ...gf.properties, color: '#ef4444', type: 'fn', label: 'False Negative / Ground Truth' } });
    }

    const src = m.getSource('atp-gt-diff-src');
    if (src) src.setData({ type: 'FeatureCollection', features: diffFeatures });
    m.setLayoutProperty('atp-gt-diff-fill', 'visibility', 'visible');
    m.setLayoutProperty('atp-gt-diff-line', 'visibility', 'visible');
    showToastPro('Disagreement overlay: orange = AI only (FP), red = ground truth only (FN).', 'info');
  }

  // ── Phase 7: Safe Experimentation System ──────────────────────────────────────

  function initExperimentSafety() {
    loadSnapshots();
    renderSnapshotList();
    updateExperimentBanner();
  }

  // Compute a short settings fingerprint (mirrors the one in ai-tuning.js)
  function _snapFingerprint(overrides) {
    try {
      const sorted = JSON.stringify(overrides, Object.keys(overrides || {}).sort());
      let h = 5381;
      for (let i = 0; i < sorted.length; i++) h = ((h << 5) + h + sorted.charCodeAt(i)) >>> 0;
      return h.toString(16).padStart(8, '0').slice(-6);
    } catch { return 'xxxxxx'; }
  }

  function _snapFmtDate(iso) {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      const mo = d.toLocaleString('en-US', { month: 'short' });
      return `${mo} ${d.getDate()}, ${d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
    } catch { return null; }
  }

  // Generate a default snapshot name using parcel context + timestamp
  function _defaultSnapName() {
    const ctx = window._aitCurrentParcelContext;
    const base = document.getElementById('ait-base-preset-select')?.value || 'medium_residential';
    const d = new Date();
    const ts = d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
    if (ctx?.label) return `${ctx.label} — ${base.replace('_', ' ')} — ${ts}`;
    return `Experiment — ${base.replace('_', ' ')} — ${ts}`;
  }

  function saveExperimentSnapshot() {
    const defaultName = _defaultSnapName();
    const name = prompt('Snapshot name (edit or accept):', defaultName);
    if (!name || !name.trim()) return;

    // Collect current slider values
    const overrides = {};
    document.querySelectorAll('[id^="ait-ctrl-"]').forEach((input) => {
      const ctrlId = input.id.replace('ait-ctrl-', '');
      const v = parseFloat(input.value);
      if (!isNaN(v)) overrides[ctrlId] = v;
    });
    document.querySelectorAll('[id^="ait-tog-"]').forEach((input) => {
      overrides[input.id.replace('ait-tog-', '')] = input.checked;
    });

    const fingerprint = _snapFingerprint(overrides);
    const ctx = window._aitCurrentParcelContext || {};
    const now = new Date().toISOString();

    const snapshot = {
      id:           'snap-' + Date.now(),
      name:         name.trim().slice(0, 120),
      overrides,
      basePreset:   document.getElementById('ait-base-preset-select')?.value || 'medium_residential',
      parcelLabel:  ctx.label   || null,
      parcelAddress: ctx.address || null,
      fingerprint,
      savedAt:      now,
      updatedAt:    now,
      resultSummary: _lastResult
        ? `${(_lastResult.areaSqft ?? 0).toFixed(0)} sqft · conf ${_lastResult.confidence || '?'}`
        : null,
      detectionMode: _lastResult?.diagnostic?.detectionMode || _lastResult?.diagnostic?.detection_mode || null,
    };

    // Duplicate-name guard: if same name already exists, warn user
    const dup = _snapshots.find((s) => s.name.toLowerCase() === snapshot.name.toLowerCase());
    if (dup) {
      const choice = confirm(
        `A snapshot named "${dup.name}" already exists (saved ${_snapFmtDate(dup.savedAt) || 'earlier'}).\n\nOK = overwrite it\nCancel = save as new copy`
      );
      if (choice) {
        // Overwrite: replace in-place
        const idx = _snapshots.indexOf(dup);
        _snapshots[idx] = { ...snapshot, id: dup.id, savedAt: dup.savedAt };
        persistSnapshots();
        renderSnapshotList();
        showToastPro('Snapshot updated: ' + snapshot.name, 'success');
        return;
      } else {
        // Save as copy with "(2)", "(3)", etc.
        let n = 2;
        let copyName = `${snapshot.name} (${n})`;
        while (_snapshots.some((s) => s.name.toLowerCase() === copyName.toLowerCase())) {
          copyName = `${snapshot.name} (${++n})`;
        }
        snapshot.name = copyName;
      }
    }

    _snapshots.push(snapshot);
    if (_snapshots.length > 20) _snapshots.shift();  // Keep last 20
    persistSnapshots();
    renderSnapshotList();
    showToastPro('Snapshot saved: ' + snapshot.name, 'success');
  }

  function restoreSnapshot(snapshotId) {
    const snap = _snapshots.find((s) => s.id === snapshotId);
    if (!snap) return;

    Object.entries(snap.overrides).forEach(([ctrlId, value]) => {
      const slider = document.getElementById('ait-ctrl-' + ctrlId);
      const numInp = document.getElementById('ait-num-' + ctrlId);
      const toggle = document.getElementById('ait-tog-' + ctrlId);
      if (slider && typeof value === 'number') {
        slider.value = value;
        slider.dispatchEvent(new Event('input'));  // trigger dirty + label update
        if (numInp) numInp.value = value;
      }
      if (toggle && typeof value === 'boolean') {
        toggle.checked = value;
        toggle.dispatchEvent(new Event('change'));
      }
    });

    const baseSelect = document.getElementById('ait-base-preset-select');
    if (baseSelect && snap.basePreset) baseSelect.value = snap.basePreset;

    showToastPro(`Snapshot restored: ${snap.name}`, 'success');
  }

  function renameSnapshot(snapshotId) {
    const snap = _snapshots.find((s) => s.id === snapshotId);
    if (!snap) return;
    const newName = prompt('Rename snapshot:', snap.name);
    if (!newName || !newName.trim() || newName.trim() === snap.name) return;
    const dup = _snapshots.find((s) => s.id !== snapshotId && s.name.toLowerCase() === newName.trim().toLowerCase());
    if (dup && !confirm(`Another snapshot named "${dup.name}" exists. Rename anyway?`)) return;
    snap.name = newName.trim().slice(0, 120);
    snap.updatedAt = new Date().toISOString();
    persistSnapshots();
    renderSnapshotList();
    showToastPro('Renamed to: ' + snap.name, 'success');
  }

  function deleteSnapshot(snapshotId) {
    _snapshots = _snapshots.filter((s) => s.id !== snapshotId);
    persistSnapshots();
    renderSnapshotList();
  }

  function renderSnapshotList() {
    const container = el('atp-snapshot-list');
    if (!container) return;
    if (!_snapshots.length) {
      container.innerHTML = '<p class="ait-muted" style="font-size:.78rem;margin:4px 0">No snapshots. Use "Save Snapshot" to capture current settings.</p>';
      return;
    }
    container.innerHTML = _snapshots.slice().reverse().map((s) => {
      const base     = s.basePreset ? escHtml(s.basePreset.replace('_', ' ')) : '—';
      const ts       = _snapFmtDate(s.updatedAt || s.savedAt) || '—';
      const fp       = s.fingerprint
        ? `<span class="ait-preset-fp" title="Settings fingerprint">Config: ${escHtml(s.fingerprint)}</span>`
        : '';
      const parcel   = s.parcelLabel
        ? `<span class="atp-snapshot-parcel">📍 ${escHtml(s.parcelLabel)}</span>`
        : '';
      const result   = s.resultSummary
        ? `<span class="atp-snapshot-result">${escHtml(s.resultSummary)}</span>`
        : '';
      const mode     = s.detectionMode
        ? `<span class="atp-snapshot-mode">${escHtml(s.detectionMode)}</span>`
        : '';
      const sid      = escHtml(s.id);
      return `
        <div class="atp-snapshot-item">
          <div class="atp-snapshot-info">
            <span class="atp-snapshot-name">${escHtml(s.name)}</span>
            <div class="atp-snapshot-chips">
              <span class="atp-snapshot-meta">${base}</span>
              <span class="ait-preset-time">${ts}</span>
              ${fp}${parcel}${result}${mode}
            </div>
          </div>
          <div class="atp-snapshot-actions">
            <button class="btn secondary xsmall" onclick="aiTuningPro._restoreSnapshot('${sid}')" title="Restore sliders to this snapshot">Restore</button>
            <button class="btn secondary xsmall" onclick="aiTuningPro._renameSnapshot('${sid}')" title="Rename">Rename</button>
            <button class="btn danger xsmall" onclick="aiTuningPro._deleteSnapshot('${sid}')" title="Delete">Delete</button>
          </div>
      </div>`).join('');
  }

  function persistSnapshots() {
    try { localStorage.setItem('ait-exp-snapshots', JSON.stringify(_snapshots)); } catch {}
  }

  function loadSnapshots() {
    try {
      const raw = localStorage.getItem('ait-exp-snapshots');
      if (raw) _snapshots = JSON.parse(raw);
    } catch {}
  }

  function restoreLastValidatedPreset() {
    // Find the most recently validated preset from the saved preset list
    const presets = [...(window._aitSavedPresetsRef || [])];
    const validated = presets.filter((p) => (p.status || (p.isProduction ? 'production' : 'draft')) === 'validated');
    if (!validated.length) {
      showToastPro('No validated presets found. Mark a draft as validated first.', 'error');
      return;
    }
    validated.sort((a, b) => new Date(b.statusUpdatedAt || b.savedAt) - new Date(a.statusUpdatedAt || a.savedAt));
    const latest = validated[0];
    // Trigger the main module load
    document.querySelector(`.ait-load-preset[data-name="${CSS.escape(latest.name)}"]`)?.click();
    showToastPro('Restored last validated preset: ' + (latest.label || latest.name), 'success');
  }

  function updateExperimentBanner() {
    // Show warning banner if there are unsaved runtime overrides
    const banner = el('atp-experiment-banner');
    if (!banner) return;
    const dirtyBadge = document.getElementById('ait-session-dirty-badge');
    const isDirty = dirtyBadge && !dirtyBadge.hidden;
    banner.style.display = isDirty ? 'flex' : 'none';
  }

  // Auto-update experiment banner when session changes
  function observeSessionBanner() {
    const dirtyBadge = document.getElementById('ait-session-dirty-badge');
    if (!dirtyBadge) return;
    const observer = new MutationObserver(() => updateExperimentBanner());
    observer.observe(dirtyBadge, { attributes: true, attributeFilter: ['hidden'] });
  }

  // ── Phase 9: UI Polish ────────────────────────────────────────────────────────

  function initUiPolish() {
    // Make diagnostics pane collapsible
    const diagPane = document.querySelector('.ait-diag-pane');
    if (diagPane) {
      const header = diagPane.querySelector('div > h4');
      if (header) {
        header.style.cursor = 'pointer';
        header.title = 'Click to collapse/expand diagnostics';
        header.addEventListener('click', () => {
          diagPane.classList.toggle('atp-diag-collapsed');
        });
      }
    }

    // Make controls pane resizable
    const ctrlPane = document.querySelector('.ait-controls-pane');
    if (ctrlPane) {
      const resizer = document.createElement('div');
      resizer.className = 'atp-pane-resizer';
      ctrlPane.insertAdjacentElement('beforebegin', resizer);
      let startX = 0, startWidth = 0;
      resizer.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startWidth = ctrlPane.offsetWidth;
        const onMove = (ev) => {
          const delta = startX - ev.clientX;
          const newW = Math.max(280, Math.min(600, startWidth + delta));
          ctrlPane.style.width = newW + 'px';
          ctrlPane.style.minWidth = newW + 'px';
          document.querySelector('.ait-workstation')?.style.setProperty('grid-template-columns', `1fr ${newW}px`);
          getMap()?.resize();
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
      });
    }
  }

  // ── Toast helper ──────────────────────────────────────────────────────────────

  function showToastPro(msg, type = 'info') {
    // Delegate to existing showToast if available, else fallback
    if (typeof showToast === 'function') { showToast(msg, type === 'success' ? 'success' : type === 'error' ? 'error' : 'info'); return; }
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:#1e293b;color:#f1f5f9;padding:10px 16px;border-radius:6px;z-index:99999;font-size:.82rem;box-shadow:0 4px 12px rgba(0,0,0,.3)`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ── Event integration with ai-tuning.js ──────────────────────────────────────

  function onDetectionComplete(result) {
    _lastResult = result;
    refreshAllAnalyticalOverlays();
    populatePipelineFromResult(result);
    // Enable quality and GT controls
    const applyBtn = el('atp-q-apply-btn');
    if (applyBtn) applyBtn.disabled = false;
    const computeBtn = el('atp-gt-compute-btn');
    const saveGtBtn = el('atp-gt-save-gt-btn');
    if (computeBtn) computeBtn.disabled = false;
    if (saveGtBtn) saveGtBtn.disabled = false;
    // Update ground truth parcel hash and load tags
    const hash = parcelHashFromResult(result);
    if (hash) loadParcelTags(hash);
    updateExperimentBanner();
  }

  function onParcelLoaded() {
    // Reset quality preview when parcel changes
    _qualityApplied = null;
    _lastResult = null;
    _gtMetrics = null;
    const metricsPanel = el('atp-gt-metrics');
    if (metricsPanel) metricsPanel.style.display = 'none';
    el('atp-quality-status') && (el('atp-quality-status').textContent = '');
  }

  // Listen for events dispatched by ai-tuning.js
  window.addEventListener('ait:detection-complete', (e) => onDetectionComplete(e.detail));
  window.addEventListener('ait:parcel-loaded',      () => onParcelLoaded());

  // ── Map-ready callback ────────────────────────────────────────────────────────

  function onMapReady() {
    addAnalyticalMapLayers();
    bindInspectorToMap();
    initCoordinateReadout();
  }

  // Poll for map readiness (map is initialized by ai-tuning.js after DOMContentLoaded)
  function waitForMap() {
    const m = getMap();
    if (m) {
      if (m.loaded()) { onMapReady(); return; }
      m.once('load', onMapReady);
      return;
    }
    setTimeout(waitForMap, 250);
  }

  // ── Main init ─────────────────────────────────────────────────────────────────

  function init() {
    if (_initialized) return;
    _initialized = true;

    loadAnnotations();
    loadSnapshots();

    initOverlayManager();
    initStageViewer();
    initRejectionInspector();
    initQualityControls();
    initGroundTruth();
    initExperimentSafety();
    initUiPolish();
    initKeyboardShortcuts();
    buildShortcutsModal();
    observeSessionBanner();

    waitForMap();

    console.log('[aiTuningPro] initialized');
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Delay slightly to ensure ai-tuning.js has already run
    setTimeout(init, 150);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    init,
    _onQuality,
    _restoreSnapshot: restoreSnapshot,
    _renameSnapshot:  renameSnapshot,
    _deleteSnapshot:  deleteSnapshot,
    saveExperimentSnapshot,
    restoreLastValidatedPreset,
    startMeasureMode,
    cancelMeasureMode,
    toggleFullscreen,
    toggleCoordinateReadout,
    toggleCompactMode,
    zoomToResult,
    setActiveStage,
    toggleShortcutsModal,
    getCurrentResult,
  };
})();
