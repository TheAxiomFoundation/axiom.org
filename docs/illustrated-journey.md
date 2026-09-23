# Continuous encoding journey prototype

Branch: `codex/illustrated-encoding-journey`.

The first slideshow prototype was rejected. The replacement uses one persistent vector scene, with a single book and encoding card throughout the timeline. The book moves from its shelf slot, grows toward the reader, opens to §2017, and remains visible as the source. The encoding card emerges beside it, is corrected from 0.03 to 0.30, and becomes the central node as dependencies and downstream programs connect. Finally the view pulls back into a larger registry.

Scroll position controls object transforms, cover opening, and connection visibility. Scrolling backward reverses the same movement. There are no scene screenshots or mounted/unmounted chapter drawings. The caption changes at chapter boundaries, while the objects move continuously. The old raster artwork is no longer used.

One small SVG contains the scene. A passive scroll listener updates the target; time-based requestAnimationFrame interpolation stops when settled or offscreen. React updates only chapter captions and responsive layout. Narrow viewports use different object positions and scales. Reduced motion presents a static connected drawing with a text sequence of all steps.

The calculation and network are illustrative, not live registry data or a test report. No fabricated live coverage numbers are shown. Physical low-end Android/iOS performance and screen-reader testing remain release checks.
