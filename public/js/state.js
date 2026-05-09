// Shared mutable app state — extracted from app.js (Phase 1 modular refactor)
// Must load after config.js and before app.js.

const state = {
  config: null,
  regions: [],
  services: [],
  map: null,
  marker: null,
  gpsMarker: null,
  parcelLayer: null,
  parcelFeature: null,
  parcelProperties: null,
  selectedParcel: null,
  selectedParcelProperties: null,
  selectedServiceLocation: null,
  parcelGeometry: null,
  drawGroup: null,
  mowableFeatureCollection: { type: 'FeatureCollection', features: [] },
  drawHandler: null,
  editHandler: null,
  deleteHandler: null,
  activeView: 'quote',
  mowUndoStack: [],
  editSnapshot: null,
  aiCutoutGroup: null,
  aiCutoutFeatureCollection: { type: 'FeatureCollection', features: [] },
  buildingFootprintGroup: null,
  buildingFootprintFeatureCollection: { type: 'FeatureCollection', features: [] },
  mowableEstimate: null,
  lastQuote: null,       // set after successful quote submission
  pendingQuote: null,    // set after guest estimate, before acceptance
  currentUser: null,     // set after login / session check
  moveDrag: null,
  mapMode: 'idle',
  quoteUiMode: 'idle',
  serviceFlow: 'instant_mow',
  currentServiceAddress: null,
  pendingExtraBid: null,
  parcelSelectMode: false,
  pendingParcelFeature: null,
  pendingParcelPreviewLayer: null,
  pendingParcelPreviewFeature: null,
  parcelDblClick: false,
  quoteFlowStep: 'property',
  pendingCheckoutUrl: null,
  providerAreaSection: 'dashboard',
};

const QUOTE_STEP_ORDER = ['property', 'draw', 'estimate', 'request'];
