# The 3D encoding journey

Branch: `codex/illustrated-encoding-journey`.

## Story and continuity

One Three.js scene covers the complete sequence: library, extracted volume, open provision, lifted passage becoming a rule, failed comparison and correction, connected dependencies/programs, and a pullback to the wider corpus. The source book and the rule persist as the camera moves. Scrolling backward reverses the same scene state.

The opening uses a hinged clothbound book and curved reading page. The highlighted passage lifts into a plaque; its two faces blend into the RuleSpec representation. Verification changes the coefficient from 0.03 to 0.30 before repeating comparison and review. At graph scale the formula blends into a simpler name/citation face. Lines connect card edges behind their text. The library recedes through atmospheric depth as the graph grows.

This is an illustrative sequence, not a live execution trace. The formula is simplified. The program relationships and wider graph illustrate reuse and unfinished coverage; they are not presented as live counts or verified dependency data.

## Performance

The renderer is dynamically imported only near the section. One WebGL canvas, no SVG or image sequence. Geometry and textures are shared; shelf books are batched with instanced meshes, and the larger corpus uses two instanced fields and one line buffer. Canvas2D generates bounded textures once. Labels, formulas, and explanatory copy also have readable HTML representations.

Animation stops when settled, offscreen, or the document is hidden. Pixel ratio is capped at 1.5. Sustained slow frame submission lowers resolution to 1 and disables shadows. This is a CPU submission heuristic, not a GPU timing guarantee. All resources are disposed on unmount. Physical low-end device benchmarking remains a release check.

## Responsive and accessible behavior

Portrait framing fits the source page, stacks dependencies/programs, and enlarges the central rule label when the graph appears. Chapter buttons keep descriptive accessible names even when mobile shows only numbers. Reduced-motion visitors and very short viewports get the source excerpt and the entire story as HTML, without creating a WebGL context. WebGL failure uses the same complete static story. The page scroll remains native.

## Verification

All 13 focused tests and the production build pass. Focused tests cover renderer lazy startup/disposal, WebGL failure, reduced-motion story completeness, chapter destinations in both directions, and the order of verification states. Browser review covers opening, encoding, correction, connected graph, and final graph at desktop and portrait sizes. Build checks are run before committing.
