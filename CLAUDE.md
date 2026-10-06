# Axiom

Axiom website + app (axiom.org; app.axiom-foundation.org is the retired
app host and redirects there). Deploys
to Vercel (project `axiom-foundation`, team `axiom-foundation`).

## Routing model

The proxy (`src/proxy.ts`) owns which surface serves a URL. Any two-letter
jurisdiction path (`/us/...`, `/nz/...`, `/us-co/...`) renders the **v2 app**:
browse depth (≤3 segments) → `BrowseView`, section depth → the v2 reader at
`src/app/axiom/v2/[...segments]`. Bare citation paths are canonical — never
generate `/axiom/v2/...` hrefs. The app root and marketing pages stay on v1.

## Data sources

- **Corpus text** (`corpus.current_provisions`, `navigation_nodes`): Supabase,
  read server-side. The DB is _release-pointer-based_ — it projects the single
  active signed corpus release, so contents change wholesale when a release is
  activated upstream (axiom-corpus).
- **RuleSpec encodings**: `encodings.rulespec_files` mirror first (live-synced
  from the rulespec-* repos), legacy GitHub-raw fallback second. Never add
  request-time GitHub reads to hot paths. Each mirror row's
  `source_citation_paths` records every corpus provision declared by its module
  and proof atoms, and `value_citation_paths` records the singular module source
  plus paths cited by every proof atom except `import` and `ordering`. These
  arrays are search aids. The section reader keys its **Encoded from this
  provision** group on the materialized `encodings.rule_citations` index, which
  stores one row per rule and cited provision. It fetches the first 120 rules by
  grounding rank and module path, renders every name collision with a stable
  module-qualified alias, and reports an exact rule overflow count. The
  `rulespec_files` array lookup remains only as a rollout fallback while the
  additive rule index is unavailable.
- **Encoding pipeline** (`encodings.pipeline_attempts`): one row per
  targeted re-encode dispatch, followed through its signed manifest PR (and
  what holds it: failing or cancelled checks, reviewers), the merge, the
  `rulespec_files` index (matched by commit), axiom-api's nightly compile
  sweep, its jurisdiction's validation on main (waiver-aware), and any
  axiom-oracles comparison report.
  `scripts/collect-encoding-pipeline.mjs` rebuilds it every 30 minutes from
  GitHub and Supabase (and dispatches the index sync after merges); `/ops`
  and `/ops/journey` read only the table, never GitHub at request time.
- **Program bundles** (`encodings.program_bundle_documents`): the documents of
  each delivery tier of the 13 core programs (axiom-corpus
  `manifests/program-bundles/<program>.yaml`: screener-level parity and the
  full document bundle, a federal layer `us/<program>` plus a layer per state
  `us-<st>/<program>`; a state's page and counts add the federal layer), each
  measured against the served corpus, every module's
  rules and deferrals (`rulespec_files.raw_yaml`), the RuleSpec repos'
  `known-validation-gaps.yaml` waivers and `pipeline_attempts`. A provision
  counts as encoded only when a rule cites it; a module's declared source,
  section-wide proof atoms and rule sources naming a whole section are not
  proof (they make it partly encoded). A document's provisions are the corpus
  nodes under its path and linked under it (`parent_path` misses some
  sections, and a chapter or subpart links sections outside its path), less
  any document under it in the same tier, so each provision counts once.
  `scripts/collect-program-bundles.mjs` rebuilds them every six hours in the
  pipeline collector's workflow; `/ops` (a programs × states grid) and
  `/ops/bundles/<jurisdiction>/<program>` read only the tables, and the ledger
  and journey name each encoding's bundle and tier from them.
- **Everything executable** (packages, graphs, calculate): the hosted
  axiom-api via `src/lib/axiom/runtime/api.ts`, server-side only.

## Environment variables

Dev needs `.env.local` (gitignored) with:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — copy from
  `.env.production` (`next dev` does not load `.env.production`).
- `AXIOM_RUNTIME_API_KEY` — hosted axiom-api key (server-side only; in Vercel
  env for deploys). Without it, runtime features render nothing and pages
  otherwise behave identically.
- `AXIOM_RUNTIME_API_BASE` — optional; point at a local axiom-api
  (`http://localhost:8787/v1`) to develop against unreleased endpoints. A
  keyless base override counts as configured.
- `AXIOM_OPS_PIPELINE_FILE` — optional, dev only: a collector dry run
  (`bun scripts/collect-encoding-pipeline.mjs --out <file>`) that `/ops`
  reads instead of `encodings.pipeline_attempts`.
- `AXIOM_OPS_BUNDLES_FILE` — optional, dev only: a bundle collector dry run
  (`bun scripts/collect-program-bundles.mjs --out <file>`, `--bundle <yaml>`
  for a bundle file not yet on axiom-corpus main) that `/ops/bundles` reads
  instead of the tables.
- `NEXT_PUBLIC_GRAPH_VIEWER_URL` / `NEXT_PUBLIC_BUILDER_URL` — optional
  overrides for the graph-viewer / dashboard-builder deep-link targets.

Local axiom-api (for runtime endpoint development):

```bash
cd ~/axiom-api && AXIOM_RUNTIME_SOURCE=compiled \
  AXIOM_COMPILED_PACKAGES_FILE=data/compiled-packages.current.json npm run dev
```

## Commands

- `bun run dev` — dev server (localhost:3000)
- `bun run test` — vitest (builds packages/ui first)
- `bun run build` — production build + typecheck (test files are not
  typechecked; keep fixtures in sync with types by hand)

## After pushing changes

**Always verify Vercel deploy succeeded:**

```bash
vercel ls 2>&1 | head -5
```

If status is "Error", run `bun run build` locally to see the issue.
