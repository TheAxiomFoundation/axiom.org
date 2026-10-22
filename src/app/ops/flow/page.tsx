import type { Metadata } from "next";
import { FlowPage, flowHref, type FlowParams, type FlowView } from "@/components/ops/flow/flow-page";
import type { DocumentTile, ProgramTile } from "@/components/ops/flow/level-canvases";
import { caseDetail, citationLanes } from "@/lib/axiom/pipeline-flow";
import { acceptedSeries, moduleLedger } from "@/lib/axiom/accepted-modules";
import { loadFlow, parsePopulation, parseWindow } from "@/lib/axiom/pipeline-flow-data";
import { getBundleSummaries, getProgramBundle, type BundleSummary } from "@/lib/axiom/program-bundles-data";
import { distinctByDocument } from "@/lib/axiom/program-bundles";
import { SITE_URL } from "@/lib/urls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Encoding flow - Axiom Foundation",
  description: "The encoding pipeline as a live, zoomable flow: stations, throughput, yield, waiting, loops and alerts, mined from the pipeline event log.",
  alternates: { canonical: `${SITE_URL}/ops/flow` },
  // Internal dashboard — never index.
  robots: { index: false, follow: false },
};

const VIEWS: FlowView[] = ["pipeline", "discovery", "programs"];

function one(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length < 400 ? v : null;
}

export default async function OpsFlowPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams) ?? {};
  const view = one(raw.view) as FlowView | null;
  const params: FlowParams = {
    window: parseWindow(raw.window),
    j: one(raw.j),
    pop: parsePopulation(one(raw.pop)),
    view: view && VIEWS.includes(view) ? view : "pipeline",
    station: one(raw.station),
    citation: one(raw.citation),
    case: one(raw.case),
    program: one(raw.program),
    bundle: one(raw.bundle),
  };
  if (params.bundle) params.view = "programs";

  const [data, summaries, bundle] = await Promise.all([
    loadFlow({ days: params.window, jurisdiction: params.j, population: params.pop }),
    params.view === "programs" && !params.bundle ? getBundleSummaries() : Promise.resolve(null),
    params.bundle ? getProgramBundle(params.bundle) : Promise.resolve(null),
  ]);

  // Jurisdictions to scope by: the busiest roots in the log.
  const roots = new Map<string, number>();
  for (const e of data.events) {
    if (e.station !== "dispatch" || !e.jurisdiction) continue;
    const root = e.jurisdiction.split("-")[0];
    roots.set(root, (roots.get(root) ?? 0) + 1);
  }
  const jurisdictions = [...roots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([j]) => j);

  // The headline needs no programs, so no bundle lookup: the API has those.
  const accepted = acceptedSeries(moduleLedger(data.events));
  const detail = params.case ? caseDetail(data.events, params.case) : null;
  const lanes = !detail && params.citation ? citationLanes(data.events, params.citation) : null;

  const programs = summaries ? programTiles(summaries, params) : null;
  const documents = bundle
    ? distinctByDocument(bundle.documents.filter((d) => d.tier === "full").length ? bundle.documents.filter((d) => d.tier === "full") : bundle.documents).map(
        (d): DocumentTile => {
          const citation = d.latest_citation ?? d.citation_path;
          return {
            key: d.key,
            name: d.name,
            part: d.part,
            status: d.status ?? "not_started",
            provisions: d.provisions,
            encoded: d.encoded_provisions + d.unvalidated_provisions,
            runs: d.runs,
            href: citation ? flowHref(params, { citation, view: "pipeline", bundle: null }) : null,
          };
        }
      )
    : null;

  return (
    <FlowPage
      model={data.model}
      accepted={accepted}
      origin={data.origin}
      targetsSeeded={data.targetsSeeded}
      error={data.error}
      params={params}
      jurisdictions={jurisdictions}
      lanes={lanes}
      detail={detail}
      programs={programs}
      documents={documents}
      bundleTitle={bundle?.bundle?.title ?? null}
    />
  );
}

/**
 * A tile per program and a tile per bundle. A state's stored counts add the
 * federal layer; the tile takes it back out, so each tile shows its own
 * layer and the program's total counts every document once.
 */
function programTiles(summaries: BundleSummary[], params: FlowParams): ProgramTile[] {
  const own = (b: BundleSummary, federal: BundleSummary | undefined) => {
    const full = b.counts.full;
    const fed = federal && federal.id !== b.id ? federal.counts.full : undefined;
    const provisions = (full?.provisions ?? 0) - (fed?.provisions ?? 0);
    const done = (s: typeof full) => (s?.byProvisionState?.encoded ?? 0) + (s?.byProvisionState?.unvalidated ?? 0);
    return { provisions: Math.max(0, provisions), done: Math.max(0, done(full) - done(fed)) };
  };
  const byProgram = new Map<string, BundleSummary[]>();
  for (const b of summaries) byProgram.set(b.program, [...(byProgram.get(b.program) ?? []), b]);
  return [...byProgram.entries()]
    .map(([program, list]) => {
      const federal = list.find((b) => b.jurisdiction === "us");
      const bundles = list
        .sort((a, b) => (a === federal ? -1 : b === federal ? 1 : a.jurisdiction.localeCompare(b.jurisdiction)))
        .map((b) => {
          const m = own(b, federal);
          return {
            id: b.id,
            label: b === federal ? "Federal" : b.jurisdiction.replace(/^us-/, "").toUpperCase(),
            done: m.done,
            documents: m.provisions,
            href: flowHref(params, { view: "programs", bundle: b.id }),
          };
        });
      const documents = bundles.reduce((s, b) => s + b.documents, 0);
      const done = bundles.reduce((s, b) => s + b.done, 0);
      const title = (federal?.title ?? program).split(":")[0];
      return { id: program, title, bundles, documents, done, href: flowHref(params, { view: "programs", bundle: federal?.id ?? list[0].id }) };
    })
    .sort((a, b) => b.documents - a.documents);
}
