import { createHash } from "node:crypto";

// Shared by scripts/build-tariff-schedule-data.ts (which verifies it against
// the pinned rulespec-us commit and the certificate's closure ledger) and by
// the tariff pages (which render the verified copy from the artifact).

export type TariffLine = { hts10: string; displayCode: string; description: string; generalRate: string; column2Rate: string; generalDisposition: string; column2Disposition: string; citations: { field: string; path: string; excerpt: string }[]; memberships: { family: string; explanation: string; citationPath: string }[]; canada338Warning: boolean };

export type CoverageStatus = "encoded" | "partially encoded" | "pending" | "excluded";
export type CoverageRow = { family: string; status: CoverageStatus; note: string; ledgerFamily: string; ledgerRoot: string; count: number };
export type IncidenceTable = { module: string | null; note: string; family: string; status: CoverageStatus; lineCount: number; detail?: string };

export type TariffArtifact = {
  metadata: {
    schema: string; rulespecCommit: string; corpusCommit: string; corpusRelease: string;
    certificateSha256: string; certificateCommit: string; certificateRulespecCommit: string;
    closureLedgerSha256: string; tariffTrees: Record<string, string>;
    corpusSha256: string; builtAt: string; tariffEncodingsChangedAt: string; lineCount: number;
    encodedLineCount: number; encodedPathsSha256: string; partialLineCount: number; partialPathsSha256: string;
    coverageFamilies: CoverageRow[]; incidenceTables: IncidenceTable[];
  };
  lines: TariffLine[];
};

// Machine-checkable facts behind a scope note, asserted at the rulespec pin:
// files that must exist, path prefixes and patterns that must match nothing,
// rules a module must define, imports a module must declare, and rules no
// module may define (so the compositions can only take them as inputs).
export type CoverageEvidence = {
  present?: string[];
  absent?: string[];
  absentMatching?: string;
  rules?: { module: string; rules: string[] }[];
  imports?: { module: string; imports: string[] }[];
  undefinedRules?: string[];
};

const INCIDENCE = "us/policies/usitc/us-tariff-incidence/generated";
const OVERLAYS = "us/policies/usitc/us-tariff-duty/overlays";
const LINES = "us/policies/usitc/us-tariff-duty/lines/generated";
// Chapter 22 stands in for the 100 generated chapter compositions, which the
// generator emits from one template.
const CHAPTER = "us/policies/cbp/us-tariff-schedule/generated/ch22/ch22.yaml";
const WITNESS = "us/policies/cbp/us-tariff-duty/composition.yaml";
const overlay = (path: string) => `us:policies/usitc/us-tariff-duty/overlays/${path}`;

