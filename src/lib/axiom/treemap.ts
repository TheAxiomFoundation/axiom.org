/** A rectangle in the treemap's own units. */
export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap (Bruls, Huizing and van Wijk, 2000): lays items into a
 * rectangle with areas in proportion to their weights, largest first, and
 * keeps each cell as close to square as the row allows. Items keep their
 * identity; their order is by weight, largest first.
 */
export function squarify<T>(items: Array<{ weight: number; item: T }>, bounds: TreemapRect): Array<TreemapRect & { item: T }> {
  const total = items.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
  if (!total || bounds.w <= 0 || bounds.h <= 0) return [];
  const scale = (bounds.w * bounds.h) / total;
  const queue = items
    .filter((i) => i.weight > 0)
    .map((i) => ({ area: i.weight * scale, item: i.item }))
    .sort((a, b) => b.area - a.area);
  const out: Array<TreemapRect & { item: T }> = [];
  let rect = { ...bounds };
  let row: typeof queue = [];

  // The worst aspect ratio of a row laid along a side of this length.
  const worst = (cells: typeof queue, side: number) => {
    const sum = cells.reduce((s, c) => s + c.area, 0);
    const max = Math.max(...cells.map((c) => c.area));
    const min = Math.min(...cells.map((c) => c.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const place = (cells: typeof queue) => {
    const sum = cells.reduce((s, c) => s + c.area, 0);
    if (rect.w >= rect.h) {
      // A column along the left edge.
      const width = sum / rect.h;
      let y = rect.y;
      for (const c of cells) {
        const h = c.area / width;
        out.push({ x: rect.x, y, w: width, h, item: c.item });
        y += h;
      }
      rect = { x: rect.x + width, y: rect.y, w: rect.w - width, h: rect.h };
    } else {
      // A row along the top edge.
      const height = sum / rect.w;
      let x = rect.x;
      for (const c of cells) {
        const w = c.area / height;
        out.push({ x, y: rect.y, w, h: height, item: c.item });
        x += w;
      }
      rect = { x: rect.x, y: rect.y + height, w: rect.w, h: rect.h - height };
    }
  };

  for (const cell of queue) {
    const side = Math.min(rect.w, rect.h);
    if (row.length === 0 || worst([...row, cell], side) <= worst(row, side)) {
      row.push(cell);
    } else {
      place(row);
      row = [cell];
    }
  }
  if (row.length) place(row);
  return out;
}
