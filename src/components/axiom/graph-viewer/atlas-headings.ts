import { axiomAppUrl } from "./citations";
const cache = new Map<string, { heading: string | null; expires: number }>();
export async function loadAtlasHeadings(ids: string[], signal: AbortSignal): Promise<Record<string, string | null>> {
  const paths = new Map(ids.map(id => [id, axiomAppUrl(id)?.replace(/^\//, "") ?? null]));
  const missing = [...new Set([...paths.values()].filter((path): path is string => !!path && (!cache.has(path) || cache.get(path)!.expires < Date.now())))];
  // Bound concurrency and request size; only fetch metadata for the current source.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, Math.ceil(missing.length / 40)) }, async () => {
    while (cursor < missing.length && !signal.aborted) {
      const batch = missing.slice(cursor, cursor += 40);
      const response = await fetch("/api/axiom/source-headings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: batch }), signal });
      if (!response.ok) continue;
      const data = await response.json() as { headings: Record<string, string | null> };
      for (const path of batch) if (Object.hasOwn(data.headings, path)) cache.set(path, { heading: data.headings[path] ?? null, expires: Date.now() + 300000 });
    }
  }));
  return Object.fromEntries([...paths].map(([id, path]) => [id, path ? cache.get(path)?.heading ?? null : null]));
}

export function cachedAtlasHeadings(ids: string[]): Record<string,string | null> {
  return Object.fromEntries(ids.map(id => { const path = axiomAppUrl(id)?.replace(/^\//, ""); return [id, path ? cache.get(path)?.heading ?? null : null]; }));
}
