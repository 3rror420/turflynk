#!/usr/bin/env python3
from pathlib import Path

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
ICON_DIR = ROOT / "public/weather-icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)

SVG = {
0: ("#FFD43B", "☀"),
1: ("#FFD43B", "⛅"),
2: ("#74C0FC", "⛅"),
3: ("#ADB5BD", "☁"),
45: ("#CED4DA", "≋"),
48: ("#CED4DA", "≋"),
51: ("#4DABF7", "☂"),
53: ("#4DABF7", "☂"),
55: ("#339AF0", "☂"),
56: ("#339AF0", "☂"),
57: ("#339AF0", "☂"),
61: ("#228BE6", "☔"),
63: ("#228BE6", "☔"),
65: ("#1971C2", "☔"),
66: ("#1971C2", "☔"),
67: ("#1971C2", "☔"),
71: ("#A5D8FF", "❄"),
73: ("#A5D8FF", "❄"),
75: ("#74C0FC", "❄"),
77: ("#74C0FC", "❄"),
80: ("#339AF0", "☔"),
81: ("#228BE6", "☔"),
82: ("#1971C2", "☔"),
85: ("#A5D8FF", "❄"),
86: ("#74C0FC", "❄"),
95: ("#845EF7", "⚡"),
96: ("#7048E8", "⚡"),
99: ("#5F3DC4", "⚡"),
}

for code, (color, symbol) in SVG.items():
    path = ICON_DIR / f"{code}.svg"
    path.write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="30" fill="{color}" opacity="0.18"/>
  <circle cx="32" cy="32" r="24" fill="{color}" opacity="0.28"/>
  <text x="32" y="42" text-anchor="middle" font-size="30" font-family="Arial, sans-serif">{symbol}</text>
</svg>
''', encoding="utf-8")
    print("wrote", path)

print("Done.")
