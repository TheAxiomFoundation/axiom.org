/* Citation network 3D — render worker.
 *
 * Runs the whole animation loop off the main thread via OffscreenCanvas.
 * Main thread only forwards scroll position, mouse position, resize,
 * and prefers-reduced-motion changes; everything else (universe
 * generation, camera math, drawing, firings, adaptive quality) happens
 * here.
 *
 * Adaptive quality: after a short measurement window we sort the device
 * into one of four tiers and downgrade accordingly.
 *
 *   Tier 0  ≤19ms / ≥52fps  — full quality (DPR cap 2, all effects)
 *   Tier 1  ≤25ms / ≥40fps  — internal DPR dropped to 1
 *   Tier 2  ≤35ms / ≥28fps  — DPR 1, no comet/firing animations
 *   Tier 3  >35ms / <28fps  — render one frame and stop
 *
 * The animation is time-based (uses `performance.now()` deltas), so
 * even at lower frame rates the camera reaches the same waypoint at
 * the same scroll position as on a fast machine — only the apparent
 * smoothness differs.
 */

/* ─────────────────────────── Types ─────────────────────────── */

type Vec3 = { x: number; y: number; z: number };
type Node3 = Vec3 & {
  /** Short subsection citation, shown next to the dot. Empty for
   *  composition variables that don't trace back to one subsection. */
  label: string;
  /** Human-readable variable title — always set, used as the hover
   *  fallback for nodes whose `label` is empty. */
  title: string;
  cluster: number;
};
type Edge = { a: number; b: number };
type Cluster = { id: number; center: Vec3; startIdx: number; endIdx: number };
type Waypoint = {
  scroll: number;
  camPos: Vec3;
  lookAt: Vec3;
  focusCluster: number;
  cxFrac: number;
  // projection scale: the hero draws the graph smaller, inside the
  // right half, so the headline and buttons stay clear on the left
  zoom: number;
};

/* ─────────────────────────── Labels by source type ───────────────────────
 * Each node's dot is labelled with a real citation, drawn from one of
 * three curated pools by where it sits in the tree:
 *
 *   - Root + level 1: statutes (USC, ITA, ITEPA, TCGA, FA) — the
 *     foundational legal authority a rule traces back to.
 *   - Mid-tree: regulations (CFR, state CCR, Treasury Reg.) — how the
 *     statute is operationalised by an agency.
 *   - Leaves: a mix of regulations and agency policy manuals
 *     (USDA / IRS / CDHS bulletins, SSA POMS) — the last-mile
 *     guidance that drives the actual computation.
 *
 * The hierarchy is honest: statutes pass down to regulations pass down
 * to policy manuals, which is how the corpus is actually structured. */

const STATUTE_LABELS = [
  "26 USC § 24",
  "26 USC § 32",
  "26 USC § 36B",
  "26 USC § 162",
  "26 USC § 401(k)",
  "26 USC § 6428",
  "26 USC § 1(h)",
  "7 USC § 2014",
  "7 USC § 2017(a)",
  "20 USC § 1087",
  "42 USC § 601",
  "42 USC § 1396a",
  "42 USC § 1397",
  "5 USC § 552",
  "ITA s. 122.6",
  "ITA 2007 s. 118",
  "ITEPA 2003 s. 4",
  "TCGA 1992 s. 222",
  "FA 2024 s. 27",
];

const REGULATION_LABELS = [
  "7 CFR § 273.8(a)",
  "7 CFR § 273.5(a)",
  "7 CFR § 273.10",
  "7 CFR § 273.4(b)",
  "29 CFR § 825.100",
  "29 CFR § 1602",
  "20 CFR § 416.1110",
  "26 CFR § 1.151-3",
  "26 CFR § 1.401(k)-1",
  "26 CFR § 1.32-2",
  "10 CCR § 4.401(A)",
  "10 CCR § 4.403",
  "10 CCR § 4.408(B)",
  "Reg. § 1.151-3",
  "Reg. § 1.6428-1",
];

