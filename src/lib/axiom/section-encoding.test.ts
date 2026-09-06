import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getRuleEncodingMock,
  findEncodedDescendantsMock,
  fetchEncodedFileMock,
  mirrorFromMock,
} = vi.hoisted(() => ({
  getRuleEncodingMock: vi.fn(),
  findEncodedDescendantsMock: vi.fn(),
  fetchEncodedFileMock: vi.fn(),
  mirrorFromMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getRuleEncoding: getRuleEncodingMock,
  supabaseEncodings: { from: mirrorFromMock },
}));
vi.mock("@/lib/axiom/rulespec/repo-listing", () => ({
  findEncodedDescendants: findEncodedDescendantsMock,
  fetchEncodedFile: fetchEncodedFileMock,
}));

import { getSectionEncoding } from "./section-encoding";
import { parseRuleSpec } from "@/lib/axiom/rulespec/doc";

function ruleYaml(name: string, source: string): string {
  return [
    "format: rulespec/v1",
    "rules:",
    `  - name: ${name}`,
    "    kind: derived",
    `    source: ${source}`,
    "    versions:",
    "      - effective_from: '2026-01-01'",
    "        formula: 'x'",
  ].join("\n");
}

/** Policy-rooted module whose singular source IS ``sourcePath`` —
 *  every rule in it counts as encoded from that provision. */
function citedByYaml(names: string[], sourcePath: string): string {
  return [
    "format: rulespec/v1",
    "module:",
    "  source_verification:",
    `    corpus_citation_path: ${sourcePath}`,
    "rules:",
    ...names.flatMap((name) => [
      `  - name: ${name}`,
      "    kind: derived",
      `    source: ${sourcePath}`,
      "    versions:",
      "      - effective_from: '2026-01-01'",
      "        formula: 'x'",
    ]),
  ].join("\n");
}

function citationRuleYaml(name: string, source = "26 USC 32(a)"): string {
  return [
    `- name: ${name}`,
    "  kind: derived",
    `  source: ${source}`,
    "  versions:",
    "    - effective_from: '2026-01-01'",
    "      formula: 'x'",
  ].join("\n");
}

function ruleCitationRow({
  moduleCitationPath,
  filePath,
  ruleName,
  rank,
  atomKinds = [],
  isModuleSource = false,
}: {
  moduleCitationPath: string;
  filePath?: string;
  ruleName: string;
  rank: 0 | 1 | 2 | 3;
  atomKinds?: string[];
  isModuleSource?: boolean;
}) {
  return {
    module_citation_path: moduleCitationPath,
    file_path:
      filePath ??
      `policies/${moduleCitationPath.split("/").slice(2).join("/")}.yaml`,
    rule_name: ruleName,
    is_module_source: isModuleSource,
    atom_kinds: atomKinds,
    rank,
    rule_yaml: citationRuleYaml(ruleName),
  };
}

function encodingRow(filePath: string, content: string) {
  return {
    encoding_run_id: "run-1",
    citation: "26 USC 32",
    session_id: null,
    file_path: filePath,
    rulespec_content: content,
    final_scores: null,
    iterations: null,
    total_duration_ms: null,
    agent_type: "encoder",
    agent_model: null,
    data_source: null,
    has_issues: null,
    note: null,
    timestamp: null,
    encoder_version: null,
  };
}

const SECTION = "us/statute/26/32";

type MirrorResult = { data: unknown; error: unknown; count?: number | null };
type MirrorQueryKind =
  | "path"
  | "ruleCitations"
  | "citedByFallback"
  | "ancestor";

const mirrorQueryCalls: Array<{
  kind: MirrorQueryKind;
  method: string;
  args: unknown[];
}> = [];

/** Chainable PostgREST stub that routes by table and query filter.
 *  The rule-level lookup and the whole-file rollout fallback must be
 *  independently observable even though both run beside the path scan. */
