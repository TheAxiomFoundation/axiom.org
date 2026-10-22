import type { Metadata } from "next";
import type { ReactNode } from "react";
import { permanentRedirect } from "next/navigation";
import { OpsDashboard, type OpsTab } from "@/components/axiom/ops-dashboard";
import { BundleOverview } from "@/components/axiom/bundle-overview";
import { ProgramBundle } from "@/components/axiom/program-bundle";
import { PipelineLedger } from "@/components/axiom/pipeline-ledger";
import { WorkflowHealthStrip } from "@/components/axiom/workflow-health";
import { AcceptedHeadline, FlowLine, ProgramsMap } from "@/components/ops/flow/flow-page";
import flowStyles from "@/components/ops/flow/flow.module.css";
import { DEFAULT_FLOW_PARAMS, type FlowParams } from "@/components/ops/flow/flow-params";
import { OutputTab } from "@/components/ops/flow/output-tab";
import { documentTiles, programTiles } from "@/components/ops/flow/program-tiles";
import { Waivers } from "@/components/ops/flow/waivers";
import { acceptedSeries, moduleLedger } from "@/lib/axiom/accepted-modules";
import { getPipelineAttempts } from "@/lib/axiom/encoding-pipeline-data";
import { getEncodingQueues } from "@/lib/axiom/encoding-queues";
import { LEGACY_OPS_TABS, opsHref } from "@/lib/axiom/ops-href";
import { parseScope, scopeName } from "@/lib/axiom/encoding-pipeline-insights";
import { getPipelineEvents } from "@/lib/axiom/pipeline-events-data";
import type { PipelineEvent } from "@/lib/axiom/pipeline-events";
import { loadAccepted, loadFlow, parsePopulation, parseWindow } from "@/lib/axiom/pipeline-flow-data";
import { getBundleSummaries, getProgramBundle } from "@/lib/axiom/program-bundles-data";
import { getEncodingStatus, getRecentCorpusScopes, groupRecentScopes } from "@/lib/corpus-status";
import { SITE_URL } from "@/lib/urls";
import { getWorkflowHealth } from "@/lib/axiom/workflow-health";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operations - Axiom Foundation",
  description:
    "Axiom encoding operations: what runs now, where cases wait or fail on the encoding line, the modules it puts out each week, and the programs it works toward.",
  alternates: { canonical: `${SITE_URL}/ops` },
  // Internal dashboard — never index.
  robots: { index: false, follow: false },
};

/** A bundle id: a jurisdiction and a program, as in us/snap or us-az/snap. */
const BUNDLE_ID_RE = /^[a-z0-9-]+\/[a-z0-9_-]+$/;

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length < 400 ? v : null;
};

