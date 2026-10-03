# Orrery dependency preview

The opt-in `/axiom/graph/orrery` route displays native Axiom dependencies with
the shared Orrery component. The existing `/axiom/graph` viewer stays available
with its rule lens, domain inspector, scenarios, and real Axiom execution.
No native viewer, engine, or layout implementation is copied or replaced.

Example addresses:

- `/axiom/graph/orrery?program=us-co/co-snap`
- `/axiom/graph/orrery?compose=us%3Astatutes%2F26%2F1`
- Add `&focus=<encoded exact legal ID>` for an initial one-hop dependency view.

The route reuses `fetchAllPrograms`, `fetchProgramGraph`, and
`fetchComposedGraph`, through the existing same-origin Axiom API proxy.
`fromAxiomProgramGraph` preserves native IDs, fields, and the separate rule,
input, relation, and relation-member dependency meanings. API truncation is
visible. A failed request displays an error with a native-viewer link; it never
substitutes a demo, evaluator, or stored graph.

The complete graph remains searchable. Search and type filters affect the
index; explicit dependency exploration controls the canvas neighborhood.
Selection and exploration use the shared location hash and support browser
Back/Forward. Program and compose parameters remain in the query string. A native
query focus is recorded in the initial shared hash without adding a history entry;
Back restores it, and explicit Whole graph remains whole after reload. Changing
native query focus within the same program does not re-fetch the graph.

## What remains native

The toolbar's **Open rule in Axiom** link carries the original program or compose
scope and exact rule ID in `focus`. Input and relation records retain their
stored fields and source-law link; they do not claim a native rule-lens target.
The source-law link uses Axiom's existing citation URL helper. No scenario values,
trace execution, output selection, operator dissection, or certification verdict
is inferred. Certificate references remain unverified declarations.

An existing native **file-prefix** `focus` can represent multiple rules. Orrery
initial focus accepts an exact existing graph node; a file prefix falls back to
the whole dependency graph while the **Open Axiom viewer** link preserves that
prefix for the native lens. This preview is not replacement parity for the
native execution workflow. It exposes no export button or additional sharing
policy.

## Package and validation

The integration currently consumes the explicitly supplied frozen preview archive:

- `@axiom-foundation/orrery` `0.5.0-preview.1`
- Shared source `3f603ec5d84b3623ac300162c0dce8aeca63dd1e`
- Archive SHA-256 `503511b843d1dda8d61efc5d4deba806cd9f38a2c18d8680657d6138e08c109e`
- Local pin: `vendor/axiom-foundation-orrery-0.5.0-preview.1-503511b8.tgz`

All 50 installed package files match this archive. Its compiled code is byte-identical
to the earlier integration candidate; only four packaged guides changed. Do not
replace the archive with a repack of moving source. Older diagnostic artifacts
are historical and are not the active dependency. Publication of the shared
preview and any production default change remain separate release steps.

Ten host/navigation tests and the route's TypeScript check pass. A clean checkout
of the staged source installs with the frozen lock, verifies all 50 package
files, passes those ten tests, and completes the Next 16.2.4 production build
with the application's React 19.2.5.
The unrestricted `tsc --noEmit` invocation reports existing test-file errors;
an untouched archive of upstream `master` at `324aa1bb1421840a11f98be2200281ef0777a0bc`
produces byte-identical diagnostics with the same dependencies.

Bounded WebKit validation uses the actual public Colorado SNAP ProgramGraph:
161 rules, 212 inputs, one relation, projected to 374 nodes and 445 relationships.
The local production API proxy correctly returns 503 without configuration.
The final visual test uses its existing public base override:
`AXIOM_RUNTIME_API_BASE=https://axiom.org/api/axiom`. Browser requests pass through
the real local proxy to the actual public Axiom endpoints, with no interception,
mock response, or credential access. The test checks all 374/445 native records,
index search preserving the canvas, controls below the fixed Axiom navigation,
source links, exact-rule handoff, mobile panes, and Back. An additional native-focus
regression checks initial focus → selection → Back, same-program focus changes,
and Whole graph followed by reload. These checks record zero browser
errors or warnings. This is structural inspection, not evaluation parity.

Local reports and screenshots live under `output/playwright/orrery-adoption-native-proxy/`,
`output/playwright/orrery-native-focus-history/` and `output/playwright/orrery-final-package/`;
earlier unconfigured-proxy and browser-forwarding diagnostics remain under
`output/playwright/orrery-adoption*/`
and are not release inputs. The branch was created independently from upstream
`master`; Pavel's PR #239 and native viewer files are untouched.
