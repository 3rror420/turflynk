// Shared app-wide constants — extracted from app.js (Phase 1 modular refactor)
// Must load before app.js. All values are read-only constants.

const QUOTE_DRAFT_KEY = 'turflynk.quoteDraft.v5';
const GOOGLE_LOGIN_ENABLED = false;

function trackMetaEvent(eventName, params = {}) {
  try {
    if (!eventName || !window.fbq) return;
    window.fbq('track', eventName, params || {});
  } catch (error) {
    console.warn('[Meta Pixel] event tracking failed', error);
  }
}

window.trackMetaEvent = trackMetaEvent;

const EPSG4326 = 'EPSG:4326';
const EPSG26915 = '+proj=utm +zone=15 +datum=NAD83 +units=m +no_defs';
const PARCEL_FIT_OPTIONS = { padding: [40, 40], maxZoom: 18 };
const DEFAULT_MAP_CENTER = [36.1867, -94.1288];
const DEFAULT_MAP_ZOOM = 11;
const ARKANSAS_ONLY_MESSAGE = 'MowNWA currently supports Arkansas properties only.';
const ARKANSAS_MAP_BUFFERED_BOUNDS = {
  west: -95.75,
  south: 32.25,
  east: -88.75,
  north: 37.25,
};
const ARKANSAS_BOUNDS = {
  west: -94.65,
  south: 33.00,
  east: -89.60,
  north: 36.55,
};
const ARKANSAS_VALIDATION_BOUNDS = ARKANSAS_BOUNDS;
let lastArkansasOnlyToastAt = 0;

function isLngLatInBounds(lng, lat, bounds = ARKANSAS_VALIDATION_BOUNDS) {
  const pointLng = Number(lng?.lng ?? lng?.lon ?? lng?.longitude ?? (Array.isArray(lng) ? lng[0] : lng));
  const pointLat = Number(lng?.lat ?? lng?.latitude ?? (Array.isArray(lng) ? lng[1] : lat));
  return Number.isFinite(pointLng)
    && Number.isFinite(pointLat)
    && pointLng >= bounds.west
    && pointLng <= bounds.east
    && pointLat >= bounds.south
    && pointLat <= bounds.north;
}

function isArkansasStateValue(value) {
  const stateValue = String(value || '').trim().toLowerCase();
  return !stateValue || stateValue === 'ar' || stateValue === 'arkansas';
}

function isLngLatInArkansas(lng, lat, stateValue = '') {
  const pointState = lng?.state_code ?? lng?.stateCode ?? lng?.state ?? lng?.administrativeArea ?? stateValue;
  if (!isArkansasStateValue(pointState)) return false;
  return isLngLatInBounds(lng, lat, ARKANSAS_VALIDATION_BOUNDS);
}

