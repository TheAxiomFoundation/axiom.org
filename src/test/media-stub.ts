/* A window.matchMedia a test controls. jsdom's stub (setup.ts) answers
   only prefers-reduced-motion and never fires a change event. Answers
   here are live — a getter — so a test can narrow the window between
   timer ticks, and `set` also notifies that query's change listeners. */

export type MediaChange = { matches: boolean };
type Listener = (event: MediaChange) => void;

export function mediaStub(initial: Record<string, boolean> = {}) {
  const state = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<Listener>>();
  const impl = (query: string) => ({
    get matches() {
      return state.get(query) ?? false;
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    // A MediaQueryList only ever fires `change`; any other name is
    // a listener a browser would never call, so it is never held.
    addEventListener: (type: string, fn: Listener) => {
      if (type !== "change") return;
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      if (type !== "change") return;
      listeners.get(query)?.delete(fn);
    },
    dispatchEvent: () => false,
  });
  const set = (query: string, matches: boolean) => {
    state.set(query, matches);
    for (const fn of listeners.get(query) ?? []) fn({ matches });
  };
  return {
    impl: impl as unknown as typeof window.matchMedia,
    set,
    listeners,
  };
}
