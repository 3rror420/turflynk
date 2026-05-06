#!/usr/bin/env python3
from pathlib import Path
import datetime, shutil, re

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
STAMP = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

def backup(p):
    if p.exists():
        b = p.with_suffix(p.suffix + f".bak-weather-trigger-{STAMP}")
        shutil.copy2(p, b)
        print(f"backup: {b}")

def patch_file(path):
    if not path.exists():
        return False

    content = path.read_text()

    # Avoid duplicate injection
    if "MowNWAWeatherScheduler?.refresh()" in content:
        print(f"already patched: {path}")
        return True

    # Try to hook after estimate result
    patterns = [
        r"(estimate\s*=\s*[^;]+;)",
        r"(showQuoteFlowStep\([^)]*\);)",
        r"(render.*Estimate[^;]*;)",
    ]

    for pattern in patterns:
        match = re.search(pattern, content)
        if match:
            insert_pos = match.end()
            new_content = (
                content[:insert_pos] +
                "\n\n// Weather refresh hook\nsetTimeout(() => {\n  window.MowNWAWeatherScheduler?.refresh();\n}, 300);\n" +
                content[insert_pos:]
            )
            backup(path)
            path.write_text(new_content)
            print(f"patched: {path}")
            return True

    return False


# Target likely files
files = [
    ROOT / "public/js/quote/quote-flow.js",
    ROOT / "public/js/quote/property-lookup.js",
    ROOT / "public/js/quote/checkout-request.js",
    ROOT / "public/app.js"
]

patched_any = False

for f in files:
    if patch_file(f):
        patched_any = True

if not patched_any:
    print("⚠️ No injection point found — manual hook may be required.")

print("\nDone.")