const POLICY_LABELS = [
  "USDA FY26 § max-allotments",
  "USDA FY26 § income-elig",
  "USDA FY26 § deductions",
  "Rev. Proc. 2025-32 § brackets",
  "Rev. Proc. 2025-32 § capital-gains",
  "CO CDHS FY26 § benefit-calc",
  "SSA POMS § SI 00810.420",
  "SSA POMS § DI 24503",
  "IRS Notice 2024-67 § II",
  "CMS SHO 23-002 § A",
];

function labelForDepth(depth: number, maxDepth: number, i: number): string {
  // Root and immediate children — statutes (legal foundation)
  if (depth <= 1) return STATUTE_LABELS[i % STATUTE_LABELS.length];
  // Leaves — mix of regs and policy manuals (operational detail)
  if (depth === maxDepth - 1) {
    return i % 3 === 0
      ? POLICY_LABELS[i % POLICY_LABELS.length]
      : REGULATION_LABELS[i % REGULATION_LABELS.length];
  }
  // Mid-tree — regulations (statute implementation)
  return REGULATION_LABELS[i % REGULATION_LABELS.length];
}

/* ─────────────────────────── Universe ─────────────────────────── */

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildDecisionTree(
  nodes: Node3[],
  edges: Edge[],
  clusterId: number,
  rng: () => number,
  center: Vec3,
  opts: {
    maxDepth: number;
    branchFactor: number;
    height: number;
    initialSpread: number;
    spreadShrink: number;
    earlyTerminationProb?: number;
    earlyTerminationMinDepth?: number;
  }
): { startIdx: number; endIdx: number } {
  const startIdx = nodes.length;
  const stepY = opts.height / Math.max(1, opts.maxDepth - 1);
  const earlyProb = opts.earlyTerminationProb ?? 0;
  const earlyMinDepth = opts.earlyTerminationMinDepth ?? 2;

  const rootIdx = nodes.length;
  nodes.push({
    x: center.x,
    y: center.y + opts.height / 2,
    z: center.z,
    label: labelForDepth(0, opts.maxDepth, 0),
    title: "",
    cluster: clusterId,
  });

  type Pending = { idx: number; depth: number; spread: number };
  const stack: Pending[] = [
    { idx: rootIdx, depth: 0, spread: opts.initialSpread },
  ];
  let leafCount = 0;

  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.depth >= opts.maxDepth - 1) continue;
    if (
      cur.depth >= earlyMinDepth &&
      cur.depth < opts.maxDepth - 1 &&
      rng() < earlyProb
    ) {
      continue;
    }
    const parent = nodes[cur.idx];
    // Per-fan angular budget + small rotational offset, no parent
    // inheritance — keeps the tree from drifting to one side as depth
    // grows. (Same approach as the CO SNAP extractor's layout.)
    const angleBudget = (1.3 + rng() * 0.6) * Math.PI * 2;
    const angleOffset = (rng() - 0.5) * 0.6;
    for (let b = 0; b < opts.branchFactor; b++) {
      const fraction = b / Math.max(1, opts.branchFactor);
      const baseAngle = angleOffset + fraction * angleBudget + (rng() - 0.5) * 0.6;
      const radius = cur.spread * (0.7 + rng() * 0.65);
      const yStep = stepY * (0.75 + rng() * 0.55);
      const childDepth = cur.depth + 1;
      const isLeaf = childDepth >= opts.maxDepth - 1;
      const labelIdx = isLeaf ? leafCount++ : nodes.length;
      const child: Node3 = {
        x: parent.x + Math.cos(baseAngle) * radius,
        y: parent.y - yStep,
        z: parent.z + Math.sin(baseAngle) * radius,
        label: labelForDepth(childDepth, opts.maxDepth, labelIdx),
        title: "",
        cluster: clusterId,
      };
      const childIdx = nodes.length;
      nodes.push(child);
      edges.push({ a: cur.idx, b: childIdx });
      stack.push({
        idx: childIdx,
        depth: childDepth,
        spread: cur.spread * opts.spreadShrink,
      });
    }
  }

  return { startIdx, endIdx: nodes.length };
}

