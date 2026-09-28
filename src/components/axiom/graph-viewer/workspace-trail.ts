/**
 * The workspace's navigation trail, kept in step with the browser's
 * history: every step is a real history entry, so the browser's back
 * and forward walk exactly what the workspace's Back button walks.
 *
 * Entries are matched by URL, never by history.state — Next.js rewrites
 * an entry's state when the page loads and when the router traverses
 * back or forward, so anything stored there is gone by the time it is
 * needed. Arriving on a URL (back, forward, reload) is resolved against
 * the trail: the last past entry means back, the next future entry
 * means forward, the current one means a reload, anything else starts
 * a fresh trail.
 */

export type TrailView = "read" | "structure" | "run" | "map";

export interface TrailLocation {
  id: string;
  view: TrailView;
  trail: string[];
}

export interface TrailEntry extends TrailLocation {
  url: string;
}

export interface Trail {
  past: TrailEntry[];
  current: TrailEntry | null;
  future: TrailEntry[];
}

export const EMPTY_TRAIL: Trail = { past: [], current: null, future: [] };

/** A URL as the trail compares it: the source reader's own entries
 *  (?source=) and fragments belong to the location they open from. */
export function trailUrl(href: string): string {
  const url = new URL(href, "http://axiom.invalid");
  url.searchParams.delete("source");
  return `${url.pathname}?${url.searchParams.toString()}`;
}

/** The URL a location is written at: the current URL with its
 *  selection and view, the source reader's reference dropped. */
export function locationHref(location: TrailLocation, href: string): string {
  const url = new URL(href);
  url.searchParams.delete("source");
  url.searchParams.set("selection", location.id);
  url.searchParams.set("view", location.view);
  url.hash = "";
  return url.toString();
}

/** A new step: the current entry moves behind it, and whatever was
 *  ahead (after going back) is dropped, as the browser drops it. */
export function pushStep(trail: Trail, next: TrailEntry): Trail {
  return {
    past: trail.current ? [...trail.past, trail.current] : trail.past,
    current: next,
    future: [],
  };
}

/** A correction to the current step (the graph settling, a refused
 *  view): same position, new location. */
export function replaceStep(trail: Trail, next: TrailEntry): Trail {
  return { ...trail, current: next };
}

/** Arriving on `href`: which step it is, and the trail around it. */
export function arrive(trail: Trail, href: string): { trail: Trail; entry: TrailEntry | null } {
  const url = trailUrl(href);
  if (trail.current && trailUrl(trail.current.url) === url) {
    return { trail, entry: trail.current };
  }
  const previous = trail.past.at(-1);
  if (previous && trailUrl(previous.url) === url) {
    return {
      trail: {
        past: trail.past.slice(0, -1),
        current: previous,
        future: trail.current ? [...trail.future, trail.current] : trail.future,
      },
      entry: previous,
    };
  }
  const next = trail.future.at(-1);
  if (next && trailUrl(next.url) === url) {
    return {
      trail: {
        past: trail.current ? [...trail.past, trail.current] : trail.past,
        current: next,
        future: trail.future.slice(0, -1),
      },
      entry: next,
    };
  }
  return { trail: EMPTY_TRAIL, entry: null };
}

const STORAGE_PREFIX = "axiom:workspace-trail:";

/** One trail per graph per tab: survives a reload, never leaks into
 *  another tab. Storage can be unavailable — then a reload starts a
 *  fresh trail. */
export function loadTrail(key: string): Trail {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    const parsed = raw ? (JSON.parse(raw) as Partial<Trail>) : null;
    if (!parsed || !Array.isArray(parsed.past) || !Array.isArray(parsed.future)) return EMPTY_TRAIL;
    return { past: parsed.past, current: parsed.current ?? null, future: parsed.future };
  } catch {
    return EMPTY_TRAIL;
  }
}

export function saveTrail(key: string, trail: Trail): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(trail));
  } catch {
    // Storage full or blocked: the in-memory trail still works.
  }
}
