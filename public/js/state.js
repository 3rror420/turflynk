// Shared mutable app state — extracted from app.js (Phase 1 modular refactor)
// Must load after config.js and before app.js.

const state = {
  config: null,
  regions: [],
  services: [],
  map: null,
  marker: null,
  parcelLayer: null,
  parcelGeometry: null,
  drawGroup: null,
  drawHandler: null,
  editHandler: null,
  deleteHandler: null,
  activeView: 'quote',
  mowUndoStack: [],
  aiCutoutGroup: null,
  buildingFootprintGroup: null,
  mowableEstimate: null,
  lastQuote: null,       // set after successful quote submission
  pendingQuote: null,    // set after guest estimate, before acceptance
  currentUser: null,     // set after login / session check
  moveDrag: null,
  quoteUiMode: 'idle',
  serviceFlow: 'instant_mow',
  pendingExtraBid: null,
  parcelSelectMode: false,
  pendingParcelFeature: null,
  pendingParcelPreviewLayer: null,
  parcelDblClick: false,
  quoteFlowStep: 'start',
};

const QUOTE_STEP_ORDER = ['start', 'parcel', 'draw', 'estimate', 'request'];
