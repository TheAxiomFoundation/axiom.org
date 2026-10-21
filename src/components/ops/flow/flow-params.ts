import type { Population } from "@/lib/axiom/pipeline-flow";

export type FlowView = "pipeline" | "discovery" | "programs";

export interface FlowParams {
  window: number;
  j: string | null;
  /** Which cases the line counts. */
  pop: Population;
  view: FlowView;
  station: string | null;
  citation: string | null;
  case: string | null;
  program: string | null;
  bundle: string | null;
}

/** A link inside /ops/flow that keeps the window and scope and changes the rest. */
export function flowHref(params: FlowParams, change: Partial<FlowParams>): string {
  const next = { ...params, ...change };
  const q = new URLSearchParams();
  if (next.window !== 30) q.set("window", String(next.window));
  if (next.j) q.set("j", next.j);
  if (next.pop !== "all") q.set("pop", next.pop);
  if (next.view !== "pipeline") q.set("view", next.view);
  for (const key of ["station", "citation", "case", "program", "bundle"] as const) {
    const v = next[key];
    if (v) q.set(key, v);
  }
  const s = q.toString();
  return s ? `/ops/flow?${s}` : "/ops/flow";
}
