/**
 * The corpus field: layout + sizing for the landing screen's visual
 * census of the encoded corpus — every clean provision-rooted subtree
 * as one dot, clustered by jurisdiction, colored by bucket.
 *
 * Pure module (no DOM): the canvas renderer consumes the layout it
 * produces, and tests exercise the geometry directly. Everything is
 * deterministic — same census in, same field out.
 */

/** The TRUE intra-module structure, precomputed by the census:
 *  `n` rules, dep edges by rule index, and a layered layout in 0..1
 *  coords (roots at the top). */
export interface ModuleGraph {
  n: number;
  e: Array<[number, number]>;
  p: Array<[number, number]>;
}

export interface CorpusModule {
  target: string;
  jurisdiction: string;
  bucket: string;
  ruleCount: number;
  /** Rules referenced by / referencing anything corpus-wide. Zero =
   *  an all-standalone module (glossary definitions): field dust. */
  linkedRuleCount: number;
  importCount: number;
  /** Intra-corpus module targets this module imports (≤20). */
  imports?: string[];
  /** The deepest root the subtree computes ("cdcc"). */
  headlineRule?: string;
  /** Real structure for the module's shape; absent → schematic
   *  fallback. */
  graph?: ModuleGraph;
  /** True for live-mirror-merged modules the census hasn't sized yet:
   *  their counts are defaults, not knowledge — they get no
   *  source-backed outline. */
  presumed?: boolean;
}

export interface CorpusSubtreesFile {
  generated_from?: string;
  clean_subtrees: number;
  modules: CorpusModule[];
}

/** Abstract field coordinates; the renderer scales to its pixels. */
export const FIELD_WIDTH = 1000;
export const FIELD_HEIGHT = 440;
const FIELD_MARGIN = 26;

/** Bucket palette — pulled from the graph viewer's warm-paper family
 *  (amber statutes, the viewer's green, stone policies). */
export const BUCKET_COLORS: Record<string, string> = {
  statutes: "#b45309",
  regulations: "#166534",
  policies: "#78716c",
};
const FALLBACK_BUCKET_COLOR = "#a8a29e";

export function bucketColor(bucket: string): string {
  return BUCKET_COLORS[bucket] ?? FALLBACK_BUCKET_COLOR;
}

/* ── Scope: the app's view of the corpus is US-only ──
 * The mirror serves every jurisdiction it has (uk, be, nz, …); every
 * VIEW surface — field, picker, doors, clusters, stat counts —
 * filters to the US federal + state corpora. The API listing itself
 * stays unfiltered. */

export function isUsJurisdiction(jurisdiction: string): boolean {
  return jurisdiction === "us" || jurisdiction.startsWith("us-");
}

export function filterUsModules(modules: CorpusModule[]): CorpusModule[] {
  return modules.filter((module) => isUsJurisdiction(module.jurisdiction));
}

/** A one-node subtree isn't a graph — it never reaches a view
 *  surface (not dust: gone). */
export const MIN_VIEW_RULE_COUNT = 2;

/**
 * Composition / pipeline modules are encoding plumbing, not law —
 * the API already excludes them from the live mirror
 * (isCompositionPath in axiom-api-runtime-sync); the committed
 * census still carries 23, so the app applies the same exclusion at
 * its one view choke point. Targets are `jur:bucket/…`; the
 * "composition" patterns bite only inside policy buckets, so real
 * manual pages ("fns-210-household-composition/page-2") stay.
 */
