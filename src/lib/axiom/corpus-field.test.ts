import { describe, it, expect } from "vitest";
import {
  buildFieldLayout,
  bucketColor,
  BUCKET_COLORS,
  clampFieldTransform,
  computeFieldHighlights,
  corpusFieldStats,
  DEFAULT_LIVE_RULE_COUNT,
  DEFAULT_LIVE_LINKED_COUNT,
  dotRadius,
  mergeLiveSubtrees,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FILAMENT_ZOOM,
  MOTIF_ZOOM,
  motifSpec,
  trueMotifSpec,
  NON_COMPILING_ROOTS,
  GROUP_SPACING,
  GROUP_CLEARANCE,
  PINNED_HIGHLIGHT_TARGETS,
  SUBTREE_LABEL_MIN_PX,
  SUBTREE_FALLBACK_LABEL_MIN_PX,
  FALLBACK_LABELS_PER_FRAME,
  labelMinPx,
  FOOTPRINT_MARGIN_RATIO,
  FOOTPRINT_MARGIN_RATIO_MAX,
  LABEL_CLEARANCE,
  collisionRadius,
  countFootprintCollisions,
  documentStem,
  dotEarnsLabel,
  footprintMargin,
  groupSeparationStats,
  isCompositionTarget,
  fieldComposeHref,
  fieldStatLine,
  fieldToView,
  filterUsModules,
  filterViewModules,
  dotShapeSpec,
  hasSourceOutline,
  NODE_DETAIL_MIN_PX,
  shapeRendersNodes,
  fitFieldTransform,
  highlightScore,
  isUsJurisdiction,
  HIGHLIGHT_COUNT,
  HIGHLIGHT_MAX_PER_JURISDICTION,
  hitTestDot,
  IDENTITY_TRANSFORM,
  interpolateTransform,
  MAX_FIELD_ZOOM,
  MIN_VIEW_RULE_COUNT,
  minZoomForView,
  panField,
  viewToField,
  zoomFieldAt,
  zoomTransformForDot,
  type CorpusModule,
} from "./corpus-field";
import corpusSubtreesJson from "./corpus-subtrees.json";

// JSON widens the census's `[number, number]` tuples to number[] —
// the committed data is well-formed; narrow it once here.
const corpusSubtrees = corpusSubtreesJson as unknown as {
  clean_subtrees: number;
  modules: CorpusModule[];
};

function module(overrides: Partial<CorpusModule> = {}): CorpusModule {
  return {
    target: "us:statutes/7/2014",
    jurisdiction: "us",
    bucket: "statutes",
    ruleCount: 4,
    linkedRuleCount: 4,
    importCount: 0,
    imports: [],
    ...overrides,
  };
}

describe("dotRadius", () => {
  it("grows with rule count but sublinearly", () => {
    expect(dotRadius(0)).toBeGreaterThan(0);
    expect(dotRadius(9)).toBeGreaterThan(dotRadius(1));
    // sqrt scaling: 16x the rules is only ~4x the radius growth.
    expect(dotRadius(16) - dotRadius(0)).toBeLessThan(
      (dotRadius(1) - dotRadius(0)) * 5,
    );
  });

  it("caps giant subtrees so one module can't drown the field", () => {
    expect(dotRadius(10_000)).toBe(7.5);
  });
});

