# Axiom suite mock

A prototype of one Axiom brand across the five programs. Not public, not a plan. This repository is a private mirror of `TheAxiomFoundation/axiom.org` with one extra branch, `suite-mock`; nothing here is pushed to the public repository.

## Fastest spin: the offline file

Download [`mock/axiom-suite-mock.html`](mock/axiom-suite-mock.html) and open it in a browser. All twelve pages are in the one file: the suite homepage, the five line pages, the forecast log and two forecast pages, the records journal, the Microcosm release page and the simulator frame. The headline flips through the five lines; the nav works; the buttons on line pages open today's live sites.

## The live version

```bash
bun install
bun run build:ui
bunx next dev --turbopack --port 3722
```

Then open `http://localhost:3722/suite`. The same pages, plus the live PolicyEngine calculator inside `/suite/simulator/app`. Local dev needs `.env.local` copied from a working axiom.org checkout (Supabase keys); the suite pages themselves do not read Supabase.

## What is real and what is invented

Copy on the line pages is each program's own live homepage copy as of 21 Sep 2026. Figures and the depth pages come from each program's live data as of 21–22 Sep 2026 (axiom.org/coverage, chronicle.institute/api/journal, the Hugging Face release manifests, app.thesisinstitute.org/log.json, pypistats). Invented for the mock: the headline sentence and its five subjects, the five "for all" taglines, and the "cite as" box on the simulator page.
