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
