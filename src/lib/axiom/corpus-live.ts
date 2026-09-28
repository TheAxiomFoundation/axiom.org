/**
 * One loader for every surface that mirrors the corpus (the landing
 * field, the viewer's subtree picker): the live rulespec mirror
 * first, the committed census snapshot as ballast.
 *
 * The live endpoint (`/api/axiom/corpus/subtrees`, proxying the
 * API's GET /v1/corpus/subtrees) lists every subtree the mirror
 * serves — but carries no sizes, so the snapshot supplies
 * ruleCount/importCount for the targets it knows (new targets get a
 * default dot). If the endpoint fails in any way, the snapshot IS
 * the corpus: the field must never be empty.
 */

import {
  filterViewModules,
  mergeLiveSubtrees,
  type CorpusModule,
  type CorpusSource,
  type LiveSubtree,
} from "./corpus-field";

const LIVE_TIMEOUT_MS = 6000;

export interface LoadedCorpus {
  modules: CorpusModule[];
  source: CorpusSource;
}

async function fetchLiveSubtrees(): Promise<LiveSubtree[] | null> {
  try {
    const response = await fetch("/api/axiom/corpus/subtrees", {
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as {
      status?: string;
      data?: { count?: number; subtrees?: LiveSubtree[] };
    };
    const subtrees = envelope.data?.subtrees;
    if (envelope.status !== "ok" || !Array.isArray(subtrees)) return null;
    const valid = subtrees.filter(
      (item): item is LiveSubtree =>
        typeof item?.target === "string" &&
        typeof item?.jurisdiction === "string" &&
        typeof item?.bucket === "string",
    );
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export async function loadCorpusModules(
  options: { country?: string } = {},
): Promise<LoadedCorpus> {
  const country = options.country ?? "us";
  // The snapshot ships as its own cached chunk, never inline; it is
  // needed either way (sizes when live, everything when not).
  const snapshot = (await import("./corpus-subtrees.json")).default
    .modules as CorpusModule[];
  const live = await fetchLiveSubtrees();
  // The app's view scope, applied to BOTH sources so every surface
  // (field, picker, doors, clusters, counts) agrees: one country
  // family at a time (US by default), and no single-node subtrees
  // (a one-rule module isn't a graph).
  if (live) {
    return {
      modules: filterViewModules(mergeLiveSubtrees(snapshot, live), country),
      source: "live",
    };
  }
  return { modules: filterViewModules(snapshot, country), source: "snapshot" };
}