function makeUniverse(): { nodes: Node3[]; edges: Edge[]; clusters: Cluster[] } {
  const nodes: Node3[] = [];
  const edges: Edge[] = [];
  const clusters: Cluster[] = [];
  const rng = makeRng(20260528);

  /* One synthetic decision tree — depth 5, ternary branching, with
   * ~50% early termination from depth 2 on so leaves sit at mixed
   * depths instead of forming a flat bottom row. Labels are real
   * citations selected by depth (statutes near root → regulations →
   * policy manuals). */
  const center = { x: 0, y: 0, z: 0 };
  const { startIdx, endIdx } = buildDecisionTree(nodes, edges, 0, rng, center, {
    maxDepth: 5,
    branchFactor: 3,
    height: 5.2,
    initialSpread: 2.6,
    spreadShrink: 0.55,
    earlyTerminationProb: 0.5,
    earlyTerminationMinDepth: 2,
  });
  clusters.push({ id: 0, center, startIdx, endIdx });

  /* Sparse background stars for depth — kept off the main tree's
   * volume so they don't crowd the zoomed-in views. */
  const main = clusters[0];
  let added = 0;
  let safety = 0;
  while (added < 20 && safety < 2000) {
    safety++;
    const x = (rng() - 0.5) * 50;
    const y = (rng() - 0.5) * 26;
    const z = (rng() - 0.5) * 50 - 4;
    if (Math.hypot(x - main.center.x, y - main.center.y, z - main.center.z) < 10) {
      continue;
    }
    nodes.push({ x, y, z, label: "", title: "", cluster: -1 });
    added++;
  }

  return { nodes, edges, clusters };
}

function pickFocusNode(nodes: Node3[], clusters: Cluster[]): Vec3 {
  const main = clusters[0];
  const target = nodes[main.startIdx + 3] ?? nodes[main.startIdx + 1] ?? nodes[main.startIdx];
  return { x: target.x, y: target.y, z: target.z };
}

function buildWaypoints(nodes: Node3[], clusters: Cluster[]): Waypoint[] {
  const focus = pickFocusNode(nodes, clusters);
  return [
    { scroll: 0.00, camPos: { x: 0, y: 0, z: 10 }, lookAt: { x: 0, y: 0, z: 0 }, focusCluster: 0, cxFrac: 0.75, zoom: 0.76 },
    {
      scroll: 0.18,
      camPos: { x: focus.x * 0.4, y: focus.y * 0.6, z: focus.z + 5 },
      lookAt: focus,
      focusCluster: 0,
      cxFrac: 0.5,
      zoom: 1,
    },
    { scroll: 0.42, camPos: { x: 5, y: -1.5, z: 6 }, lookAt: { x: 0, y: 0, z: 0 }, focusCluster: 0, cxFrac: 0.5, zoom: 1 },
    { scroll: 0.65, camPos: { x: -5, y: 1.5, z: 6 }, lookAt: { x: 0, y: 0, z: 0 }, focusCluster: 0, cxFrac: 0.5, zoom: 1 },
    { scroll: 0.90, camPos: { x: 0, y: 1, z: 16 }, lookAt: { x: 0, y: 0, z: 0 }, focusCluster: 0, cxFrac: 0.5, zoom: 1 },
    { scroll: 1.00, camPos: { x: 0, y: 0, z: 60 }, lookAt: { x: 0, y: 0, z: 0 }, focusCluster: 0, cxFrac: 0.5, zoom: 1 },
  ];
}

