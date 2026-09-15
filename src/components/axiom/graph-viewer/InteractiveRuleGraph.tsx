import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GraphLoading } from "./graph-loading";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type ReactFlowInstance,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { BaseEdge, SmoothStepEdge, useReactFlow, type EdgeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { graphFitViewport, MAX_GRAPH_ZOOM } from "./zoom-bounds";
import { dependencySubgraph, upstreamIds, upstreamNodeIds } from "./focus-layout";
import type { DashboardSpec, ParameterRule, TraceNode } from "./types";
import {
  evalAst,
  parseFormula,
  toBool,
  type AstNode,
  type EvalValue,
} from "./formula";
import {
  axiomAppUrl,
  fileLegalIdOf,
  humanizeCitation,
  humanizeRuleName,
  humanizeSource,
} from "./citations";

interface Props {
  spec: DashboardSpec;
  /** legalId → trace node for every output (and recursively its dependencies). */
  traces: Record<string, TraceNode>;
  /** Builder hook to toggle exposure of an input from inside the graph.
   *  Click on an exposed input removes it; click on a default input
   *  exposes it. App.tsx's handleExposeInput implements both directions. */
  onExposeInput?: (legalId: string) => void;
  /** Builder feedback: which inputs are already user-driven. */
  exposedInputIds?: Set<string>;
  /** Builder feedback: which rules are already exposed as outputs. */
  selectedOutputIds?: Set<string>;
  /** When true, show evaluated values + verdict colors. False = pure structure. */
  showValues?: boolean;
  /** The host is already displaying the graph-loading indicator. */
  suppressLoadingIndicator?: boolean;
  /** Restrict the canvas to the selected node and its dependencies. */
  nodeScoped?: boolean;
  /**
   * Parameter rules from the program graph. When a formula references a
   * bare name that resolves to one of these, the resulting node renders
   * with a hover popover showing the parameter's citation, current value
   * and a link to the Axiom app entry.
   */
  parameterRules?: ParameterRule[];
  /** Dissection policy: "auto" folds only past the size threshold;
   *  "always" opens one hop regardless (the rule lens). */
  dissect?: "auto" | "always";
  /** Controlled fold state (the navigator tree shares it). */
  collapsed?: Set<string>;
  onCollapsedChange?: (next: Set<string>) => void;
  /** Fly the camera to this rule; bump nonce to re-trigger. */
  flyTo?: {
    legalId: string;
    nonce: number;
    immediate?: boolean;
    soft?: boolean;
    readable?: boolean;
  } | null;
  /** Run mode: the execution layer is live — executed nodes lift,
   *  the rest recede, the camera flies the executed path. */
  executionActive?: boolean;
  /** Durable legal ids the run actually computed or consumed —
   *  the executed subgraph. */
  executedLegalIds?: Set<string>;
  /** Node click → inspector. Fired for plain clicks (not action
   *  rows, which keep their own routing). */
  onInspect?: (data: IrgNodeData) => void;
  /** Keep this node's lineage lit while its info card is open. */
  pinnedLegalId?: string | null;
  /** Light this node's lineage while the pointer rests on its Index
   *  entry — the sidebar and the canvas are the same map. */
  hoverLegalId?: string | null;
  /** Clicking empty canvas — the app closes the info card. */
  onPaneClear?: () => void;
  /** Host element for the controls bar (a slot in the frame's header
   *  row). Portaled there when provided; rendered above the canvas
   *  otherwise. */
  controlsSlot?: HTMLElement | null;
  /** Double-click → open the rule lens on this node. */
  onLens?: (legalId: string) => void;
}

/**
 * Pan/zoom interactive DAG of every selected output's computation. Powered
 * by React Flow.
 *
 * Design:
 *   - Atomic inputs and sub-rules dedupe across outputs, so a shared input
 *     like `household_size` appears once and connects to every output that
 *     uses it. The graph naturally encodes the dashboard's full structure.
 *   - Sub-rule pills start *collapsed* — clicking expands them inline by
 *     replacing the pill with its formula's AST (recursive). Clicking
 *     again collapses. This makes huge programs explorable without
 *     overwhelming the user up front.
 *   - Layout via dagre; React Flow handles pan/zoom/drag, minimap, and
 *     fit-to-view controls.
 */
export function InteractiveRuleGraph({
  spec,
  traces,
  onExposeInput,
  exposedInputIds,
  selectedOutputIds,
  showValues = false,
  suppressLoadingIndicator = false,
  nodeScoped = false,
  parameterRules,
  dissect = "auto",
  collapsed: controlledCollapsed,
  onCollapsedChange,
  flyTo,
  executionActive = false,
  executedLegalIds,
  onInspect,
  pinnedLegalId = null,
  hoverLegalId = null,
  onPaneClear,
  controlsSlot = null,
  onLens,
}: Props) {
  // Sub-rules expand inline by default — the user gets the full DAG to atomic
  // inputs out of the box. They can collapse any sub-rule to hide its
  // internals; we track those user-collapses in the `collapsed` set rather
  // than the inverse.
  const [internalCollapsed, setInternalCollapsed] = useState<Set<string>>(
    () => initialCollapse(traces, dissect),
  );
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const setCollapsed = useCallback(
    (update: Set<string> | ((current: Set<string>) => Set<string>)) => {
      const apply = (current: Set<string>) =>
        typeof update === "function" ? update(current) : update;
      if (onCollapsedChange) {
        onCollapsedChange(apply(controlledCollapsedRef.current ?? new Set()));
      } else {
        setInternalCollapsed(apply);
      }
    },
    [onCollapsedChange],
  );
  const controlledCollapsedRef = useRef(controlledCollapsed);
  controlledCollapsedRef.current = controlledCollapsed;
  // Re-dissect when the program (trace set) or policy changes
  // (uncontrolled mode only — controlled owners re-dissect themselves).
  const traceKey = Object.keys(traces).sort().join("|") + "::" + dissect;
  const lastTraceKey = useRef(traceKey);
  useEffect(() => {
    if (lastTraceKey.current !== traceKey) {
      lastTraceKey.current = traceKey;
      if (!controlledCollapsed) {
        setInternalCollapsed(initialCollapse(traces, dissect));
      }
    }
  }, [traceKey, traces, dissect, controlledCollapsed]);
  // "wires": collapse operator boxes — atomic inputs connect directly to
  //   the sub-rule or output that consumes them. Cleanest overview, and
  //   the default since most users care about structure first.
  // "operators": full graph with every AND / + / IF / count_where node
  //   visible — opt-in for when the user wants to inspect arithmetic.
  const [detail, setDetail] = useState<"operators" | "wires">("wires");
  const wrapRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<Pick<ReactFlowInstance, "getViewport" | "setViewport" | "zoomTo"> | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Execution dissects its own path: nodes the run computed unfold
  // so the machinery that actually ran is visible, while untouched
  // branches stay folded.
  useEffect(() => {
    if (!executionActive || !executedLegalIds || executedLegalIds.size === 0) {
      return;
    }
    setCollapsed((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of executedLegalIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : current;
    });
  }, [executionActive, executedLegalIds]);

  // Semantic zoom: far viewports render constellation pills, mid
  // hides secondary chrome, near shows full cards.
  const [lod, setLod] = useState<"near" | "mid" | "far">("near");
  const lodTimer = useRef<number | null>(null);
  const [upstreamDepth, setUpstreamDepth] = useState<number>(Infinity);
  const [layoutFocusId, setLayoutFocusId] = useState<string | null>(null);
  const [frameRequest, setFrameRequest] = useState<{ mode: "all" | "upstream"; nonce: number } | null>(null);
  const requestFrame = (mode: "all" | "upstream", id: string | null = pinnedLegalId) => {
    setLayoutFocusId(mode === "all" ? null : id);
    setFrameRequest((previous) => ({ mode, nonce: (previous?.nonce ?? 0) + 1 }));
  };
  const changeDepth = (depth: number) => {
    setScopeId(pinnedLegalId ?? scopeId);
    setUpstreamDepth(depth);
    requestFrame(pinnedLegalId ? "upstream" : "all");
  };
  // While the camera moves, hover is inert: a cursor incidentally
  // crossing cards mid-flight must not flicker highlights.
  const moveBusy = useRef(false);
  const moveEndTimer = useRef<number | null>(null);
  // When the user hovers any node, dim everything that isn't part of its
  // lineage (ancestors that feed into it + descendants it feeds). For a
  // mathematical operator that means "the boxes it pertains to"; for an
  // intermediate variable that means the chain on both sides.
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);
  // Wait for web fonts before the first visible graph render. Otherwise we
  // measure labels with fallback metrics, render a layout, then rebuild and
  // let React Flow fitView again when the final font arrives.
  const [fontsReady, setFontsReady] = useState(
    () => typeof document === "undefined" || !("fonts" in document),
  );
  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    let cancelled = false;
    void (document as Document).fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Track Fullscreen API state so the toggle reflects reality (user may
  // press Esc, click outside, etc.).
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(document.fullscreenElement === wrapRef.current);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!wrapRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void wrapRef.current.requestFullscreen();
    }
  }, []);

  const toggleCollapse = useCallback(
    (legalId: string) => {
      setCollapsed((s) => {
        const next = new Set(s);
        if (next.has(legalId)) next.delete(legalId);
        else next.add(legalId);
        return next;
      });
    },
    [setCollapsed],
  );

  const canExposeInputs = !!onExposeInput;
  // Which question cards will carry an answer box, a members line or
  // a default chip — the layout reserves room only for rows that
  // render. Keyed as a string so the memo only re-lays-out when the
  // set of rows actually changes, not on every keystroke's new Set.
  const editCtx = useContext(InputEditContext);
  const sizeHintsKey = [
    editCtx.onChange ? Object.keys(editCtx.values).sort().join(",") : "",
    [...editCtx.answered].sort().join(","),
    Object.keys(editCtx.memberValues ?? {}).sort().join(","),
  ].join("|");
  const sizeHints = useMemo<SizeHints>(
    () => ({
      answerable: new Set(editCtx.onChange ? Object.keys(editCtx.values) : []),
      answered: new Set(editCtx.answered),
      members: new Set(Object.keys(editCtx.memberValues ?? {})),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sizeHintsKey],
  );
  // Opening a graph defines its scope; inspecting another node only moves
  // the camera. Explicit depth changes may choose a new scope.
  const [scopeId, setScopeId] = useState<string | null>(() => {
    const linked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("selection");
    return linked ?? pinnedLegalId ?? spec.outputs[0]?.legalId ?? null;
  });
  const baseGraph = useMemo(
    () =>
      buildGraph(
        spec,
        traces,
        nodeScoped ? new Set<string>() : collapsed,
        exposedInputIds,
        showValues,
        detail,
        canExposeInputs,
        parameterRules,
        selectedOutputIds,
        // The canvas's shape steers how far apart the columns sit —
        // read at build time; the wrap is mounted by the time fonts
        // are ready (the loading shell shares the ref).
        stageAspectOf(wrapRef.current),
        sizeHints,
      ),
    [
      spec,
      traces,
      nodeScoped,
      collapsed,
      exposedInputIds,
      showValues,
      detail,
      canExposeInputs,
      parameterRules,
      selectedOutputIds,
      fontsReady,
      sizeHints,
    ],
  );

  const focusedIds = useMemo(() => upstreamIds(baseGraph.nodes, baseGraph.edges, layoutFocusId, upstreamDepth), [baseGraph, layoutFocusId, upstreamDepth]);
  const { nodes, edges } = useMemo(() => {
    if (!nodeScoped) return baseGraph;
    const root = baseGraph.nodes.some(node => node.data.legalId === scopeId) ? scopeId : spec.outputs[0]?.legalId ?? null;
    const scoped = dependencySubgraph(baseGraph.nodes, baseGraph.edges, root, upstreamDepth);
    // Lay out only this dependency tree, without gaps left by other outputs.
    layout(scoped.nodes, scoped.edges, stageAspectOf(wrapRef.current), sizeHints);
    return scoped;
  }, [baseGraph, nodeScoped, scopeId, upstreamDepth, sizeHints]);

  const lastCameraSelection = useRef<string | null>(null);
  const focusSelection = (id: string) => {
    const ids = upstreamIds(nodes, edges, id, upstreamDepth);
    const viewport = graphFitViewport(nodes.filter(node => ids.has(node.id)), canvasSize.width, canvasSize.height);
    if (!viewport || !flowRef.current) return;
    lastCameraSelection.current = id;
    void flowRef.current.setViewport(viewport, {
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500,
      interpolate: "linear",
      ease: (t: number) => 1 - Math.pow(1 - t, 3),
    });
  };
  useEffect(() => {
    if (!flyTo) return;
    if (flyTo.legalId === "*") requestFrame("all");
    else focusSelection(flyTo.legalId);
  }, [flyTo]);
  useEffect(() => {
    if (pinnedLegalId && pinnedLegalId !== lastCameraSelection.current) focusSelection(pinnedLegalId);
    if (!pinnedLegalId) lastCameraSelection.current = null;
  }, [pinnedLegalId, nodes, canvasSize]);

  const fitViewport = useMemo(() => graphFitViewport(nodes, canvasSize.width, canvasSize.height), [nodes, canvasSize]);
  const minGraphZoom = fitViewport?.zoom ?? .01;
  useEffect(() => {
    if (!frameRequest || (frameRequest.mode === "upstream" && !focusedIds.size)) return;
    const visible = frameRequest.mode === "upstream" && focusedIds.size ? nodes.filter((node) => focusedIds.has(node.id)) : nodes;
    const viewport = graphFitViewport(visible, canvasSize.width, canvasSize.height);
    if (viewport) void flowRef.current?.setViewport(viewport, { duration: 600, interpolate: "smooth" });
  }, [frameRequest, nodes, focusedIds, canvasSize]);
  useEffect(() => {
    if (!fontsReady) return;
    const canvas = wrapRef.current?.querySelector(".irg-canvas");
    if (!canvas) return;
    const update = () => setCanvasSize({ width: canvas.clientWidth, height: canvas.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fontsReady]);
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || !fitViewport) return;
    const current = flow.getViewport();
    if (current.zoom < fitViewport.zoom - .0001) void flow.setViewport(fitViewport);
    else if (current.zoom > MAX_GRAPH_ZOOM) void flow.zoomTo(MAX_GRAPH_ZOOM);
  }, [fitViewport]);
  const stepZoom = (factor: number) => {
    const flow = flowRef.current;
    if (flow) void flow.zoomTo(Math.max(minGraphZoom, Math.min(MAX_GRAPH_ZOOM, flow.getViewport().zoom * factor)), { duration: 200 });
  };

  // Pre-compute the incoming and outgoing edge maps once per build. We use
  // these to BFS both directions from any hovered node and find its full
  // lineage (ancestors that contribute + descendants it feeds).
  const adjacency = useMemo(() => {
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const e of edges) {
      if (!incoming.has(e.target)) incoming.set(e.target, []);
      incoming.get(e.target)!.push(e.source);
      if (!outgoing.has(e.source)) outgoing.set(e.source, []);
      outgoing.get(e.source)!.push(e.target);
    }
    return { incoming, outgoing };
  }, [edges]);

  // Fast id → kind lookup for the lineage walker.
  const kindById = useMemo(() => {
    const m = new Map<string, IrgNodeData["kind"]>();
    for (const n of nodes) m.set(n.id, (n.data as IrgNodeData).kind);
    return m;
  }, [nodes]);

  // Highlighted set for the currently-hovered node.
  //   - Math operators (AND/+/IF/=): "the boxes it pertains to" — nearest
  //     variables on each side. Chained operators are walked through
  //     transparently so the highlight reaches actual semantic inputs and
  //     consumers, not just plumbing.
  //   - Inputs and intermediate variables (sub-rules): only the
  //     downstream chain — every rule/output the variable flows into.
  //     Lets the user trace "where does this contribute?" without
  //     pulling in the upstream definition (which is shown when the
  //     rule itself is expanded inline).
  //   - Outputs: ancestors (the only meaningful direction — outputs
  //     have nothing downstream).
  // A dissection can unmount the hovered card mid-hover, so its
  // mouseleave never fires and the stale lineage would dim the whole
  // rebuilt graph. Any rebuild clears the hover highlight.
  useEffect(() => {
    setHighlightNodeId(null);
  }, [nodes]);

  const nodeIdForLegalId = (legalId: string | null) => {
    if (!legalId) return null;
    const match = nodes.find(
      (n) =>
        (n.data as IrgNodeData & { legalId?: string }).legalId === legalId,
    );
    return match?.id ?? null;
  };
  const pinnedNodeId = useMemo(
    () => nodeIdForLegalId(pinnedLegalId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, pinnedLegalId],
  );
  const hoverNodeId = useMemo(
    () => nodeIdForLegalId(hoverLegalId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, hoverLegalId],
  );
  // A selection keeps its path at every zoom level until explicitly cleared.
  // Hover previews apply only when no node is selected.
  const activeHighlightId = pinnedNodeId ?? highlightNodeId ?? hoverNodeId;

  const lineageOf = useCallback((startId: string): Set<string> => upstreamNodeIds(nodes, edges, startId, upstreamDepth), [nodes, edges, upstreamDepth]);
  const highlightSet = useMemo(
    () => (activeHighlightId ? lineageOf(activeHighlightId) : null),
    [activeHighlightId, lineageOf],
  );
  // The pinned card's lineage is what a click frames: the camera
  // fits the whole highlighted chain, not just the card, so the
  // shape of what feeds it (or what it feeds) is on screen at once.
  const pinnedFrame = useMemo(
    () => (pinnedNodeId ? lineageOf(pinnedNodeId) : null),
    [pinnedNodeId, lineageOf],
  );

  // Apply the highlight by tagging each node and edge with a className
  // reflecting whether it's on the lineage. CSS handles the dim/emphasize
  // transitions so this re-render is cheap.
  // The executed subgraph: nodes carrying a computed value while the
  // execution layer is live. Drives depth-of-field, edge glow, and
  // the camera.
  const executedIds = useMemo(() => {
    if (!executionActive) return new Set<string>();
    const ids = new Set<string>();
    for (const n of nodes) {
      const d = n.data as IrgNodeData;
      if (
        "legalId" in d &&
        d.legalId &&
        executedLegalIds?.has(d.legalId)
      ) {
        ids.add(n.id);
      }
    }
    return ids;
  }, [nodes, executionActive, executedLegalIds]);

  const outputNodeIds = useMemo(
    () =>
      nodes
        .filter((n) => (n.data as IrgNodeData).kind === "output")
        .map((n) => n.id),
    [nodes],
  );

  // Depth of each executed node along the executed subgraph, for the
  // wave: values and lifts ripple in computation order.
  const execDepth = useMemo(() => {
    const depth = new Map<string, number>();
    if (executedIds.size === 0) return depth;
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      if (executedIds.has(e.source) && executedIds.has(e.target)) {
        if (!incoming.has(e.target)) incoming.set(e.target, []);
        incoming.get(e.target)!.push(e.source);
      }
    }
    const resolve = (id: string, stack: Set<string>): number => {
      const cached = depth.get(id);
      if (cached !== undefined) return cached;
      if (stack.has(id)) return 0;
      stack.add(id);
      const parents = incoming.get(id) ?? [];
      const d =
        parents.length === 0
          ? 0
          : Math.max(...parents.map((p) => resolve(p, stack))) + 1;
      depth.set(id, d);
      return d;
    };
    for (const id of executedIds) resolve(id, new Set());
    return depth;
  }, [edges, executedIds]);


  // Cards that survive a rebuild glide from where they were to where
  // the new layout puts them; the wires follow because the positions
  // React Flow sees are the tweened ones.
  const { positions: tweened, entering } = useLayoutTween(nodes, wrapRef);
  const displayNodes = useMemo(() => {
    let out = nodes.map((n) => {
      const d = n.data as IrgNodeData;
      const slid = tweened?.get(n.id);
      if (slid) n = { ...n, position: slid };
      const legalId =
        "legalId" in d && d.legalId ? d.legalId : ("meta" in d ? d.meta?.legalId : undefined);
      const bucket = legalId?.split(":")[1]?.split("/")[0];
      // Precomputed wrapper classes — the :has() selectors these
      // replace forced style recalc across every node on the canvas.
      const marks = [
        bucket ? `irg-src-${bucket}` : "",
        "value" in d && d.value && "showValues" in d && d.showValues
          ? "irg-has-value"
          : "",
        "kind" in d && d.kind === "output" ? "irg-is-output" : "",
        // The card whose info panel is open — run mode keeps it lit
        // even when the execution layer would recede it.
        n.id === pinnedNodeId ? "irg-inspected" : "",
        entering?.has(n.id) ? "irg-entering" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return marks ? { ...n, className: marks } : n;
    });
    if (executionActive) {
      out = out.map((n) => ({
        ...n,
        className: `${n.className ?? ""} ${
          executedIds.has(n.id) ? "irg-exec-node" : "irg-exec-off"
        }`.trim(),
        style: executedIds.has(n.id)
          ? {
              ...n.style,
              ["--exec-order" as string]: String(execDepth.get(n.id) ?? 0),
            }
          : n.style,
      }));
    }
    if (!highlightSet) return out;
    return out.map((n) => ({
      ...n,
      className: `${n.className ?? ""} ${
        highlightSet.has(n.id) ? "irg-rf-on-path" : "irg-rf-dimmed"
      }`.trim(),
    }));
  }, [nodes, tweened, entering, highlightSet, executionActive, executedIds, pinnedNodeId]);

  const displayEdges = useMemo(() => {
    let out = edges;
    if (executionActive) {
      out = out.map((e) => ({
        ...e,
        className: `${e.className ?? ""} ${
          executedIds.has(e.source) && executedIds.has(e.target)
            ? "irg-exec-edge"
            : "irg-exec-dim"
        }`.trim(),
      }));
    }
    if (!highlightSet) return out;
    return out.map((e) => {
      const lit = highlightSet.has(e.source) && highlightSet.has(e.target);
      return {
        ...e,
        className: `${e.className ?? ""} ${lit ? "irg-rf-on-path" : "irg-rf-dimmed"}`.trim(),
      };
    });
  }, [edges, highlightSet, executionActive, executedIds]);

  // Coarse geometry fingerprint — changes whenever a relayout moves
  // nodes, which is what the survey camera needs to chase.
  // From the target layout, not the sliding positions — a tween's
  // every frame would otherwise read as a fresh relayout and restart
  // the camera each time.
  const layoutSig = useMemo(
    () =>
      nodes.length +
      ":" +
      Math.round(nodes.reduce((sum, n) => sum + n.position.x + n.position.y, 0)),
    [nodes],
  );

  if (!fontsReady) {
    return (
      <div ref={wrapRef} className="irg-wrap">
        {!suppressLoadingIndicator && <GraphLoading label="Preparing graph…" />}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      data-lod={lod}
      className={`irg-wrap ${isFullscreen ? "irg-fullscreen" : ""}`}
    >
      <ReactFlowProvider>
        {(() => {
          // The browser paints only the fullscreen element's subtree, so
          // while .irg-wrap is fullscreen the bar has to live inside it —
          // otherwise every control, the exit button included, vanishes.
          const slot = isFullscreen ? null : controlsSlot;
          const controlsBar = (
        <div className={`irg-controls-bar ${slot ? "irg-controls-inline" : ""}`}>
          <div className="irg-toolbar">
            <div className="irg-zoom-controls" aria-label="Graph zoom">
              <button type="button" className="irg-toolbar-btn" onClick={() => stepZoom(1 / 1.25)} disabled={zoomPercent <= Math.round(minGraphZoom * 100)} aria-label="Zoom out">−</button>
              <span aria-label="Zoom level">{zoomPercent}%</span>
              <button type="button" className="irg-toolbar-btn" onClick={() => stepZoom(1.25)} disabled={zoomPercent >= MAX_GRAPH_ZOOM * 100} aria-label="Zoom in">+</button>
            </div>
              <div className="irg-depth-control" role="group" aria-label="Dependency depth">
                <span>Depth</span>
                <button type="button" className="irg-toolbar-btn" aria-label="Decrease dependency depth" disabled={upstreamDepth === 1} onClick={() => changeDepth(Number.isFinite(upstreamDepth) ? upstreamDepth - 1 : 5)}>−</button>
                <select aria-label="Dependency depth" value={String(upstreamDepth)} onChange={(event) => changeDepth(Number(event.target.value))}>
                  <option value="1">1 level</option>
                  <option value="2">2 levels</option>
                  <option value="3">3 levels</option>
                  <option value="4">4 levels</option>
                  <option value="5">5 levels</option>
                  <option value="Infinity">Full depth</option>
                </select>
                <button type="button" className="irg-toolbar-btn" aria-label="Increase dependency depth" disabled={!Number.isFinite(upstreamDepth)} onClick={() => changeDepth(upstreamDepth >= 5 ? Infinity : upstreamDepth + 1)}>+</button>
              </div>
            <div className="irg-toolbar-segment" role="tablist" aria-label="Detail level">
              <button
                type="button"
                className={`irg-toolbar-btn ${detail === "operators" ? "is-active" : ""}`}
                onClick={() => setDetail("operators")}
                role="tab"
                aria-selected={detail === "operators"}
                title="Show operators (AND, OR, IF, comparisons, arithmetic)"
              >
                Operators
              </button>
              <button
                type="button"
                className={`irg-toolbar-btn ${detail === "wires" ? "is-active" : ""}`}
                onClick={() => setDetail("wires")}
                role="tab"
                aria-selected={detail === "wires"}
                title="Hide operators — show only inputs, sub-rules, outputs and the wires between them"
              >
                Wires only
              </button>
            </div>
          </div>
          <button
            type="button"
            className="irg-fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit full screen (Esc)" : "Enter full screen"}
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path
                  d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path
                  d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        </div>
          );
          return slot ? createPortal(controlsBar, slot) : controlsBar;
        })()}
        <div className="irg-canvas">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          elevateEdgesOnSelect={false}
          fitView
          // The first view is the whole map. A zoom floor here cut tall
          // graphs off at the bottom with nothing to say so — a tower of
          // questions needs ~0.1 to fit a laptop canvas.
          fitViewOptions={{ padding: 0.1, minZoom: minGraphZoom, maxZoom: MAX_GRAPH_ZOOM }}
          minZoom={minGraphZoom}
          maxZoom={MAX_GRAPH_ZOOM}
          proOptions={{ hideAttribution: true }}
          onInit={(flow) => {
            flowRef.current = flow;
            const zoom = flow.getViewport().zoom;
            wrapRef.current?.style.setProperty("--edge-scale", String(1 / zoom));
            wrapRef.current?.style.setProperty("--edge-weight", String(Math.min(1.25, .6 + zoom * .65)));
          }}
          onMove={(_event, viewport) => {

            wrapRef.current?.style.setProperty("--edge-scale", String(1 / viewport.zoom));
            wrapRef.current?.style.setProperty("--edge-weight", String(Math.min(1.25, .6 + viewport.zoom * .65)));
            if (!moveBusy.current) {
              moveBusy.current = true;
              setHighlightNodeId(null);
              wrapRef.current?.classList.add("is-moving");
            }
            if (moveEndTimer.current)
              window.clearTimeout(moveEndTimer.current);
            moveEndTimer.current = window.setTimeout(() => {
              setZoomPercent(Math.round(viewport.zoom * 100));
              moveBusy.current = false;
              wrapRef.current?.classList.remove("is-moving");
            }, 180);
            const zoom = viewport.zoom;
            // Defer LOD swaps until the camera rests, and switch with
            // hysteresis — resting exactly on a boundary must not
            // thrash the chrome on/off (reads as heavy flicker).
            if (lodTimer.current) window.clearTimeout(lodTimer.current);
            lodTimer.current = window.setTimeout(() => {
              setLod((current) => {
                if (current === "near") {
                  if (zoom < 0.4) return "far";
                  if (zoom < 0.7) return "mid";
                  return "near";
                }
                if (current === "mid") {
                  if (zoom > 0.8) return "near";
                  if (zoom < 0.38) return "far";
                  return "mid";
                }
                if (zoom > 0.8) return "near";
                if (zoom > 0.46) return "mid";
                return "far";
              });
            }, 300);
          }}
          connectionLineType={ConnectionLineType.SmoothStep}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          onNodeMouseEnter={(_e, node) => {
            if (moveBusy.current) return;
            const kind = (node.data as IrgNodeData).kind;
            // Literals (raw numbers) aren't useful to highlight from — they
            // appear in many unrelated places and would light up half the
            // graph at once.
            if (kind !== "literal") setHighlightNodeId(node.id);
          }}
          onNodeMouseLeave={() => setHighlightNodeId(null)}
          onPaneClick={() => onPaneClear?.()}
          onNodeClick={(e, node) => {
            const data = node.data as IrgNodeData;
            const target = e.target as HTMLElement;
            // Each action row tags itself with data-action; we route the
            // click to the right handler based on which row was hit.
            const actionEl = target.closest(".irg-action") as HTMLElement | null;
            const action = actionEl?.dataset.action;
            if (data.kind === "input" && onExposeInput && actionEl) {
              onExposeInput(data.legalId);
              return;
            }
            if (data.kind === "ruleRef") {
              if (!nodeScoped && action === "collapse" && data.canExpand) {
                toggleCollapse(data.legalId);
                return;
              }
            }
            if (data.kind === "output") {
              if (!nodeScoped && action === "collapse" && data.canExpand) {
                toggleCollapse(data.legalId);
                return;
              }
            }
            if (!actionEl) {
              if ("legalId" in data && data.legalId) focusSelection(data.legalId);
              onInspect?.(data);
            }
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e7e5e4" />
          {!nodeScoped && !frameRequest && <FlyToController
            target={flyTo ?? null}
            layoutSig={layoutSig}
            nodes={displayNodes}
            frame={pinnedFrame}
          />}

          <GraphMiniMap />
        </ReactFlow>
        </div>
      </ReactFlowProvider>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Node data + components
// ─────────────────────────────────────────────────────────────────────────

interface NodeMeta {
  /** Short kind line: "Output · money", "Input · boolean", "Rule · judgment" */
  kindLine: string;
  /** Humanized citation, e.g. "10 CCR 2506-1 § 4.207.3 (Colorado)". */
  citation?: string;
  /** True when `citation` came from the node's own `source` field, not
   *  the file-id display fallback. Only sourced citations may steer
   *  Read-the-law targeting — the fallback is presentation, not law. */
  citationFromSource?: boolean;
  /** URL of the rule's primary legal source — when present, the citation
   *  renders as a link to it. */
  sourceUrl?: string | null;
  /** Full legal ID (mono, small) so power users can grep. */
  legalId: string;
  /** Deep link into the Axiom app's regulation viewer, if resolvable. */
  appUrl?: string | null;
  /** For rules: a one-liner of the rule's formula (truncated) so the user
   *  gets the "what does this compute" without expanding. */
  formulaPreview?: string;
  /** For parameters: the constant value or expression backing the parameter. */
  parameterValue?: string;
  /** Full formula text — shown only behind an unfold in the inspector. */
  formula?: string;
}

export type IrgNodeData =
  | {
      kind: "output";
      label: string;
      legalId: string;
      verdictCls: string;
      value: string;
      showValues: boolean;
      meta: NodeMeta;
      /** True when the underlying trace has a formula whose upstream
       *  chain we can collapse. */
      canExpand: boolean;
      /** Steps hidden behind this node while collapsed. */
      hiddenCount?: number;
      /** Current collapse state — drives "+ expand" / "− collapse". */
      isExpanded: boolean;
    }
  | {
      kind: "input";
      label: string;
      legalId: string;
      source: "user" | "default";
      canExpose: boolean;
      value: string;
      showValues: boolean;
      meta: NodeMeta;
    }
  | {
      kind: "operator";
      label: string;
      verdictCls: string;
      value: string;
      showValues: boolean;
    }
  | {
      kind: "ifGate";
      label: string;
      verdictCls: string;
      branchLabel: string;
      value: string;
      showValues: boolean;
    }
  | {
      kind: "ruleRef";
      label: string;
      legalId: string;
      canExpand: boolean;
      hiddenCount?: number;
      isParameter: boolean;
      /** Whether the rule is currently selected as a dashboard output. */
      isOutput: boolean;
      verdictCls: string;
      value: string;
      isExpanded: boolean;
      showValues: boolean;
      meta: NodeMeta;
    }
  | {
      kind: "literal";
      label: string;
    }
  | {
      kind: "unknown";
      label: string;
      isParameter?: boolean;
      /** Set when the unknown identifier resolves to a parameter rule —
       *  enables the hover popover with citation/value/Axiom link. */
      meta?: NodeMeta;
    };

/** Inputs only emit edges (rightward), so they don't need a target handle. */
/** Fly the viewport to a rule by durable legal id. */
/**
 * The minimap is a working map, not a picture: drag the viewport box
 * to pan, wheel to zoom, and click anywhere to travel there — at a
 * readable zoom, since "go to that section" is the point of a click.
 */
function GraphMiniMap() {
  const flow = useReactFlow();
  return (
    <MiniMap
      nodeColor={(n) => miniMapColor(n.data as IrgNodeData)}
      nodeStrokeColor={(n) => miniMapColor(n.data as IrgNodeData)}
      nodeBorderRadius={2}
      pannable
      zoomable
      position="bottom-right"
      style={{ background: "var(--color-paper-elevated)", border: "1px solid var(--color-rule)" }}
      onClick={(_event, position) => {
        const zoom = flow.getViewport().zoom;
        void flow.setCenter(position.x, position.y, {
          duration: 500,
          zoom: Math.max(zoom, 0.6),
        });
      }}
    />
  );
}


/** Duration scaled to how far the camera must travel — short hops
 *  stay quick, cross-map flights take a long smooth arc. */
function flightDuration(
  flow: ReturnType<typeof useReactFlow>,
  targetX: number,
  targetY: number,
): number {
  const viewport = flow.getViewport();
  const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
  const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
  const screenDistance =
    Math.hypot(targetX - centerX, targetY - centerY) * viewport.zoom;
  return Math.min(1700, Math.max(600, Math.round(screenDistance * 0.6)));
}

/** How long a relayout slide takes. The camera glides for the same
 *  span so both arrive together. */
const TWEEN_MS = 480;
/** Below this share of surviving cards the new layout is a different
 *  scene, not a rearrangement — cut to it instead of sliding a few
 *  stragglers across a canvas of strangers. */
const TWEEN_MIN_SURVIVORS = 0.3;

/**
 * Slide surviving cards from their previous positions to the new
 * layout's. Returns the in-flight positions (by id) while sliding,
 * null at rest. Marks the wrap with data-tweening for the duration so
 * the scene-cut fade stays out of the way and the camera glides.
 */
function useLayoutTween(
  nodes: Node[],
  wrapRef: React.RefObject<HTMLDivElement | null>,
): {
  positions: Map<string, { x: number; y: number }> | null;
  /** Cards that just joined the canvas — rendered transparent for
   *  one frame so their opacity transition fades them in. A class and
   *  a timer, not a CSS animation: a hidden document's animation
   *  clock never advances, and the cards would stay invisible. */
  entering: Set<string> | null;
} {
  const previous = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [override, setOverride] = useState<Map<
    string,
    { x: number; y: number }
  > | null>(null);
  const [entering, setEntering] = useState<Set<string> | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    const after = new Map(
      nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    );
    previous.current = after;
    if (before.size === 0 || nodes.length === 0) return;
    const fresh = new Set(nodes.filter((n) => !before.has(n.id)).map((n) => n.id));
    // Always resettled here: a lens rebuilds the graph twice in quick
    // succession (selection, then fold state), and a stale tag from
    // the first pass would keep cards transparent for good.
    setEntering(fresh.size > 0 ? fresh : null);
    if (fresh.size > 0) window.setTimeout(() => setEntering(null), 30);
    let survivors = 0;
    const movers: Array<{
      id: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
    }> = [];
    for (const n of nodes) {
      const was = before.get(n.id);
      if (!was) continue;
      survivors++;
      if (Math.abs(was.x - n.position.x) > 0.5 || Math.abs(was.y - n.position.y) > 0.5) {
        movers.push({ id: n.id, from: was, to: { ...n.position } });
      }
    }
    // The enter tag's timer is never cancelled by a later rebuild —
    // that rebuild resets the tag state itself, above.
    if (movers.length === 0 || survivors < nodes.length * TWEEN_MIN_SURVIVORS) {
      return;
    }
    const wrap = wrapRef.current;
    wrap?.setAttribute("data-tweening", "1");
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    let frame: number | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (frame !== null) cancelAnimationFrame(frame);
      wrap?.removeAttribute("data-tweening");
      setOverride(null);
    };
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      if (t >= 1) {
        finish();
        return;
      }
      const k = ease(t);
      const at = new Map<string, { x: number; y: number }>();
      for (const m of movers) {
        at.set(m.id, {
          x: m.from.x + (m.to.x - m.from.x) * k,
          y: m.from.y + (m.to.y - m.from.y) * k,
        });
      }
      setOverride(at);
      frame = requestAnimationFrame(tick);
    };
    // First frame before paint: the cards start where they were.
    tick(start);
    // A hidden canvas never gets a frame — land the cards anyway.
    const safety = window.setTimeout(finish, TWEEN_MS + 150);
    return () => {
      window.clearTimeout(safety);
      finish();
    };
  }, [nodes, wrapRef]);
  return { positions: override, entering };
}

