/* The guided tour's clock, in one place. The script that checks the
   Plane's viewports derives its watch window from these numbers, so
   a change here moves that window with it. */

/** How long the tour waits for its anchored elements — the Plane's DOM
 *  appears well after mount (ssr:false, then the corpus and graph
 *  fetches). */
export const ANCHOR_WAIT_MS = 8000;

/** How often it looks. */
export const ANCHOR_POLL_MS = 250;

/** The latest a tour auto-starts after its surface mounts: with one
 *  anchor visible and another that never lands, the first poll past
 *  the wait starts it. Anything watching for a tour that must NOT open
 *  has to watch at least this long. */
export const TOUR_AUTOSTART_WINDOW_MS = ANCHOR_WAIT_MS + ANCHOR_POLL_MS;
