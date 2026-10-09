import { NextResponse } from "next/server";
import { getPipelineAttempts } from "@/lib/axiom/encoding-pipeline-data";
import { attemptJurisdiction, inScope, parseScope } from "@/lib/axiom/encoding-pipeline-insights";
import { runRows } from "@/lib/axiom/encoding-pipeline-runs";
import { getCitationMetadata } from "@/lib/corpus-status";
import { getBundleIndex } from "@/lib/axiom/program-bundles-data";
import { opsPipelineVisible } from "@/lib/axiom/ops-pipeline-visibility";

export const dynamic = "force-dynamic";

/**
 * Every dispatch in a scope (`?j=us`, `?j=us&only=1`), newest first, with
 * its citations' names and source documents, and the program bundle
 * documents that hold them, for the /ops ledger and the flow drill-downs. Fetched only when they open, so the page itself carries
 * just the flow's counts. Hidden with the pipeline section.
 */
export async function GET(request: Request) {
  if (!opsPipelineVisible()) return new NextResponse("Not found", { status: 404 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const scope = parseScope(params);
  const pipeline = await getPipelineAttempts();
  if (!pipeline.available) {
    return NextResponse.json({ error: pipeline.error ?? "pipeline unavailable" }, { status: 503 });
  }
  const attempts = pipeline.attempts.filter((attempt) => inScope(attemptJurisdiction(attempt), scope));
  const rows = runRows(attempts);
  const [metadata, index] = await Promise.all([getCitationMetadata(rows.map((row) => row.citation)), getBundleIndex(rows.map((row) => row.citation))]);
  // Only the bundle documents some run's citation sits in.
  const bundles = index.filter((entry) =>
    rows.some((row) => row.citation === entry.citation_path || row.citation.startsWith(`${entry.citation_path}/`))
  );
  return NextResponse.json({ rows, ...metadata, bundles }, { headers: { "Cache-Control": "no-store" } });
}