function mirrorChain(
  table: string,
  results: Record<MirrorQueryKind, MirrorResult>,
) {
  let kind: MirrorQueryKind =
    table === "rule_citations" ? "ruleCitations" : "path";
  const self: Record<string, unknown> = {};
  self.select = (...args: unknown[]) => {
    mirrorQueryCalls.push({ kind, method: "select", args });
    return self;
  };
  self.or = (...args: unknown[]) => {
    kind = "path";
    mirrorQueryCalls.push({ kind, method: "or", args });
    return self;
  };
  self.eq = (...args: unknown[]) => {
    kind = "ruleCitations";
    mirrorQueryCalls.push({ kind, method: "eq", args });
    return self;
  };
  self.contains = (...args: unknown[]) => {
    kind = "citedByFallback";
    mirrorQueryCalls.push({ kind, method: "contains", args });
    return self;
  };
  self.in = (...args: unknown[]) => {
    kind = "ancestor";
    mirrorQueryCalls.push({ kind, method: "in", args });
    return self;
  };
  // Visibility exclusion — a filter, not a router: it must not change
  // which canned result the chain resolves to.
  self.not = (...args: unknown[]) => {
    mirrorQueryCalls.push({ kind, method: "not", args });
    return self;
  };
  for (const method of ["order", "limit"]) {
    self[method] = (...args: unknown[]) => {
      mirrorQueryCalls.push({ kind, method, args });
      return self;
    };
  }
  self.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(results[kind]).then(resolve, reject);
  return self;
}

function configureMirror({
  path = { data: [], error: null },
  ruleCitations = { data: [], error: null, count: 0 },
  citedByFallback = { data: [], error: null, count: 0 },
  ancestor = { data: [], error: null },
}: Partial<Record<MirrorQueryKind, MirrorResult>> = {}) {
  const results = { path, ruleCitations, citedByFallback, ancestor };
  mirrorFromMock.mockImplementation((table: string) =>
    mirrorChain(table, results),
  );
}

function mirrorRows(
  rows: Array<{ citation_path: string; file_path: string; raw_yaml: string }>,
) {
  configureMirror({ path: { data: rows, error: null } });
}

