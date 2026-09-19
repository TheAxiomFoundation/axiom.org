import { describe, it, expect } from "vitest";
import {
  composeRootOutput,
  filterStandaloneRules,
  focusedComposeRule,
} from "./compose-filter";
import type { ProgramGraph, RuleNode } from "./types";

function rule(overrides: Partial<RuleNode>): RuleNode {
  return {
    legalId: "us:statutes/1#rule",
    name: "rule",
    fileLegalId: "us:statutes/1",
    kind: "derived",
    entity: null,
    dtype: null,
    period: null,
    unit: null,
    source: null,
    ruleDeps: [],
    inputDeps: [],
    relationDeps: [],
    ...overrides,
  };
}

function graph(rules: RuleNode[], outputs?: string[]): ProgramGraph {
  return {
    rules,
    inputs: [],
    relations: [],
    ownOutputs: outputs ?? rules.map((r) => r.legalId),
    terminalOutputs: outputs ?? rules.map((r) => r.legalId),
  };
}

describe("filterStandaloneRules", () => {
  const fosterCare = rule({
    legalId: "f#foster_care",
    name: "foster_care",
  });
  const netIncome = rule({
    legalId: "f#net_income",
    name: "net_income",
    ruleDeps: ["f#gross_income"],
  });
  const grossIncome = rule({
    legalId: "f#gross_income",
    name: "gross_income",
    inputDeps: ["f#input.wages"],
  });

  it("hides zero-dep zero-dependent rules and reports the count", () => {
    const { graph: filtered, hiddenCount } = filterStandaloneRules(
      graph([fosterCare, netIncome, grossIncome]),
    );
    expect(hiddenCount).toBe(1);
    expect(filtered.rules.map((r) => r.legalId)).toEqual([
      "f#net_income",
      "f#gross_income",
    ]);
    // Outputs lists shed the hidden ids too.
    expect(filtered.ownOutputs).not.toContain("f#foster_care");
  });

  it("keeps referenced no-dep rules (parameters someone consumes)", () => {
    const parameter = rule({
      legalId: "f#max_allotment",
      name: "max_allotment",
      kind: "parameter",
    });
    const consumer = rule({
      legalId: "f#allotment",
      name: "allotment",
      ruleDeps: ["f#max_allotment"],
    });
    const { graph: filtered, hiddenCount } = filterStandaloneRules(
      graph([parameter, consumer, fosterCare]),
    );
    expect(hiddenCount).toBe(1);
    expect(filtered.rules.map((r) => r.legalId)).toContain(
      "f#max_allotment",
    );
  });

  it("keeps input-fed rules even with no rule deps", () => {
    const { hiddenCount } = filterStandaloneRules(
      graph([grossIncome, fosterCare]),
    );
    expect(hiddenCount).toBe(1);
  });

  it("keeps relation-fed rules", () => {
    const relationFed = rule({
      legalId: "f#member_count",
      name: "member_count",
      relationDeps: ["f#relation.members"],
    });
    const { graph: filtered } = filterStandaloneRules(
      graph([relationFed, fosterCare, netIncome, grossIncome]),
    );
    expect(filtered.rules.map((r) => r.legalId)).toContain(
      "f#member_count",
    );
  });

  it("filters nothing when EVERY rule is standalone — a glossary page must still render", () => {
    const glossary = graph([
      fosterCare,
      rule({ legalId: "f#household", name: "household" }),
    ]);
    const { graph: filtered, hiddenCount } =
      filterStandaloneRules(glossary);
    expect(hiddenCount).toBe(0);
    expect(filtered).toBe(glossary);
  });

  it("is a no-op on graphs with no standalone rules", () => {
    const clean = graph([netIncome, grossIncome]);
    const { graph: filtered, hiddenCount } = filterStandaloneRules(clean);
    expect(hiddenCount).toBe(0);
    expect(filtered).toBe(clean);
  });
});

describe("composeRootOutput (root-first selection)", () => {
  const leafA = rule({ legalId: "f#rate", name: "rate" });
  const leafB = rule({ legalId: "f#floor", name: "floor" });
  const mid = rule({
    legalId: "f#creditable",
    name: "creditable",
    ruleDeps: ["f#rate"],
  });
  const root = rule({
    legalId: "f#cdcc",
    name: "cdcc",
    ruleDeps: ["f#creditable", "f#floor"],
  });

  it("picks the terminal root with the largest closure — never array order", () => {
    // Composed graphs list EVERY rule as an output, leaves first —
    // the root must still win.
    const g = graph([leafA, leafB, mid, root]);
    expect(composeRootOutput(g)).toBe("f#cdcc");
  });

  it("falls back to ownOutputs, then to the rule list", () => {
    const g = graph([leafA, mid, root]);
    g.terminalOutputs = [];
    expect(composeRootOutput(g)).toBe("f#cdcc");
    g.ownOutputs = [];
    expect(composeRootOutput(g)).toBe("f#cdcc");
  });

  it("breaks closure-size ties deterministically", () => {
    const g = graph([leafA, leafB]);
    expect(composeRootOutput(g)).toBe("f#floor");
    expect(composeRootOutput(graph([leafB, leafA]))).toBe("f#floor");
  });

  it("returns null for an empty graph", () => {
    expect(composeRootOutput(graph([]))).toBeNull();
  });
});

describe("focusedComposeRule", () => {
  // 26 USC 24(d): the non-refundable credit consumes the refundable
  // one, so the summit (largest closure) is non_refundable_ctc even
  // when the reader asked for refundable_ctc.
  const refundable = rule({
    legalId: "us:statutes/26/24/d#refundable_ctc",
    name: "refundable_ctc",
    fileLegalId: "us:statutes/26/24/d",
    ruleDeps: ["us:statutes/26/24/d#ctc_refundable_cap"],
  });
  const cap = rule({
    legalId: "us:statutes/26/24/d#ctc_refundable_cap",
    name: "ctc_refundable_cap",
    fileLegalId: "us:statutes/26/24/d",
  });
  const nonRefundable = rule({
    legalId: "us:statutes/26/24/d#non_refundable_ctc",
    name: "non_refundable_ctc",
    fileLegalId: "us:statutes/26/24/d",
    ruleDeps: [refundable.legalId],
  });
  const g = graph([cap, refundable, nonRefundable], [
    refundable.legalId,
    nonRefundable.legalId,
  ]);

  it("names the rule a #fragment focus points at", () => {
    expect(focusedComposeRule(g, "us:statutes/26/24/d#refundable_ctc")).toBe(
      "us:statutes/26/24/d#refundable_ctc",
    );
  });

  it("never matches by suffix", () => {
    // "#refundable_ctc" is a suffix of "#non_refundable_ctc"; only the
    // exact legal id counts.
    expect(focusedComposeRule(g, "us:statutes/26/24/d#undable_ctc")).toBeNull();
    expect(
      focusedComposeRule(g, "us:statutes/26/24/d#refundable_ctc"),
    ).not.toBe(nonRefundable.legalId);
  });

  it("ignores a file-level focus (compose already scopes the file)", () => {
    expect(focusedComposeRule(g, "us:statutes/26/24/d")).toBeNull();
  });

  it("ignores a rule the composed graph does not carry", () => {
    expect(focusedComposeRule(g, "us:statutes/26/24/d#missing")).toBeNull();
    expect(focusedComposeRule(g, null)).toBeNull();
  });

  it("is what the opening flight needs: the summit is the consumer", () => {
    expect(composeRootOutput(g)).toBe(nonRefundable.legalId);
  });
});
