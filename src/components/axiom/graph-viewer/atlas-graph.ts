import dagre from "dagre";
import type { ModuleGraph } from "@/lib/axiom/corpus-field";
import type { ProgramGraph } from "./types";

export function atlasGraph(graph: ProgramGraph): ModuleGraph {
  const ids = [...new Set([...graph.rules, ...graph.inputs, ...graph.relations].map(node => node.legalId))];
  const index = new Map(ids.map((id,i) => [id,i]));
  const edges: Array<[number,number]> = [];
  const seen = new Set<string>();
  const add = (from: string, to: string) => { const a = index.get(from), b = index.get(to); if (a == null || b == null || seen.has(`${a}:${b}`)) return; seen.add(`${a}:${b}`); edges.push([a,b]); };
  for (const rule of graph.rules) for (const dependency of [...rule.ruleDeps, ...rule.inputDeps, ...(rule.relationDeps ?? [])]) add(dependency,rule.legalId);
  for (const relation of graph.relations) for (const input of relation.memberInputIds ?? []) add(input,relation.legalId);
  const layout = new dagre.graphlib.Graph().setGraph({ rankdir: "LR", nodesep: 12, ranksep: 30 }).setDefaultEdgeLabel(() => ({}));
  ids.forEach(id => layout.setNode(id, { width: 8, height: 8 }));
  edges.forEach(([a,b]) => layout.setEdge(ids[a]!,ids[b]!));
  dagre.layout(layout);
  const width = Math.max(1,layout.graph().width ?? 1), height = Math.max(1,layout.graph().height ?? 1);
  return { n: ids.length, e: edges, p: ids.map(id => { const node = layout.node(id); return [node.x / width,node.y / height]; }) };
}

const cache = new Map<string, { graph: ModuleGraph; expires: number }>();
export function cachedAtlasGraph(target: string): ModuleGraph | undefined { return cache.get(target)?.graph; }
async function fetchAtlasGraph(target: string, signal: AbortSignal): Promise<ModuleGraph> {
  const existing = cache.get(target);
  if (existing && existing.expires > Date.now()) return existing.graph;
  const response = await fetch(`/api/axiom/graph/compose?focus=${encodeURIComponent(target)}&v=2`, { signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
  if (response.status === 429) {
    const body = await response.json().catch(() => null);
    const seconds = Number(body?.data?.retry_after_seconds);
    nextRequestAt = Date.now() + (Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 300)) : 60) * 1000;
    throw new Error("Preview refresh deferred");
  }
  if (!response.ok) throw new Error("Graph request failed");
  const result = await response.json() as { data?: { graph?: ProgramGraph; truncated?: boolean } };
  if (!result.data?.graph || result.data.truncated) throw new Error("Graph is incomplete");
  const graph = atlasGraph(result.data.graph);
  cache.set(target, { graph, expires: Date.now() + 300000 });
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  return graph;
}

// One thumbnail request at a time across atlas instances; respect server cooldown.
let nextRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
export function loadAtlasGraph(target: string, signal: AbortSignal): Promise<ModuleGraph> {
  const existing = cache.get(target);
  if (existing && existing.expires > Date.now()) return Promise.resolve(existing.graph);
  const task = queue.catch(() => {}).then(async () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (Date.now() < nextRequestAt) throw new Error("Preview refresh deferred");
    nextRequestAt = Date.now() + 2000;
    return fetchAtlasGraph(target, signal);
  });
  queue = task.catch(() => {});
  return task;
}