/** A selected subtree must remain readable. If its full extent cannot fit
 *  at this scale, focus its selected node and leave the rest available to pan. */
const FRAME_MIN_ZOOM = 0.8;
/** Zoom ceiling for framing: a three-card lineage shouldn't fill
 *  the screen with one giant card. */
const FRAME_MAX_ZOOM = 1.1;
const FRAME_PADDING = 0.12;
function FlyToController({
  target,
  layoutSig,
  nodes,
  frame,
}: {
  target: {
    legalId: string;
    nonce: number;
    immediate?: boolean;
    soft?: boolean;
    readable?: boolean;
  } | null;
  layoutSig: string;
  nodes: Node[];
  /** Node ids to keep in view around the target — the pinned
   *  lineage. Null frames nothing: the camera just centers. */
  frame: Set<string> | null;
}) {
  const flow = useReactFlow();
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const last = useRef(0);
  const chaseUntil = useRef(0);
  const chaseId = useRef<string | null>(null);
  const cutMode = useRef(false);
  const faded = useRef(false);
  const immediate = useRef(false);
  const soft = useRef(false);
  const readable = useRef(false);
  const [armed, setArmed] = useState(0);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  // ONE destination per target. Two ways to arrive:
  //  - the layout stays put (immediate flights, in-scope jumps):
  //    a smooth glide;
  //  - a relayout lands while the chase is armed (walk steps refold
  //    the canvas every time): animating from the stale viewport
  //    reads as two movements — the layout jump, then the pan — so
  //    the camera CUTS to the destination inside the relayout's own
  //    commit and the scene fades in as one change. The second
  //    layout pass re-cuts under the fade, invisibly.
  useEffect(() => {
    if (!target || target.nonce === last.current) return;
    last.current = target.nonce;
    chaseId.current = target.legalId;
    immediate.current = Boolean(target.immediate);
    soft.current = Boolean(target.soft);
    readable.current = Boolean(target.readable);
    cutMode.current = false;
    faded.current = false;
    chaseUntil.current = Date.now() + (target.legalId === "*" ? 10_000 : 8_000);
    // A walk step commits its refolded layout and this chase in the
    // SAME render — the sig effect above has already run and found no
    // armed chase. If the layout just moved, this arrival IS the
    // relayout: cut now instead of waiting out the fallback glide.
    if (Date.now() - lastSigChangeAt.current < 250) cutTo();
    setArmed((tick) => tick + 1);
  }, [target]);
  const lastSigChangeAt = useRef(0);
  /** Move the camera to a viewport. Animated moves run on frames; a
   *  backgrounded or hidden canvas gets none, and the camera would
   *  sit at its start forever. If the viewport hasn't budged by the
   *  time the flight should be over, land it outright. */
  const land = (
    target: { x: number; y: number; zoom: number },
    opts: { duration: number; interpolate?: "smooth" | "linear" },
  ) => {
    const from = flow.getViewport();
    void flow.setViewport(target, opts);
    if (opts.duration <= 0) return;
    window.setTimeout(() => {
      const now = flow.getViewport();
      const stalled =
        Math.abs(now.x - from.x) < 0.5 &&
        Math.abs(now.y - from.y) < 0.5 &&
        Math.abs(now.zoom - from.zoom) < 1e-4;
      const arrived =
        Math.abs(now.x - target.x) < 0.5 &&
        Math.abs(now.y - target.y) < 0.5 &&
        Math.abs(now.zoom - target.zoom) < 1e-4;
      if (stalled && !arrived) void flow.setViewport(target);
    }, opts.duration + 150);
  };
  /** The viewport that puts a layout point at the canvas center. */
  const viewportAt = (cx: number, cy: number, zoom: number) => {
    const canvas = document.querySelector<HTMLElement>(
      ".graph-viewer-root .irg-canvas",
    );
    const cw = canvas?.clientWidth ?? window.innerWidth;
    const ch = canvas?.clientHeight ?? window.innerHeight;
    return { x: cw / 2 - cx * zoom, y: ch / 2 - cy * zoom, zoom };
  };
  /** Fit the whole map from the layout's own geometry. React Flow's
   *  fitView needs every card measured first, and right after a
   *  graph swap (leaving a lens) nothing is — it fits empty bounds
   *  and lands at max zoom on nothing. The layout already knows each
   *  card's box, so the viewport is plain arithmetic. */
  const fitAll = (opts: {
    duration: number;
    interpolate?: "smooth" | "linear";
  }) => {
    const all = nodesRef.current;
    const canvas = document.querySelector<HTMLElement>(
      ".graph-viewer-root .irg-canvas",
    );
    const cw = canvas?.clientWidth ?? 0;
    const ch = canvas?.clientHeight ?? 0;
    if (all.length === 0 || cw === 0 || ch === 0) {
      void flow.fitView({ ...opts, padding: 0.1, minZoom: 0.01 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of all) {
      const w = node.measured?.width ?? node.width ?? 220;
      const h = node.measured?.height ?? node.height ?? 90;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }
    const pad = 0.1;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const zoom = Math.min(
      MAX_GRAPH_ZOOM,
      Math.max(0.01, Math.min(cw / (bw * (1 + 2 * pad)), ch / (bh * (1 + 2 * pad)))),
    );
    land(
      {
        x: (cw - bw * zoom) / 2 - minX * zoom,
        y: (ch - bh * zoom) / 2 - minY * zoom,
        zoom,
      },
      opts,
    );
  };
  const nodeFor = (legalId: string) =>
    nodesRef.current.find(
      (node) =>
        (node.data as IrgNodeData & { legalId?: string }).legalId === legalId,
    ) ?? null;
  const centerOf = (id: string) => {
    const match = nodeFor(id);
    if (!match) return null;
    return {
      x: match.position.x + (match.measured?.width ?? match.width ?? 220) / 2,
      y: match.position.y + (match.measured?.height ?? match.height ?? 90) / 2,
    };
  };
  /** Move the camera to a card. With a pinned lineage around it, fit
   *  the whole chain — the answer to "what does this depend on?" is
   *  the shape, and a card-tight zoom cut it off at the screen edge.
   *  A chain too big to read even at the floor zoom anchors on the
   *  card instead, zoomed out to the floor. */
  const moveTo = (
    legalId: string,
    opts: { duration: number; interpolate?: "smooth" | "linear" },
  ) => {
    const minZoom = readable.current ? FRAME_MIN_ZOOM : 0.06;
    const anchor = nodeFor(legalId);
    if (!anchor) return false;
    const ids = frameRef.current;
    const members =
      ids && ids.size > 1 && ids.has(anchor.id)
        ? nodesRef.current.filter((node) => ids.has(node.id))
        : null;
    // The execution panel docks over the canvas's right edge; the
    // region it covers doesn't count as "in view". Fit into what's
    // left and slide the target left by half the covered width.
    const canvas = document.querySelector<HTMLElement>(
      ".graph-viewer-root .irg-canvas",
    );
    const panel = document.querySelector<HTMLElement>(
      ".graph-viewer-root .exec-panel",
    );
    let covered = 0;
    if (canvas && panel) {
      const cr = canvas.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const overlapsRows = pr.bottom > cr.top && pr.top < cr.bottom;
      if (overlapsRows) {
        covered = Math.max(
          0,
          Math.min(cr.right, pr.right) - Math.max(cr.left, pr.left),
        );
      }
    }
    const shiftFor = (zoom: number) => covered / 2 / zoom;
    if (members) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of members) {
        const w = node.measured?.width ?? node.width ?? 220;
        const h = node.measured?.height ?? node.height ?? 90;
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + w);
        maxY = Math.max(maxY, node.position.y + h);
      }
      const cw = (canvas?.clientWidth ?? 0) - covered;
      const ch = canvas?.clientHeight ?? 0;
      const fitZoom =
        cw > 0 && ch > 0
          ? Math.min(
              cw / ((maxX - minX) * (1 + 2 * FRAME_PADDING)),
              ch / ((maxY - minY) * (1 + 2 * FRAME_PADDING)),
            )
          : 0;
      if (fitZoom >= minZoom) {
        // Center on the chain's box at the zoom that fits it — one
        // setCenter, the same primitive every other flight uses.
        const zoom = Math.min(FRAME_MAX_ZOOM, fitZoom);
        land(
          viewportAt((minX + maxX) / 2 + shiftFor(zoom), (minY + maxY) / 2, zoom),
          opts,
        );
        return true;
      }
      const center = centerOf(legalId)!;
      land(
        viewportAt(center.x + shiftFor(minZoom), center.y, minZoom),
        opts,
      );
      return true;
    }
    const center = centerOf(legalId)!;
    const zoom = Math.min(Math.max(flow.getViewport().zoom, 0.9), 1.2);
    land(viewportAt(center.x + shiftFor(zoom), center.y, zoom), opts);
    return true;
  };
  const cutTo = () => {
    if (!chaseId.current || Date.now() > chaseUntil.current) return;
    // A soft chase glides through the relayout's commit (small unfolds
    // like clicking a question in the flow panel); a hard cut is for
    // scene-scale changes — unless the cards themselves are sliding
    // into the new layout, in which case the camera glides with them.
    const wrapEl = document.querySelector<HTMLElement>(
      ".graph-viewer-root .irg-wrap",
    );
    const sliding = wrapEl?.hasAttribute("data-tweening") ?? false;
    const duration = soft.current ? 500 : sliding ? TWEEN_MS : 0;
    if (chaseId.current === "*") {
      fitAll({ duration });
    } else if (!moveTo(chaseId.current, { duration })) {
      return;
    }
    cutMode.current = true;
    // Keep the chase briefly alive so a second measured layout pass
    // re-cuts to the final geometry, then let it die.
    chaseUntil.current = Date.now() + 700;
    if (!faded.current && !soft.current && !sliding) {
      faded.current = true;
      if (wrapEl) {
        wrapEl.classList.remove("irg-scene-cut");
        void wrapEl.offsetWidth;
        wrapEl.classList.add("irg-scene-cut");
      }
    }
  };
  const layoutSigSeen = useRef(layoutSig);
  useLayoutEffect(() => {
    if (layoutSig === layoutSigSeen.current) return;
    layoutSigSeen.current = layoutSig;
    lastSigChangeAt.current = Date.now();
    if (armed === 0) return;
    cutTo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSig, armed, flow]);
  useEffect(() => {
    if (armed === 0 || !chaseId.current || Date.now() > chaseUntil.current)
      return;
    // The glide only serves the layout-at-rest case; once a relayout
    // has cut, later timers must stay quiet.
    if (cutMode.current) return;
    const delay = immediate.current ? 0 : 1000;
    const timer = window.setTimeout(() => {
      if (cutMode.current || !chaseId.current) return;
      if (chaseId.current === "*") {
        fitAll({ duration: 900, interpolate: "smooth" });
        return;
      }
      const center = centerOf(chaseId.current);
      if (center) {
        moveTo(chaseId.current, {
          duration: flightDuration(flow, center.x, center.y),
          interpolate: "smooth",
        });
        // The destination is reached — later unrelated relayouts must
        // not yank the camera back.
        chaseUntil.current = Date.now() + 900;
      }
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSig, armed, flow]);
  return null;
}

const HandleSource = () => (
  <Handle type="source" position={Position.Right} className="irg-handle" />
);
/** Outputs only receive edges (from the left); no source handle. */
const HandleTarget = () => (
  <Handle type="target" position={Position.Left} className="irg-handle" />
);
/** Intermediate nodes both receive and emit. */
const HandleBoth = () => (
  <>
    <Handle type="target" position={Position.Left} className="irg-handle" />
    <Handle type="source" position={Position.Right} className="irg-handle" />
  </>
);

/**
 * Hover popover that reveals the node's citation, legal ID and a link to
 * read the underlying statute/regulation in the Axiom app.
 *
 * Visibility is driven by React state with a small leave-delay so the
 * user can move their cursor from the node to the popover (and click the
 * link) without the popover snapping shut. The popover is rendered into
 * a portal anchored to document.body — React Flow's container has
 * overflow:hidden for pan/zoom, which would otherwise clip popovers on
 * nodes near the canvas edge.
 */
function useHoverPopover() {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const enter = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(true);
  }, []);
  const leave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpen(false);
      timerRef.current = null;
    }, 220);
  }, []);
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);
  return { open, enter, leave };
}

