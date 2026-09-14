import type { WorkspaceSource } from "./workspace-source";

export function parseArizonaSource(html: string): string | null {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (!body) return null;
  const text = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/p\s*>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\r/g, "").trim();
  return text.length > 100 ? text : null;
}

/** Official Arizona statute fallback; never fetch arbitrary caller URLs. */
export async function arizonaSource(path: string[]): Promise<WorkspaceSource | null> {
  if (path[0] !== "us-az" || path[1] !== "statute") return null;
  const section = path[2]?.match(/^(\d+)-(\d+)$/);
  if (!section) return null;
  const officialUrl = `https://www.azleg.gov/ars/${section[1]}/${section[2].padStart(5, "0")}.htm`;
  try {
    const response = await fetch(officialUrl, { signal: AbortSignal.timeout(10000), redirect: "error", next: { revalidate: 3600 } });
    if (!response.ok) return null;
    const body = parseArizonaSource(await response.text());
    if (!body) return null;
    const citationPath = path.slice(0, 3).join("/");
    return { origin: "official-live", citationPath, heading: body.split("\n")[0], officialUrl, effectiveDate: null, focusAnchor: null, truncated: false, blocks: [{ anchor: "official-source", heading: null, body, citationPath, refs: [] }] };
  } catch { return null; }
}
