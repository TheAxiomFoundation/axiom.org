# Graph viewer (scoped copy)

This directory started as a scoped copy of the standalone
[rulespec-graph-viewer](https://github.com/TheAxiomFoundation/rulespec-graph-viewer)
(see the header of `graph-styles.css`) and renders the same computation
graphs inside the site. There is no automated sync in either direction.

What that means in practice:

- **Shared modules** — `api.ts`, `citations.ts`, `formula.ts`, `types.ts`,
  `graph-styles.css`, `InteractiveRuleGraph.tsx` — exist in both repos, and
  the copies have already diverged (`InteractiveRuleGraph.tsx` differs;
  `formula.ts` is currently identical). A fix to shared behavior lands in
  **both** repos, as two PRs, or it quietly holds in only one.
- **Site-only modules** — `viewer-app.tsx`, `corpus-field` wiring,
  `inspector-mini-graph.tsx`, `compose-filter.ts`, `launcher-mode.ts`, the
  `subtree-*` components, and the test files — have no standalone
  counterpart; change them here only.
- The standalone repo deploys separately (manual deploy) and keeps its own
  app shell (`App.tsx`, `main.tsx`) that the site copy does not carry.

## Stylesheet order and the canvas height chain

`viewer-app.tsx` loads `styles.css`, then `graph-styles.css`, then
`plane.css`. The first two are the scoped upstream sheets; `plane.css` is
the site's own and wins every tie, which is how it pins
`.graph-viewer-root` to `100vh` and `.irg-wrap` to `min-height: 0`.

The canvas hangs from a chain of percentage heights — root → `.app-shell`
→ `.viewer-panel` → `.graph-stage` → `.irg-wrap` → `.irg-canvas` → React
Flow's inline `height: 100%`. A `height: auto` anywhere in that chain
collapses everything below it to 0px while the nodes stay in the DOM.
`styles.css` does exactly that below 900px (its stacked side-panel layout,
which this app no longer renders); `plane.css` restores the chain in its
own `≤900px` block. Below 820px `plane.css` also shows the
`.small-screen-notice` over the canvas.

Two checks guard this:

- `canvas-height.test.ts` (Vitest) resolves the real sheets, in load
  order, for the real element chain at eight widths from 1400px to 390px
  and asserts no link resolves to `auto`. `css-cascade.ts` is the small
  resolver behind it (media queries, specificity, source order — the part
  of the cascade jsdom does not evaluate).
- `bun scripts/graph-viewport-check.mjs` measures the rendered chain in
  headless Chromium (Playwright's, as the poster capture uses) against a
  running server (`--url https://axiom.org` for production) and fails
  when the canvas is under 300px or renders no nodes. Run it by hand after touching any of the three sheets: the
  expected picture at 900×971 is the graph filling the panel under the
  controls row; at 640×900 and 390×844 the notice covers a canvas that is
  still laid out underneath (the table shows `noticeShown: true` with a
  full-height `canvas`).

Cross-repo tracking:
[rulespec-graph-viewer#17](https://github.com/TheAxiomFoundation/rulespec-graph-viewer/issues/17).
The field vocabulary this viewer plugs into is documented in
[docs/corpus-field-concepts.md](../../../../docs/corpus-field-concepts.md).