const POPOVER_WIDTH = 280;
const POPOVER_GAP = 8;

const NodeInfo = ({
  meta,
  title,
  open,
  anchorRef,
  onEnter,
  onLeave,
}: {
  meta: NodeMeta;
  title: string;
  open: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onEnter: () => void;
  onLeave: () => void;
}) => {
  // Position relative to the node element. Re-measured each open and on
  // window scroll/resize so we don't drift if the user pans the canvas.
  const [pos, setPos] = useState<{ left: number; top: number; place: "above" | "below" } | null>(
    null,
  );
  // Portal into the current fullscreen element when one is active —
  // otherwise document.body is hidden and the popover wouldn't render at
  // all. Listening to `fullscreenchange` keeps the target current as the
  // user toggles in/out without re-opening the popover.
  const [portalTarget, setPortalTarget] = useState<HTMLElement>(
    () => (document.fullscreenElement as HTMLElement | null) ?? document.body,
  );
  useEffect(() => {
    const sync = () => {
      setPortalTarget(
        (document.fullscreenElement as HTMLElement | null) ?? document.body,
      );
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      // Default above; flip below if there isn't enough room (so popovers
      // on top-of-viewport nodes don't get clipped offscreen).
      const place: "above" | "below" =
        rect.top > 220 || rect.bottom + 220 > window.innerHeight ? "above" : "below";
      const top = place === "above" ? rect.top - POPOVER_GAP : rect.bottom + POPOVER_GAP;
      // Clamp horizontally so the popover never overflows the viewport.
      const halfW = POPOVER_WIDTH / 2;
      const left = Math.max(halfW + 8, Math.min(window.innerWidth - halfW - 8, centerX));
      setPos({ left, top, place });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, anchorRef]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      className={`irg-popover irg-popover-${pos.place}`}
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="irg-pop-eyebrow">{meta.kindLine}</div>
      <div className="irg-pop-title">{softBreak(humanizeLabel(title))}</div>
      {meta.parameterValue && (
        <div className="irg-pop-value">
          <span>Value</span>
          <strong>{meta.parameterValue}</strong>
        </div>
      )}
      {meta.formulaPreview && (
        <div className="irg-pop-formula">{meta.formulaPreview}</div>
      )}
      {meta.citation &&
        (meta.sourceUrl ? (
          <a
            className="irg-pop-cite irg-pop-cite-link"
            href={meta.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {meta.citation} ↗
          </a>
        ) : (
          <div className="irg-pop-cite">{meta.citation}</div>
        ))}
      {meta.appUrl && (
        <a
          className="irg-pop-link"
          href={meta.appUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open in Axiom app ↗
        </a>
      )}
    </div>,
    portalTarget,
  );
};

/**
 * Insert zero-width spaces after `_` and `.` so the browser breaks
 * snake_case / dotted identifiers at semantic boundaries instead of
 * shearing through the middle of a word. Each token is still selectable
 * and copies cleanly (ZWSPs are stripped by most clipboard targets).
 */
/**
 * Convert a snake_case identifier into a human-readable label —
 * "snap_household_size" → "SNAP Household Size". Used for every label
 * the graph renders so non-engineers don't have to read raw RuleSpec
 * identifiers. The raw legal-id is still available on hover via the
 * info popover.
 */
function humanizeLabel(s: string): string {
  if (!s) return s;
  return humanizeRuleName(s);
}

function softBreak(s: string): string {
  return s.replace(/([_.])/g, "$1​");
}

/**
 * Tiny "ⓘ" badge anchored to the node's top-right corner. Hovering or
 * focusing it opens the popover; the box itself stays clean so the user
 * can drag/click without accidental popovers cluttering every motion.
 */

const OutputNode = ({ data }: NodeProps) => {
  const d = data as Extract<IrgNodeData, { kind: "output" }>;
  const pop = useHoverPopover();
  const ref = useRef<HTMLDivElement>(null);
  const answerPopulated = useAnswerBoxPopulated(d.legalId);
  return (
    <div
      ref={ref}
      className={`irg-node irg-output ${d.showValues ? d.verdictCls : "irg-neutral"}`}
    >
      <HandleBoth />
      <div className="irg-eyebrow">Result</div>
      <div className="irg-label">{softBreak(humanizeLabel(d.label))}</div>
      <InlineAnswer legalId={d.legalId} />
      {!answerPopulated && d.showValues && d.value && (
        <div className="irg-value">{d.value}</div>
      )}
      {d.canExpand && !d.isExpanded && (
        <div
          className="irg-action irg-action-secondary irg-action-clickable"
          data-action="collapse"
        >
          {d.hiddenCount ? `+ expand · ${d.hiddenCount} rules` : "+ expand"}
        </div>
      )}
      <NodeInfo
        meta={d.meta}
        title={d.label}
        open={pop.open}
        anchorRef={ref}
        onEnter={pop.enter}
        onLeave={pop.leave}
      />
    </div>
  );
};

function InlineAnswer({ legalId }: { legalId: string }) {
  const { values, answered, onChange } = useContext(InputEditContext);
  const fragment = legalId.split("#").pop() ?? "";
  if (!onChange || !fragment.startsWith("input.")) return null;
  const name = fragment.slice("input.".length);
  if (!(name in values)) {
    // The runtime cannot ingest this question yet — no field is
    // better than a field the engine silently ignores.
    return null;
  }
  const value = values[name];
  const stop = (event: { stopPropagation: () => void }) =>
    event.stopPropagation();
  return (
    <div
      className={`irg-answer nodrag ${answered.has(name) ? "is-answered" : ""}`}
      onClick={stop}
      onDoubleClick={stop}
    >
      {typeof value === "boolean" ? (
        <input
          type="checkbox"
          checked={value}
          onChange={(event) => onChange(name, event.target.checked)}
          aria-label="Answer"
        />
      ) : (
        <input
          type="number"
          value={
            value === undefined || Number.isNaN(value as number)
              ? ""
              : String(value)
          }
          placeholder="answer…"
          onChange={(event) =>
            onChange(
              name,
              event.target.value === ""
                ? Number.NaN
                : Number(event.target.value),
            )
          }
          aria-label="Answer"
        />
      )}
    </div>
  );
}

/** True when this node renders an answer box that already holds a
 *  value — the card's own value line would just repeat it (and get
 *  clipped), so callers hide it. */
function useAnswerBoxPopulated(legalId: string): boolean {
  const { values, onChange } = useContext(InputEditContext);
  const fragment = legalId.split("#").pop() ?? "";
  if (!onChange || !fragment.startsWith("input.")) return false;
  const name = fragment.slice("input.".length);
  if (!(name in values)) return false;
  const value = values[name];
  // A checkbox always displays its state; a number box counts once typed.
  return typeof value === "boolean" || !Number.isNaN(value as number);
}

/** Inline value editing on Question cards — provided by the app so
 *  the canvas itself is a form: type a number, flip a toggle, run. */
export const InputEditContext = createContext<{
  values: Record<string, number | boolean>;
  answered: Set<string>;
  /** Registry defaults by bare name — an unanswered card names the
   *  value that held for the run. */
  defaults?: Record<string, number | boolean>;
  /** Person-level answers per household member (present only when
   *  the scenario carries extra members): the card shows every
   *  member's value; editing beyond Person 1 lives in the inspector
   *  and the run panel. */
  memberValues?: Record<
    string,
    Array<{ label: string; value: number | boolean | null }>
  >;
  onChange: ((name: string, value: number | boolean) => void) | null;
}>({ values: {}, answered: new Set(), onChange: null });

/** Compact per-member answer line on a question card: "P1 40 · P2 38
 *  · P3 —". Read-only — the inspector edits members. */
function MemberAnswers({ name }: { name: string | null }) {
  const { memberValues } = useContext(InputEditContext);
  const rows = name ? memberValues?.[name] : undefined;
  if (!rows) return null;
  return (
    <div className="irg-members">
      {rows.map((row) => (
        <span key={row.label}>
          {row.label}{" "}
          {row.value === null ||
          (typeof row.value === "number" && Number.isNaN(row.value))
            ? "—"
            : typeof row.value === "boolean"
              ? row.value
                ? "✓"
                : "✗"
              : row.value.toLocaleString("en-US", { maximumFractionDigits: 6 })}
        </span>
      ))}
    </div>
  );
}

const InputNode = ({ data }: NodeProps) => {
  const d = data as Extract<IrgNodeData, { kind: "input" }>;
  const status = d.source === "user" ? "selected" : "not selected";
  const pop = useHoverPopover();
  const ref = useRef<HTMLDivElement>(null);
  const answerPopulated = useAnswerBoxPopulated(d.legalId);
  const { values, answered, defaults, onChange } = useContext(InputEditContext);
  const inputFragment = d.legalId.split("#").pop() ?? "";
  // Package graphs write `#input.<name>`; composed graphs write the
  // bare `#<name>` — both name the same registry slot.
  const inputName = inputFragment.startsWith("input.")
    ? inputFragment.slice("input.".length)
    : inputFragment || null;
  const settable = Boolean(onChange && inputName && inputName in values);
  const isAnswered = Boolean(inputName && answered.has(inputName));
  // Affordance shows when the parent wired up onExposeInput (Step III).
  // Action label flips with the current state — same hook toggles both
  // ways via App.tsx's handleExposeInput.
  const showAction = d.canExpose || d.source === "user";
  return (
    <div
      ref={ref}
      className={`irg-node irg-input irg-input-${d.source} ${d.canExpose ? "irg-can-expose" : ""} ${isAnswered ? "is-answered" : ""}`}
    >
      <HandleSource />
      {/* No eyebrow row on a question — the pill shape already says
          "question", and the state lives in a dot beside the title.
          One line less per card is the tower's biggest saving. */}
      <div className="irg-label irg-q-title">
        <span
          className={`irg-q-dot irg-status-${d.source}`}
          title={
            isAnswered
              ? "Question · answered"
              : d.source === "user"
                ? "Question · asked"
                : "Question · not asked"
          }
        />
        {softBreak(humanizeLabel(d.label))}
      </div>
      <InlineAnswer legalId={d.legalId} />
      <MemberAnswers name={inputName} />
      {!answerPopulated && d.showValues && d.value && (
        <div className="irg-value">{d.value}</div>
      )}
      {/* Honesty on the card: after a run, an unanswered question
          names the default that held — the engine always fills every
          slot, asked or not, so a downstream "No" can trace to a
          default rather than an answer. */}
      {d.showValues && settable && !isAnswered && (
        <div className="irg-default-chip">
          {inputName && defaults && inputName in defaults
            ? `default — ${String(defaults[inputName])}`
            : "using default"}
        </div>
      )}
      {showAction && (
        <div className="irg-action irg-action-clickable">
          {d.source === "user" ? "− remove" : "+ ask the user"}
        </div>
      )}
      <NodeInfo
        meta={d.meta}
        title={d.label}
        open={pop.open}
        anchorRef={ref}
        onEnter={pop.enter}
        onLeave={pop.leave}
      />
    </div>
  );
};

const OperatorNode = ({ data }: NodeProps) => {
  const d = data as Extract<IrgNodeData, { kind: "operator" }>;
  return (
    <div className={`irg-node irg-operator ${d.showValues ? d.verdictCls : "irg-neutral"}`}>
      <HandleBoth />
      <div className="irg-op-label">{d.label}</div>
      {d.showValues && d.value && <div className="irg-value">{d.value}</div>}
    </div>
  );
};

const IfGateNode = ({ data }: NodeProps) => {
  const d = data as Extract<IrgNodeData, { kind: "ifGate" }>;
  return (
    <div className={`irg-node irg-ifgate ${d.showValues ? d.verdictCls : "irg-neutral"}`}>
      <HandleBoth />
      <div className="irg-op-label">IF</div>
      {d.showValues && d.branchLabel && <div className="irg-eyebrow">{d.branchLabel}</div>}
      {d.showValues && d.value && <div className="irg-value">{d.value}</div>}
    </div>
  );
};

const RuleRefNode = ({ data }: NodeProps) => {
  const d = data as Extract<IrgNodeData, { kind: "ruleRef" }>;
  const pop = useHoverPopover();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`irg-node irg-rule ${d.isParameter ? "irg-parameter" : ""} ${d.showValues ? d.verdictCls : "irg-neutral"} ${d.canExpand ? "irg-can-expand" : ""} ${d.isOutput ? "irg-rule-output" : ""}`}
    >
      <HandleBoth />
      <div className="irg-eyebrow">
        {d.isParameter ? "Parameter" : d.isOutput ? "Step · result" : "Step"}
      </div>
      <div className="irg-label">{softBreak(humanizeLabel(d.label))}</div>
      <InlineAnswer legalId={d.legalId} />
      {d.showValues && d.value && <div className="irg-value">{d.value}</div>}
      {d.canExpand && !d.isExpanded && (
        <div
          className="irg-action irg-action-secondary irg-action-clickable"
          data-action="collapse"
        >
          {d.hiddenCount ? `+ expand · ${d.hiddenCount} rules` : "+ expand"}
        </div>
      )}
      <NodeInfo
        meta={d.meta}
        title={d.label}
        open={pop.open}
        anchorRef={ref}
        onEnter={pop.enter}
        onLeave={pop.leave}
      />
    </div>
  );
};

const LiteralNode = ({ data }: NodeProps) => {
  const d = data as Extract<IrgNodeData, { kind: "literal" }>;
  return (
    <div className="irg-node irg-literal">
      <HandleSource />
      {d.label}
    </div>
  );
};

const UnknownNode = ({ data }: NodeProps) => {
  const d = data as Extract<IrgNodeData, { kind: "unknown" }>;
  const pop = useHoverPopover();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={`irg-node irg-unknown ${d.isParameter ? "irg-parameter" : ""}`}>
      <HandleSource />
      <div className="irg-eyebrow">{d.isParameter ? "Parameter" : "Unresolved"}</div>
      <div className="irg-label">{softBreak(humanizeLabel(d.label))}</div>
      {d.meta && (
        <NodeInfo
          meta={d.meta}
          title={d.label}
          open={pop.open}
          anchorRef={ref}
          onEnter={pop.enter}
          onLeave={pop.leave}
        />
      )}
    </div>
  );
};

