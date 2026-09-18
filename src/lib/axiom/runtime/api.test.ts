import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isRuntimeApiConfigured,
  listRuntimePackages,
  getProgramGraph,
  runCalculate,
  runCalculateRoot,
  getCertifiedNode,
  getCertifiedSubgraph,
  getCertifiedLedger,
  _resetRuntimeApiCache,
} from "./api";

function okEnvelope(data: unknown) {
  return {
    ok: true,
    json: async () => ({ status: "ok", data }),
  };
}

describe("runtime api client", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    _resetRuntimeApiCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is unconfigured without a key or base override and makes no requests", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "");
    vi.stubEnv("AXIOM_RUNTIME_API_BASE", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(isRuntimeApiConfigured()).toBe(false);
    expect(await listRuntimePackages()).toEqual([]);
    expect(await getProgramGraph("us-co", "co-snap")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a keyless base override (local axiom-api) as configured and omits the auth header", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "");
    vi.stubEnv("AXIOM_RUNTIME_API_BASE", "http://localhost:8787/v1");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okEnvelope({ packages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(isRuntimeApiConfigured()).toBe(true);
    await listRuntimePackages();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8787/v1/runtime/packages");
    expect(init.headers).toBeUndefined();
  });

  it("lists packages, unwrapping the success envelope", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    const packages = [
      {
        program_id: "co-snap",
        jurisdiction: "us-co",
        runtime_id: "r1",
        mode: "compiled",
        status: "ready",
        default_outputs: ["snap_allotment"],
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope({ packages }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listRuntimePackages()).toEqual(packages);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/runtime/packages");
    expect(init.headers["x-api-key"]).toBe("test-key");
  });

  it("respects AXIOM_RUNTIME_API_BASE and encodes path params", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubEnv("AXIOM_RUNTIME_API_BASE", "https://example.test/v1/");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okEnvelope({ graph: { rules: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await getProgramGraph("us-co", "co snap");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.test/v1/runtime/packages/us-co/co%20snap/graph"
    );
  });

  it("returns empty results on HTTP errors", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 })
    );
    expect(await listRuntimePackages()).toEqual([]);
    expect(await getProgramGraph("us", "eitc")).toBeNull();
  });

  it("returns empty results on transport failure or bad envelope", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await listRuntimePackages()).toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "error" }),
      })
    );
    expect(await getProgramGraph("us", "eitc")).toBeNull();
  });

  it("maps a 422 uncertified_node calculate refusal to { uncertified: true }", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          status: "error",
          error: { code: "uncertified_node" },
        }),
      })
    );
    expect(await runCalculate({ program_id: "co-snap" })).toEqual({
      uncertified: true,
    });
  });

  it("keeps other calculate failures as null, including non-refusal 422s", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    expect(await runCalculate({})).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ status: "error", error: { code: "bad_request" } }),
      })
    );
    expect(await runCalculate({})).toBeNull();
  });

  it("passes calculate provenance through on success", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    const provenance = {
      ledger_id: "ledger-1",
      certified_set_version: "v1",
      vintage: {
        encoding_release: "enc-1",
        engine_release: "eng-1",
        corpus_release: "cor-1",
      },
      certificates: [
        {
          variable: "snap_allotment",
          legal_id: "us:statutes/7/2017/a#snap_allotment",
          certificate_id: "cert-1",
          claim: "computed",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okEnvelope({ outputs: { snap_allotment: 298 }, provenance })
      )
    );
    const result = await runCalculate({ program_id: "co-snap" });
    expect(result).toMatchObject({
      outputs: { snap_allotment: 298 },
      provenance,
    });
  });

  it("runs calculate by root and passes the shape straight through", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okEnvelope({ outputs: { net_income: 1200 } }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await runCalculateRoot({
      root: "us:statutes/7/2014/e/6/A",
      facts: { household_size: 2 },
      variables: ["net_income"],
    });
    expect(outcome).toEqual({
      kind: "ok",
      result: { outputs: { net_income: 1200 } },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/calculate");
    expect(JSON.parse(init.body)).toEqual({
      root: "us:statutes/7/2014/e/6/A",
      facts: { household_size: 2 },
      variables: ["net_income"],
    });
  });

  it("routes additional people through household.people and reserves the primary person", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope({ outputs: { count: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    await runCalculateRoot({root: "us:statutes/26/21", facts: {age: 8}, people: {person_2: {age: 30}}, variables: ["count"]});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({root: "us:statutes/26/21", facts: {age: 8}, household: {people: {person_1: {}, person_2: {age: 30}}}, variables: ["count"]});
  });

  it("feature-detects run-by-root: upstream 400/404 map to unsupported", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    for (const status of [400, 404]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: async () => ({
            status: "error",
            error: { code: "invalid_request" },
          }),
        })
      );
      expect(
        await runCalculateRoot({ root: "us:statutes/7/2014", facts: {} })
      ).toEqual({ kind: "unsupported" });
    }
  });

  it("carries a compile_failed refusal's code and message through", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          status: "error",
          error: {
            code: "compile_failed",
            message: "versioned derived formulas are not supported yet",
          },
        }),
      })
    );
    expect(
      await runCalculateRoot({
        root: "us:statutes/42/1396a/a/10",
        facts: {},
      })
    ).toEqual({
      kind: "refused",
      code: "compile_failed",
      message: "versioned derived formulas are not supported yet",
    });
  });

  it("maps root-calculate refusals and failures distinctly", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          status: "error",
          error: { code: "uncertified_node" },
        }),
      })
    );
    expect(
      await runCalculateRoot({ root: "us:statutes/7/2014", facts: {} })
    ).toEqual({ kind: "refused", code: "uncertified_node", message: null });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    expect(
      await runCalculateRoot({ root: "us:statutes/7/2014", facts: {} })
    ).toEqual({ kind: "failed" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(
      await runCalculateRoot({ root: "us:statutes/7/2014", facts: {} })
    ).toEqual({ kind: "failed" });

    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "");
    vi.stubEnv("AXIOM_RUNTIME_API_BASE", "");
    expect(
      await runCalculateRoot({ root: "us:statutes/7/2014", facts: {} })
    ).toEqual({ kind: "failed" });
  });

  it("fetches a certified node, encoding # per segment and keeping slashes", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    const detail = {
      node: { legalId: "us:statutes/7/2017/a#snap_allotment" },
      certificate: { certificate_id: "cert-1", claim: "computed" },
      ledger_id: "ledger-1",
    };
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope(detail));
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await getCertifiedNode("us:statutes/7/2017/a#snap_allotment")
    ).toEqual(detail);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/nodes/us%3Astatutes/7/2017/a%23snap_allotment"
    );
  });

  it("returns null for unknown-or-uncertified nodes (indistinguishable 404)", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 })
    );
    expect(await getCertifiedNode("us:statutes/7/2017/a#nope")).toBeNull();
  });

  it("fetches the certified subgraph for roots and the ledger", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    const subgraph = {
      graph: { rules: [], ownOutputs: [], terminalOutputs: [] },
      truncated: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope(subgraph));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getCertifiedSubgraph(["a#x", "b#y"])).toEqual(subgraph);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/subgraph?roots=a%23x%2Cb%23y"
    );
    // No roots — nothing to close over, no request.
    expect(await getCertifiedSubgraph([])).toBeNull();

    _resetRuntimeApiCache();
    const ledger = {
      ledger_id: "ledger-1",
      certified_set_version: "v1",
      entries: [],
    };
    const ledgerFetch = vi.fn().mockResolvedValue(okEnvelope(ledger));
    vi.stubGlobal("fetch", ledgerFetch);
    expect(await getCertifiedLedger()).toEqual(ledger);
    expect(ledgerFetch.mock.calls[0][0]).toContain("/certified");
  });

  it("resolves the certified fetchers to null on HTTP failure", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    );
    expect(await getCertifiedSubgraph(["a#x"])).toBeNull();
    expect(await getCertifiedLedger()).toBeNull();
  });
});
