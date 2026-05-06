#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, re, subprocess

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
STAMP = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

route = ROOT / "server/routes/weather.js"
js = ROOT / "public/js/quote/weather-scheduler.js"
css = ROOT / "public/css/weather-scheduler.css"
icon_dir = ROOT / "public/weather-icons"

def backup(p):
    if p.exists():
        b = p.with_suffix(p.suffix + f".bak-svg-icons-{STAMP}")
        shutil.copy2(p, b)
        print(f"backup: {b}")

for p in [route, js, css]:
    backup(p)

icon_dir.mkdir(parents=True, exist_ok=True)

codes = [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]

print("downloading Open-Meteo SVG weather icons...")
for code in codes:
    out = icon_dir / f"{code}.svg"
    if out.exists() and out.stat().st_size > 100:
        continue
    subprocess.run(
        ["curl", "-fsSL", "-o", str(out), f"https://open-meteo.com/images/weather-icons/{code}.svg"],
        check=False
    )

# Patch backend: add code + iconUrl to describeWeather output
s = route.read_text(encoding="utf-8")

if 'iconUrl: `/weather-icons/${code}.svg`' not in s:
    s = s.replace(
        'function describeWeather(code) {',
        'function describeWeather(code) {\n  const iconUrl = `/weather-icons/${code}.svg`;'
    )

    replacements = {
        'return { icon: "☀️", summary: "Clear" };':
            'return { icon: iconUrl, iconEmoji: "☀️", summary: "Clear", code };',
        'return { icon: "🌤️", summary: "Partly cloudy" };':
            'return { icon: iconUrl, iconEmoji: "🌤️", summary: "Partly cloudy", code };',
        'return { icon: "☁️", summary: "Cloudy" };':
            'return { icon: iconUrl, iconEmoji: "☁️", summary: "Cloudy", code };',
        'return { icon: "🌫️", summary: "Fog" };':
            'return { icon: iconUrl, iconEmoji: "🌫️", summary: "Fog", code };',
        'return { icon: "🌧️", summary: "Rain" };':
            'return { icon: iconUrl, iconEmoji: "🌧️", summary: "Rain", code };',
        'return { icon: "❄️", summary: "Snow" };':
            'return { icon: iconUrl, iconEmoji: "❄️", summary: "Snow", code };',
        'return { icon: "⛈️", summary: "Storms" };':
            'return { icon: iconUrl, iconEmoji: "⛈️", summary: "Storms", code };',
    }

    for old, new in replacements.items():
        s = s.replace(old, new)

    # fallback cloudy return may still be original after earlier replacements; ensure it is SVG too
    s = s.replace(
        'return { icon: "☁️", summary: "Cloudy" };',
        'return { icon: iconUrl, iconEmoji: "☁️", summary: "Cloudy", code };'
    )

route.write_text(s, encoding="utf-8")
print(f"patched backend icons: {route}")

# Patch frontend rendering to support SVG URL or emoji fallback
j = js.read_text(encoding="utf-8")

old = '<div class="weather-day-icon">${String(day.icon || "🌦️").startsWith("http") ? "🌦️" : day.icon}</div>'
new = '''<div class="weather-day-icon">${
          String(day.icon || "").startsWith("/weather-icons/")
            ? `<img src="${day.icon}" alt="${day.summary || "Weather"}" loading="lazy">`
            : (day.icon || "🌦️")
        }</div>'''

if old in j:
    j = j.replace(old, new)
else:
    # More flexible replacement if formatting changed
    j = re.sub(
        r'<div class="weather-day-icon">[\s\S]*?</div>\s*<div class="weather-day-temp">',
        new + '\n        <div class="weather-day-temp">',
        j,
        count=1
    )

js.write_text(j, encoding="utf-8")
print(f"patched frontend icons: {js}")

# Add CSS
c = css.read_text(encoding="utf-8")

icon_css = r'''

/* SVG weather icons */
.weather-day-icon {
  display: flex !important;
  justify-content: center;
  align-items: center;
  min-height: 34px;
}

.weather-day-icon img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.14));
}
'''

if "SVG weather icons" not in c:
    c += icon_css

css.write_text(c, encoding="utf-8")
print(f"patched icon css: {css}")

print("Done.")
