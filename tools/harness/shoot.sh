#!/usr/bin/env bash
# Screenshot one harness scenario headlessly.
# Usage: tools/harness/shoot.sh <out.png> ["query string"] [css-width] [css-height]
# e.g.   tools/harness/shoot.sh /tmp/panel.png "select=3&popup=map"
set -euo pipefail

OUT=${1:?output png path}
QUERY=${2:-}
WIDTH=${3:-1154}
HEIGHT=${4:-744}
SCALE=${HARNESS_SCALE:-1.25}
PORT=${HARNESS_PORT:-1431}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BROWSER=${HARNESS_BROWSER:-$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | tail -1)}
if [ -z "$BROWSER" ]; then
  echo "No headless Chromium: run  npx -y playwright install chromium-headless-shell" >&2
  exit 1
fi

if ! curl -sf "http://localhost:$PORT/tools/harness/index.html" >/dev/null; then
  (cd "$ROOT" && setsid npx vite --port "$PORT" --strictPort >"${TMPDIR:-/tmp}/tetra-harness-vite.log" 2>&1 &)
  for _ in $(seq 1 100); do
    curl -sf "http://localhost:$PORT/tools/harness/index.html" >/dev/null && break
    sleep 0.2
  done
fi

"$BROWSER" --no-sandbox --disable-gpu --hide-scrollbars=false \
  --force-device-scale-factor="$SCALE" --window-size="$WIDTH,$HEIGHT" \
  --virtual-time-budget="${HARNESS_BUDGET:-10000}" --run-all-compositor-stages-before-draw \
  --enable-logging=stderr --log-level=0 \
  --screenshot="$OUT" "http://localhost:$PORT/tools/harness/index.html?$QUERY" 2>"${OUT%.png}.log" >/dev/null
grep -E "CONSOLE|harness" "${OUT%.png}.log" | grep -v "Download the React DevTools" >&2 || true
echo "$OUT"