describe("bucketColor", () => {
  it("maps the three corpus buckets and falls back for strays", () => {
    expect(bucketColor("statutes")).toBe(BUCKET_COLORS.statutes);
    expect(bucketColor("regulations")).toBe(BUCKET_COLORS.regulations);
    expect(bucketColor("policies")).toBe(BUCKET_COLORS.policies);
    // The census carries one "manual" module today — it must still
    // render, in the fallback stone.
    expect(bucketColor("manual")).toMatch(/^#/);
    expect(bucketColor("manual")).not.toBe(BUCKET_COLORS.statutes);
  });
});

describe("buildFieldLayout", () => {
  it("returns an empty layout for an empty census", () => {
    const layout = buildFieldLayout([]);
    expect(layout.dots).toHaveLength(0);
    expect(layout.clusters).toHaveLength(0);
  });

  it("places one dot per module and one cluster per jurisdiction", () => {
    const modules = [
      module({ target: "us:statutes/1" }),
      module({ target: "us:regulations/7-cfr/273/10", bucket: "regulations" }),
      module({ target: "us-ny:statutes/1", jurisdiction: "us-ny" }),
    ];
    const layout = buildFieldLayout(modules);
    expect(layout.dots).toHaveLength(3);
    expect(layout.clusters.map((c) => c.jurisdiction).sort()).toEqual([
      "us",
      "us-ny",
    ]);
  });

  it("keeps every dot inside the field bounds", () => {
    const layout = buildFieldLayout(corpusSubtrees.modules);
    expect(layout.dots).toHaveLength(corpusSubtrees.modules.length);
    for (const dot of layout.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThanOrEqual(FIELD_WIDTH);
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThanOrEqual(FIELD_HEIGHT);
      expect(dot.r).toBeGreaterThan(0);
    }
  });

  it("clusters dots around their jurisdiction center", () => {
    const layout = buildFieldLayout(corpusSubtrees.modules);
    const clusterByJurisdiction = new Map(
      layout.clusters.map((c) => [c.jurisdiction, c]),
    );
    for (const dot of layout.dots) {
      const cluster = clusterByJurisdiction.get(dot.jurisdiction)!;
      const dist = Math.hypot(dot.x - cluster.x, dot.y - cluster.y);
      expect(dist).toBeLessThanOrEqual(cluster.r + dot.r + 1);
    }
  });

  it("does not overlap jurisdiction clusters", () => {
    const layout = buildFieldLayout(corpusSubtrees.modules);
    for (let i = 0; i < layout.clusters.length; i += 1) {
      for (let j = i + 1; j < layout.clusters.length; j += 1) {
        const a = layout.clusters[i]!;
        const b = layout.clusters[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
          (a.r + b.r) * 0.99,
        );
      }
    }
  });

  it("marks the provided highlight targets with their labels and a floor size", () => {
    const labels = new Map(
      computeFieldHighlights(corpusSubtrees.modules).map((m) => [
        m.target,
        `door:${m.target}`,
      ]),
    );
    const layout = buildFieldLayout(corpusSubtrees.modules, labels);
    const highlighted = layout.dots.filter((dot) => dot.highlightLabel);
    expect(highlighted).toHaveLength(labels.size);
    for (const [target, label] of labels) {
      const dot = layout.dots.find((d) => d.target === target)!;
      expect(dot.highlightLabel).toBe(label);
      expect(dot.r).toBeGreaterThanOrEqual(5);
    }
  });

  it("marks nothing when no highlight map is given", () => {
    const layout = buildFieldLayout(corpusSubtrees.modules.slice(0, 50));
    expect(layout.dots.every((dot) => dot.highlightLabel === null)).toBe(
      true,
    );
  });

  it("colors dots by bucket", () => {
    const layout = buildFieldLayout([
      module({ target: "a", bucket: "statutes" }),
      module({ target: "b", bucket: "policies" }),
    ]);
    const byTarget = new Map(layout.dots.map((d) => [d.target, d]));
    expect(byTarget.get("a")!.color).toBe(BUCKET_COLORS.statutes);
    expect(byTarget.get("b")!.color).toBe(BUCKET_COLORS.policies);
  });

  it("is deterministic", () => {
    const a = buildFieldLayout(corpusSubtrees.modules.slice(0, 400));
    const b = buildFieldLayout(corpusSubtrees.modules.slice(0, 400));
    expect(a).toEqual(b);
  });
});

describe("computeFieldHighlights", () => {
  it("scores LINKED rules + 2×imports", () => {
    expect(
      highlightScore(
        module({ ruleCount: 99, linkedRuleCount: 10, importCount: 4 }),
      ),
    ).toBe(18);
  });

  it("picks the top scorers from the real census, in score order", () => {
    const picked = computeFieldHighlights(corpusSubtrees.modules);
    // The size-based picks plus the pinned doors (all pinned targets
    // exist in the committed census).
    expect(picked).toHaveLength(
      HIGHLIGHT_COUNT + PINNED_HIGHLIGHT_TARGETS.length,
    );
    for (let i = 1; i < picked.length; i += 1) {
      // Later doors never outscore earlier ones (per-jurisdiction
      // dedupe may skip, never reorder).
      expect(highlightScore(picked[i]!)).toBeLessThanOrEqual(
        highlightScore(picked[i - 1]!),
      );
    }
    // The overall top scorer is always a door.
    const best = [...corpusSubtrees.modules].sort(
      (a, b) => highlightScore(b) - highlightScore(a),
    )[0]!;
    expect(picked.map((m) => m.target)).toContain(best.target);
  });

  it("caps doors per jurisdiction so one corpus can't monopolize", () => {
    const picked = computeFieldHighlights(corpusSubtrees.modules);
    const perJurisdiction = new Map<string, number>();
    for (const m of picked) {
      perJurisdiction.set(
        m.jurisdiction,
        (perJurisdiction.get(m.jurisdiction) ?? 0) + 1,
      );
    }
    // Pinned doors extend a jurisdiction's cap gracefully (the US
    // shows 4 doors); everyone else honors the cap exactly.
    const pinnedByJurisdiction = new Map<string, number>();
    for (const target of PINNED_HIGHLIGHT_TARGETS) {
      const jurisdiction = corpusSubtrees.modules.find(
        (m) => m.target === target,
      )!.jurisdiction;
      pinnedByJurisdiction.set(
        jurisdiction,
        (pinnedByJurisdiction.get(jurisdiction) ?? 0) + 1,
      );
    }
    for (const [jurisdiction, count] of perJurisdiction) {
      expect(count).toBeLessThanOrEqual(
        HIGHLIGHT_MAX_PER_JURISDICTION +
          (pinnedByJurisdiction.get(jurisdiction) ?? 0),
      );
    }
    // The cap actually bites: an uncapped pick differs.
    const uncapped = computeFieldHighlights(
      corpusSubtrees.modules,
      HIGHLIGHT_COUNT,
      Infinity,
    );
    expect(uncapped.map((m) => m.target)).not.toEqual(
      picked.map((m) => m.target),
    );
  });

  it("is deterministic and never returns more than asked plus the pinned", () => {
    const a = computeFieldHighlights(corpusSubtrees.modules, 5, 2);
    const b = computeFieldHighlights(corpusSubtrees.modules, 5, 2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5 + PINNED_HIGHLIGHT_TARGETS.length);
  });
});

describe("pinned highlights (EITC door)", () => {
  it("always includes the pinned targets from the committed census", () => {
    // Pins live in their own country family's view; check each pin
    // against the highlights of the country it belongs to.
    for (const target of PINNED_HIGHLIGHT_TARGETS) {
      const country = target.split(":")[0]!.split("-")[0]!;
      const picked = computeFieldHighlights(
        filterViewModules(corpusSubtrees.modules, country),
      );
      expect(picked.map((m) => m.target)).toContain(target);
    }
    const picked = computeFieldHighlights(
      filterViewModules(corpusSubtrees.modules),
    );
    // EITC specifically: the census names its headline, so the door
    // label path yields "EITC — 26 USC § 32".
    const eitc = picked.find((m) => m.target === "us:statutes/26/32")!;
    expect(eitc.headlineRule).toBe("eitc");
    expect(eitc.ruleCount).toBe(24);
  });

  it("pins are not phantoms: absent from the module list, absent from the doors", () => {
    const picked = computeFieldHighlights([
      module({ target: "us:statutes/7/2014", linkedRuleCount: 19 }),
    ]);
    expect(picked.map((m) => m.target)).toEqual(["us:statutes/7/2014"]);
  });

  it("a pinned target that turned to dust loses its door", () => {
    const picked = computeFieldHighlights([
      module({ target: "us:statutes/26/32", linkedRuleCount: 0, ruleCount: 24 }),
      module({ target: "us:statutes/7/2014", linkedRuleCount: 19 }),
    ]);
    expect(picked.map((m) => m.target)).toEqual(["us:statutes/7/2014"]);
  });

  it("pinned doors never evict size-based picks — they extend the count", () => {
    const withPin = computeFieldHighlights(corpusSubtrees.modules);
    const sizeOnly = withPin.filter(
      (m) => !PINNED_HIGHLIGHT_TARGETS.includes(m.target),
    );
    expect(sizeOnly).toHaveLength(HIGHLIGHT_COUNT);
    // No pinned root may be a known non-compiling root (a pin is a
    // promise the door executes).
    for (const target of PINNED_HIGHLIGHT_TARGETS) {
      expect(NON_COMPILING_ROOTS.has(target)).toBe(false);
    }
  });
});

describe("field transform math", () => {
  it("round-trips field ↔ view coordinates", () => {
    const t = { k: 3, tx: -420, ty: -120 };
    const view = fieldToView(t, 250, 100);
    const back = viewToField(t, view.x, view.y);
    expect(back.x).toBeCloseTo(250);
    expect(back.y).toBeCloseTo(100);
  });

  it("clamps zoom into [1, MAX] and keeps the field covering the window", () => {
    expect(clampFieldTransform({ k: 0.2, tx: 50, ty: 50 })).toEqual(
      IDENTITY_TRANSFORM,
    );
    const clamped = clampFieldTransform({ k: 99, tx: 5, ty: -1e9 });
    expect(clamped.k).toBe(MAX_FIELD_ZOOM);
    // tx ≤ 0 (no bare paper on the left), and the field's right edge
    // still reaches the window's right edge.
    expect(clamped.tx).toBeLessThanOrEqual(0);
    expect(clamped.tx).toBeGreaterThanOrEqual(FIELD_WIDTH * (1 - clamped.k));
    expect(clamped.ty).toBe(FIELD_HEIGHT * (1 - clamped.k));
  });

  it("zoomFieldAt keeps the anchor point stationary", () => {
    const t = { k: 2, tx: -300, ty: -80 };
    const anchorView = { x: 400, y: 200 };
    const before = viewToField(t, anchorView.x, anchorView.y);
    const zoomed = zoomFieldAt(t, 1.7, anchorView.x, anchorView.y);
    const after = viewToField(zoomed, anchorView.x, anchorView.y);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomed.k).toBeCloseTo(3.4);
  });

  it("zooming out from the overview is a no-op", () => {
    const zoomed = zoomFieldAt(IDENTITY_TRANSFORM, 0.5, 500, 220);
    expect(zoomed).toEqual(IDENTITY_TRANSFORM);
  });

  it("panField translates and clamps at the world edge", () => {
    const t = { k: 2, tx: -500, ty: -200 };
    const panned = panField(t, 60, -30);
    expect(panned).toEqual({ k: 2, tx: -440, ty: -230 });
    // Cannot pan past the left edge of the world.
    const pinned = panField(t, 1e6, 0);
    expect(pinned.tx).toBe(0);
  });

  it("zoomTransformForDot centers the dot and frames its cluster", () => {
    const layout = buildFieldLayout(corpusSubtrees.modules);
    const dot = layout.dots.find((d) => d.jurisdiction === "us-ny")!;
    const t = zoomTransformForDot(layout, dot);
    const view = fieldToView(t, dot.x, dot.y);
    // Centered (up to the covering clamp near world edges).
    expect(Math.abs(view.x - FIELD_WIDTH / 2)).toBeLessThanOrEqual(
      FIELD_WIDTH / 2,
    );
    expect(t.k).toBeGreaterThanOrEqual(2.5);
    expect(t.k).toBeLessThanOrEqual(MAX_FIELD_ZOOM);
    // The cluster roughly fills the window: its diameter at this zoom
    // is within the window height's magnitude.
    const cluster = layout.clusters.find(
      (c) => c.jurisdiction === "us-ny",
    )!;
    expect(cluster.r * 2 * t.k).toBeLessThanOrEqual(FIELD_HEIGHT * 1.2);
  });

  it("interpolateTransform hits its endpoints and stays clamped between", () => {
    const from = IDENTITY_TRANSFORM;
    const to = { k: 8, tx: -3000, ty: -1400 };
    expect(interpolateTransform(from, to, 0)).toEqual(from);
    expect(interpolateTransform(from, to, 1)).toEqual(to);
    const mid = interpolateTransform(from, to, 0.5);
    expect(mid.k).toBeGreaterThan(1);
    expect(mid.k).toBeLessThan(8);
    expect(mid.tx).toBeLessThanOrEqual(0);
    expect(mid.tx).toBeGreaterThanOrEqual(FIELD_WIDTH * (1 - mid.k));
  });
});

