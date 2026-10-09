import { describe, it, expect } from "vitest";
import { buildRunRequestBody, mergeRunBatches, scenarioKey, traceRootIds, classifyRunRefusal } from "./run-request";
import type { ProgramGraph, RuleNode } from "./types";

describe("buildRunRequestBody", () => {
  it("compose mode: per-request instances travel whole, an empty kind included", () => {
    const body = buildRunRequestBody(
      "us:statutes/26/22",
      null,
      { adjusted_gross_income: 8500 },
      ["elderly_disabled_credit"],
      {},
      { "us:statutes/26/22#section_22_payment_of_tax_unit": ["payment_1"] },
      { Payment: { payment_1: { payment_amount: 1000 } } },
    );
    expect(body).toEqual({
      root: "us:statutes/26/22",
      facts: { adjusted_gross_income: 8500 },
      relations: { "us:statutes/26/22#section_22_payment_of_tax_unit": ["payment_1"] },
      instances: { Payment: { payment_1: { payment_amount: 1000 } } },
      variables: ["elderly_disabled_credit"],
    });
    expect(buildRunRequestBody("us:statutes/26/22", null, {}, [], undefined, {}, { Payment: {} })).toMatchObject({ instances: { Payment: {} } });
    expect(buildRunRequestBody("us:statutes/26/22", null, {}, [], undefined, undefined, {})).not.toHaveProperty("instances");
  });

  it("compose mode: typed values travel verbatim as facts on the root shape", () => {
    const body = buildRunRequestBody(
      "us-co:regulations/10-ccr-2506-1/4.410#some_rule",
      { jurisdiction: "us-co", programId: "co-snap" },
      { household_vehicle_resource_value: 500, household_occupies_home: true },
      ["countable_resources"]
    );
    expect(body).toEqual({
      root: "us-co:regulations/10-ccr-2506-1/4.410",
      facts: {
        household_vehicle_resource_value: 500,
        household_occupies_home: true,
      },
      variables: ["countable_resources"],
    });
  });

  it("compose mode: extra members ride as people; empty people is omitted", () => {
    const withPeople = buildRunRequestBody(
      "us:statutes/26/32",
      null,
      { age: 40 },
      ["eitc"],
      { person_2: { age: 38 }, person_3: {} }
    );
    expect(withPeople).toEqual({
      root: "us:statutes/26/32",
      facts: { age: 40 },
      people: { person_2: { age: 38 }, person_3: {} },
      variables: ["eitc"],
    });
    // Single-filer runs must send the exact pre-people shape — older
    // upstreams feature-detect on it.
    const solo = buildRunRequestBody(
      "us:statutes/26/32",
      null,
      { age: 40 },
      ["eitc"],
      {}
    );
    expect(solo).toEqual({
      root: "us:statutes/26/32",
      facts: { age: 40 },
      variables: ["eitc"],
    });
  });

  it("compose mode: explicit relation roles travel whole, empty answers included", () => {
    const roles = { "us:statutes/26/32#qualifying_child_of_tax_unit": ["person_2"], "us:statutes/26/151#senior_deduction_individual_of_tax_unit": [] };
    expect(buildRunRequestBody("us:statutes/26/32#eitc", null, {}, ["eitc"], {}, roles)).toEqual({
      root: "us:statutes/26/32",
      facts: {},
      relations: roles,
      variables: ["eitc"],
    });
    // Program coordinates never carry roles.
    expect(buildRunRequestBody(null, { jurisdiction: "us", programId: "fiit" }, {}, [], {}, roles)).not.toHaveProperty("relations");
  });

  it("program mode keeps coordinates and values", () => {
    const body = buildRunRequestBody(
      null,
      { jurisdiction: "us-ny", programId: "snap" },
      { household_size: 3 },
      []
    );
    expect(body).toEqual({
      jurisdiction: "us-ny",
      program_id: "snap",
      values: { household_size: 3 },
      variables: [],
    });
  });
});

