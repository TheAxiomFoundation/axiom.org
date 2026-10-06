// The numbers the verification copy states about Axiom's comparisons, kept
// as the rows of the files that generate them, each with the commit it was
// read at. Pages derive their counts from these rows rather than typing
// totals into prose, and verification-evidence.test.ts pins the derived
// totals, their identities, and the literal copy in files that cannot
// import them (src/lib/verify-data.ts).
//
// To refresh a figure, re-read the cited file at a newer commit and change
// the rows, the commit and the date together. A total never changes alone.

export interface EvidenceSource {
  repo: string;
  path: string;
  commit: string;
  /** The date the cited file was generated or last changed. */
  date: string;
}

const ORACLES_REPO = "TheAxiomFoundation/axiom-oracles";
// axiom-oracles main, read 2026-10-05.
const ORACLES_MAIN = "8826215dc9055f141737e2cdb0231df825952b62";

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// US rule coverage
// ---------------------------------------------------------------------------

/**
 * rule_verification_summary.json, `rules.total` and
 * `rules.on_oracle_surface`, as generated on 2026-09-28 against rulespec-us
 * 54d90a72. scripts/rule_verification.py maps each rule's path to a program
 * surface in coverage_overview.json (`classify()`), and a rule counts as on
 * an oracle surface when that surface's status says a live comparison
 * exercises it. The file measures the surface, not the rule: its comment
 * says a compared surface does not mean each of its rules was compared.
 * The difference from the total is not a count of uncompared rules either:
 * 16,716 rules map to no surface at all (`family: None`), so they are
 * never on an oracle surface, and some are compared directly (us_tariff_duty
 * in axiom-usitc-us-tariff.json, nj_pit_pilot_income_tax_liability in
 * axiom-policyengine-taxsim-nj-income-tax-liability.json). Copy states only
 * the on-surface count. The 2026-09-28 snapshot is the one axiom.org#304's
 * waiver and manifest counts use, so every page quotes the same total.
 */
export const RULE_COVERAGE = {
  month: "September 2026",
  totalRules: 34_810,
  rulesOnComparedSurface: 14_030,
  perRuleFileUrl:
    "https://github.com/TheAxiomFoundation/axiom-oracles/blob/main/dashboard/public/data/rule_verification.json",
  source: {
    repo: ORACLES_REPO,
    path: "dashboard/public/data/rule_verification_summary.json",
    commit: "d1e9d5ad859d16179eef732acc3b8efc1747214b",
    date: "2026-09-28",
  } satisfies EvidenceSource,
} as const;

/**
 * "In September 2026, our coverage map tied 14,030 of our 34,810 US rules to
 * a program that a live comparison exercises, though a comparison of a
 * program does not check each of its rules"
 */
export function ruleCoverageClause(coverage: {
  month: string;
  totalRules: number;
  rulesOnComparedSurface: number;
} = RULE_COVERAGE): string {
  return `In ${coverage.month}, our coverage map tied ${formatCount(coverage.rulesOnComparedSurface)} of our ${formatCount(coverage.totalRules)} US rules to a program that a live comparison exercises, though a comparison of a program does not check each of its rules`;
}

/**
 * rulespec-us oracle-coverage-pending.yaml: `entries` (14,952, equal to its
 * `ceiling`) at rulespec-us main f468c8da (2026-10-04; the file last changed
 * 2026-09-18). The shared CI gate runs `axiom-encode oracle-coverage
 * --fail-on-unmapped --fail-on-untested-comparable` without
 * `--fail-on-pending` (TheAxiomFoundation/.github validate-rulespec.yml), so
 * these outputs pass with no comparison.
 */
export const PENDING_OUTPUTS = {
  month: "October 2026",
  count: 14_952,
  source: {
    repo: "TheAxiomFoundation/rulespec-us",
    path: "oracle-coverage-pending.yaml",
    commit: "f468c8daeb3c0e7184b85be7fb97585475d74a1b",
    date: "2026-10-04",
  } satisfies EvidenceSource,
} as const;

/**
 * conformance/scoreboard.json, the `us-pe` row (policyengine-us 1.767.3):
 * covered 36 of 127 policies in scope, unexplained_total 0,
 * axiom_attributed_open 0, conformant false.
 */
