import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetchEncodedFile } = vi.hoisted(() => ({
  mockFetchEncodedFile: vi.fn(),
}));

vi.mock("./repo-listing", () => ({
  fetchEncodedFile: mockFetchEncodedFile,
}));

import {
  SYNTHESISED_ID_PREFIX,
  citationPathFromSynthesisedId,
  isSynthesisedRuleId,
  synthesisedRuleId,
  synthesiseRuleFromCitationPath,
} from "./synth-rule";

describe("synthesisedRuleId helpers", () => {
  it("round-trips a citation_path through the prefix", () => {
    const id = synthesisedRuleId("us/statute/26/3101/a");
    expect(id).toBe(`${SYNTHESISED_ID_PREFIX}us/statute/26/3101/a`);
    expect(isSynthesisedRuleId(id)).toBe(true);
    expect(citationPathFromSynthesisedId(id)).toBe("us/statute/26/3101/a");
  });

  it("rejects non-prefixed ids", () => {
    expect(isSynthesisedRuleId("real-uuid")).toBe(false);
    expect(citationPathFromSynthesisedId("real-uuid")).toBeNull();
  });
});

describe("synthesiseRuleFromCitationPath", () => {
  beforeEach(() => {
    mockFetchEncodedFile.mockReset();
  });

  it("returns null when no YAML exists at the citation path", async () => {
    mockFetchEncodedFile.mockResolvedValue(null);
    const out = await synthesiseRuleFromCitationPath(
      "us",
      "us/statute/26/9999/z"
    );
    expect(out).toBeNull();
  });

  it("derives the heading from the module summary's first sentence", async () => {
    mockFetchEncodedFile.mockResolvedValue({
      filePath: "statutes/26/3101/a.yaml",
      content: `format: rulespec/v1
module:
  summary: |-
    Internal Revenue Code §3101(a) imposes a 6.2 percent OASDI tax. More text.
rules:
  - name: oasdi_wage_tax_rate
    versions:
      - effective_from: '1990-01-01'
        formula: '0.062'
`,
    });
    const out = await synthesiseRuleFromCitationPath(
      "us",
      "us/statute/26/3101/a"
    );
    expect(out?.heading).toBe(
      "Internal Revenue Code §3101(a) imposes a 6.2 percent OASDI tax"
    );
    expect(out?.body).toBe(
      "Internal Revenue Code §3101(a) imposes a 6.2 percent OASDI tax. More text."
    );
  });

  it("joins hard-wrapped literal-block summaries instead of stopping at the first line", async () => {
    mockFetchEncodedFile.mockResolvedValue({
      filePath: "policies/govuk/disability-living-allowance.yaml",
      content: `format: rulespec/v1
module:
  summary: |-
    Disability living allowance for children as described by GOV.UK guidance: a
    weekly amount for a child under 16.
rules: []
`,
    });
    const out = await synthesiseRuleFromCitationPath(
      "uk",
      "uk/policy/govuk/disability-living-allowance"
    );
    expect(out?.heading).toBe(
      "Disability living allowance for children as described by GOV.UK guidance: a weekly amount for a child under 16."
    );
  });

  it("falls back to the first rule's name when there is no summary", async () => {
    mockFetchEncodedFile.mockResolvedValue({
      filePath: "statutes/26/3101/a.yaml",
      content: `format: rulespec/v1
rules:
  - name: oasdi_wage_tax_rate
    versions:
      - effective_from: '1990-01-01'
        formula: '0.062'
`,
    });
    const out = await synthesiseRuleFromCitationPath(
      "us",
      "us/statute/26/3101/a"
    );
    expect(out?.heading).toBe("oasdi_wage_tax_rate");
  });

  it("ellipsises a long single-sentence summary instead of truncating mid-word", async () => {
    const long = "x".repeat(200);
    mockFetchEncodedFile.mockResolvedValue({
      filePath: "f.yaml",
      content: `format: rulespec/v1
module:
  summary: |
    ${long}
rules: []
`,
    });
    const out = await synthesiseRuleFromCitationPath("us", "us/statute/x");
    expect(out?.heading?.endsWith("…")).toBe(true);
    expect(out?.heading?.length).toBeLessThanOrEqual(120);
  });

  it("falls back to a generic heading when neither summary nor rules exist", async () => {
    mockFetchEncodedFile.mockResolvedValue({
      filePath: "f.yaml",
      content: "format: rulespec/v1\nrules: []\n",
    });
    const out = await synthesiseRuleFromCitationPath("us", "us/statute/x");
    expect(out?.heading).toBe("Encoded rule");
  });

  it("populates citation_path, jurisdiction, rulespec_path, and the synth id", async () => {
    mockFetchEncodedFile.mockResolvedValue({
      filePath: "statutes/26/3101/a.yaml",
      content: "format: rulespec/v1\nrules: []\n",
    });
    const out = await synthesiseRuleFromCitationPath(
      "us",
      "us/statute/26/3101/a"
    );
    expect(out).toMatchObject({
      id: "github:us/statute/26/3101/a",
      jurisdiction: "us",
      doc_type: "statute",
      citation_path: "us/statute/26/3101/a",
      rulespec_path: "statutes/26/3101/a.yaml",
      has_rulespec: true,
      parent_id: null,
      body: null,
    });
  });

  it("derives a sensible doc_type for non-statute paths", async () => {
    mockFetchEncodedFile.mockResolvedValue({
      filePath: "regulations/7/273.yaml",
      content: "format: rulespec/v1\nrules: []\n",
    });
    const out = await synthesiseRuleFromCitationPath(
      "us",
      "us/regulation/7/273"
    );
    expect(out?.doc_type).toBe("regulation");
  });
});
