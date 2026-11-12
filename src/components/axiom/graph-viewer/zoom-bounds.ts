export const MAX_GRAPH_ZOOM = 1.25;
/** The lowest zoom at which a card's label is still readable. A focus
 *  frame never lands below it: a lineage too large to fit at this zoom
 *  centres on the focused card instead, and the rest is a pan away. */
export const READABLE_GRAPH_ZOOM = 0.7;
/** A focus frame never magnifies past reading size. */
export const FOCUS_MAX_ZOOM = 1;
type Box = { position: { x: number; y: number }; width?: number; height?: number };
export function graphFitViewport(nodes: Box[], width: number, height: number) {
  if (!nodes.length || width <= 0 || height <= 0) return null;
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => node.position.x + (node.width ?? 220)));
  const bottom = Math.max(...nodes.map((node) => node.position.y + (node.height ?? 90)));
  const zoom = Math.min(MAX_GRAPH_ZOOM, width / (Math.max(1, right - left) * 1.2), height / (Math.max(1, bottom - top) * 1.2));
  return { x: width / 2 - (left + right) / 2 * zoom, y: height / 2 - (top + bottom) / 2 * zoom, zoom };
}

/** Frame a focused card with its lineage at a readable zoom: the whole
 *  lineage when it fits at `minZoom` or closer; otherwise the anchor and
 *  as many of its nearest lineage cards as still fit at `minZoom`, so the
 *  first view shows the card and what feeds it, not empty canvas. */
export function readableFocusViewport(nodes: Box[], anchor: Box | undefined, width: number, height: number, minZoom = READABLE_GRAPH_ZOOM, maxZoom = FOCUS_MAX_ZOOM) {
  const framed = readableFrame(nodes, anchor, width, height, minZoom);
  if (!framed || framed.zoom <= maxZoom) return framed;
  // A small lineage frames at reading size, not magnified: keep the
  // centre, cap the zoom.
  const cx = (width / 2 - framed.x) / framed.zoom;
  const cy = (height / 2 - framed.y) / framed.zoom;
  return { x: width / 2 - cx * maxZoom, y: height / 2 - cy * maxZoom, zoom: maxZoom };
}

function readableFrame(nodes: Box[], anchor: Box | undefined, width: number, height: number, minZoom: number) {
  const fit = graphFitViewport(nodes, width, height);
  if (!fit || fit.zoom >= minZoom || !anchor) return fit;
  const centre = (box: Box) => ({ x: box.position.x + (box.width ?? 220) / 2, y: box.position.y + (box.height ?? 90) / 2 });
  const a = centre(anchor);
  const nearest = nodes.filter((node) => node !== anchor)
    .map((node) => ({ node, d: Math.hypot(centre(node).x - a.x, centre(node).y - a.y) }))
    .sort((p, q) => p.d - q.d);
  const framed: Box[] = [anchor];
  for (const { node } of nearest) {
    const trial = graphFitViewport([...framed, node], width, height);
    if (!trial || trial.zoom < minZoom) continue;
    framed.push(node);
  }
  return graphFitViewport(framed, width, height);
}