/** Wires merge like a tree: every forward edge runs level from its
 *  source, joins a rail fixed just left of its TARGET, and turns
 *  once into it. Edges bound for the same target overlap on that
 *  rail — many sources become one trunk entering the card, instead
 *  of a stack of separate brackets. Near-level edges take a single
 *  gentle curve; backward edges fall back to smoothstep. */
const RAIL_OFFSET = 28;
const RAIL_RADIUS = 12;
const RoundedSmoothStep = (props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY, markerEnd, style } = props;
  const dy = targetY - sourceY;
  if (
    targetX - sourceX > RAIL_OFFSET + RAIL_RADIUS + 6 &&
    Math.abs(dy) >= RAIL_RADIUS * 2
  ) {
    const data = props.data as
      | { route?: "target" | "source"; railOffset?: number }
      | undefined;
    const route = data?.route ?? "target";
    const offset = data?.railOffset ?? RAIL_OFFSET;
    const rail = route === "source" ? sourceX + offset : targetX - offset;
    const dir = dy > 0 ? 1 : -1;
    const path =
      `M ${sourceX},${sourceY} ` +
      `L ${rail - RAIL_RADIUS},${sourceY} ` +
      `Q ${rail},${sourceY} ${rail},${sourceY + dir * RAIL_RADIUS} ` +
      `L ${rail},${targetY - dir * RAIL_RADIUS} ` +
      `Q ${rail},${targetY} ${rail + RAIL_RADIUS},${targetY} ` +
      `L ${targetX},${targetY}`;
    return (
      <BaseEdge id={props.id} path={path} markerEnd={markerEnd} style={style} />
    );
  }
  if (targetX - sourceX > RAIL_OFFSET && Math.abs(dy) < RAIL_RADIUS * 2) {
    // Near-level: one gentle S instead of a micro-staircase.
    const midX = (sourceX + targetX) / 2;
    const path =
      `M ${sourceX},${sourceY} C ${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`;
    return (
      <BaseEdge id={props.id} path={path} markerEnd={markerEnd} style={style} />
    );
  }
  return (
    <SmoothStepEdge
      {...props}
      pathOptions={{ borderRadius: RAIL_RADIUS, offset: RAIL_OFFSET }}
    />
  );
};
const EDGE_TYPES = { smoothstep: RoundedSmoothStep };

