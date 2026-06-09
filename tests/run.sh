#!/usr/bin/env bash
# Headless verification for elevation_foundation:
#   1. extract the <script> body from the HTML
#   2. node --check (syntax)
#   3. smoke-test suite (stub DOM + CPU-only pipeline)
# Usage: tests/run.sh [path/to/elevation_foundation.html]
set -euo pipefail

cd "$(dirname "$0")/.."
HTML="${1:-$(ls elevation_foundation_v*.html | sort -V | tail -1)}"
OUT=/tmp/cartalith_test
mkdir -p "$OUT"

echo "== target: $HTML"
python3 - "$HTML" "$OUT/elev.js" <<'PY'
import re, sys
html = open(sys.argv[1]).read()
js = re.findall(r'<script>(.*?)</script>', html, re.S)[0]
open(sys.argv[2], 'w').write(js)
print(f"extracted {len(js.splitlines())} lines of JS")
PY

node --check "$OUT/elev.js"
echo "== syntax OK"

cat tests/stub_head.js "$OUT/elev.js" tests/test_tail.js > "$OUT/run.js"
timeout 300 node "$OUT/run.js"
