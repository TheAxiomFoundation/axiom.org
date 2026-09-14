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

## Rule workspace

The site viewer now opens on the full graph, with a bounded, one-hop Structure view available. The site-only
`rule-workspace.tsx` coordinates Read, Structure, Run, and the full
graph. Search includes all loaded rules, inputs, and relations; dependency and consumer lists
show six neighbors initially and disclose additional entries explicitly.
Source reading renders provision text inline through `/api/axiom/source`, using
the existing section resolver and text assembly. Citation links, subsection anchors,
official sources, and partial-source notices remain available without an iframe.
`selection` and `view` URL parameters restore the selected item and working view;
household facts and run results are not included in those links.

The corpus map is the default entry point; stored list/map preferences
still apply. `workspace.css` owns the responsive layout and reserves space for
the full graph's inspector. A visited canvas stays mounted and inert while hidden.
Plain node selection no longer moves the camera or implicitly opens a lens;
the existing explicit isolation action remains available.

This first implementation retains the existing input registry and run contract.
Relationship counts cover only the loaded graph, and missing neighbors stay
visible as unavailable entries. Calculation period is not presented as a law
version. Semantic grouping, path queries, comparison, and monitoring remain
future work; no layout-library migration is included.

## Library overview

`corpus-library.tsx` provides topic, rule-name, and citation search over corpus
metadata, jurisdiction filters, compact provision rows, and curated starters.
List and map receive the same filtered collection. Keeping the library mounted
preserves search, filters, pagination, and result-panel scroll when returning from a workspace.
The overview fits the viewport: the map fills remaining space and results scroll
inside their panel. Mobile filters overlay that panel; short windows hide recents.

`library-state.ts` stores recent rule selections and views in this browser; library entries open the graph, while explicit view URLs remain supported;
household facts and scenario results are never stored there. Run availability
comes from the existing runtime probe and expires after 24 hours. The capability
filter covers successful checks observed by this browser, not a corpus-wide
assertion of executability. Subject categories await reliable corpus metadata.

Structure uses two compact relationship lists beneath the selected rule context.
Run pairs the input catalog with a single household editor; the result panel
reuses those answers rather than mounting a second editor in the Run view.

Graph spacing uses three zoom bands after a 400 ms pause in user zoom.
Box centers spread at overview scale and tighten on approach, preserving the
viewport-center anchor and existing topology. Automatic camera fits do not
trigger spacing changes; hysteresis prevents threshold jitter.

Zoom is bounded between the current graph’s padded fit and 125% reading scale.
The floor follows canvas resizing and layout changes. Toolbar zoom and Fit graph
share these limits with wheel/pinch navigation.
