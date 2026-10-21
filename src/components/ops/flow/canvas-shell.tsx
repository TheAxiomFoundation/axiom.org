"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import styles from "./flow.module.css";

/**
 * One zoom level's graph on the floor: pan, zoom, keyboard focus, and a
 * click on a node that names an `href` opens the next level. Every level
 * lays its nodes out itself (positions are data), so nothing is dragged.
 */
export function CanvasShell({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  legend,
  label,
  minimap = false,
  fitIds,
  empty,
}: {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  edgeTypes?: EdgeTypes;
  legend?: ReactNode;
  /** What the graph shows, for screen readers. */
  label: string;
  minimap?: boolean;
  /** Open on these nodes (the first rows of a tall graph); zoom out for the rest. */
  fitIds?: string[];
  /** Shown instead of the graph when it has no nodes. */
  empty?: ReactNode;
}) {
  const router = useRouter();
  // React Flow measures the DOM; render it after mount so the server's HTML
  // (the empty frame) and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const href = (node.data as { href?: string } | undefined)?.href;
      if (href) router.push(href, { scroll: false });
    },
    [router]
  );

  if (!nodes.length) {
    return <div className={styles.canvas}>{empty ?? <div className={styles.empty}><p>Nothing to show for this choice.</p></div>}</div>;
  }

  return (
    <div className={styles.canvas} role="region" aria-label={label}>
      {legend ? <div className={styles.legend}>{legend}</div> : null}
      {mounted ? (
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={onNodeClick}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onlyRenderVisibleElements={nodes.length > 300}
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1.1, nodes: fitIds?.length ? fitIds.map((id) => ({ id })) : undefined }}
            minZoom={0.15}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2a2622" />
            <Controls showInteractive={false} position="bottom-right" />
            {minimap ? <MiniMap pannable zoomable position="top-right" maskColor="rgba(18,17,15,0.7)" nodeColor="#8f877d" nodeStrokeColor="#c9c3bb" /> : null}
          </ReactFlow>
        </ReactFlowProvider>
      ) : null}
    </div>
  );
}
