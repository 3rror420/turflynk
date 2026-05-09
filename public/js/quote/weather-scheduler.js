(function () {
  "use strict";

  const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const FORECAST_TILE_COUNT = 7;
  const FORECAST_START_OFFSET_DAYS = 1;
  const WEATHER_ICON_BASE = "/weather-icons/";
  const SAME_DAY_RUSH_MOWING = {
    enabled: false,
    label: "Rush / Same-Day Attempt",
    priceHook: null,
    providerDependent: true,
    guaranteed: false
  };
  const REFRESH_RETRY_LIMIT = 12;
  const REFRESH_RETRY_DELAY_MS = 180;
  const MAP_CONTEXT_MATCH_DEGREES = 0.08;
  const PRECIPITATION_CONDITION_RE = /\b(rain|storms?|thunder\w*|showers?|drizzle|snow|sleet|hail|ice)\b/i;
  let refreshRequestSeq = 0;
  let weatherObserver = null;
  let renderedForecastSignature = "";
  // TODO: Same-day rush mowing can become a separate opt-in flow later; today's
  // forecast is intentionally excluded from selectable preferred days for now.
  const WEATHER_ICON_FILES = new Set([
    "clear-day.svg",
    "clear-night.svg",
    "cloudy-1-day.svg",
    "cloudy-1-night.svg",
    "cloudy-2-day.svg",
    "cloudy-2-night.svg",
    "cloudy-3-day.svg",
    "cloudy-3-night.svg",
    "cloudy.svg",
    "dust.svg",
    "fog-day.svg",
    "fog-night.svg",
    "fog.svg",
    "frost-day.svg",
    "frost-night.svg",
    "frost.svg",
    "hail.svg",
    "haze-day.svg",
    "haze-night.svg",
    "haze.svg",
    "hurricane.svg",
    "isolated-thunderstorms-day.svg",
    "isolated-thunderstorms-night.svg",
    "isolated-thunderstorms.svg",
    "rain-and-sleet-mix.svg",
    "rain-and-snow-mix.svg",
    "rainy-1-day.svg",
    "rainy-1-night.svg",
    "rainy-1.svg",
    "rainy-2-day.svg",
    "rainy-2-night.svg",
    "rainy-2.svg",
    "rainy-3-day.svg",
    "rainy-3-night.svg",
    "rainy-3.svg",
    "scattered-thunderstorms-day.svg",
    "scattered-thunderstorms-night.svg",
    "scattered-thunderstorms.svg",
    "severe-thunderstorm.svg",
    "snow-and-sleet-mix.svg",
    "snowy-1-day.svg",
    "snowy-1-night.svg",
    "snowy-1.svg",
    "snowy-2-day.svg",
    "snowy-2-night.svg",
    "snowy-2.svg",
    "snowy-3-day.svg",
    "snowy-3-night.svg",
    "snowy-3.svg",
    "thunderstorms.svg",
    "tornado.svg",
    "tropical-storm.svg",
    "wind.svg"
  ]);

  const WEATHER_CODE_ICON_CANDIDATES = {
    0: ["clear-day.svg"],
    1: ["cloudy-1-day.svg", "cloudy-2-day.svg", "cloudy.svg"],
    2: ["cloudy-2-day.svg", "cloudy-1-day.svg", "cloudy.svg"],
    3: ["cloudy.svg", "cloudy-3-day.svg"],
    45: ["fog-day.svg", "fog.svg"],
    48: ["fog-day.svg", "frost-day.svg", "fog.svg"],
    51: ["rainy-1-day.svg", "rainy-1.svg"],
    53: ["rainy-1-day.svg", "rainy-1.svg"],
    55: ["rainy-2-day.svg", "rainy-2.svg"],
    56: ["rain-and-sleet-mix.svg", "rainy-1-day.svg"],
    57: ["rain-and-sleet-mix.svg", "rainy-2-day.svg"],
    61: ["rainy-1-day.svg", "rainy-1.svg"],
    63: ["rainy-2-day.svg", "rainy-2.svg"],
    65: ["rainy-3-day.svg", "rainy-3.svg"],
    66: ["rain-and-sleet-mix.svg", "rainy-2-day.svg"],
    67: ["rain-and-sleet-mix.svg", "rainy-3-day.svg"],
    71: ["snowy-1-day.svg", "snowy-1.svg"],
    73: ["snowy-2-day.svg", "snowy-2.svg"],
    75: ["snowy-3-day.svg", "snowy-3.svg"],
    77: ["snowy-2-day.svg", "snowy-2.svg"],
    80: ["rainy-1-day.svg", "rainy-1.svg"],
    81: ["rainy-2-day.svg", "rainy-2.svg"],
    82: ["rainy-3-day.svg", "rainy-3.svg"],
    85: ["snowy-1-day.svg", "snowy-1.svg"],
    86: ["snowy-2-day.svg", "snowy-2.svg"],
    95: ["scattered-thunderstorms-day.svg", "thunderstorms.svg"],
    96: ["isolated-thunderstorms-day.svg", "thunderstorms.svg"],
    99: ["severe-thunderstorm.svg", "thunderstorms.svg"]
  };

  const LEGACY_ICON_CANDIDATES = {
    "clear-day.svg": ["clear-day.svg"],
    "clear-night.svg": ["clear-day.svg", "clear-night.svg"],
    "partly-cloudy-day.svg": ["cloudy-1-day.svg", "cloudy-2-day.svg", "cloudy.svg"],
    "partly-cloudy-day-rain.svg": ["rainy-2-day.svg", "rainy-2.svg"],
    "overcast.svg": ["cloudy.svg", "cloudy-3-day.svg"],
    "drizzle.svg": ["rainy-1-day.svg", "rainy-1.svg"],
    "rain.svg": ["rainy-2-day.svg", "rainy-2.svg"],
    "snow.svg": ["snowy-2-day.svg", "snowy-2.svg"],
    "thunderstorms-day-rain.svg": ["scattered-thunderstorms-day.svg", "thunderstorms.svg"]
  };

  function firstAvailableIcon(candidates) {
    return (candidates || []).find(name => WEATHER_ICON_FILES.has(name)) || "cloudy.svg";
  }

  function iconFileFromUrl(icon) {
    const value = String(icon || "").split("?")[0].split("#")[0];
    return value.slice(value.lastIndexOf("/") + 1);
  }

  function preferForecastDayIcon(iconFile) {
    if (!iconFile.endsWith("-night.svg")) return iconFile;
    const dayIcon = iconFile.replace("-night.svg", "-day.svg");
    return WEATHER_ICON_FILES.has(dayIcon) ? dayIcon : iconFile;
  }

  function weatherCodeFromDay(day) {
    const value = day && (day.code ?? day.weatherCode ?? day.weather_code);
    const code = Number(value);
    return Number.isFinite(code) ? code : null;
  }

  function resolveWeatherIcon(day) {
    const code = weatherCodeFromDay(day);
    if (code !== null && WEATHER_CODE_ICON_CANDIDATES[code]) {
      return `${WEATHER_ICON_BASE}${firstAvailableIcon(WEATHER_CODE_ICON_CANDIDATES[code])}`;
    }

    const iconFile = iconFileFromUrl(day && day.icon);
    if (WEATHER_ICON_FILES.has(iconFile)) return `${WEATHER_ICON_BASE}${preferForecastDayIcon(iconFile)}`;
    if (LEGACY_ICON_CANDIDATES[iconFile]) {
      return `${WEATHER_ICON_BASE}${firstAvailableIcon(LEGACY_ICON_CANDIDATES[iconFile])}`;
    }

    const summary = String(day && (day.summary || day.condition || day.weather) || "").toLowerCase();
    if (/tornado/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["tornado.svg", "severe-thunderstorm.svg"])}`;
    if (/hurricane/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["hurricane.svg", "tropical-storm.svg"])}`;
    if (/storm|thunder|lightning/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["scattered-thunderstorms-day.svg", "thunderstorms.svg"])}`;
    if (/sleet|freez|ice/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["rain-and-sleet-mix.svg", "frost-day.svg"])}`;
    if (/snow|flurr/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["snowy-2-day.svg", "snowy-2.svg"])}`;
    if (/rain|shower|drizzle|pour/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["rainy-2-day.svg", "rainy-2.svg"])}`;
    if (/fog|mist/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["fog-day.svg", "fog.svg"])}`;
    if (/haze|smoke|dust/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["haze-day.svg", "haze.svg", "dust.svg"])}`;
    if (/wind/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["wind.svg", "cloudy.svg"])}`;
    if (/part|cloud/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["cloudy-1-day.svg", "cloudy-2-day.svg", "cloudy.svg"])}`;
    if (/clear|sun/.test(summary)) return `${WEATHER_ICON_BASE}${firstAvailableIcon(["clear-day.svg"])}`;

    return `${WEATHER_ICON_BASE}${firstAvailableIcon(["cloudy.svg"])}`;
  }

  function escapeAttr(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtDay(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }

  function fmtDate(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  }

  function localDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function dateKeyWithOffset(offsetDays) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return localDateKey(d);
  }

  function selectableForecastDays(days) {
    const firstSelectableDate = dateKeyWithOffset(FORECAST_START_OFFSET_DAYS);
    return (Array.isArray(days) ? days : [])
      .filter(day => day && day.date >= firstSelectableDate)
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
      .slice(0, FORECAST_TILE_COUNT);
  }

  function normalizeOpenMeteoDays(data) {
    const dates = data?.daily?.time ?? [];
    const highs = data?.daily?.temperature_2m_max ?? [];
    const lows = data?.daily?.temperature_2m_min ?? [];
    const rainChances = data?.daily?.precipitation_probability_max ?? [];
    const weatherCodes = data?.daily?.weather_code ?? [];

    return dates.map((date, index) => {
      const rainChance = rainChances[index] ?? 0;
      const code = weatherCodes[index];
      return {
        date,
        highF: highs[index],
        lowF: lows[index],
        rainChance,
        code,
        summary: weatherSummaryFromCode(code),
        mowRisk: rainChance >= 70 ? "high" : rainChance >= 40 ? "medium" : "low"
      };
    });
  }

  function weatherSummaryFromCode(code) {
    if (code === 0) return "Clear";
    if (code === 1 || code === 2) return "Partly cloudy";
    if (code === 3) return "Cloudy";
    if (code >= 45 && code <= 48) return "Fog";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "Rain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
    if (code >= 95 && code <= 99) return "Storms";
    return "Cloudy";
  }

  async function fetchExtendedForecast(pos) {
    const params = new URLSearchParams({
      latitude: pos.lat,
      longitude: pos.lon,
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
      forecast_days: String(FORECAST_TILE_COUNT + FORECAST_START_OFFSET_DAYS),
      temperature_unit: "fahrenheit",
      windspeed_unit: "mph",
      precipitation_unit: "inch",
      timezone: "auto"
    });

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok) return [];
    return normalizeOpenMeteoDays(await res.json());
  }


  function getForecastProbability(day) {
    const raw = day && (
      day.precipitationProbability ??
      day.precipitation_probability ??
      day.precipProbability ??
      day.precipChance ??
      day.rainChance
    );
    const probability = Number(raw);
    return Number.isFinite(probability) ? Math.round(probability) : null;
  }

  function conciseConditionLabel(day) {
    const text = String(day && (day.summary || day.condition || day.weather) || "").toLowerCase();
    const code = weatherCodeFromDay(day);

    if (/storm|thunder|lightning/.test(text) || (code !== null && code >= 95 && code <= 99)) return "Storms";
    if (/shower/.test(text) || (code !== null && code >= 80 && code <= 82)) return "Showers";
    if (/drizzle/.test(text) || (code !== null && code >= 51 && code <= 57)) return "Drizzle";
    if (/rain|pour/.test(text) || (code !== null && code >= 61 && code <= 67)) return "Rain";
    if (/snow|flurr/.test(text) || (code !== null && ((code >= 71 && code <= 77) || code === 85 || code === 86))) return "Snow";
    if (/sleet|freez|ice/.test(text)) return "Wintry";
    if (/fog|mist/.test(text) || (code !== null && code >= 45 && code <= 48)) return "Fog";
    if (/haze|smoke|dust/.test(text)) return "Haze";
    if (/wind/.test(text)) return "Wind";
    if (/part/.test(text) || code === 1 || code === 2) return "Partly Cloudy";
    if (/cloud|overcast/.test(text) || code === 3) return "Cloudy";
    if (/clear|sun/.test(text) || code === 0) return "Clear";
    return text ? text.replace(/\b\w/g, char => char.toUpperCase()) : "";
  }

  function isPrecipitationCondition(day, condition) {
    const sourceText = String(day && (day.summary || day.condition || day.weather) || "");
    return PRECIPITATION_CONDITION_RE.test(`${condition || ""} ${sourceText}`);
  }

  function getConditionText(day) {
    const condition = conciseConditionLabel(day);
    const probability = getForecastProbability(day);
    if (probability !== null && condition && isPrecipitationCondition(day, condition)) {
      return `${probability}% ${condition}`;
    }
    return condition;
  }

  function getAppState() {
    try {
      if (typeof state !== "undefined" && state) return state;
    } catch {}
    return window.state || null;
  }

  function firstFiniteNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function validLatLon(lat, lon) {
    if (lat === null || lat === undefined || lat === "" || lon === null || lon === undefined || lon === "") return null;
    const normalizedLat = Number(lat);
    const normalizedLon = Number(lon);
    if (!Number.isFinite(normalizedLat) || !Number.isFinite(normalizedLon)) return null;
    if (normalizedLat === 0 && normalizedLon === 0) return null;
    if (Math.abs(normalizedLat) > 90 || Math.abs(normalizedLon) > 180) return null;
    return { lat: normalizedLat, lon: normalizedLon };
  }

  function latLonFromPointArray(value) {
    if (!Array.isArray(value) || value.length < 2) return null;
    if (!Number.isFinite(Number(value[0])) || !Number.isFinite(Number(value[1]))) return null;
    return validLatLon(Number(value[1]), Number(value[0]));
  }

  function latLonFromObject(value, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) return latLonFromPointArray(value);

    const direct = validLatLon(
      firstFiniteNumber(value.lat, value.latitude),
      firstFiniteNumber(value.lon, value.lng, value.longitude)
    );
    if (direct) return direct;

    const nestedKeys = [
      "coords",
      "coordinates",
      "location",
      "lookupPoint",
      "geocode",
      "geo",
      "point",
      "center",
      "serviceLocation",
      "propertyLocation",
      "addressLocation"
    ];
    for (const key of nestedKeys) {
      const nested = latLonFromObject(value[key], seen);
      if (nested) return nested;
    }

    return null;
  }

  function quoteDraftKey() {
    try {
      if (typeof QUOTE_DRAFT_KEY !== "undefined" && QUOTE_DRAFT_KEY) return QUOTE_DRAFT_KEY;
    } catch {}
    return "turflynk.quoteDraft.v5";
  }

  function loadStoredQuoteDraft() {
    try {
      try { localStorage.removeItem(quoteDraftKey()); } catch {}
      return JSON.parse(sessionStorage.getItem(quoteDraftKey()) || "null");
    } catch {
      return null;
    }
  }

  function formLatLon(form) {
    if (!form) return null;
    return validLatLon(
      firstFiniteNumber(form.elements?.lat?.value, form.elements?.latitude?.value),
      firstFiniteNumber(form.elements?.lng?.value, form.elements?.lon?.value, form.elements?.longitude?.value)
    );
  }

  function currentQuoteOrCheckoutLatLon() {
    const appState = getAppState();
    const quoteForm = document.getElementById("quoteForm");
    const leadForm = document.getElementById("leadRequestForm");
    const formDraft = quoteForm ? Object.fromEntries(new FormData(quoteForm).entries()) : null;
    const leadDraft = leadForm ? Object.fromEntries(new FormData(leadForm).entries()) : null;
    const candidates = [
      appState?.pendingQuote,
      appState?.lastQuote,
      appState?.currentEstimate,
      appState?.currentCheckoutDraft,
      appState?.checkoutDraft,
      window.quoteState,
      window.checkoutState,
      window.currentCheckoutDraft,
      window.pendingCheckoutDraft,
      formDraft,
      leadDraft,
      loadStoredQuoteDraft()
    ];

    for (const candidate of candidates) {
      const pos = latLonFromObject(candidate);
      if (pos) return pos;
    }

    return null;
  }

  function collectGeoJsonPositions(value, out = [], seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return out;
    seen.add(value);

    if (value.type === "FeatureCollection") {
      (value.features || []).forEach(feature => collectGeoJsonPositions(feature, out, seen));
      return out;
    }
    if (value.type === "Feature") return collectGeoJsonPositions(value.geometry, out, seen);
    if (value.type === "GeometryCollection") {
      (value.geometries || []).forEach(geometry => collectGeoJsonPositions(geometry, out, seen));
      return out;
    }

    const coords = value.coordinates;
    if (!Array.isArray(coords)) return out;

    const visit = (node) => {
      if (!Array.isArray(node)) return;
      if (node.length >= 2 && Number.isFinite(Number(node[0])) && Number.isFinite(Number(node[1]))) {
        out.push([Number(node[0]), Number(node[1])]);
        return;
      }
      node.forEach(visit);
    };
    visit(coords);
    return out;
  }

  function centroidFromGeoJson(value) {
    if (!value) return null;

    try {
      if (window.turf?.centroid) {
        const centroid = window.turf.centroid(value);
        const coords = centroid?.geometry?.coordinates;
        const turfPos = latLonFromPointArray(coords);
        if (turfPos) return turfPos;
      }
    } catch {}

    const positions = collectGeoJsonPositions(value);
    if (!positions.length) return null;
    const totals = positions.reduce((acc, point) => {
      acc.lon += point[0];
      acc.lat += point[1];
      return acc;
    }, { lat: 0, lon: 0 });
    return validLatLon(totals.lat / positions.length, totals.lon / positions.length);
  }

  function selectedParcelCentroid() {
    const appState = getAppState();
    const candidates = [
      appState?.selectedParcelGeoJson,
      appState?.selectedParcelGeoJSON,
      appState?.selectedParcel,
      appState?.currentParcelGeoJson,
      appState?.currentParcelGeoJSONData,
      appState?.currentParcel,
      appState?.confirmedParcel,
      appState?.parcelGeoJson,
      appState?.parcelGeoJSON,
      appState?.parcelFeature,
      appState?.parcelLayer,
      window.selectedParcelGeoJson,
      window.selectedParcelGeoJSON,
      window.currentParcelGeoJson,
      window.currentParcelGeoJSONData,
      window.currentParcel,
      window.confirmedParcel,
      window.parcelGeoJson,
      window.parcelGeoJSON,
      window.parcelLayer
    ];

    for (const candidate of candidates) {
      const pos = centroidFromGeoJson(candidate);
      if (pos) return pos;
    }

    return null;
  }

  function hiddenFieldLatLon() {
    const selectors = [
      ["#propertyLat", "#propertyLon"],
      ["#propertyLat", "#propertyLng"],
      ["#parcelLat", "#parcelLon"],
      ["#parcelLat", "#parcelLng"],
      ["input[name='lat']", "input[name='lon']"],
      ["input[name='lat']", "input[name='lng']"],
      ["input[name='latitude']", "input[name='longitude']"]
    ];

    for (const [latSel, lonSel] of selectors) {
      const latEl = document.querySelector(latSel);
      const lonEl = document.querySelector(lonSel);
      const pos = validLatLon(latEl && latEl.value, lonEl && lonEl.value);
      if (pos) return pos;
    }

    return formLatLon(document.getElementById("quoteForm"));
  }

  function savedServiceAddressLatLon() {
    const appState = getAppState();
    const candidates = [
      appState?.currentServiceAddress,
      appState?.serviceAddress,
      appState?.propertyAddress,
      appState?.pendingParcelFeature,
      loadStoredQuoteDraft()
    ];

    for (const candidate of candidates) {
      const pos = latLonFromObject(candidate);
      if (pos) return pos;
    }

    return null;
  }

  function distanceDegrees(a, b) {
    if (!a || !b) return Infinity;
    return Math.hypot(Number(a.lat) - Number(b.lat), Number(a.lon) - Number(b.lon));
  }

  function mapCenterLatLon() {
    const appState = getAppState();
    const maps = [appState?.map, window.turflynkMap, window.map];
    for (const map of maps) {
      if (!map || typeof map.getCenter !== "function") continue;
      const center = map.getCenter();
      const pos = validLatLon(center?.lat, center?.lng ?? center?.lon);
      if (!pos) continue;

      const parcelCenter = selectedParcelCentroid();
      if (parcelCenter && distanceDegrees(pos, parcelCenter) <= MAP_CONTEXT_MATCH_DEGREES) return pos;

      const hidden = hiddenFieldLatLon();
      if (hidden && distanceDegrees(pos, hidden) <= MAP_CONTEXT_MATCH_DEGREES) return pos;
    }

    return null;
  }

  function getLatLon() {
    return currentQuoteOrCheckoutLatLon()
      || selectedParcelCentroid()
      || hiddenFieldLatLon()
      || savedServiceAddressLatLon()
      || mapCenterLatLon()
      || null;
  }

  function weatherSchedulerPanelIsActive() {
    const quoteStep = document.body?.dataset?.quoteFlowStep || getAppState()?.quoteFlowStep || "";
    const panelVisible = (id) => {
      const el = document.getElementById(id);
      return Boolean(el && !el.hidden && !el.classList.contains("hidden") && el.getAttribute("aria-hidden") !== "true");
    };
    return panelVisible("leadRequestPanel") || panelVisible("manualQuotePanel") || quoteStep === "request";
  }

  function findScheduleAnchor() {
    const checkoutPreferred = document.querySelector(
      "#leadRequestPanel:not(.hidden) #leadRequestForm .preferred-days-grid, #leadRequestPanel[aria-hidden='false'] #leadRequestForm .preferred-days-grid"
    );
    if (checkoutPreferred) return checkoutPreferred;

    const manualPreferred = document.querySelector(
      "#manualQuotePanel:not(.hidden) #manualQuoteForm .preferred-days-grid, #manualQuotePanel[aria-hidden='false'] #manualQuoteForm .preferred-days-grid"
    );
    if (manualPreferred) return manualPreferred;

    const preferred = document.querySelector(
      "#preferredDays, #preferred-days, [data-preferred-days], .preferred-days-grid, .preferred-days, .service-days, .schedule-days"
    );
    if (preferred) return preferred;

    const labels = Array.from(document.querySelectorAll("label"));
    const dayLabel = labels.find(l => DAY_NAMES.some(d => l.textContent.trim().toLowerCase().startsWith(d)));
    return dayLabel ? dayLabel.parentElement : null;
  }

  function preferredDaysReady() {
    const anchor = findScheduleAnchor();
    return Boolean(
      weatherSchedulerPanelIsActive()
      && anchor
      && anchor.querySelector("input[type='checkbox'][name='available_days_json']")
    );
  }

  function forecastSignature(days) {
    return selectableForecastDays(days)
      .map(day => [
        day.date || "",
        weatherCodeFromDay(day) ?? "",
        getForecastProbability(day) ?? "",
        String(day.summary || day.condition || day.weather || "")
      ].join(":"))
      .join("|");
  }

  function syncRenderedForecastSelections(wrap, anchor) {
    if (!wrap || !anchor) return;
    wrap.querySelectorAll(".weather-day-card[data-day-key]").forEach(card => {
      const input = card.querySelector(".weather-card-checkbox");
      const originalInput = findOriginalDayInput(card.dataset.dayKey, anchor);
      if (!input || !originalInput) return;
      input.checked = !!originalInput.checked;
      card.classList.toggle("selected", !!input.checked);
    });
  }

  function findOriginalDayInput(dayKey, root = document) {
    const longMap = {
      sun: "sunday",
      mon: "monday",
      tue: "tuesday",
      wed: "wednesday",
      thu: "thursday",
      fri: "friday",
      sat: "saturday"
    };

    const longDay = longMap[dayKey] || dayKey;
    const inputs = Array.from(root.querySelectorAll("input[type='checkbox'][name='available_days_json']"));

    const exact = inputs.find(input => {
      const values = [
        input.value,
        input.getAttribute("data-day"),
        input.id
      ].filter(Boolean).map(value => String(value).trim().toLowerCase());
      return values.includes(dayKey) || values.includes(longDay);
    });
    if (exact) return exact;

    return inputs.find(input => {
      const haystack = [
        input.id,
        input.name,
        input.value,
        input.getAttribute("data-day"),
        input.closest("label")?.textContent,
        document.querySelector(`label[for="${input.id}"]`)?.textContent
      ].filter(Boolean).join(" ").toLowerCase();

      return haystack.includes(dayKey) || haystack.includes(longDay);
    }) || null;
  }

  function renderForecast(days) {
    const anchor = findScheduleAnchor();
    if (!anchor || !Array.isArray(days) || !days.length) return;
    const forecastDays = selectableForecastDays(days);
    if (!forecastDays.length) return;
    const signature = forecastSignature(days);

    let wrap = document.getElementById("mownwaWeatherScheduler");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "mownwaWeatherScheduler";
      wrap.className = "weather-scheduler-strip";
      anchor.parentElement.insertBefore(wrap, anchor);
    }

    if (renderedForecastSignature === signature && wrap.querySelector(".weather-day-card")) {
      syncRenderedForecastSelections(wrap, anchor);
      anchor.classList.add("weather-days-source-hidden");
      return;
    }

    renderedForecastSignature = signature;
    wrap.innerHTML = `
      <div class="weather-scheduler-head">
        <strong>Preferred days of the week</strong>
        <span>Starts with tomorrow. Same-day is treated as a rush request.</span>
      </div>
      <div class="weather-scheduler-row"></div>
    `;

    const row = wrap.querySelector(".weather-scheduler-row");

    forecastDays.forEach(day => {
      const dayKey = new Date(day.date + "T12:00:00")
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase()
        .slice(0, 3);

      const originalInput = findOriginalDayInput(dayKey, anchor);
      const checkboxId = `weatherPreferred_${day.date}`;
      const iconSrc = resolveWeatherIcon(day);
      const iconAlt = escapeAttr(day.summary || day.condition || "Weather");
      const conditionText = getConditionText(day);

      const card = document.createElement("label");
      card.className = `weather-day-card weather-risk-${escapeAttr(day.mowRisk || "low")}`;
      card.setAttribute("for", checkboxId);
      card.dataset.dayKey = dayKey;
      card.dataset.date = day.date;
      card.innerHTML = `
        <div class="weather-day-name">${fmtDay(day.date)}</div>
        <div class="weather-day-date">${fmtDate(day.date)}</div>
        <div class="weather-day-icon"><img src="${iconSrc}" alt="${iconAlt}" loading="lazy"></div>
        ${conditionText ? `<div class="weather-day-condition">${escapeAttr(conditionText)}</div>` : ""}
        <input id="${checkboxId}" class="weather-card-checkbox" type="checkbox" aria-label="Preferred ${fmtDay(day.date)}">
      `;

      const cardInput = card.querySelector("input");
      if (originalInput) {
        const syncSelected = () => {
          card.classList.toggle("selected", !!cardInput.checked);
        };
        cardInput.checked = !!originalInput.checked;
        syncSelected();
        cardInput.addEventListener("change", () => {
          originalInput.checked = cardInput.checked;
          syncSelected();
          originalInput.dispatchEvent(new Event("change", { bubbles: true }));
          originalInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }

      row.appendChild(card);
    });

    if (anchor) {
      anchor.classList.add("weather-days-source-hidden");
    }
  }


  async function loadWeather(options = {}) {
    if (!options.force && !weatherSchedulerPanelIsActive()) return false;
    if (!preferredDaysReady()) return false;
    const pos = getLatLon();
    if (!pos) return false;
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon) || (pos.lat === 0 && pos.lon === 0)) return false;

    try {
      let days = [];
      const res = await fetch(`/api/weather?lat=${encodeURIComponent(pos.lat)}&lon=${encodeURIComponent(pos.lon)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) days = data.days || [];
      }
      if (selectableForecastDays(days).length < FORECAST_TILE_COUNT) {
        const extendedDays = await fetchExtendedForecast(pos);
        if (selectableForecastDays(extendedDays).length >= FORECAST_TILE_COUNT) {
          days = extendedDays;
        }
      }
      renderForecast(days);
      return Boolean(document.getElementById("mownwaWeatherScheduler")?.querySelector(".weather-day-card"));
    } catch (err) {
      console.warn("[weather-scheduler] failed:", err);
      return false;
    }
  }

  function scheduleRefresh(reason = "scheduled", options = {}) {
    const requestId = ++refreshRequestSeq;
    const retryLimit = Number.isFinite(options.retries) ? options.retries : REFRESH_RETRY_LIMIT;
    const delay = Number.isFinite(options.delay) ? options.delay : REFRESH_RETRY_DELAY_MS;

    const attempt = async (remaining) => {
      if (requestId !== refreshRequestSeq) return;
      const rendered = await loadWeather({ force: Boolean(options.force) });
      if (rendered || remaining <= 0 || requestId !== refreshRequestSeq) return;
      window.setTimeout(() => attempt(remaining - 1), delay);
    };

    window.setTimeout(() => attempt(retryLimit), Number.isFinite(options.initialDelay) ? options.initialDelay : 0);
  }

  window.MowNWAWeatherScheduler = {
    sameDayRushMowing: SAME_DAY_RUSH_MOWING,
    refresh: () => loadWeather({ force: true }),
    scheduleRefresh,
    getLatLon
  };

  function installWeatherObserver() {
    if (weatherObserver || !window.MutationObserver || !document.documentElement) return;
    weatherObserver = new MutationObserver((mutations) => {
      const shouldRefresh = mutations.some((mutation) => {
        const target = mutation.target;
        if (target?.closest?.("#mownwaWeatherScheduler")) return false;
        if (
          mutation.type === "attributes"
          && mutation.attributeName === "class"
          && target?.classList?.contains("preferred-days-grid")
          && target.classList.contains("weather-days-source-hidden")
        ) {
          return false;
        }
        if (target === document.body) return true;
        if (target?.id === "leadRequestPanel" || target?.id === "manualQuotePanel") return true;
        if (target?.classList?.contains("preferred-days-grid")) return true;
        return Array.from(mutation.addedNodes || []).some((node) => (
          node.nodeType === 1
          && !node.closest?.("#mownwaWeatherScheduler")
          && (
            node.id === "leadRequestPanel"
            || node.id === "manualQuotePanel"
            || node.matches?.(".preferred-days-grid, [data-preferred-days]")
            || node.querySelector?.(".preferred-days-grid, [data-preferred-days], input[name='available_days_json']")
          )
        ));
      });
      if (shouldRefresh) scheduleRefresh("dom-mutation", { initialDelay: 80 });
    });
    weatherObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden", "data-quote-flow-step"]
    });
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!t) return;
    if (t.closest("#quoteEstimateBtn, #calculateEstimateBtn, #confirmParcelBtn, #selectParcelBtn")) {
      scheduleRefresh("quote-action", { initialDelay: 900 });
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    installWeatherObserver();
    scheduleRefresh("dom-ready", { initialDelay: 250 });
  });

  if (document.readyState !== "loading") {
    installWeatherObserver();
    scheduleRefresh("script-ready", { initialDelay: 250 });
  }
})();
