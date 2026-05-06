#!/usr/bin/env python3
from pathlib import Path
import shutil, datetime, re

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
STAMP = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

def backup(p):
    if p.exists():
        b = p.with_suffix(p.suffix + f".bak-weather-{STAMP}")
        shutil.copy2(p, b)
        print(f"backup: {b}")

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    backup(path)
    path.write_text(content, encoding="utf-8")
    print(f"wrote: {path}")

# 1) Backend weather route
write(ROOT / "server/routes/weather.js", r'''
const express = require("express");
const router = express.Router();

function clampCoord(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function openMeteoIcon(code) {
  const c = Number(code);
  if ([0].includes(c)) return "☀️";
  if ([1, 2].includes(c)) return "🌤️";
  if ([3].includes(c)) return "☁️";
  if ([45, 48].includes(c)) return "🌫️";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(c)) return "❄️";
  if ([95, 96, 99].includes(c)) return "⛈️";
  return "🌦️";
}

function openMeteoSummary(code) {
  const c = Number(code);
  if (c === 0) return "Clear";
  if ([1, 2].includes(c)) return "Partly cloudy";
  if (c === 3) return "Cloudy";
  if ([45, 48].includes(c)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(c)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(c)) return "Snow";
  if ([95, 96, 99].includes(c)) return "Storms";
  return "Weather";
}

async function getOpenMeteo(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: "auto",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    forecast_days: "7"
  }).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo failed ${res.status}`);
  const data = await res.json();

  const days = (data.daily?.time || []).map((date, i) => {
    const code = data.daily.weather_code?.[i];
    const rainChance = data.daily.precipitation_probability_max?.[i] ?? null;
    return {
      date,
      high: Math.round(data.daily.temperature_2m_max?.[i] ?? 0),
      low: Math.round(data.daily.temperature_2m_min?.[i] ?? 0),
      rainChance,
      precipitation: data.daily.precipitation_sum?.[i] ?? null,
      icon: openMeteoIcon(code),
      summary: openMeteoSummary(code),
      mowRisk: rainChance >= 70 ? "high" : rainChance >= 40 ? "medium" : "low"
    };
  });

  return {
    source: "open-meteo",
    current: {
      temperature: Math.round(data.current?.temperature_2m ?? 0),
      humidity: data.current?.relative_humidity_2m ?? null,
      windspeed: data.current?.wind_speed_10m ?? null,
      precipitation: data.current?.precipitation ?? null,
      icon: openMeteoIcon(data.current?.weather_code),
      summary: openMeteoSummary(data.current?.weather_code)
    },
    days
  };
}

async function getNWS(lat, lon) {
  const headers = { "User-Agent": "MowNWA TurfLynk Weather (contact@mownwa.com)" };
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers });
  if (!pointsRes.ok) throw new Error(`NWS points failed ${pointsRes.status}`);

  const points = await pointsRes.json();
  const forecastUrl = points.properties?.forecast;
  if (!forecastUrl) throw new Error("NWS forecast URL missing");

  const forecastRes = await fetch(forecastUrl, { headers });
  if (!forecastRes.ok) throw new Error(`NWS forecast failed ${forecastRes.status}`);

  const forecast = await forecastRes.json();
  const periods = forecast.properties?.periods || [];
  const daytime = periods.filter(p => p.isDaytime).slice(0, 7);

  const days = daytime.map(p => {
    const rainChance = p.probabilityOfPrecipitation?.value ?? null;
    return {
      date: p.startTime?.slice(0, 10),
      high: p.temperature,
      low: null,
      rainChance,
      precipitation: null,
      icon: p.icon || "🌦️",
      summary: p.shortForecast || "Forecast",
      mowRisk: rainChance >= 70 ? "high" : rainChance >= 40 ? "medium" : "low"
    };
  });

  return {
    source: "nws",
    current: days[0] || null,
    days
  };
}

router.get("/", async (req, res) => {
  const lat = clampCoord(req.query.lat, -90, 90);
  const lon = clampCoord(req.query.lon, -180, 180);

  if (lat === null || lon === null) {
    return res.status(400).json({ ok: false, error: "Valid lat and lon are required" });
  }

  try {
    const weather = await getOpenMeteo(lat, lon);
    return res.json({ ok: true, fallback: false, ...weather });
  } catch (err) {
    console.warn("[weather] Open-Meteo failed, falling back to NWS:", err.message);
    try {
      const weather = await getNWS(lat, lon);
      return res.json({ ok: true, fallback: true, ...weather });
    } catch (err2) {
      console.warn("[weather] NWS fallback failed:", err2.message);
      return res.status(503).json({ ok: false, error: "Weather unavailable" });
    }
  }
});

module.exports = router;
'''.strip() + "\n")

