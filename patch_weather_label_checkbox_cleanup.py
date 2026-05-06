#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
STAMP = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

js = ROOT / "public/js/quote/weather-scheduler.js"
css = ROOT / "public/css/weather-scheduler.css"

def backup(p):
    b = p.with_suffix(p.suffix + f".bak-clean-weather-ui-{STAMP}")
    shutil.copy2(p, b)
    print(f"backup: {b}")

backup(js)
backup(css)

s = js.read_text(encoding="utf-8")
s = s.replace("Preferred days this week", "Preferred days of the week")
js.write_text(s, encoding="utf-8")
print(f"patched label: {js}")

c = css.read_text(encoding="utf-8")

cleanup_css = r'''

/* Weather card checkbox cleanup */
.weather-day-select {
  font-size: 0 !important;
  line-height: 1 !important;
  margin-top: 8px !important;
}

.weather-day-select input {
  font-size: initial !important;
  margin: 0 !important;
}
'''

if "Weather card checkbox cleanup" not in c:
    c += cleanup_css

css.write_text(c, encoding="utf-8")
print(f"patched css: {css}")

print("Done.")