const NODE_TYPES = {
  output: OutputNode,
  input: InputNode,
  operator: OperatorNode,
  ifGate: IfGateNode,
  ruleRef: RuleRefNode,
  literal: LiteralNode,
  unknown: UnknownNode,
};

function miniMapColor(d: IrgNodeData): string {
  switch (d.kind) {
    case "output": return "#1c1917";
    case "input": return d.source === "user" ? "#166534" : "#b45309";
    case "ruleRef": return "#92400e";
    case "unknown": return d.isParameter ? "#78716c" : "#a8a29e";
    case "ifGate": return "#92400e";
    case "operator": return "#92400e";
    case "literal": return "#e7e5e4";
    default: return "#a8a29e";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Graph construction
// ─────────────────────────────────────────────────────────────────────────

interface BuildResult {
  nodes: Node[];
  edges: Edge[];
}

function buildGraph(
  spec: DashboardSpec,
  traces: Record<string, TraceNode>,
  collapsed: Set<string>,
  exposedInputIds: Set<string> | undefined,
  showValues: boolean,
  detail: "operators" | "wires" = "operators",
  canExposeInputs: boolean = false,
  parameterRules?: ParameterRule[],
  selectedOutputIds?: Set<string>,
  stageAspect?: number,
  sizeHints?: SizeHints,
): BuildResult {
  // Index parameter rules by bare name so the formula walker can resolve
  // identifiers that aren't in the trace (parameters get inlined as
  // constants by the engine and don't appear as trace nodes).
  const parametersByName = new Map<string, ParameterRule>();
  for (const p of parameterRules ?? []) parametersByName.set(p.name, p);
  // Recursively flatten the trace tree into a lookup so we can resolve any
  // sub-rule reference no matter how deep it appears.
  const traceByLegalId = flattenTrace(traces);
  // Build by-name index for the formula parser's identifiers (rule labels +
  // input bare names → trace node).
  const byName = new Map<string, TraceNode>();
  for (const t of traceByLegalId.values()) {
    if (t.dtype === "input") {
      const bare = t.legalId.split("#").pop()?.replace(/^input\./, "");
      if (bare) byName.set(bare, t);
    } else if (t.label) {
      byName.set(t.label, t);
    }
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeIds = new Map<string, string>(); // dedup key → node id
  let counter = 0;
  const nextId = () => `n${counter++}`;

  // Pre-create all OUTPUT nodes for the selected outputs *before* walking
  // any formula. This lets walkAst redirect a sub-rule reference back to
  // its existing OUTPUT node when an intermediate rule has been promoted
  // (otherwise the same legalId ends up rendered twice — once as the
  // dashboard's output, once as a ruleRef inside another output's chain).
  const outputBindings = spec.outputs.filter((b) => traces[b.legalId]);
  const outputNodeIdByLegalId = new Map<string, string>();
  for (const binding of outputBindings) {
    const outputTrace = traces[binding.legalId]!;
    const outputId = `out:${binding.legalId}`;
    const isExpanded = !collapsed.has(binding.legalId);
    const canExpand = Boolean(outputTrace.formula);
    if (!nodeIds.has(outputId)) {
      // The dedup key IS the id: a card keeps its identity across
      // rebuilds, so a re-dissection (entering a lens, unfolding a
      // door) can slide it to its new place instead of remounting it.
      const id = outputId;
      nodeIds.set(outputId, id);
      outputNodeIdByLegalId.set(binding.legalId, id);
      nodes.push({
        id,
        type: "output",
        position: { x: 0, y: 0 },
        data: {
          kind: "output",
          label: binding.label,
          legalId: binding.legalId,
          verdictCls: verdictClass(outputTrace),
          value: showValues ? formatValue(outputTrace.value) : "",
          showValues,
          meta: buildMeta(outputTrace, "Output"),
          canExpand,
          hiddenCount: isExpanded ? 0 : hiddenDescendantCount(outputTrace),
          isExpanded,
        } satisfies IrgNodeData,
      });
    } else {
      outputNodeIdByLegalId.set(binding.legalId, nodeIds.get(outputId)!);
    }
  }

  const walkCtx: WalkCtx = {
    nodes,
    edges,
    nodeIds,
    nextId,
    byName,
    traceByLegalId,
    collapsed,
    exposedInputIds,
    canExposeInputs,
    showValues,
    parametersByName,
    selectedOutputIds,
    outputNodeIdByLegalId,
  };

  for (const binding of outputBindings) {
    const outputTrace = traces[binding.legalId]!;
    const outputId = `out:${binding.legalId}`;
    const outputNodeId = nodeIds.get(outputId)!;
    const isExpanded = !collapsed.has(binding.legalId);
    if (outputTrace.formula && isExpanded) {
      const sourceId = walkExpr(
        outputTrace.formula,
        outputTrace.legalId,
        walkCtx,
      );
      if (sourceId) {
        edges.push({
          id: `e${edges.length}`,
          source: sourceId,
          target: outputNodeId,
          type: "smoothstep",
          animated: false,
          className: "irg-edge-default",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#78716c" },
          style: { strokeWidth: 1.5 },
        });
      }
    }

    if (detail === "wires" && isExpanded) {
      wireTraceChildren(outputTrace, outputNodeId, walkCtx);
    }
  }

  // Stash parametersByName on the walk context — visible to walkAst's
  // ident handler when resolving names that aren't in the trace.
  // (Threaded via closure since WalkCtx is local to this scope.)
  const ctxExtras = { parametersByName };
  void ctxExtras;

  // Wires-only mode: collapse every operator/IF/literal/non-parameter unknown
  // node so the graph shows only inputs, parameters, sub-rules, and outputs
  // connected by direct wires. Each removed node's incoming and outgoing
  // edges are merged.
  if (detail === "wires") {
    const result = collapseOperators(nodes, edges);
    layout(result.nodes, result.edges, stageAspect, sizeHints);
    return result;
  }

  layout(nodes, edges, stageAspect, sizeHints);
  return { nodes, edges };
}

function wireTraceChildren(parent: TraceNode, parentNodeId: string, ctx: WalkCtx): void {
  for (const child of parent.children ?? []) {
    const childNodeId = ensureTraceNode(child, ctx);
    addEdge(ctx, childNodeId, parentNodeId, "");
  }
}

function ensureTraceNode(t: TraceNode, ctx: WalkCtx): string {
  if (t.dtype === "input") {
    const exposed = ctx.exposedInputIds?.has(t.legalId) ?? t.inputSource === "user";
    const dedupKey = `input:${t.legalId}`;
    const label =
      (t.label && t.label.trim()) ||
      t.legalId.split("#").pop()?.replace(/^input\./, "").replace(/^relation\./, "") ||
      "(unnamed)";
    return ensureNode(ctx, dedupKey, {
      type: "input",
      data: {
        kind: "input",
        label,
        legalId: t.legalId,
        source: exposed ? "user" : "default",
        canExpose: !exposed && ctx.canExposeInputs,
        value: ctx.showValues ? formatValue(t.value) : "",
        showValues: ctx.showValues,
        meta: buildMeta(t, "Input"),
      } satisfies IrgNodeData,
    });
  }

  const existingOutputId = ctx.outputNodeIdByLegalId.get(t.legalId);
  if (existingOutputId) return existingOutputId;

  const isParameter = t.ruleKind === "parameter";
  const isExpanded = !ctx.collapsed.has(t.legalId);
  const ruleNodeId = ensureNode(ctx, `rule:${t.legalId}`, {
    type: "ruleRef",
    data: {
      kind: "ruleRef",
      label: t.label || t.legalId.split("#").pop() || "(unnamed)",
      legalId: t.legalId,
      canExpand: Boolean(t.formula) && !isParameter,
      hiddenCount: isExpanded ? 0 : hiddenDescendantCount(t),
      isParameter,
      isOutput: ctx.selectedOutputIds?.has(t.legalId) ?? false,
      verdictCls: verdictClass(t),
      value: ctx.showValues ? formatValue(t.value) : "",
      isExpanded,
      showValues: ctx.showValues,
      meta: buildMeta(t, isParameter ? "Parameter" : "Rule"),
    } satisfies IrgNodeData,
  });

  if (isExpanded && !isParameter) {
    wireTraceChildren(t, ruleNodeId, ctx);
  }

  return ruleNodeId;
}

/**
 * Remove operator/IF/literal/non-parameter unknown boxes and merge their
 * incoming & outgoing edges into direct wires from sources to targets. Edge
 * styling inherited from the outgoing edge so verdict coloring (active branch,
 * failing AND-clause, etc.) survives the collapse.
 */
function collapseOperators(nodes: Node[], edges: Edge[]): BuildResult {
  const passthroughIds = new Set(
    nodes
      .filter((n) => {
        const data = n.data as IrgNodeData;
        return (
          data.kind === "operator" ||
          data.kind === "ifGate" ||
          data.kind === "literal" ||
          (data.kind === "unknown" && !data.isParameter)
        );
      })
      .map((n) => n.id),
  );

  if (passthroughIds.size === 0) return { nodes, edges };

  // Build adjacency: for each node, its incoming and outgoing edges.
  const inByNode = new Map<string, Edge[]>();
  const outByNode = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!inByNode.has(e.target)) inByNode.set(e.target, []);
    inByNode.get(e.target)!.push(e);
    if (!outByNode.has(e.source)) outByNode.set(e.source, []);
    outByNode.get(e.source)!.push(e);
  }

  // For each non-passthrough source, follow its outgoing edges; if a target
  // is a passthrough, recursively follow that passthrough's outgoing edges
  // until we hit a non-passthrough target. Build a new edge from source →
  // that target, inheriting styling from the LAST edge in the chain (the one
  // closest to the surviving target — that's where verdict coloring lives).
  const newEdges: Edge[] = [];
  const seenEdgeKey = new Set<string>();

  function reach(nodeId: string, lastStyledEdge: Edge): Array<{ target: string; styled: Edge }> {
    if (!passthroughIds.has(nodeId)) {
      return [{ target: nodeId, styled: lastStyledEdge }];
    }
    const downstream = outByNode.get(nodeId) ?? [];
    const out: Array<{ target: string; styled: Edge }> = [];
    for (const next of downstream) {
      // The next edge's styling overrides if it has verdict-related class.
      const styled = chooseStyled(lastStyledEdge, next);
      out.push(...reach(next.target, styled));
    }
    return out;
  }

  for (const e of edges) {
    if (passthroughIds.has(e.source)) continue; // covered when its parent is processed
    const reaches = reach(e.target, e);
    for (const r of reaches) {
      const key = `${e.source}->${r.target}`;
      if (seenEdgeKey.has(key)) continue;
      seenEdgeKey.add(key);
      newEdges.push({
        ...r.styled,
        id: `wire-${newEdges.length}`,
        source: e.source,
        target: r.target,
        // Drop labels — they referred to the operator that's now gone.
        label: undefined,
      });
    }
  }

  const survivingNodes = nodes.filter((n) => !passthroughIds.has(n.id));
  return { nodes: survivingNodes, edges: newEdges };
}

/** Pick the more-meaningful of two edges' styling (verdict-coloured wins). */
function chooseStyled(a: Edge, b: Edge): Edge {
  const score = (e: Edge): number => {
    const c = e.className ?? "";
    if (c.includes("pass")) return 3;
    if (c.includes("fail")) return 3;
    if (c.includes("dim")) return 2;
    return 1;
  };
  return score(b) >= score(a) ? b : a;
}

interface WalkCtx {
  nodes: Node[];
  edges: Edge[];
  nodeIds: Map<string, string>;
  nextId: () => string;
  byName: Map<string, TraceNode>;
  traceByLegalId: Map<string, TraceNode>;
  /** Sub-rule legal IDs the user has manually collapsed. Defaults: every rule expanded. */
  collapsed: Set<string>;
  exposedInputIds: Set<string> | undefined;
  /** True when the parent passed an onExposeInput callback (Step III only). */
  canExposeInputs: boolean;
  showValues: boolean;
  /** Parameter rules from the program graph, indexed by bare name. Used
   *  to enrich "unknown" nodes with citation + value when the formula
   *  references a parameter the engine inlined as a constant. */
  parametersByName: Map<string, ParameterRule>;
  /** Rule legal IDs already exposed as dashboard outputs — drives the
   *  result styling on rule nodes. */
  selectedOutputIds: Set<string> | undefined;
  /** legalId → existing OUTPUT node id. When the formula walker resolves
   *  a sub-rule whose legalId is already an output binding, we reuse
   *  the OUTPUT node instead of creating a parallel ruleRef. */
  outputNodeIdByLegalId: Map<string, string>;
}

/**
 * Render a parsed formula expression as nodes/edges, returning the id of
 * the node that this expression's value emerges from.
 *
 * `parentScope` is the legalId of the rule whose formula we're rendering —
 * used to differentiate per-rule operator instances (so two `+` from
 * different rules don't accidentally dedupe).
 */
function walkExpr(formula: string, parentScope: string, ctx: WalkCtx): string | null {
  const ast = parseFormula(formula);
  if (ast.kind === "error") return null;
  return walkAst(ast, parentScope, `${parentScope}::root`, ctx);
}

function walkAst(node: AstNode, parentScope: string, opPath: string, ctx: WalkCtx): string {
  const lookupValue = (name: string): EvalValue => {
    const t = ctx.byName.get(name);
    if (!t) return null;
    return t.value as EvalValue;
  };

  switch (node.kind) {
    case "ident": {
      const t = ctx.byName.get(node.name);
      if (!t) {
        // Name doesn't resolve to a traced rule/input — try parameter
        // lookup so the user gets rich hover info on policy parameters.
        const param = ctx.parametersByName.get(node.name);
        const dedupKey = `unknown:${parentScope}:${node.name}`;
        return ensureNode(ctx, dedupKey, {
          type: "unknown",
          data: {
            kind: "unknown",
            label: node.name,
            isParameter: Boolean(param),
            meta: param ? buildParameterMeta(param) : undefined,
          } satisfies IrgNodeData,
        });
      }
      if (t.dtype === "input") {
        const exposed = ctx.exposedInputIds?.has(t.legalId) ?? t.inputSource === "user";
        const dedupKey = `input:${t.legalId}`;
        // Robust label fallback: t.label → formula token → bare legal-id
        // suffix (after `#input.` or `#relation.`). Guarantees the box is
        // never empty even if the engine omits the label.
        const fallback = t.legalId
          .split("#")
          .pop()
          ?.replace(/^input\./, "")
          .replace(/^relation\./, "") ?? node.name;
        const label = (t.label && t.label.trim()) || node.name || fallback || "(unnamed)";
        // Only advertise "+ expose" when the builder actually wired a
        // handler. Otherwise the affordance lies.
        const canExpose = !exposed && ctx.canExposeInputs;
        return ensureNode(ctx, dedupKey, {
          type: "input",
          data: {
            kind: "input",
            label,
            legalId: t.legalId,
            source: exposed ? "user" : "default",
            canExpose,
            value: ctx.showValues ? formatValue(t.value) : "",
            showValues: ctx.showValues,
            meta: buildMeta(t, "Input"),
          } satisfies IrgNodeData,
        });
      }
      // If this rule was promoted to a dashboard output, the spec.outputs
      // pre-pass already created an OUTPUT node for it. Reuse that node
      // so the same legalId doesn't render as both an output and a
      // ruleRef in the same graph.
      const existingOutputId = ctx.outputNodeIdByLegalId.get(t.legalId);
      if (existingOutputId) return existingOutputId;
      // Sub-rule reference. By default render its formula's AST inline; the
      // rule pill is the "result" node. User can collapse the rule to hide
      // its internals and click again to re-expand.
      const isExpanded = !ctx.collapsed.has(t.legalId);
      const ruleNodeKey = `rule:${t.legalId}`;
      const isParameter = t.ruleKind === "parameter";
      const isOutput = ctx.selectedOutputIds?.has(t.legalId) ?? false;
      const ruleNodeId = ensureNode(ctx, ruleNodeKey, {
        type: "ruleRef",
        data: {
          kind: "ruleRef",
          label: t.label || node.name,
          legalId: t.legalId,
          canExpand: Boolean(t.formula) && !isParameter,
          hiddenCount: isExpanded ? 0 : hiddenDescendantCount(t),
          isParameter,
          isOutput,
          verdictCls: verdictClass(t),
          value: ctx.showValues ? formatValue(t.value) : "",
          isExpanded,
          showValues: ctx.showValues,
          meta: buildMeta(t, isParameter ? "Parameter" : "Rule"),
        } satisfies IrgNodeData,
      });
      if (isExpanded && t.formula && !isParameter) {
        const inlineSource = walkExpr(t.formula, t.legalId, ctx);
        if (inlineSource) {
          // Connect the expanded sub-rule's AST to the rule node so the
          // reader sees its internals flowing in.
          const edgeId = `e${ctx.edges.length}`;
          if (!ctx.edges.find((e) => e.id === edgeId && e.source === inlineSource && e.target === ruleNodeId)) {
            ctx.edges.push({ id: edgeId, source: inlineSource, target: ruleNodeId, type: "smoothstep" });
          }
        }
      }
      return ruleNodeId;
    }

    case "number":
    case "bool": {
      const text = String(node.kind === "number" ? node.value : node.value);
      const dedupKey = `lit:${opPath}:${text}`;
      return ensureNode(ctx, dedupKey, {
        type: "literal",
        data: { kind: "literal", label: text } satisfies IrgNodeData,
      });
    }

    case "logical": {
      const op = node.op;
      const operands = flattenLogical(node, op);
      const operandValues = operands.map((o) => evalAst(o, lookupValue));
      const value = evalAst(node, lookupValue);
      const verdictCls = verdictClassOfBool(value);
      const decisive =
        op === "and"
          ? (v: EvalValue) => v !== null && !toBool(v)
          : (v: EvalValue) => v !== null && toBool(v);
      const myKey = `op:${parentScope}:${opPath}:${op}`;
      const myId = ensureNode(ctx, myKey, {
        type: "operator",
        data: {
          kind: "operator",
          label: op.toUpperCase(),
          verdictCls,
          value: ctx.showValues ? formatValue(value) : "",
          showValues: ctx.showValues,
        } satisfies IrgNodeData,
      });
      operands.forEach((child, i) => {
        const childId = walkAst(child, parentScope, `${opPath}/${op}[${i}]`, ctx);
        const cls =
          ctx.showValues && decisive(operandValues[i] ?? null)
            ? op === "and"
              ? "fail"
              : "pass"
            : "";
        addEdge(ctx, childId, myId, cls);
      });
      return myId;
    }

    case "comparison": {
      const value = evalAst(node, lookupValue);
      const verdictCls = verdictClassOfBool(value);
      const myKey = `op:${parentScope}:${opPath}:${node.op}`;
      const myId = ensureNode(ctx, myKey, {
        type: "operator",
        data: {
          kind: "operator",
          label: node.op,
          verdictCls,
          value: ctx.showValues ? formatValue(value) : "",
          showValues: ctx.showValues,
        } satisfies IrgNodeData,
      });
      const lid = walkAst(node.left, parentScope, `${opPath}/cmp.l`, ctx);
      const rid = walkAst(node.right, parentScope, `${opPath}/cmp.r`, ctx);
      addEdge(ctx, lid, myId, "");
      addEdge(ctx, rid, myId, "");
      return myId;
    }

    case "arith": {
      const value = evalAst(node, lookupValue);
      const operands =
        node.op === "+" || node.op === "*" ? flattenArith(node, node.op) : [node.left, node.right];
      const myKey = `op:${parentScope}:${opPath}:${node.op}`;
      const myId = ensureNode(ctx, myKey, {
        type: "operator",
        data: {
          kind: "operator",
          label: node.op,
          verdictCls: "rg-numeric",
          value: ctx.showValues ? formatValue(value) : "",
          showValues: ctx.showValues,
        } satisfies IrgNodeData,
      });
      operands.forEach((child, i) => {
        const cid = walkAst(child, parentScope, `${opPath}/${node.op}[${i}]`, ctx);
        addEdge(ctx, cid, myId, "");
      });
      return myId;
    }

    case "unary": {
      const value = evalAst(node, lookupValue);
      const label = node.op === "not" ? "NOT" : "−";
      const verdictCls = node.op === "not" ? verdictClassOfBool(value) : "rg-numeric";
      const myKey = `op:${parentScope}:${opPath}:${node.op}`;
      const myId = ensureNode(ctx, myKey, {
        type: "operator",
        data: {
          kind: "operator",
          label,
          verdictCls,
          value: ctx.showValues ? formatValue(value) : "",
          showValues: ctx.showValues,
        } satisfies IrgNodeData,
      });
      const cid = walkAst(node.operand, parentScope, `${opPath}/u`, ctx);
      addEdge(ctx, cid, myId, "");
      return myId;
    }

    case "call": {
      const value = evalAst(node, lookupValue);
      const cls = ["any", "all", "exactly_one"].includes(node.name) ? verdictClassOfBool(value) : "rg-numeric";
      const myKey = `op:${parentScope}:${opPath}:call:${node.name}`;
      const myId = ensureNode(ctx, myKey, {
        type: "operator",
        data: {
          kind: "operator",
          label: node.name,
          verdictCls: cls,
          value: ctx.showValues ? formatValue(value) : "",
          showValues: ctx.showValues,
        } satisfies IrgNodeData,
      });
      node.args.forEach((arg, i) => {
        const cid = walkAst(arg, parentScope, `${opPath}/call[${i}]`, ctx);
        addEdge(ctx, cid, myId, "");
      });
      return myId;
    }

    case "index": {
      const myKey = `op:${parentScope}:${opPath}:index`;
      const myId = ensureNode(ctx, myKey, {
        type: "operator",
        data: {
          kind: "operator",
          label: "table[i]",
          verdictCls: "rg-numeric",
          value: "",
          showValues: ctx.showValues,
        } satisfies IrgNodeData,
      });
      const tid = walkAst(node.target, parentScope, `${opPath}/idx.t`, ctx);
      const iid = walkAst(node.index, parentScope, `${opPath}/idx.i`, ctx);
      addEdge(ctx, tid, myId, "");
      addEdge(ctx, iid, myId, "");
      return myId;
    }

    case "ifElse": {
      const condValue = evalAst(node.cond, lookupValue);
      const value = evalAst(node, lookupValue);
      const condTrue = condValue !== null && toBool(condValue);
      const verdictCls = verdictClassOfBool(value);
      const myKey = `op:${parentScope}:${opPath}:if`;
      const myId = ensureNode(ctx, myKey, {
        type: "ifGate",
        data: {
          kind: "ifGate",
          label: "IF",
          verdictCls,
          branchLabel:
            condValue === null ? "" : condTrue ? "→ then" : "→ else",
          value: ctx.showValues ? formatValue(value) : "",
          showValues: ctx.showValues,
        } satisfies IrgNodeData,
      });
      const cid = walkAst(node.cond, parentScope, `${opPath}/cond`, ctx);
      const tid = walkAst(node.then, parentScope, `${opPath}/then`, ctx);
      const eid = walkAst(node.else_, parentScope, `${opPath}/else`, ctx);
      addEdgeWithLabel(ctx, cid, myId, "test", ctx.showValues ? "" : "");
      addEdgeWithLabel(
        ctx,
        tid,
        myId,
        "if true",
        ctx.showValues
          ? condValue === null
            ? ""
            : condTrue
              ? "pass"
              : "dim"
          : "",
      );
      addEdgeWithLabel(
        ctx,
        eid,
        myId,
        "if false",
        ctx.showValues
          ? condValue === null
            ? ""
            : condTrue
              ? "dim"
              : "pass"
          : "",
      );
      return myId;
    }

    case "error":
      return ensureNode(ctx, `err:${opPath}`, {
        type: "unknown",
        data: { kind: "unknown", label: node.text } satisfies IrgNodeData,
      });
  }
}

function ensureNode(
  ctx: WalkCtx,
  dedupKey: string,
  spec: { type: keyof typeof NODE_TYPES; data: IrgNodeData },
): string {
  if (ctx.nodeIds.has(dedupKey)) return ctx.nodeIds.get(dedupKey)!;
  // Stable across rebuilds — see the output node's comment.
  const id = dedupKey;
  ctx.nodeIds.set(dedupKey, id);
  ctx.nodes.push({
    id,
    type: spec.type,
    position: { x: 0, y: 0 },
    data: spec.data,
  });
  return id;
}

function addEdge(ctx: WalkCtx, source: string, target: string, cls: string) {
  // Dedup edges by (source, target).
  if (ctx.edges.find((e) => e.source === source && e.target === target)) return;
  const id = `e${ctx.edges.length}`;
  ctx.edges.push({
    id,
    source,
    target,
    type: "smoothstep",
    className: edgeClass(cls),
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColorVar(cls), markerUnits: "userSpaceOnUse", width: 12, height: 12 },
    style: { strokeWidth: cls === "pass" || cls === "fail" ? 2 : 1.5 },
  });
}

