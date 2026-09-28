import type { Metadata } from "next";
import { OpsDashboard } from "@/components/axiom/ops-dashboard";
import { getEncodingQueues } from "@/lib/axiom/encoding-queues";
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
  const [encodingStatus, queues, recentScopes] = await Promise.all([
    getEncodingStatus(),
    getEncodingQueues(),
    getRecentCorpusScopes(),
  ]);
  return (
    <OpsDashboard
      initialStatus={encodingStatus.value}
      encodingError={encodingStatus.error}
      queues={queues}
      recentScopes={recentScopes}
    />
  );
}
