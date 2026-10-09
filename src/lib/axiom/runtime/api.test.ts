import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isRuntimeApiConfigured,
  listRuntimePackages,
  listParityCases,
  getProgramGraph,
  runCalculate,
  runCalculateRoot,
  getCertifiedNode,
  getCertifiedSubgraph,
  getCertifiedLedger,
  runtimeProxyGet,
  upstreamUrl,
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
      allocatedInstances: null,
      result: { outputs: { net_income: 1200 } },
      relationMembership: "convention",
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

  it("sends explicit membership as household.relations and confirms it only from a complete echo", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    const QC = "us:statutes/26/32#relation.qualifying_child_of_tax_unit";
    const OTHER = "us:statutes/26/63/c/5#relation.exemption_individual_of_another_tax_unit";
    const relations = [
      { name: QC, tuples: [["household:1", "person:1:2"]] },
      { name: OTHER, tuples: [] },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okEnvelope({ outputs: { eitc: 3400 }, explicit_relations: [QC, OTHER] }))
      .mockResolvedValueOnce(okEnvelope({ outputs: { eitc: 3400 }, explicit_relations: [QC] }))
      .mockResolvedValueOnce(okEnvelope({ outputs: { eitc: 3400 } }));
    vi.stubGlobal("fetch", fetchMock);
    const confirmed = await runCalculateRoot({ root: "us:statutes/26/32", facts: {}, people: { person_2: { age: 8 } }, variables: ["eitc"], relations });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      root: "us:statutes/26/32", facts: {}, variables: ["eitc"],
      household: { people: { person_1: {}, person_2: { age: 8 } }, relations },
    });
    expect(confirmed).toMatchObject({ kind: "ok", relationMembership: "explicit" });
    // An echo that misses a relation we sent did not apply it.
    const partial = await runCalculateRoot({ root: "us:statutes/26/32", facts: {}, variables: ["eitc"], relations });
    expect(partial).toMatchObject({ kind: "ok", relationMembership: "convention" });
    // A single filer still travels as person_1; a runtime without the echo
    // predates explicit membership.
    const ignored = await runCalculateRoot({ root: "us:statutes/26/32", facts: {}, variables: ["eitc"], relations });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).household).toEqual({ people: { person_1: {} }, relations });
    expect(ignored).toMatchObject({ kind: "ok", relationMembership: "convention" });
  });

  it("presents a refused household (400 invalid_household) instead of hiding the run", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status: "error", error: { code: "invalid_household", message: "household.relations[0]: a tuple does not fit" } }),
    }));
    const outcome = await runCalculateRoot({ root: "us:statutes/26/32", facts: {}, variables: ["eitc"], relations: [{ name: "x", tuples: [] }] });
    expect(outcome).toEqual({ kind: "refused", code: "invalid_household", message: "household.relations[0]: a tuple does not fit" });
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

  it("never lets a request-built path resolve outside itself or into admin", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubEnv("AXIOM_RUNTIME_API_BASE", "https://axiom-api-eta.vercel.app/v1");
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope({}));
    vi.stubGlobal("fetch", fetchMock);

    // What the site legitimately asks for resolves unchanged.
    expect(upstreamUrl("/runtime/packages/us-co/co-snap/graph")).toBe(
      "https://axiom-api-eta.vercel.app/v1/runtime/packages/us-co/co-snap/graph"
    );
    expect(upstreamUrl("/nodes/us%3Astatutes/26/24%23ctc")).toBe(
      "https://axiom-api-eta.vercel.app/v1/nodes/us%3Astatutes/26/24%23ctc"
    );
    expect(upstreamUrl("/graph/compose?focus=us%3Astatutes%2F26%2F24")).toBe(
      "https://axiom-api-eta.vercel.app/v1/graph/compose?focus=us%3Astatutes%2F26%2F24"
    );

    // What an attacker can spell through the proxy routes does not.
    for (const path of [
      "/nodes/../admin/keys",
      "/nodes/%2E%2E/admin/usage",
      "/nodes/%2e%2e/%2e%2e/v1/admin/audit",
      "/nodes/x/../../admin/keys",
      "/runtime/packages/../../admin/analytics/graph",
      "/runtime/packages/./x/graph",
      "/admin/keys",
      "/ADMIN/usage",
      // the API decodes before routing, so these are /admin there
      "/%61dmin/usage",
      "/adm%69n/keys",
      "/%41DMIN",
      "//evil.example/v1/runtime/packages",
      "/nodes\\..\\admin",
    ]) {
      expect(upstreamUrl(path), path).toBeNull();
      expect(await runtimeProxyGet(path), path).toEqual({
        status: 400,
        body: { status: "error", error: { code: "invalid_path" } },
      });
    }
    expect(await getCertifiedNode("../admin/keys")).toBeNull();
    expect(await getProgramGraph("..", "..")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves generated paths only to themselves, for every input", () => {
    // Seeded property check: whatever segments a caller builds a path from,
    // an accepted path resolves to exactly the requested /v1 path and never
    // to the admin surface, as the API will route it (decoded).
    vi.stubEnv("AXIOM_RUNTIME_API_BASE", "https://axiom-api-eta.vercel.app/v1");
    let state = 20260929;
    const random = () => {
      // mulberry32: integer arithmetic, no float-precision short cycle
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    const heads = ["/nodes", "/runtime/packages", "/graph/compose", "/subgraph", "/certified", ""];
    const segments = [
      "us-co", "co-snap", "us%3Astatutes", "26", "24%23ctc", "admin", "keys", "..", ".", "%2E%2E",
      "%2e", "%2F", "%5C", "\\", "", "v1", "ADMIN", "%61dmin", "%2E%2e", "1(j)", "a.b",
    ];
    const fresh = () => {
      let out = "";
      const length = 1 + Math.floor(random() * 12);
      const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-_.";
      for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
      return out;
    };
    let accepted = 0;
    const distinct = new Set<string>();
    for (let run = 0; run < 20_000; run += 1) {
      let path = pick(heads);
      const depth = Math.floor(random() * 5);
      for (let i = 0; i < depth; i += 1) path += `/${random() < 0.5 ? fresh() : pick(segments)}`;
      if (random() < 0.3) path += `?focus=${pick(segments)}`;
      const url = upstreamUrl(path);
      if (url === null) continue;
      accepted += 1;
      const resolved = new URL(url);
      const context = `run=${run} path=${JSON.stringify(path)} -> ${url}`;
      expect(resolved.origin, context).toBe("https://axiom-api-eta.vercel.app");
      expect(resolved.pathname, context).toBe(`/v1${path.split(/[?#]/, 1)[0]}`);
      const routed = decodeURI(resolved.pathname);
      expect(/^\/v1\/admin(\/|$)/i.test(routed), context).toBe(false);
      expect(routed.split("/").some((segment) => segment === "." || segment === ".."), context).toBe(false);
      distinct.add(path);
    }
    expect(accepted).toBeGreaterThan(5_000);
    expect(distinct.size).toBeGreaterThan(2_000);
  });

  it("refuses redirects on keyed requests, so the key goes nowhere unchecked", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubEnv("AXIOM_RUNTIME_API_BASE", "https://axiom-api-eta.vercel.app/v1");
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope({ packages: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listRuntimePackages();
    await runtimeProxyGet("/runtime/packages");
    await runCalculate({});
    await runCalculateRoot({ root: "us:statutes/26/24", facts: {} });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.redirect).toBe("error");
    }
  });

  it("answers a malformed API base as an upstream fault, not a bad request", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    vi.stubEnv("AXIOM_RUNTIME_API_BASE", "not a url");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await runtimeProxyGet("/runtime/packages")).toEqual({
      status: 502,
      body: { status: "error", error: { code: "upstream_misconfigured" } },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reduces parity cases to their declared comparison engines, skipping malformed entries", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    // Shaped like GET /v1/parity/cases on 2026-10-03, before the API
    // published results: an external comparison carries its setup only.
    const comparison = {
      id: "co-snap-policyengine-current",
      engine: "policyengine",
      description: "PolicyEngine current comparison.",
      request: { country_id: "us", version: "current", household: {} },
      mappings: [
        {
          axiom_variable: "snap_benefit_amount",
          external_path: "result.spm_units.spm_unit.snap.2026",
          transform: "annual_to_monthly",
        },
      ],
      trace_mappings: [],
      notes: [],
      tolerance: { amount: 0.01 },
    };
    const cases = [
      {
        id: "co-snap-us-co-family-1",
        description: "Colorado SNAP canonical two-person household.",
        program_id: "co-snap",
        jurisdiction: "us-co",
        runtime_supported: true,
        external_comparisons: [
          comparison,
          { ...comparison, id: "second-policyengine" },
          { ...comparison, id: "no-engine", engine: undefined },
          null,
        ],
        known_deviation: null,
      },
      {
        id: "snap-us-ca-family-1",
        description: null,
        program_id: "snap",
        jurisdiction: "us-ca",
        runtime_supported: true,
        external_comparisons: [],
        known_deviation: null,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope({ cases }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listParityCases()).toEqual([
      {
        id: "co-snap-us-co-family-1",
        description: "Colorado SNAP canonical two-person household.",
        program_id: "co-snap",
        jurisdiction: "us-co",
        comparisonEngines: ["policyengine"],
        comparisonResults: [
          { engine: "policyengine", status: null, observedAt: null, engineVersion: null },
          { engine: "policyengine", status: null, observedAt: null, engineVersion: null },
        ],
      },
      {
        id: "snap-us-ca-family-1",
        description: "",
        program_id: "snap",
        jurisdiction: "us-ca",
        comparisonEngines: [],
        comparisonResults: [],
      },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain("/parity/cases");
  });

  it("reads each comparison's latest published result and ignores a malformed one", async () => {
    vi.stubEnv("AXIOM_RUNTIME_API_KEY", "test-key");
    // Shaped like axiom-api#258's external_comparisons[].latest_result.
    const latest = {
      status: "known_difference",
      observed_at: "2026-10-03T12:41:07.512Z",
      engine_version: "2.9.0",
      mappings: [],
    };
    const cases = [
      {
        id: "co-snap-us-co-family-1",
        description: "Colorado SNAP canonical two-person household.",
        program_id: "co-snap",
        jurisdiction: "us-co",
        external_comparisons: [
          { id: "a", engine: "policyengine", latest_result: latest },
          { id: "b", engine: "policyengine", latest_result: { ...latest, status: "match", engine_version: 7 } },
          { id: "c", engine: "policyengine", latest_result: { ...latest, status: "verified" } },
          { id: "d", engine: "policyengine", latest_result: null },
        ],
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okEnvelope({ cases })));
    const [summary] = await listParityCases();
    expect(summary.comparisonResults).toEqual([
      { engine: "policyengine", status: "known_difference", observedAt: "2026-10-03T12:41:07.512Z", engineVersion: "2.9.0" },
      { engine: "policyengine", status: "match", observedAt: "2026-10-03T12:41:07.512Z", engineVersion: null },
      // An unknown status is no result, so it can never read as a match.
      { engine: "policyengine", status: null, observedAt: null, engineVersion: null },
      { engine: "policyengine", status: null, observedAt: null, engineVersion: null },
    ]);
  });
});
