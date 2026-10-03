import { NextResponse } from "next/server";
import { runtimeProxyGet } from "@/lib/axiom/runtime/api";

// Node legal ids carry colons, dots, dashes and a #fragment, so the
// per-segment check is deliberately loose — whitespace and runaway
// length only. The upstream certified gate is the real arbiter (and
// answers the same 404 for unknown and uncertified ids).
function validSegment(segment: string): boolean {
  // `.` and `..` are path navigation, never part of a legal id; forwarding
  // one would let the upstream URL resolve outside /nodes. Nor does a legal
  // id segment contain a separator: one arriving here was percent-encoded
  // to smuggle it past routing.
  if (segment === "." || segment === ".." || /[/\\]/.test(segment)) return false;
  return segment.length > 0 && segment.length <= 200 && !/\s/.test(segment);
}

/** Certified node-detail passthrough (node-native read). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ node: string[] }> }
) {
  const { node } = await context.params;
  if (!Array.isArray(node) || node.length === 0 || !node.every(validSegment)) {
    return NextResponse.json(
      { status: "error", error: { code: "invalid_node" } },
      { status: 400 }
    );
  }
  // Next decodes %23 back to "#" in path segments — re-encode each
  // one so the fragment survives the upstream URL (a literal # would
  // truncate the path there).
  const path = node.map((segment) => encodeURIComponent(segment)).join("/");
  const { status, body } = await runtimeProxyGet(`/nodes/${path}`);
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "public, max-age=300" },
  });
}
