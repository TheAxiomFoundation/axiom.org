import { NextResponse } from "next/server";
import { getPipelineAttempts } from "@/lib/axiom/encoding-pipeline-data";
import { attemptJurisdiction, inScope, parseScope } from "@/lib/axiom/encoding-pipeline-insights";
import { runRows } from "@/lib/axiom/encoding-pipeline-runs";
import { opsPipelineVisible } from "@/lib/axiom/ops-pipeline-visibility";

export const dynamic = "force-dynamic";

/**
 * Every dispatch in a scope (`?j=us`, `?j=us&only=1`), newest first, for
 * the /ops run log and flow drill-downs. Fetched only when they open, so
 * the page itself carries just the flow's counts. Hidden with the pipeline
 * section.
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
  return NextResponse.json(
    { rows: runRows(attempts) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