describe("getSectionEncoding", () => {
  beforeEach(() => {
    getRuleEncodingMock.mockReset();
    findEncodedDescendantsMock.mockReset();
    fetchEncodedFileMock.mockReset();
    mirrorFromMock.mockReset();
    mirrorQueryCalls.length = 0;
    // Default: mirror is empty → the legacy path drives the test.
    configureMirror();
  });

  it("passes the primary encoding through when there are no descendant files", async () => {
    const primary = encodingRow(
      "statutes/26/32.yaml",
      ruleYaml("eitc_amount", "26 USC 32(a)"),
    );
    getRuleEncodingMock.mockResolvedValue(primary);
    findEncodedDescendantsMock.mockResolvedValue([]);

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.encoding).toBe(primary);
    expect(result.fileAnchors).toEqual({});
    expect(result.citedByFiles).toEqual([]);
    expect(fetchEncodedFileMock).not.toHaveBeenCalled();
  });

  it("serves a lone descendant file directly when there is no primary (7/2017 layout)", async () => {
    getRuleEncodingMock.mockResolvedValue(null);
    findEncodedDescendantsMock.mockResolvedValue([
      {
        filePath: "statutes/7/2017/a.yaml",
        citationPath: "us/statute/7/2017/a",
        bucket: "statutes",
      },
    ]);
    fetchEncodedFileMock.mockResolvedValue({
      filePath: "statutes/7/2017/a.yaml",
      content: ruleYaml("snap_allotment", "7 USC 2017(a)"),
    });

    const result = await getSectionEncoding("rule-1", "us/statute/7/2017");
    expect(result.encoding?.file_path).toBe("statutes/7/2017/a.yaml");
    expect(result.encoding?.encoding_run_id).toBe(
      "github:statutes/7/2017/a.yaml",
    );
    expect(result.encoding?.rulespec_content).toContain("snap_allotment");
    expect(result.fileAnchors).toEqual({ snap_allotment: ["a"] });
  });

  it("merges primary and descendant rules into one parseable doc (26/32 layout)", async () => {
    getRuleEncodingMock.mockResolvedValue(
      encodingRow(
        "statutes/26/32.yaml",
        ruleYaml("eitc_amount", "26 USC 32(a)"),
      ),
    );
    findEncodedDescendantsMock.mockResolvedValue([
      {
        filePath: "statutes/26/32/c/2.yaml",
        citationPath: "us/statute/26/32/c/2",
        bucket: "statutes",
      },
    ]);
    fetchEncodedFileMock.mockResolvedValue({
      filePath: "statutes/26/32/c/2.yaml",
      content: ruleYaml("earned_income", "26 USC 32(c)(2)"),
    });

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.encoding?.encoding_run_id).toBe(`github:merged:${SECTION}`);
    expect(result.encoding?.file_path).toBe("statutes/26/32");
    const doc = parseRuleSpec(result.encoding!.rulespec_content!);
    expect(doc.parseErrors).toEqual([]);
    expect(doc.rules.map((rule) => rule.name)).toEqual([
      "eitc_amount",
      "earned_income",
    ]);
    expect(result.fileAnchors).toEqual({ earned_income: ["c"] });
    // Primary run metadata survives the merge.
    expect(result.encoding?.agent_type).toBe("encoder");
  });

  it("dedupes rules present in both primary and descendant files", async () => {
    getRuleEncodingMock.mockResolvedValue(
      encodingRow(
        "statutes/26/32.yaml",
        ruleYaml("eitc_amount", "26 USC 32(a)"),
      ),
    );
    findEncodedDescendantsMock.mockResolvedValue([
      {
        filePath: "statutes/26/32/a.yaml",
        citationPath: "us/statute/26/32/a",
        bucket: "statutes",
      },
    ]);
    fetchEncodedFileMock.mockResolvedValue({
      filePath: "statutes/26/32/a.yaml",
      content: ruleYaml("eitc_amount", "26 USC 32(a)"),
    });

    const result = await getSectionEncoding("rule-1", SECTION);
    // Duplicate name adds no new rules → primary passes through.
    expect(result.encoding?.encoding_run_id).toBe("run-1");
    expect(result.fileAnchors).toEqual({ eitc_amount: ["a"] });
  });

  it("keeps the primary when every descendant fetch fails", async () => {
    const primary = encodingRow(
      "statutes/26/32.yaml",
      ruleYaml("eitc_amount", "26 USC 32(a)"),
    );
    getRuleEncodingMock.mockResolvedValue(primary);
    findEncodedDescendantsMock.mockResolvedValue([
      {
        filePath: "statutes/26/32/c/2.yaml",
        citationPath: "us/statute/26/32/c/2",
        bucket: "statutes",
      },
    ]);
    fetchEncodedFileMock.mockRejectedValue(new Error("rate limited"));

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.encoding).toBe(primary);
  });

  it("returns null encoding when nothing exists anywhere", async () => {
    getRuleEncodingMock.mockResolvedValue(null);
    findEncodedDescendantsMock.mockResolvedValue([]);
    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.encoding).toBeNull();
  });

  it("serves the mirror without touching legacy sources when synced", async () => {
    mirrorRows([
      {
        citation_path: SECTION,
        file_path: "statutes/26/32.yaml",
        raw_yaml: ruleYaml("eitc_amount", "26 USC 32(a)"),
      },
      {
        citation_path: `${SECTION}/c/2`,
        file_path: "statutes/26/32/c/2.yaml",
        raw_yaml: ruleYaml("earned_income", "26 USC 32(c)(2)"),
      },
    ]);

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.encoding?.encoding_run_id).toBe(`github:merged:${SECTION}`);
    const doc = parseRuleSpec(result.encoding!.rulespec_content!);
    expect(doc.rules.map((rule) => rule.name)).toEqual([
      "eitc_amount",
      "earned_income",
    ]);
    expect(result.fileAnchors).toEqual({ earned_income: ["c"] });
    // Each rule's home file survives the merge.
    expect(result.ruleFiles).toEqual({
      eitc_amount: "statutes/26/32.yaml",
      earned_income: "statutes/26/32/c/2.yaml",
    });
    // Mirror hit → no telemetry lookup, no GitHub reads.
    expect(getRuleEncodingMock).not.toHaveBeenCalled();
    expect(findEncodedDescendantsMock).not.toHaveBeenCalled();
    expect(fetchEncodedFileMock).not.toHaveBeenCalled();
  });

  it("serves a lone mirror file directly with its real path", async () => {
    mirrorRows([
      {
        citation_path: "us/statute/7/2017/a",
        file_path: "statutes/7/2017/a.yaml",
        raw_yaml: ruleYaml("snap_allotment", "7 USC 2017(a)"),
      },
    ]);
    const result = await getSectionEncoding("rule-1", "us/statute/7/2017");
    expect(result.encoding?.file_path).toBe("statutes/7/2017/a.yaml");
    expect(result.encoding?.encoding_run_id).toBe(
      "github:statutes/7/2017/a.yaml",
    );
    expect(result.fileAnchors).toEqual({ snap_allotment: ["a"] });
    expect(result.ruleFiles).toEqual({
      snap_allotment: "statutes/7/2017/a.yaml",
    });
    expect(result.citedByFiles).toEqual([]);
  });

  it("assembles indexed rules by module in materialized rank order", async () => {
    const linesModule =
      "us/policy/usitc/us-tariff-duty/lines/generated/ch22";
    const linesFile =
      "policies/usitc/us-tariff-duty/lines/generated/ch22.yaml";
    const compositionModule = "us/policy/cbp/us-tariff-duty/composition";
    const compositionFile = "policies/cbp/us-tariff-duty/composition.yaml";
    configureMirror({
      path: {
        data: [
          {
            citation_path: SECTION,
            file_path: "statutes/26/32.yaml",
            raw_yaml: ruleYaml("eitc_amount", "26 USC 32(a)"),
          },
        ],
        error: null,
      },
      ruleCitations: {
        data: [
          ruleCitationRow({
            moduleCitationPath: linesModule,
            filePath: linesFile,
            ruleName: "ch22_general_rate",
            rank: 1,
            atomKinds: ["value"],
          }),
          ruleCitationRow({
            moduleCitationPath: compositionModule,
            filePath: compositionFile,
            ruleName: "computed_overlay",
            rank: 2,
            atomKinds: ["formula"],
          }),
          ruleCitationRow({
            moduleCitationPath: linesModule,
            filePath: linesFile,
            ruleName: "ch22_guard",
            rank: 3,
            atomKinds: ["condition", "predicate"],
          }),
        ],
        count: 3,
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(
      parseRuleSpec(result.encoding!.rulespec_content!).rules.map(
        (rule) => rule.name,
      ),
    ).toEqual([
      "eitc_amount",
      "ch22_general_rate",
      "computed_overlay",
      "ch22_guard",
    ]);
    expect(result.citedByFiles).toEqual([
      {
        citationPath: linesModule,
        filePath: linesFile,
        rules: [
          {
            renderedName: "ch22_general_rate",
            canonicalName: "ch22_general_rate",
            rank: 1,
            atomKinds: ["value"],
          },
          {
            renderedName: "ch22_guard",
            canonicalName: "ch22_guard",
            rank: 3,
            atomKinds: ["condition", "predicate"],
          },
        ],
      },
      {
        citationPath: compositionModule,
        filePath: compositionFile,
        rules: [
          {
            renderedName: "computed_overlay",
            canonicalName: "computed_overlay",
            rank: 2,
            atomKinds: ["formula"],
          },
        ],
      },
    ]);
    expect(
      mirrorQueryCalls.filter((call) => call.kind === "ruleCitations"),
    ).toEqual([
      {
        kind: "ruleCitations",
        method: "select",
        args: [
          "module_citation_path, file_path, rule_name, is_module_source, atom_kinds, rank, rule_yaml",
          { count: "exact" },
        ],
      },
      // Gated families are excluded before the exact count is taken,
      // so the reported overflow describes only showable rules.
      {
        kind: "ruleCitations",
        method: "not",
        args: ["module_citation_path", "like", "il/%"],
      },
      {
        kind: "ruleCitations",
        method: "not",
        args: ["module_citation_path", "like", "il-%"],
      },
      {
        kind: "ruleCitations",
        method: "eq",
        args: ["citation_path", SECTION],
      },
      {
        kind: "ruleCitations",
        method: "order",
        args: ["rank", { ascending: true }],
      },
      {
        kind: "ruleCitations",
        method: "order",
        args: ["module_citation_path", { ascending: true }],
      },
      {
        kind: "ruleCitations",
        method: "order",
        args: ["rule_name", { ascending: true }],
      },
      {
        kind: "ruleCitations",
        method: "limit",
        args: [120],
      },
    ]);
    expect(
      mirrorQueryCalls.some((call) => call.kind === "citedByFallback"),
    ).toBe(false);
  });

  it("renders every same-basename state SNAP collision with a stable full slug", async () => {
    const jurisdictions = ["us-co", "us-ga", "us-md", "us-ny"];
    const canonicalName = "snap_maximum_allotment";
    configureMirror({
      ruleCitations: {
        data: jurisdictions.map((jurisdiction) =>
          ruleCitationRow({
            moduleCitationPath: `${jurisdiction}/policy/snap/fy-2026-benefit-calculation`,
            filePath: `policies/${jurisdiction}/snap/fy-2026-benefit-calculation.yaml`,
            ruleName: canonicalName,
            rank: 0,
            isModuleSource: true,
          }),
        ),
        count: 4,
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", SECTION);
    const renderedNames = [
      canonicalName,
      `${canonicalName}@policy.snap.fy-2026-benefit-calculation`,
      `${canonicalName}@policy.snap.fy-2026-benefit-calculation#2`,
      `${canonicalName}@policy.snap.fy-2026-benefit-calculation#3`,
    ];
    expect(
      parseRuleSpec(result.encoding!.rulespec_content!).rules.map(
        (rule) => rule.name,
      ),
    ).toEqual(renderedNames);
    expect(result.citedByFiles).toHaveLength(4);
    expect(
      result.citedByFiles.flatMap((file) =>
        file.rules.map((rule) => rule.renderedName),
      ),
    ).toEqual(renderedNames);
    expect(
      result.citedByFiles.flatMap((file) =>
        file.rules.map((rule) => rule.canonicalName),
      ),
    ).toEqual(Array(4).fill(canonicalName));
    expect(Object.keys(result.ruleFiles)).toEqual(renderedNames);
  });

  it("computes rule overflow from the exact index count", async () => {
    configureMirror({
      ruleCitations: {
        data: [
          ruleCitationRow({
            moduleCitationPath: "us/policy/a/one",
            ruleName: "one_rule",
            rank: 1,
            atomKinds: ["value"],
          }),
          ruleCitationRow({
            moduleCitationPath: "us/policy/a/two",
            ruleName: "two_rule",
            rank: 3,
            atomKinds: ["condition"],
          }),
        ],
        count: 206,
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.citedByFiles).toHaveLength(2);
    expect(result.citedByOverflow).toBe(204);
  });

  it("uses the whole-file value path fallback only when the rule index errors", async () => {
    const fallbackModule = "us/policy/cbp/us-tariff-duty/composition";
    const fallbackFile = "policies/cbp/us-tariff-duty/composition.yaml";
    configureMirror({
      ruleCitations: {
        data: null,
        error: { message: "rule_citations is unavailable" },
      },
      citedByFallback: {
        data: [
          {
            citation_path: fallbackModule,
            file_path: fallbackFile,
            raw_yaml: citedByYaml(
              ["fallback_value", "fallback_condition"],
              SECTION,
            ),
          },
        ],
        count: 1,
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.citedByFiles).toEqual([
      {
        citationPath: fallbackModule,
        filePath: fallbackFile,
        rules: [
          {
            renderedName: "fallback_condition",
            canonicalName: "fallback_condition",
            rank: 0,
            atomKinds: [],
          },
          {
            renderedName: "fallback_value",
            canonicalName: "fallback_value",
            rank: 0,
            atomKinds: [],
          },
        ],
      },
    ]);
    expect(
      mirrorQueryCalls.filter((call) => call.kind === "citedByFallback"),
    ).toEqual([
      {
        kind: "citedByFallback",
        method: "contains",
        args: ["value_citation_paths", [SECTION]],
      },
      {
        kind: "citedByFallback",
        method: "order",
        args: ["citation_path", { ascending: true }],
      },
      {
        kind: "citedByFallback",
        method: "limit",
        args: [60],
      },
    ]);
  });

  it("keeps the path-matched encoding when both citation lookups fail", async () => {
    configureMirror({
      path: {
        data: [
          {
            citation_path: SECTION,
            file_path: "statutes/26/32.yaml",
            raw_yaml: ruleYaml("eitc_amount", "26 USC 32(a)"),
          },
        ],
        error: null,
      },
      ruleCitations: {
        data: null,
        error: { message: "rule table unavailable" },
      },
      citedByFallback: {
        data: null,
        error: { message: "array lookup unavailable" },
      },
    });

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.citedByFiles).toEqual([]);
    expect(
      parseRuleSpec(result.encoding!.rulespec_content!).rules.map(
        (rule) => rule.name,
      ),
    ).toEqual(["eitc_amount"]);
  });

  it("serves indexed citing rules when the path range is empty", async () => {
    const tariffPath = "us/statute/hts/2203.00.00";
    const policyCitation =
      "us/policy/usitc/us-tariff-duty/lines/generated/ch22";
    const policyFile =
      "policies/usitc/us-tariff-duty/lines/generated/ch22.yaml";
    configureMirror({
      ruleCitations: {
        data: [
          ruleCitationRow({
            moduleCitationPath: policyCitation,
            filePath: policyFile,
            ruleName: "ch22_general_rate",
            rank: 1,
            atomKinds: ["value"],
          }),
        ],
        count: 1,
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", tariffPath);
    expect(result.encodingRootPath).toBe(tariffPath);
    expect(
      parseRuleSpec(result.encoding!.rulespec_content!).rules.map(
        (rule) => rule.name,
      ),
    ).toEqual(["ch22_general_rate"]);
    expect(result.ruleFiles).toEqual({ ch22_general_rate: policyFile });
    expect(result.citedByFiles[0]).toEqual({
      citationPath: policyCitation,
      filePath: policyFile,
      rules: [
        {
          renderedName: "ch22_general_rate",
          canonicalName: "ch22_general_rate",
          rank: 1,
          atomKinds: ["value"],
        },
      ],
    });
    expect(getRuleEncodingMock).not.toHaveBeenCalled();
    expect(findEncodedDescendantsMock).not.toHaveBeenCalled();
  });

  it("excludes indexed rows whose file path is already path-matched", async () => {
    const content = ruleYaml("eitc_amount", "26 USC 32(a)");
    const pathFile = "statutes/26/32.yaml";
    configureMirror({
      path: {
        data: [
          {
            citation_path: SECTION,
            file_path: pathFile,
            raw_yaml: content,
          },
        ],
        error: null,
      },
      ruleCitations: {
        data: [
          ruleCitationRow({
            moduleCitationPath: "us/policy/reindexed/module",
            filePath: pathFile,
            ruleName: "duplicate_index_row",
            rank: 3,
            atomKinds: ["condition"],
          }),
        ],
        count: 1,
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.citedByFiles).toEqual([]);
    expect(result.encoding?.file_path).toBe(pathFile);
    expect(result.encoding?.rulespec_content).toBe(content);
    expect(result.ruleFiles).toEqual({ eitc_amount: pathFile });
  });

  it("falls back to the legacy path when the mirror query fails", async () => {
    mirrorFromMock.mockImplementation(() => {
      throw new Error("schema missing");
    });
    const primary = encodingRow(
      "statutes/26/32.yaml",
      ruleYaml("eitc_amount", "26 USC 32(a)"),
    );
    getRuleEncodingMock.mockResolvedValue(primary);
    findEncodedDescendantsMock.mockResolvedValue([]);
    const result = await getSectionEncoding("rule-1", SECTION);
    expect(result.encoding).toBe(primary);
  });
});

describe("ancestor walk-up (request deeper than the encoded file)", () => {
  it("serves the nearest ancestor module and reports its root path", async () => {
    // First query (at-or-below the deep path): nothing. Second query
    // (ancestor chain): the section-level 273/10 module.
    const sectionYaml = ruleYaml(
      "snap_calculated_monthly_allotment_before_minimums",
      "7 CFR 273.10(e)(2)(ii)(A)",
    );
    configureMirror({
      ancestor: {
        data: [
          {
            citation_path: "us/regulation/7/273/10",
            file_path: "regulations/7-cfr/273/10.yaml",
            raw_yaml: sectionYaml,
          },
        ],
        error: null,
      },
    });

    const result = await getSectionEncoding(
      "rule-1",
      "us/regulation/7/273/10/e/2/ii/A",
    );
    expect(result.encodingRootPath).toBe("us/regulation/7/273/10");
    expect(result.encoding?.file_path).toBe("regulations/7-cfr/273/10.yaml");
    expect(result.encoding?.rulespec_content).toContain(
      "snap_calculated_monthly_allotment_before_minimums",
    );
  });

  it("merges ancestor rules citing a deep path with the files below it", async () => {
    // /us/statute/26/32/c: earned_income lives in 32/c/2.yaml below the
    // path, eitc_qualifying_child cites 32(c)(3) from the section file
    // above it. Both must reach the rail, each with the right anchor.
    configureMirror({
      path: {
        data: [
          {
            citation_path: `${SECTION}/c/2`,
            file_path: "statutes/26/32/c/2.yaml",
            raw_yaml: ruleYaml("earned_income", "26 USC 32(c)(2)(A)"),
          },
        ],
        error: null,
      },
      ancestor: {
        data: [
          {
            citation_path: SECTION,
            file_path: "statutes/26/32.yaml",
            raw_yaml: [
              ruleYaml("eitc_qualifying_child", "26 USC 32(c)(3)"),
              "  - name: eitc_amount",
              "    kind: derived",
              "    source: 26 USC 32(a)",
              "    versions:",
              "      - effective_from: '2026-01-01'",
              "        formula: 'x'",
            ].join("\n"),
          },
        ],
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", `${SECTION}/c`);
    const doc = parseRuleSpec(result.encoding!.rulespec_content!);
    expect(doc.rules.map((rule) => rule.name)).toEqual([
      "earned_income",
      "eitc_qualifying_child",
    ]);
    expect(result.fileAnchors).toEqual({
      earned_income: ["2"],
      eitc_qualifying_child: ["3"],
    });
    expect(result.ruleFiles).toEqual({
      earned_income: "statutes/26/32/c/2.yaml",
      eitc_qualifying_child: "statutes/26/32.yaml",
    });
    // The rules join at the requested path, not the ancestor's.
    expect(result.encodingRootPath).toBe(`${SECTION}/c`);
  });

  it("merges dotted CFR ancestor citations with deep descendant files", async () => {
    const regulation = "us/regulation/7/273/9";
    configureMirror({
      path: {
        data: [
          {
            citation_path: `${regulation}/d/6/iii`,
            file_path: "regulations/7-cfr/273/9/d/6/iii.yaml",
            raw_yaml: ruleYaml("homeless_shelter", "7 CFR 273.9(d)(6)(iii)"),
          },
        ],
        error: null,
      },
      ancestor: {
        data: [
          {
            citation_path: regulation,
            file_path: "regulations/7-cfr/273/9.yaml",
            raw_yaml: ruleYaml("standard_deduction", "7 CFR 273.9(d)(1)"),
          },
        ],
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", `${regulation}/d`);
    const doc = parseRuleSpec(result.encoding!.rulespec_content!);
    expect(doc.rules.map((rule) => rule.name)).toEqual([
      "homeless_shelter",
      "standard_deduction",
    ]);
    expect(result.fileAnchors).toEqual({
      homeless_shelter: ["6"],
      standard_deduction: ["1"],
    });
  });

  it("keeps serving a lone descendant directly when the ancestor has no citing rules", async () => {
    configureMirror({
      path: {
        data: [
          {
            citation_path: `${SECTION}/c/2`,
            file_path: "statutes/26/32/c/2.yaml",
            raw_yaml: ruleYaml("earned_income", "26 USC 32(c)(2)(A)"),
          },
        ],
        error: null,
      },
      ancestor: {
        data: [
          {
            citation_path: SECTION,
            file_path: "statutes/26/32.yaml",
            raw_yaml: ruleYaml("eitc_amount", "26 USC 32(a)"),
          },
        ],
        error: null,
      },
    });

    const result = await getSectionEncoding("rule-1", `${SECTION}/c`);
    expect(result.encoding?.encoding_run_id).toBe(
      "github:statutes/26/32/c/2.yaml",
    );
    expect(result.fileAnchors).toEqual({ earned_income: ["2"] });
  });

  it("falls through to the legacy path when no ancestor file exists", async () => {
    configureMirror();
    getRuleEncodingMock.mockResolvedValue(null);
    findEncodedDescendantsMock.mockResolvedValue([]);
    const result = await getSectionEncoding("rule-1", "us/statute/26/32/a");
    expect(result.encoding).toBeNull();
    expect(result.encodingRootPath).toBeNull();
  });
});

describe("registered app_visibility gate", () => {
  beforeEach(() => {
    getRuleEncodingMock.mockReset();
    findEncodedDescendantsMock.mockReset();
    fetchEncodedFileMock.mockReset();
    mirrorFromMock.mockReset();
    mirrorQueryCalls.length = 0;
    configureMirror();
  });

  const ISRAEL_SECTION = "il/statute/income-tax-ordinance/section-121";

  it("serves nothing for a gated family, even with a populated mirror row", async () => {
    // The defect this pins: the mirror is a second store for the same
    // encodings the GitHub readers already refuse, and it had no
    // visibility gate at all — so a leaked or pre-gating row served
    // rulespec-il's YAML through the reader.
    mirrorRows([
      {
        citation_path: ISRAEL_SECTION,
        file_path: "statutes/income-tax-ordinance/section-121.yaml",
        raw_yaml: ruleYaml("income_tax_liability", "פקודת מס הכנסה 121"),
      },
    ]);
    getRuleEncodingMock.mockResolvedValue(
      encodingRow(
        "statutes/income-tax-ordinance/section-121.yaml",
        ruleYaml("income_tax_liability", "פקודת מס הכנסה 121"),
      ),
    );

    const result = await getSectionEncoding("rule-il", ISRAEL_SECTION);

    expect(result).toEqual({
      encoding: null,
      encodingRootPath: null,
      fileAnchors: {},
      ruleFiles: {},
      citedByFiles: [],
      citedByOverflow: 0,
    });
    // Refused before any read — the mirror, the materialized citation
    // index, and the legacy encoding_runs/GitHub fallback alike.
    expect(mirrorFromMock).not.toHaveBeenCalled();
    expect(getRuleEncodingMock).not.toHaveBeenCalled();
    expect(findEncodedDescendantsMock).not.toHaveBeenCalled();
  });

  it("keeps a gated family's module off a public provision's page", async () => {
    // rule_citations is keyed by the CITED provision, so a gated
    // pilot module citing a US provision would otherwise render in
    // that section's "Encoded from this provision" group.
    configureMirror({
      ruleCitations: {
        data: [
          ruleCitationRow({
            moduleCitationPath: `${ISRAEL_SECTION}/credits`,
            ruleName: "israel_credit_points",
            rank: 0,
          }),
          ruleCitationRow({
            moduleCitationPath: "us/policy/usda/snap/fy-2026-cola",
            ruleName: "snap_benefit",
            rank: 0,
          }),
        ],
        error: null,
        count: 2,
      },
    });

    const result = await getSectionEncoding("rule-1", SECTION);

    expect(result.citedByFiles.map((file) => file.citationPath)).toEqual([
      "us/policy/usda/snap/fy-2026-cola",
    ]);
    // The exclusion is in the query as well, so the exact count the
    // overflow figure is derived from never included the gated rows.
    expect(
      mirrorQueryCalls.filter((call) => call.method === "not"),
    ).toEqual([
      {
        kind: "ruleCitations",
        method: "not",
        args: ["module_citation_path", "like", "il/%"],
      },
      {
        kind: "ruleCitations",
        method: "not",
        args: ["module_citation_path", "like", "il-%"],
      },
    ]);
  });

  it("drops a gated module from the whole-file cited-by fallback", async () => {
    configureMirror({
      ruleCitations: { data: null, error: { message: "no table" }, count: null },
      citedByFallback: {
        data: [
          {
            citation_path: `${ISRAEL_SECTION}/credits`,
            file_path: "statutes/income-tax-ordinance/section-121/credits.yaml",
            raw_yaml: citedByYaml(["israel_credit_points"], SECTION),
          },
          {
            citation_path: "us/policy/usda/snap/fy-2026-cola",
            file_path: "policies/usda/snap/fy-2026-cola.yaml",
            raw_yaml: citedByYaml(["snap_benefit"], SECTION),
          },
        ],
        error: null,
        count: 2,
      },
    });

    const result = await getSectionEncoding("rule-1", SECTION);

    expect(result.citedByFiles.map((file) => file.citationPath)).toEqual([
      "us/policy/usda/snap/fy-2026-cola",
    ]);
  });
});
