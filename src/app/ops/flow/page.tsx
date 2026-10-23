import { permanentRedirect } from "next/navigation";
import { DEFAULT_FLOW_PARAMS, flowHref, type FlowParams } from "@/components/ops/flow/flow-params";
import { parseWindow } from "@/lib/axiom/pipeline-flow-data";

export const dynamic = "force-dynamic";

const one = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length < 400 ? v : null;
};

/**
 * /ops/flow became the /ops "Line" tab. Its old links land in the same
 * place: the line (window, scope, station, discovery) on the Line
 * tab, a citation or a run on the journey page, the programs view on the
 * Programs tab. The Line tab has no population filter, so an old `pop`
 * drops out.
 */
export default async function OpsFlowRedirect({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams) ?? {};
  const view = one(raw.view);
  const params: FlowParams = {
    ...DEFAULT_FLOW_PARAMS,
    window: parseWindow(raw.window),
    j: one(raw.j),
    view: view === "discovery" || view === "programs" ? view : "pipeline",
    station: one(raw.station),
    citation: one(raw.citation),
    case: one(raw.case),
    program: one(raw.program),
    bundle: one(raw.bundle),
  };
  if (params.bundle) params.view = "programs";
  // A window the old link named stays in the address, default or not.
  permanentRedirect(flowHref(params, {}, { keepWindow: one(raw.window) != null }));
}