export default async function OpsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = (await searchParams) ?? {};
  const asked = one(params.tab);
  // Old links (?tab=ledger, pipeline, bundles) open the tab that took them over.
  if (asked && LEGACY_OPS_TABS[asked]) permanentRedirect(opsHref(params, LEGACY_OPS_TABS[asked]));
  const tab: OpsTab = asked === "line" || asked === "output" || asked === "programs" ? asked : "now";
  const referenceMs = Date.now();

  const [encodingStatus, recentScopes, queues] =
    tab === "now" ? await Promise.all([getEncodingStatus(), getRecentCorpusScopes(), getEncodingQueues()]) : [null, [], []];

  // Every tab carries the headline, from the event log (derived from
  // pipeline_attempts until encodings.pipeline_events is live).
  let events: PipelineEvent[];
  let panel: ReactNode = null;
  let ledger: ReactNode;
  let workflows: ReactNode;
  let starting: Parameters<typeof OpsDashboard>[0]["starting"];

  if (tab === "line") {
    const flowParams: FlowParams = {
      ...DEFAULT_FLOW_PARAMS,
      window: parseWindow(params.window),
      j: one(params.j),
      pop: parsePopulation(one(params.pop)),
      view: one(params.view) === "discovery" ? "discovery" : "pipeline",
      station: one(params.station),
    };
    const data = await loadFlow({ days: flowParams.window, jurisdiction: flowParams.j, population: flowParams.pop, now: referenceMs });
    events = data.events;
    // Jurisdictions to scope by: the busiest roots in the log.
    const roots = new Map<string, number>();
    for (const e of events) {
      if (e.station !== "dispatch" || !e.jurisdiction) continue;
      const root = e.jurisdiction.split("-")[0];
      roots.set(root, (roots.get(root) ?? 0) + 1);
    }
    const jurisdictions = [...roots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([j]) => j);
    panel = (
      <FlowLine model={data.model} origin={data.origin} targetsSeeded={data.targetsSeeded} error={data.error} params={flowParams} jurisdictions={jurisdictions} />
    );
  } else if (tab === "output") {
    events = (await getPipelineEvents()).events;
    const accepted = await loadAccepted(events, referenceMs);
    panel = <OutputTab series={accepted} ledger={accepted.modules} program={one(params.program)} />;
  } else if (tab === "programs") {
    const bundleId = one(params.bundle);
    const validBundle = bundleId && BUNDLE_ID_RE.test(bundleId) ? bundleId : null;
    const count = params.count === "provisions" ? "provisions" : "documents";
    const [eventsResult, bundles, bundle] = await Promise.all([
      getPipelineEvents(),
      getBundleSummaries(),
      validBundle ? getProgramBundle(validBundle) : null,
    ]);
    events = eventsResult.events;
    panel = (
      <>
        <ProgramsMap programs={bundle ? null : programTiles(bundles)} documents={bundle ? documentTiles(bundle.documents) : null} />
        {bundle ? (
          <ProgramBundle
            key={validBundle}
            bundle={bundle.bundle}
            documents={bundle.documents}
            snapshots={bundle.snapshots}
            available={bundle.available}
            referenceMs={referenceMs}
            initialCount={count}
          />
        ) : bundles.length ? (
          <BundleOverview bundles={bundles} initialProgram={one(params.program) ?? undefined} initialCount={count} referenceMs={referenceMs} />
        ) : (
          <p className={flowStyles.note}>No program bundles yet: encodings.program_bundles is empty or not there.</p>
        )}
        <Waivers events={events} referenceMs={referenceMs} />
      </>
    );
  } else {
    // ?j=us narrows the ledger to one jurisdiction (and those under it).
    const scope = parseScope(params);
    const [pipeline, eventsResult, health] = await Promise.all([getPipelineAttempts(), getPipelineEvents(), getWorkflowHealth()]);
    events = eventsResult.events;
    const attempts = pipeline.attempts;
    // Runs waiting for approval or in setup have no live row until their encoder starts.
    starting = {
      runs: attempts.filter((attempt) => attempt.run_status !== "completed").map((attempt) => ({ citation: attempt.citation })),
      collectedAt: attempts.reduce<string | null>((newest, attempt) => (!newest || attempt.collected_at > newest ? attempt.collected_at : newest), null),
    };
    workflows = <WorkflowHealthStrip key="workflows" workflows={health} referenceMs={referenceMs} />;
    ledger =
      attempts.length > 0 ? (
        <PipelineLedger
          key={`ledger:${scope?.jurisdiction ?? "all"}:${scope?.only ? "only" : ""}`}
          scope={scope}
          scopeName={scope ? scopeName(scope) : null}
          referenceMs={referenceMs}
        />
      ) : undefined;
  }

  // The headline counts without the program lookup (the Output tab has it).
  // Keys: React warns about elements passed as props without them.
  const headline = (
    <div key="headline" className={flowStyles.page}>
      <AcceptedHeadline series={acceptedSeries(moduleLedger(events), referenceMs)} />
    </div>
  );

  return (
    <OpsDashboard
      initialStatus={encodingStatus?.value ?? null}
      encodingError={encodingStatus?.error ?? null}
      queues={queues}
      recentPlaces={groupRecentScopes(recentScopes)}
      starting={starting}
      initialTab={tab}
      headline={headline}
      workflows={workflows}
      ledger={ledger}
      panel={panel ? <div key={`panel:${tab}`} className={flowStyles.page}>{panel}</div> : null}
    />
  );
}