export const US_CONFORMANCE = {
  covered: 36,
  inScope: 127,
  unexplained: 0,
  axiomAttributed: 0,
  source: {
    repo: ORACLES_REPO,
    path: "conformance/scoreboard.json",
    commit: "f78333fe7c4806f71a173690274f4ba96e9d6529",
    date: "2026-08-14",
  } satisfies EvidenceSource,
} as const;

// ---------------------------------------------------------------------------
// SNAP quality-control replay
// ---------------------------------------------------------------------------

export interface SnapQcReplay {
  state: string;
  suite: string;
  /** `case_count` in dashboard/public/data/axiom-snapqc-<st>-snap.json */
  households: number;
}

/**
 * The six FY 2024 replays against rulespec-us main, all generated
 * 2026-09-23. Each report compares six stages (gross income, standard
 * deduction, shelter deduction, net income, maximum allotment, benefit),
 * every one at 100%. The QC file keeps only eligible households and the
 * replay feeds the eligibility gates passing values
 * (axiom_oracles/bridges/snap_qc_compare.py, module docstring), so it checks
 * benefit arithmetic only. Texas is not counted: its composition is not on
 * rulespec-us main (rulespec-us#888), and its report is a July 2026 run
 * against a pre-rebase branch commit (comparisons/tx-snap-qc.yaml).
 */
export const SNAP_QC_REPLAYS: readonly SnapQcReplay[] = [
  { state: "Arizona", suite: "az-snap-qc", households: 922 },
  { state: "California", suite: "ca-snap-qc", households: 883 },
  { state: "Colorado", suite: "co-snap-qc", households: 856 },
  { state: "Georgia", suite: "ga-snap-qc", households: 945 },
  { state: "Maryland", suite: "md-snap-qc", households: 722 },
  { state: "New York", suite: "ny-snap-qc", households: 847 },
];

export const SNAP_QC_SOURCE: EvidenceSource = {
  repo: ORACLES_REPO,
  path: "dashboard/public/data/axiom-snapqc-*-snap.json",
  commit: ORACLES_MAIN,
  date: "2026-09-23",
};

export function snapQcTotals(replays: readonly SnapQcReplay[] = SNAP_QC_REPLAYS) {
  return {
    states: replays.length,
    households: replays.reduce((total, r) => total + r.households, 0),
  };
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five",
  "six", "seven", "eight", "nine", "ten",
];

/** Spell out counts up to ten, as house style does in prose. */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? formatCount(n);
}

// ---------------------------------------------------------------------------
// SOUTHMOD
// ---------------------------------------------------------------------------

export interface SouthmodSuite {
  suite: string;
  /** `case_count`; every case is a synthetic household. */
  cases: number;
  /** `summary.comparison_count` */
  comparisons: number;
  /** `summary.match_count` */
  matches: number;
  /**
   * `summary.dispositioned.counts.upstream_engine_gap`: mismatches the
   * suite's dispositions file attributes to the SOUTHMOD model, with the
   * statute and the arithmetic (dispositions/<suite>.yaml).
   */
  modelGaps: number;
}

/**
 * The 40 SOUTHMOD_A4.0 suites on axiom-oracles main (merged 2026-10-04,
 * #205-#260), one row per dashboard/public/data/axiom-euromod-<suite>.json.
 * Every report has 0 errors, 0 unexplained mismatches and 0 mismatches
 * attributed to Axiom; the three mismatches are the two ETMOD minimum-tax
 * findings (dispositions/et-business-mat.yaml) and GHAMOD's missing 35% top
 * band (dispositions/gh-income-tax-rate-schedule.yaml).
 */
