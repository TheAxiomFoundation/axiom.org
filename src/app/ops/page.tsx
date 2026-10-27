import type { Metadata } from "next";
import type { ReactNode } from "react";
import { permanentRedirect } from "next/navigation";
import { OpsDashboard, type OpsTab } from "@/components/axiom/ops-dashboard";
import { BundleOverview } from "@/components/axiom/bundle-overview";
import { ProgramBundle } from "@/components/axiom/program-bundle";
import { PipelineLedger } from "@/components/axiom/pipeline-ledger";
import { FlowLine } from "@/components/ops/flow/flow-page";
import flowStyles from "@/components/ops/flow/flow.module.css";
import { DEFAULT_FLOW_PARAMS, type FlowParams } from "@/components/ops/flow/flow-params";
import { getPipelineAttempts } from "@/lib/axiom/encoding-pipeline-data";
import { getEncodingQueues } from "@/lib/axiom/encoding-queues";
import { busiestRoots, LEGACY_OPS_TABS, opsHref, sharedOpsParams } from "@/lib/axiom/ops-href";
import { attemptJurisdiction, parseScope } from "@/lib/axiom/encoding-pipeline-insights";
import { loadFlow, parseWindow } from "@/lib/axiom/pipeline-flow-data";
import { getBundleSummaries, getProgramBundle } from "@/lib/axiom/program-bundles-data";
import { getEncodingStatus, getRecentCorpusScopes, groupRecentScopes } from "@/lib/corpus-status";
import { SITE_URL } from "@/lib/urls";

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
  const tab: OpsTab = asked === "line" || asked === "programs" ? asked : "now";
  const referenceMs = Date.now();

  const [encodingStatus, recentScopes, queues] =
    tab === "now" ? await Promise.all([getEncodingStatus(), getRecentCorpusScopes(), getEncodingQueues()]) : [null, [], []];

  let panel: ReactNode = null;
  let ledger: ReactNode;
  let starting: Parameters<typeof OpsDashboard>[0]["starting"];

  if (tab === "line") {
    const flowParams: FlowParams = {
      ...DEFAULT_FLOW_PARAMS,
      window: parseWindow(params.window),
      j: one(params.j),
      view: "pipeline",
      station: one(params.station),
    };
    // The Line tab counts every case: it has no population filter.
    const data = await loadFlow({ days: flowParams.window, jurisdiction: flowParams.j, now: referenceMs });
    // Jurisdictions to scope by: the busiest roots among dispatches.
    const jurisdictions = busiestRoots(data.events.filter((e) => e.station === "dispatch").map((e) => e.jurisdiction));
    panel = (
      <FlowLine model={data.model} error={data.error} params={flowParams} jurisdictions={jurisdictions} />
    );
  } else if (tab === "programs") {
    const bundleId = one(params.bundle);
    const validBundle = bundleId && BUNDLE_ID_RE.test(bundleId) ? bundleId : null;
    const count = params.count === "provisions" ? "provisions" : "documents";
    const [bundles, bundle] = await Promise.all([
      getBundleSummaries(),
      validBundle ? getProgramBundle(validBundle) : null,
    ]);
    panel = (
      <>
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
      </>
    );
  } else {
    // ?j=us narrows the ledger to one jurisdiction (and those under it).
    const scope = parseScope(params);
    const pipeline = await getPipelineAttempts();
    const attempts = pipeline.attempts;
    // Runs waiting for approval or in setup have no live row until their encoder starts.
    starting = {
      runs: attempts.filter((attempt) => attempt.run_status !== "completed").map((attempt) => ({ citation: attempt.citation })),
      collectedAt: attempts.reduce<string | null>((newest, attempt) => (!newest || attempt.collected_at > newest ? attempt.collected_at : newest), null),
    };
    // The ledger's scope: All, or one of the busiest roots (and those under it).
    const roots = busiestRoots(attempts.map((attempt) => attemptJurisdiction(attempt)));
    ledger =
      attempts.length > 0 ? (
        <PipelineLedger key="ledger" scope={scope} roots={roots} referenceMs={referenceMs} />
      ) : undefined;
  }


  return (
    <OpsDashboard
      initialStatus={encodingStatus?.value ?? null}
      encodingError={encodingStatus?.error ?? null}
      queues={queues}
      recentPlaces={groupRecentScopes(recentScopes)}
      starting={starting}
      initialTab={tab}
      shared={sharedOpsParams(params)}
      ledger={ledger}
      panel={panel ? <div key={`panel:${tab}`} className={flowStyles.page}>{panel}</div> : null}
    />
  );
}
