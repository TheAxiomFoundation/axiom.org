import { compositionScope } from "@/lib/axiom/runtime/composition-readiness";
import {
  membershipTuples,
  upstreamAcceptsExplicitRoles,
  upstreamRelationsMatch,
} from "@/lib/axiom/runtime/relation-roles";
import { NextResponse } from "next/server";
import {
  getRuntimePackage,
  runCalculate,
  runCalculateRoot,
  runtimeProxyGet,
  isRuntimeApiConfigured,
} from "@/lib/axiom/runtime/api";
import { clientKey, isRateLimited } from "../run/limiter";

export const dynamic = "force-dynamic";

/** Scenario values / facts: keep well-formed number-or-boolean
 *  entries, report the type-rejected keys (silent filtering hid
 *  client bugs). */
function sanitizeValues(raw: unknown): {
  sanitized: Record<string, number | boolean>;
  rejected: string[];
} {
  const sanitized: Record<string, number | boolean> = {};
  const rejected: string[] = [];
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(
      raw as Record<string, unknown>
    )) {
      if (!INPUT_NAME_RE.test(key)) { rejected.push(key); continue; }
      if (
        (typeof value !== "number" && typeof value !== "boolean") ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        rejected.push(key);
        continue;
      }
      sanitized[key] = value;
      if (Object.keys(sanitized).length >= MAX_VALUES) break;
    }
  }
  return { sanitized, rejected };
}

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const INPUT_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,511}$/;
// Additional household members: person_2 … person_12 (person_1 IS
// the flat facts). Bounded so a hostile request can't fan out.
const MEMBER_ID_RE = /^person_(?:[2-9]|1[0-2])$/;
const MAX_MEMBERS = 11;
const VARIABLE_RE = /^[\w.:#/–-]{1,1024}$/;
// A file legal id: `us:statutes/7/2014/e/6/A` — no #fragment; run-by-root
// roots a whole subtree, not a single rule.
const ROOT_RE = /^[a-z]{2}(?:-[a-z]{2,3})?:[\w./–-]{1,200}$/;
const MAX_VALUES = 64;
const MAX_VARIABLES = 96;

/**
 * Scenario execution for the Plane. The caller names a program,
 * answers inputs by their REAL registry names, and asks for trace
 * variables. Values are grafted onto the package's entity household
 * exactly where the registry says each input lives — every input
 * the law asks is settable, verified end to end (grafting
 * employee_wages_received moves gross income; household_size moves
 * the allotment table).
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
    values?: unknown;
    root?: unknown;
    facts?: unknown;
    people?: unknown;
    relations?: unknown;
    variables?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const variables = Array.isArray(body.variables)
    ? (body.variables as unknown[])
        .filter(
          (item): item is string =>
            typeof item === "string" && VARIABLE_RE.test(item)
        )
        .slice(0, MAX_VARIABLES)
    : [];

  // ── Run-by-root: `{ root, facts, variables }` passes straight
  // through to the API's root-composed calculate. Feature-detected:
  // an upstream that doesn't know the shape yet answers 400/404,
  // surfaced as 404 root_calculate_unsupported so the client can
  // hide the run affordance instead of erroring.
  if (body.root !== undefined) {
    const root = body.root;
    if (typeof root !== "string" || !ROOT_RE.test(root)) {
      return NextResponse.json({ error: "invalid_root" }, { status: 400 });
    }
    const scope = await compositionScope(root);
    const readiness = scope.readiness;
    if (readiness !== "ready" && readiness !== "roles_required") return NextResponse.json({error:readiness}, {status:readiness === "relationships_unsupported" ? 422 : 503, headers:{"cache-control":"no-store"}});
    const { sanitized: facts, rejected: droppedFacts } = sanitizeValues(
      body.facts
    );
    // Extra household members: `people.person_N` records sanitized
    // exactly like facts; malformed member ids — and non-object
    // records — are dropped whole. An EMPTY object is kept: by the
    // members contract an added person with no answers is still a
    // person, but only when the caller actually sent an object (a
    // scalar must never fabricate a household member).
    let people: Record<string, Record<string, number | boolean>> | undefined;
    if (body.people && typeof body.people === "object") {
      people = {};
      for (const [member, values] of Object.entries(
        body.people as Record<string, unknown>
      )) {
        if (
          !MEMBER_ID_RE.test(member) ||
          !values ||
          typeof values !== "object" ||
          Array.isArray(values)
        ) {
          droppedFacts.push(member);
          continue;
        }
        if (Object.keys(people).length >= MAX_MEMBERS) break;
        const { sanitized, rejected } = sanitizeValues(values);
        people[member] = sanitized;
        droppedFacts.push(...rejected.map((name) => `${member}:${name}`));
      }
      if (Object.keys(people).length === 0) people = undefined;
    }
    // Several Person–unit relations: the membership convention would put
    // every person in every relation (a taxpayer becomes a dependent of
    // another tax unit), so the scenario must state each person's roles,
    // and the runtime must confirm it applied them instead.
    let relations: Array<{ name: string; tuples: string[][] }> | undefined;
    if (readiness === "roles_required") {
      const order = ["person_1", ...Object.keys(people ?? {})];
      const built = membershipTuples(scope.relations, body.relations, order);
      if (!built.ok) {
        const message =
          built.error === "relation_roles_required"
            ? `Say who belongs to each relationship before running (unanswered: ${built.detail}).`
            : built.error === "unknown_member"
              ? `${built.detail} is not a person in this scenario.`
              : `${built.detail} is not a relationship in this scope.`;
        return NextResponse.json(
          { error: built.error, message },
          { status: 422, headers: { "cache-control": "no-store" } }
        );
      }
      relations = built.entries;
      // The runtime keeps the convention for any relation no entry names,
      // so the entries must cover exactly what IT binds for this root, not
      // only what the source declares. Read its own catalog FRESH before
      // running (a cached catalog could itself be stale): a probe the
      // client skipped, a stale root-inputs response or mirror/runtime
      // drift all land here.
      const catalog = await runtimeProxyGet(
        `/runtime/root-inputs?root=${encodeURIComponent(root)}`,
        { timeoutMs: 20_000, fresh: true }
      );
      if (catalog.status !== 200) {
        return NextResponse.json(
          { error: "unavailable", message: "The runtime's relationship catalog could not be read. Try again." },
          { status: 503, headers: { "cache-control": "no-store" } }
        );
      }
      if (
        !upstreamAcceptsExplicitRoles(catalog.body) ||
        !upstreamRelationsMatch(catalog.body, scope.relations)
      ) {
        return NextResponse.json(
          {
            error: "relationships_unsupported",
            message: "The runtime's relationships for this scope do not match its declarations, so roles cannot be applied.",
          },
          { status: 422, headers: { "cache-control": "no-store" } }
        );
      }
    }
    const outcome = await runCalculateRoot({ root, facts, people, variables, ...(relations ? { relations } : {}) });
    if (outcome.kind === "unsupported") {
      return NextResponse.json(
        { error: "root_calculate_unsupported" },
        { status: 404 }
      );
    }
    if (outcome.kind === "refused") {
      // The engine declined this subtree (compile_failed /
      // closure_incomplete / uncertified_node): a state the client
      // must present with the API's own words, not a transport error.
      return NextResponse.json(
        { error: outcome.code, message: outcome.message },
        { status: 422 }
      );
    }
    if (outcome.kind === "failed") {
      return NextResponse.json({ error: "calculate_failed" }, { status: 502 });
    }
    if (relations && outcome.relationMembership !== "explicit") {
      // A runtime that predates explicit membership ran the convention and
      // ignored the roles: its numbers answer a different household.
      return NextResponse.json(
        {
          error: "relationships_unsupported",
          message: "The runtime did not confirm the relationship roles, so its result is withheld.",
        },
        { status: 422, headers: { "cache-control": "no-store" } }
      );
    }
    return NextResponse.json(
      {
        outputs: outcome.result.outputs,
        trace: outcome.result.trace ?? [],
        period: null,
        provenance: outcome.result.provenance ?? null,
        applied: Object.keys(facts),
        dropped: droppedFacts,
      },
      { headers: { "cache-control": "no-store" } }
    );
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

  const { sanitized: values, rejected } = sanitizeValues(body.values);

  const detail = await getRuntimePackage(jurisdiction, programId);
  if (!detail?.sample_request) {
    return NextResponse.json({ error: "package_not_found" }, { status: 404 });
  }

  const sample = structuredClone(detail.sample_request) as {
    household?: { entities?: Record<string, Record<string, Record<string, unknown>>> };
    variables?: unknown;
  } & Record<string, unknown>;
  const baseVariables = Array.isArray(sample.variables)
    ? (sample.variables as string[])
    : (detail.default_outputs ?? []);
  sample.variables = [...new Set([...baseVariables, ...variables])];

  // Graft each value onto the entity that owns the input per the
  // package registry — adding the key when the sample omits it.
  const applied: string[] = [];
  const entities = sample.household?.entities ?? {};
  for (const entity of detail.entities ?? []) {
    const container = entities[entity.entity];
    if (!container) continue;
    for (const input of entity.inputs ?? []) {
      if (!(input.name in values)) continue;
      for (const instance of Object.values(container)) {
        instance[input.name] = values[input.name];
      }
      applied.push(input.name);
    }
  }

  const result = await runCalculate(sample);
  if (result && "uncertified" in result) {
    // The engine refused because a requested variable isn't in the
    // certification ledger — a state the client must present, not a
    // transport failure. The client names what it asked for; the API
    // (and this route) never echo node ids.
    return NextResponse.json({ error: "uncertified_node" }, { status: 422 });
  }
  if (!result) {
    return NextResponse.json({ error: "calculate_failed" }, { status: 502 });
  }
  return NextResponse.json(
    {
      outputs: result.outputs,
      trace: result.trace ?? [],
      period: detail.default_period ?? null,
      provenance: result.provenance ?? null,
      applied,
      dropped: [
        ...Object.keys(values).filter((name) => !applied.includes(name)),
        ...rejected,
      ],
    },
    { headers: { "cache-control": "no-store" } }
  );
}
