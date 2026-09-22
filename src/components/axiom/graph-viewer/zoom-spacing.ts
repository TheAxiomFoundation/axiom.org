export type Spacing = { scale: number; x: number; y: number };

/** Stable bands relative to the full-graph view, so large graphs respond
 *  before reaching the absolute zoom levels of a small graph. */
export function spacingForZoom(zoom: number, current: number, overviewZoom?: number): number {
  if (overviewZoom && overviewZoom > 0) {
    const magnification = zoom / overviewZoom;
    if (current === 1.35 && magnification < 1.9) return 1.35;
    if (current === 1 && magnification > 3) return 1;
    if (magnification < 1.6) return 1.35;
    if (magnification > 3.6) return 1;
    return 1.15;
  }
  if (current === 1.35 && zoom < .48) return 1.35;
  if (current === 1 && zoom > .72) return 1;
  if (zoom < .36) return 1.35;
  if (zoom > .88) return 1;
  return 1.15;
}

/** Change box-center spacing while the point under the viewport center stays put. */
export function anchorSpacing(current: Spacing, scale: number, anchor: { x: number; y: number }): Spacing {
  if (scale === current.scale) return current;
  return { scale, x: anchor.x - (anchor.x - current.x) * scale / current.scale, y: anchor.y - (anchor.y - current.y) * scale / current.scale };
}
