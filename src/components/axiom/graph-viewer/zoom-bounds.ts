export const MAX_GRAPH_ZOOM = 1.25;
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
