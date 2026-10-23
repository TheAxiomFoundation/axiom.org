/* v8 ignore start -- thin Next route wrapper */
import { NextResponse, type NextRequest } from "next/server";
import { acceptedBrief } from "@/lib/axiom/accepted-modules";
import { agentBrief, citationLanes } from "@/lib/axiom/pipeline-flow";
import { getCitationEvents, getPipelineEvents } from "@/lib/axiom/pipeline-events-data";
import { getAcceptedHeadline, loadAccepted, loadFlow, parsePopulation, parseWindow } from "@/lib/axiom/pipeline-flow-data";
import { SITE_URL } from "@/lib/urls";

export const dynamic = "force-dynamic";

/**
 * The encoding pipeline, mined from its event log, for agents and scripts.
 *
 *   GET /api/ops/flow                      stations, edges, alerts, issue ladder, ... (JSON)
 *   GET /api/ops/flow?format=md            the same as a short markdown brief
 *   GET /api/ops/flow?citation=<path>      one citation's cases, station by station
 *   GET /api/ops/flow?accepted             only the weekly strict-accepted module
 *                                          count, by route and program (the
 *                                          roadmap flow model's input); the
 *                                          full JSON and the brief carry the
 *                                          cached headline without programs
 *
 * `window` (7, 30 or 90 days), `j` (a jurisdiction and those under it) and
 * `pop` (all, runs, prs, modules: which cases the line counts) narrow it.
 * The accepted count ignores them: it is the whole history, every case.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const headers = { "Cache-Control": "no-store" };

  // One citation, or the accepted series: each reads only what it needs.
  const citation = params.get("citation");
  if (citation) {
    const { events, origin } = await getCitationEvents(citation);
    return NextResponse.json({ citation, cases: citationLanes(events, citation), origin }, { headers });
  }
  if (params.has("accepted")) {
    const { events, origin } = await getPipelineEvents();
    return NextResponse.json({ accepted: await loadAccepted(events), origin }, { headers });
  }

  const days = parseWindow(params.get("window") ?? undefined);
  const jurisdiction = params.get("j") || null;
  const [{ model, origin, error }, accepted] = await Promise.all([
    loadFlow({ days, jurisdiction, population: parsePopulation(params.get("pop")) }),
    // The cached headline: totals and weeks, without the program lookup
    // (?accepted has the programs).
    getAcceptedHeadline(),
  ]);
  if (params.get("format") === "md") {
    return new NextResponse(`${agentBrief(model, SITE_URL)}\n${acceptedBrief(accepted, { programs: false })}`, {
      headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" },
    });
  }
  return NextResponse.json({ ...model, accepted, origin, error }, { headers });
}
/* v8 ignore stop */
