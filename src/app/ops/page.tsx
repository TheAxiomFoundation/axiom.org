import type { Metadata } from "next";
import { OpsDashboard } from "@/components/axiom/ops-dashboard";
import { OpsPipeline } from "@/components/axiom/ops-pipeline";
import { pipelineView } from "@/lib/axiom/encoding-pipeline";
import { getPipelineAttempts } from "@/lib/axiom/encoding-pipeline-data";
import { getCorpusView } from "@/lib/axiom/corpus-releases";
import { getEncodingQueues, queuedSummary } from "@/lib/axiom/encoding-queues";
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

export default async function OpsPage() {
  const [encodingStatus, queues, recentScopes, pipeline, corpus] = await Promise.all([
    getEncodingStatus(),
    getEncodingQueues(),
    getRecentCorpusScopes(),
    getPipelineAttempts(),
    getCorpusView(),
  ]);
  // One clock for the server render and the client's first paint.
  const referenceMs = Date.now();
  return (
    <OpsDashboard
      initialStatus={encodingStatus.value}
      encodingError={encodingStatus.error}
      queues={queues}
      recentScopes={recentScopes}
      pipeline={
        pipeline.attempts.length > 0 ? (
          <OpsPipeline
            key="pipeline"
            view={pipelineView(pipeline.attempts, referenceMs)}
            queued={queuedSummary(queues)}
            corpus={corpus}
            referenceMs={referenceMs}
          />
        ) : null
      }
    />
  );
}