export function isCompositionTarget(target: string): boolean {
  const path = target.replace(":", "/");
  if (path.endsWith("_pipeline")) return true;
  if (!/\/(policy|policies)\//.test(`/${path}/`)) return false;
  return (
    path.includes("state-plan-composition") ||
    path.includes("fy-2026-benefit-calculation") ||
    path.endsWith("composition") ||
    path.includes("/composition")
  );
}

/** The app's full view filter, applied once in the shared loader so
 *  every surface (field, picker, doors, clusters, counts) agrees:
 *  US-only, no single-node subtrees, no composition pipelines. */
/** Family membership: "be-wal" belongs to "be", "us-co" to "us". */
export function isCountryJurisdiction(
  jurisdiction: string,
  country: string,
): boolean {
  return jurisdiction === country || jurisdiction.startsWith(`${country}-`);
}

export function filterViewModules(
  modules: CorpusModule[],
  country = "us",
): CorpusModule[] {
  return modules.filter(
    (module) =>
      isCountryJurisdiction(module.jurisdiction, country) &&
      module.ruleCount >= MIN_VIEW_RULE_COUNT &&
      !isCompositionTarget(module.target),
  );
}

/** Draw order inside a cluster: statutes core, regulations around
 *  them, policies at the rim, anything unknown last. */
const BUCKET_ORDER: Record<string, number> = {
  statutes: 0,
  regulations: 1,
  policies: 2,
};

function bucketRank(bucket: string): number {
  return BUCKET_ORDER[bucket] ?? 3;
}

/**
 * Dot radius in abstract units: area tracks the LINKED rule count
 * (rules that actually participate in the corpus graph — sqrt
 * scaling) so an intricate subtree reads bigger without drowning the
 * field. All-standalone modules don't come through here: they render
 * as dust (see DUST_RADIUS).
 */
export function dotRadius(linkedRuleCount: number): number {
  return Math.min(7.5, 1.35 + Math.sqrt(Math.max(linkedRuleCount, 0)) * 0.6);
}

/** All-standalone modules (linkedRuleCount 0 — glossary-definition
 *  pages) render as minimal faint dust: visible, never highlighted. */
export const DUST_RADIUS = 0.7;

export function isDustModule(module: CorpusModule): boolean {
  return module.linkedRuleCount <= 0;
}

/**
 * Does this module earn the enclosing outline that marks "this
 * subtree has its source document"? Only census-KNOWN linkage counts:
 * live-merged modules carry presumed default sizes (and a missing
 * count reads as 0) — presumption is not source-backed knowledge.
 */
export function hasSourceOutline(
  module: Partial<Pick<CorpusModule, "linkedRuleCount" | "presumed">>,
): boolean {
  return !module.presumed && (module.linkedRuleCount ?? 0) > 0;
}

/** ── Computed doors ──
 * The always-visible entry points are the corpus's own largest /
 * most intricate subtrees, computed from the census — never a
 * hand-picked list. Score counts LINKED rules (glossary pages full
 * of unreferenced definitions don't get doors) with imports weighing
 * double; a per-jurisdiction cap keeps one giant corpus from
 * monopolizing every door. */
export const HIGHLIGHT_COUNT = 14;
export const HIGHLIGHT_MAX_PER_JURISDICTION = 3;

/** Roots known not to compile to an executable program (versioned
 *  formulas — engine#133). They stay on the field; they make poor
 *  doors. */
export const NON_COMPILING_ROOTS: ReadonlySet<string> = new Set([
  "us:statutes/42/1396a/a/10",
  "us:statutes/42/415/a",
  "us:statutes/42/415/b",
  "us:statutes/42/415/i",
  // Composes but doesn't execute: run-by-root 422s on a parameter with
  // no value at the run date (article 114 professional-past limit).
  "be:regulations/unemployment/benefit_amount",
]);

export function highlightScore(module: CorpusModule): number {
  return module.linkedRuleCount + 2 * module.importCount;
}

/** A size-based door needs real substance: below this score a module
 *  rides the field unlabeled however empty its jurisdiction's door
 *  quota is (small regional corpora were winning doors by quota
 *  alone). Pins are exempt. */
export const MIN_HIGHLIGHT_SCORE = 12;

/** Jurisdictions whose modules ride the field but never take a door —
 *  a presentation choice, not a data one (the German-speaking
 *  Community's family-benefit modules are substantial but the
 *  country-level doors should lead). */
export const DOORLESS_JURISDICTIONS: ReadonlySet<string> = new Set(["be-dg"]);

/** Doors the corpus must always offer, whatever the size formula
 *  says. Verified compiling (run-by-root answers 200 with outputs):
 *  EITC — 24 rules, headline "eitc", census graph, 4 imports. Pinned
 *  entries extend the count and the per-jurisdiction cap gracefully
 *  (the US may show 4 doors) — they never evict a size-based pick. */
export const PINNED_HIGHLIGHT_TARGETS: readonly string[] = [
  "us:statutes/26/32",
  // Belgium's flagship doors: verified composing statute modules
  // (company-car benefit, the special social-security contribution,
  // and the elderly income-guarantee payable amount).
  "be:statutes/income_tax/benefits/company_car",
  "be:statutes/social_security/special_contribution",
  "be:statutes/income_guarantee_for_elderly/payable_amount",
];

export function computeFieldHighlights(
  modules: CorpusModule[],
  count = HIGHLIGHT_COUNT,
  maxPerJurisdiction = HIGHLIGHT_MAX_PER_JURISDICTION,
): CorpusModule[] {
  // Door density scales with the corpus: a ~100-module country field
  // doesn't need the 14 doors the 4,400-module US field earns. Only
  // the default count adapts — explicit counts stay literal.
  const sizeTarget =
    count === HIGHLIGHT_COUNT
      ? Math.min(count, Math.max(4, Math.round(modules.length / 22)))
      : count;
  const ranked = [...modules].sort(
    (a, b) =>
      highlightScore(b) - highlightScore(a) ||
      a.target.localeCompare(b.target),
  );
  const pinned = new Set(PINNED_HIGHLIGHT_TARGETS);
  const perJurisdiction = new Map<string, number>();
  const picked: CorpusModule[] = [];
  let sizePicked = 0;
  for (const module of ranked) {
    // Pinned doors ride along at their ranked position, outside the
    // count and the per-jurisdiction cap — never evicting a
    // size-based pick. Dust and non-compiling roots stay banned even
    // when pinned (a pin is a promise the door works).
    if (
      pinned.has(module.target) &&
      !isDustModule(module) &&
      !NON_COMPILING_ROOTS.has(module.target)
    ) {
      picked.push(module);
      continue;
    }
    // Keep scanning past the count: a pinned target may rank lower.
    if (sizePicked >= sizeTarget) continue;
    // Dust never gets a door, and neither do roots we know can't
    // execute. (Callers pass the mirror-authoritative module list, so
    // targets absent from the live mirror are already gone.)
    if (isDustModule(module)) continue;
    if (NON_COMPILING_ROOTS.has(module.target)) continue;
    if (highlightScore(module) < MIN_HIGHLIGHT_SCORE) continue;
    if (DOORLESS_JURISDICTIONS.has(module.jurisdiction)) continue;
    const used = perJurisdiction.get(module.jurisdiction) ?? 0;
    if (used >= maxPerJurisdiction) continue;
    perJurisdiction.set(module.jurisdiction, used + 1);
    picked.push(module);
    sizePicked += 1;
  }
  return picked;
}

export interface FieldDot {
  target: string;
  jurisdiction: string;
  bucket: string;
  ruleCount: number;
  linkedRuleCount: number;
  importCount: number;
  headlineRule: string | null;
  /** Real intra-module structure (shared reference, never copied). */
  structure: ModuleGraph | null;
  /** All-standalone module — rendered as faint dust. */
  dust: boolean;
  /** Census-known linked rules → the source-backed outline ring. */
  sourceOutline: boolean;
  /** The source document family (documentStem) — same-stem dots sit
   *  snug, different-stem dots keep GROUP_CLEARANCE. */
  docStem: string;
  x: number;
  y: number;
  r: number;
  color: string;
  highlightLabel: string | null;
}

/** An import relation between two laid-out dots (indices into
 *  layout.dots). weight 2 = mutual import. */
export interface FieldLink {
  a: number;
  b: number;
  weight: number;
}

export interface FieldCluster {
  jurisdiction: string;
  x: number;
  y: number;
  r: number;
  moduleCount: number;
  ruleCount: number;
}

export interface FieldLayout {
  width: number;
  height: number;
  dots: FieldDot[];
  clusters: FieldCluster[];
  /** Import filaments, drawn at mid zoom. */
  links: FieldLink[];
}

/** Clusters with at least this many modules earn a text label —
 *  labelling all 52 jurisdictions would wallpaper the field. */
export const CLUSTER_LABEL_MIN_MODULES = 2;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface PackedCluster {
  jurisdiction: string;
  modules: CorpusModule[];
  clusterR: number;
  x: number;
  y: number;
}

/**
 * Phyllotaxis positions for one cluster's dots, bucket-sorted so each
 * bucket forms a contiguous ring band (statutes core → policies rim).
 * Returns offsets relative to the cluster center plus the packed
 * radius actually used.
 */
/** A module's abstract dot radius: linked-rule sized, or dust. */
function moduleRadius(module: CorpusModule): number {
  return isDustModule(module)
    ? DUST_RADIUS
    : dotRadius(module.linkedRuleCount);
}

/** One sort for offsets AND dot emission — they must stay aligned. */
function clusterSort(a: CorpusModule, b: CorpusModule): number {
  return (
    bucketRank(a.bucket) - bucketRank(b.bucket) ||
    b.linkedRuleCount - a.linkedRuleCount ||
    b.ruleCount - a.ruleCount ||
    a.target.localeCompare(b.target)
  );
}

/* ── Document grouping ──
 * Subtrees that share a source document family read as one
 * constellation: snug together, clearly separated from other
 * groups. The stem names the family:
 * - statutes: title/section ("us:statutes/26/32" — one section, one
 *   family, subsections included).
 * - regulations: slug + integer part ("us:regulations/7-cfr/273";
 *   dotted state sections group by their part — "4.410" → part 4).
 * - policies / guidance / manual (and strays): three segments —
 *   agency/program/document ("us-nc:policies/dhhs/fns/fns-340-…"). */
export function documentStem(target: string): string {
  const colon = target.indexOf(":");
  if (colon < 0) return target;
  const jurisdiction = target.slice(0, colon);
  const [bucket, ...rest] = target
    .slice(colon + 1)
    .split("/")
    .filter(Boolean);
  if (!bucket || rest.length === 0) return target;
  if (bucket === "statutes") {
    return `${jurisdiction}:${bucket}/${rest.slice(0, 2).join("/")}`;
  }
  if (bucket === "regulations") {
    const slug = rest[0]!;
    const part = rest[1] ? rest[1].split(".")[0]! : null;
    return `${jurisdiction}:${bucket}/${[slug, part]
      .filter(Boolean)
      .join("/")}`;
  }
  return `${jurisdiction}:${bucket}/${rest.slice(0, 3).join("/")}`;
}

/** Phyllotaxis spacing WITHIN a document group — snug relative to
 *  the inter-group water, but already close to the enforced margin
 *  floor so the relaxation barely has to move anyone. */
export const GROUP_SPACING = 2.55;
/** Rim allowance around a group's members, × the group's mean dot
 *  radius — pre-reserves the inter-group clearance the relaxation
 *  enforces, so groups rarely inflate past their declared circle.
 *  Singleton "groups" (one lone document section) carry a slimmer
 *  rim: over a thousand of them, a full rim each would shrink the
 *  whole field's fit scale for nothing. */
const GROUP_RIM = 1.7;
const GROUP_RIM_SINGLETON = 1.1;
/** How far apart the group spiral spreads, × the area-faithful
 *  radius (1 = groups touch; more = clear water between families). */
const GROUP_SPREAD = 1.45;

interface PlacedClusterDots {
  /** Emission order — offsets are index-aligned with this list. */
  modules: CorpusModule[];
  offsets: Array<{ dx: number; dy: number }>;
  radius: number;
}

/** One group's own snug phyllotaxis. */
function placeGroupMembers(members: CorpusModule[]): {
  offsets: Array<{ dx: number; dy: number }>;
  radius: number;
} {
  const meanR =
    members.reduce((sum, m) => sum + moduleRadius(m), 0) /
    Math.max(members.length, 1);
  const spacing = meanR * GROUP_SPACING;
  const offsets: Array<{ dx: number; dy: number }> = [];
  let radius = 0;
  members.forEach((_, index) => {
    const r = spacing * Math.sqrt(index + 0.4);
    const theta = index * GOLDEN_ANGLE;
    offsets.push({ dx: Math.cos(theta) * r, dy: Math.sin(theta) * r });
    radius = Math.max(radius, r);
  });
  const rim = members.length === 1 ? GROUP_RIM_SINGLETON : GROUP_RIM;
  return { offsets, radius: radius + meanR * rim };
}

/**
 * Two-level placement: document groups on an area-faithful spiral
 * (each group a mini-cluster of its members), so families read as
 * distinct constellations inside the jurisdiction. The collision
 * relaxation downstream guarantees the hard gaps; this pass gives it
 * a start that already looks grouped. Deterministic.
 */
function placeClusterDots(modules: CorpusModule[]): PlacedClusterDots {
  const byStem = new Map<string, CorpusModule[]>();
  for (const module of modules) {
    const stem = documentStem(module.target);
    const list = byStem.get(stem);
    if (list) list.push(module);
    else byStem.set(stem, [module]);
  }
  const groups = [...byStem.entries()].map(([stem, members]) => {
    const sorted = [...members].sort(clusterSort);
    const placed = placeGroupMembers(sorted);
    return {
      stem,
      members: sorted,
      offsets: placed.offsets,
      radius: placed.radius,
      bucket: sorted[0]!.bucket,
      linked: sorted.reduce((sum, m) => sum + m.linkedRuleCount, 0),
    };
  });
  // Statutes core → policies rim (the field's reading order), then
  // the most intricate families first, then stable.
  groups.sort(
    (a, b) =>
      bucketRank(a.bucket) - bucketRank(b.bucket) ||
      b.linked - a.linked ||
      b.members.length - a.members.length ||
      a.stem.localeCompare(b.stem),
  );
  // Area-faithful spiral for group centers: each next group lands at
  // the radius its cumulative area earns, spread for clear water.
  const orderedModules: CorpusModule[] = [];
  const offsets: Array<{ dx: number; dy: number }> = [];
  let radius = 0;
  let cumArea = 0;
  groups.forEach((group, index) => {
    const rho =
      index === 0
        ? 0
        : GROUP_SPREAD *
          Math.sqrt(cumArea + 0.5 * group.radius * group.radius);
    cumArea += group.radius * group.radius;
    const theta = index * GOLDEN_ANGLE;
    const cx = Math.cos(theta) * rho;
    const cy = Math.sin(theta) * rho;
    group.members.forEach((member, memberIndex) => {
      const offset = group.offsets[memberIndex]!;
      orderedModules.push(member);
      offsets.push({ dx: cx + offset.dx, dy: cy + offset.dy });
    });
    radius = Math.max(radius, rho + group.radius);
  });
  return { modules: orderedModules, offsets, radius };
}

/**
 * Greedy circle packing: biggest cluster first at the field center,
 * every next cluster walks an outward spiral until it fits without
 * overlapping anything already placed. Deterministic; the x-axis is
 * stretched to fill the field's landscape aspect.
 */
function packClusters(
  clusters: Array<{ jurisdiction: string; modules: CorpusModule[]; clusterR: number }>,
): PackedCluster[] {
  const aspect = FIELD_WIDTH / FIELD_HEIGHT;
  const placed: PackedCluster[] = [];
  const ordered = [...clusters].sort(
    (a, b) =>
      b.clusterR - a.clusterR || a.jurisdiction.localeCompare(b.jurisdiction),
  );
  for (const cluster of ordered) {
    if (placed.length === 0) {
      placed.push({ ...cluster, x: 0, y: 0 });
      continue;
    }
    let t = 0;
    // Spiral search: angle advances by the golden angle, radius grows
    // slowly; the first collision-free spot wins.
    for (let step = 0; step < 20000; step += 1) {
      t += 0.6;
      const angle = step * GOLDEN_ANGLE;
      const x = Math.cos(angle) * t * aspect * 0.55;
      const y = Math.sin(angle) * t * 0.55;
      const pad = 28;
      const collides = placed.some(
        (other) =>
          Math.hypot(other.x - x, other.y - y) <
          other.clusterR + cluster.clusterR + pad,
      );
      if (!collides) {
        placed.push({ ...cluster, x, y });
        break;
      }
    }
    if (placed[placed.length - 1]?.jurisdiction !== cluster.jurisdiction) {
      // Spiral exhausted (cannot happen with sane data) — stack at
      // the rim rather than dropping a jurisdiction silently.
      placed.push({ ...cluster, x: 0, y: 0 });
    }
  }
  return placed;
}

/**
 * Build the whole field: cluster per jurisdiction, dot per module,
 * everything fit-transformed into FIELD_WIDTH × FIELD_HEIGHT.
 */
export function buildFieldLayout(
  modules: CorpusModule[],
  highlightLabels?: ReadonlyMap<string, string>,
): FieldLayout {
  const byJurisdiction = new Map<string, CorpusModule[]>();
  for (const module of modules) {
    const list = byJurisdiction.get(module.jurisdiction);
    if (list) list.push(module);
    else byJurisdiction.set(module.jurisdiction, [module]);
  }

  const packedInput = [...byJurisdiction.entries()].map(
    ([jurisdiction, members]) => {
      const { radius } = placeClusterDots(members);
      return { jurisdiction, modules: members, clusterR: radius };
    },
  );
  const packed = packClusters(packedInput);

  // Fit everything into the field rectangle with a margin.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const cluster of packed) {
    minX = Math.min(minX, cluster.x - cluster.clusterR);
    maxX = Math.max(maxX, cluster.x + cluster.clusterR);
    minY = Math.min(minY, cluster.y - cluster.clusterR);
    maxY = Math.max(maxY, cluster.y + cluster.clusterR);
  }
  if (packed.length === 0) {
    return {
      width: FIELD_WIDTH,
      height: FIELD_HEIGHT,
      dots: [],
      clusters: [],
      links: [],
    };
  }
  const scale = Math.min(
    (FIELD_WIDTH - FIELD_MARGIN * 2) / Math.max(maxX - minX, 1),
    (FIELD_HEIGHT - FIELD_MARGIN * 2) / Math.max(maxY - minY, 1),
  );
  const offsetX =
    FIELD_WIDTH / 2 - ((minX + maxX) / 2) * scale;
  const offsetY =
    FIELD_HEIGHT / 2 - ((minY + maxY) / 2) * scale;

  const highlightByTarget =
    highlightLabels ?? new Map<string, string>();

  const dots: FieldDot[] = [];
  const clusters: FieldCluster[] = [];
  const moduleByDotIndex: CorpusModule[] = [];
  for (const cluster of packed) {
    // One placement, one order: the group-aware layout returns its
    // own emission order, offsets index-aligned.
    const { modules: orderedModules, offsets } = placeClusterDots(
      cluster.modules,
    );
    const cx = cluster.x * scale + offsetX;
    const cy = cluster.y * scale + offsetY;
    orderedModules.forEach((module, index) => {
      const offset = offsets[index]!;
      const highlightLabel = highlightByTarget.get(module.target) ?? null;
      const dust = isDustModule(module);
      const baseR = moduleRadius(module) * scale;
      moduleByDotIndex.push(module);
      dots.push({
        target: module.target,
        jurisdiction: module.jurisdiction,
        bucket: module.bucket,
        ruleCount: module.ruleCount,
        linkedRuleCount: module.linkedRuleCount,
        importCount: module.importCount,
        headlineRule: module.headlineRule ?? null,
        structure: module.graph ?? null,
        dust,
        sourceOutline: hasSourceOutline(module),
        docStem: documentStem(module.target),
        x: cx + offset.dx * scale,
        y: cy + offset.dy * scale,
        // Every dot survives the fit-shrink; highlighted doors get a
        // guaranteed presence even inside a dense cluster. Dust stays
        // minimal by design.
        r: Math.max(baseR, highlightLabel ? 5 : dust ? 0.5 : 0.8),
        color: bucketColor(module.bucket),
        highlightLabel,
      });
    });
    clusters.push({
      jurisdiction: cluster.jurisdiction,
      x: cx,
      y: cy,
      r: cluster.clusterR * scale,
      moduleCount: cluster.modules.length,
      ruleCount: cluster.modules.reduce((sum, m) => sum + m.ruleCount, 0),
    });
  }

  const links = buildFieldLinks(dots, moduleByDotIndex);
  applyImportAttraction(dots, clusters, links);
  // Hard invariant, resolved LAST so it survives every earlier pass:
  // no two footprints intersect, label space included.
  resolveFootprintCollisions(dots);
  // Clusters own their dots' final positions: grow each territory to
  // the enclosing circle so identity (labels, containment framing)
  // stays honest after the relaxation.
  for (const cluster of clusters) {
    let enclosing = cluster.r;
    for (const dot of dots) {
      if (dot.jurisdiction !== cluster.jurisdiction) continue;
      enclosing = Math.max(
        enclosing,
        Math.hypot(dot.x - cluster.x, dot.y - cluster.y) + dot.r,
      );
    }
    cluster.r = enclosing;
  }

  return { width: FIELD_WIDTH, height: FIELD_HEIGHT, dots, clusters, links };
}