# 2) Patch server/index.js
index = ROOT / "server/index.js"
backup(index)
s = index.read_text(encoding="utf-8")

if 'require("./routes/weather")' not in s:
    m = re.search(r'(const\s+app\s*=\s*express\s*\(\s*\)\s*;)', s)
    if not m:
        raise SystemExit("Could not find const app = express(); in server/index.js")
    s = s[:m.end()] + '\nconst weatherRoutes = require("./routes/weather");' + s[m.end():]

if 'app.use("/api/weather", weatherRoutes);' not in s:
    m = re.search(r'(app\.use\s*\(\s*express\.json[\s\S]*?\)\s*;)', s)
    if m:
        insert_at = m.end()
        s = s[:insert_at] + '\napp.use("/api/weather", weatherRoutes);' + s[insert_at:]
    else:
        m = re.search(r'(const\s+weatherRoutes\s*=\s*require\("./routes/weather"\);\s*)', s)
        s = s[:m.end()] + '\napp.use("/api/weather", weatherRoutes);' + s[m.end():]

index.write_text(s, encoding="utf-8")
print("patched: server/index.js")

# 3) Frontend JS: enhances existing preferred-day checkbox area dynamically
write(ROOT / "public/js/quote/weather-scheduler.js", r'''
(function () {
  "use strict";

  const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  function fmtDay(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }

  function fmtDate(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  }

  function getRiskLabel(day) {
    if (day.mowRisk === "high") return "Rain risk";
    if (day.mowRisk === "medium") return "Watch";
    return "Good";
  }

  function getLatLon() {
    const selectors = [
      ["#propertyLat", "#propertyLon"],
      ["#parcelLat", "#parcelLon"],
      ["input[name='lat']", "input[name='lon']"],
      ["input[name='latitude']", "input[name='longitude']"]
    ];

    for (const [latSel, lonSel] of selectors) {
      const latEl = document.querySelector(latSel);
      const lonEl = document.querySelector(lonSel);
      const lat = Number(latEl && latEl.value);
      const lon = Number(lonEl && lonEl.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }

    if (window.state && window.state.map && typeof window.state.map.getCenter === "function") {
      const c = window.state.map.getCenter();
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        return { lat: c.lat, lon: c.lng };
      }
    }

    if (window.map && typeof window.map.getCenter === "function") {
      const c = window.map.getCenter();
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        return { lat: c.lat, lon: c.lng };
      }
    }

    return null;
  }

  function findScheduleAnchor() {
    const preferred = document.querySelector(
      "#preferredDays, #preferred-days, [data-preferred-days], .preferred-days, .service-days, .schedule-days"
    );
    if (preferred) return preferred;

    const labels = Array.from(document.querySelectorAll("label"));
    const dayLabel = labels.find(l => DAY_NAMES.some(d => l.textContent.trim().toLowerCase().startsWith(d)));
    return dayLabel ? dayLabel.parentElement : null;
  }

  function renderForecast(days) {
    const anchor = findScheduleAnchor();
    if (!anchor || !Array.isArray(days) || !days.length) return;

    let wrap = document.getElementById("mownwaWeatherScheduler");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "mownwaWeatherScheduler";
      wrap.className = "weather-scheduler-strip";
      anchor.parentElement.insertBefore(wrap, anchor);
    }

    wrap.innerHTML = `
      <div class="weather-scheduler-head">
        <strong>7-day mowing forecast</strong>
        <span>Use this to pick preferred service days.</span>
      </div>
      <div class="weather-scheduler-row">
        ${days.slice(0, 7).map(day => `
          <div class="weather-day-card weather-risk-${day.mowRisk || "low"}">
            <div class="weather-day-name">${fmtDay(day.date)}</div>
            <div class="weather-day-date">${fmtDate(day.date)}</div>
            <div class="weather-day-icon">${String(day.icon || "🌦️").startsWith("http") ? "🌦️" : day.icon}</div>
            <div class="weather-day-temp">${day.high ?? "--"}°</div>
            <div class="weather-day-rain">${day.rainChance ?? 0}% rain</div>
            <div class="weather-day-risk">${getRiskLabel(day)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  async function loadWeather() {
    const pos = getLatLon();
    if (!pos) return;

    try {
      const res = await fetch(`/api/weather?lat=${encodeURIComponent(pos.lat)}&lon=${encodeURIComponent(pos.lon)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      renderForecast(data.days);
    } catch (err) {
      console.warn("[weather-scheduler] failed:", err);
    }
  }

  window.MowNWAWeatherScheduler = {
    refresh: loadWeather
  };

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(loadWeather, 1200);
  });

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!t) return;
    if (t.closest("#quoteEstimateBtn, #calculateEstimateBtn, #confirmParcelBtn, #selectParcelBtn")) {
      setTimeout(loadWeather, 900);
    }
  });
})();
'''.strip() + "\n")