/* ─────────────────────────── Math ─────────────────────────── */

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function interpolateCamera(waypoints: Waypoint[], scroll: number) {
  let i = 0;
  while (i < waypoints.length - 1 && scroll >= waypoints[i + 1].scroll) i++;
  const a = waypoints[i];
  const b = waypoints[Math.min(i + 1, waypoints.length - 1)];
  const span = b.scroll - a.scroll;
  const tRaw = span > 0 ? (scroll - a.scroll) / span : 1;
  const t = smoothstep(Math.max(0, Math.min(1, tRaw)));
  return {
    camPos: {
      x: a.camPos.x + (b.camPos.x - a.camPos.x) * t,
      y: a.camPos.y + (b.camPos.y - a.camPos.y) * t,
      z: a.camPos.z + (b.camPos.z - a.camPos.z) * t,
    },
    lookAt: {
      x: a.lookAt.x + (b.lookAt.x - a.lookAt.x) * t,
      y: a.lookAt.y + (b.lookAt.y - a.lookAt.y) * t,
      z: a.lookAt.z + (b.lookAt.z - a.lookAt.z) * t,
    },
    focusCluster: t > 0.5 ? b.focusCluster : a.focusCluster,
    cxFrac: a.cxFrac + (b.cxFrac - a.cxFrac) * t,
    zoom: a.zoom + (b.zoom - a.zoom) * t,
  };
}

function computeViewBasis(camPos: Vec3, lookAt: Vec3) {
  let fx = lookAt.x - camPos.x;
  let fy = lookAt.y - camPos.y;
  let fz = lookAt.z - camPos.z;
  const fLen = Math.hypot(fx, fy, fz) || 1;
  fx /= fLen; fy /= fLen; fz /= fLen;
  let rx = fy * 0 - fz * 1;
  let ry = fz * 0 - fx * 0;
  let rz = fx * 1 - fy * 0;
  const rLen = Math.hypot(rx, ry, rz) || 1;
  rx /= rLen; ry /= rLen; rz /= rLen;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  return { fx, fy, fz, rx, ry, rz, ux, uy, uz };
}

/* ─────────────────────────── Worker state ─────────────────────────── */

const { nodes, edges, clusters } = makeUniverse();
const waypoints = buildWaypoints(nodes, clusters);

const parents: number[] = new Array(nodes.length).fill(-1);
for (const e of edges) {
  if (nodes[e.a].cluster < 0 || nodes[e.b].cluster < 0) continue;
  parents[e.b] = e.a;
}
const spawnable: number[] = [];
for (let i = 0; i < parents.length; i++) {
  if (parents[i] >= 0) spawnable.push(i);
}

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

let cssW = 0;
let cssH = 0;
let requestedDpr = 1;
let effectiveDpr = 1;
let reducedMotion = false;
let targetScroll = 0;
let mouse: { x: number; y: number } | null = null;
let timerId: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

// Adaptive quality
let qualityTier = 0; // 0..3
let qualityDecided = false;
const FRAME_SAMPLES_TARGET = 90; // ~1.5s
const frameSamples: number[] = [];

const startT = performance.now();
let lastT = startT;
let smoothScroll = 0;

type Firing = {
  path: number[];
  idx: number;
  progress: number;
  pauseMs: number;
  fadeOutMs: number;
};
const firings: Firing[] = [];
let nextSpawnMs = 800;

const PAUSE_AT_NODE_MS = 180;
const SEGMENTS_PER_SEC = 0.65;
// the last segment, into the root, runs at this share of the speed and
// eases out, so the pulse settles into the node instead of hitting it
const LAST_SEGMENT_SPEED = 0.4;
const FADE_OUT_MS = 1300; // longer "absorption" at the root
const TAIL_LENGTH = 0.7;

/* Master opacity for the whole background network. It's decorative and
 * sits behind the content, so it's deliberately held back from full
 * strength — scaling every edge, node, label, and firing here in one
 * place keeps it present but quiet rather than competing with the copy. */
const GRAPH_BASE_OPACITY = 0.6;

const projected: { sx: number; sy: number; z: number; nodeIdx: number }[] = new Array(nodes.length);

// labels snap to the device pixel grid, so their glyphs stay sharp
const snap = (v: number) => Math.round(v * effectiveDpr) / effectiveDpr;

