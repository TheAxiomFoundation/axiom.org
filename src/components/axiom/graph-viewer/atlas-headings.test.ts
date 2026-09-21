import { afterEach, beforeEach, expect, it, vi } from "vitest";
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("batches source headings, reuses them, and refreshes after expiry", async () => {
 const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const { paths } = JSON.parse(init!.body as string) as { paths: string[] };
  return { ok: true, json: async () => ({ headings: Object.fromEntries(paths.map(path => [path, `Heading ${path}`])) }) };
 });
 vi.stubGlobal("fetch", fetcher);
 const { loadAtlasHeadings, cachedAtlasHeadings } = await import("./atlas-headings");
 const ids = Array.from({length:125}, (_, i) => `us:statutes/26/${i + 1}`);
 expect(cachedAtlasHeadings([ids[0]!])[ids[0]!]).toBeNull();
 const headings = await loadAtlasHeadings(ids, new AbortController().signal);
 expect(headings[ids[0]!]).toBe("Heading us/statute/26/1");
 expect(Object.values(headings).filter(Boolean)).toHaveLength(125);
 expect(fetcher).toHaveBeenCalledTimes(4);
 for (const [,init] of fetcher.mock.calls) expect(JSON.parse(init!.body as string).paths.length).toBeLessThanOrEqual(40);
 expect(cachedAtlasHeadings(ids)).toEqual(headings);
 await loadAtlasHeadings(ids, new AbortController().signal);
 expect(fetcher).toHaveBeenCalledTimes(4);
 await vi.advanceTimersByTimeAsync(300001);
 await loadAtlasHeadings(ids, new AbortController().signal);
 expect(fetcher).toHaveBeenCalledTimes(8);
});
it("retries failed heading requests without replacing missing titles with body text", async () => {
 vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ok:false}).mockResolvedValueOnce({ok:true,json:async()=>({headings:{"us/statute/26/21":null}})}));
 const { loadAtlasHeadings } = await import("./atlas-headings");
 const ids = ["us:statutes/26/21"];
 expect(await loadAtlasHeadings(ids, new AbortController().signal)).toEqual({[ids[0]!]:null});
 expect(await loadAtlasHeadings(ids, new AbortController().signal)).toEqual({[ids[0]!]:null});
 await loadAtlasHeadings(ids, new AbortController().signal);
 expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not request headings after navigation cancels the load", async () => {
 vi.stubGlobal("fetch", vi.fn());
 const { loadAtlasHeadings } = await import("./atlas-headings");
 const controller = new AbortController(); controller.abort();
 expect(await loadAtlasHeadings(["us:statutes/26/21"], controller.signal)).toEqual({"us:statutes/26/21":null});
 expect(fetch).not.toHaveBeenCalled();
});
