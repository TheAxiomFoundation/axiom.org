import type { Metadata } from "next";
import { OpsDashboard } from "@/components/axiom/ops-dashboard";
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

export default async function OpsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // ?j=us narrows the pipeline section to one jurisdiction (and those under it).
  const scope = parseScope((await searchParams) ?? {});
  // Hidden on the public site for now (see opsPipelineVisible): skip its reads too.
  const showPipeline = opsPipelineVisible();
  const [encodingStatus, queues, recentScopes, pipeline, corpus] = await Promise.all([
    getEncodingStatus(),
    getEncodingQueues(),
    getRecentCorpusScopes(),
    showPipeline ? getPipelineAttempts() : null,
    showPipeline ? getCorpusView() : null,
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