function addEdgeWithLabel(
  ctx: WalkCtx,
  source: string,
  target: string,
  label: string,
  cls: string,
) {
  if (ctx.edges.find((e) => e.source === source && e.target === target)) return;
  const id = `e${ctx.edges.length}`;
  ctx.edges.push({
    id,
    source,
    target,
    type: "smoothstep",
    label,
    className: edgeClass(cls),
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColorVar(cls), markerUnits: "userSpaceOnUse", width: 12, height: 12 },
    style: { strokeWidth: cls === "pass" || cls === "fail" ? 2 : 1.5 },
    labelStyle: { fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" },
    labelBgStyle: { fill: "var(--color-paper-elevated)", stroke: "var(--color-rule)" },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 8,
  });
}

function edgeClass(cls: string): string {
  if (cls === "pass") return "irg-edge-pass";
  if (cls === "fail") return "irg-edge-fail";
  if (cls === "dim") return "irg-edge-dim";
  return "irg-edge-default";
}

function edgeColorVar(cls: string): string {
  if (cls === "pass") return "#166534";
  if (cls === "fail") return "#991b1b";
  if (cls === "dim") return "#a8a29e";
  return "#78716c";
}

// ─────────────────────────────────────────────────────────────────────────
// Layout (dagre)
// ─────────────────────────────────────────────────────────────────────────