/** Import edges between laid-out dots, deduped; a mutual import
 *  carries weight 2. Deterministic: ordered by (a, b) dot index. */
function buildFieldLinks(
  dots: FieldDot[],
  modules: CorpusModule[],
): FieldLink[] {
  const indexByTarget = new Map(dots.map((dot, index) => [dot.target, index]));
  const weights = new Map<string, FieldLink>();
  modules.forEach((module, from) => {
    for (const imported of module.imports ?? []) {
      const to = indexByTarget.get(imported);
      if (to === undefined || to === from) continue;
      const a = Math.min(from, to);
      const b = Math.max(from, to);
      const key = `${a}:${b}`;
      const existing = weights.get(key);
      if (existing) existing.weight += 1;
      else weights.set(key, { a, b, weight: 1 });
    }
  });
  return [...weights.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}

/* Import gravity: a light deterministic attraction pass — modules
 * that import each other drift toward one another (across clusters
 * they meet at the facing rims), then every dot is clamped back
 * inside its jurisdiction's territory so the document grouping
 * stays absolute. */
const ATTRACTION_PASSES = 12;
const ATTRACTION_STRENGTH = 0.055;

function applyImportAttraction(
  dots: FieldDot[],
  clusters: FieldCluster[],
  links: FieldLink[],
): void {
  if (links.length === 0) return;
  const clusterByJurisdiction = new Map(
    clusters.map((cluster) => [cluster.jurisdiction, cluster]),
  );
  for (let pass = 0; pass < ATTRACTION_PASSES; pass += 1) {
    for (const link of links) {
      const a = dots[link.a]!;
      const b = dots[link.b]!;
      const pull = ATTRACTION_STRENGTH * Math.min(link.weight, 2);
      const dx = (b.x - a.x) * pull;
      const dy = (b.y - a.y) * pull;
      a.x += dx;
      a.y += dy;
      b.x -= dx;
      b.y -= dy;
    }
    // Containment: the grouping is non-negotiable — pull any escapee
    // back to its cluster's rim.
    for (const link of links) {
      for (const index of [link.a, link.b]) {
        const dot = dots[index]!;
        const cluster = clusterByJurisdiction.get(dot.jurisdiction);
        if (!cluster) continue;
        const limit = Math.max(cluster.r - dot.r, cluster.r * 0.35);
        const dx = dot.x - cluster.x;
        const dy = dot.y - cluster.y;
        const dist = Math.hypot(dx, dy);
        if (dist > limit && dist > 0) {
          dot.x = cluster.x + (dx / dist) * limit;
          dot.y = cluster.y + (dy / dist) * limit;
        }
      }
    }
  }
}

/* ── Hard no-overlap: footprints never intersect ──
 * Layout passes (phyllotaxis, import attraction, highlight floors)
 * are heuristics; this is the guarantee. After everything else, a
 * deterministic relaxation separates every colliding footprint pair
 * along its own axis — both axes, not just radially — until no two
 * circles intersect, with a real margin. Dots that draw a title get
 * extra clearance so the label band doesn't sit on a neighbor. */

/** Minimum clear gap between two footprints, as a fraction of the
 *  SMALLER footprint's radius. */
export const FOOTPRINT_MARGIN_RATIO = 0.15;
/** …and as a fraction of the LARGER footprint: big, intricate
 *  subtrees command clearance proportional to their own size, not
 *  their smallest neighbor's. The margin is the max of the two. */
export const FOOTPRINT_MARGIN_RATIO_MAX = 0.35;
/** Extra field-unit clearance around dots that draw a subtree title
 *  (dotEarnsLabel), reserving room for the label band. */
export const LABEL_CLEARANCE = 0.6;
/** Extra clearance between dots of DIFFERENT document families —
 *  same-stem dots stay snug; the space lives between groups. */
export const GROUP_CLEARANCE = 1.2;
const MAX_RESOLUTION_PASSES = 200;
/** Group clearance is a PREFERENCE, enforced for this many passes —
 *  in a wall-clamped dense cluster full clearance can be
 *  unsatisfiable, and it must never stop the hard footprint
 *  invariant from converging (or burn the whole pass budget). */
const GROUP_CLEARANCE_PASSES = 40;

export function collisionRadius(
  dot: Pick<FieldDot, "r" | "dust" | "headlineRule" | "sourceOutline">,
): number {
  return dot.r + (dotEarnsLabel(dot) ? LABEL_CLEARANCE : 0);
}

/** The size-scaled margin between two footprints. */
export function footprintMargin(ra: number, rb: number): number {
  return Math.max(
    FOOTPRINT_MARGIN_RATIO * Math.min(ra, rb),
    FOOTPRINT_MARGIN_RATIO_MAX * Math.max(ra, rb),
  );
}

/** The center distance two dots must keep: both collision radii,
 *  the size-scaled margin, and — across document families — the
 *  inter-group clearance. */
export function requiredFootprintGap(a: FieldDot, b: FieldDot): number {
  return (
    collisionRadius(a) +
    collisionRadius(b) +
    footprintMargin(a.r, b.r) +
    (a.docStem === b.docStem ? 0 : GROUP_CLEARANCE)
  );
}

/** Spatial-grid pair walk: calls fn for every (i, j>i) pair whose
 *  centers sit within `reach` of each other (cell size = reach, 3×3
 *  neighborhood). Deterministic: ascending i, then ascending j.
 *  Numeric keys — this runs hot inside the relaxation. */
const GRID_STRIDE = 1 << 16;
function forEachClosePair(
  dots: FieldDot[],
  reach: number,
  fn: (i: number, j: number) => void,
): void {
  const cell = Math.max(reach, 1);
  const grid = new Map<number, number[]>();
  for (let index = 0; index < dots.length; index += 1) {
    const dot = dots[index]!;
    const key =
      Math.floor(dot.x / cell) * GRID_STRIDE + Math.floor(dot.y / cell);
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  }
  for (let i = 0; i < dots.length; i += 1) {
    const dot = dots[i]!;
    const gx = Math.floor(dot.x / cell);
    const gy = Math.floor(dot.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get((gx + dx) * GRID_STRIDE + (gy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j > i) fn(i, j);
        }
      }
    }
  }
}

