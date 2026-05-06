#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, re

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
STAMP = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

js = ROOT / "public/js/quote/weather-scheduler.js"
css = ROOT / "public/css/weather-scheduler.css"

def backup(p):
    b = p.with_suffix(p.suffix + f".bak-selectable-weather-{STAMP}")
    shutil.copy2(p, b)
    print(f"backup: {b}")

backup(js)
backup(css)

s = js.read_text(encoding="utf-8")

new_render = r'''
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

    const labels = Array.from(anchor.querySelectorAll("label"));
    const labelByDay = {};
    labels.forEach(label => {
      const txt = label.textContent.trim().toLowerCase();
      DAY_NAMES.forEach(day => {
        if (txt.includes(day)) labelByDay[day] = label;
      });
    });

    wrap.innerHTML = `
      <div class="weather-scheduler-head">
        <strong>Preferred days this week</strong>
        <span>Forecast included to help pick service days.</span>
      </div>
      <div class="weather-scheduler-row"></div>
    `;

    const row = wrap.querySelector(".weather-scheduler-row");

    days.slice(0, 7).forEach(day => {
      const dayKey = new Date(day.date + "T12:00:00")
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase()
        .slice(0, 3);

      const label = labelByDay[dayKey];

      const card = document.createElement("div");
      card.className = `weather-day-card weather-risk-${day.mowRisk || "low"}`;
      card.innerHTML = `
        <div class="weather-day-name">${fmtDay(day.date)}</div>
        <div class="weather-day-date">${fmtDate(day.date)}</div>
        <div class="weather-day-icon">${String(day.icon || "🌦️").startsWith("http") ? "🌦️" : day.icon}</div>
        <div class="weather-day-temp">${day.highF ?? day.high ?? "--"}°</div>
        <div class="weather-day-rain">${day.rainChance ?? 0}% rain</div>
        <div class="weather-day-risk">${getRiskLabel(day)}</div>
      `;

      if (label) {
        label.classList.add("weather-day-select");
        card.appendChild(label);
      }

      row.appendChild(card);
    });

    if (labels.length) {
      anchor.classList.add("weather-days-source-hidden");
    }
  }
'''

s2 = re.sub(
    r'  function renderForecast\(days\) \{[\s\S]*?\n  async function loadWeather\(\)',
    new_render + "\n\n  async function loadWeather()",
    s,
    count=1
)

if s2 == s:
    raise SystemExit("ERROR: Could not replace renderForecast() in weather-scheduler.js")

js.write_text(s2, encoding="utf-8")
print(f"patched: {js}")

c = css.read_text(encoding="utf-8")

append_css = r'''

.weather-day-select {
  margin-top: 8px;
  display: flex !important;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  color: #24451f;
  cursor: pointer;
}

.weather-day-select input {
  width: 16px;
  height: 16px;
  accent-color: #3f7f29;
}

.weather-day-card:has(.weather-day-select input:checked) {
  outline: 2px solid rgba(63, 127, 41, 0.75);
  box-shadow: 0 8px 18px rgba(63, 127, 41, 0.18);
}

.weather-days-source-hidden {
  display: none !important;
}

.weather-scheduler-head strong {
  text-transform: none;
}
'''

if "weather-day-select" not in c:
    c += append_css

css.write_text(c, encoding="utf-8")
print(f"patched: {css}")

print("Done.")