// Page copy for every family in the certificate's closure ledger
// (axiom-oracles conformance/closure/us-tariff-duty.yaml, committed_decisions).
// The status always comes from the ledger; this map supplies the label and a
// scope note whose clauses the evidence checks at the rulespec pin. "{count}"
// is replaced with the ledger's count. The build fails if the ledger and this
// map name different families.
export const COVERAGE_COPY: Record<string, { label: string; note: string; evidence?: CoverageEvidence }> = {
  "fully-computable-rate-bearing-lines": {
    label: "Ad valorem and Free rate lines",
    note: "{count} lines outside 9802 whose general and column 2 rates are both ad valorem or Free. Each rate cites its Rev. 15 text.",
    evidence: { present: [`${LINES}/GENERATED-MANIFEST.json`] },
  },
  "non-ad-valorem-or-partial-value-rate-bearing-lines": {
    label: "Other rate lines, including 9802",
    note: "{count} lines with a specific, compound, component, conditional, or empty rate in either column, plus 9802. The rate text is cited but not applied.",
    evidence: { present: [`${LINES}/ch98.yaml`] },
  },
  "non-rate-structural-rows": {
    label: "Schedule rows without a rate",
    note: "{count} Rev. 15 rows have no general or column 2 rate field, so they are not rate lines.",
  },
  "all-chapter-99-pages": {
    label: "Chapter 99 pages",
    note: "Some chapter 99 rules are composed, but no census yet sorts all {count} chapter 99 pages into encoded, excluded, and pending.",
  },
  "section-232-metal-instruments": {
    label: "Section 232 steel and aluminum",
    note: "Steel and aluminum rates are composed; membership is an entry input. The note 16 and 19 tables list the covered lines.",
    evidence: {
      present: [`${INCIDENCE}/note16-232-steel.yaml`, `${INCIDENCE}/note19-232-aluminum.yaml`],
      rules: [{ module: CHAPTER, rules: ["section_232_steel_component_rate", "section_232_aluminum_component_rate", "schedule_statutory_stack"] }],
      imports: [{ module: CHAPTER, imports: [overlay("section-232-aluminum/general-rate")] }],
      undefinedRules: ["entry_is_section_232_steel", "entry_is_section_232_aluminum"],
    },
  },
  "section-232-non-metal-annexes": {
    label: "Section 232 non-metal annexes",
    note: "Autos and parts, copper, semiconductors, medium- and heavy-duty vehicles, and wood are not encoded.",
    evidence: { absentMatching: "^us/policies/(usitc|cbp)/.*(auto|copper|semiconductor|vehicle|truck|wood|lumber|timber)" },
  },
  "china-301-original-2018-actions": {
    label: "Section 301 China lists 1–4A (2018 actions)",
    note: "The 2018 notices are not in the corpus. Headings 9903.88.03 and 9903.88.15 are composed; list membership (note 20 table) is an entry input.",
    evidence: {
      present: [`${INCIDENCE}/note20-china-301.yaml`],
      imports: [{ module: CHAPTER, imports: [overlay("china-301/list-1-9903-88-03"), overlay("china-301/list-4a-9903-88-15")] }],
      undefinedRules: ["entry_is_china_301_list123", "entry_is_china_301_list4a"],
    },
  },
  "china-301-2024-action": {
    label: "Section 301 China 2024 action (note 31)",
    note: "Heading 9903.91.01's rate is composed, but no note 31 membership table exists; membership is an entry input.",
    evidence: {
      absent: [`${INCIDENCE}/note31`],
      imports: [{ module: CHAPTER, imports: [overlay("china-301/2024-action-9903-91-01")] }],
      undefinedRules: ["entry_is_china_301_2024_action"],
    },
  },
  "brazil-301": {
    label: "Section 301 Brazil (note 50)",
    note: "Heading 9903.05.01's rate is composed, but no note 50 table exists; which articles it covers is an entry input.",
    evidence: {
      absent: [`${INCIDENCE}/note50`],
      rules: [{ module: CHAPTER, rules: ["brazil_section_301_component_rate"] }],
      imports: [{ module: CHAPTER, imports: [overlay("section-301/brazil-9903-05-01")] }],
      undefinedRules: ["entry_is_brazil_301_listed"],
    },
  },
  "note-52-country-tier-action": {
    label: "Section 301 country-tier action (note 52)",
    note: "Country tiers for headings 9903.05.20–9903.05.84 are composed, but no note 52 table exists; which articles are covered is an entry input.",
    evidence: {
      absent: [`${INCIDENCE}/note52`],
      present: [`${OVERLAYS}/section-301/forced-labor-algeria-9903-05-20.yaml`],
      rules: [{ module: CHAPTER, rules: ["forced_labor_section_301_component_rate"] }],
      imports: [{ module: CHAPTER, imports: [overlay("section-301/forced-labor-presidential-action")] }],
      undefinedRules: ["entry_is_forced_labor_301_listed"],
    },
  },
  "solar-china": {
    label: "Section 301 China solar (heading 9903.91.02)",
    note: "The heading's rate is composed, but no membership table exists; membership is an entry input.",
    evidence: {
      rules: [{ module: CHAPTER, rules: ["ch22_solar_china_section_301_additional_duty_rate", "china_section_301_component_rate"] }],
      undefinedRules: ["entry_is_china_301_solar"],
    },
  },
  "section-201-proclamation-10339": {
    label: "Section 201 solar safeguard (note 18)",
    note: "The safeguard has expired, so it is composed as a zero rate. The note 18 table lists the covered lines.",
    evidence: {
      present: [`${INCIDENCE}/note18-201-solar.yaml`],
      rules: [{ module: CHAPTER, rules: ["section_201_component_rate"] }],
      undefinedRules: ["entry_is_section_201_cspv"],
    },
  },
  "section-122-proclamation-11012": {
    label: "Section 122 surcharge (note 2(aa))",
    note: "The 10 percent surcharge is composed for Feb. 24 – July 23, 2026. Exemption is an entry input; the note 2(aa) tables list the exempt scopes.",
    evidence: {
      present: [`${INCIDENCE}/note2aa-122-exemptions.yaml`],
      rules: [{ module: CHAPTER, rules: ["section_122_component_rate"] }],
      imports: [{ module: CHAPTER, imports: [overlay("section-122/proclamation")] }],
      undefinedRules: ["entry_is_section_122_exempt"],
    },
  },
  "ieepa-orders-and-termination": {
    label: "IEEPA fentanyl and reciprocal duties",
    note: "Fentanyl, reciprocal, and Brazil headings are composed. Under Executive Order 14389, the rules apply zero from Feb. 20, 2026.",
    evidence: {
      rules: [{ module: CHAPTER, rules: ["ieepa_component_rate"] }],
      imports: [{ module: CHAPTER, imports: [overlay("ieepa/fentanyl-china-9903-01-24"), overlay("ieepa/reciprocal-baseline-9903-01-25"), overlay("ieepa/brazil-9903-01-77"), overlay("ieepa/termination")] }],
    },
  },
  "section-338-instruments": {
    label: "Section 338 Canada (note 51)",
    note: "Heading 9903.03.12 is composed only for the witness beer entry, HTS 2203.00.00.30. The note 51 product list is not encoded.",
    evidence: {
      absent: [`${INCIDENCE}/note51`, `${OVERLAYS}/section-338`],
      rules: [{ module: CHAPTER, rules: ["section_338_component_rate"] }, { module: WITNESS, rules: ["entry_is_line_d", "section_338_component_rate"] }],
    },
  },
  "historical-vintages": {
    label: "Historical schedule vintages",
    note: "Only the Rev. 15 codified state is reproduced; earlier schedule and instrument versions are not.",
    evidence: { present: [`${LINES}/GENERATED-MANIFEST.json`] },
  },
};

