export type FlowView = "pipeline" | "programs";

export interface FlowParams {
  window: number;
  j: string | null;
  view: FlowView;
  station: string | null;
  citation: string | null;
  case: string | null;
  program: string | null;
  bundle: string | null;
}

export const DEFAULT_FLOW_PARAMS: FlowParams = {
  window: 30,
  j: null,
  view: "pipeline",
  station: null,
  citation: null,
  case: null,
  program: null,
  bundle: null,
};

/**
 * A link from the line that keeps the window and scope and changes the rest.
 * The line is the /ops "Line" tab; a citation (and one run of it) opens the
 * journey drill-down; the programs view is the /ops "Programs" tab.
 * `keepWindow` keeps the window in the address even at its default.
 */
export function flowHref(params: FlowParams, change: Partial<FlowParams>, options: { keepWindow?: boolean } = {}): string {
  const next = { ...params, ...change };
  const q = new URLSearchParams();
  if (next.citation) {
    q.set("citation", next.citation);
    if (next.case) q.set("case", next.case);
    return `/ops/journey?${q}`;
  }
  if (next.view === "programs") {
    q.set("tab", "programs");
    if (next.bundle) q.set("bundle", next.bundle);
    else if (next.program) q.set("program", next.program);
    return `/ops?${q}`;
  }
  q.set("tab", "line");
  // The default window drops out, unless an old link named it (keepWindow).
  if (next.window !== 30 || options.keepWindow) q.set("window", String(next.window));
  if (next.j) q.set("j", next.j);
  if (next.station) q.set("station", next.station);
  return `/ops?${q}`;
}
