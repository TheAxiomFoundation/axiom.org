import { NextResponse } from "next/server";
import {
  getRuntimePackage,
  runCalculate,
  isRuntimeApiConfigured,
} from "@/lib/axiom/runtime/api";
import {
  clientKey,
  getCachedRun,
  isRateLimited,
  setCachedRun,
} from "./limiter";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const LEGAL_ID_RE = /^[a-z]{2}(?:-[a-z]{2,3})?:[\w./–-]+#[\w-]+$/;
const MAX_SECTION_RULES = 12;

/**
 * Execute a package's canonical sample household — the first Run
 * surface (F2 slice 0). The browser sends only the program
 * coordinates; the sample request and the API key stay server-side.
 * A user-editable scenario endpoint comes later and will need input
 * validation this route deliberately avoids by not accepting
 * household payloads at all.
 */
export async function POST(request: Request) {
  if (!isRuntimeApiConfigured()) {
    return NextResponse.json(
      { error: "runtime_unconfigured" },
      { status: 503 }
    );
  }
  if (isRateLimited(clientKey(request))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  let body: {
    jurisdiction?: unknown;
    program_id?: unknown;
    section_rules?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const jurisdiction = body.jurisdiction;
  const programId = body.program_id;
  if (
    typeof jurisdiction !== "string" ||
    typeof programId !== "string" ||
    !SLUG_RE.test(jurisdiction) ||
    !SLUG_RE.test(programId)
  ) {
    return NextResponse.json({ error: "invalid_program" }, { status: 400 });
  }

  // Optional: durable legal ids of the section's rules — traced
  // alongside the default outputs so the reading column can light up
  // with the values the section itself computed (default outputs are
  // composition-level and rarely trace back to the statute file).
  const sectionRules = Array.isArray(body.section_rules)
    ? (body.section_rules as unknown[])
        .filter(
          (id): id is string => typeof id === "string" && LEGAL_ID_RE.test(id)
        )
        .slice(0, MAX_SECTION_RULES)
    : [];

  const cacheKey = `${jurisdiction}/${programId}|${[...sectionRules]
    .sort()
    .join(",")}`;
  const cachedRun = getCachedRun(cacheKey);
  if (cachedRun !== null) {
    return NextResponse.json(cachedRun, {
      headers: { "cache-control": "no-store" },
    });
  }

  const detail = await getRuntimePackage(jurisdiction, programId);
  if (!detail?.sample_request) {
    return NextResponse.json({ error: "package_not_found" }, { status: 404 });
  }
  const sample = detail.sample_request as Record<string, unknown>;
  const baseVariables = Array.isArray(sample.variables)
    ? (sample.variables as string[])
    : detail.default_outputs;
  const request_ =
    sectionRules.length > 0
      ? {
          ...sample,
          variables: [...new Set([...baseVariables, ...sectionRules])],
        }
      : detail.sample_request;
  let result = await runCalculate(request_);
  if (result && "uncertified" in result && sectionRules.length > 0) {
    // Certified serving refuses the WHOLE request when any explicit
    // variable is uncertified — the section's rules may lag the
    // ledger while the sample itself still runs. Retry once without
    // them so the reader keeps its outputs, just unlit.
    result = await runCalculate(detail.sample_request);
  }
  if (result && "uncertified" in result) {
    return NextResponse.json({ error: "uncertified_program" }, { status: 422 });
  }
  if (!result) {
    return NextResponse.json({ error: "calculate_failed" }, { status: 502 });
  }
  const payload = {
    outputs: result.outputs,
    trace: result.trace ?? [],
    period: detail.default_period ?? null,
    sample: true,
    provenance: result.provenance ?? null,
  };
  setCachedRun(cacheKey, payload);
  return NextResponse.json(payload, {
    headers: { "cache-control": "no-store" },
  });
}
