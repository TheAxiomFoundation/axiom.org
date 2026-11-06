import type { Control } from "./types";

/**
 * Of a control row already held and one the store just answered with, the one to keep: the newer.
 * A live row is newer than a not-live one, since a failed store read falls back to the default
 * run, not live, and must not flip a live room's TV to Welcome (the review of #368). Then the
 * later `updatedAt`; a row without one is the store's first, before any move. A tie goes to the
 * answer. So whatever order polls, reads and moves' answers land in, the TV and the route's cache
 * (store.ts readControl) end on the newest row, and the store keeps the newest write (store.ts
 * setControl), so that is the row the phones get.
 */
export function newerControl(current: Control | null, incoming: Control): Control {
  if (!current) return incoming;
  if (!current.live !== !incoming.live) return current.live ? current : incoming;
  return (incoming.updatedAt ?? "") < (current.updatedAt ?? "") ? current : incoming;
}
