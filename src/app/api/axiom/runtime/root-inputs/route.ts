import { compositionScope } from "@/lib/axiom/runtime/composition-readiness";
import { upstreamAcceptsExplicitRoles, upstreamRelationsMatch } from "@/lib/axiom/runtime/relation-roles";
import { NextResponse } from "next/server";
import { runtimeProxyGet } from "@/lib/axiom/runtime/api";

const ROOT_RE = /^[a-z]{2}(?:-[a-z]{2,3})?:[\w./–-]+(?:#[\w-]+)?$/;

/** Input catalog passthrough for the run panel: every dataset slot of
 *  a compile-on-demand subtree with the dtype and screening default
 *  the runtime inferred from the compiled artifact — so controls are
 *  typed by the engine's truth, not by name-shape guessing. The source
 *  relations the scenario must answer ride along as `data.relations`. */
export async function GET(request: Request) {
  const root = new URL(request.url).searchParams.get("root")?.trim();
  if (!root || !ROOT_RE.test(root)) {
    return NextResponse.json(
      { status: "error", error: { code: "invalid_root" } },
      { status: 400 }
    );
  }
  const { status, body } = await runtimeProxyGet(
    `/runtime/root-inputs?root=${encodeURIComponent(root)}`,
    { timeoutMs: 20_000, fresh: true }
  );
  if (status !== 200) {
    return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  }
  const scope = await compositionScope(root);
  // Several relations run only on a runtime that honors explicit roles
  // AND compiled exactly the relations the source declares: the scenario
  // sends one entry per declared relation, and any relation it leaves
  // unnamed would fall back to binding every person.
  const accepts = scope.readiness === "roles_required" && upstreamAcceptsExplicitRoles(body);
  const explicit = accepts && upstreamRelationsMatch(body, scope.relations);
  if (scope.readiness !== "ready" && !explicit) {
    const code = scope.readiness === "unavailable" ? "unavailable" : "relationships_unsupported";
    const message =
      scope.readiness === "unavailable"
        ? "The source declarations for this scope could not be read. Try again later."
        : scope.readiness === "relationships_unsupported"
          ? "This source relates people to units in a way a scenario cannot represent yet."
          : accepts
            ? "The runtime's compiled relationships do not match this source's declarations, so roles cannot be offered."
            : "This source needs each person's relationship roles, and the connected runtime cannot take them yet.";
    return NextResponse.json(
      { status: "error", error: { code, message } },
      { status: code === "unavailable" ? 503 : 422, headers: { "cache-control": "no-store" } }
    );
  }
  const envelope = body as {data?: Record<string, unknown>} & Record<string, unknown>;
  return NextResponse.json({
    ...envelope,
    data: {
      ...(envelope.data ?? {}),
      relations: scope.relations,
      relation_membership: explicit ? "explicit" : "convention",
    },
  }, {
    status,
    headers: { "cache-control": "public, max-age=300" },
  });
}
