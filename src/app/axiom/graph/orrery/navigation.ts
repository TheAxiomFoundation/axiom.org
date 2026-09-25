import { decodeLocation, type GraphDocument, type GraphLocation } from "@axiom-foundation/orrery";
import type { ProgramRef } from "@/components/axiom/graph-viewer/types";

export interface OrreryRequest {
  program?: ProgramRef;
  compose?: string;
  focus?: string;
  error?: string;
}

export function orreryRequestKey(request: OrreryRequest): string {
  return request.compose ? `compose:${request.compose}` : request.program ? `program:${request.program.jurisdiction}/${request.program.programId}` : "";
}

/** Preserve the native graph route's program/compose vocabulary. */
export function readOrreryRequest(search: string): OrreryRequest {
  const params = new URLSearchParams(search);
  const compose = params.get("compose")?.trim();
  const focus = params.get("focus")?.trim() || undefined;
  if (compose) return { compose, focus };
  const key = params.get("program");
  if (!key) return { focus };
  const match = /^([a-z0-9-]{1,64})\/([a-z0-9-]{1,64})$/.exec(key);
  if (!match) return { focus, error: "This program address is invalid. Choose a program below." };
  return { program: { jurisdiction: match[1]!, programId: match[2]! }, focus };
}

/** Selection has its own hash; retain native query state when returning. */
export function nativeGraphHref(search: string, selectedId?: string): string {
  const params = new URLSearchParams(search);
  if (selectedId) params.set("focus", selectedId);
  const query = params.toString();
  return `/axiom/graph${query ? `?${query}` : ""}`;
}

export function initialOrreryLocation(hash: string, request: OrreryRequest, document: GraphDocument): GraphLocation {
  // Shared navigation takes precedence over a native entry focus. The host
  // canonicalizes derived query focus into that entry's hash after navigation.
  if (hash) return decodeLocation(hash);
  const focus = request.focus ?? request.compose;
  if (focus && document.nodes.some(node => node.id === focus)) {
    return { selectedId: focus, selectedType: "node", focusId: focus, depth: 1, direction: "both" };
  }
  return {};
}
