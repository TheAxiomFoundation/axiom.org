/* The Plane's small-screen boundary, in one place.

   At and below this width plane.css shows the "needs a bigger screen"
   notice over the canvas, and the Plane's tours must not start —
   a tour card floating over that notice would walk a phone visitor
   through nodes they cannot see. The sheet cannot import a constant,
   so canvas-height.test.ts checks that its notice block carries
   exactly this query; plane-tour.tsx reads it directly. */
export const PLANE_SMALL_SCREEN_MAX_WIDTH = 820;

export const PLANE_SMALL_SCREEN_QUERY = `(max-width: ${PLANE_SMALL_SCREEN_MAX_WIDTH}px)`;
