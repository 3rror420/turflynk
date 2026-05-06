#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, re

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
STAMP = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

js = ROOT / "public/js/quote/weather-scheduler.js"
css = ROOT / "public/css/weather-scheduler.css"

def backup(p):
    b = p.with_suffix(p.suffix + f".bak-real-weather-checks-{STAMP}")
    shutil.copy2(p, b)
    print(f"backup: {b}")

backup(js)
backup(css)

s = js.read_text(encoding="utf-8")

new_render = r'''
  function findOriginalDayInput(dayKey) {
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
    const inputs = Array.from(document.querySelectorAll("input[type='checkbox']"));

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

    let wrap = document.getElementById("mownwaWeatherScheduler");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "mownwaWeatherScheduler";
      wrap.className = "weather-scheduler-strip";
      anchor.parentElement.insertBefore(wrap, anchor);
    }

    wrap.innerHTML = `
      <div class="weather-scheduler-head">
        <strong>Preferred days of the week</strong>
        <span>7-day forecast included to help pick service days.</span>
      </div>
      <div class="weather-scheduler-row"></div>
    `;

    const row = wrap.querySelector(".weather-scheduler-row");

    days.slice(0, 7).forEach(day => {
      const dayKey = new Date(day.date + "T12:00:00")
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase()
        .slice(0, 3);

      const originalInput = findOriginalDayInput(dayKey);
      const checkboxId = `weatherPreferred_${day.date}`;

      const card = document.createElement("label");
      card.className = `weather-day-card weather-risk-${day.mowRisk || "low"}`;
      card.setAttribute("for", checkboxId);
      card.innerHTML = `
        <div class="weather-day-name">${fmtDay(day.date)}</div>
        <div class="weather-day-date">${fmtDate(day.date)}</div>
        <div class="weather-day-icon">${String(day.icon || "🌦️").startsWith("http") ? "🌦️" : day.icon}</div>
        <div class="weather-day-temp">${day.highF ?? day.high ?? "--"}°</div>
        <div class="weather-day-rain">${day.rainChance ?? 0}% rain</div>
        <div class="weather-day-risk">${getRiskLabel(day)}</div>
        <input id="${checkboxId}" class="weather-card-checkbox" type="checkbox" aria-label="Preferred ${fmtDay(day.date)}">
      `;

      const cardInput = card.querySelector("input");
      if (originalInput) {
        cardInput.checked = !!originalInput.checked;
        cardInput.addEventListener("change", () => {
          originalInput.checked = cardInput.checked;
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
'''

s2 = re.sub(
    r'  function renderForecast\(days\) \{[\s\S]*?\n  async function loadWeather\(\)',
    new_render + "\n\n  async function loadWeather()",
    s,
    count=1
)

if s2 == s:
    raise SystemExit("ERROR: Could not replace renderForecast block")

js.write_text(s2, encoding="utf-8")
print(f"patched js: {js}")

c = css.read_text(encoding="utf-8")

append_css = r'''

/* Weather selectable cards */
.weather-day-card {
  cursor: pointer;
}

.weather-card-checkbox {
  display: block;
  width: 17px;
  height: 17px;
  margin: 8px auto 0;
  accent-color: #3f7f29;
}

.weather-day-card:has(.weather-card-checkbox:checked) {
  outline: 2px solid rgba(63, 127, 41, 0.75);
  box-shadow: 0 8px 18px rgba(63, 127, 41, 0.18);
}

.weather-days-source-hidden {
  display: none !important;
}
'''

if "Weather selectable cards" not in c:
    c += append_css

css.write_text(c, encoding="utf-8")
print(f"patched css: {css}")

print("Done.")
