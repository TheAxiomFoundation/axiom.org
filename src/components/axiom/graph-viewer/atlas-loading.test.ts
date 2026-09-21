import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProgramGraph } from "./types";

const graph = { rules: [{ legalId: "root#out", ruleDeps: [], inputDeps: ["root#input"], relationDeps: [] }], inputs: [{ legalId: "root#input" }], relations: [], ownOutputs: ["root#out"], terminalOutputs: ["root#out"] } as unknown as ProgramGraph;
const ok = () => ({ ok: true, status: 200, json: async () => ({ data: { graph } }) });
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok())); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const signal = () => new AbortController().signal;

it("reuses complete previews and refreshes expired data while retaining the old shape", async () => {
 const { loadAtlasGraph, cachedAtlasGraph } = await import("./atlas-graph");
 expect(cachedAtlasGraph("root")).toBeUndefined();
 const first = await loadAtlasGraph("root", signal());
 expect(first.n).toBe(2);
 expect(await loadAtlasGraph("root", signal())).toBe(first);
 expect(fetch).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(300001);
 expect(cachedAtlasGraph("root")).toBe(first);
 await loadAtlasGraph("root", signal());
 expect(fetch).toHaveBeenCalledTimes(2);
});
it("serializes requests and observes the minimum spacing", async () => {
 const { loadAtlasGraph } = await import("./atlas-graph");
 await loadAtlasGraph("one", signal());
 const second = loadAtlasGraph("two", signal());
 await vi.advanceTimersByTimeAsync(1999);
 expect(fetch).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);
 expect((await second).n).toBe(2);
 expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([
 { ok: false, status: 503, json: async () => ({}) },
 { ok: true, status: 200, json: async () => ({ data: {} }) },
 { ok: true, status: 200, json: async () => ({ data: { graph, truncated: true } }) },
])("does not cache a failed or incomplete graph", async response => {
 const { loadAtlasGraph, cachedAtlasGraph } = await import("./atlas-graph");
 vi.mocked(fetch).mockResolvedValueOnce(response as Response);
 await expect(loadAtlasGraph("broken", signal())).rejects.toThrow();
 expect(cachedAtlasGraph("broken")).toBeUndefined();
 const retry = loadAtlasGraph("broken", signal());
 await vi.advanceTimersByTimeAsync(2000);
 expect((await retry).n).toBe(2);
});
it("respects the server cooldown and recovers the queue after a rate limit", async () => {
 const { loadAtlasGraph } = await import("./atlas-graph");
 vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ data: { retry_after_seconds: 5 } }) } as Response);
 await expect(loadAtlasGraph("limited", signal())).rejects.toThrow("deferred");
 const retry = loadAtlasGraph("limited", signal());
 await vi.advanceTimersByTimeAsync(4999);
 expect(fetch).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);
 expect((await retry).n).toBe(2);
});
it("cancels queued and cooling-down requests without issuing fetches", async () => {
 const { loadAtlasGraph } = await import("./atlas-graph");
 const aborted = new AbortController(); aborted.abort();
 await expect(loadAtlasGraph("cancelled", aborted.signal)).rejects.toMatchObject({ name: "AbortError" });
 await loadAtlasGraph("first", signal());
 const waiting = new AbortController();
 const task = loadAtlasGraph("waiting", waiting.signal);
 const rejection = expect(task).rejects.toMatchObject({ name: "AbortError" });
 await vi.advanceTimersByTimeAsync(100);
 waiting.abort();
 await rejection;
 await vi.advanceTimersByTimeAsync(2000);
 expect(fetch).toHaveBeenCalledTimes(1);
});