# 4) CSS
write(ROOT / "public/css/weather-scheduler.css", r'''
.weather-scheduler-strip {
  margin: 14px 0 18px;
  padding: 14px;
  border: 1px solid rgba(47, 111, 24, 0.18);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(247, 252, 244, 0.96), rgba(255,255,255,0.96));
  box-shadow: 0 8px 24px rgba(18, 49, 12, 0.08);
}

.weather-scheduler-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 10px;
}

.weather-scheduler-head strong {
  color: #245c18;
  font-size: 0.98rem;
}

.weather-scheduler-head span {
  color: #55705a;
  font-size: 0.82rem;
}

.weather-scheduler-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(86px, 1fr));
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.weather-day-card {
  min-width: 86px;
  border: 1px solid rgba(22, 61, 18, 0.12);
  border-radius: 14px;
  padding: 9px 8px;
  text-align: center;
  background: #fff;
}

.weather-day-name {
  font-weight: 800;
  color: #25491f;
  font-size: 0.82rem;
}

.weather-day-date {
  color: #6a786a;
  font-size: 0.72rem;
  margin-top: 1px;
}

.weather-day-icon {
  font-size: 1.45rem;
  line-height: 1;
  margin: 7px 0 5px;
}

.weather-day-temp {
  font-weight: 800;
  font-size: 0.95rem;
}

.weather-day-rain,
.weather-day-risk {
  font-size: 0.72rem;
  color: #607060;
}

.weather-risk-low {
  border-color: rgba(70, 140, 50, 0.25);
}

.weather-risk-medium {
  border-color: rgba(214, 157, 37, 0.42);
  background: #fffaf0;
}

.weather-risk-high {
  border-color: rgba(190, 63, 45, 0.38);
  background: #fff5f2;
}

@media (max-width: 760px) {
  .weather-scheduler-head {
    display: block;
  }

  .weather-scheduler-row {
    display: flex;
  }

  .weather-day-card {
    flex: 0 0 92px;
  }
}
'''.strip() + "\n")

# 5) Inject CSS + script
html = ROOT / "public/index.html"
backup(html)
h = html.read_text(encoding="utf-8")

if "weather-scheduler.css" not in h:
    h = h.replace("</head>", '  <link rel="stylesheet" href="/css/weather-scheduler.css?v=weather1">\n</head>')

if "weather-scheduler.js" not in h:
    h = h.replace("</body>", '  <script src="/js/quote/weather-scheduler.js?v=weather1"></script>\n</body>')

html.write_text(h, encoding="utf-8")
print("patched: public/index.html")

print("\nDone.")
print("Test:")
print('  node --check server/routes/weather.js')
print('  curl "http://localhost:3000/api/weather?lat=36.18&lon=-94.13"')
