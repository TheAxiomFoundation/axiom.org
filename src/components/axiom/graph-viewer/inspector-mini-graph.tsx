"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type MiniGraphNode = {
  id: string;
  label: string;
  kind: "rule" | "question";
  /** Formatted live value — null when nothing has run yet. */
  value: string | null;
  /** "muted" renders the value quietly — e.g. "not selected". */
  valueTone?: "muted";
  hint: string;
  onClick: () => void;
};

/**
 * The inspector's local lens: the selected rule in the middle, what it
 * is built from on the left, what uses it on the right — the same
 * left-to-right flow as the canvas, shrunk to one hop. Wires converge
 * into the center card; when a run is live every card carries its
 * value, so the panel reads as the arithmetic of this one rule.
 * Everything is always fully visible — no internal scrolling.
 */
export function InspectorMiniGraph({
  center,
  deps,
  consumers,
}: {
  center: { label: string; value: string | null };
  deps: MiniGraphNode[];
  consumers: MiniGraphNode[];
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [wires, setWires] = useState<{ d: string; key: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const root = rootRef.current;
    const centerEl = centerRef.current;
    if (!root || !centerEl) return;
    const measure = () => {
      const rootBox = root.getBoundingClientRect();
      const c = centerEl.getBoundingClientRect();
      const cy = c.top - rootBox.top + c.height / 2;
      const cLeft = c.left - rootBox.left;
      const cRight = c.right - rootBox.left;
      const paths: { d: string; key: string }[] = [];
      for (const node of deps) {
        const el = cardRefs.current.get(`dep:${node.id}`);
        if (!el) continue;
        const b = el.getBoundingClientRect();
        const x = b.right - rootBox.left;
        const y = b.top - rootBox.top + b.height / 2;
        const bend = (cLeft - x) / 2;
        paths.push({
          key: `dep:${node.id}`,
          d: `M ${x} ${y} C ${x + bend} ${y}, ${cLeft - bend} ${cy}, ${cLeft} ${cy}`,
        });
      }
      for (const node of consumers) {
        const el = cardRefs.current.get(`use:${node.id}`);
        if (!el) continue;
        const b = el.getBoundingClientRect();
        const x = b.left - rootBox.left;
        const y = b.top - rootBox.top + b.height / 2;
        const bend = (x - cRight) / 2;
        paths.push({
          key: `use:${node.id}`,
          d: `M ${cRight} ${cy} C ${cRight + bend} ${cy}, ${x - bend} ${y}, ${x} ${y}`,
        });
      }
      setSize({ w: rootBox.width, h: rootBox.height });
      setWires(paths);
    };
    measure();
    // Coalesce observer bursts to one measure per frame: measure()'s
    // setState resizes the observed elements, which re-fires the
    // observer — unthrottled, that loop outruns the paint deadline and
    // the browser reports "ResizeObserver loop completed with
    // undelivered notifications" on every inspector open.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(root);
    observer.observe(centerEl);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [deps, consumers, center.label, center.value]);

  const card = (node: MiniGraphNode, side: "dep" | "use") => (
    <button
      type="button"
      key={node.id}
      ref={(el) => {
        if (el) cardRefs.current.set(`${side}:${node.id}`, el);
        else cardRefs.current.delete(`${side}:${node.id}`);
      }}
      className={`mini-graph-card ${node.kind === "question" ? "is-question" : ""}`}
      title={node.hint}
      onClick={node.onClick}
    >
      <span className="mini-graph-name">{node.label}</span>
      {node.value !== null && (
        <span
          className={`mini-graph-chip ${node.valueTone === "muted" ? "is-muted" : ""}`}
        >
          {node.value}
        </span>
      )}
    </button>
  );

  return (
    <div className="mini-graph" data-tour="mini-graph" ref={rootRef}>
      <svg
        className="mini-graph-wires"
        width={size.w}
        height={size.h}
        aria-hidden="true"
      >
        {wires.map((wire) => (
          <path key={wire.key} d={wire.d} />
        ))}
      </svg>
      <div className="mini-graph-col mini-graph-deps">
        <p className="mini-graph-label">Built from</p>
        {deps.map((node) => card(node, "dep"))}
        {deps.length === 0 && (
          <span className="mini-graph-empty">nothing — a leaf</span>
        )}
      </div>
      <div className="mini-graph-mid">
        <div className="mini-graph-card is-center" ref={centerRef}>
          <span className="mini-graph-name">{center.label}</span>
          {center.value !== null && (
            <span className="mini-graph-chip">{center.value}</span>
          )}
        </div>
      </div>
      <div className="mini-graph-col mini-graph-consumers">
        <p className="mini-graph-label">Used by</p>
        {consumers.map((node) => card(node, "use"))}
        {consumers.length === 0 && (
          <span className="mini-graph-empty">nothing — a final result</span>
        )}
      </div>
    </div>
  );
}