export const SOUTHMOD_SUITES: readonly SouthmodSuite[] = [
  { suite: "et-business-mat", cases: 5, comparisons: 5, matches: 3, modelGaps: 2 },
  { suite: "et-dispy", cases: 5, comparisons: 5, matches: 5, modelGaps: 0 },
  { suite: "et-paye-rate-schedule", cases: 8, comparisons: 8, matches: 8, modelGaps: 0 },
  { suite: "et-pension-contributions", cases: 3, comparisons: 5, matches: 5, modelGaps: 0 },
  { suite: "et-presumptive", cases: 5, comparisons: 5, matches: 5, modelGaps: 0 },
  { suite: "et-vat", cases: 6, comparisons: 6, matches: 6, modelGaps: 0 },
  { suite: "gh-capital-income", cases: 3, comparisons: 3, matches: 3, modelGaps: 0 },
  { suite: "gh-dispy", cases: 2, comparisons: 2, matches: 2, modelGaps: 0 },
  { suite: "gh-excise", cases: 2, comparisons: 2, matches: 2, modelGaps: 0 },
  { suite: "gh-income-tax-rate-schedule", cases: 11, comparisons: 11, matches: 10, modelGaps: 1 },
  { suite: "gh-personal-reliefs", cases: 8, comparisons: 10, matches: 10, modelGaps: 0 },
  { suite: "gh-presumptive-turnover", cases: 6, comparisons: 6, matches: 6, modelGaps: 0 },
  { suite: "gh-ssnit-contributions", cases: 4, comparisons: 8, matches: 8, modelGaps: 0 },
  { suite: "gh-transfers", cases: 1, comparisons: 1, matches: 1, modelGaps: 0 },
  { suite: "gh-vat-levies", cases: 2, comparisons: 4, matches: 4, modelGaps: 0 },
  { suite: "rw-cbhi-tiers", cases: 4, comparisons: 4, matches: 4, modelGaps: 0 },
  { suite: "rw-contributions", cases: 4, comparisons: 20, matches: 20, modelGaps: 0 },
  { suite: "rw-dispy", cases: 6, comparisons: 12, matches: 12, modelGaps: 0 },
  { suite: "rw-excise", cases: 6, comparisons: 6, matches: 6, modelGaps: 0 },
  { suite: "rw-lump-sum", cases: 7, comparisons: 7, matches: 7, modelGaps: 0 },
  { suite: "rw-paye-rate-schedule", cases: 8, comparisons: 8, matches: 8, modelGaps: 0 },
  { suite: "rw-rental", cases: 4, comparisons: 4, matches: 4, modelGaps: 0 },
  { suite: "rw-vat", cases: 3, comparisons: 3, matches: 3, modelGaps: 0 },
  { suite: "ug-dispy", cases: 10, comparisons: 10, matches: 10, modelGaps: 0 },
  { suite: "ug-fuel-excise", cases: 2, comparisons: 2, matches: 2, modelGaps: 0 },
  { suite: "ug-lst", cases: 12, comparisons: 12, matches: 12, modelGaps: 0 },
  { suite: "ug-nssf-contributions", cases: 6, comparisons: 12, matches: 12, modelGaps: 0 },
  { suite: "ug-paye-rate-schedule", cases: 10, comparisons: 10, matches: 10, modelGaps: 0 },
  { suite: "ug-presumptive", cases: 10, comparisons: 10, matches: 10, modelGaps: 0 },
  { suite: "ug-rental", cases: 4, comparisons: 4, matches: 4, modelGaps: 0 },
  { suite: "ug-scg", cases: 3, comparisons: 3, matches: 3, modelGaps: 0 },
  { suite: "ug-vat", cases: 1, comparisons: 1, matches: 1, modelGaps: 0 },
  { suite: "zm-dispy", cases: 2, comparisons: 2, matches: 2, modelGaps: 0 },
  { suite: "zm-excise-ad-valorem", cases: 4, comparisons: 4, matches: 4, modelGaps: 0 },
  { suite: "zm-napsa-contributions", cases: 3, comparisons: 6, matches: 6, modelGaps: 0 },
  { suite: "zm-nhima-contributions", cases: 3, comparisons: 6, matches: 6, modelGaps: 0 },
  { suite: "zm-paye-rate-schedule", cases: 8, comparisons: 8, matches: 8, modelGaps: 0 },
  { suite: "zm-sct", cases: 2, comparisons: 2, matches: 2, modelGaps: 0 },
  { suite: "zm-turnover", cases: 5, comparisons: 5, matches: 5, modelGaps: 0 },
  { suite: "zm-vat", cases: 3, comparisons: 3, matches: 3, modelGaps: 0 },
];