// The incidence tables behind the line pages' memberships. Every table at the
// pin needs an entry here (the build fails otherwise); the family and label
// strings are written into each line's memberships.
export const INCIDENCE_COPY: Record<string, { family: string; label: string; note: string }> = {
  note16: { family: "Section 232 steel", label: "Section 232 steel scope", note: "U.S. note 16" },
  note18: { family: "Section 201 solar", label: "Section 201 solar scope", note: "U.S. note 18" },
  note19: { family: "Section 232 aluminum", label: "Section 232 aluminum scope", note: "U.S. note 19" },
  note20: { family: "Section 301 China", label: "Section 301 China list scope", note: "U.S. note 20" },
  note2aa: { family: "Section 122 exemptions", label: "Section 122 exemption scope", note: "U.S. note 2(aa)" },
};

// Tables the page names as missing; the build asserts each is absent at the pin.
export const PENDING_INCIDENCE_TABLES: { family: string; note: string; status: CoverageStatus; absentPrefix: string; detail: string }[] = [
  { family: "Section 301 China 2024 action", note: "U.S. note 31", status: "pending", absentPrefix: `${INCIDENCE}/note31`, detail: "No table at the build pin." },
  { family: "Section 301 Brazil", note: "U.S. note 50", status: "pending", absentPrefix: `${INCIDENCE}/note50`, detail: "No table at the build pin." },
  { family: "Section 338 Canada", note: "U.S. note 51", status: "pending", absentPrefix: `${INCIDENCE}/note51`, detail: "No table at the build pin." },
  { family: "Section 301 country-tier action", note: "U.S. note 52", status: "pending", absentPrefix: `${INCIDENCE}/note52`, detail: "No table at the build pin." },
];

const LEDGER_STATUS: Record<string, CoverageStatus> = {
  encoded: "encoded",
  "partially-encoded": "partially encoded",
  pending: "pending",
  "excluded-with-reason": "excluded",
};

export function coverageStatusWord(ledgerStatus: string): CoverageStatus {
  const word = LEDGER_STATUS[ledgerStatus];
  if (!word) throw new Error(`unknown closure ledger status ${ledgerStatus}`);
  return word;
}

export function displayStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// The closure ledger's partition of rate lines (axiom-oracles
// scripts/us_tariff_closure.py): a line is structurally computable when both
// statutory columns are ad valorem or Free and it is not a 9802 partial-value
// line; every other rate line is partially encoded.
const COMPUTABLE_DISPOSITIONS = new Set(["ad_valorem", "free"]);

export function rateLineClass(line: Pick<TariffLine, "generalDisposition" | "column2Disposition" | "citations">): "encoded" | "partially encoded" {
  const path = line.citations[0]?.path ?? "";
  const computable = COMPUTABLE_DISPOSITIONS.has(line.generalDisposition) && COMPUTABLE_DISPOSITIONS.has(line.column2Disposition);
  return computable && !path.split("/").at(-1)?.startsWith("9802") ? "encoded" : "partially encoded";
}

export function partitionRateLines(lines: TariffLine[]) {
  const encoded: string[] = [];
  const partial: string[] = [];
  for (const line of lines) (rateLineClass(line) === "encoded" ? encoded : partial).push(line.citations[0].path.replace(/^\//, ""));
  return { encoded, partial };
}

// Same digest as the ledger's _lines_sha256: sorted, newline-joined, trailing newline.
export function linesSha256(values: string[]) {
  return createHash("sha256").update(`${[...values].sort().join("\n")}\n`).digest("hex");
}
