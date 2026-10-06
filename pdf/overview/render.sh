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

# Snapshot the source first. The render and the hash stamped below both read
# this copy, so an edit saved mid-render can't produce a PDF labelled with a
# hash it wasn't rendered from.
WORK="$(mktemp -d)"
# The inlined page must sit next to the source so relative assets (the
# wordmark SVG) resolve.
TMP="$DIR/.render-inlined-$$.html"
trap 'rm -rf "$WORK" "$TMP"' EXIT
SRC="$WORK/source.html"
cp "$DIR/$BASE" "$SRC"

# Inline @import url("fonts-embed.css") so the PDF bakes in real glyphs.
python3 - "$SRC" "$DIR" "$TMP" <<'PY'
import sys, os, re
src_path, asset_dir, tmp_path = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(src_path).read()
def inline(m):
    css = open(os.path.join(asset_dir, m.group(1))).read()
    return f"/* inlined {m.group(1)} */\n{css}"
html = re.sub(r'@import\s+url\(["\']([^"\')]+)["\']\);', inline, html)
open(tmp_path, "w").write(html)
PY

# Render to a scratch file. Chrome's exit status is swallowed by the filter
# below, so check that it wrote something; $OUT is only replaced, atomically,
# once the stamped PDF exists. A failed render leaves the previous $OUT with
# its own (now stale) stamp, which the overview test catches.
RAW="$WORK/rendered.pdf"
"$CHROME" --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="$RAW" "file://$TMP" 2>&1 | grep -iE "written|error" || true
[ -s "$RAW" ] || { echo "Chrome wrote no PDF" >&2; exit 1; }

# Stamp the source HTML's SHA-256 into the PDF's metadata. The overview test
# (src/components/overview/overview.test.tsx) recomputes it from the HTML in
# the repo, so a copy change that is never re-rendered fails CI instead of
# leaving the published PDF making the old claims.
STAMP_PY='
import hashlib, os, sys, pypdf
raw, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
writer = pypdf.PdfWriter(clone_from=raw)
writer.add_metadata({"/AxiomSourceSHA256": sha})
staged = out + ".staged"
with open(staged, "wb") as f:
    writer.write(f)
os.replace(staged, out)
print("pages:", len(pypdf.PdfReader(out).pages))
print("source sha256:", sha)
'
if python3 -c "import pypdf" 2>/dev/null; then
  python3 -c "$STAMP_PY" "$RAW" "$SRC" "$OUT"
else
  uv run --quiet --with pypdf python3 -c "$STAMP_PY" "$RAW" "$SRC" "$OUT"
fi

echo "wrote $OUT"