function resolveFootprintCollisions(dots: FieldDot[]): void {
  if (dots.length < 2) return;
  let maxCollision = 0;
  for (const dot of dots) {
    maxCollision = Math.max(maxCollision, collisionRadius(dot));
  }
  const reach =
    maxCollision * (2 + FOOTPRINT_MARGIN_RATIO_MAX) + GROUP_CLEARANCE;
  // Precompute per-dot collision radii once — they never change.
  const cr = dots.map((dot) => collisionRadius(dot));
  const stems = dots.map((dot) => dot.docStem);
  let clearance = GROUP_CLEARANCE;
  const needFor = (i: number, j: number): number => {
    const a = dots[i]!;
    const b = dots[j]!;
    return (
      cr[i]! +
      cr[j]! +
      footprintMargin(a.r, b.r) +
      (stems[i] === stems[j] ? 0 : clearance)
    );
  };
  for (let pass = 0; pass < MAX_RESOLUTION_PASSES; pass += 1) {
    if (pass === GROUP_CLEARANCE_PASSES) clearance = 0;
    // Collect, then push: the pair set is fixed per pass (grid walk
    // is already (i asc, j asc) deterministic).
    const pairs: number[] = [];
    forEachClosePair(dots, reach, (i, j) => {
      const a = dots[i]!;
      const b = dots[j]!;
      const need = needFor(i, j);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx * dx + dy * dy < need * need - 1e-9) {
        pairs.push(i, j);
      }
    });
    if (pairs.length === 0) return;
    for (let p = 0; p < pairs.length; p += 2) {
      const i = pairs[p]!;
      const j = pairs[p + 1]!;
      const a = dots[i]!;
      const b = dots[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const need = needFor(i, j);
      if (dist >= need) continue; // an earlier push already fixed it
      let ux: number;
      let uy: number;
      if (dist > 1e-9) {
        ux = dx / dist;
        uy = dy / dist;
      } else {
        // Coincident centers: a stable hashed direction, so the tie
        // breaks the same way every build.
        const angle =
          ((targetHash(a.target + b.target) % 360) / 360) * Math.PI * 2;
        ux = Math.cos(angle);
        uy = Math.sin(angle);
      }
      // Slight overshoot converges in far fewer passes than exact
      // separation, at no visible cost.
      const push = (need - dist) * 0.6 + 0.01;
      a.x -= ux * push;
      a.y -= uy * push;
      b.x += ux * push;
      b.y += uy * push;
    }
    // The field's edges are walls — nothing leaves the world.
    for (const dot of dots) {
      dot.x = clampNumber(dot.x, dot.r, FIELD_WIDTH - dot.r);
      dot.y = clampNumber(dot.y, dot.r, FIELD_HEIGHT - dot.r);
    }
  }
}

