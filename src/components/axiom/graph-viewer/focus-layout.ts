import type { Node, Edge } from "@xyflow/react";

export function upstreamNodeIds(nodes: Node[], edges: Edge[], startId: string, maxDepth = Infinity): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(startId)) return new Set();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  const distances = new Map<string, number>();
  const pending: Array<[string, number]> = [[startId, 0]];
  for (let i = 0; i < pending.length; i++) {
    const [id, depth] = pending[i]!;
    if (depth > maxDepth || (distances.get(id) ?? Infinity) <= depth) continue;
    distances.set(id, depth);
    if (depth >= maxDepth) continue;
    for (const parent of incoming.get(id) ?? []) pending.push([parent, depth + 1]);
  }
  return new Set(distances.keys());
}

export function upstreamIds(nodes: Node[], edges: Edge[], legalId: string | null, maxDepth = Infinity): Set<string> {
  const start = nodes.find((node) => node.data.legalId === legalId);
  return start && legalId ? upstreamNodeIds(nodes, edges, start.id, maxDepth) : new Set();
}

/** Pack dependency layers, preserving order within the focus and context
 *  groups. All identities and edges survive the focus change. */
export function focusLayout(nodes: Node[], focus: Set<string>, edges: Edge[] = []): Node[] {
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id));
  const columns: Node[][] = [];
  // Dependency depth defines columns, rather than variable-width card x
  // positions from the old layout (which incorrectly split one layer).
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!incoming.has(edge.source) || !incoming.has(edge.target)) continue;
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const target of outgoing.get(id) ?? []) {
      rank.set(target, Math.max(rank.get(target)!, rank.get(id)! + 1));
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  // Put a source near its earliest consumer rather than forcing every
  // household input into one tall leftmost column.
  for (const id of [...queue].reverse()) {
    const children = outgoing.get(id) ?? [];
    if (children.length) rank.set(id, Math.min(...children.map((child) => rank.get(child)! - 1)));
  }
  if (edges.length && queue.length === nodes.length) {
    for (const node of sorted) (columns[rank.get(node.id)!] ??= []).push(node);
  } else {
    // Cyclic or unconnected layouts preserve their existing column order.
    for (const node of sorted) {
      const last = columns.at(-1);
      if (!last || Math.abs(node.position.x - last[0]!.position.x) > 24) columns.push([node]);
      else last.push(node);
    }
  }
  const positions = new Map<string, Node>();
  let x = 24;
  for (const column of columns.filter(Boolean)) {
    column.sort((a, b) => Number(focus.has(b.id)) - Number(focus.has(a.id)) || a.position.y - b.position.y || a.id.localeCompare(b.id));
    const sizes = column.map((node) => {
      const active = focus.has(node.id);
      return { width: active ? node.width ?? 220 : 164, height: active ? node.height ?? 80 : 48 };
    });
    let y = 0;
    const placed = column.map((node, index) => {
      const size = sizes[index]!;
      const next = { ...node, ...size, measured: size, position: { x, y }, style: { ...node.style, ...size } };
      y += size.height + (focus.has(node.id) ? 28 : 14);
      return next;
    });
    const active = placed.filter((node) => focus.has(node.id));
    const centered = active.length ? active : placed;
    const middle = (centered[0]!.position.y + centered.at(-1)!.position.y + centered.at(-1)!.height!) / 2;
    for (const node of placed) positions.set(node.id, { ...node, position: { x, y: node.position.y - middle } });
    x += Math.max(...sizes.map((size) => size.width)) + 64;
  }
  return nodes.map((node) => positions.get(node.id)!);
}

/** Node navigation never exposes unrelated siblings from the loaded artifact. */
export function dependencySubgraph(nodes: Node[], edges: Edge[], legalId: string | null, maxDepth = Infinity): { nodes: Node[]; edges: Edge[] } {
  const ids = upstreamIds(nodes, edges, legalId, maxDepth);
  return {
    nodes: nodes.filter(node => ids.has(node.id)).map(node => ({ ...node, position: { ...node.position } })),
    edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => ({ ...edge })),
  };
}

/** Inputs have no upstream tree. Keep the computations they feed, including
 * those computations' other dependencies, without pulling in unrelated roots. */
export function inputContextSubgraph(nodes: Node[], edges: Edge[], legalId: string | null): { nodes: Node[]; edges: Edge[] } {
  const starts = nodes.filter(node => node.data.legalId === legalId);
  const downstream = new Set(starts.map(node => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const queue = [...downstream];
  for (let i = 0; i < queue.length; i++) for (const next of outgoing.get(queue[i]!) ?? []) {
    if (!downstream.has(next)) { downstream.add(next); queue.push(next); }
  }
  const ids = new Set<string>();
  for (const id of downstream) for (const upstream of upstreamNodeIds(nodes, edges, id)) ids.add(upstream);
  return { nodes: nodes.filter(node => ids.has(node.id)).map(node => ({...node, position:{...node.position}})), edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => ({...edge})) };
}

/** The root whose tree the canvas draws for a requested node: the first
 *  output (outputs lead with the summit) whose dependency tree holds it,
 *  so an intermediate rule opens inside the tree that uses it. An input
 *  keeps its own context view; a node no output reaches is its own root. */
export function scopeRootFor(nodes: Node[], edges: Edge[], outputIds: string[], requested: string | null): string | null {
  const fallback = outputIds.find((id) => nodes.some((node) => node.data.legalId === id)) ?? null;
  const target = requested ? nodes.find((node) => node.data.legalId === requested) : undefined;
  if (!target || !requested) return fallback;
  if (target.data.kind === "input") return requested;
  for (const output of outputIds) {
    if (output === requested || upstreamIds(nodes, edges, output).has(target.id)) return output;
  }
  return requested;
}

/** The cards a depth-limited canvas draws: the root's inputs to `depth`
 *  levels, every card on a path from the focused card up to the root,
 *  and the focused card's own inputs to `depth` levels. Each drawn card
 *  carries how many of its direct inputs stay hidden, so the canvas can
 *  say "+N inputs" instead of drawing the whole tree at an unreadable
 *  zoom. An unlimited depth draws the whole tree. */
export function visibleSubgraph(nodes: Node[], edges: Edge[], rootLegalId: string | null, focusLegalId: string | null, depth: number): { nodes: Node[]; edges: Edge[]; hiddenInputs: Map<string, number> } {
  const tree = dependencySubgraph(nodes, edges, rootLegalId, Infinity);
  if (!Number.isFinite(depth)) return { ...tree, hiddenInputs: new Map() };
  const visible = upstreamIds(tree.nodes, tree.edges, rootLegalId, depth);
  const focus = tree.nodes.find((node) => node.data.legalId === focusLegalId);
  if (focus && !visible.has(focus.id)) {
    // Every card between the focus and the root: downstream of the
    // focus, inside the root's tree.
    const outgoing = new Map<string, string[]>();
    for (const edge of tree.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    const queue = [focus.id];
    const seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const next of outgoing.get(queue[i]!) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    for (const id of seen) visible.add(id);
  }
  if (focus) for (const id of upstreamNodeIds(tree.nodes, tree.edges, focus.id, depth)) visible.add(id);
  const hiddenInputs = new Map<string, number>();
  for (const edge of tree.edges) {
    if (visible.has(edge.target) && !visible.has(edge.source)) hiddenInputs.set(edge.target, (hiddenInputs.get(edge.target) ?? 0) + 1);
  }
  return {
    nodes: tree.nodes.filter((node) => visible.has(node.id)),
    edges: tree.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
    hiddenInputs,
  };
}
