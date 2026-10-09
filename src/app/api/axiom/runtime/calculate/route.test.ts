import { compositionScope } from "@/lib/axiom/runtime/composition-readiness";
import { describeRelation } from "@/lib/axiom/runtime/relation-roles";
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getRuntimePackageMock,
  runCalculateMock,
  runCalculateRootMock,
  isConfiguredMock,
  runtimeProxyGetMock,
} = vi.hoisted(() => ({
  getRuntimePackageMock: vi.fn(),
  runCalculateMock: vi.fn(),
  runCalculateRootMock: vi.fn(),
  isConfiguredMock: vi.fn(),
  runtimeProxyGetMock: vi.fn(),
}));

vi.mock("@/lib/axiom/runtime/api", () => ({
  getRuntimePackage: getRuntimePackageMock,
  runCalculate: runCalculateMock,
  runCalculateRoot: runCalculateRootMock,
  isRuntimeApiConfigured: isConfiguredMock,
  runtimeProxyGet: runtimeProxyGetMock,
}));

import { POST } from "./route";
import { _resetRunRouteState } from "../run/limiter";

function post(body: unknown): Request {
  return new Request("http://localhost/api/axiom/runtime/calculate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/axiom/runtime/calculate (run-by-root)", () => {
  beforeEach(() => {
    _resetRunRouteState();
    getRuntimePackageMock.mockReset();
    runCalculateMock.mockReset();
    runCalculateRootMock.mockReset();
    isConfiguredMock.mockReset();
    isConfiguredMock.mockReturnValue(true);
  });

  it("preserves long encoding input and trace names for every person and reports rejected keys", async () => {
    const name = "last_enacted_appropriation_act_maximum_federal_pell_grant_applicable_to_award_year";
    const variable = "us:statutes/20/1070a/b/5#" + "long_".repeat(40);
    runCalculateRootMock.mockResolvedValue({kind:"ok",result:{outputs:{total:7060},trace:[]}});
    const response = await POST(post({root:"us:statutes/20/1070a/b/5",facts:{[name]:6000,"invalid-key":1},people:{person_2:{[name]:5000}},variables:[variable]}));
    expect(response.status).toBe(200);
    expect(runCalculateRootMock).toHaveBeenCalledWith({root:"us:statutes/20/1070a/b/5",facts:{[name]:6000},people:{person_2:{[name]:5000}},variables:[variable]});
    expect(await response.json()).toMatchObject({applied:[name],dropped:["invalid-key"]});
  });

  it("passes the root shape through and returns the run envelope", async () => {
    runCalculateRootMock.mockResolvedValue({
      kind: "ok",
      result: {
        outputs: { net_income: 1200 },
        trace: [
          {
            rule_id: "net_income",
            variable: "net_income",
            value: 1200,
            sources: [],
          },
        ],
      },
    });

    const response = await POST(
      post({
        root: "us:statutes/7/2014/e/6/A",
        facts: { household_size: 2, bogus: "nope" },
        variables: ["net_income"],
      })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.outputs.net_income).toBe(1200);
    expect(data.trace).toHaveLength(1);
    expect(data.applied).toEqual(["household_size"]);
    expect(data.dropped).toEqual(["bogus"]);
    expect(runCalculateRootMock).toHaveBeenCalledWith({
      root: "us:statutes/7/2014/e/6/A",
      facts: { household_size: 2 },
      variables: ["net_income"],
    });
    // The package path must not be consulted for root runs.
    expect(getRuntimePackageMock).not.toHaveBeenCalled();
  });

  it("sanitizes extra members like facts and forwards them as people", async () => {
    runCalculateRootMock.mockResolvedValue({
      kind: "ok",
      result: { outputs: {}, trace: [] },
    });
    const response = await POST(
      post({
        root: "us:statutes/26/32",
        facts: { age: 40 },
        people: {
          person_2: { age: 38, bogus: "nope" },
          person_13: { age: 1 }, // beyond the member-id bound
          "not-a-member": { age: 2 },
        },
        variables: ["eitc"],
      })
    );
    expect(response.status).toBe(200);
    expect(runCalculateRootMock).toHaveBeenCalledWith({
      root: "us:statutes/26/32",
      facts: { age: 40 },
      people: { person_2: { age: 38 } },
      variables: ["eitc"],
    });
  });

  it("omits people entirely when no valid member survives", async () => {
    runCalculateRootMock.mockResolvedValue({
      kind: "ok",
      result: { outputs: {}, trace: [] },
    });
    await POST(
      post({
        root: "us:statutes/26/32",
        facts: { age: 40 },
        people: { intruder: { age: 9 } },
        variables: [],
      })
    );
    expect(runCalculateRootMock).toHaveBeenCalledWith({
      root: "us:statutes/26/32",
      facts: { age: 40 },
      people: undefined,
      variables: [],
    });
  });

  it("404s root_calculate_unsupported when the upstream lacks the endpoint", async () => {
    runCalculateRootMock.mockResolvedValue({ kind: "unsupported" });
    const response = await POST(
      post({ root: "us:regulations/7-cfr/273/10", facts: {} })
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("root_calculate_unsupported");
  });

  it("maps refusal and failure outcomes for root runs, message included", async () => {
    runCalculateRootMock.mockResolvedValue({
      kind: "refused",
      code: "compile_failed",
      message: "versioned derived formulas are not supported yet",
    });
    const refused = await POST(
      post({ root: "us:statutes/42/1396a/a/10", facts: {} })
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      error: "compile_failed",
      message: "versioned derived formulas are not supported yet",
    });

    runCalculateRootMock.mockResolvedValue({ kind: "failed" });
    expect(
      (await POST(post({ root: "us:statutes/7/2014", facts: {} }))).status
    ).toBe(502);
  });

  it("rejects malformed roots without touching the upstream", async () => {
    for (const root of ["statutes/7/2014", "us:", "us:stat utes", 7, "x:#a"]) {
      const response = await POST(post({ root }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_root");
    }
    expect(runCalculateRootMock).not.toHaveBeenCalled();
  });

  it("503s when the runtime API is unconfigured", async () => {
    isConfiguredMock.mockReturnValue(false);
    const response = await POST(
      post({ root: "us:statutes/7/2014", facts: {} })
    );
    expect(response.status).toBe(503);
  });

  it("keeps the program-coordinates shape working unchanged", async () => {
    getRuntimePackageMock.mockResolvedValue({
      sample_request: {
        household: { entities: { unit: { u1: {} } } },
      },
      default_outputs: ["snap_allotment"],
      default_period: "2026-01",
      entities: [
        { entity: "unit", inputs: [{ name: "household_size" }] },
      ],
    });
    runCalculateMock.mockResolvedValue({
      outputs: { snap_allotment: 298 },
      trace: [],
    });

    const response = await POST(
      post({
        jurisdiction: "us-co",
        program_id: "co-snap",
        values: { household_size: 3 },
      })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.outputs.snap_allotment).toBe(298);
    expect(data.period).toBe("2026-01");
    expect(data.applied).toEqual(["household_size"]);
    expect(runCalculateRootMock).not.toHaveBeenCalled();
  });
});

vi.mock("@/lib/axiom/runtime/composition-readiness", () => ({compositionScope:vi.fn().mockResolvedValue({readiness:"ready",relations:[]})}));
it("refuses unsupported composition before executing flat facts", async () => {
 isConfiguredMock.mockReturnValue(true);
 _resetRunRouteState();
 vi.mocked(compositionScope).mockResolvedValueOnce({readiness:"relationships_unsupported",relations:[]});
 runCalculateRootMock.mockClear();
 const response = await POST(post({root:"us:statutes/26/22",facts:{payment_amount:1000}}));
 expect(response.status).toBe(422);
 expect(await response.json()).toEqual({error:"relationships_unsupported"});
 expect(runCalculateRootMock).not.toHaveBeenCalled();
});

describe("explicit relation roles (roles_required scopes)", () => {
  const relation = (file: string, name: string, args: string[]) =>
    describeRelation({ name, kind: "data_relation", data_relation: { arity: 2, arguments: args } }, file);
  const EITC = [
    relation("us:statutes/26/32", "qualifying_child_of_tax_unit", ["TaxUnit", "Person"]),
    relation("us:statutes/26/151", "exemption_individual_of_tax_unit", ["TaxUnit", "Person"]),
    relation("us-co:regulations/x", "member_of_household", ["Person", "Household"]),
  ];
  const roles = {
    "us:statutes/26/32#qualifying_child_of_tax_unit": ["person_4"],
    "us:statutes/26/151#exemption_individual_of_tax_unit": ["person_1", "person_4"],
    "us-co:regulations/x#member_of_household": [],
  };
  beforeEach(() => {
    _resetRunRouteState();
    runCalculateRootMock.mockReset();
    isConfiguredMock.mockReturnValue(true);
    vi.mocked(compositionScope).mockResolvedValue({ readiness: "roles_required", relations: EITC });
    runtimeProxyGetMock.mockReset();
    runtimeProxyGetMock.mockResolvedValue(catalogFor(EITC));
  });

  /** The runtime's root-inputs payload for these declarations (axiom-api#267). */
  const catalogFor = (relations: typeof EITC, patch: (entry: Record<string, unknown>, index: number) => Record<string, unknown> = (entry) => entry) => ({
    status: 200,
    body: {
      status: "ok",
      data: {
        inputs: [],
        relation_membership: ["convention", "explicit"],
        relations: relations.map((relation, index) =>
          patch(
            {
              name: relation.relationId,
              slot_entities: relation.arguments,
              tuple: relation.personSlot === 0 ? ["person:1:{index}", "household:1"] : ["household:1", "person:1:{index}"],
              explicit: true,
            },
            index,
          ),
        ),
      },
    },
  });

  it("refuses before running when the runtime binds a relation the source does not declare, or cannot take explicit roles", async () => {
    const extra = describeRelation({ name: "hidden_extra", kind: "data_relation", data_relation: { arity: 2, arguments: ["TaxUnit", "Person"] } }, "us:statutes/26/99");
    for (const catalog of [
      catalogFor([...EITC, extra]),
      catalogFor(EITC, (entry, index) => (index === 0 ? { ...entry, explicit: false } : entry)),
      catalogFor(EITC, (entry, index) => (index === 0 ? { ...entry, tuple: [...(entry.tuple as string[])].reverse() } : entry)),
      { status: 200, body: { status: "ok", data: { inputs: [], relations: [] } } },
    ]) {
      runtimeProxyGetMock.mockResolvedValueOnce(catalog);
      const response = await POST(post({ root: "us:statutes/26/32", facts: {}, people: { person_4: {} }, relations: roles, variables: ["eitc"] }));
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("relationships_unsupported");
    }
    runtimeProxyGetMock.mockResolvedValueOnce({ status: 502, body: {} });
    const unreadable = await POST(post({ root: "us:statutes/26/32", facts: {}, people: { person_4: {} }, relations: roles, variables: ["eitc"] }));
    expect(unreadable.status).toBe(503);
    expect(runCalculateRootMock).not.toHaveBeenCalled();
    // The gate never trusts a cached catalog.
    for (const call of runtimeProxyGetMock.mock.calls) {
      expect(call).toEqual(["/runtime/root-inputs?root=us%3Astatutes%2F26%2F32", { timeoutMs: 20000, fresh: true }]);
    }
  });

  it("bounds role answers and never echoes arbitrary input", async () => {
    const tooMany = { ...roles, "us:statutes/26/32#qualifying_child_of_tax_unit": Array.from({ length: 13 }, () => "person_2") };
    const response = await POST(post({ root: "us:statutes/26/32", facts: {}, people: { person_2: {} }, relations: tooMany, variables: [] }));
    expect(response.status).toBe(422);
    expect((await response.json()).message).toMatch(/more than 12 members/);
    const hostile = { ...roles, "us:statutes/26/32#qualifying_child_of_tax_unit": ["<script>alert(1)</script>"] };
    const echoed = await POST(post({ root: "us:statutes/26/32", facts: {}, people: { person_2: {} }, relations: hostile, variables: [] }));
    expect((await echoed.json()).message).not.toContain("<script>");
    const hostileKey = await POST(post({ root: "us:statutes/26/32", facts: {}, people: { person_2: {} }, relations: { ...roles, ["<img src=x>".repeat(50)]: [] }, variables: [] }));
    const body = await hostileKey.json();
    expect(body.error).toBe("unknown_relation");
    expect(body.message).not.toContain("<img");
  });

  it("refuses to run without every relation answered, before any upstream call", async () => {
    for (const relations of [undefined, {}, { ...roles, "us-co:regulations/x#member_of_household": undefined }]) {
      const response = await POST(post({ root: "us:statutes/26/32", facts: {}, relations, variables: ["eitc"] }));
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("relation_roles_required");
    }
    const unknown = await POST(post({ root: "us:statutes/26/32", facts: {}, relations: { ...roles, "us:statutes/26/32#qualifying_child_of_tax_unit": ["person_3"] }, variables: [] }));
    expect(await unknown.json()).toMatchObject({ error: "unknown_member", message: "person_3 is not a person in this scenario." });
    expect(runCalculateRootMock).not.toHaveBeenCalled();
  });

  it("sends every relation (empty ones too) with tuples in declared slot order, numbering people by household order", async () => {
    runCalculateRootMock.mockResolvedValue({ kind: "ok", result: { outputs: { eitc: 3400 }, trace: [] }, relationMembership: "explicit" });
    const response = await POST(post({ root: "us:statutes/26/32", facts: { is_taxpayer: true }, people: { person_2: {}, person_4: { age: 8 } }, relations: roles, variables: ["eitc"] }));
    expect(response.status).toBe(200);
    expect((await response.json()).outputs).toEqual({ eitc: 3400 });
    expect(runCalculateRootMock).toHaveBeenCalledWith({
      root: "us:statutes/26/32",
      facts: { is_taxpayer: true },
      people: { person_2: {}, person_4: { age: 8 } },
      variables: ["eitc"],
      relations: [
        { name: "us:statutes/26/32#relation.qualifying_child_of_tax_unit", tuples: [["household:1", "person:1:3"]] },
        { name: "us:statutes/26/151#relation.exemption_individual_of_tax_unit", tuples: [["household:1", "person:1:1"], ["household:1", "person:1:3"]] },
        // Unticked, yet named: an omitted relation would bind everyone upstream.
        { name: "us-co:regulations/x#relation.member_of_household", tuples: [] },
      ],
    });
  });

  it("withholds results a runtime computed under the convention instead of the roles", async () => {
    runCalculateRootMock.mockResolvedValue({ kind: "ok", result: { outputs: { eitc: 3400 }, trace: [] }, relationMembership: "convention" });
    const response = await POST(post({ root: "us:statutes/26/32", facts: {}, people: { person_4: {} }, relations: roles, variables: ["eitc"] }));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("relationships_unsupported");
    expect(body.outputs).toBeUndefined();
  });

  it("presents a household the runtime refused, in its own words", async () => {
    runCalculateRootMock.mockResolvedValue({ kind: "refused", code: "invalid_household", message: "household.relations[0]: a tuple does not fit" });
    const response = await POST(post({ root: "us:statutes/26/32", facts: {}, people: { person_4: {} }, relations: roles, variables: ["eitc"] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_household", message: "household.relations[0]: a tuple does not fit" });
  });

  it("keeps single-relation scopes on the membership convention", async () => {
    vi.mocked(compositionScope).mockResolvedValue({ readiness: "ready", relations: [EITC[0]!] });
    runCalculateRootMock.mockResolvedValue({ kind: "ok", result: { outputs: { n: 1 }, trace: [] }, relationMembership: "convention" });
    const response = await POST(post({ root: "us:statutes/26/21", facts: {}, relations: roles, variables: ["n"] }));
    expect(response.status).toBe(200);
    expect(runCalculateRootMock).toHaveBeenCalledWith({ root: "us:statutes/26/21", facts: {}, people: undefined, variables: ["n"] });
  });
});
