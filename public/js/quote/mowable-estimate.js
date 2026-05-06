// Auto-mowable estimate + building footprint helpers
// Extracted from app.js — Phase 13h
// Dependencies (global): turf, state, asFeature, layerAreaSqFt,
//   MOWABLE_ESTIMATE_FIELDS, formatAcres, escapeHtml,
//   updateBuildingFootprintSource, reorderMapOverlays,
//   getMowableFeatureCount, cloneParcelAsMowable,
//   startEditMowable, startDrawMowable,
//   updateMowAreaHelper, saveQuoteDraft, scheduleEstimateRefresh,
//   updateQuoteFlowState, showWarning, byId

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