/**
 * The invariant, countable: footprint pairs that intersect (or sit
 * closer than the margin). Grid-accelerated — the renderer stamps
 * the count on the host once per layout, tests assert zero over the
 * committed census.
 */
export function countFootprintCollisions(dots: FieldDot[]): number {
  if (dots.length < 2) return 0;
  let maxR = 0;
  for (const dot of dots) maxR = Math.max(maxR, dot.r);
  const reach = maxR * (2 + FOOTPRINT_MARGIN_RATIO_MAX);
  let collisions = 0;
  forEachClosePair(dots, reach, (i, j) => {
    const a = dots[i]!;
    const b = dots[j]!;
    const need = a.r + b.r + footprintMargin(a.r, b.r);
    if (Math.hypot(b.x - a.x, b.y - a.y) < need - 1e-6) {
      collisions += 1;
    }
  });
  return collisions;
}

/**
 * The grouping, measurable: per dot, the edge-to-edge gap to its
 * nearest SAME-family neighbor and its nearest OTHER-family neighbor
 * (within the jurisdiction). Distinct constellations mean the median
 * inter-group gap clearly exceeds the median intra-group gap.
 * O(Σ cluster²) once per layout — cheap at census scale.
 */
export function groupSeparationStats(dots: FieldDot[]): {
  intraMedian: number;
  interMedian: number;
} {
  const byJurisdiction = new Map<string, FieldDot[]>();
  for (const dot of dots) {
    const list = byJurisdiction.get(dot.jurisdiction);
    if (list) list.push(dot);
    else byJurisdiction.set(dot.jurisdiction, [dot]);
  }
  const intra: number[] = [];
  const inter: number[] = [];
  for (const members of byJurisdiction.values()) {
    for (let i = 0; i < members.length; i += 1) {
      const a = members[i]!;
      let nearestSame = Infinity;
      let nearestOther = Infinity;
      for (let j = 0; j < members.length; j += 1) {
        if (j === i) continue;
        const b = members[j]!;
        const gap = Math.hypot(b.x - a.x, b.y - a.y) - a.r - b.r;
        if (a.docStem === b.docStem) {
          nearestSame = Math.min(nearestSame, gap);
        } else {
          nearestOther = Math.min(nearestOther, gap);
        }
      }
      if (Number.isFinite(nearestSame)) intra.push(nearestSame);
      if (Number.isFinite(nearestOther)) inter.push(nearestOther);
    }
  }
  const median = (values: number[]): number => {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  return { intraMedian: median(intra), interMedian: median(inter) };
}

/**
 * Nearest dot under the pointer, in field coordinates. `slack` widens
 * every dot's ring so 1-unit dots are actually hoverable; among
 * candidates the closest center wins, ties to the smaller dot so a
 * giant neighbour can't swallow a small one.
 */
export function hitTestDot(
  dots: FieldDot[],
  x: number,
  y: number,
  slack = 3,
): FieldDot | null {
  let best: FieldDot | null = null;
  let bestDist = Infinity;
  for (const dot of dots) {
    const dist = Math.hypot(dot.x - x, dot.y - y);
    if (dist > dot.r + slack) continue;
    if (dist < bestDist || (dist === bestDist && best && dot.r < best.r)) {
      best = dot;
      bestDist = dist;
    }
  }
  return best;
}

/* ── LOD: a plane of graphs at every zoom ──
 * Every module renders as its graph SHAPE at every zoom — its true
 * census structure where the census carries one, the schematic
 * hub-and-satellites otherwise. There is no filled disc body at any
 * LOD. Past FILAMENT_ZOOM the import filaments fade in; MOTIF_ZOOM
 * remains as the "you can read individual structures now" label
 * threshold (data-lod). (The REAL interactive graph still loads only
 * on entry.) */
export const FILAMENT_ZOOM = 1.5;
export const MOTIF_ZOOM = 3.2;

export interface MotifNode {
  dx: number;
  dy: number;
  r: number;
}

/** Small deterministic hash for stable per-module motif rotation. */
function targetHash(target: string): number {
  let hash = 0;
  for (let i = 0; i < target.length; i += 1) {
    hash = (hash * 31 + target.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * The schematic mini-graph for one subtree: a hub plus satellites —
 * count scaled by linked rules, one extra marked satellite per
 * import (capped) — all inside the dot's own radius. Deterministic
 * per target (rotation from a target hash); dust gets no motif.
 */
export function motifSpec(dot: FieldDot): MotifNode[] {
  if (dot.dust) return [];
  const satellites = Math.min(
    8,
    2 +
      Math.round(Math.sqrt(Math.max(dot.linkedRuleCount, 1))) +
      Math.min(dot.importCount, 2),
  );
  const rotation =
    ((targetHash(dot.target) % 360) / 360) * Math.PI * 2;
  const orbit = dot.r * 0.62;
  const nodes: MotifNode[] = [];
  for (let i = 0; i < satellites; i += 1) {
    const angle = rotation + (i / satellites) * Math.PI * 2;
    nodes.push({
      dx: Math.cos(angle) * orbit,
      dy: Math.sin(angle) * orbit,
      r: Math.max(dot.r * 0.09, 0.22),
    });
  }
  return nodes;
}

export interface TrueMotif {
  nodes: MotifNode[];
  edges: Array<[number, number]>;
}

/**
 * The REAL mini-graph for a subtree, from the census's precomputed
 * layered layout: nodes at `p` scaled into the dot's footprint
 * (roots at the top), edges from `e`. Null when the census carries
 * no structure — the schematic motifSpec is the fallback. Pure
 * scaling; a draw swap, never layout work.
 */
export function trueMotifSpec(dot: FieldDot): TrueMotif | null {
  const structure = dot.structure;
  if (!structure || structure.p.length === 0) return null;
  // 0..1 box → centered square whose corners stay inside the dot
  // (half-diagonal ≤ 0.95r).
  const side = dot.r * 1.34;
  // Nodes are punctuation, not beads: the edge-work carries the shape.
  const nodeR = Math.max(dot.r * 0.035, 0.18);
  return {
    nodes: structure.p.map(([x, y]) => ({
      dx: (x - 0.5) * side,
      dy: (y - 0.5) * side,
      r: nodeR,
    })),
    edges: structure.e,
  };
}

/* ── The one shape decision ──
 * What a dot IS on the canvas, decided once for every zoom level:
 * dust stays dust, a census graph is the module's true shape, and
 * everything else gets the schematic. Deliberately zoom-free — the
 * representation never changes with the camera, only how much node
 * detail the renderer can afford to draw (shapeRendersNodes). */
export type DotShape =
  | { kind: "dust" }
  | { kind: "true"; motif: TrueMotif }
  | { kind: "schematic"; nodes: MotifNode[] };

export function dotShapeSpec(dot: FieldDot): DotShape {
  if (dot.dust) return { kind: "dust" };
  const trueMotif = trueMotifSpec(dot);
  if (trueMotif) return { kind: "true", motif: trueMotif };
  return { kind: "schematic", nodes: motifSpec(dot) };
}

/** Below this on-screen radius (CSS px) a shape draws as edges only —
 *  per-node dots would be sub-pixel noise AND a perf tax with ~2,900
 *  shapes on screen. Never a filled circle either way. */
export const NODE_DETAIL_MIN_PX = 5;

export function shapeRendersNodes(pxRadius: number): boolean {
  return pxRadius >= NODE_DETAIL_MIN_PX;
}

/* ── Subtree titles ──
 * Every subtree grouped under a source document — a census headline
 * rule OR source-backed linkage — earns a small muted label beneath
 * its footprint once the camera is close enough to read it. The
 * renderer supplies the text (humanized headline, else humanized
 * citation) and dedupes overlaps in screen space; this module owns
 * only the WHO and the WHEN. */

/* Two-tier label LOD: a subtree with a census HEADLINE rule names
 * itself as soon as its footprint is readable; citation-fallback
 * titles (source-backed but headline-less) wait for a deeper zoom
 * and reveal progressively under a lower per-frame cap — zooming in
 * meets the important names first, never a wall of citations. */

/** On-screen footprint radius (CSS px) at which a HEADLINE title
 *  appears — at far zoom, unlabeled is fine. */
export const SUBTREE_LABEL_MIN_PX = 14;
/** Citation-fallback titles wait for twice the footprint. */
export const SUBTREE_FALLBACK_LABEL_MIN_PX = 26;
/** At most this many fallback titles per frame (headline titles own
 *  the rest of the label budget). */
export const FALLBACK_LABELS_PER_FRAME = 20;

export function dotEarnsLabel(
  dot: Pick<FieldDot, "dust" | "headlineRule" | "sourceOutline">,
): boolean {
  return !dot.dust && (dot.headlineRule !== null || dot.sourceOutline);
}

/** The footprint size (CSS px) this dot's title tier requires. */
export function labelMinPx(dot: Pick<FieldDot, "headlineRule">): number {
  return dot.headlineRule !== null
    ? SUBTREE_LABEL_MIN_PX
    : SUBTREE_FALLBACK_LABEL_MIN_PX;
}

export interface CorpusFieldStats {
  subtrees: number;
  rules: number;
}

export function corpusFieldStats(modules: CorpusModule[]): CorpusFieldStats {
  return {
    subtrees: modules.length,
    rules: modules.reduce((sum, m) => sum + m.ruleCount, 0),
  };
}

/** Where the field's subtree list came from: the live rulespec
 *  mirror, or the committed census snapshot (fallback). */
export type CorpusSource = "live" | "snapshot";

/**
 * The one honest sentence under the field. Counts come from the data
 * actually shown, never hardcoded — and the line names its source:
 * the live mirror, or the committed snapshot when the mirror is
 * unreachable. Rule totals only appear for the snapshot (the live
 * list carries no per-subtree rule counts; merged sizes are partly
 * defaults, so quoting a total would be dishonest).
 */
export function fieldStatLine(
  stats: CorpusFieldStats,
  source: CorpusSource = "snapshot",
): string {
  const subtrees = stats.subtrees.toLocaleString("en-US");
  if (source === "live") {
    return `${subtrees} US provision-rooted subtrees · live mirror · every node cites its law`;
  }
  const rules = (Math.round(stats.rules / 100) * 100).toLocaleString("en-US");
  return `${subtrees} US provision-rooted subtrees · ~${rules} encoded rules · census snapshot`;
}

/* ── Live mirror merge ──
 * GET /v1/corpus/subtrees serves the live list (target, jurisdiction,
 * bucket — no sizes). The committed snapshot supplies ruleCount /
 * importCount for targets it knows; new targets get a modest default
 * dot so fresh law appears immediately without pretending to a size
 * we don't know. */

export interface LiveSubtree {
  target: string;
  jurisdiction: string;
  bucket: string;
}

export const DEFAULT_LIVE_RULE_COUNT = 3;
/** New law is presumed modest-but-linked: a small visible dot, not
 *  dust, until the next census sizes it honestly. */
export const DEFAULT_LIVE_LINKED_COUNT = 2;

export function mergeLiveSubtrees(
  snapshot: CorpusModule[],
  live: LiveSubtree[],
): CorpusModule[] {
  const byTarget = new Map(snapshot.map((module) => [module.target, module]));
  return live.map(
    (subtree) =>
      byTarget.get(subtree.target) ?? {
        target: subtree.target,
        jurisdiction: subtree.jurisdiction,
        bucket: subtree.bucket,
        ruleCount: DEFAULT_LIVE_RULE_COUNT,
        linkedRuleCount: DEFAULT_LIVE_LINKED_COUNT,
        importCount: 0,
        imports: [],
        // Sizes above are defaults, not census knowledge — the dot is
        // visible but earns no source-backed outline.
        presumed: true,
      },
  );
}

/** The in-app compose viewer link for one subtree. */
export function fieldComposeHref(target: string): string {
  return `/axiom/graph?compose=${encodeURIComponent(target)}`;
}

/* ── The open-world viewport ──
 * The field pans and zooms. A transform maps field coordinates to
 * "view" coordinates (same units as the field: the visible window is
 * always FIELD_WIDTH × FIELD_HEIGHT of view space, whatever the CSS
 * size): view = field · k + t. All math is pure and clamped so the
 * field always covers the whole window — no bare paper at the edges,
 * no zooming out past the overview. */

export interface FieldTransform {
  k: number;
  tx: number;
  ty: number;
}

export const IDENTITY_TRANSFORM: FieldTransform = { k: 1, tx: 0, ty: 0 };
export const MIN_FIELD_ZOOM = 1;
export const MAX_FIELD_ZOOM = 16;

function clampNumber(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The window is FIELD_WIDTH view-units wide and `viewHeight` units
 * tall (the host's aspect; FIELD_HEIGHT when the box matches the
 * world's own aspect — the landing panel). A window taller than the
 * world raises the minimum zoom so the world always covers it
 * ("cover" fit, full-bleed hosts). Near-1 ratios snap to 1 so an
 * aspect-matched box keeps its exact overview.
 */
export function minZoomForView(viewHeight: number = FIELD_HEIGHT): number {
  const ratio = viewHeight / FIELD_HEIGHT;
  return ratio < 1.01 ? MIN_FIELD_ZOOM : ratio;
}

/** The at-rest camera for a window: minimum zoom, centered. */
export function fitFieldTransform(
  viewHeight: number = FIELD_HEIGHT,
): FieldTransform {
  const k = minZoomForView(viewHeight);
  return clampFieldTransform(
    {
      k,
      tx: (FIELD_WIDTH * (1 - k)) / 2,
      ty: (viewHeight - FIELD_HEIGHT * k) / 2,
    },
    viewHeight,
  );
}

/** Zoom clamped to [cover-fit, 16]; pan clamped so the (scaled)
 *  field always covers the whole window. */
export function clampFieldTransform(
  t: FieldTransform,
  viewHeight: number = FIELD_HEIGHT,
): FieldTransform {
  const k = clampNumber(t.k, minZoomForView(viewHeight), MAX_FIELD_ZOOM);
  return {
    k,
    tx: clampNumber(t.tx, FIELD_WIDTH * (1 - k), 0),
    ty: clampNumber(t.ty, viewHeight - FIELD_HEIGHT * k, 0),
  };
}

export function fieldToView(
  t: FieldTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: x * t.k + t.tx, y: y * t.k + t.ty };
}

export function viewToField(
  t: FieldTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: (x - t.tx) / t.k, y: (y - t.ty) / t.k };
}

/** Multiply zoom by `factor`, keeping the field point under the view
 *  point (vx, vy) stationary — the wheel/pinch anchor. */
export function zoomFieldAt(
  t: FieldTransform,
  factor: number,
  vx: number,
  vy: number,
  viewHeight: number = FIELD_HEIGHT,
): FieldTransform {
  const k = clampNumber(
    t.k * factor,
    minZoomForView(viewHeight),
    MAX_FIELD_ZOOM,
  );
  const anchor = viewToField(t, vx, vy);
  return clampFieldTransform(
    {
      k,
      tx: vx - anchor.x * k,
      ty: vy - anchor.y * k,
    },
    viewHeight,
  );
}

/** Pan by a view-space delta (what the pointer dragged), clamped. */
export function panField(
  t: FieldTransform,
  dx: number,
  dy: number,
  viewHeight: number = FIELD_HEIGHT,
): FieldTransform {
  return clampFieldTransform(
    { k: t.k, tx: t.tx + dx, ty: t.ty + dy },
    viewHeight,
  );
}

/**
 * The click-to-enter viewport for a dot: centered on the dot, zoomed
 * so its jurisdiction cluster roughly fills the window — "step into
 * this territory", not "microscope on one pixel".
 */
export function zoomTransformForDot(
  layout: FieldLayout,
  dot: FieldDot,
  viewHeight: number = FIELD_HEIGHT,
): FieldTransform {
  const cluster = layout.clusters.find(
    (item) => item.jurisdiction === dot.jurisdiction,
  );
  const clusterR = Math.max(cluster?.r ?? 60, 24);
  const k = clampNumber(
    (viewHeight * 0.85) / (clusterR * 2),
    Math.max(2.5, minZoomForView(viewHeight)),
    MAX_FIELD_ZOOM,
  );
  return clampFieldTransform(
    {
      k,
      tx: FIELD_WIDTH / 2 - dot.x * k,
      ty: viewHeight / 2 - dot.y * k,
    },
    viewHeight,
  );
}

/**
 * Camera-path interpolation for the zoom animations: the scale moves
 * geometrically (equal zoom feel per frame) while the viewport-center
 * field point moves linearly. p ∈ [0, 1].
 */
export function interpolateTransform(
  from: FieldTransform,
  to: FieldTransform,
  p: number,
  viewHeight: number = FIELD_HEIGHT,
): FieldTransform {
  if (p <= 0) return from;
  if (p >= 1) return to;
  const k = from.k * Math.pow(to.k / from.k, p);
  const centerFrom = viewToField(from, FIELD_WIDTH / 2, viewHeight / 2);
  const centerTo = viewToField(to, FIELD_WIDTH / 2, viewHeight / 2);
  const cx = centerFrom.x + (centerTo.x - centerFrom.x) * p;
  const cy = centerFrom.y + (centerTo.y - centerFrom.y) * p;
  return clampFieldTransform(
    {
      k,
      tx: FIELD_WIDTH / 2 - cx * k,
      ty: viewHeight / 2 - cy * k,
    },
    viewHeight,
  );
}
