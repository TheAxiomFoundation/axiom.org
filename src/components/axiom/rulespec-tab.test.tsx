import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  RuleSpecTab,
  formatScalar,
  formatFormulaForDisplay,
  ownerRuleFor,
  groupTestsByRule,
  softUnwrap,
} from "./rulespec-tab";
import type { RuleEncodingData } from "@/lib/supabase";
import type { RuleSpecTestCase } from "@/lib/axiom/rulespec/doc";
import { _resetRawFetchCache } from "@/lib/axiom/rulespec/raw-cache";

function makeEncoding(
  overrides: Partial<RuleEncodingData> = {}
): RuleEncodingData {
  return {
    encoding_run_id: "github:statutes/26/3101/a.yaml",
    citation: "26 USC 3101(a)",
    session_id: null,
    file_path: "statutes/26/3101/a.yaml",
    rulespec_content: "",
    final_scores: null,
    iterations: null,
    total_duration_ms: null,
    agent_type: null,
    agent_model: null,
    data_source: null,
    has_issues: null,
    note: null,
    timestamp: null,
    encoder_version: null,
    ...overrides,
  };
}

function makeTest(
  name: string,
  output: Record<string, unknown>,
  overrides: Partial<RuleSpecTestCase> = {}
): RuleSpecTestCase {
  return {
    name,
    period: null,
    input: { wages: 1 },
    output,
    raw: {},
    ...overrides,
  };
}

/** Rule blocks are always open; the raw YAML sits behind a small
 *  toggle. Open every YAML toggle so assertions can see the dump. */
function expandAllRuleCards(container: ParentNode = document) {
  container
    .querySelectorAll<HTMLButtonElement>(
      'article[id^="rule-"] button[aria-expanded="false"]'
    )
    .forEach((btn) => {
      if (btn.textContent?.includes("YAML")) fireEvent.click(btn);
    });
}

const TWO_RULES_DOC = `format: rulespec/v1
rules:
  - name: rate
    kind: parameter
    versions:
      - effective_from: '2020-01-01'
        effective_to: '2024-12-31'
        formula: '0.062'
  - name: tax
    kind: derived
    versions:
      - effective_from: '2020-01-01'
        formula: rate * wages
`;

describe("formatScalar", () => {
  it("renders nullish values as the literal 'null'", () => {
    expect(formatScalar(null)).toBe("null");
    expect(formatScalar(undefined)).toBe("null");
  });
  it("returns strings unchanged", () => {
    expect(formatScalar("yes")).toBe("yes");
  });
  it("stringifies numbers and booleans natively", () => {
    expect(formatScalar(0)).toBe("0");
    expect(formatScalar(6200)).toBe("6200");
    expect(formatScalar(true)).toBe("true");
    expect(formatScalar(false)).toBe("false");
  });
  it("falls back to JSON for objects and arrays", () => {
    expect(formatScalar({ a: 1 })).toBe('{"a":1}');
    expect(formatScalar([1, 2])).toBe("[1,2]");
  });
});

describe("softUnwrap", () => {
  it("joins hard-wrapped lines into flowing prose", () => {
    expect(softUnwrap("a weekly amount\nfor a child under 16.")).toBe(
      "a weekly amount for a child under 16."
    );
  });
  it("preserves blank-line paragraph breaks", () => {
    expect(softUnwrap("first para\nstill first.\n\nsecond para.")).toBe(
      "first para still first.\n\nsecond para."
    );
  });
});

describe("formatFormulaForDisplay", () => {
  it("keeps short and already-multiline formulas unchanged", () => {
    expect(formatFormulaForDisplay("rate * wages")).toBe("rate * wages");
    expect(formatFormulaForDisplay("if x then 1\nelse 2")).toBe(
      "if x then 1\nelse 2"
    );
  });
  it("breaks long single-line conditionals before each else", () => {
    const long =
      "if age >= 65 then pension_rate else if age >= 18 then adult_rate else child_rate";
    expect(formatFormulaForDisplay(long)).toBe(
      "if age >= 65 then pension_rate\nelse if age >= 18 then adult_rate\nelse child_rate"
    );
  });
});

describe("ownerRuleFor", () => {
  it("returns the first output key that names a local rule", () => {
    expect(
      ownerRuleFor(makeTest("t", { tax: 100, other: 1 }), new Set(["tax"]))
    ).toBe("tax");
  });
  it("returns null when no output key matches a local rule", () => {
    expect(ownerRuleFor(makeTest("t", { other: 1 }), new Set(["tax"]))).toBeNull();
  });
});