function applyEffectiveDpr() {
  if (!canvas || !ctx) return;
  canvas.width = Math.max(1, Math.round(cssW * effectiveDpr));
  canvas.height = Math.max(1, Math.round(cssH * effectiveDpr));
  ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
}

function decideQuality() {
  if (qualityDecided) return;
  if (frameSamples.length < FRAME_SAMPLES_TARGET) return;
  const avg = frameSamples.reduce((a, b) => a + b, 0) / frameSamples.length;
  if (avg <= 19) qualityTier = 0;
  else if (avg <= 25) qualityTier = 1;
  else if (avg <= 35) qualityTier = 2;
  else qualityTier = 3;
  qualityDecided = true;

  // tier 1 keeps full resolution; only tier 2+ gives up resolution
  if (qualityTier >= 2 && effectiveDpr > 1) {
    effectiveDpr = 1;
    applyEffectiveDpr();
  }

  postMessage({ type: "quality-tier", tier: qualityTier, avgFrameMs: avg });

  if (qualityTier >= 3) {
    // Render one final frame and stop
    drawFrame();
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    stopped = true;
  }
}

function tick() {
  if (stopped) return;
  if (!canvas || !ctx) {
    scheduleNext(16);
    return;
  }

  const now = performance.now();
  const dt = Math.min(64, now - lastT);
  lastT = now;

  if (!qualityDecided && frameSamples.length < FRAME_SAMPLES_TARGET) {
    // Skip first frame measurement — it's always inflated by init
    if (frameSamples.length === 0 && dt > 50) {
      frameSamples.push(0);
    } else {
      frameSamples.push(dt);
    }
    if (frameSamples.length >= FRAME_SAMPLES_TARGET) decideQuality();
  }

  smoothScroll += (targetScroll - smoothScroll) * (1 - Math.exp(-dt * 0.008));

  drawFrame();

  // Aim for ~60fps; if frame took longer, schedule next ASAP
  const frameDuration = performance.now() - now;
  const delay = Math.max(0, 16 - frameDuration);
  scheduleNext(delay);
}

function scheduleNext(ms: number) {
  if (stopped) return;
  timerId = setTimeout(tick, ms);
}

