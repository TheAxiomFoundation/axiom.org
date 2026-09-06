import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchAxiom, searchEncodedRuleSpecs } from "./search";

const { mockSearchRules, mockFetchIndexedCandidates } = vi.hoisted(() => ({
  mockSearchRules: vi.fn(),
  mockFetchIndexedCandidates: vi.fn(),
}));
const mockFetch = vi.fn();

vi.mock("@/lib/supabase", () => ({
  searchRules: (...args: unknown[]) => mockSearchRules(...args),
}));
vi.mock("@/lib/axiom/rulespec-index", () => ({
  fetchIndexedRuleSpecCandidates: (...args: unknown[]) =>
    mockFetchIndexedCandidates(...args),
}));

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function textResponse(body: string) {
  return Promise.resolve(
    new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })
  );
}

function tree(paths: Array<{ path: string; type?: string }>) {
  return { tree: paths.map((entry) => ({ type: "blob", ...entry })) };
}

describe("axiom hybrid search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchRules.mockResolvedValue([]);
    // Default: index unavailable — exercises the GitHub fallback path.
    mockFetchIndexedCandidates.mockResolvedValue(null);
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockImplementation((url: string) => {
      if (
        url.includes(
          "raw.githubusercontent.com/TheAxiomFoundation/rulespec-us/main/us-co/policies/cdhs/snap/fy-2026-benefit-calculation.yaml"
        )
      ) {
        return textResponse(`format: rulespec/v1
module:
  summary: Colorado SNAP benefit calculation.
imports:
- us:policies/usda/snap/fy-2026-cola/deductions
- us:policies/usda/snap/fy-2026-cola/income-eligibility-standards
rules:
- name: shelter_costs
  kind: derived
  entity: Household
  dtype: Money
  source: Colorado SNAP FY 2026 benefit calculation composition
  versions:
  - effective_from: '2025-10-01'
    formula: household_shelter_costs_incurred + snap_standard_utility_allowance + snap_limited_utility_allowance
- name: snap_standard_utility_allowance
  kind: parameter
  entity: Household
  dtype: Money
  source: Colorado SNAP FY 2026 benefit calculation composition
  versions:
  - effective_from: '2025-10-01'
    formula: 490
- name: snap_limited_utility_allowance
  kind: parameter
  entity: Household
  dtype: Money
  source: Colorado SNAP FY 2026 benefit calculation composition
  versions:
  - effective_from: '2025-10-01'
    formula: 360
- name: snap_excess_shelter_deduction
  kind: derived
  entity: Household
  dtype: Money
  source: Colorado SNAP FY 2026 benefit calculation composition
  versions:
  - effective_from: '2025-10-01'
    formula: max(0, shelter_costs - snap_standard_deduction)
`);
      }
      if (url.includes("/orgs/TheAxiomFoundation/repos")) {
        return jsonResponse([
          { name: "rulespec-us", default_branch: "main" },
          { name: "rulespec-us-az", default_branch: "main" },
          { name: "rulespec-uk-kingston-upon-thames", default_branch: "main" },
          { name: "rulespec-be", default_branch: "main" },
          { name: "rulespec-nz", default_branch: "main" },
        ]);
      }
      if (url.endsWith("/repos/TheAxiomFoundation/rulespec-us/git/trees/main")) {
        return jsonResponse(
          tree([
            { path: "us", type: "tree" },
            { path: "us-co", type: "tree" },
          ])
        );
      }
      if (url.endsWith("/repos/TheAxiomFoundation/rulespec-us-az/git/trees/main")) {
        return jsonResponse(tree([{ path: "policies", type: "tree" }]));
      }
      if (
        url.endsWith(
          "/repos/TheAxiomFoundation/rulespec-uk-kingston-upon-thames/git/trees/main"
        )
      ) {
        return jsonResponse(tree([{ path: "policies", type: "tree" }]));
      }
      if (url.endsWith("/repos/TheAxiomFoundation/rulespec-be/git/trees/main")) {
        return jsonResponse(
          tree([
            { path: "be", type: "tree" },
            { path: "be-bru", type: "tree" },
          ])
        );
      }
      if (url.endsWith("/repos/TheAxiomFoundation/rulespec-nz/git/trees/main")) {
        return jsonResponse(tree([{ path: "nz", type: "tree" }]));
      }
      if (url.includes("/rulespec-us/git/trees/main:us-co?recursive=1")) {
        return jsonResponse(
          tree([
            {
              path: "policies/cdhs/snap/fy-2026-benefit-calculation.yaml",
            },
            {
              path: "policies/cdhs/snap/fy-2026-benefit-calculation.test.yaml",
            },
            {
              path: "policies/cdhs/colorado-works/basic-cash-assistance.yaml",
            },
          ])
        );
      }
      if (url.includes("/rulespec-us/git/trees/main:us?recursive=1")) {
        return jsonResponse(
          tree([
            { path: "policies/irs/rev-proc-2025-25/aca-ptc.yaml" },
            { path: "policies/irs/rev-proc-2025-32/child-tax-credit.yaml" },
            { path: "policies/usda/snap/fy-2026-cola/deductions.yaml" },
          ])
        );
      }
      if (url.includes("/rulespec-us-az/git/trees/main?recursive=1")) {
        return jsonResponse(
          tree([
            {
              path: "policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation.yaml",
            },
            {
              path: "policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation.test.yaml",
            },
            {
              path: "policies/des/faa5/na-eligibility-and-benefit-determination/gross-income-test.yaml",
            },
            {
              path: "policies/des/faa5/na-eligibility-and-benefit-determination/net-income-test.yaml",
            },
            {
              path: "policies/des/faa5/na-eligibility-and-benefit-determination/first-month-benefit-proration.yaml",
            },
            {
              path: "policies/des/faa5/ca-benefit-determination/payment-standard-test.yaml",
            },
            {
              path: "policies/des/faa5/automated-inquiry-and-match-procedures/page-1.yaml",
            },
          ])
        );
      }
      if (
        url.includes(
          "/rulespec-uk-kingston-upon-thames/git/trees/main?recursive=1"
        )
      ) {
        return jsonResponse(
          tree([
            {
              path: "policies/kingston-upon-thames/council-tax-reduction.yaml",
            },
          ])
        );
      }
      if (url.includes("/rulespec-be/git/trees/main:be?recursive=1")) {
        return jsonResponse(
          tree([
            {
              path: "statutes/social_security/workers/article_38_ordinary_worker_rates.yaml",
            },
            {
              path: "statutes/income_tax/individual/rate_scale.yaml",
            },
          ])
        );
      }
      if (url.includes("/rulespec-be/git/trees/main:be-bru?recursive=1")) {
        return jsonResponse(
          tree([{ path: "statutes/gift_tax/rate_scale.yaml" }])
        );
      }
      if (url.includes("/rulespec-nz/git/trees/main:nz?recursive=1")) {
        return jsonResponse(
          tree([
            { path: "statutes/income_tax/core/taxable_income.yaml" },
            {
              path: "statutes/social_security/accommodation_supplement/core.yaml",
            },
          ])
        );
      }
      return jsonResponse(tree([]));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ranks the encoded Colorado SNAP path for CO SNAP", async () => {
    const results = await searchAxiom("CO SNAP");

    expect(results.programs[0]?.program.slug).toBe("colorado-snap");
    expect(results.programs[0]?.anchors[0]?.citationPath).toBe(
      "us-co/policy/cdhs/snap/fy-2026-benefit-calculation"
    );
    expect(results.encoded[0]?.citationPath).toBe(
      "us-co/policy/cdhs/snap/fy-2026-benefit-calculation"
    );
    expect(results.encoded[0]?.fileSummary).toMatchObject({
      summary: "Colorado SNAP benefit calculation.",
      ruleCount: 4,
      importCount: 2,
      imports: [
        "us:policies/usda/snap/fy-2026-cola/deductions",
        "us:policies/usda/snap/fy-2026-cola/income-eligibility-standards",
      ],
    });
    expect(
      results.encoded[0]?.fileSummary?.previewRules.map((rule) => rule.name)
    ).toContain("shelter_costs");
    expect(mockSearchRules).toHaveBeenCalledWith("CO SNAP", {
      jurisdiction: undefined,
      docType: undefined,
      limit: 20,
    });
  });

  it("never searches a repo the app registers as a gated pilot", async () => {
    // rulespec-il is public on GitHub and holds an il/ tree, but its
    // .axiom/registry.toml gates it and repo-map.ts registers that
    // gate. fetchAppVisibility fails OPEN by design, so the registered
    // check has to be the one that holds when raw.githubusercontent is
    // unreachable — otherwise a pilot encoding becomes searchable the
    // one time GitHub hiccups.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/orgs/TheAxiomFoundation/repos")) {
        return jsonResponse([
          { name: "rulespec-il", default_branch: "main" },
        ]);
      }
      if (url.includes("/.axiom/registry.toml")) {
        // The fail-open path: the marker cannot be read at all.
        return Promise.resolve(new Response("nope", { status: 500 }));
      }
      if (url.endsWith("/repos/TheAxiomFoundation/rulespec-il/git/trees/main")) {
        return jsonResponse(tree([{ path: "il", type: "tree" }]));
      }
      if (url.includes("/rulespec-il/git/trees/main:il?recursive=1")) {
        return jsonResponse(
          tree([{ path: "statutes/income-tax-ordinance/section-121.yaml" }])
        );
      }
      return jsonResponse(tree([]));
    });

    expect(await searchEncodedRuleSpecs("income tax")).toEqual([]);
    expect(
      mockFetch.mock.calls.some(([url]: [string]) =>
        String(url).includes("rulespec-il/git/trees")
      )
    ).toBe(false);
  });

  it("never serves a gated pilot's row out of the populated search index", async () => {
    // The index is the PRIMARY search source; the GitHub crawl above is
    // only its fallback. A row for rulespec-il — left by a sync that ran
    // before the repo was gated, or by one whose marker read failed —
    // used to come straight back with the pilot's formula in it.
    mockFetchIndexedCandidates.mockResolvedValue([
      {
        filePath: "statutes/income-tax-ordinance/section-121.yaml",
        citationPath: "il/statute/income-tax-ordinance/section-121",
        bucket: "statutes",
        jurisdiction: "il",
        rawYaml: [
          "format: rulespec/v1",
          "module:",
          "  summary: Israeli income tax rate schedule.",
          "rules:",
          "- name: income_tax_liability",
          "  kind: derived",
          "  versions:",
          "  - effective_from: '2025-01-01'",
          "    formula: taxable_income * 0.47",
        ].join("\n"),
      },
    ]);

    expect(await searchEncodedRuleSpecs("income tax")).toEqual([]);
    // Scoping the search AT Israel is refused too, and without paying
    // for a GitHub crawl of the same repo.
    expect(
      await searchEncodedRuleSpecs("income tax", { jurisdiction: "il" })
    ).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still serves a public jurisdiction's index rows beside a gated one", async () => {
    // The gate is a deny-list on registered-experimental families, not
    // an allow-list: rows for jurisdictions with no repo-map family at
    // all (the gh/ng case) must keep flowing.
    mockFetchIndexedCandidates.mockResolvedValue([
      {
        filePath: "statutes/income-tax-ordinance/section-121.yaml",
        citationPath: "il/statute/income-tax-ordinance/section-121",
        bucket: "statutes",
        jurisdiction: "il",
        rawYaml: "format: rulespec/v1\nrules: []\n",
      },
      {
        filePath: "statutes/income-tax-act/section-8.yaml",
        citationPath: "gh/statute/income-tax-act/section-8",
        bucket: "statutes",
        jurisdiction: "gh",
        rawYaml: "format: rulespec/v1\nrules: []\n",
      },
    ]);

    const hits = await searchEncodedRuleSpecs("income tax act section");
    expect(hits.map((hit) => hit.citationPath)).toEqual([
      "gh/statute/income-tax-act/section-8",
    ]);
  });

  it("returns empty grouped results for blank queries without hitting backends", async () => {
    const results = await searchAxiom("   ");

    expect(results).toEqual({
      query: "",
      programs: [],
      encoded: [],
      corpus: [],
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSearchRules).not.toHaveBeenCalled();
  });

  it("keeps corpus results when GitHub encoded search is unavailable", async () => {
    mockSearchRules.mockResolvedValueOnce([
      {
        id: "snap-source",
        jurisdiction: "us-co",
        doc_type: "policy",
        citation_path: "us-co/policy/cdhs/snap/source-page",
        heading: "SNAP source page",
        snippet: "source",
        has_rulespec: false,
        rank: 1,
      },
    ]);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/orgs/TheAxiomFoundation/repos")) {
        return Promise.resolve(new Response("rate limited", { status: 429 }));
      }
      return jsonResponse(tree([]));
    });

    const results = await searchAxiom("CO SNAP source");

    expect(results.encoded).toEqual([]);
    expect(results.corpus).toHaveLength(1);
    expect(results.corpus[0]?.citation_path).toBe(
      "us-co/policy/cdhs/snap/source-page"
    );
  });

  it("surfaces symbol-level utility allowance matches inside CO SNAP", async () => {
    const results = await searchAxiom("CO SNAP utility allowance");

    expect(results.encoded[0]).toMatchObject({
      citationPath: "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
      label: "Utility Allowance",
      matchKind: "symbol",
    });
    expect(results.encoded[0]?.symbolMatches.map((match) => match.name)).toEqual(
      expect.arrayContaining([
        "snap_standard_utility_allowance",
        "snap_limited_utility_allowance",
      ])
    );
  });

  it("tolerates small typos in longer RuleSpec symbol terms", async () => {
    const results = await searchAxiom("CO SNAP utilty allowance");

    expect(results.encoded[0]).toMatchObject({
      citationPath: "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
      label: "Utility Allowance",
      matchKind: "symbol",
    });
    expect(results.encoded[0]?.symbolMatches.map((match) => match.name)).toEqual(
      expect.arrayContaining(["snap_standard_utility_allowance"])
    );
  });

  it("uses the best specific symbol label when common terms are too generic", async () => {
    const results = await searchAxiom("CO SNAP excess shelter deduction");

    expect(results.encoded[0]).toMatchObject({
      citationPath: "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
      label: "SNAP Excess Shelter Deduction",
      matchKind: "symbol",
    });
    expect(results.encoded[0]?.label).not.toContain("Exces Shelter");
  });

  it("keeps broad file-context terms from becoming fake symbol matches", async () => {
    const results = await searchAxiom("Colorado Works cash assistance");

    expect(results.encoded[0]).toMatchObject({
      citationPath: "us-co/policy/cdhs/colorado-works/basic-cash-assistance",
      label: "CDHS Colorado Works Basic Cash Assistance",
      matchKind: "file",
    });
  });

  it("dedupes repeated formula references and summarizes source-less files", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/orgs/TheAxiomFoundation/repos")) {
        return jsonResponse([{ name: "rulespec-us", default_branch: "main" }]);
      }
      if (url.endsWith("/repos/TheAxiomFoundation/rulespec-us/git/trees/main")) {
        return jsonResponse(tree([{ path: "us-co", type: "tree" }]));
      }
      if (url.includes("/rulespec-us/git/trees/main:us-co?recursive=1")) {
        return jsonResponse(
          tree([
            {
              path: "policies/cdhs/snap/fy-2026-benefit-calculation.yaml",
            },
          ])
        );
      }
      if (
        url.includes(
          "raw.githubusercontent.com/TheAxiomFoundation/rulespec-us/main/us-co/policies/cdhs/snap/fy-2026-benefit-calculation.yaml"
        )
      ) {
        return textResponse(`format: rulespec/v1
module: {}
rules:
- name: household_net_income
  kind: derived
  entity: Household
  dtype: Money
  versions:
  - effective_from: '2025-10-01'
    formula: gross_income - deduction + gross_income
- name: source_relation_for_manual
  kind: source_relation
  versions: []
- name: data_relation_for_table
  kind: data_relation
  versions: []
`);
      }
      return jsonResponse(tree([]));
    });

    const results = await searchAxiom("CO SNAP gross income");

    expect(results.encoded[0]).toMatchObject({
      citationPath: "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
      label: "Gross Income",
      matchKind: "symbol",
    });
    expect(
      results.encoded[0]?.symbolMatches.filter(
        (match) => match.name === "gross_income"
      )
    ).toHaveLength(1);
    expect(results.encoded[0]?.fileSummary).toMatchObject({
      summary: null,
      ruleCount: 3,
      importCount: 0,
      imports: [],
    });
    expect(
      results.encoded[0]?.fileSummary?.previewRules.map((rule) => rule.name)
    ).toEqual(["household_net_income"]);
  });

  it("maps Arizona Nutrition Assistance encodings to SNAP searches", async () => {
    const results = await searchAxiom("Arizona SNAP");

    expect(results.programs.map((result) => result.program.slug)).not.toContain(
      "snap"
    );
    expect(results.encoded[0]).toMatchObject({
      citationPath:
        "us-az/policy/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation",
      jurisdictionLabel: "Arizona",
      matchKind: "file",
    });
  });

  it("recognizes non-SNAP benefit amount and categorical eligibility slugs", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/orgs/TheAxiomFoundation/repos")) {
        return jsonResponse([
          { name: "rulespec-us", default_branch: "main" },
        ]);
      }
      if (url.endsWith("/repos/TheAxiomFoundation/rulespec-us/git/trees/main")) {
        return jsonResponse(tree([{ path: "us-co", type: "tree" }]));
      }
      if (url.includes("/rulespec-us/git/trees/main:us-co?recursive=1")) {
        return jsonResponse(
          tree([
            {
              path: "policies/cdhs/supplemental-nutrition-assistance/benefit-amount.yaml",
            },
            {
              path: "policies/cdhs/supplemental-nutrition-assistance/categorical-eligibility.yaml",
            },
          ])
        );
      }
      return jsonResponse(tree([]));
    });

    const benefit = await searchEncodedRuleSpecs("CO SNAP benefit amount");
    const categorical = await searchEncodedRuleSpecs(
      "CO SNAP categorical eligibility"
    );

    expect(benefit[0]?.citationPath).toBe(
      "us-co/policy/cdhs/supplemental-nutrition-assistance/benefit-amount"
    );
    expect(categorical[0]?.citationPath).toBe(
      "us-co/policy/cdhs/supplemental-nutrition-assistance/categorical-eligibility"
    );
  });

  it("ranks exact node file names and paths for Arizona policy searches", async () => {
    const gross = await searchAxiom("arizona gross income test");
    const net = await searchAxiom("az net income test");
    const proration = await searchAxiom("arizona first month benefit proration");

    expect(gross.encoded[0]).toMatchObject({
      citationPath:
        "us-az/policy/des/faa5/na-eligibility-and-benefit-determination/gross-income-test",
      matchKind: "file",
    });
    expect(net.encoded[0]).toMatchObject({
      citationPath:
        "us-az/policy/des/faa5/na-eligibility-and-benefit-determination/net-income-test",
      matchKind: "file",
    });
    expect(proration.encoded[0]).toMatchObject({
      citationPath:
        "us-az/policy/des/faa5/na-eligibility-and-benefit-determination/first-month-benefit-proration",
      matchKind: "file",
    });
  });

  it("keeps program shortcuts when topic words do not map to one anchor", async () => {
    const tanf = await searchAxiom("TANF cash assistance");
    const ptc = await searchAxiom("premium tax credit poverty line");

    expect(tanf.programs[0]).toMatchObject({
      program: { slug: "tanf" },
    });
    expect(tanf.programs[0]?.anchors.length).toBeGreaterThan(0);
    expect(ptc.programs[0]).toMatchObject({
      program: { slug: "aca-ptc" },
    });
    expect(ptc.programs[0]?.anchors.length).toBeGreaterThan(0);
  });

  it("does not return RuleSpecs just because a nonsense query has filler words", async () => {
    const results = await searchAxiom("zzzx no match should be sparse");

    expect(results.encoded).toEqual([]);
  });

  it("infers local UK jurisdictions such as Kingston upon Thames", async () => {
    const results = await searchAxiom("kingston council tax reduction");

    expect(results.encoded[0]).toMatchObject({
      citationPath:
        "uk-kingston-upon-thames/policy/kingston-upon-thames/council-tax-reduction",
      jurisdictionLabel: "Kingston upon Thames",
      matchKind: "file",
    });
    expect(
      results.encoded.every((hit) =>
        hit.citationPath.startsWith("uk-kingston-upon-thames/")
      )
    ).toBe(true);
  });

  it("maps expanded ACA premium tax credit queries to the PTC slug", async () => {
    const results = await searchAxiom("premium tax credit poverty line");

    expect(results.programs[0]).toMatchObject({
      program: { slug: "aca-ptc" },
    });
    expect(results.encoded[0]).toMatchObject({
      citationPath: "us/policy/irs/rev-proc-2025-25/aca-ptc",
    });
  });

  it("prunes generic program anchors for topic-specific program queries", async () => {
    const results = await searchAxiom("CO SNAP standard deduction");

    expect(results.programs[0]).toMatchObject({
      program: { slug: "colorado-snap" },
      anchors: [
        {
          citationPath: "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
        },
      ],
    });
    expect(results.programs[1]).toMatchObject({
      program: { slug: "snap" },
      anchors: [
        {
          citationPath: "us/regulation/7/273/9",
        },
      ],
    });
  });

  it("maps lay synonyms like food stamps onto encoded SNAP paths", async () => {
    const results = await searchAxiom("colorado food stamps deduction");

    expect(results.programs[0]?.program.slug).toBe("colorado-snap");
    expect(results.encoded[0]?.citationPath).toBe(
      "us-co/policy/cdhs/snap/fy-2026-benefit-calculation"
    );
  });

  it("maps obamacare onto the ACA premium tax credit encoding", async () => {
    const results = await searchAxiom("obamacare subsidy");

    expect(results.programs[0]?.program.slug).toBe("aca-ptc");
    expect(results.encoded[0]?.citationPath).toBe(
      "us/policy/irs/rev-proc-2025-25/aca-ptc"
    );
  });

  it("prunes any state-administered federal program when a state encoding answers", async () => {
    const results = await searchAxiom("arizona food stamps");

    expect(results.programs.map((result) => result.program.slug)).not.toContain(
      "snap"
    );
    expect(results.encoded[0]?.citationPath).toBe(
      "us-az/policy/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation"
    );
  });

  it("discovers newer standalone jurisdiction repos such as New Zealand", async () => {
    const hits = await searchEncodedRuleSpecs("New Zealand tax");

    expect(hits[0]).toMatchObject({
      citationPath: "nz/statute/income_tax/core/taxable_income",
      jurisdictionLabel: "New Zealand",
    });
  });

  it("discovers Belgium monorepo jurisdictions", async () => {
    const hits = await searchEncodedRuleSpecs("Belgium ordinary worker contribution");

    expect(hits[0]).toMatchObject({
      citationPath:
        "be/statute/social_security/workers/article_38_ordinary_worker_rates",
      jurisdictionLabel: "Belgium",
    });
    expect(
      hits.every((hit) => hit.citationPath.startsWith("be/"))
    ).toBe(true);
  });

  it("serves encoded results from the database index without touching GitHub", async () => {
    mockFetchIndexedCandidates.mockResolvedValue([
      {
        filePath: "policies/cdhs/snap/fy-2026-benefit-calculation.yaml",
        citationPath: "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
        bucket: "policies",
        jurisdiction: "us-co",
        rawYaml: `format: rulespec/v1
module:
  summary: Colorado SNAP benefit calculation.
rules:
- name: snap_standard_utility_allowance
  kind: parameter
  entity: Household
  dtype: Money
  versions:
  - effective_from: '2025-10-01'
    formula: 490
`,
      },
    ]);

    const results = await searchEncodedRuleSpecs("CO SNAP utility allowance");

    expect(results[0]).toMatchObject({
      citationPath: "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
      matchKind: "symbol",
    });
    expect(results[0]?.fileSummary).toMatchObject({
      summary: "Colorado SNAP benefit calculation.",
      ruleCount: 1,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("respects document class filters for encoded results", async () => {
    const hits = await searchEncodedRuleSpecs("CO SNAP", { docType: "statute" });

    expect(hits).toEqual([]);
  });

  it("respects jurisdiction and result limit options", async () => {
    const results = await searchAxiom("SNAP", {
      jurisdiction: "us-co",
      docType: "policy",
      limit: 1,
    });

    expect(results.programs).toHaveLength(1);
    expect(results.programs[0]?.program.slug).toBe("colorado-snap");
    expect(results.encoded).toHaveLength(1);
    expect(results.encoded[0]?.citationPath.startsWith("us-co/")).toBe(true);
    expect(mockSearchRules).toHaveBeenCalledWith("SNAP", {
      jurisdiction: "us-co",
      docType: "policy",
      limit: 1,
    });
  });
});
