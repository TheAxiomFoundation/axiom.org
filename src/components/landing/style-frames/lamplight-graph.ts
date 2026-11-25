// Where the Lamplight film draws each node of the § 2017(a) rule graph
// (journey-digital/data.ts GRAPH_NODES and GRAPH_EDGES), in its three
// scenes: the code page (beat 5), the graph itself and the registry
// (beat 6). Every table is keyed by GraphNodeId, so a node added to the
// shared graph fails the typecheck until each scene places it; the beat-6
// cluster takes its wires from GRAPH_EDGES, so it cannot draw a line the
// graph does not have.
import { GRAPH_EDGES, GRAPH_NODES, type GraphNodeId } from "../journey-digital/data";

// The graph scene: a left-to-right dependency layout. LEVEL sets each
// card's depth and when its wires draw; P2 is its position in design
// pixels, which the scene centres on (760, 300).
export const LEVEL: Record<GraphNodeId, number> = {
  imp2014: 0,
  impUsda: 0,
  impTfp: 0,
  rate30: 1,
  size2: 1,
  rate8: 1,
  net: 1,
  contrib: 2,
  minimum: 2,
  before: 3,
  regular: 4,
};
export const P2: Record<GraphNodeId, [number, number]> = {
  imp2014: [250, 110],
  impUsda: [250, 340],
  impTfp: [250, 570],
  net: [600, 50],
  rate30: [600, 195],
  size2: [640, 470],
  rate8: [700, 600],
  contrib: [960, 130],
  minimum: [1010, 520],
  before: [1290, 300],
  regular: [1330, 600],
};

// The code page: the lines of a.yaml each node's rule block spans, from
// its first line (the node's own `line`) to its last. Both USDA rules come
// in on the one import line.
export const RULE_LINES: Record<GraphNodeId, [number, number]> = {
  imp2014: [10, 10],
  impUsda: [11, 11],
  impTfp: [11, 11],
  rate30: [13, 27],
  rate8: [29, 43],
  size2: [45, 59],
  net: [61, 84],
  contrib: [86, 103],
  before: [105, 128],
  minimum: [130, 154],
  regular: [158, 176],
};

// The registry: the graph shrunk to one small cluster of dots, offsets
// from the cluster's centre in world units.
export const HERO_DOT: Record<GraphNodeId, [number, number]> = {
  imp2014: [-0.42, 0.18],
  impUsda: [-0.42, -0.1],
  impTfp: [-0.32, -0.36],
  net: [-0.22, 0.24],
  rate30: [-0.22, 0.1],
  size2: [-0.22, -0.12],
  rate8: [-0.22, -0.24],
  contrib: [0.0, 0.2],
  minimum: [0.0, -0.16],
  before: [0.2, 0.04],
  regular: [0.32, -0.18],
};
// The cluster's dots in GRAPH_NODES order; the graph scene's cards fly to
// the dot at the same index.
export const HERO_IDS: GraphNodeId[] = GRAPH_NODES.map((n) => n.id);
export const HERO_INDEX = Object.fromEntries(HERO_IDS.map((id, i) => [id, i])) as Record<GraphNodeId, number>;
export const HERO_EDGES: Array<[number, number]> = GRAPH_EDGES.map(([a, b]) => [HERO_INDEX[a], HERO_INDEX[b]]);
