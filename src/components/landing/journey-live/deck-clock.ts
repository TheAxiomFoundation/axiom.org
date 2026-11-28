// The deck's clock: which step a moment belongs to, and the rest a "next"
// or a "back" goes to (the rests are layout.ts REST_AT). Pure, so the deck and its tests share it.

/** How far before a step's start its words begin to take over. */
export const REST_LEAD = 0.25;

/** The step (0-based) that is on screen at clock `s`. */
export function stepAt(starts: readonly number[], s: number): number {
  let now = 0;
  for (let j = 1; j < starts.length; j++) if (s >= starts[j] - REST_LEAD / 2) now = j;
  return now;
}

/** The stop a "next" goes to from `s`: the first rest after it. */
export function nextStop(stops: readonly number[], s: number, eps = 0.01): number {
  for (const at of stops) if (at > s + eps) return at;
  return stops[stops.length - 1];
}

/** The stop a "back" goes to from `s`: the last rest before it, or the
 *  start of the story. */
export function prevStop(stops: readonly number[], s: number, eps = 0.01): number {
  let at = 0;
  for (const x of stops) if (x < s - eps) at = x;
  return at;
}