describe("scenarioKey (explicit runs only — edits mark staleness)", () => {
  it("ignores insertion order, catches value and key changes", () => {
    expect(
      scenarioKey({ household_size: 2, member_age: 40 }),
    ).toBe(scenarioKey({ member_age: 40, household_size: 2 }));
    expect(scenarioKey({ household_size: 2 })).not.toBe(
      scenarioKey({ household_size: 3 }),
    );
    expect(scenarioKey({ household_size: 2 })).not.toBe(
      scenarioKey({ household_size: 2, member_age: 40 }),
    );
    expect(scenarioKey({})).toBe(scenarioKey({}));
  });

  it("distinguishes boolean flips", () => {
    expect(scenarioKey({ occupies_home: true })).not.toBe(
      scenarioKey({ occupies_home: false }),
    );
  });
});

describe("traceRootIds", () => {
  const rule = (name: string, kind: string, ruleDeps: string[] = []): RuleNode => ({
    legalId: `snap#${name}`, name, fileLegalId: "snap", kind, entity: "Household", dtype: null,
    period: null, unit: null, source: null, ruleDeps, inputDeps: [], relationDeps: [],
  });
  it("starts from the served graph's tops when the terminal list is empty", () => {
    // A served SNAP graph is pruned to what its outputs exercise; the
    // API's terminal list comes back empty, and walking only from it
    // asked the engine to trace nothing.
    const graph: ProgramGraph = {
      rules: [
        rule("snap_allotment", "derived", ["snap#snap_maximum_allotment", "snap#snap_net_income"]),
        rule("snap_maximum_allotment", "derived", ["snap#snap_maximum_allotment_table"]),
        rule("snap_net_income", "derived"),
        rule("snap_standard_deduction", "derived"),
        rule("snap_maximum_allotment_table", "parameter"),
      ],
      inputs: [], relations: [], ownOutputs: [], terminalOutputs: [],
    };
    expect(traceRootIds(graph)).toEqual(["snap#snap_allotment", "snap#snap_standard_deduction"]);
  });

  it("keeps declared terminal outputs first and never repeats one", () => {
    const graph: ProgramGraph = {
      rules: [rule("benefit", "derived", ["snap#helper"]), rule("helper", "derived")],
      inputs: [], relations: [], ownOutputs: [], terminalOutputs: ["snap#benefit", "snap#declared_only"],
    };
    expect(traceRootIds(graph)).toEqual(["snap#benefit", "snap#declared_only"]);
  });
});

describe("mergeRunBatches", () => {
  it("adds the overflow batch's trace without overriding the primary", () => {
    const primary = {
      outputs: { snap_allotment: 298 },
      trace: [{ variable: "snap_allotment", value: 298 }, { variable: "snap_net_income", value: 0 }],
      provenance: null,
    };
    const merged = mergeRunBatches(primary, {
      outputs: { snap_allotment: 999, snap_asset_limit: 3000 },
      trace: [{ variable: "snap_net_income", value: 1 }, { variable: "snap_asset_limit", value: 3000 }],
    });
    expect(merged.outputs).toEqual({ snap_allotment: 298, snap_asset_limit: 3000 });
    expect(merged.trace.map((entry) => [entry.variable, entry.value])).toEqual([
      ["snap_allotment", 298],
      ["snap_net_income", 0],
      ["snap_asset_limit", 3000],
    ]);
    expect(merged.provenance).toBeNull();
  });
});

describe("classifyRunRefusal", () => {
  it("keeps Run for refusals the user can fix by editing the household or roles", () => {
    for (const code of ["invalid_household", "relation_roles_required", "unknown_member", "unknown_relation"]) {
      expect(classifyRunRefusal(code)).toBe("user_fixable");
    }
  });
  it("retries runtime errors through chunk probing and blocks scope-level refusals", () => {
    expect(classifyRunRefusal("runtime_error")).toBe("retry");
    for (const code of ["compile_failed", "closure_incomplete", "relationships_unsupported", "uncertified_node", undefined]) {
      expect(classifyRunRefusal(code)).toBe("scope_blocked");
    }
  });
});
