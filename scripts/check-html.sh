#!/usr/bin/env bash
set -euo pipefail

URL="${1:-http://localhost:3000}"
EXPECTED_IDS="${EXPECTED_IDS:-228}"

HTML="$(curl -s "$URL")"

echo "Checking ID count..."
COUNT="$(printf '%s' "$HTML" | grep -o 'id="' | wc -l | tr -d ' ')"
echo "ID count: $COUNT"

if [ "$COUNT" != "$EXPECTED_IDS" ]; then
  echo "❌ ID count mismatch: expected $EXPECTED_IDS, got $COUNT"
  exit 1
fi

echo "Checking PARTIAL leaks..."
if printf '%s' "$HTML" | grep -q 'PARTIAL:'; then
  echo "❌ PARTIAL marker leak detected"
  exit 1
fi

echo "Checking critical anchors..."
for k in quoteForm quoteMap authPanel accountPanel providerForm regionEditorForm; do
  if ! printf '%s' "$HTML" | grep -q "id=\"$k\""; then
    echo "❌ Missing critical anchor: $k"
    exit 1
  fi
done

echo "✅ HTML checks passed"