function showArkansasOnlyWarning(options = {}) {
  const now = Date.now();
  const throttleMs = Number(options.throttleMs || 2500);
  if (!options.force && now - lastArkansasOnlyToastAt < throttleMs) return;
  lastArkansasOnlyToastAt = now;
  if (typeof showWarning === 'function') showWarning(ARKANSAS_ONLY_MESSAGE);
}
const MOWABLE_ESTIMATE_FIELDS = [
  'parcelAreaSqft',
  'buildingFootprintSqft',
  'buildingAdjustedSqft',
  'estimatedNonMowableSqft',
  'autoEstimatedMowableSqft',
  'mowableEstimateConfidence',
  'buildingFootprintsSource',
  'customerAdjustedMowableSqft',
];
const SERVICE_CATALOG = [
  {
    id: 'mowing',
    group: 'Lawn Care',
    title: 'Instant Lawn Mowing',
    badge: 'Instant price',
    quoteType: 'instant_mow',
    description: 'Standard mowing, basic trimming around normal edges, and blowing clippings from hard surfaces.',
  },
  {
    id: 'recurring_lawn_care',
    group: 'Lawn Care',
    title: 'Recurring Lawn Care',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Weekly or biweekly care plans reviewed after your property details are submitted.',
  },
  {
    id: 'long_grass_service',
    group: 'Lawn Care',
    title: 'Long Grass Service',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Tall grass, first cuts, and heavy trim-down work reviewed before final pricing.',
  },
  {
    id: 'yard_cleanup',
    group: 'Yard Cleanup',
    title: 'Yard Cleanup',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Cleanup, bagging, debris, and property refresh work reviewed from notes and photos.',
  },
  {
    id: 'leaf_removal',
    group: 'Yard Cleanup',
    title: 'Leaf Removal',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Seasonal leaf clearing, pile removal, and curb or bag pickup requests.',
  },
  {
    id: 'storm_debris_cleanup',
    group: 'Yard Cleanup',
    title: 'Storm Debris Cleanup',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Branches, limbs, and storm debris reviewed by volume, access, and haul-away needs.',
  },
  {
    id: 'brush_removal',
    group: 'Yard Cleanup',
    title: 'Brush Removal',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Brush, vines, limbs, and rough outdoor cleanup priced after review.',
  },
  {
    id: 'overgrown_yard_cleanup',
    group: 'Yard Cleanup',
    title: 'Overgrown Yard Cleanup',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Heavy overgrowth, cleanup, and first-pass recovery work quoted separately.',
  },
  {
    id: 'haul_away',
    group: 'Yard Cleanup',
    title: 'Haul-away',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Debris, bags, branches, and outdoor material removal priced by load and access.',
  },
  {
    id: 'bush_hedge_trimming',
    group: 'Bushes & Landscaping',
    title: 'Bush / Hedge Trimming',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Shaping, reduction, cleanup, and haul-away reviewed before final pricing.',
  },
  {
    id: 'mulch_flower_beds',
    group: 'Bushes & Landscaping',
    title: 'Mulch / Flower Beds',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Mulch refreshes, bed cleanup, weed removal, and edging requests.',
  },
  {
    id: 'weed_pulling',
    group: 'Bushes & Landscaping',
    title: 'Weed Pulling',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Hand weeding, bed cleanup, and detail work quoted by scope and condition.',
  },
  {
    id: 'small_landscaping_projects',
    group: 'Bushes & Landscaping',
    title: 'Small Landscaping Projects',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Small installs, bed reshaping, plant refreshes, and outdoor improvement work.',
  },
  {
    id: 'pressure_washing',
    group: 'Exterior Home',
    title: 'Pressure Washing',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Driveways, patios, walks, siding, and outdoor surfaces reviewed by scope.',
  },
  {
    id: 'gutter_cleaning',
    group: 'Exterior Home',
    title: 'Gutter Cleaning',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Gutter cleaning requests reviewed for height, access, and debris level.',
  },
  {
    id: 'fence_line_cleanup',
    group: 'Exterior Home',
    title: 'Fence Line Cleanup',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Trim, clear, and clean up fence edges, vines, and growth along property lines.',
  },
  {
    id: 'outdoor_junk_debris_removal',
    group: 'Exterior Home',
    title: 'Outdoor Junk / Debris Removal',
    badge: 'Live bid',
    quoteType: 'live_bid',
    description: 'Outdoor junk, debris piles, and one-off removal jobs quoted from photos.',
  },
];
const EXTRA_SERVICE_OPTIONS = [
  ['yard_cleanup', 'Yard cleanup'],
  ['leaf_removal', 'Leaf removal'],
  ['bush_hedge_trimming', 'Bush / hedge trimming'],
  ['brush_removal', 'Brush removal'],
  ['debris_hauling', 'Debris / hauling'],
  ['mulch_flower_beds', 'Mulch / flower beds'],
  ['pressure_washing', 'Pressure washing'],
  ['gutter_cleaning', 'Gutter cleaning'],
  ['other', 'Other'],
];
const SERVICE_AREA_OPTIONS = [
  'Fayetteville',
  'Springdale',
  'Rogers',
  'Bentonville',
  'Bella Vista',
  'Lowell',
  'Johnson',
  'Farmington',
  'Prairie Grove',
  'Centerton',
  'Cave Springs',
  'Pea Ridge',
  'Tontitown',
  'Elkins',
  'Greenland',
  'Siloam Springs',
  'Fayetteville + surrounding area',
  'Springdale + surrounding area',
  'Rogers + surrounding area',
  'Bentonville + surrounding area',
  'All Northwest Arkansas',
  'Other',
];
const AVAILABLE_DAY_OPTIONS = [
  ['monday', 'Monday'],
  ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'],
  ['friday', 'Friday'],
  ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
];
const AI_PHOTO_PLACEHOLDER = {
  photo_type: 'customer_scope',
  ai_analysis_json: null,
  detected_services: [],
  difficulty: 'unknown',
  access_concerns: [],
  equipment_recommendation: '',
  instant_quote_safe: false,
  rough_price_low: null,
  rough_price_high: null,
  customer_questions: [],
  live_bid_recommended: true,
  provider_notes: '',
  customer_summary: 'Based on your photos, this may require a live bid. The range shown is only a rough expectation. A provider will confirm final pricing.',
};
const INCLUDED_MOW_TASKS = [
  'Mow selected lawn area',
  'Basic trimming around normal edges',
  'Blow clippings from hard surfaces',
];
const EXCLUDED_MOW_TASKS = [
  'Yard cleanup',
  'Leaf cleanup',
  'Hauling',
  'Bush/hedge trimming',
  'Landscaping',
  'Pet waste cleanup',
  'Unsafe/blocked areas',
  'Extreme overgrowth remediation',
  'Any extra service not listed in the instant mow scope',
];
