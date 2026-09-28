/**
 * First-visit guided-tour flags — one per surface, persisted the same
 * way as the launcher mode: exported key builder, try/catch so
 * private mode degrades to "seen" and never nags on every visit.
 *
 * The launcher and reader tours run once per browser; the subgraph
 * tour recurs once per browsing session — its trigger (the first
 * subgraph opened this session) is session-scoped.
 */

export type TourSurface = "graph" | "subgraph" | "reader";

export const TOUR_SEEN_KEY_PREFIX = "axiom-tour-seen:";

export function tourSeenKey(surface: TourSurface): string {
  return `${TOUR_SEEN_KEY_PREFIX}${surface}`;
}

function storeFor(surface: TourSurface): Storage {
  return surface === "subgraph"
    ? window.sessionStorage
    : window.localStorage;
}

export function hasSeenTour(surface: TourSurface): boolean {
  if (typeof window === "undefined") return true;
  try {
    return storeFor(surface).getItem(tourSeenKey(surface)) === "1";
  } catch {
    // Storage unavailable — treat as seen so the tour can't reopen
    // on every page load.
    return true;
  }
}

export function markTourSeen(surface: TourSurface): void {
  if (typeof window === "undefined") return;
  try {
    storeFor(surface).setItem(tourSeenKey(surface), "1");
  } catch {
    // Private mode etc. — the flag just doesn't persist.
  }
}