export const SOUTHMOD_SOURCE: EvidenceSource = {
  repo: ORACLES_REPO,
  path: "dashboard/public/data/axiom-euromod-{et,gh,rw,ug,zm}-*.json",
  commit: ORACLES_MAIN,
  date: "2026-10-04",
};

/**
 * Country models in the order the oracle dashboard's acknowledgement names
 * them (axiom-oracles dashboard/src/utils/suites.js, SOUTHMOD_MODELS), with
 * the input-data citation clause 8 of the Adhesion Agreement asks for. The
 * suites read only each dataset's variable list; Rwanda has no dataset.
 */
export const SOUTHMOD_MODELS = [
  {
    prefix: "gh",
    country: "Ghana",
    model: "GHAMOD",
    data: "Ghana Statistical Service (GSS) (2020). Ghana Living Standards Survey Round 7 (GLSS7), 2016–2017. Accra: GSS. https://microdata.fao.org/index.php/catalog/1397",
  },
  {
    prefix: "ug",
    country: "Uganda",
    model: "UGAMOD",
    data: "Uganda Bureau of Statistics (UBOS) (2025). Uganda National Household Survey, 2023/24 (UNHS 2023/24). Kampala: UBOS. https://microdata.ubos.org:7070/index.php/catalog/80/download/275",
  },
  {
    prefix: "zm",
    country: "Zambia",
    model: "MicroZAMOD",
    data: "Zambia Statistics Agency (ZamStats) (2024). Living Conditions Monitoring Survey, 2022 (LCMS 2022). Lusaka: ZamStats. https://www.zamstats.gov.zm/wp-content/uploads/2024/07/2022-LCMS-Report-2022.pdf",
  },
  {
    prefix: "et",
    country: "Ethiopia",
    model: "ETMOD",
    data: "Central Statistical Agency of Ethiopia (CSA) (2024). Ethiopia Socioeconomic Panel Survey, Wave 5 (ESPS-5) 2021–2022. Addis Ababa: CSA. https://microdata.worldbank.org/index.php/catalog/6161",
  },
  {
    prefix: "rw",
    country: "Rwanda",
    model: "RWAMOD",
    data: null,
  },
] as const;

export function southmodTotals(suites: readonly SouthmodSuite[] = SOUTHMOD_SUITES) {
  const prefixes = new Set(suites.map((s) => s.suite.split("-")[0]));
  return {
    suites: suites.length,
    countries: prefixes.size,
    cases: suites.reduce((t, s) => t + s.cases, 0),
    comparisons: suites.reduce((t, s) => t + s.comparisons, 0),
    matches: suites.reduce((t, s) => t + s.matches, 0),
    modelGaps: suites.reduce((t, s) => t + s.modelGaps, 0),
  };
}

/** "Ghana, Uganda, Zambia, Ethiopia and Rwanda" */
export function listJoin(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 2) return items.join(` ${conjunction} `);
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

/**
 * The three caveats any SOUTHMOD copy carries, each checked against
 * axiom-oracles and the rulespec repos on 2026-10-05. `marker` is the phrase
 * the verification-claims guard requires wherever a page names SOUTHMOD.
 */
