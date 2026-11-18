import type { Metadata } from "next";
import { JourneyView } from "@/components/ops/flow/flow-page";
import { getCitationEvents } from "@/lib/axiom/pipeline-events-data";
import { caseDetail, citationLanes, stationOrderOf } from "@/lib/axiom/pipeline-flow";
import { bundleMemberships } from "@/lib/axiom/program-bundles";
import { getBundleIndex } from "@/lib/axiom/program-bundles-data";
import { SITE_URL } from "@/lib/urls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Encoding journey - Axiom Foundation",
  description:
    "One citation's path through the encoding pipeline, station by station: every dispatch and its tries, its PR, the merge, the index, the compile sweep and the tests on main.",
  alternates: { canonical: `${SITE_URL}/ops/journey` },
  // Internal dashboard — never index.
  robots: { index: false, follow: false },
};

/**
 * The one drill-down from /ops: a citation's cases from the event log, read
 * for that citation alone (derived from its pipeline_attempts rows until
 * encodings.pipeline_events is live),
 * and one run's path with ?case=. /api/ops/flow?citation= serves the same
 * lanes as JSON.
 */
export default async function OpsJourneyPage({ searchParams }: { searchParams: Promise<{ citation?: string; case?: string }> }) {
  const { citation, case: caseId } = await searchParams;
  const [events, index] = citation ? await Promise.all([getCitationEvents(citation), getBundleIndex([citation])]) : [null, []];
  const all = events?.events ?? [];
  const lanes = citation ? citationLanes(all, citation) : [];
  // A run of this citation only: its events are the ones read.
  const detail = caseId ? caseDetail(all, caseId) : null;
  return (
    <JourneyView
      citation={citation ?? null}
      stationOrder={stationOrderOf(all)}
      lanes={lanes}
      detail={detail}
      bundles={citation ? bundleMemberships(citation, index) : []}
      error={events?.error ?? null}
    />
  );
}
