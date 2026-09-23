# 3D encoding journey — opening study

Branch: `codex/illustrated-encoding-journey`.

The SVG prototypes have been replaced. This iteration deliberately focuses on the shelf → volume → open provision sequence before extending the rest of the pipeline story.

## Rendering

A lazy-loaded Three.js WebGL scene uses actual shelf and book geometry. Title 7 starts in a shelf slot, pulls forward before turning, and opens a hinged clothbound cover. A curved reading page, page-edge texture, directional shadows, and a moving perspective camera give it depth. Materials are generated once with Canvas2D; no SVG or downloaded image sequence is used. Readable HTML preserves the excerpt outside the canvas.

## Performance and accessibility

The Three.js module loads within 500px of the section. Rendering stops when movement settles, the section is offscreen, or the document is hidden. Pixel ratio is capped at 1.5. A sustained slow CPU frame-submission measurement reduces resolution to 1 and disables shadows; this is a heuristic, not a GPU benchmark or a guarantee of device frame rate. Geometry/materials are shared and disposed on unmount. Textures use bounded resolution and anisotropy.

Reduced motion skips the 3D renderer and shows an HTML source view. WebGL startup/context failure falls back to that readable view. Portrait camera distance fits the right page; desktop shows the full spread. No scroll interception.

## Verification

Production build and 11 focused tests pass. Browser checks cover desktop and 390×844 phone framing, one canvas/zero SVGs inside the scene, and stopping renders at rest. Tests cover lazy renderer startup, cleanup, WebGL failure, and reduced motion. Physical low-end device testing remains required before release.

## Remaining design work

This is an opening motion/material study, not a completed six-stage pipeline replacement. Continue with the excerpt becoming an encoding, the verification/redraft loop, shared dependencies, and the full graph after the opening quality is accepted. Preserve the citation throughout. Subsequent diagrams and numbers must distinguish illustrative content from live data.
