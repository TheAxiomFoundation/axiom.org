# Demo-thumb posters

Static screenshots of the surfaces the `landing-demo-thumb` pattern
embeds live on desktop (see `src/components/landing/demo-thumb.tsx`).
Off desktop, these posters render instead of the live iframes — the
live embeds crash-looped mobile Safari (reports 2026-07-25 and
2026-09-01).

Regenerate after a visual refresh of any embedded surface:

```
bunx playwright install chromium   # one-time
bun run posters:capture
```

The script (`scripts/capture-demo-posters.mjs`) records the capture
parameters — 1440x810 viewport at deviceScaleFactor 0.5 (720x405
output), network idle + 6s settle, tour modal dismissed on the app
surface — and the source URL for each poster. Current set captured
2026-09-01 from the then-live deployments. The URLs are mutable
production surfaces, so a poster records whatever was deployed at
capture time; there is no pinned source revision to reproduce from.