function drawFrame() {
  if (!canvas || !ctx) return;

  const now = performance.now();
  const t = reducedMotion ? 0 : (now - startT) / 1000;

  const { camPos, lookAt, focusCluster, cxFrac, zoom } = interpolateCamera(waypoints, smoothScroll);
  const basis = computeViewBasis(camPos, lookAt);

  const w = cssW;
  const h = cssH;
  const FOCAL = Math.min(w, h) * 0.9 * (w < 900 ? 1 : zoom);
  const cx = w * (w < 900 ? 0.5 : cxFrac);
  const cy = h / 2;

  const rotY = t * 0.04;
  const cosRY = Math.cos(rotY);
  const sinRY = Math.sin(rotY);

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const cluster = clusters[n.cluster] ?? null;
    const centre = cluster ? cluster.center : { x: 0, y: 0, z: 0 };
    const lx = n.x - centre.x;
    const lz = n.z - centre.z;
    const rx = lx * cosRY + lz * sinRY + centre.x;
    const rz = -lx * sinRY + lz * cosRY + centre.z;
    const ry = n.y;
    const dx = rx - camPos.x;
    const dy = ry - camPos.y;
    const dz = rz - camPos.z;
    const viewZ = dx * basis.fx + dy * basis.fy + dz * basis.fz;
    if (viewZ <= 0.05) {
      projected[i] = { sx: -9999, sy: -9999, z: viewZ, nodeIdx: i };
      continue;
    }
    const viewX = dx * basis.rx + dy * basis.ry + dz * basis.rz;
    const viewY = dx * basis.ux + dy * basis.uy + dz * basis.uz;
    projected[i] = {
      sx: cx + (viewX * FOCAL) / viewZ,
      sy: cy - (viewY * FOCAL) / viewZ,
      z: viewZ,
      nodeIdx: i,
    };
  }

  // Hover hit-test (cheap)
  let hoveredLocal: number | null = null;
  if (mouse) {
    let bestDist = 24;
    for (let i = 0; i < nodes.length; i++) {
      const p = projected[i];
      if (p.z <= 0) continue;
      if (nodes[i].cluster < 0) continue;
      const d = Math.hypot(p.sx - mouse.x, p.sy - mouse.y);
      if (d < bestDist) {
        bestDist = d;
        hoveredLocal = i;
      }
    }
  }

  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);

  const fadeRaw = (smoothScroll - 0.06) / 0.08;
  const fade = Math.max(0, Math.min(1, fadeRaw));
  const disappearRaw = (smoothScroll - 0.86) / 0.10;
  const disappear = Math.max(0, Math.min(1, disappearRaw));
  // Past the first screen the graph recedes hard (0.6 → 0.13) so it
  // reads as texture behind the prose sections, not a competing layer;
  // it then fully dissolves near the page bottom.
  const graphOpacity = GRAPH_BASE_OPACITY * (1 - fade * 0.78) * (1 - disappear);
  if (graphOpacity < 0.005) return;
  ctx.globalAlpha = graphOpacity;

  // Edges back to front
  const edgeOrder = edges
    .map((e, idx) => {
      const a = projected[e.a];
      const b = projected[e.b];
      return { idx, avgZ: (a.z + b.z) / 2 };
    })
    .sort((x, y) => y.avgZ - x.avgZ);

  // edges: near ones darker and heavier, far ones fade into the paper
  ctx.lineCap = "round";
  for (const eo of edgeOrder) {
    const e = edges[eo.idx];
    const pa = projected[e.a];
    const pb = projected[e.b];
    if (pa.z <= 0 || pb.z <= 0) continue;
    const depthFactor = 1 / Math.max(1, eo.avgZ * 0.35);
    const alpha = Math.max(0.05, Math.min(0.7, depthFactor * 0.62));
    ctx.strokeStyle = depthFactor > 0.3 ? `rgba(124,45,18,${alpha})` : `rgba(168,98,52,${alpha})`;
    ctx.lineWidth = Math.max(0.45, Math.min(2.2, depthFactor * 1.9));
    ctx.beginPath();
    ctx.moveTo(pa.sx, pa.sy);
    ctx.lineTo(pb.sx, pb.sy);
    ctx.stroke();
  }

  // Nodes back to front
  const nodeOrder = projected
    .map((p, i) => ({ i, z: p.z }))
    .sort((x, y) => y.z - x.z);

  for (const no of nodeOrder) {
    const p = projected[no.i];
    if (p.z <= 0) continue;
    const node = nodes[no.i];
    const isBg = node.cluster < 0;
    const isHover = hoveredLocal === no.i;
    const sizeFactor = 1 / Math.max(1, p.z * 0.22);
    const baseR = isBg ? Math.max(0.8, sizeFactor * 1.8) : Math.max(2.2, sizeFactor * 5.5);
    const r = isHover ? baseR * 1.7 : baseR;
    const alpha = Math.min(1, Math.max(0.2, sizeFactor * (isBg ? 0.9 : 1.2)));

    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r * 2.4, 0, Math.PI * 2);
    ctx.fillStyle = isBg
      ? `rgba(146,64,14,${alpha * 0.06})`
      : `rgba(146,64,14,${alpha * 0.15})`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = isBg
      ? `rgba(146,64,14,${alpha * 0.55})`
      : `rgba(146,64,14,${Math.min(1, alpha * 0.95 + (isHover ? 0.2 : 0))})`;
    ctx.fill();

    if (isHover) {
      const pulse = 1 + 0.7 * Math.sin(t * 4);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r * 2.4 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(146,64,14,${0.18 * (1 - (pulse - 1) / 0.7)})`;
      ctx.fill();
    }
  }

  /* Labels fade in based on how close a node is to the camera —
   * "foreground" nodes get their label revealed naturally as the camera
   * approaches. Hovered nodes always get a fully-opaque label even if
   * they're farther back, so visitors can probe individual citations. */
  ctx.font = '500 11px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  // Anything past LABEL_FAR is invisible; anything closer than LABEL_NEAR is full
  const LABEL_NEAR = 5;
  const LABEL_FAR = 9;
  for (const no of nodeOrder) {
    const p = projected[no.i];
    if (p.z <= 0) continue;
    const node = nodes[no.i];
    if (node.cluster < 0) continue;
    const isHover = hoveredLocal === no.i;
    /* Default render: subsection citation only — dots without one stay
     * unlabeled. On hover: always show something — fall back to the
     * variable title so every rule the user inspects gets identified. */
    const text = isHover ? (node.label || node.title) : node.label;
    if (!text) continue;
    const depthOpacity = 1 - Math.max(0, Math.min(1, (p.z - LABEL_NEAR) / (LABEL_FAR - LABEL_NEAR)));
    const opacity = isHover ? 0.95 : depthOpacity * 0.82;
    if (opacity < 0.04) continue;
    const sizeFactor = 1 / Math.max(1, p.z * 0.4);
    const r = Math.max(1.4, sizeFactor * 3.5);
    const lx = snap(p.sx + r + 7);
    const ly = snap(p.sy + 0.5);
    // a thin halo of paper lifts the label off the lines behind it
    ctx.strokeStyle = `rgba(250,249,246,${Math.min(0.9, opacity * 1.1)})`;
    ctx.lineWidth = 3;
    ctx.strokeText(text, lx, ly);
    ctx.fillStyle = isHover
      ? `rgba(124,45,18,${opacity})`
      : `rgba(28,25,23,${Math.min(1, opacity * 0.95)})`;
    ctx.fillText(text, lx, ly);
  }

  // Comet "firing" animations — skipped on quality tier 2+
  if (qualityTier < 2) {
    const sinceStartMs = now - startT;
    if (sinceStartMs >= nextSpawnMs && spawnable.length > 0) {
      const seed = spawnable[Math.floor(Math.random() * spawnable.length)];
      const path: number[] = [seed];
      let cur = seed;
      while (parents[cur] >= 0) {
        cur = parents[cur];
        path.push(cur);
      }
      if (path.length >= 2) {
        firings.push({ path, idx: 0, progress: 0, pauseMs: 0, fadeOutMs: 0 });
      }
      nextSpawnMs = sinceStartMs + 1500 + Math.random() * 2000;
    }

    const dtSec = Math.min(64, performance.now() - lastT + 16) / 1000;
    for (let fi = firings.length - 1; fi >= 0; fi--) {
      const fire = firings[fi];
      if (fire.fadeOutMs > 0) {
        fire.fadeOutMs -= 16;
        if (fire.fadeOutMs <= 0) firings.splice(fi, 1);
        continue;
      }
      if (fire.pauseMs > 0) {
        fire.pauseMs -= 16;
        continue;
      }
      const last = fire.idx === fire.path.length - 2;
      fire.progress += dtSec * SEGMENTS_PER_SEC * (last ? LAST_SEGMENT_SPEED : 1);
      if (fire.progress >= 1) {
        fire.idx++;
        if (fire.idx >= fire.path.length - 1) {
          // park the head exactly on the root (idx is the root's index)
          fire.idx = fire.path.length - 1;
          fire.progress = 0;
          fire.fadeOutMs = FADE_OUT_MS;
          continue;
        }
        fire.progress = 0;
        fire.pauseMs = PAUSE_AT_NODE_MS;
      }
    }

    ctx.lineCap = "round";
    for (const fire of firings) {
      const isAbsorbing = fire.fadeOutMs > 0;
      const fadeRatio = isAbsorbing ? Math.max(0, fire.fadeOutMs / FADE_OUT_MS) : 1;
      /* While absorbing, the tail catches up to the head (which is
       * parked on the root). Easing makes the collapse slow at first
       * then accelerate — reads as "drawn into" the node. */
      const easeIn = (x: number) => x * x;
      const effectiveTail = isAbsorbing ? TAIL_LENGTH * easeIn(fadeRatio) : TAIL_LENGTH;
      const onLast = fire.idx === fire.path.length - 2;
      const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
      const headPath = fire.idx + (onLast ? easeOut(fire.progress) : fire.progress);
      const tailPath = Math.max(0, headPath - effectiveTail);
      const totalLen = headPath - tailPath;

      if (totalLen > 0.001) {
        for (let s = 0; s < fire.path.length - 1; s++) {
          const segOverlapStart = Math.max(s, tailPath);
          const segOverlapEnd = Math.min(s + 1, headPath);
          if (segOverlapStart >= segOverlapEnd) continue;
          const pa = projected[fire.path[s]];
          const pb = projected[fire.path[s + 1]];
          if (!pa || !pb || pa.z <= 0 || pb.z <= 0) continue;
          const fStart = segOverlapStart - s;
          const fEnd = segOverlapEnd - s;
          const sx = pa.sx + (pb.sx - pa.sx) * fStart;
          const sy = pa.sy + (pb.sy - pa.sy) * fStart;
          const ex = pa.sx + (pb.sx - pa.sx) * fEnd;
          const ey = pa.sy + (pb.sy - pa.sy) * fEnd;
          const aStart = (segOverlapStart - tailPath) / totalLen;
          const aEnd = (segOverlapEnd - tailPath) / totalLen;
          const stroke = (color: string, m1: number, m2: number, width: number) => {
            const g = ctx!.createLinearGradient(sx, sy, ex, ey);
            g.addColorStop(0, color.replace("ALPHA", String(m1)));
            g.addColorStop(1, color.replace("ALPHA", String(m2)));
            ctx!.strokeStyle = g;
            ctx!.lineWidth = width;
            ctx!.beginPath();
            ctx!.moveTo(sx, sy);
            ctx!.lineTo(ex, ey);
            ctx!.stroke();
          };
          stroke("rgba(217,119,6,ALPHA)", aStart * 0.10, aEnd * 0.10, 6);
          stroke("rgba(217,119,6,ALPHA)", aStart * 0.28, aEnd * 0.28, 2.2);
          stroke("rgba(254,243,199,ALPHA)", aStart * 0.55, aEnd * 0.55, 1.0);
        }
      }

    }
  }
}

/* ─────────────────────────── Message handler ─────────────────────────── */

type Msg =
  | { type: "init"; canvas: OffscreenCanvas; w: number; h: number; dpr: number; reduced: boolean }
  | { type: "scroll"; value: number }
  | { type: "mouse"; value: { x: number; y: number } | null }
  | { type: "resize"; w: number; h: number; dpr: number }
  | { type: "reduce-motion"; value: boolean }
  | { type: "stop" };

self.onmessage = (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init": {
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
      cssW = msg.w;
      cssH = msg.h;
      requestedDpr = msg.dpr;
      effectiveDpr = Math.min(2, requestedDpr);
      reducedMotion = msg.reduced;
      applyEffectiveDpr();
      lastT = performance.now();
      scheduleNext(0);
      break;
    }
    case "scroll":
      targetScroll = msg.value;
      break;
    case "mouse":
      mouse = msg.value;
      break;
    case "resize": {
      cssW = msg.w;
      cssH = msg.h;
      requestedDpr = msg.dpr;
      effectiveDpr = qualityTier >= 2 ? 1 : Math.min(2, requestedDpr);
      applyEffectiveDpr();
      if (stopped) {
        // Quality tier 3 — re-render the single static frame at the new size
        drawFrame();
      }
      break;
    }
    case "reduce-motion":
      reducedMotion = msg.value;
      break;
    case "stop":
      stopped = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      break;
  }
};
