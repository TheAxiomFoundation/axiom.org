import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PipelineJourney } from "@/components/axiom/pipeline-journey";
import { citationJourney } from "@/lib/axiom/encoding-pipeline";
import { getPipelineAttempts } from "@/lib/axiom/encoding-pipeline-data";
import { opsPipelineVisible } from "@/lib/axiom/ops-pipeline-visibility";
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
  // Hidden with the /ops pipeline section until it is made public.
  if (!opsPipelineVisible()) notFound();
  const { citation } = await searchParams;
  const pipeline = citation ? await getPipelineAttempts() : null;
  return (
    <PipelineJourney
      citation={citation ?? null}
      attempts={citation && pipeline ? citationJourney(pipeline.attempts, citation) : []}
      available={pipeline?.available ?? true}
      referenceMs={Date.now()}
    />
  );
}
