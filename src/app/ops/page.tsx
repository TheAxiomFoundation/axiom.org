import type { Metadata } from "next";
import { OpsDashboard } from "@/components/axiom/ops-dashboard";
import { BundleOverview } from "@/components/axiom/bundle-overview";
import { ProgramBundle } from "@/components/axiom/program-bundle";
import { OpsPipeline } from "@/components/axiom/ops-pipeline";
import { PipelineLedger } from "@/components/axiom/pipeline-ledger";
import { pipelineView } from "@/lib/axiom/encoding-pipeline";
import { getPipelineAttempts } from "@/lib/axiom/encoding-pipeline-data";
import { getCorpusView, scopeCorpus } from "@/lib/axiom/corpus-releases";
import { getEncodingQueues, queuedSummary, scopeQueued } from "@/lib/axiom/encoding-queues";
import {
  attemptJurisdiction,
  inScope,
  parseScope,
  pipelineInsights,
  rootJurisdiction,
  scopeName,
  scopeOptions,
} from "@/lib/axiom/encoding-pipeline-insights";
import { opsPipelineVisible } from "@/lib/axiom/ops-pipeline-visibility";
import { dispatchFlow, encodeParts, runRows, stepTimes, testsParts } from "@/lib/axiom/encoding-pipeline-runs";
import { getBundleSummaries, getProgramBundle } from "@/lib/axiom/program-bundles-data";
import { getEncodingStatus, getRecentCorpusScopes } from "@/lib/corpus-status";
import { SITE_URL } from "@/lib/urls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operations - Axiom Foundation",
  description:
    "Live view of Axiom encoding activity: what machines are encoding now and the newest encodings by document and section.",
  alternates: { canonical: `${SITE_URL}/ops` },
  // Internal dashboard — never index.
  robots: { index: false, follow: false },
};

/** A bundle id: a jurisdiction and a program, as in us/snap or us-az/snap. */
const BUNDLE_ID_RE = /^[a-z0-9-]+\/[a-z0-9_-]+$/;

export default async function OpsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // ?j=us narrows the pipeline section to one jurisdiction (and those under it).
  const params = (await searchParams) ?? {};
  const scope = parseScope(params);
  // ?tab=bundles or ?tab=pipeline opens that section; the ledger otherwise.
  const tab = params.tab === "bundles" || params.tab === "pipeline" ? params.tab : "ledger";
  // ?bundle=us-az/snap opens that bundle's page in the bundles tab (&count=provisions in that count);
  // ?program=snap opens the tab's grid on that program.
  const bundleId = typeof params.bundle === "string" && BUNDLE_ID_RE.test(params.bundle) ? params.bundle : null;
  const count = params.count === "provisions" ? "provisions" : "documents";
  const program = typeof params.program === "string" ? params.program : undefined;
  // Hidden on the public site for now (see opsPipelineVisible): skip its reads too.
  const showPipeline = opsPipelineVisible();
  const [encodingStatus, queues, recentScopes, pipeline, corpus, bundles, bundle] = await Promise.all([
    getEncodingStatus(),
    getEncodingQueues(),
    getRecentCorpusScopes(),
    showPipeline ? getPipelineAttempts() : null,
    showPipeline ? getCorpusView() : null,
    showPipeline ? getBundleSummaries() : [],
    showPipeline && bundleId ? getProgramBundle(bundleId) : null,
  ]);
  // One clock for the server render and the client's first paint.
  const referenceMs = Date.now();
  const keep = (jurisdiction: string) => inScope(jurisdiction, scope);
  const attempts = pipeline?.attempts ?? [];
  const scoped = attempts.filter((attempt) => keep(attemptJurisdiction(attempt)));
  const runs = runRows(scoped);
  return (
    <OpsDashboard
      initialStatus={encodingStatus.value}
      encodingError={encodingStatus.error}
      queues={queues}
      recentScopes={recentScopes}
      bundles={
        bundle ? (
          <ProgramBundle
            key={bundleId}
            bundle={bundle.bundle}
            documents={bundle.documents}
            available={bundle.available}
            referenceMs={referenceMs}
            initialCount={count}
          />
        ) : bundles.length ? (
          <BundleOverview bundles={bundles} initialProgram={program} initialCount={count} />
        ) : undefined
      }
      initialTab={tab}
      // With the pipeline shown, the ledger is built from every run rather
      // than the encoder's own records, and follows the page's scope.
      ledger={
        attempts.length > 0 ? (
          <PipelineLedger
            key={`ledger:${scope?.jurisdiction ?? "all"}:${scope?.only ? "only" : ""}`}
            scope={scope}
            scopeName={scope ? scopeName(scope) : null}
            referenceMs={referenceMs}
          />
        ) : undefined
      }
      pipeline={
        attempts.length > 0 ? (
          <OpsPipeline
            key={`pipeline:${scope?.jurisdiction ?? "all"}:${scope?.only ? "only" : ""}`}
            view={pipelineView(scoped, referenceMs)}
            insights={pipelineInsights(scoped, referenceMs)}
            scope={scope}
            scopes={scopeOptions(attempts, scope)}
            queued={scopeQueued(queuedSummary(queues), keep)}
            corpus={corpus && scopeCorpus(corpus, scope ? rootJurisdiction(scope.jurisdiction) : null)}
            // Counts only: the runs behind each part load on demand from /ops/runs.
            flow={dispatchFlow(runs).map((gate) => ({
              ...gate,
              segments: gate.segments.map((segment) => ({ ...segment, ids: [] })),
            }))}
            times={stepTimes(runs, referenceMs)}
            parts={encodeParts(runs)}
            testParts={testsParts(runs)}
            referenceMs={referenceMs}
          />
        ) : null
      }
    />
  );
}
