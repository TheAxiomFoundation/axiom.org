"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { Scan } from "lucide-react";
import {
  humanizeCitation,
  humanizeRuleName,
} from "@/components/axiom/graph-viewer/citations";
import {
  CLUSTER_LABEL_MIN_MODULES,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FILAMENT_ZOOM,
  fitFieldTransform,
  IDENTITY_TRANSFORM,
  MOTIF_ZOOM,
  FALLBACK_LABELS_PER_FRAME,
  dotEarnsLabel,
  labelMinPx,
  dotShapeSpec,
  shapeRendersNodes,
  buildFieldLayout,
  computeFieldHighlights,
  clampFieldTransform,
  countFootprintCollisions,
  groupSeparationStats,
  fieldComposeHref,
  fieldToView,
  hitTestDot,
  interpolateTransform,
  MAX_FIELD_ZOOM,
  panField,
  viewToField,
  zoomFieldAt,
  zoomTransformForDot,
  type CorpusModule,
  type CorpusSource,
  type FieldDot,
  type FieldTransform,
} from "@/lib/axiom/corpus-field";
import { loadCorpusModules } from "@/lib/axiom/corpus-live";

/**
 * The corpus field: an open world of every subgraph we serve. Every
 * provision-rooted subtree the live mirror lists renders as a dot on
 * one canvas (the committed snapshot supplies sizes, and IS the
 * corpus when the mirror is unreachable) — pan it, zoom it (wheel /
 * pinch / drag), hover any dot for its citation. Clicking a dot (or
 * a computed door) zooms the camera into its territory and then
 * mounts the compose viewer IN PLACE over the field, with the URL
 * pushed to the real compose deep link so reload and BACK stay
 * honest; BACK unmounts the viewer and the camera pulls back out.
 *
 * The snapshot (~590 KB) loads through a dynamic import so it ships
 * as its own cached chunk, never inline HTML.
 */

/** The compose viewer, loaded only when a subtree is opened. */
const ComposeViewer = dynamic(
  () =>
    import("@/components/axiom/graph-viewer/viewer-app").then(
      (mod) => mod.GraphViewerApp
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
          loading graph…
        </p>
      </div>
    ),
  }
);

const JURISDICTION_LABELS: Record<string, string> = {
  us: "US · Federal",
  be: "BE · Federal",
  "be-vlg": "BE · Flanders",
  "be-wal": "BE · Wallonia",
  "be-bru": "BE · Brussels",
  "be-dg": "BE · German-speaking Community",
};

const ZOOM_IN_MS = 640;
const ZOOM_OUT_MS = 520;

