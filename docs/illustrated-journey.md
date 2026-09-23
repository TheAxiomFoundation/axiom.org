# Illustrated encoding journey prototype

Branch: `codex/illustrated-encoding-journey`. The homepage encoder section uses the new component; the original SVG journey remains in the repository for comparison.

## Storyboard

1. Source: a law library and Title 7.
2. Provision: the excerpt from 7 USC §2017(a), with “30 per centum” highlighted.
3. Encoding: the passage beside a readable, simplified RuleSpec calculation.
4. Verification: show the incorrect coefficient, correction, and return through run/checks/compare/review. This is an illustrative sequence, not a live test report.
5. Connections: illustrative dependencies and reuse across state programs.
6. Whole: a wider field with connected and not-yet-encoded areas, without hard-coded live counts.

## Rendering and performance

The library is a pre-rendered image. All explanatory text, formulas, and cards are HTML; network connectors are lightweight SVG. Only the artwork is rasterized. The scroll listener updates a target; a time-based requestAnimationFrame follower animates opacity and transforms and stops when settled or offscreen. No WebGL, video, additional animation library, or per-frame React state updates are required. React state only changes at chapter boundaries.

Small screens receive an 800px WebP, desktop a 1600px WebP. The image is lazy-loaded and decoded asynchronously. Chapter buttons allow skipping. Reduced-motion visitors get all six static sections without scroll scrubbing. Mobile compositions stack and simplify diagrams instead of scaling down desktop typography.

This is a visual prototype: real low-end Android and iOS performance, VoiceOver/TalkBack, keyboard scrolling, and final legal/editorial review remain release checks. Browser emulation is not a replacement for device testing.

## Artwork provenance

Generated with the built-in image-generation tool. Optimized copies are `public/images/journey/library-800.webp` and `public/images/journey/library-1600.webp`.

Final generation prompt:

Use case: illustration-story. Create a premium editorial photographic illustration for Axiom's scroll-driven story about law becoming executable code. Wide 16:9 composition, no typography, no logos, no readable lettering. A quiet architectural law library, warm ivory limestone shelves and rows of tall linen-bound books in muted parchment, charcoal, and faded terracotta. In the right half foreground a single beautiful rust-orange clothbound legal volume lies on a pale stone reading table, closed, its long side angled slightly toward the viewer, tactile woven cover and fine paper edges. Left third is soft uncluttered negative space for live HTML headings. Soft directional morning light from upper left, elegant deep shadows, restrained museum editorial art direction, realistic physical materials, contemporary rather than fantasy. Eye-level close perspective with receding shelves suggesting a vast collection. No people, no candles, no gold ornaments, no digital circuitry, no text baked into the image. Restrained warm off-white and burnt sienna palette. High detail but simple composition, a single clear focal point, cinematic yet calm.