/** What a question card will actually render besides its title, so
 *  the layout reserves room for exactly those rows and no more. Keyed
 *  by the input's bare registry name. */
type SizeHints = {
  /** Inputs whose card carries an inline answer box (run mode). */
  answerable: ReadonlySet<string>;
  /** Inputs the user has answered — no "default" chip on those. */
  answered: ReadonlySet<string>;
  /** Inputs with a per-member answers line. */
  members: ReadonlySet<string>;
};
const NO_HINTS: SizeHints = {
  answerable: new Set(),
  answered: new Set(),
  members: new Set(),
};

/** Bare registry name of an input node: `#input.<name>` in package
 *  graphs, `#<name>` in composed ones. */
function inputNameOf(legalId: string): string | null {
  const fragment = legalId.split("#").pop() ?? "";
  return fragment.startsWith("input.")
    ? fragment.slice("input.".length)
    : fragment || null;
}

/** The canvas's width / height, or the default when it isn't measurable. */
function stageAspectOf(el: HTMLElement | null): number {
  if (!el) return DEFAULT_STAGE_ASPECT;
  const { clientWidth, clientHeight } = el;
  if (clientWidth < 200 || clientHeight < 200) return DEFAULT_STAGE_ASPECT;
  return Math.min(2.6, Math.max(0.8, clientWidth / clientHeight));
}

/** Stage aspect (width / height) when the canvas can't be measured —
 *  a typical laptop viewport. */
const DEFAULT_STAGE_ASPECT = 1.6;

