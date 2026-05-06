#!/usr/bin/env python3
import subprocess
from pathlib import Path

ROOT = Path("/var/www/turflynk-arkansas-quote-ready-fixed-v3")
VISION = ROOT / "vision_service"

def run(cmd):
    print(f"\n$ {cmd}")
    subprocess.run(cmd, shell=True, check=False)

if not (VISION / "app.py").exists():
    raise SystemExit(f"Missing {VISION / 'app.py'}")

if not (VISION / "mowable_geospatial.py").exists():
    raise SystemExit(f"Missing {VISION / 'mowable_geospatial.py'}")

run("pm2 delete turflynk-vision || true")

run(
    'pm2 start "cd /var/www/turflynk-arkansas-quote-ready-fixed-v3/vision_service '
    '&& python3 -m uvicorn app:app --host 127.0.0.1 --port 8017" '
    "--name turflynk-vision"
)

run("pm2 save")
run("pm2 status")
run("curl -s http://127.0.0.1:8017/health || true")
