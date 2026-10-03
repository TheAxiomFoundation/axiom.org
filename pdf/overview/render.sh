#!/usr/bin/env bash
# Render an Axiom-branded HTML one-pager/brief to PDF via headless Chrome, then
# verify (page count), and stamp the source HTML's hash into the PDF metadata.
# Needs Chrome and Python with pypdf (falls back to `uv run --with pypdf`).
#
# Usage:  ./render.sh path/to/page.html [output.pdf]
#
# The HTML must sit in the same directory as fonts-embed.css and the wordmark SVG
# (copy this assets/ dir next to your page). The `@import url("fonts-embed.css")`
# line is inlined into a temp file before rendering — headless Chrome does NOT
# reliably load @import for print, so the fonts must be inline to bake into the PDF.
set -euo pipefail

HTML="${1:?usage: render.sh page.html [out.pdf]}"
OUT="${2:-${HTML%.html}.pdf}"
DIR="$(cd "$(dirname "$HTML")" && pwd)"
BASE="$(basename "$HTML")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || true)"
[ -n "$CHROME" ] || { echo "Chrome not found; set CHROME=/path/to/chrome"; exit 1; }

# Inline @import url("fonts-embed.css") so the PDF bakes in real glyphs.
TMP="$DIR/.render-inlined.html"
python3 - "$DIR/$BASE" "$TMP" <<'PY'
import sys, os, re
src_path, tmp_path = sys.argv[1], sys.argv[2]
html = open(src_path).read()
d = os.path.dirname(src_path)
def inline(m):
    css = open(os.path.join(d, m.group(1))).read()
    return f"/* inlined {m.group(1)} */\n{css}"
html = re.sub(r'@import\s+url\(["\']([^"\')]+)["\']\);', inline, html)
open(tmp_path, "w").write(html)
PY
trap 'rm -f "$TMP"' EXIT

"$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$TMP" 2>&1 | grep -iE "written|error" || true

# Stamp the source HTML's SHA-256 into the PDF's metadata. The overview test
# (src/components/overview/overview.test.tsx) recomputes it from the HTML in
# the repo, so a copy change that is never re-rendered fails CI instead of
# leaving the published PDF making the old claims.
STAMP_PY='
import hashlib, os, sys, pypdf
pdf, html = sys.argv[1], sys.argv[2]
sha = hashlib.sha256(open(html, "rb").read()).hexdigest()
writer = pypdf.PdfWriter(clone_from=pdf)
writer.add_metadata({"/AxiomSourceSHA256": sha})
with open(pdf + ".stamped", "wb") as f:
    writer.write(f)
os.replace(pdf + ".stamped", pdf)
print("pages:", len(pypdf.PdfReader(pdf).pages))
print("source sha256:", sha)
'
if python3 -c "import pypdf" 2>/dev/null; then
  python3 -c "$STAMP_PY" "$OUT" "$DIR/$BASE"
else
  uv run --quiet --with pypdf python3 -c "$STAMP_PY" "$OUT" "$DIR/$BASE"
fi

echo "wrote $OUT"
