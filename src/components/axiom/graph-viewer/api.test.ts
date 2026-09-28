import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRootInputs } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("root input readiness", () => {
  it("reads inputs without executing a household", async () => {
    const inputs = [{ name: "income", dtype: "decimal", default: 0, entity: "Household" }];
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { inputs } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchRootInputs("us:statutes/26/21")).resolves.toEqual(inputs);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/axiom/runtime/root-inputs?root=us%3Astatutes%2F26%2F21",
      { cache: "no-store", signal: expect.any(AbortSignal) },
    );
  });
  it("accepts a valid root with no external inputs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { inputs: [] } })));
    await expect(fetchRootInputs("us:statutes/tt/1")).resolves.toEqual([]);
  });
  it("preserves the compiler's refusal reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { error: { code: "compile_failed", message: "An imported source cannot compile." } }, { status: 422 },
    )));
    await expect(fetchRootInputs("us:statutes/42/402/a")).rejects.toThrow("An imported source cannot compile.");
  });
  it.each([
    [400, "invalid_root", "source identifier"],
    [404, "root_not_found", "serving catalog"],
    [422, "composition_root", "assembles a program"],
    [422, "composition_in_closure", "depends on a program"],
  ])("explains HTTP %s %s without a server message", async (status, code, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code } }, { status: Number(status) })));
    await expect(fetchRootInputs("us:policies/example")).rejects.toThrow(String(message));
  });
  it("does not turn malformed success into an empty ready catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: {} })));
    await expect(fetchRootInputs("us:statutes/tt/1")).rejects.toThrow("incomplete input catalog");
  });
  it("explains a non-JSON outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Service unavailable", { status: 503 })));
    await expect(fetchRootInputs("us:statutes/tt/1")).rejects.toThrow("Try again later");
  });
});
