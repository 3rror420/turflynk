#!/usr/bin/env bash
# AI pipeline preflight check — read-only diagnostics only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

# ── NVM bootstrap (match PM2's Node runtime) ─────────────────────────────────
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
if command -v nvm &>/dev/null; then
  nvm use 20 --silent &>/dev/null || true
fi

# ── Color helpers ────────────────────────────────────────────────────────────
if [ -t 1 ] && tput colors &>/dev/null && [ "$(tput colors)" -ge 8 ]; then
  RED='\033[0;31m' GRN='\033[0;32m' YLW='\033[1;33m' CYN='\033[0;36m' RST='\033[0m'
else
  RED='' GRN='' YLW='' CYN='' RST=''
fi

ok()   { printf "  ${GRN}✔${RST}  %s\n" "$*"; }
fail() { printf "  ${RED}✘${RST}  %s\n" "$*"; FAIL=1; }
info() { printf "  ${CYN}·${RST}  %s\n" "$*"; }
hdr()  { printf "\n${YLW}▶ %s${RST}\n" "$*"; }
warn() { printf "  ${YLW}⚠${RST}  %s\n" "$*"; }

# ── 1. Environment summary ───────────────────────────────────────────────────
hdr "Environment"
info "pwd : $ROOT"
info "node: $(node -v 2>/dev/null || echo 'not found')"
info "py3 : $(python3 --version 2>/dev/null || echo 'not found')"

# ── 2. Required files ────────────────────────────────────────────────────────
hdr "Required files"
REQUIRED=(
  server/index.js
  scripts/ai_debug_report.py
  vision-sam-worker/semantic_app.py
)
for f in "${REQUIRED[@]}"; do
  if [ -f "$ROOT/$f" ]; then ok "$f"; else fail "$f — MISSING"; fi
done

# ── 3. Syntax check ──────────────────────────────────────────────────────────
hdr "Syntax validation"
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2>/dev/null || echo "0")
  if [ "$NODE_MAJOR" -lt 14 ]; then
    warn "node v$(node -v | tr -d v) in PATH is too old for optional-chaining — skipping syntax check (PM2 uses a newer runtime)"
  elif node --check "$ROOT/server/index.js" 2>/dev/null; then
    ok "server/index.js (node --check)"
  else
    fail "server/index.js syntax error"
  fi
else
  fail "node not found — skipping syntax check"
fi

# ── 4. PM2 processes ─────────────────────────────────────────────────────────
hdr "PM2 processes"
if command -v pm2 &>/dev/null; then
  pm2 list 2>/dev/null | grep -v "^$" || true
else
  fail "pm2 not found"
fi

# ── 5. Local API health ───────────────────────────────────────────────────────
hdr "Local API health (port 3000)"
if command -v curl &>/dev/null; then
  HTTP=$(curl -s -o /tmp/_pf_body -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/health 2>/dev/null || echo "000")
  BODY=$(cat /tmp/_pf_body 2>/dev/null || echo "")
  if [ "$HTTP" = "200" ]; then
    ok "HTTP $HTTP — $BODY"
  else
    fail "HTTP $HTTP — server may be down (run: pm2 start ecosystem.config.js)"
  fi
else
  fail "curl not found"
fi

# ── 6. A5000 semantic worker health ─────────────────────────────────────────
hdr "A5000 semantic worker health"
ENV_FILE="$ROOT/.env"
A5000_URL=""
if [ -f "$ENV_FILE" ]; then
  A5000_URL=$(grep -E '^A5000_VISION_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'" | xargs)
fi

if [ -z "$A5000_URL" ]; then
  fail "A5000_VISION_URL not found in .env"
elif command -v curl &>/dev/null; then
  info "target: $A5000_URL/health"
  HTTP=$(curl -s -o /tmp/_pf_a5k -w "%{http_code}" --max-time 10 "$A5000_URL/health" 2>/dev/null || echo "000")
  BODY=$(cat /tmp/_pf_a5k 2>/dev/null || echo "")
  if [ "$HTTP" = "200" ]; then
    ok "HTTP $HTTP — $BODY"
  else
    fail "HTTP $HTTP — worker unreachable or tunnel down"
  fi
else
  fail "curl not found"
fi

# ── 7. AI debug report ───────────────────────────────────────────────────────
hdr "AI debug report"
if command -v python3 &>/dev/null && [ -f "$ROOT/scripts/ai_debug_report.py" ]; then
  python3 "$ROOT/scripts/ai_debug_report.py" 2>&1 | sed 's/^/  /'
  ok "ai_debug_report.py complete"
else
  fail "python3 or ai_debug_report.py not available"
fi

# ── 8. Final banner ───────────────────────────────────────────────────────────
echo ""
if [ "$FAIL" -eq 0 ]; then
  printf "${GRN}╔══════════════════════════╗\n║   PRECHECK PASSED  ✔     ║\n╚══════════════════════════╝${RST}\n\n"
  exit 0
else
  printf "${RED}╔══════════════════════════╗\n║   PRECHECK FAILED  ✘     ║\n╚══════════════════════════╝${RST}\n\n"
  exit 1
fi