describe("groupTestsByRule", () => {
  it("buckets tests under their owner rule and drops orphans", () => {
    const tests = [
      makeTest("a", { tax: 1 }),
      makeTest("b", { tax: 2 }),
      makeTest("orphan", { unrelated: 1 }),
      makeTest("c", { rate: 0.5 }),
    ];
    const grouped = groupTestsByRule(tests, new Set(["tax", "rate"]));
    expect(grouped.get("tax")?.map((t) => t.name)).toEqual(["a", "b"]);
    expect(grouped.get("rate")?.map((t) => t.name)).toEqual(["c"]);
    expect(grouped.has("orphan")).toBe(false);
  });
});

describe("RuleSpecTab — rendering edge cases", () => {
  beforeEach(() => {
    _resetRawFetchCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits each rule's YAML inside a code block", () => {
    const { container } = render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: TWO_RULES_DOC })}
        loading={false}
        jurisdiction="us"
      />
    );
    expandAllRuleCards(container);
    // Both effective dates show up in the dumped YAML — Prism
    // splits text into spans so we look at concatenated text.
    expect(container.textContent).toContain("2020-01-01");
    expect(container.textContent).toContain("2024-12-31");
    // The derived rule's formula round-trips through dump.
    expect(container.textContent).toContain("rate * wages");
    expect(container.querySelector("code.language-yaml")).not.toBeNull();
    expect(container.textContent).not.toContain("Formulas");
  });

  it("labels undated versions 'all dates' and bolds formula keywords", () => {
    const doc = `format: rulespec/v1
rules:
  - name: cap
    kind: parameter
    versions:
      - formula: 'if eligible then 100 else 0'
      - effective_from: '2024-01-01'
        formula: '200'
`;
    const { container } = render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: doc })}
        loading={false}
        jurisdiction="us"
      />
    );
    expect(screen.getByText("all dates")).toBeInTheDocument();
    const keywords = Array.from(
      container.querySelectorAll("pre span.font-semibold")
    ).map((el) => el.textContent);
    expect(keywords).toContain("if");
    expect(keywords).toContain("else");
  });

  it("applies shared formula highlighting inside per-rule YAML cards", () => {
    const { container } = render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: TWO_RULES_DOC })}
        loading={false}
        jurisdiction="us"
      />
    );
    expandAllRuleCards(container);
    const html = Array.from(container.querySelectorAll("code.language-yaml"))
      .map((el) => el.innerHTML)
      .join("\n");
    expect(html).toContain("token number");
    expect(html).toContain("token variable");
  });

  it("expands the per-rule tests block on click and shows input/output rows", async () => {
    const tests = [
      {
        name: "zero_in_zero_out",
        period: { period_kind: "tax_year" },
        input: { wages: 0 },
        output: { tax: 0 },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          `- name: zero_in_zero_out
  period: { period_kind: tax_year }
  input:
    wages: 0
  output:
    tax: 0
`,
      })
    );
    render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: TWO_RULES_DOC })}
        loading={false}
        jurisdiction="us"
      />
    );
    expandAllRuleCards();
    // The fetch resolves async — wait for the (1) test count next to
    // the disclosure to appear before clicking it open.
    await waitFor(() =>
      expect(screen.getByText(/^\(1\)$/)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /Tests/i }));
    expect(screen.getByText("zero_in_zero_out")).toBeInTheDocument();
    expect(screen.getAllByText("wages")[0]).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    void tests; // silence unused warning if shape evolves
  });

  it("does not render tests whose output keys do not match any local rule", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          `- name: stranded
  input: {}
  output:
    unrelated_key: 1
`,
      })
    );
    render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: TWO_RULES_DOC })}
        loading={false}
        jurisdiction="us"
      />
    );
    // Give the fetch a tick to settle, then assert that the test
    // case never rendered: orphan tests are dropped silently rather
    // than surfaced in their own section.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("stranded")).toBeNull();
    expect(
      screen.queryByText(/Tests not bound to a rule/i)
    ).toBeNull();
  });

  it("surfaces parse warnings when the doc has soft errors", () => {
    const broken = `format: rulespec/v1
rules:
  - kind: parameter
    versions: []
`;
    render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: broken })}
        loading={false}
        jurisdiction="us"
      />
    );
    expect(screen.getByText(/Parse warnings/i)).toBeInTheDocument();
    expect(screen.getByText(/missing `name`/i)).toBeInTheDocument();
  });

  it("renders source relations as first-class non-executable RuleSpec records", () => {
    const content = `format: rulespec/v1
rules:
  - name: restates_standard_deduction
    kind: source_relation
    source: 10 CCR 2506-1 section 4.407.1
    source_relation:
      type: restates
      target: us:policies/usda/snap/fy-2026-cola/deductions#snap_standard_deduction
      authority: federal
`;
    render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: content })}
        loading={false}
        jurisdiction="us-co"
      />
    );
    expandAllRuleCards();
    expect(
      screen.getByText("Restates snap_standard_deduction")
    ).toBeInTheDocument();
    expect(
      document.getElementById("rule-restates_standard_deduction")
    ).not.toBeNull();
    expect(screen.getAllByText(/us:policies\/usda\/snap/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no `versions`/i)).toBeNull();
  });

  it("renders source-relation spans and value refs", () => {
    const content = `format: rulespec/v1
rules:
  - name: sets_state_utility_allowance
    kind: source_relation
    source:
      ref: us-co:regulations/10-ccr-2506-1/4.407.3
      span: table A
    source_relation:
      type: sets
      target: us:regulations/7-cfr/273/9
      value: us-co:policies/cdhs/snap/fy-2026#heating_cooling_sua
      authority: state
`;
    render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: content })}
        loading={false}
        jurisdiction="us-co"
      />
    );
    expandAllRuleCards();
    expect(screen.getByText("Sets 9")).toBeInTheDocument();
    expect(screen.getByText("table A")).toBeInTheDocument();
    expect(screen.getAllByText(/heating_cooling_sua/).length).toBeGreaterThan(0);
  });

  it("renders data relations without binding tests to relation declarations", () => {
    const content = `format: rulespec/v1
rules:
  - name: member_of_household
    kind: data_relation
    data_relation:
      predicate: us:statutes/7/2012/j#relation.member_of_household
      arity: 2
`;
    render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: content })}
        loading={false}
        jurisdiction="us"
      />
    );
    expandAllRuleCards();
    expect(
      screen.getByText("Data relation relation.member_of_household")
    ).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no `versions`/i)).toBeNull();
  });

  it("renders related RuleSpec files when the exact source provision has no YAML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tree: [
            { path: "statutes/26/3101/a.yaml", type: "blob" },
            { path: "statutes/26/3101/b/1.yaml", type: "blob" },
            { path: "statutes/26/3101/b/2.yaml", type: "blob" },
            { path: "statutes/26/63/c/5.yaml", type: "blob" },
          ],
        }),
      })
    );
    render(
      <RuleSpecTab
        encoding={null}
        loading={false}
        jurisdiction="us"
        citationPath="us/statute/26/3101"
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/Available RuleSpec encodings/i)).toBeInTheDocument()
    );
    expect(
      screen.getByText(
        /This source provision is partially encoded.*3 related RuleSpec files are available/i
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/subsections have a RuleSpec encoding/i)
    ).not.toBeInTheDocument();
    // Each related encoding links to the canonical rule page but is
    // labelled as an encoding path, not as a source-tree subsection.
    expect(screen.getByText("us/statute/26/3101/a").closest("a")).toHaveAttribute(
      "href",
      "/us/statute/26/3101/a"
    );
    expect(screen.getByText("statutes/26/3101/a.yaml")).toBeInTheDocument();
    expect(screen.getByText("us/statute/26/3101/b/1").closest("a")).toHaveAttribute(
      "href",
      "/us/statute/26/3101/b/1"
    );
    expect(screen.queryByText("(a)")).not.toBeInTheDocument();
  });

  it("falls back to the bare 'Not yet encoded' state when no descendants are encoded either", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tree: [] }),
    });
    vi.stubGlobal(
      "fetch",
      fetchMock
    );
    render(
      <RuleSpecTab
        encoding={null}
        loading={false}
        jurisdiction="us"
        citationPath="us/statute/26/9999"
      />
    );
    expect(screen.getByText(/Not yet encoded/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Available RuleSpec encodings/i)
    ).toBeNull();
  });

  it("shows a repealed-specific empty state when no encoding or descendants exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tree: [] }),
    });
    vi.stubGlobal(
      "fetch",
      fetchMock
    );
    render(
      <RuleSpecTab
        encoding={null}
        loading={false}
        jurisdiction="us"
        citationPath="us/statute/26/1400L...1400U–3"
        isRepealed
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Repealed provision")).toBeInTheDocument();
    expect(
      screen.getByText(/No active RuleSpec encoding is shown/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Not yet encoded/i)).toBeNull();
  });

  it("anchors each rule by name so cross-rule links scroll into view", () => {
    render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: TWO_RULES_DOC })}
        loading={false}
        jurisdiction="us"
      />
    );
    // Each rule renders as an article anchored at #rule-<name> so the
    // jurisdiction-level URL hash drops the reader into the right card.
    expect(document.getElementById("rule-rate")).not.toBeNull();
    expect(document.getElementById("rule-tax")).not.toBeNull();
  });

  it("handles an empty input/output table without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          `- name: bare
  output:
    tax: 0
`,
      })
    );
    render(
      <RuleSpecTab
        encoding={makeEncoding({ rulespec_content: TWO_RULES_DOC })}
        loading={false}
        jurisdiction="us"
      />
    );
    expandAllRuleCards();
    await waitFor(() =>
      expect(screen.getByText(/^\(1\)$/)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /Tests/i }));
    // The empty-input branch renders a ∅ glyph.
    expect(screen.getByText("∅")).toBeInTheDocument();
  });
});
