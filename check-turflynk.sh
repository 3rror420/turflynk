#!/usr/bin/env bash
set -u

APP_DIR="/var/www/turflynk-arkansas-quote-ready-fixed-v3"
BASE_URL="http://127.0.0.1:3000"

cd "$APP_DIR" || {
  echo "❌ Could not cd into $APP_DIR"
  exit 1
}

echo "======================================"
echo " TurfLynk / MowNWA Quick Check"
echo "======================================"
echo ""

fail=0

run_check() {
  local label="$1"
  shift

  echo "▶ $label"
  if "$@"; then
    echo "✅ $label passed"
  else
    echo "❌ $label failed"
    fail=1
  fi
  echo ""
}

run_check "server syntax" node --check server/index.js
run_check "frontend syntax" node --check public/app.js

if [ -d public/js ]; then
  echo "▶ frontend module syntax"
  while IFS= read -r file; do
    echo "  checking $file"
    if ! node --check "$file"; then
      fail=1
    fi
  done < <(find public/js -name "*.js" -print | sort)
  echo ""
fi

echo "▶ PM2 status"
pm2 list
echo ""

echo "▶ Health endpoint"
if curl -fsS "$BASE_URL/health"; then
  echo ""
  echo "✅ health passed"
else
  echo ""
  echo "❌ health failed"
  fail=1
fi
echo ""

echo "▶ Config endpoint"
if curl -fsS "$BASE_URL/api/config" >/tmp/turflynk-config.json; then
  python3 - <<'PY'
import json
from pathlib import Path

p = Path("/tmp/turflynk-config.json")
data = json.loads(p.read_text())

print("✅ config passed")
print("siteBrand:", data.get("siteBrand"))
print("siteMode:", data.get("siteMode"))
print("primaryRegion:", data.get("primaryRegion"))
print("regionCount:", data.get("regionCount"))
print("serviceCount:", data.get("serviceCount"))
PY
else
  echo "❌ config failed"
  fail=1
fi
echo ""

echo "▶ Public job submission"
job_response="$(curl -fsS -X POST "$BASE_URL/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{"customerName":"Script Test Customer","customerPhone":"555-555-5555","customerEmail":"script-test@example.com","address":"123 Main St","city":"Fayetteville","state":"AR","zip":"72701","regionId":"nwa","serviceType":"mowing","preferredDate":"2026-04-30","notes":"Automated script smoke test","lotAreaSqft":20000,"mowAreaSqft":5000,"estimatedPrice":55,"estimateBasis":"customer_selected_mowable_area"}' || true)"

if JOB_RESPONSE="$job_response" python3 -c 'import os,json; d=json.loads(os.environ["JOB_RESPONSE"]); assert d.get("ok") is True' 2>/dev/null; then
  echo "✅ public job submission passed"
  JOB_RESPONSE="$job_response" python3 -c 'import os,json; d=json.loads(os.environ["JOB_RESPONSE"]); job=d.get("job") or d.get("lead") or {}; print("saved id:", job.get("id")); print("mowAreaSqft:", job.get("mowAreaSqft")); print("lotAreaSqft:", job.get("lotAreaSqft")); print("estimateBasis:", job.get("estimateBasis"))'
else
  echo "❌ public job submission failed"
  echo "$job_response"
  fail=1
fi
echo ""

echo "▶ Playwright e2e tests"
if npm run test:e2e; then
  echo "✅ Playwright tests passed"
else
  echo "❌ Playwright tests failed"
  fail=1
fi
echo ""

echo "▶ Recent PM2 error log"
pm2 logs turflynk --lines 20 --nostream | sed -n '/error.log/,$p' || true
echo ""

if [ "$fail" -eq 0 ]; then
  echo "======================================"
  echo "✅ ALL CHECKS PASSED"
  echo "======================================"
  exit 0
else
  echo "======================================"
  echo "❌ SOME CHECKS FAILED"
  echo "======================================"
  exit 1
fi