export const SOUTHMOD_CAVEATS = {
  // Clause 4 of the SOUTHMOD_A4.0 Adhesion Agreement: "The Licensee must
  // not provide SOUTHMOD or the associated input datasets to any third
  // parties." Every one of the 40 configs declares `ci: manual`, and
  // .github/workflows/comparisons.yml drops `ci: manual` suites from the CI
  // matrix (and refuses one named with `only`).
  manualRuns: {
    marker: "by hand on our licensed machine",
    sentence:
      "UNU-WIDER's licence bars giving the models to anyone else, so no CI runner can hold them: we run these suites by hand on our licensed machine.",
  },
  // No compared module carries an `axiom-encode encode --apply` manifest.
  // rulespec-gh, -ug, -zm and -et: every compared module's manifest has
  // backend "manual", runner "manual-attestation" (tool `axiom-encode
  // sign-applied-files`), or the module has none; rulespec-rw has no
  // manifests at all. The three encoder-apply manifests in those repos
  // (ug act-2022-11 s.22, zm act-2018-2, zm act-2022-25) cover modules no
  // suite reads. Debt issues: rulespec-{gh,ug,zm,et,rw} "encoding debt"
  // issues filed 2026-10-04.
  notEncoderOutput: {
    marker: "encoder's apply step",
    sentence:
      "None of the Axiom rules these suites compare went through our encoder's apply step: each was attested by hand or carries no encoding record.",
  },
  // Every config runs `population: synthetic`, `sample_size: 0`: only the
  // dataset's variable list is read. The rw-* configs: "the bundle ships no
  // Rwandan microdata, so a header-only input file is built locally from
  // the model's own variable list" (scripts/southmod_rw_header.py).
  syntheticHouseholds: {
    marker: "no Rwandan microdata",
    sentence:
      "Every household is synthetic, and the SOUTHMOD bundle has no Rwandan microdata at all.",
  },
} as const;

export const SOUTHMOD_URL =
  "https://www.wider.unu.edu/project/southmod-simulating-tax-and-benefit-policies-development-phase-3";

/**
 * The acknowledgement clause 2 of the SOUTHMOD_A4.0 Adhesion Agreement
 * requires on outputs that use the models: Annex 1.2 with its fields filled
 * in (the EUROMOD version every config records, EM_Executable 1.0.0 through
 * the euromod connector 0.2.18), then the input-data citations clause 8
 * requires. Same text as the oracle dashboard's southmodAcknowledgement().
 */
export function southmodAcknowledgement(): string {
  const named = SOUTHMOD_MODELS.map((m) => `${m.country} (${m.model})`).join(", ");
  const data = SOUTHMOD_MODELS.map((m) =>
    m.data
      ? `${m.model}: ${m.data}`
      : `${m.model}: no input data (the bundle ships none; runs use a header-only file and synthetic rows)`,
  ).join(" ");
  return (
    `The results presented here are based on the tax-benefit microsimulation models for ${named} in SOUTHMOD_A4.0. ` +
    "Models in the SOUTHMOD bundle are developed, maintained and managed by UNU-WIDER in collaboration with SASPRI (Southern African Social Policy Research Insights), the International Inequalities Institute at the London School of Economics and Political Science, and local partners in selected developing countries (Bolivia, Colombia, Ecuador, Egypt, Ethiopia, Ghana, Mozambique, Peru, Rwanda, Mainland Tanzania, Uganda, Viet Nam, Zambia, and Zanzibar) in the scope of the SOUTHMOD project. " +
    "The results presented here are based on EUROMOD version EM_Executable 1.0.0 (run through the euromod Python connector 0.2.18). " +
    "Originally maintained, developed and managed by the Institute for Social and Economic Research (ISER), since 2021 EUROMOD is maintained, developed and managed by the Joint Research Centre (JRC) of the European Commission, in collaboration with EUROSTAT and national teams from the EU countries. " +
    "We are indebted to the many people who have contributed to the development of SOUTHMOD and EUROMOD. " +
    "The results and their interpretation presented in this publication are solely the Axiom Foundation's responsibility. " +
    `Input data: the policy systems run under the input-dataset configurations UNU-WIDER built from these surveys; only each dataset's variable list is read, and every comparison household is synthetic. ${data}`
  );
}

/**
 * Everything the SOUTHMOD card and the /about line say, derived from the
 * rows above.
 */
export const SOUTHMOD_FACTS = (() => {
  const totals = southmodTotals();
  const countries = SOUTHMOD_MODELS.map((m) => m.country);
  return {
    ...totals,
    countryNames: countries,
    countryList: listJoin(countries),
    summary: `${totals.suites} suites compare our rules for ${listJoin(countries)}: ${formatCount(totals.matches)} of ${formatCount(totals.comparisons)} comparisons match, and we attribute the other ${countWord(totals.modelGaps)} to gaps in the models, with the arithmetic published.`,
    caveats: SOUTHMOD_CAVEATS,
    acknowledgement: southmodAcknowledgement(),
    url: SOUTHMOD_URL,
    source: SOUTHMOD_SOURCE,
  };
})();
