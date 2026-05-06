#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, re, subprocess

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
STAMP = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

route = ROOT / "server/routes/weather.js"
icon_dir = ROOT / "public/weather-icons"

def backup(p):
    if p.exists():
        b = p.with_suffix(p.suffix + f".bak-meteocons-{STAMP}")
        shutil.copy2(p, b)
        print(f"backup: {b}")

backup(route)

icon_dir.mkdir(parents=True, exist_ok=True)

print("Downloading Meteocons...")

BASE = "https://raw.githubusercontent.com/basmilius/weather-icons/dev/production/fill/svg"

icons = {
    "clear-day": "clear-day.svg",
    "partly-cloudy-day": "partly-cloudy-day.svg",
    "overcast": "overcast.svg",
    "fog": "fog-day.svg",
    "drizzle": "drizzle.svg",
    "rain": "rain.svg",
    "rain-showers": "partly-cloudy-day-rain.svg",
    "snow": "snow.svg",
    "thunder": "thunderstorms-day-rain.svg"
}

for name, file in icons.items():
    out = icon_dir / file
    if not out.exists():
        subprocess.run(
            ["curl", "-fsSL", "-o", str(out), f"{BASE}/{file}"],
            check=False
        )
        print("downloaded", file)

# Patch backend mapping
s = route.read_text(encoding="utf-8")

mapping_patch = '''
function getIconName(code) {
  if (code === 0) return "clear-day.svg";
  if (code === 1 || code === 2) return "partly-cloudy-day.svg";
  if (code === 3) return "overcast.svg";
  if (code >= 45 && code <= 48) return "fog-day.svg";
  if (code >= 51 && code <= 67) return "drizzle.svg";
  if (code >= 61 && code <= 65) return "rain.svg";
  if (code >= 80 && code <= 82) return "partly-cloudy-day-rain.svg";
  if (code >= 71 && code <= 77) return "snow.svg";
  if (code >= 95 && code <= 99) return "thunderstorms-day-rain.svg";
  return "overcast.svg";
}
'''

if "getIconName" not in s:
    s = s.replace(
        'function describeWeather(code) {',
        mapping_patch + '\n\nfunction describeWeather(code) {'
    )

# Replace icon assignment
s = re.sub(
    r'return \{\s*icon:.*?summary:',
    'return { icon: `/weather-icons/${getIconName(code)}`, summary:',
    s
)

route.write_text(s, encoding="utf-8")
print("patched backend icon mapping")

print("Done.")