describe("dust (all-standalone modules)", () => {
  it("renders linkedRuleCount 0 as minimal faint dust, sized apart from big modules", () => {
    const layout = buildFieldLayout([
      module({ target: "dusty", ruleCount: 61, linkedRuleCount: 0 }),
      module({ target: "linked", ruleCount: 10, linkedRuleCount: 10 }),
    ]);
    const dusty = layout.dots.find((d) => d.target === "dusty")!;
    const linked = layout.dots.find((d) => d.target === "linked")!;
    expect(dusty.dust).toBe(true);
    expect(linked.dust).toBe(false);
    // 61 raw rules mean nothing if none are linked: dust stays small.
    expect(dusty.r).toBeLessThan(linked.r);
  });

  it("dust never gets a door, whatever its raw rule count", () => {
    const picked = computeFieldHighlights([
      module({ target: "glossary", ruleCount: 61, linkedRuleCount: 0 }),
      module({ target: "real", ruleCount: 15, linkedRuleCount: 15 }),
    ]);
    expect(picked.map((m) => m.target)).toEqual(["real"]);
  });
});

describe("door exclusions", () => {
  it("never offers the known non-compiling roots as doors", () => {
    const modules = [
      ...[...NON_COMPILING_ROOTS].map((target) =>
        module({ target, ruleCount: 99, linkedRuleCount: 99 }),
      ),
      module({ target: "us:statutes/26/21", linkedRuleCount: 37 }),
    ];
    const picked = computeFieldHighlights(modules);
    expect(picked.map((m) => m.target)).toEqual(["us:statutes/26/21"]);
  });

  it("real census doors exclude non-compiling roots and dust", () => {
    const picked = computeFieldHighlights(corpusSubtrees.modules);
    expect(picked.length).toBeGreaterThanOrEqual(10);
    for (const door of picked) {
      expect(door.linkedRuleCount).toBeGreaterThan(0);
      expect(NON_COMPILING_ROOTS.has(door.target)).toBe(false);
    }
  });
});