function clusterLabel(jurisdiction: string): string {
  return (
    JURISDICTION_LABELS[jurisdiction] ??
    jurisdiction.toUpperCase().replace("US-", "US · ")
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The compose target in the current URL, when it points at the
 *  in-app compose viewer (a field pushState or a forward-nav). */
function composeTargetFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  if (!url.pathname.endsWith("/axiom/graph")) return null;
  return url.searchParams.get("compose");
}

export function CorpusField({
  onPick,
  frame = true,
  spotlight = null,
  country = "us",
  suppliedModules,
}: {
  /** Which country family's subtrees the field shows ("us", "be").
   *  Hosts with a country switch pass their selection; the landing
   *  keeps the US default. */
  country?: string;
  /** A host-filtered collection, shared with its list and search. */
  suppliedModules?: CorpusModule[];
  /** Embedded mode (the viewer's launcher): picking a subtree calls
   *  this instead of pushState + mounting the compose viewer overlay
   *  — the host is already the viewer. Omitted on the /axiom landing,
   *  where the field owns the whole enter/return journey. */
  onPick?: (target: string) => void;
  /** frame=false: full-bleed — no border/panel chrome and no fixed
   *  aspect; the host sizes the box and the camera cover-fits it. */
  frame?: boolean;
  /** A module target the guided tour wants presented: the camera
   *  glides most of the way to its cluster and its hover ring + label
   *  pin, without opening it. Clearing glides back. */
  spotlight?: string | null;
} = {}) {
  const embedded = Boolean(onPick);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loadedModules, setModules] = useState<CorpusModule[] | null>(null);
  const modules = suppliedModules ?? loadedModules;
  const [source, setSource] = useState<CorpusSource>("snapshot");
  const [hovered, setHovered] = useState<FieldDot | null>(null);
  // The camera. A ref mirrors the state so rAF animation frames and
  // native listeners never read a stale closure.
  const [transform, setTransform] = useState<FieldTransform>(
    IDENTITY_TRANSFORM
  );
  const transformRef = useRef(transform);
  transformRef.current = transform;
  // The window's height in view units (width is always FIELD_WIDTH).
  // A full-bleed host is usually taller than the world's own aspect;
  // the camera cover-fits it. Ref mirror for rAF/native handlers.
  const [viewHeight, setViewHeight] = useState<number>(FIELD_HEIGHT);
  const viewHeightRef = useRef(viewHeight);
  viewHeightRef.current = viewHeight;
  const userMovedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  // Where the camera should pull back to when the viewer closes.
  const returnTransformRef = useRef<FieldTransform>(IDENTITY_TRANSFORM);
  // The compose viewer mounted in place over the field.
  const [openTarget, setOpenTarget] = useState<string | null>(null);
  const [overlayShown, setOverlayShown] = useState(false);
  // Drag state (also carries two-pointer pinch).
  const pointersRef = useRef(
    new Map<number, { x: number; y: number }>()
  );
  const dragStateRef = useRef<{ moved: boolean } | null>(null);
  // Subtree label cache: humanized text + width at the reference font
  // size (CSS px — zoom-independent), computed lazily per target.
  const labelCacheRef = useRef(
    new Map<string, { text: string; widthCss: number }>()
  );

  useEffect(() => {
    if (suppliedModules) return;
    let cancelled = false;
    // Live mirror first, committed snapshot as ballast — the field is
    // never empty just because the API is down.
    loadCorpusModules({ country }).then(
      ({ modules: loaded, source: loadedSource }) => {
        if (cancelled) return;
        setModules(loaded);
        setSource(loadedSource);
      },
      () => {
        // Even the snapshot chunk failed — the landing page still
        // works (search + browse); the field just stays a quiet panel.
        if (!cancelled) setModules([]);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [country, suppliedModules]);

  // Doors are computed from the census — the largest / most intricate
  // subtrees, capped per jurisdiction — and labeled by citation.
  const highlightLabels = useMemo(() => {
    if (!modules) return null;
    return new Map(
      computeFieldHighlights(modules).map((module) => [
        module.target,
        // Headline rule first, citation second — "Elderly Disabled
        // Credit — 26 USC § 22"; citation-only when the census has
        // no headline. Belgian topic paths already read as names
        // ("Income Tax — Benefits — Company Car (Belgium)"): the
        // citation alone, or headline+citation would say every word
        // twice and overflow the chip.
        module.jurisdiction.startsWith("be") || !module.headlineRule
          ? humanizeCitation(module.target)
          : `${humanizeRuleName(module.headlineRule)} — ${humanizeCitation(module.target)}`,
      ])
    );
  }, [modules]);
  const [layout, layoutMs] = useMemo(() => {
    if (!modules) return [null, 0] as const;
    const startedAt = performance.now();
    const built = buildFieldLayout(modules, highlightLabels ?? undefined);
    return [built, performance.now() - startedAt] as const;
  }, [modules, highlightLabels]);
  // The hard invariant, surfaced: zero intersecting footprint pairs
  // (checked once per layout, never per frame) — and the document
  // grouping, measurable: median inter-family vs intra-family
  // nearest-neighbor gaps.
  const overlapPairs = useMemo(
    () => (layout ? countFootprintCollisions(layout.dots) : 0),
    [layout]
  );
  const groupStats = useMemo(
    () =>
      layout
        ? groupSeparationStats(layout.dots)
        : { intraMedian: 0, interMedian: 0 },
    [layout]
  );
  const stopAnimation = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const animateTo = useCallback(
    (to: FieldTransform, ms: number, onDone?: () => void) => {
      stopAnimation();
      if (prefersReducedMotion() || ms <= 0) {
        setTransform(to);
        onDone?.();
        return;
      }
      const from = transformRef.current;
      const startedAt = performance.now();
      const step = (now: number) => {
        const raw = Math.min((now - startedAt) / ms, 1);
        // easeInOutCubic — the constellation's glide, not a linear rush.
        const eased =
          raw < 0.5
            ? 4 * raw * raw * raw
            : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        setTransform(
          interpolateTransform(from, to, eased, viewHeightRef.current)
        );
        if (raw < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          onDone?.();
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [stopAnimation]
  );

  useEffect(() => stopAnimation, [stopAnimation]);

  // ── Canvas rendering (viewport-culled) ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const frameStartedAt = performance.now();
    const parent = canvas.parentElement;
    const cssWidth = parent?.clientWidth ?? 0;
    const cssHeight = parent?.clientHeight ?? 0;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    // Track the window's aspect: full-bleed hosts are taller than the
    // world; the camera cover-fits whatever we measure here.
    const measuredViewHeight = (cssHeight / cssWidth) * FIELD_WIDTH;
    if (Math.abs(measuredViewHeight - viewHeightRef.current) > 0.5) {
      setViewHeight(measuredViewHeight);
    }
    const dpr =
      typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
    const pxWidth = Math.round(cssWidth * dpr);
    const pxHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pxWidth) canvas.width = pxWidth;
    if (canvas.height !== pxHeight) canvas.height = pxHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / very old browsers: overlay links still work
    const { k, tx, ty } = transform;
    const unit = (cssWidth / FIELD_WIDTH) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(unit * k, 0, 0, unit * k, unit * tx, unit * ty);

    // Visible field rect for culling (with a halo margin).
    const topLeft = viewToField(transform, 0, 0);
    const bottomRight = viewToField(
      transform,
      FIELD_WIDTH,
      measuredViewHeight
    );

    // Cluster halos first — the faint territories the dots live in.
    for (const cluster of layout.clusters) {
      if (
        cluster.x + cluster.r < topLeft.x ||
        cluster.x - cluster.r > bottomRight.x ||
        cluster.y + cluster.r < topLeft.y ||
        cluster.y - cluster.r > bottomRight.y
      ) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(cluster.x, cluster.y, cluster.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(120, 113, 108, 0.045)";
      ctx.fill();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 0.6 / k;
      ctx.strokeStyle = "rgba(120, 113, 108, 0.22)";
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Import filaments: background texture, never a statement.
    // Barely-there at the fitted view, a whisper stronger at mid
    // zoom, fading again as the camera closes in on shapes (they
    // matter least when inspecting structure). Drawn under the dots.
    {
      const rise = Math.min(Math.max((k - 1) / 1.2, 0), 1);
      const nearFade = Math.max(
        1 - Math.max(k - MOTIF_ZOOM, 0) / 6,
        0.3
      );
      const filamentAlpha = (0.04 + 0.11 * rise) * nearFade;
      ctx.lineWidth = 0.35 / k;
      for (const link of layout.links) {
        const a = layout.dots[link.a]!;
        const b = layout.dots[link.b]!;
        const aVisible =
          a.x > topLeft.x &&
          a.x < bottomRight.x &&
          a.y > topLeft.y &&
          a.y < bottomRight.y;
        const bVisible =
          b.x > topLeft.x &&
          b.x < bottomRight.x &&
          b.y > topLeft.y &&
          b.y < bottomRight.y;
        if (!aVisible && !bVisible) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        // Mutual imports read stronger than one-way ones.
        ctx.strokeStyle = `rgba(180, 83, 9, ${
          filamentAlpha * (link.weight > 1 ? 1 : 0.6)
        })`;
        ctx.stroke();
      }
    }

    // Every module IS its graph shape, at every LOD — the true census
    // structure where the census carries it, the schematic
    // hub-and-satellites otherwise. No filled circle bodies anywhere;
    // a thin low-alpha ring outlines source-backed subtrees only.
    // Below the node-detail pixel threshold a shape draws as a single
    // stroked edge path (structure, never a disc).
    let trueEdgesDrawn = 0;
    let outlinesDrawn = 0;
    let dotsDrawn = 0;
    // On-screen CSS px per field unit (dpr already lives in the
    // canvas transform) — the node-detail switch is perceptual.
    const pxPerUnit = (cssWidth / FIELD_WIDTH) * k;

    const margin = 10;
    // Document-grouped subtrees whose footprint is readable this
    // frame — labeled after the shapes so text never sits under ink.
    const labelCandidates: FieldDot[] = [];
    for (const dot of layout.dots) {
      if (
        dot.x + dot.r < topLeft.x - margin ||
        dot.x - dot.r > bottomRight.x + margin ||
        dot.y + dot.r < topLeft.y - margin ||
        dot.y - dot.r > bottomRight.y + margin
      ) {
        continue;
      }
      dotsDrawn += 1;
      if (dot.dust) {
        // All-standalone modules: minimal faint dust, at every LOD.
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = dot.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      const shape = dotShapeSpec(dot);
      const detailed = shapeRendersNodes(dot.r * pxPerUnit);
      // Translucent constellation layer: ordinary shapes recede so
      // the doors, source rings, and the hovered dot carry the
      // hierarchy. Hover restores full presence.
      const alpha =
        dot === hovered ? 0.95 : dot.highlightLabel ? 0.9 : 0.5;
      if (shape.kind === "true") {
        const { nodes, edges } = shape.motif;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = dot.color;
        ctx.lineWidth = 0.4 / k;
        if (edges.length > 0) {
          // One path per module — a single stroke call keeps ~7.4k
          // edges cheap at far zoom.
          ctx.beginPath();
          for (const [from, to] of edges) {
            const a = nodes[from];
            const b = nodes[to];
            if (!a || !b) continue;
            ctx.moveTo(dot.x + a.dx, dot.y + a.dy);
            ctx.lineTo(dot.x + b.dx, dot.y + b.dy);
            trueEdgesDrawn += 1;
          }
          ctx.stroke();
        }
        // Node dots only when they'd be real pixels — an edgeless
        // graph keeps its nodes at any size (else it would vanish).
        if (detailed || edges.length === 0) {
          ctx.fillStyle = dot.color;
          for (const node of nodes) {
            ctx.beginPath();
            ctx.arc(dot.x + node.dx, dot.y + node.dy, node.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      } else if (shape.kind === "schematic") {
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = dot.color;
        ctx.lineWidth = 0.5 / k;
        ctx.beginPath();
        for (const node of shape.nodes) {
          ctx.moveTo(dot.x, dot.y);
          ctx.lineTo(dot.x + node.dx, dot.y + node.dy);
        }
        ctx.stroke();
        if (detailed) {
          ctx.fillStyle = dot.color;
          for (const node of shape.nodes) {
            ctx.beginPath();
            ctx.arc(dot.x + node.dx, dot.y + node.dy, node.r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, Math.max(dot.r * 0.13, 0.26), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // The source-backed outline: census-linked subtrees wear a
      // subtle enclosing ring at their footprint; presumed/unlinked
      // modules stay bare shapes.
      if (dot.sourceOutline) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        // Softened with the shapes, but LESS so — the ring hierarchy
        // survives the translucent layer.
        ctx.globalAlpha = dot === hovered ? 0.45 : 0.24;
        ctx.lineWidth = 0.5 / k;
        ctx.strokeStyle = dot.color;
        ctx.stroke();
        ctx.globalAlpha = 1;
        outlinesDrawn += 1;
      }
      if (dot.highlightLabel) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r + 2.4 / k, 0, Math.PI * 2);
        ctx.lineWidth = 1.1 / k;
        ctx.strokeStyle = "#b45309";
        ctx.stroke();
      }
      // Title candidates: subtrees grouped under a source document
      // (headline rule or source-backed linkage), footprint readable
      // AT THIS DOT'S TIER (headline titles early, citation
      // fallbacks only much closer), not already named by a door.
      if (
        !dot.highlightLabel &&
        dot.r * pxPerUnit >= labelMinPx(dot) &&
        dotEarnsLabel(dot)
      ) {
        labelCandidates.push(dot);
      }
    }

    // ── Titles under document-grouped subtrees ──
    // Small muted text beneath each footprint — headline names
    // first (biggest first within a tier), citation fallbacks under
    // their own lower per-frame cap so names reveal progressively; a
    // screen-space overlap check keeps the band from wallpapering
    // dense clusters. At far zoom no candidate passes — unlabeled.
    let labelsDrawn = 0;
    let headlineLabelsDrawn = 0;
    let fallbackLabelsDrawn = 0;
    if (labelCandidates.length > 0) {
      const fontCss = 10;
      const fontField = fontCss / pxPerUnit;
      ctx.font = `500 ${fontField}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(87, 83, 78, 0.85)";
      const lineH = fontField * 1.35;
      const placed: Array<{ x: number; y: number; w: number }> = [];
      const cache = labelCacheRef.current;
      const sorted = [...labelCandidates].sort(
        (a, b) =>
          (b.headlineRule ? 1 : 0) - (a.headlineRule ? 1 : 0) ||
          b.r - a.r
      );
      for (const dot of sorted) {
        if (labelsDrawn >= 160) break;
        const isHeadline = dot.headlineRule !== null;
        if (!isHeadline && fallbackLabelsDrawn >= FALLBACK_LABELS_PER_FRAME) {
          continue;
        }
        let entry = cache.get(dot.target);
        if (!entry) {
          const raw = dot.headlineRule
            ? humanizeRuleName(dot.headlineRule)
            : humanizeCitation(dot.target);
          // Inside a country's own field every rule repeating the
          // country name is pure width — "Belgium Worker Pension …"
          // reads as "Worker Pension …".
          const text = dot.jurisdiction.startsWith("be")
            ? raw.replace(/^Belgium /, "")
            : raw;
          entry = {
            text,
            // measureText under the current font (field units) —
            // times pxPerUnit it's zoom-independent CSS px.
            widthCss: ctx.measureText(text).width * pxPerUnit,
          };
          cache.set(dot.target, entry);
        }
        const w = entry.widthCss / pxPerUnit;
        const x = dot.x;
        const y = dot.y + dot.r + 2 / k;
        const collides = placed.some(
          (p) =>
            Math.abs(p.y - y) < lineH * 1.7 &&
            Math.abs(p.x - x) < (p.w + w) / 2 + fontField * 3
        );
        if (collides) continue;
        ctx.fillText(entry.text, x, y);
        placed.push({ x, y, w });
        labelsDrawn += 1;
        if (isHeadline) headlineLabelsDrawn += 1;
        else fallbackLabelsDrawn += 1;
      }
    }

    if (hovered) {
      ctx.beginPath();
      ctx.arc(hovered.x, hovered.y, hovered.r + 2 / k, 0, Math.PI * 2);
      ctx.lineWidth = 1.4 / k;
      ctx.strokeStyle = "#b45309";
      ctx.stroke();
    }

    // Instrumentation: what this frame actually drew and how long it
    // took (the headless checks read it; humans read the pixels).
    const host = containerRef.current;
    if (host) {
      host.dataset.trueEdgesDrawn = String(trueEdgesDrawn);
      host.dataset.outlinesDrawn = String(outlinesDrawn);
      host.dataset.dotsDrawn = String(dotsDrawn);
      host.dataset.labelsDrawn = String(labelsDrawn);
      host.dataset.labelsHeadline = String(headlineLabelsDrawn);
      host.dataset.labelsFallback = String(fallbackLabelsDrawn);
      host.dataset.frameMs = (performance.now() - frameStartedAt).toFixed(2);
    }
  }, [layout, hovered, transform]);

  useEffect(() => {
    draw();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  // ── Pointer → view coordinates (field units of the window) ──
  const viewPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      // One uniform scale (view units per px is width-based) — the
      // window's height in view units is whatever the box gives.
      const scale = FIELD_WIDTH / rect.width;
      return {
        x: (event.clientX - rect.left) * scale,
        y: (event.clientY - rect.top) * scale,
      };
    },
    []
  );

  // Wheel zoom (trackpad pinch arrives as ctrl+wheel). Native
  // listener because it must preventDefault — page scroll and
  // browser-level pinch stay out of the field.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      const point = viewPoint(event);
      if (!point) return;
      event.preventDefault();
      const factor = Math.exp(
        -event.deltaY * (event.ctrlKey ? 0.01 : 0.002)
      );
      stopAnimation();
      userMovedRef.current = true;
      setTransform((current) =>
        zoomFieldAt(current, factor, point.x, point.y, viewHeightRef.current)
      );
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [viewPoint, stopAnimation]);

  // Drag pan + two-pointer pinch.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = viewPoint(event);
      if (!point) return;
      pointersRef.current.set(event.pointerId, point);
      if (pointersRef.current.size === 1) {
        dragStateRef.current = { moved: false };
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / older engines: capture is an enhancement only.
      }
    },
    [viewPoint]
  );

  // Hover rides plain mouse moves (it must not fight the drag).
  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!layout || pointersRef.current.size > 0) return;
      const point = viewPoint(event);
      if (!point) return;
      const field = viewToField(transformRef.current, point.x, point.y);
      setHovered(
        hitTestDot(
          layout.dots,
          field.x,
          field.y,
          4 / transformRef.current.k
        )
      );
    },
    [layout, viewPoint]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = viewPoint(event);
      if (!point || !layout) return;
      const pointers = pointersRef.current;
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      if (pointers.size === 1) {
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        if (Math.abs(dx) + Math.abs(dy) > 0) {
          if (dragStateRef.current) {
            dragStateRef.current.moved =
              dragStateRef.current.moved ||
              Math.hypot(dx, dy) > 3;
          }
          stopAnimation();
          userMovedRef.current = true;
          setTransform((current) =>
            panField(current, dx, dy, viewHeightRef.current)
          );
        }
        pointers.set(event.pointerId, point);
        return;
      }
      // Pinch: two pointers — zoom by the distance ratio, anchored at
      // the midpoint; pan follows the midpoint drift.
      pointers.set(event.pointerId, point);
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const prevOther =
        [...pointers.entries()].find(
          ([id]) => id !== event.pointerId
        )?.[1] ?? previous;
      const prevDist = Math.hypot(
        previous.x - prevOther.x,
        previous.y - prevOther.y
      );
      const nextDist = Math.hypot(a.x - b.x, a.y - b.y);
      if (prevDist > 0 && nextDist > 0) {
        if (dragStateRef.current) dragStateRef.current.moved = true;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        stopAnimation();
        userMovedRef.current = true;
        setTransform((current) =>
          zoomFieldAt(
            current,
            nextDist / prevDist,
            mid.x,
            mid.y,
            viewHeightRef.current
          )
        );
      }
    },
    [viewPoint, layout, stopAnimation]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(event.pointerId);
    },
    []
  );

  // ── Zoom-in-and-enter ──
  const openCompose = useCallback((target: string) => {
    window.history.pushState(
      { corpusField: true },
      "",
      fieldComposeHref(target)
    );
    setOpenTarget(target);
  }, []);

  const enterDot = useCallback(
    (dot: FieldDot) => {
      if (!layout || openTarget) return;
      returnTransformRef.current = transformRef.current;
      const destination = zoomTransformForDot(
        layout,
        dot,
        viewHeightRef.current
      );
      animateTo(destination, ZOOM_IN_MS, () => {
        if (onPick) onPick(dot.target);
        else openCompose(dot.target);
      });
    },
    [layout, openTarget, animateTo, openCompose, onPick]
  );

  // ── Tour spotlight ──
  // Glide 80% of the flight to the spotlighted dot — near enough to
  // single it out, far enough to keep its neighborhood in frame —
  // then pin its hover ring + label. An invisible anchor box renders
  // at the dot's LANDING position so the tour overlay can cut its
  // spotlight hole there. Clearing glides back to where the visitor
  // was.
  const spotlightReturnRef = useRef<FieldTransform | null>(null);
  const [spotlightMark, setSpotlightMark] = useState<{
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    if (!layout) return;
    if (spotlight) {
      const dot = layout.dots.find((item) => item.target === spotlight);
      if (!dot) return;
      spotlightReturnRef.current ??= transformRef.current;
      // Well past the cluster framing — dot-level zoom, so the
      // spotlight hole holds the subtree alone, not its neighborhood.
      // No pinned hover: the subtree and its label ARE the show.
      const cluster = zoomTransformForDot(layout, dot, viewHeightRef.current);
      const k = Math.min(cluster.k * 4, MAX_FIELD_ZOOM);
      const framing = clampFieldTransform(
        {
          k,
          tx: FIELD_WIDTH / 2 - dot.x * k,
          ty: viewHeightRef.current / 2 - dot.y * k,
        },
        viewHeightRef.current
      );
      setSpotlightMark(fieldToView(framing, dot.x, dot.y));
      animateTo(framing, ZOOM_IN_MS);
      return;
    }
    setSpotlightMark(null);
    if (spotlightReturnRef.current) {
      setHovered(null);
      animateTo(spotlightReturnRef.current, ZOOM_IN_MS);
      spotlightReturnRef.current = null;
    }
  }, [spotlight, layout, animateTo]);

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!layout) return;
      if (dragStateRef.current?.moved) {
        // The pointer was panning, not choosing.
        dragStateRef.current = null;
        return;
      }
      dragStateRef.current = null;
      const point = viewPoint(event);
      if (!point) return;
      const field = viewToField(transformRef.current, point.x, point.y);
      const dot = hitTestDot(
        layout.dots,
        field.x,
        field.y,
        4 / transformRef.current.k
      );
      if (dot) enterDot(dot);
    },
    [layout, viewPoint, enterDot]
  );

  // ── History: honest URLs, honest BACK ──
  // Opening a subtree pushes the real compose deep link; BACK pops it,
  // the viewer unmounts, and the camera pulls back out to where the
  // reader was. FORWARD re-opens without ceremony.
  useEffect(() => {
    if (embedded) return;
    const onPopState = () => {
      const target = composeTargetFromLocation();
      if (target) {
        setOpenTarget(target);
      } else {
        setOpenTarget((current) => {
          if (current) {
            animateTo(returnTransformRef.current, ZOOM_OUT_MS);
          }
          return null;
        });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [animateTo, embedded]);

  // The overlay fades in over the zoomed field; the page beneath
  // must not scroll while the viewer owns the screen.
  useEffect(() => {
    if (!openTarget) {
      setOverlayShown(false);
      return;
    }
    const raf = requestAnimationFrame(() => setOverlayShown(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
    };
  }, [openTarget]);

  // At rest the camera cover-fits the window; when a full-bleed host
  // resizes (or first measures), re-fit unless the user has taken
  // the camera somewhere.
  useEffect(() => {
    if (userMovedRef.current || openTarget) return;
    setTransform(fitFieldTransform(viewHeight));
  }, [viewHeight, openTarget]);

  const resetView = useCallback(() => {
    userMovedRef.current = false;
    animateTo(fitFieldTransform(viewHeightRef.current), ZOOM_OUT_MS);
  }, [animateTo]);

  const fitNow = fitFieldTransform(viewHeight);
  const isZoomed =
    Math.abs(transform.k - fitNow.k) > 0.01 ||
    Math.abs(transform.tx - fitNow.tx) > 1 ||
    Math.abs(transform.ty - fitNow.ty) > 1;

  const highlights = useMemo(
    () => (layout ? layout.dots.filter((dot) => dot.highlightLabel) : []),
    [layout]
  );
  const labeledClusters = useMemo(
    () =>
      layout
        ? layout.clusters.filter(
            (cluster) => cluster.moduleCount >= CLUSTER_LABEL_MIN_MODULES
          )
        : [],
    [layout]
  );

  const inView = (x: number, y: number, margin: number) =>
    x > -margin &&
    x < FIELD_WIDTH + margin &&
    y > -margin &&
    y < viewHeight + margin;

  return (
    <div className={frame ? "w-full" : "h-full w-full"}>
      <div
        ref={containerRef}
        data-testid="corpus-field"
        data-dot-count={layout?.dots.length ?? 0}
        data-overlap-pairs={overlapPairs}
        data-layout-ms={layoutMs.toFixed(1)}
        data-group-intra-gap={groupStats.intraMedian.toFixed(2)}
        data-group-inter-gap={groupStats.interMedian.toFixed(2)}
        data-corpus-source={source}
        data-lod={
          transform.k >= MOTIF_ZOOM
            ? "motif"
            : transform.k >= FILAMENT_ZOOM
              ? "mid"
              : "far"
        }
        data-zoom={transform.k.toFixed(3)}
        data-tx={transform.tx.toFixed(1)}
        data-ty={transform.ty.toFixed(1)}
        className={
          frame
            ? "relative w-full touch-none overflow-hidden rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] shadow-sm"
            : "relative h-full w-full touch-none overflow-hidden bg-[var(--color-paper-elevated)]"
        }
        style={
          frame
            ? { aspectRatio: `${FIELD_WIDTH} / ${FIELD_HEIGHT}` }
            : undefined
        }
      >
        {!layout && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
            drawing the corpus…
          </div>
        )}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Map of the encoded legal corpus: every provision-rooted subtree, clustered by jurisdiction. Drag to pan, scroll to zoom, click a subtree to open its rule graph."
          className="absolute inset-0 h-full w-full"
          style={{
            cursor: hovered ? "pointer" : isZoomed ? "grab" : "default",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHovered(null)}
          onClick={onClick}
        />

        {/* Jurisdiction territory labels (pan/zoom with the field) */}
        {labeledClusters.map((cluster) => {
          const pos = fieldToView(
            transform,
            cluster.x,
            cluster.y + cluster.r
          );
          if (!inView(pos.x, pos.y, 60)) return null;
          return (
            <span
              key={cluster.jurisdiction}
              data-testid="corpus-field-cluster"
              className="pointer-events-none absolute -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-muted)] sm:text-[10px]"
              style={{
                left: `${(pos.x / FIELD_WIDTH) * 100}%`,
                top: `${(pos.y / viewHeight) * 100}%`,
              }}
            >
              {clusterLabel(cluster.jurisdiction)}
            </span>
          );
        })}

        {/* The computed doors: the corpus's own largest subtrees */}
        {(() => {
          // Full names, no truncation: chips wrap to the max width
          // and claim real space. Placement is collision-aware —
          // each chip tries above its dot, then below, then further
          // tiers, against the boxes already placed — so long names
          // stack instead of overlapping each other.
          const hostEl = containerRef.current;
          const widthPx = hostEl?.clientWidth ?? FIELD_WIDTH;
          const heightPx = hostEl?.clientHeight ?? viewHeight;
          const CHAR_W = 6.9; // 10px mono uppercase + tracking, approx.
          const LINE_H = 13;
          const PAD_H = 18;
          const PAD_V = 9;
          const MAX_W = 220;
          const GAP = 4;
          const placedChips: Array<{
            x: number;
            y: number;
            w: number;
            h: number;
          }> = [];
          // The launcher's search/mode controls own the top-right
          // corner — chips route around them like any other chip.
          if (embedded) {
            placedChips.push({
              x: widthPx - 250,
              y: 70,
              w: 500,
              h: 140,
            });
          }
          const collides = (box: (typeof placedChips)[number]) =>
            placedChips.some(
              (p) =>
                Math.abs(p.x - box.x) < (p.w + box.w) / 2 + GAP &&
                Math.abs(p.y - box.y) < (p.h + box.h) / 2 + GAP,
            );
          return highlights.map((dot) => {
            const pos = fieldToView(transform, dot.x, dot.y);
            if (!inView(pos.x, pos.y, 40)) return null;
            const label = dot.highlightLabel ?? "";
            const textW = label.length * CHAR_W;
            const lineCount = Math.max(1, Math.ceil(textW / (MAX_W - PAD_H)));
            const w = Math.min(MAX_W, textW + PAD_H);
            const h = lineCount * LINE_H + PAD_V;
            const rPx = dot.r * transform.k * (widthPx / FIELD_WIDTH);
            const cx = Math.min(
              Math.max((pos.x / FIELD_WIDTH) * widthPx, 130),
              widthPx - 130,
            );
            const dotY = (pos.y / viewHeight) * heightPx;
            const base = rPx + GAP + h / 2;
            const tiers = [-base, base];
            for (let extra = 1; extra <= 3; extra += 1) {
              tiers.push(-base - extra * (h + GAP), base + extra * (h + GAP));
            }
            let cy = dotY + tiers[0]!;
            for (const tier of tiers) {
              const candidate = { x: cx, y: dotY + tier, w, h };
              if (!collides(candidate)) {
                cy = candidate.y;
                break;
              }
            }
            placedChips.push({ x: cx, y: cy, w, h });
            return (
              <a
                key={dot.target}
                href={fieldComposeHref(dot.target)}
                data-testid="corpus-field-highlight"
                title={humanizeCitation(dot.target)}
                onClick={(event) => {
                  // Zoom in, don't navigate away — plain left-click
                  // enters in place; modified clicks keep link behavior.
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  enterDot(dot);
                }}
                // NOTE: centering lives in the inline transform only —
                // Tailwind's -translate-x-1/2 uses the separate
                // `translate` property and would compose (double-shift).
                className="absolute z-10 max-w-[220px] whitespace-normal text-center leading-[1.3] rounded border border-[var(--color-accent)] bg-[var(--color-paper)] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[var(--color-ink)] no-underline shadow-sm hover:bg-[var(--color-accent-light)] sm:px-2 sm:py-1 sm:text-[10px]"
                style={{
                  left: `${cx}px`,
                  top: `${cy}px`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {dot.highlightLabel}
              </a>
            );
          });
        })()}

        {/* Invisible anchor at the spotlighted dot's landing spot —
            the guided tour's overlay cuts its hole around this box,
            sized to cover the ring, pinned card, and label. */}
        {spotlightMark && (
          <div
            data-testid="field-spotlight"
            className="pointer-events-none absolute"
            style={{
              left: `${(spotlightMark.x / FIELD_WIDTH) * 100}%`,
              top: `${(spotlightMark.y / viewHeight) * 100}%`,
              width: 300,
              height: 280,
              transform: "translate(-50%, -50%)",
            }}
          />
        )}

        {/* Hover tooltip: humanized citation + rule count */}
        {hovered &&
          (() => {
            const pos = fieldToView(transform, hovered.x, hovered.y);
            if (!inView(pos.x, pos.y, 20)) return null;
            return (
              <div
                role="tooltip"
                data-testid="corpus-field-tooltip"
                className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-[var(--color-rule)] bg-[var(--color-paper)] px-2 py-1 shadow-md"
                style={{
                  left: `${(pos.x / FIELD_WIDTH) * 100}%`,
                  top: `${((pos.y - hovered.r * transform.k - 4) / viewHeight) * 100}%`,
                }}
              >
                {hovered.headlineRule && (
                  <span className="block font-mono text-[11px] font-semibold text-[var(--color-ink)]">
                    {humanizeRuleName(hovered.headlineRule)}
                  </span>
                )}
                <span className="block font-mono text-[11px] text-[var(--color-ink)]">
                  {humanizeCitation(hovered.target)}
                </span>
              </div>
            );
          })()}

        {/* Overview reset — appears once the camera has moved */}
        {isZoomed && !openTarget && (
          <button
            type="button"
            data-testid="corpus-field-reset"
            onClick={resetView}
            className="absolute right-2 top-2 z-20 inline-flex h-6 items-center gap-1 rounded border border-[var(--color-rule)] bg-[var(--color-paper)] px-1.5 py-0 font-sans text-[10px] font-medium normal-case tracking-normal text-[var(--color-ink-secondary)] transition-colors hover:bg-[var(--color-paper-elevated)] hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <Scan size={12} aria-hidden="true" /> Whole corpus
          </button>
        )}
      </div>

      {/* The compose viewer, mounted in place over the zoomed field.
          The URL is already the real deep link (pushState above), so
          reload serves the standalone graph route and BACK returns
          here. z-index sits under the fixed site nav (z-100) so the
          overlay reads exactly like the standalone page. */}
      {!embedded && openTarget && (
        <div
          data-testid="corpus-field-overlay"
          className="fixed inset-0 z-90 bg-[#f4f1ec] transition-opacity duration-300"
          style={{ opacity: overlayShown ? 1 : 0 }}
        >
          {/* No extra top padding: the viewer spaces itself below the
              fixed nav exactly like the standalone /axiom/graph page.
              Back-to-overview replays the field's own BACK journey —
              the pushState above owns this history entry. */}
          <div className="h-full">
            <ComposeViewer
              key={openTarget}
              onBackToOverview={() => window.history.back()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
