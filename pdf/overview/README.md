# Overview PDF

Print source for the downloadable version of [/overview](../../src/app/overview/page.tsx).
Built with the `axiom-pdf` pipeline: self-contained HTML rendered by headless
Chrome, with Geist / Geist Mono / Newsreader embedded so the PDF carries real
glyphs and never falls back to a system font.

## Rebuild

```bash
./render.sh axiom-overview.html
cp axiom-overview.pdf ../../public/Axiom-Foundation-Overview.pdf
```

`render.sh` prints the page count. **This is a one-pager and must stay one
page** — the site's download button literally says "Download 1-Page PDF". If a
copy change spills to a second page, trim until it fits rather than shipping a
page that carries only the sign-off.

## Keeping the two surfaces in sync

The web page and this file are deliberately different documents, not one source
rendered twice. The page has room to breathe: full audience write-ups behind a
switcher, the preview applications, and per-section calls to action. The PDF is
the compressed leave-behind — one sentence per audience, no previews, three
one-line CTAs. They share their *claims*, and the web copy lives in one place —
[`overview-content.ts`](../../src/components/overview/overview-content.ts).
**When a claim changes there, change it here too**, and re-render.

## Files

| File | What it is |
|---|---|
| `axiom-overview.html` | The document. Edit this. |
| `axiom-overview.pdf` | Render output — **gitignored**. Copy to `public/` to publish; that copy is the one in version control. |
| `fonts-embed.css` | Base64 Geist / Geist Mono / Newsreader. Don't edit; refresh from the `axiom-pdf` skill. |
| `axiom-full-w350-gradient.svg` | Kit wordmark, full lockup. Never retype the wordmark in a live font. |
| `render.sh` | Inlines the font CSS, renders via headless Chrome, reports pages. |

## Deviations from the shared template

All to close the document on one page, all noted inline in the `<style>` block.
The 11pt body floor is untouched throughout.

- Leading pulled from 1.47 to 1.42. Block margins are otherwise at or above the
  template's, since section separation is what makes a dense page readable.
- Page margin 0.5in top/bottom instead of 0.6in — still inside every printer's
  safe area. **Spend recovered space here first**: if the page needs to shrink,
  the outer margin is a better donor than the gaps between sections.
- `break-before:avoid` released on `hr` / `.sig`. Avoid putting a
  `break-inside:avoid` block (`.risk`, `.note`) in the tail: it drags the whole
  sign-off to a fresh page even with most of a page still free. That is why the
  closing organization line is a plain `<p>`.
- `.lead a strong` re-asserts the accent colour. `.lead strong` (class +
  element) outranks the template's `a strong` (element + element), so a bold run
  inside a link silently renders ink instead of amber.