describe("import attraction + filaments", () => {
  const related = [
    module({
      target: "a:statutes/1",
      jurisdiction: "us",
      imports: ["b:statutes/1"],
    }),
    module({ target: "b:statutes/1", jurisdiction: "us" }),
    module({ target: "c:statutes/1", jurisdiction: "us" }),
    module({ target: "d:statutes/1", jurisdiction: "us" }),
    module({ target: "e:statutes/1", jurisdiction: "us" }),
    module({ target: "f:statutes/1", jurisdiction: "us" }),
  ];
  const unrelated = related.map((m) => ({ ...m, imports: [] }));

  it("pulls import-related modules closer than the plain layout", () => {
    const withPull = buildFieldLayout(related);
    const without = buildFieldLayout(unrelated);
    const dist = (layout: ReturnType<typeof buildFieldLayout>) => {
      const a = layout.dots.find((d) => d.target === "a:statutes/1")!;
      const b = layout.dots.find((d) => d.target === "b:statutes/1")!;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    expect(dist(withPull)).toBeLessThan(dist(without));
  });

  it("keeps attracted dots inside their jurisdiction's territory", () => {
    const layout = buildFieldLayout(corpusSubtrees.modules);
    const clusterByJurisdiction = new Map(
      layout.clusters.map((c) => [c.jurisdiction, c]),
    );
    for (const link of layout.links) {
      for (const dot of [layout.dots[link.a]!, layout.dots[link.b]!]) {
        const cluster = clusterByJurisdiction.get(dot.jurisdiction)!;
        expect(
          Math.hypot(dot.x - cluster.x, dot.y - cluster.y),
        ).toBeLessThanOrEqual(cluster.r + 0.001);
      }
    }
  });

  it("builds deduped links with mutual imports at weight 2, deterministically", () => {
    const build = () =>
      buildFieldLayout([
        module({ target: "x", imports: ["y"] }),
        module({ target: "y", imports: ["x"] }),
        module({ target: "z", imports: ["x", "missing:target"] }),
      ]);
    const mutual = build();
    expect(mutual.links).toHaveLength(2);
    expect(mutual.links.map((l) => l.weight).sort()).toEqual([1, 2]);
    expect(build()).toEqual(mutual);
  });

  it("lays out the real census deterministically, attraction included", () => {
    const a = buildFieldLayout(corpusSubtrees.modules);
    const b = buildFieldLayout(corpusSubtrees.modules);
    expect(a).toEqual(b);
    expect(a.links.length).toBeGreaterThan(100);
  });
});

describe("motifSpec (LOD sketches)", () => {
  const layout = buildFieldLayout([
    module({ target: "big", linkedRuleCount: 40, importCount: 2 }),
    module({ target: "small", linkedRuleCount: 1 }),
    module({ target: "dusty", linkedRuleCount: 0 }),
  ]);
  const dotOf = (target: string) =>
    layout.dots.find((d) => d.target === target)!;

  it("keeps the LOD thresholds ordered: filaments before motifs", () => {
    expect(FILAMENT_ZOOM).toBeLessThan(MOTIF_ZOOM);
    expect(FILAMENT_ZOOM).toBeGreaterThan(1);
  });

  it("derives more satellites for more linked/imported subtrees, capped", () => {
    const big = motifSpec(dotOf("big"));
    const small = motifSpec(dotOf("small"));
    expect(big.length).toBeGreaterThan(small.length);
    expect(big.length).toBeLessThanOrEqual(8);
    expect(small.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps every satellite inside its dot and is deterministic", () => {
    const dot = dotOf("big");
    const nodes = motifSpec(dot);
    for (const node of nodes) {
      expect(Math.hypot(node.dx, node.dy) + node.r).toBeLessThanOrEqual(
        dot.r,
      );
    }
    expect(motifSpec(dot)).toEqual(nodes);
  });

  it("gives dust no motif — it stays dust at every zoom", () => {
    expect(motifSpec(dotOf("dusty"))).toEqual([]);
  });
});

describe("filterViewModules (one-node filter)", () => {
  it("drops single-node subtrees entirely — not dust, gone", () => {
    const kept = filterViewModules([
      module({ target: "one", ruleCount: 1 }),
      module({ target: "zero", ruleCount: 0 }),
      module({ target: "two", ruleCount: MIN_VIEW_RULE_COUNT }),
      module({ target: "uk:x", jurisdiction: "uk", ruleCount: 9 }),
    ]);
    expect(kept.map((m) => m.target)).toEqual(["two"]);
  });

  it("thins the real census: 1,500 one-node modules disappear", () => {
    const kept = filterViewModules(corpusSubtrees.modules);
    expect(kept.length).toBeLessThan(corpusSubtrees.modules.length);
    expect(kept.every((m) => m.ruleCount >= MIN_VIEW_RULE_COUNT)).toBe(true);
    expect(kept.length).toBeGreaterThan(2500);
  });
});

describe("cover-fit camera (full-bleed windows)", () => {
  it("an aspect-matched window keeps the exact overview", () => {
    expect(minZoomForView(FIELD_HEIGHT)).toBe(1);
    expect(fitFieldTransform(FIELD_HEIGHT)).toEqual({ k: 1, tx: 0, ty: 0 });
    // Sub-pixel aspect jitter snaps to 1, not 1.002.
    expect(minZoomForView(FIELD_HEIGHT + 1)).toBe(1);
  });

  it("a taller window raises the minimum zoom so the world covers it", () => {
    const viewH = 600;
    expect(minZoomForView(viewH)).toBeCloseTo(600 / FIELD_HEIGHT);
    const fit = fitFieldTransform(viewH);
    expect(fit.k).toBeCloseTo(600 / FIELD_HEIGHT);
    // Covered: world spans the window exactly in y, centered in x.
    expect(fit.ty).toBeCloseTo(0);
    expect(fit.tx).toBeLessThan(0);
    expect(FIELD_WIDTH * fit.k + fit.tx).toBeGreaterThanOrEqual(FIELD_WIDTH);
  });

  it("clamping honors the window height: no bare paper below", () => {
    const viewH = 600;
    const clamped = clampFieldTransform({ k: 2, tx: 5, ty: -1e9 }, viewH);
    expect(clamped.tx).toBe(0);
    expect(clamped.ty).toBe(viewH - FIELD_HEIGHT * 2);
    // Zooming "out" in a tall window stops at cover-fit, not k=1.
    const out = zoomFieldAt(fitFieldTransform(viewH), 0.5, 500, 300, viewH);
    expect(out.k).toBeCloseTo(minZoomForView(viewH));
  });
});

describe("trueMotifSpec (real structure at motif LOD)", () => {
  const cdcc = corpusSubtrees.modules.find(
    (m) => m.target === "us:statutes/26/21",
  )!;
  const layout = buildFieldLayout([
    cdcc,
    module({ target: "plain", linkedRuleCount: 6 }),
  ]);
  const cdccDot = layout.dots.find((d) => d.target === cdcc.target)!;

  it("maps the census's precomputed layout into the dot footprint", () => {
    const spec = trueMotifSpec(cdccDot)!;
    expect(spec.nodes).toHaveLength(cdcc.graph!.n);
    expect(spec.nodes).toHaveLength(44);
    expect(spec.edges).toHaveLength(41);
    // Every node stays inside the dot.
    for (const node of spec.nodes) {
      expect(Math.hypot(node.dx, node.dy) + node.r).toBeLessThanOrEqual(
        cdccDot.r,
      );
    }
    // Every edge references real nodes.
    for (const [from, to] of spec.edges) {
      expect(spec.nodes[from]).toBeDefined();
      expect(spec.nodes[to]).toBeDefined();
    }
    // Roots at top: canvas y grows downward, so the layered layout's
    // y=0 roots map to negative dy.
    const minDy = Math.min(...spec.nodes.map((n) => n.dy));
    expect(minDy).toBeLessThan(0);
    // Deterministic.
    expect(trueMotifSpec(cdccDot)).toEqual(spec);
  });

  it("returns null without census structure — the schematic is the fallback", () => {
    const plain = layout.dots.find((d) => d.target === "plain")!;
    expect(plain.structure).toBeNull();
    expect(trueMotifSpec(plain)).toBeNull();
    expect(motifSpec(plain).length).toBeGreaterThan(0);
  });

  it("the census carries real structure for a majority of doors", () => {
    const doors = computeFieldHighlights(corpusSubtrees.modules);
    const withStructure = doors.filter((m) => m.graph);
    expect(withStructure.length).toBeGreaterThan(doors.length / 2);
  });
});

describe("hitTestDot", () => {
  const layout = buildFieldLayout([
    module({ target: "big", ruleCount: 60, linkedRuleCount: 60 }),
    module({ target: "small", ruleCount: 1, linkedRuleCount: 1 }),
  ]);

  it("finds a dot at its own center", () => {
    const big = layout.dots.find((d) => d.target === "big")!;
    expect(hitTestDot(layout.dots, big.x, big.y)?.target).toBe("big");
  });

  it("misses far away from everything", () => {
    expect(hitTestDot(layout.dots, -500, -500)).toBeNull();
  });

  it("prefers the nearest center within slack", () => {
    const small = layout.dots.find((d) => d.target === "small")!;
    expect(hitTestDot(layout.dots, small.x, small.y)?.target).toBe("small");
  });
});

describe("corpusFieldStats + fieldStatLine", () => {
  it("computes counts from the census, never hardcoded", () => {
    const stats = corpusFieldStats([
      module({ ruleCount: 3 }),
      module({ target: "x", ruleCount: 7 }),
    ]);
    expect(stats).toEqual({ subtrees: 2, rules: 10 });
  });

  it("renders the honest snapshot stat line for the real census", () => {
    const stats = corpusFieldStats(corpusSubtrees.modules);
    expect(stats.subtrees).toBe(corpusSubtrees.clean_subtrees);
    const line = fieldStatLine(stats);
    expect(line).toContain(stats.subtrees.toLocaleString("en-US"));
    expect(line).toContain("US provision-rooted subtrees");
    // The fallback names itself honestly.
    expect(line).toContain("census snapshot");
    // ~20,100 today: rounded to the nearest hundred with a tilde.
    expect(line).toMatch(/~\d{1,3}(,\d{3})* encoded rules/);
  });

  it("names the live mirror — and quotes no rule total it can't know", () => {
    const line = fieldStatLine({ subtrees: 5026, rules: 12345 }, "live");
    expect(line).toContain("5,026 US provision-rooted subtrees");
    expect(line).toContain("live mirror");
    expect(line).not.toContain("encoded rules");
  });
});

describe("US-only scope", () => {
  it("keeps us and us-* jurisdictions only", () => {
    expect(isUsJurisdiction("us")).toBe(true);
    expect(isUsJurisdiction("us-ny")).toBe(true);
    expect(isUsJurisdiction("uk")).toBe(false);
    expect(isUsJurisdiction("be-dg")).toBe(false);
    // "usa" or a hypothetical "usk" must not sneak through the prefix.
    expect(isUsJurisdiction("usa")).toBe(false);
  });

  it("filters modules to the US corpora", () => {
    const filtered = filterUsModules([
      module({ target: "us:statutes/1", jurisdiction: "us" }),
      module({ target: "us-co:statutes/1", jurisdiction: "us-co" }),
      module({ target: "uk:statutes/1", jurisdiction: "uk" }),
      module({ target: "be-dg:statutes/1", jurisdiction: "be-dg" }),
    ]);
    expect(filtered.map((m) => m.jurisdiction)).toEqual(["us", "us-co"]);
  });

  it("the committed snapshot carries only census-known families (us, be)", () => {
    const nonUs = corpusSubtrees.modules.filter(
      (m) => !m.jurisdiction.startsWith("us"),
    );
    expect(nonUs.length).toBeGreaterThan(0);
    expect(
      nonUs.every((m) => m.jurisdiction === "be" || m.jurisdiction.startsWith("be-")),
    ).toBe(true);
  });
});

describe("mergeLiveSubtrees", () => {
  const snapshot = [
    module({ target: "us:statutes/7/2014", ruleCount: 22, importCount: 4 }),
    module({ target: "us:regulations/7-cfr/273/10", ruleCount: 40 }),
  ];

  it("keeps snapshot sizes for known targets", () => {
    const merged = mergeLiveSubtrees(snapshot, [
      { target: "us:statutes/7/2014", jurisdiction: "us", bucket: "statutes" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(snapshot[0]);
  });

  it("gives unknown (new) targets a default size instead of dropping them", () => {
    const merged = mergeLiveSubtrees(snapshot, [
      {
        target: "be:policies/euromod_benefit_income_list",
        jurisdiction: "be",
        bucket: "policies",
      },
    ]);
    expect(merged[0]).toEqual({
      target: "be:policies/euromod_benefit_income_list",
      jurisdiction: "be",
      bucket: "policies",
      ruleCount: DEFAULT_LIVE_RULE_COUNT,
      linkedRuleCount: DEFAULT_LIVE_LINKED_COUNT,
      importCount: 0,
      imports: [],
      // Default sizes are presumption, not census knowledge.
      presumed: true,
    });
  });

  it("the live list is authoritative: snapshot-only targets drop out", () => {
    const merged = mergeLiveSubtrees(snapshot, [
      {
        target: "us:regulations/7-cfr/273/10",
        jurisdiction: "us",
        bucket: "regulations",
      },
    ]);
    expect(merged.map((m) => m.target)).toEqual([
      "us:regulations/7-cfr/273/10",
    ]);
  });
});

describe("hasSourceOutline (source-backed subtrees)", () => {
  it("outlines census-linked modules only", () => {
    expect(hasSourceOutline(module({ linkedRuleCount: 5 }))).toBe(true);
    expect(hasSourceOutline(module({ linkedRuleCount: 0 }))).toBe(false);
  });

  it("treats an unknown linkage count as 0 — no outline", () => {
    expect(hasSourceOutline({})).toBe(false);
    expect(hasSourceOutline({ linkedRuleCount: undefined })).toBe(false);
  });

  it("live-merged presumed sizes never earn an outline", () => {
    const merged = mergeLiveSubtrees(
      [],
      [{ target: "us:statutes/1/1", jurisdiction: "us", bucket: "statutes" }],
    );
    expect(merged[0]!.presumed).toBe(true);
    expect(merged[0]!.linkedRuleCount).toBe(DEFAULT_LIVE_LINKED_COUNT);
    expect(hasSourceOutline(merged[0]!)).toBe(false);
    // Snapshot-known targets keep their census truth.
    const known = mergeLiveSubtrees(
      [module({ target: "us:statutes/1/1", linkedRuleCount: 7 })],
      [{ target: "us:statutes/1/1", jurisdiction: "us", bucket: "statutes" }],
    );
    expect(hasSourceOutline(known[0]!)).toBe(true);
  });

  it("buildFieldLayout stamps the predicate onto every dot", () => {
    const layout = buildFieldLayout([
      module({ target: "linked", linkedRuleCount: 3 }),
      module({ target: "bare", linkedRuleCount: 0 }),
    ]);
    const byTarget = new Map(layout.dots.map((d) => [d.target, d]));
    expect(byTarget.get("linked")!.sourceOutline).toBe(true);
    expect(byTarget.get("bare")!.sourceOutline).toBe(false);
  });

  it("discriminates on the real census: many outlined, never all", () => {
    const kept = filterViewModules(corpusSubtrees.modules);
    const outlined = kept.filter((m) => hasSourceOutline(m)).length;
    expect(outlined).toBeGreaterThan(2000);
    expect(outlined).toBeLessThan(kept.length);
  });
});

describe("dotShapeSpec (the shape IS the module, at every LOD)", () => {
  const cdcc = corpusSubtrees.modules.find(
    (m) => m.target === "us:statutes/26/21",
  )!;
  const layout = buildFieldLayout([
    cdcc,
    module({ target: "plain", linkedRuleCount: 6 }),
    module({ target: "dusty", linkedRuleCount: 0 }),
  ]);
  const dotOf = (target: string) =>
    layout.dots.find((d) => d.target === target)!;

  it("census-graph modules render their TRUE structure", () => {
    const shape = dotShapeSpec(dotOf(cdcc.target));
    expect(shape.kind).toBe("true");
    if (shape.kind === "true") {
      expect(shape.motif.nodes).toHaveLength(cdcc.graph!.n);
      expect(shape.motif.edges.length).toBeGreaterThan(0);
    }
  });

  it("modules without census structure get the schematic — never a disc", () => {
    const shape = dotShapeSpec(dotOf("plain"));
    expect(shape.kind).toBe("schematic");
    if (shape.kind === "schematic") {
      expect(shape.nodes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("dust stays dust", () => {
    expect(dotShapeSpec(dotOf("dusty"))).toEqual({ kind: "dust" });
  });

  it("is zoom-free: the spec takes no camera input and is deterministic", () => {
    // The signature admits no transform — the same dot yields the
    // same shape whatever the camera does (far, mid, or motif zoom).
    expect(dotShapeSpec(dotOf(cdcc.target))).toEqual(
      dotShapeSpec(dotOf(cdcc.target)),
    );
    expect(dotShapeSpec(dotOf("plain"))).toEqual(dotShapeSpec(dotOf("plain")));
  });

  it("covers the whole view census without ever yielding a bare disc", () => {
    const kept = filterViewModules(corpusSubtrees.modules);
    const fieldLayout = buildFieldLayout(kept);
    let trueShapes = 0;
    let schematics = 0;
    let dust = 0;
    for (const dot of fieldLayout.dots) {
      const shape = dotShapeSpec(dot);
      if (shape.kind === "true") trueShapes += 1;
      else if (shape.kind === "schematic") schematics += 1;
      else dust += 1;
    }
    expect(trueShapes + schematics + dust).toBe(fieldLayout.dots.length);
    // The census facts: 1,792 graph-bearing VIEW modules (1,814
    // minus the 22 composition pipelines the app now excludes).
    expect(trueShapes).toBe(1792);
    expect(schematics).toBeGreaterThan(0);
  });
});

describe("shapeRendersNodes (zoom-scaled simplification)", () => {
  it("draws node detail only at readable pixel sizes", () => {
    expect(shapeRendersNodes(NODE_DETAIL_MIN_PX)).toBe(true);
    expect(shapeRendersNodes(NODE_DETAIL_MIN_PX * 3)).toBe(true);
    expect(shapeRendersNodes(NODE_DETAIL_MIN_PX - 0.01)).toBe(false);
    expect(shapeRendersNodes(0)).toBe(false);
  });
});

describe("spaced-out field (footprints breathe)", () => {
  it("phyllotaxis spacing gives footprints clear separation", () => {
    // The constant itself: dots sit farther apart than edge-to-edge.
    expect(GROUP_SPACING).toBeGreaterThanOrEqual(2.5);
    // Functionally: in a uniform cluster, nearest neighbors keep a
    // gap beyond their combined footprints (scale-invariant ratio).
    const uniform = Array.from({ length: 16 }, (_, i) =>
      module({ target: `us:statutes/26/${i}`, linkedRuleCount: 4 }),
    );
    const layout = buildFieldLayout(uniform);
    let minRatio = Infinity;
    for (let i = 0; i < layout.dots.length; i += 1) {
      for (let j = i + 1; j < layout.dots.length; j += 1) {
        const a = layout.dots[i]!;
        const b = layout.dots[j]!;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        minRatio = Math.min(minRatio, dist / (a.r + b.r));
      }
    }
    expect(minRatio).toBeGreaterThan(1.05);
  });
});

describe("hard no-overlap (footprints never intersect)", () => {
  const withDoorLabels = (modules: CorpusModule[]) => {
    const labels = new Map(
      computeFieldHighlights(modules).map((m) => [m.target, "door"]),
    );
    return buildFieldLayout(modules, labels);
  };

  it("the margin is real: ≥ 15% of the smaller footprint", () => {
    expect(FOOTPRINT_MARGIN_RATIO).toBeGreaterThanOrEqual(0.15);
    expect(LABEL_CLEARANCE).toBeGreaterThan(0);
  });

  it("big footprints command clearance proportional to THEIR size", () => {
    expect(FOOTPRINT_MARGIN_RATIO_MAX).toBeGreaterThanOrEqual(0.35);
    // A door (r 5) beside a speck (r 0.8): the margin scales with
    // the door, not the speck.
    expect(footprintMargin(5, 0.8)).toBeCloseTo(0.35 * 5);
    expect(footprintMargin(0.8, 5)).toBeCloseTo(0.35 * 5);
    // Two specks still get the small-side floor.
    expect(footprintMargin(0.8, 0.8)).toBeCloseTo(0.35 * 0.8);
    // The margin never drops below the 15%-of-smaller floor.
    expect(footprintMargin(1, 1)).toBeGreaterThanOrEqual(0.15);
  });

  it("labeled dots reserve extra clearance for their title band", () => {
    const plain = {
      r: 3,
      dust: false,
      headlineRule: null,
      sourceOutline: false,
    };
    expect(collisionRadius(plain)).toBe(3);
    expect(
      collisionRadius({ ...plain, headlineRule: "eitc" }),
    ).toBe(3 + LABEL_CLEARANCE);
    expect(
      collisionRadius({ ...plain, sourceOutline: true }),
    ).toBe(3 + LABEL_CLEARANCE);
    // Dust never labels — no clearance either.
    expect(
      collisionRadius({ ...plain, dust: true, headlineRule: "x" }),
    ).toBe(3);
  });

  it("ZERO intersecting footprint pairs over the committed census view set", () => {
    // The exact layout the field renders: door labels included (the
    // floor radius on doors is part of the constraint set).
    const layout = withDoorLabels(filterViewModules(corpusSubtrees.modules));
    expect(layout.dots.length).toBeGreaterThan(2500);
    expect(countFootprintCollisions(layout.dots)).toBe(0);
    // And without labels — every caller's layout holds the invariant.
    const bare = buildFieldLayout(filterViewModules(corpusSubtrees.modules));
    expect(countFootprintCollisions(bare.dots)).toBe(0);
  });

  it("spreads in both axes: coincident dots separate deterministically", () => {
    // Two identical modules land on distinct spiral slots, but the
    // invariant holds pairwise everywhere — including a dense pile
    // of same-size modules in one jurisdiction.
    const pile = Array.from({ length: 40 }, (_, i) =>
      module({ target: `us:statutes/7/${i}`, linkedRuleCount: 30 }),
    );
    const layout = buildFieldLayout(pile);
    expect(countFootprintCollisions(layout.dots)).toBe(0);
    // Both axes moved: the resolved dots span x AND y.
    const xs = layout.dots.map((d) => d.x);
    const ys = layout.dots.map((d) => d.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(10);
    // Deterministic under repetition.
    expect(buildFieldLayout(pile)).toEqual(layout);
  });

  it("the whole field still fits the world after resolution", () => {
    const layout = withDoorLabels(filterViewModules(corpusSubtrees.modules));
    for (const dot of layout.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThanOrEqual(FIELD_WIDTH);
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThanOrEqual(FIELD_HEIGHT);
    }
  });
});

describe("composition / pipeline exclusion (app-side isCompositionPath)", () => {
  it("recognizes pipeline and policy-composition targets, keeps real law", () => {
    expect(
      isCompositionTarget("us-al:policies/income_tax/pilot_liability_pipeline"),
    ).toBe(true);
    expect(
      isCompositionTarget(
        "us-ny:policies/income_tax/nyc_composed_liability_pipeline",
      ),
    ).toBe(true);
    expect(
      isCompositionTarget("us:policies/snap/state-plan-composition/page-1"),
    ).toBe(true);
    expect(
      isCompositionTarget("us:policies/fy-2026-benefit-calculation/summary"),
    ).toBe(true);
    expect(isCompositionTarget("us:policies/snap/composition")).toBe(true);
    // The "composition" patterns bite ONLY in policy buckets…
    expect(isCompositionTarget("us:statutes/26/composition")).toBe(false);
    // …and real manual pages that merely CONTAIN the word stay.
    expect(
      isCompositionTarget(
        "us-nc:policies/dhhs/fns/fns-210-household-composition/page-2",
      ),
    ).toBe(false);
    expect(isCompositionTarget("us:statutes/7/2014")).toBe(false);
  });

  it("the census-built view set contains zero pipeline targets", () => {
    const view = filterViewModules(corpusSubtrees.modules);
    expect(view.some((m) => isCompositionTarget(m.target))).toBe(false);
    expect(view.some((m) => m.target.endsWith("_pipeline"))).toBe(false);
    // The exclusion bites: the raw census still carries them.
    const raw = corpusSubtrees.modules.filter((m) =>
      isCompositionTarget(m.target),
    );
    expect(raw.length).toBe(23);
  });
});

describe("subtree titles (labels under document-grouped subtrees)", () => {
  it("labels subtrees with a headline rule or a source-backed outline", () => {
    expect(
      dotEarnsLabel({ dust: false, headlineRule: "eitc", sourceOutline: false }),
    ).toBe(true);
    expect(
      dotEarnsLabel({ dust: false, headlineRule: null, sourceOutline: true }),
    ).toBe(true);
    expect(
      dotEarnsLabel({ dust: false, headlineRule: null, sourceOutline: false }),
    ).toBe(false);
    // Dust never gets a title, whatever it claims to be.
    expect(
      dotEarnsLabel({ dust: true, headlineRule: "eitc", sourceOutline: true }),
    ).toBe(false);
  });

  it("the size gate exists and far zoom stays unlabeled", () => {
    expect(SUBTREE_LABEL_MIN_PX).toBeGreaterThan(0);
    // A typical mid-size module at the fitted overview renders well
    // under the gate — labels are a close-zoom affordance.
    const layout = buildFieldLayout(filterViewModules(corpusSubtrees.modules));
    const median = [...layout.dots].sort((a, b) => a.r - b.r)[
      Math.floor(layout.dots.length / 2)
    ]!;
    // ~1.2 CSS px per field unit at the fitted landing view.
    expect(median.r * 1.2).toBeLessThan(SUBTREE_LABEL_MIN_PX);
  });

  it("stamps enough label-eligible dots on the real census", () => {
    const layout = buildFieldLayout(filterViewModules(corpusSubtrees.modules));
    const eligible = layout.dots.filter((dot) => dotEarnsLabel(dot));
    expect(eligible.length).toBeGreaterThan(1000);
    expect(eligible.length).toBeLessThan(layout.dots.length);
  });

  it("two tiers: headline titles appear early, citation fallbacks much later", () => {
    expect(labelMinPx({ headlineRule: "eitc" })).toBe(SUBTREE_LABEL_MIN_PX);
    expect(labelMinPx({ headlineRule: null })).toBe(
      SUBTREE_FALLBACK_LABEL_MIN_PX,
    );
    // The fallback tier is meaningfully deeper, and its per-frame
    // budget stays below the overall label cap.
    expect(SUBTREE_FALLBACK_LABEL_MIN_PX).toBeGreaterThanOrEqual(
      SUBTREE_LABEL_MIN_PX * 1.8,
    );
    expect(FALLBACK_LABELS_PER_FRAME).toBeGreaterThan(0);
    expect(FALLBACK_LABELS_PER_FRAME).toBeLessThan(160);
  });
});

describe("documentStem (source document families)", () => {
  it("statutes group by title/section, subsections included", () => {
    expect(documentStem("us:statutes/26/32")).toBe("us:statutes/26/32");
    expect(documentStem("us:statutes/26/32/c/2")).toBe(
      "us:statutes/26/32",
    );
    expect(documentStem("us:statutes/7/2014/e/6/A")).toBe(
      "us:statutes/7/2014",
    );
    // A bare title stays itself.
    expect(documentStem("us:statutes/26")).toBe("us:statutes/26");
  });

  it("regulations group by slug + integer part (dotted state sections too)", () => {
    expect(documentStem("us:regulations/7-cfr/273/10/e/2")).toBe(
      "us:regulations/7-cfr/273",
    );
    expect(documentStem("us-co:regulations/10-ccr-2506-1/4.410")).toBe(
      "us-co:regulations/10-ccr-2506-1/4",
    );
    expect(documentStem("us-co:regulations/10-ccr-2506-1/4.207.2")).toBe(
      "us-co:regulations/10-ccr-2506-1/4",
    );
    expect(documentStem("us:regulations/42-cfr/435/552")).toBe(
      "us:regulations/42-cfr/435",
    );
  });

  it("policies and manuals group by agency/program/document", () => {
    expect(
      documentStem(
        "us-nc:policies/dhhs/fns/fns-340-deductions/page-2",
      ),
    ).toBe("us-nc:policies/dhhs/fns/fns-340-deductions");
    expect(
      documentStem(
        "us-mo:manual/dss/snap/1115-000-00/1115-035-00/1115-035-25/block-1",
      ),
    ).toBe("us-mo:manual/dss/snap/1115-000-00");
    expect(
      documentStem(
        "us-fl:policies/dcf/ess-program-policy-manual/appendix-a-1-x/page-1",
      ),
    ).toBe("us-fl:policies/dcf/ess-program-policy-manual/appendix-a-1-x");
  });

  it("malformed targets fall through unchanged", () => {
    expect(documentStem("not-a-target")).toBe("not-a-target");
    expect(documentStem("us:statutes")).toBe("us:statutes");
  });

  it("every laid-out dot carries its family stem", () => {
    const layout = buildFieldLayout([
      module({ target: "us:statutes/26/32/c" }),
      module({ target: "us:statutes/26/32/j" }),
    ]);
    expect(
      layout.dots.every((dot) => dot.docStem === "us:statutes/26/32"),
    ).toBe(true);
  });
});

describe("document constellations (inter-group spacing)", () => {
  it("clearance and snugness are both real constants", () => {
    expect(GROUP_CLEARANCE).toBeGreaterThan(0);
    expect(GROUP_SPACING).toBeGreaterThan(2);
  });

  it("on the census, families sit clearly apart: median inter-group gap > median intra-group gap", () => {
    const layout = buildFieldLayout(
      filterViewModules(corpusSubtrees.modules),
    );
    const stats = groupSeparationStats(layout.dots);
    expect(Number.isFinite(stats.intraMedian)).toBe(true);
    expect(Number.isFinite(stats.interMedian)).toBe(true);
    // Same-family dots stay snug; the space lives between families.
    expect(stats.interMedian).toBeGreaterThan(stats.intraMedian);
    // Meaningfully so — not a rounding artifact.
    expect(stats.interMedian).toBeGreaterThan(stats.intraMedian * 1.5);
  });

  it("groupSeparationStats handles a family-less field", () => {
    const stats = groupSeparationStats([]);
    expect(Number.isNaN(stats.intraMedian)).toBe(true);
    expect(Number.isNaN(stats.interMedian)).toBe(true);
  });
});

describe("fieldComposeHref", () => {
  it("links into the in-app compose viewer with the target encoded", () => {
    expect(fieldComposeHref("us:statutes/7/2014/e/6/A")).toBe(
      "/axiom/graph?compose=us%3Astatutes%2F7%2F2014%2Fe%2F6%2FA",
    );
  });
});
