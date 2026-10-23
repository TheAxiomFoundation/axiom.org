import type { Metadata } from "next";
import { PipelineJourney } from "@/components/axiom/pipeline-journey";
import { citationJourney, dependentHostId, hostCitations } from "@/lib/axiom/encoding-pipeline";
import { getPipelineAttempts } from "@/lib/axiom/encoding-pipeline-data";
import { bundleMemberships } from "@/lib/axiom/program-bundles";
import { getBundleIndex } from "@/lib/axiom/program-bundles-data";
import { SITE_URL } from "@/lib/urls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Encoding journey - Axiom Foundation",
  description:
    "One citation's path through the encoding pipeline: every dispatch, its PR, the merge, the index, and the compile check.",
  alternates: { canonical: `${SITE_URL}/ops/journey` },
  // Internal dashboard — never index.
  robots: { index: false, follow: false },
};

export default async function OpsJourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ citation?: string }>;
}) {
  const { citation } = await searchParams;
  const [pipeline, index] = citation ? await Promise.all([getPipelineAttempts(), getBundleIndex([citation])]) : [null, []];
  const attempts = citation && pipeline ? citationJourney(pipeline.attempts, citation) : [];
  // The run each module encoded inside another citation's run came from, by name.
  const runs = pipeline ? hostCitations(pipeline.attempts) : new Map<string, string>();
  const hosts: Record<string, string> = {};
  for (const attempt of attempts) {
    const host = dependentHostId(attempt);
    const hostCitation = host ? runs.get(host) : undefined;
    if (host && hostCitation) hosts[host] = hostCitation;
  }
  return (
    <PipelineJourney
      citation={citation ?? null}
      attempts={attempts}
      available={pipeline?.available ?? true}
      bundles={citation ? bundleMemberships(citation, index) : []}
      hosts={hosts}
      referenceMs={Date.now()}
    />
  );
}
