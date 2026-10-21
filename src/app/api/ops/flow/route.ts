/* v8 ignore start -- thin Next route wrapper */
import { NextResponse, type NextRequest } from "next/server";
import { agentBrief, citationLanes } from "@/lib/axiom/pipeline-flow";
import { loadFlow, parseWindow } from "@/lib/axiom/pipeline-flow-data";
import { SITE_URL } from "@/lib/urls";

export const dynamic = "force-dynamic";

/**
 * The encoding pipeline, mined from its event log, for agents and scripts.
 *
 *   GET /api/ops/flow                      stations, edges, alerts, issue ladder, ... (JSON)
 *   GET /api/ops/flow?format=md            the same as a short markdown brief
 *   GET /api/ops/flow?citation=<path>      one citation's cases, station by station
 *
 * `window` (7, 30 or 90 days) and `j` (a jurisdiction and those under it) narrow it.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const days = parseWindow(params.get("window") ?? undefined);
  const jurisdiction = params.get("j") || null;
  const { model, events, origin, error } = await loadFlow({ days, jurisdiction });
  const headers = { "Cache-Control": "no-store" };

  const citation = params.get("citation");
  if (citation) {
    return NextResponse.json({ citation, cases: citationLanes(events, citation), origin }, { headers });
  }
  if (params.get("format") === "md") {
    return new NextResponse(agentBrief(model, SITE_URL), {
      headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" },
    });
  }
  return NextResponse.json({ ...model, origin, error }, { headers });
}
/* v8 ignore stop */
