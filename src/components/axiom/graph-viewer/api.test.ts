import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  MIRROR_UNAVAILABLE_MESSAGE,
  UNAVAILABLE_MESSAGE,
  fetchAllPrograms,
  fetchComposedGraph,
  fetchProgramGraph,
  fetchRootCatalog,
  fetchRootInputs,
  toLoadFailure,
} from "./api";

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
    [422, "relationships_unsupported", "relates people to units"],
  ])("explains HTTP %s %s without a server message", async (status, code, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code } }, { status: Number(status) })));
    await expect(fetchRootInputs("us:policies/example")).rejects.toThrow(String(message));
  });
  it("does not turn malformed success into an empty ready catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: {} })));
    await expect(fetchRootInputs("us:statutes/tt/1")).rejects.toThrow("incomplete input catalog");
  });
  it("explains a non-JSON outage as unavailable, without the body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Service unavailable", { status: 503 })));
    const error = await fetchRootInputs("us:statutes/tt/1").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "ApiRequestError", kind: "unavailable", status: 503, message: UNAVAILABLE_MESSAGE });
  });
  it("maps a timeout of the catalog request to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    await expect(fetchRootInputs("us:statutes/tt/1")).rejects.toMatchObject({ kind: "unavailable", code: "timeout", status: null });
  });
});

describe("root relation catalog", () => {
  const relation = { legalId: "us:statutes/26/32#qualifying_child_of_tax_unit", relationId: "us:statutes/26/32#relation.qualifying_child_of_tax_unit", fileLegalId: "us:statutes/26/32", name: "qualifying_child_of_tax_unit", arity: 2, arguments: ["TaxUnit", "Person"], supported: true, personSlot: 1, unitEntity: "TaxUnit" };
  it("reads the closure's relations and whether roles must be stated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { inputs: [], relations: [relation], relation_membership: "explicit" } })));
    await expect(fetchRootCatalog("us:statutes/26/32")).resolves.toEqual({ inputs: [], relations: [relation], relationMembership: "explicit" });
  });
  it("treats an older proxy payload as the membership convention with no relations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { inputs: [] } })));
    await expect(fetchRootCatalog("us:statutes/26/21")).resolves.toEqual({ inputs: [], relations: [], relationMembership: "convention" });
  });
  it("refuses an explicit catalog that names no relations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { inputs: [], relation_membership: "explicit" } })));
    await expect(fetchRootCatalog("us:statutes/26/32")).rejects.toThrow("incomplete relationship catalog");
  });
});

describe("failed requests are typed, and never carry the response body", () => {
  // The 2026-11-19 response, as the visitor saw it printed on the page.
  const internalError = {
    status: "error",
    error: { code: "internal_error", message: "An unexpected error occurred." },
    meta: { request_id: "req-123", api_version: "v1" },
  };
  const compose = () => fetchComposedGraph("us:statutes/26/21");

  it.each([
    ["HTTP 500 internal_error", () => Response.json(internalError, { status: 500 }), UNAVAILABLE_MESSAGE, 500, "internal_error"],
    ["HTTP 503 mirror_unavailable", () => Response.json({ ...internalError, error: { code: "mirror_unavailable", message: "x" } }, { status: 503 }), MIRROR_UNAVAILABLE_MESSAGE, 503, "mirror_unavailable"],
    ["HTTP 502 from the proxy", () => Response.json({ status: "error", error: { code: "upstream_unreachable" } }, { status: 502 }), UNAVAILABLE_MESSAGE, 502, "upstream_unreachable"],
    ["HTTP 429", () => Response.json({ error: { code: "rate_limited" } }, { status: 429 }), UNAVAILABLE_MESSAGE, 429, "rate_limited"],
    ["an HTML error page", () => new Response("<html>522</html>", { status: 522 }), UNAVAILABLE_MESSAGE, 522, null],
  ])("compose: %s is unavailable", async (_label, respond, message, status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond()));
    const error = await compose().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ kind: "unavailable", message, status, code });
    expect((error as Error).message).not.toMatch(/[{}<>]|internal_error|request_id/);
  });

  it.each([
    ["a network failure", new TypeError("Failed to fetch"), "network_error"],
    ["a timeout", new DOMException("timed out", "TimeoutError"), "timeout"],
  ])("compose: %s is unavailable", async (_label, thrown, code) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(thrown));
    await expect(compose()).rejects.toMatchObject({ kind: "unavailable", status: null, code, message: UNAVAILABLE_MESSAGE });
  });

  it("compose: 404 stays not found, with its own sentence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "not_found" } }, { status: 404 })));
    await expect(compose()).rejects.toMatchObject({
      kind: "not_found",
      message: "This encoding is not available in the graph viewer yet.",
    });
  });

  it("compose: a refused request is a client error, not an outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "invalid_focus" } }, { status: 400 })));
    await expect(compose()).rejects.toMatchObject({ kind: "client", status: 400, code: "invalid_focus" });
  });

  it("the program list and a program graph map the same way", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(internalError, { status: 500 })));
    await expect(fetchAllPrograms()).rejects.toMatchObject({ kind: "unavailable", message: UNAVAILABLE_MESSAGE });
    await expect(fetchProgramGraph({ jurisdiction: "us-co", programId: "co-snap" })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("keeps the status, code and request id in one reference line", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(internalError, { status: 500 })));
    const failure = toLoadFailure(await compose().catch((caught: unknown) => caught));
    expect(failure).toEqual({
      kind: "unavailable",
      message: UNAVAILABLE_MESSAGE,
      reference: "HTTP 500 · internal_error · request req-123",
    });
  });

  it("gives any other error a plain sentence and no reference", () => {
    expect(toLoadFailure(new Error("compose response missing data.graph"))).toEqual({
      kind: "unknown",
      message: "This could not be shown. Please try again.",
      reference: null,
    });
  });
});