function layout(
  nodes: Node[],
  edges: Edge[],
  stageAspect = DEFAULT_STAGE_ASPECT,
  hints: SizeHints = NO_HINTS,
) {
  const dense = nodes.length > 250;
  const sizes = new Map(nodes.map((n) => [n.id, nodeSize(n, hints)]));
  const run = (ranksep: number, nodesep: number) => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep, ranksep, marginx: 24, marginy: 24 });
    g.setDefaultEdgeLabel(() => ({}));
    // Leaves that feed the same rule go into dagre two at a time as
    // one wide box, so the tower of questions is half as tall; after
    // the layout the box splits into a staggered pair (see pairLeaves).
    const pairs = pairLeaves(nodes, edges, sizes, nodesep);
    const memberOf = new Map<string, LeafPair>();
    for (const pair of pairs) {
      memberOf.set(pair.a, pair);
      memberOf.set(pair.b, pair);
      g.setNode(pair.id, { width: pair.width, height: pair.height });
    }
    for (const n of nodes) {
      if (!memberOf.has(n.id)) g.setNode(n.id, sizes.get(n.id)!);
    }
    const seenEdges = new Set<string>();
    for (const e of edges) {
      const source = memberOf.get(e.source)?.id ?? e.source;
      const target = memberOf.get(e.target)?.id ?? e.target;
      const key = `${source}→${target}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      g.setEdge(source, target);
    }
    dagre.layout(g);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxRank = 0;
    const place = (n: Node, x: number, y: number, w: number, h: number, rank: number) => {
      n.position = { x, y };
      (n as Node).width = w;
      (n as Node).height = h;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + w);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + h);
      maxRank = Math.max(maxRank, rank);
    };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const pair of pairs) {
      const info = g.node(pair.id);
      if (!info) continue;
      const rank = (info as { rank?: number }).rank ?? 0;
      const left = info.x - info.width / 2;
      const top = info.y - info.height / 2;
      const a = byId.get(pair.a)!;
      const b = byId.get(pair.b)!;
      const sa = sizes.get(pair.a)!;
      const sb = sizes.get(pair.b)!;
      place(a, left, top, sa.width, sa.height, rank);
      place(b, left + sa.width + PAIR_GAP, top + pair.pitch / 2, sb.width, sb.height, rank);
    }
    for (const n of nodes) {
      if (memberOf.has(n.id)) continue;
      const info = g.node(n.id);
      if (!info) continue;
      const rank = (info as { rank?: number }).rank ?? 0;
      place(n, info.x - info.width / 2, info.y - info.height / 2, info.width, info.height, rank);
    }
    return { width: maxX - minX, height: maxY - minY, aisles: maxRank };
  };
  // First pass at the tightest comfortable spacing, then widen the
  // aisles toward the stage's shape: a graph that fits by height on
  // a wide screen leaves both wings of the canvas empty while its
  // columns crowd the middle. Spread the columns until the layout's
  // aspect approaches the stage's, within a cap — aisles wider than
  // this read as disconnected columns, not one graph.
  const baseRank = dense ? 120 : 160;
  const baseNode = dense ? 36 : 48;
  const first = run(baseRank, baseNode);
  const maxRank = dense ? 220 : 300;
  if (first.aisles > 0 && first.height > 0) {
    const wanted = stageAspect * first.height;
    if (wanted > first.width) {
      // Each aisle between adjacent ranks gets an equal share of the
      // missing width; dagre's ranksep is exactly that aisle.
      const extraPerAisle = (wanted - first.width) / first.aisles;
      const ranksep = Math.min(maxRank, Math.round(baseRank + extraPerAisle));
      if (ranksep - baseRank >= 12) run(ranksep, baseNode);
    }
  }

  packComponents(nodes, edges);
  chooseEdgeRoutes(nodes, edges);
}

/** Gutter between the two cards of a staggered pair. */
const PAIR_GAP = 44;
/** A rule needs at least this many private leaves before they pair
 *  up — two questions side by side read as a grid only once there
 *  are a few rows of them. */
const PAIR_MIN_GROUP = 4;

type LeafPair = {
  id: string;
  a: string;
  b: string;
  width: number;
  height: number;
  /** Row pitch the stagger is built on: the taller card plus the
   *  layout's node gap. B sits half a pitch below A. */
  pitch: number;
};

/**
 * Pair up leaves (cards with nothing feeding them) that feed the same
 * rule. Each pair becomes one dagre box two cards wide; after layout
 * the left card A sits at the box's top and the right card B half a
 * pitch lower. The stagger is what keeps A's wire clean: it leaves A
 * at mid-height and runs right to the rail, and B's top edge starts
 * below that line — the wire passes through the gap above B, never
 * through a card. Two columns is the limit: a third column would put
 * cards in the way of the outer column's wires.
 */
function pairLeaves(
  nodes: Node[],
  edges: Edge[],
  sizes: Map<string, { width: number; height: number }>,
  nodesep: number,
): LeafPair[] {
  const hasIncoming = new Set(edges.map((e) => e.target));
  const primaryTarget = new Map<string, string>();
  for (const e of edges) {
    if (!primaryTarget.has(e.source)) primaryTarget.set(e.source, e.target);
  }
  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    const kind = (n.data as IrgNodeData).kind;
    if (kind === "operator" || kind === "ifGate" || kind === "literal") continue;
    if (hasIncoming.has(n.id)) continue;
    const target = primaryTarget.get(n.id);
    if (!target) continue;
    const group = groups.get(target);
    if (group) group.push(n);
    else groups.set(target, [n]);
  }
  const pairs: LeafPair[] = [];
  for (const group of groups.values()) {
    if (group.length < PAIR_MIN_GROUP) continue;
    for (let i = 0; i + 1 < group.length; i += 2) {
      const a = group[i]!;
      const b = group[i + 1]!;
      const sa = sizes.get(a.id)!;
      const sb = sizes.get(b.id)!;
      const pitch = Math.max(sa.height, sb.height) + nodesep;
      pairs.push({
        id: `pair:${a.id}:${b.id}`,
        a: a.id,
        b: b.id,
        width: sa.width + PAIR_GAP + sb.width,
        height: Math.max(sa.height, pitch / 2 + sb.height),
        pitch,
      });
    }
  }
  return pairs;
}

/**
 * Decide each forward edge's orientation against the real card
 * rectangles: prefer merging at the target (tree trunks), but when
 * that level run would slice through an unrelated card, exit at the
 * source instead — and if both cross, keep the lesser evil. The
 * edge component reads data.route.
 */
function chooseEdgeRoutes(nodes: Node[], edges: Edge[]) {
  const rects = new Map(
    nodes.map((n) => [
      n.id,
      {
        x: n.position.x,
        y: n.position.y,
        w: n.width ?? 220,
        h: n.height ?? 80,
      },
    ]),
  );
  const crossings = (
    y: number,
    x1: number,
    x2: number,
    skip1: string,
    skip2: string,
  ) => {
    if (x2 <= x1) return 0;
    let count = 0;
    for (const [id, r] of rects) {
      if (id === skip1 || id === skip2) continue;
      if (
        y > r.y &&
        y < r.y + r.h &&
        Math.max(x1, r.x) < Math.min(x2, r.x + r.w)
      ) {
        count++;
      }
    }
    return count;
  };
  // Lane assignment by interval coloring: each trunk's vertical span
  // is known (its node's y to its farthest partner's y), so within a
  // column, overlapping trunks take different rail offsets and can
  // never run collinear. Sources get the same for source-routed
  // exits.
  const laneOf = (forTargets: boolean) => {
    const spans = new Map<string, { lo: number; hi: number }>();
    for (const e of edges) {
      const self = rects.get(forTargets ? e.target : e.source);
      const other = rects.get(forTargets ? e.source : e.target);
      if (!self || !other) continue;
      const selfY = self.y + self.h / 2;
      const otherY = other.y + other.h / 2;
      const id = forTargets ? e.target : e.source;
      const span = spans.get(id) ?? { lo: selfY, hi: selfY };
      span.lo = Math.min(span.lo, otherY);
      span.hi = Math.max(span.hi, otherY);
      spans.set(id, span);
    }
    const byColumn = new Map<number, { id: string; lo: number; hi: number }[]>();
    for (const [id, span] of spans) {
      const r = rects.get(id)!;
      const columnX = Math.round((forTargets ? r.x : r.x + r.w) / 10);
      const bucket = byColumn.get(columnX) ?? [];
      bucket.push({ id, ...span });
      byColumn.set(columnX, bucket);
    }
    // Median horizontal gap between columns decides how far lanes
    // can spread.
    const columnXs = [...byColumn.keys()].sort((a, b) => a - b);
    let gap = 68;
    if (columnXs.length > 1) {
      const gaps = columnXs.slice(1).map((x, i) => (x - columnXs[i]) * 10);
      gaps.sort((a, b) => a - b);
      gap = gaps[Math.floor(gaps.length / 2)] ?? 68;
    }
    const laneStep = Math.max(9, Math.min(16, Math.floor((gap - 40) / 5)));
    const lanes = new Map<string, number>();
    for (const members of byColumn.values()) {
      members.sort((a, b) => a.lo - b.lo);
      const laneEnds: number[] = [];
      for (const m of members) {
        let lane = laneEnds.findIndex((end) => end + 10 < m.lo);
        if (lane === -1) {
          if (laneEnds.length < 5) {
            lane = laneEnds.length;
            laneEnds.push(m.hi);
          } else {
            lane = laneEnds.indexOf(Math.min(...laneEnds));
            laneEnds[lane] = Math.max(laneEnds[lane], m.hi);
          }
        } else {
          laneEnds[lane] = m.hi;
        }
        lanes.set(m.id, 20 + lane * laneStep);
      }
    }
    return lanes;
  };
  const targetLanes = laneOf(true);
  const sourceLanes = laneOf(false);
  for (const e of edges) {
    const source = rects.get(e.source);
    const target = rects.get(e.target);
    if (!source || !target) continue;
    const sx = source.x + source.w;
    const sy = source.y + source.h / 2;
    const tx = target.x;
    const ty = target.y + target.h / 2;
    if (tx - sx <= 46 || Math.abs(ty - sy) < 24) continue;
    const targetOffset = targetLanes.get(e.target) ?? 28;
    const sourceOffset = sourceLanes.get(e.source) ?? 28;
    const crossTarget = crossings(sy, sx, tx - targetOffset, e.source, e.target);
    const crossSource = crossings(ty, sx + sourceOffset, tx, e.source, e.target);
    const route =
      crossTarget === 0
        ? "target"
        : crossSource === 0
          ? "source"
          : crossTarget <= crossSource
            ? "target"
            : "source";
    e.data = {
      ...(e.data ?? {}),
      route,
      railOffset: route === "target" ? targetOffset : sourceOffset,
    };
  }
}

/**
 * Dagre stacks disconnected components along the cross axis, so a
 * many-output selection degenerates into a mile-high needle. Edges
 * never cross components, so re-packing the component bounding boxes
 * into shelf rows aiming at a screen-ish aspect is safe — the atlas
 * becomes a rectangle instead of a strip.
 */
function packComponents(nodes: Node[], edges: Edge[]) {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    parent.set(id, root);
    return root;
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) {
    const a = find(e.source);
    const b = find(e.target);
    if (a !== b) parent.set(a, b);
  }

  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    const root = find(n.id);
    const group = groups.get(root);
    if (group) group.push(n);
    else groups.set(root, [n]);
  }
  if (groups.size < 2) return;

  const GAP = 220;
  const boxes = [...groups.values()].map((members) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of members) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + (n.width ?? 200));
      maxY = Math.max(maxY, n.position.y + (n.height ?? 80));
    }
    return { members, minX, minY, w: maxX - minX, h: maxY - minY };
  });
  boxes.sort((a, b) => b.h - a.h);

  const area = boxes.reduce((sum, b) => sum + (b.w + GAP) * (b.h + GAP), 0);
  const targetWidth = Math.max(
    Math.sqrt(area * 1.7),
    Math.max(...boxes.map((b) => b.w)),
  );

  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const box of boxes) {
    if (x > 0 && x + box.w > targetWidth) {
      x = 0;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    const dx = x - box.minX;
    const dy = y - box.minY;
    for (const n of box.members) {
      n.position = { x: n.position.x + dx, y: n.position.y + dy };
    }
    x += box.w + GAP;
    rowHeight = Math.max(rowHeight, box.h);
  }
}

/**
 * Compute the rendered size of a node so dagre can lay them out without
 * overlap. We let labels wrap rather than truncate, so we estimate how many
 * lines the label will need at the node's max width and grow the height
 * accordingly. The width stays fixed (so columns stay aligned in the LR
 * layout) but tall/wrappy labels push the box vertically.
 */
function nodeSize(n: Node, hints: SizeHints): { width: number; height: number } {
  const data = n.data as IrgNodeData;
  const labelText = "label" in data ? data.label : "";
  switch (data.kind) {
    case "output":
    case "input":
    case "ruleRef":
      return labelledNodeSize(labelText, data, hints);
    case "ifGate":
      return { width: 140, height: 76 };
    case "operator":
      return { width: 110, height: 60 };
    case "literal":
      return { width: 80, height: 40 };
    case "unknown":
      return labelledNodeSize(labelText, data, hints, /* small */ true);
  }
}

/* Heights of the optional rows a card may stack under its title —
   each mirrors the CSS of the element it stands for. */
const ROW_VALUE = 24; // .irg-value: 13px display line + 4px margin (+ rounding)
const ROW_ACTION = 26; // .irg-action: border + 5/2 padding + 8px margin
const ROW_ANSWER = 34; // .irg-answer: 26px number box + 6px margin
const ROW_MEMBERS = 20; // .irg-members: one 10px mono line + 4px margin
const ROW_DEFAULT_CHIP = 26; // .irg-default-chip: pill + 6px margin

/** The rows a card renders below its title, in px — the same
 *  conditions the node components branch on, so a card's box is the
 *  size of what it shows: a bare question is a title in a pill, a
 *  live one grows for its answer box. */
function extraRowsPx(data: IrgNodeData, hints: SizeHints): number {
  let px = 0;
  switch (data.kind) {
    case "input": {
      const name = inputNameOf(data.legalId);
      const answerable = Boolean(name && hints.answerable.has(name));
      const answered = Boolean(name && hints.answered.has(name));
      if (answerable) px += ROW_ANSWER;
      if (name && hints.members.has(name)) px += ROW_MEMBERS;
      if (data.showValues && data.value) px += ROW_VALUE;
      if (data.showValues && answerable && !answered) px += ROW_DEFAULT_CHIP;
      if (data.canExpose || data.source === "user") px += ROW_ACTION;
      return px;
    }
    case "output":
    case "ruleRef": {
      if (data.showValues && data.value) px += ROW_VALUE;
      if (data.canExpand && !data.isExpanded) px += ROW_ACTION;
      return px;
    }
    default:
      return px;
  }
}

/** One width for every titled card. Columns read as columns and the
 *  eye compares cards by height alone — a mix of widths looked like
 *  noise. Wide enough for most titles in two lines and for the
 *  question eyebrow ("Question · not asked") on one. */
const CARD_WIDTH = 240;
/** The label's line height in px — must match `.irg-label`. */
const LABEL_LINE_PX = 17;

/** Size a label-bearing node: pick the card width from its title,
 *  then measure the wrapped title for the height. */
function labelledNodeSize(
  label: string,
  data: IrgNodeData,
  hints: SizeHints,
  small = false,
): { width: number; height: number } {
  // Measure the actual rendered height of the label by inserting it
  // into a hidden offscreen <div> styled identically to .irg-label.
  // Far more reliable than estimating from char counts — the browser
  // handles kerning / sub-pixel rounding / font-loading nuances for
  // free, so dagre's layout matches what's actually drawn.
  // Per-kind horizontal padding must match CSS or the measured wrap
  // points will diverge from the rendered ones. Inputs get extra side
  // padding because their pill shape eats into the corners.
  // Padding plus the borders — the 3px source seam on the left and
  // 1px on the right. Measuring a hair narrower than the paint can
  // only round UP to an extra line, never leave the card short. A
  // question's title also shares its first line with the state dot
  // (8px + 8px gap).
  const horizontalPaddingPx = (data.kind === "input" ? 40 + 16 : 32) + 4;
  const text = label ? softBreak(humanizeLabel(label)) : "";
  const width = CARD_WIDTH;
  const labelBlockHeight = text
    ? measureLabelHeight(text, width - horizontalPaddingPx)
    : LABEL_LINE_PX;

  // Chrome every titled card carries: padding top and bottom, the
  // eyebrow line and its 5px margin (steps and results only — a
  // question has no eyebrow and 10px padding), plus a small buffer
  // since the rows below are estimates. Then only the rows this card
  // will actually render.
  const chrome = small ? 56 : data.kind === "input" ? 32 : 58;
  return {
    width,
    height: chrome + labelBlockHeight + extraRowsPx(data, hints),
  };
}

/**
 * Measure the rendered height of a label by inserting it into a hidden
 * offscreen <div> styled identically to `.irg-label`, then reading
 * getBoundingClientRect(). Singleton element so we don't thrash the DOM.
 */
let measureEl: HTMLDivElement | null = null;
function getMeasureEl(): HTMLDivElement {
  if (measureEl) return measureEl;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "-9999px";
  el.style.fontFamily =
    "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  el.style.fontSize = "11px";
  el.style.fontWeight = "500";
  el.style.lineHeight = `${LABEL_LINE_PX}px`;
  el.style.letterSpacing = "0.02em";
  el.style.whiteSpace = "normal";
  el.style.overflowWrap = "anywhere";
  el.style.wordBreak = "break-word";
  el.style.visibility = "hidden";
  el.style.padding = "0";
  el.style.margin = "0";
  el.style.boxSizing = "border-box";
  document.body.appendChild(el);
  measureEl = el;
  return el;
}

function measureLabelHeight(text: string, widthPx: number): number {
  const el = getMeasureEl();
  el.style.width = `${widthPx}px`;
  el.textContent = text;
  // +1 so sub-pixel rounding never lands a hair short of the browser's
  // actual render. Cost of rounding up is one fewer pixel of empty
  // space; cost of rounding down is a clipped action row.
  return Math.ceil(el.getBoundingClientRect().height) + 1;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the metadata that the hover popover renders. Pulls citation, legal
 * ID and Axiom-app deep-link from the trace node — preferring the
 * homeFile (input-leaves only) over the legal ID's file portion.
 */
/** Hover popover metadata for a parameter rule — citation, value, link. */
function buildParameterMeta(p: ParameterRule): NodeMeta {
  const citation = p.source
    ? humanizeSource(p.source)
    : humanizeCitation(p.fileLegalId);
  const appUrl = p.fileLegalId ? axiomAppUrl(p.fileLegalId) : null;
  const dtypeText = p.dtype ? ` · ${p.dtype}` : "";
  // For simple parameters the formula is the constant value (e.g. "35").
  // Truncate so longer table-shaped parameters don't blow up the popover.
  const valuePreview = p.formula
    ? truncate(p.formula.replace(/\s+/g, " ").trim(), 140)
    : undefined;
  return {
    kindLine: `Parameter${dtypeText}${p.unit ? ` · ${p.unit}` : ""}`,
    citation,
    citationFromSource: Boolean(p.source),
    sourceUrl: p.sourceUrl ?? null,
    legalId: p.legalId,
    appUrl,
    parameterValue: valuePreview,
  };
}

function buildMeta(t: TraceNode, kind: "Output" | "Input" | "Rule" | "Parameter"): NodeMeta {
  const fileLegalId = t.homeFile ?? fileLegalIdOf(t.legalId);
  const citation = t.source
    ? humanizeSource(t.source)
    : fileLegalId
      ? humanizeCitation(fileLegalId)
      : undefined;
  const appUrl = fileLegalId ? axiomAppUrl(fileLegalId) : null;
  const dtypeText = t.dtype && t.dtype !== "input" ? ` · ${t.dtype}` : "";
  // Translate engine vocab into the user's vocab — Input → Question,
  // Rule → Step. Output stays Output since "result" is a layered
  // concept the user already sees as the eyebrow on the node body.
  const friendly =
    kind === "Input"
      ? "Question"
      : kind === "Rule"
        ? "Step"
        : kind === "Parameter"
          ? "Parameter"
          : "Result";
  return {
    kindLine: `${friendly}${dtypeText}`,
    citation,
    // A bare colon-form legal id in `source` (runtime traces stuff the
    // home file there for input leaves) is an address, not a citation.
    citationFromSource:
      Boolean(t.source) && !/^[a-z]{2}(-[a-z0-9]+)?:/.test(t.source ?? ""),
    sourceUrl: t.sourceUrl ?? null,
    legalId: t.legalId,
    appUrl,
    parameterValue:
      kind === "Parameter" && t.formula
        ? truncate(t.formula.replace(/\s+/g, " ").trim(), 140)
        : undefined,
    formula: t.formula ?? undefined,
  };
}

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** How many descendant steps a trace node hides when collapsed. */
function hiddenDescendantCount(node: TraceNode, seen = new Set<string>()): number {
  if (seen.has(node.legalId)) return 0;
  seen.add(node.legalId);
  let count = 0;
  for (const child of node.children ?? []) {
    count += 1 + hiddenDescendantCount(child, seen);
  }
  return count;
}

/** Dissection threshold: beyond this many reachable steps, the graph
 *  opens focused — outputs and their first-level steps only, with
 *  everything deeper behind "+ expand" counts. */
const FOCUS_THRESHOLD = 120;

export function initialCollapse(
  traces: Record<string, TraceNode>,
  dissect: "auto" | "always" = "auto",
): Set<string> {
  const total = flattenTrace(traces).size;
  if (dissect === "auto" && total <= FOCUS_THRESHOLD) return new Set();
  const collapsed = new Set<string>();
  const walk = (node: TraceNode, depth: number, seen: Set<string>) => {
    if (seen.has(node.legalId)) return;
    seen.add(node.legalId);
    // Keep the outputs' immediate structure visible; fold everything
    // below the first level of steps.
    if (depth >= 1 && node.formula && (node.children?.length ?? 0) > 0) {
      collapsed.add(node.legalId);
    }
    for (const child of node.children ?? []) walk(child, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const root of Object.values(traces)) walk(root, 0, seen);
  return collapsed;
}

function flattenTrace(traces: Record<string, TraceNode>): Map<string, TraceNode> {
  const out = new Map<string, TraceNode>();
  function walk(t: TraceNode) {
    if (out.has(t.legalId)) return;
    out.set(t.legalId, t);
    for (const c of t.children ?? []) walk(c);
  }
  for (const t of Object.values(traces)) walk(t);
  return out;
}

function flattenLogical(node: AstNode, op: "and" | "or"): AstNode[] {
  if (node.kind === "logical" && node.op === op) {
    return [...flattenLogical(node.left, op), ...flattenLogical(node.right, op)];
  }
  return [node];
}

function flattenArith(node: AstNode, op: "+" | "*"): AstNode[] {
  if (node.kind === "arith" && node.op === op) {
    return [...flattenArith(node.left, op), ...flattenArith(node.right, op)];
  }
  return [node];
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v === "holds") return "✓ holds";
  if (v === "not_holds") return "✗ does not hold";
  if (v === "undetermined") return "?";
  if (typeof v === "boolean") return v ? "✓ true" : "✗ false";
  if (typeof v === "number") {
    // Wide enough that encoded rates (0.062, 0.00765) survive intact;
    // computed floats with genuine long tails still get trimmed.
    return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  return String(v);
}

function verdictClass(t: TraceNode): string {
  if (t.dtype === "judgment") {
    if (t.value === "holds") return "irg-holds";
    if (t.value === "not_holds") return "irg-fails";
    return "irg-undet";
  }
  return "irg-numeric";
}

function verdictClassOfBool(v: EvalValue): string {
  if (v === null) return "irg-undet";
  return toBool(v) ? "irg-holds" : "irg-fails";
}

// Suppress unused-variable warning in TS when useEffect isn't currently used.
void useEffect;
