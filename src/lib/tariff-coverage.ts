import { createHash } from "node:crypto";

// Shared by scripts/build-tariff-schedule-data.ts (which verifies it against
// the pinned rulespec-us commit and the certificate's closure ledger) and by
// the tariff pages (which render the verified copy from the artifact).

export type Membership = { family: string; explanation: string; citationPath: string };
export type TariffLine = { hts10: string; displayCode: string; description: string; generalRate: string; column2Rate: string; generalDisposition: string; column2Disposition: string; citations: { field: string; path: string; excerpt: string }[]; memberships: Membership[]; canada338Warning: boolean };

export type CoverageStatus = "encoded" | "partially encoded" | "pending" | "excluded";
export type CoverageRow = { family: string; status: CoverageStatus; note: string; ledgerFamily: string; ledgerRoot: string; count: number };
export type IncidenceTable = { module: string | null; note: string; family: string; status: CoverageStatus; subdivisions: string[]; lineCount: number; suffixOnlyLineCount: number; detail?: string };

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

// Machine-checkable facts behind a scope note, asserted at the rulespec pin.
// `chapters` applies to every generated chapter composition: each must import
// the overlays, define the rules, sum the stack terms into
// schedule_statutory_stack, reference the inputs and not define the names in
// notDefined. `undefinedRules` must be defined by no module anywhere, so the
// compositions can only take them as entry inputs.
export type CoverageEvidence = {
  present?: string[];
  absent?: string[];
  absentMatching?: string;
  fileContains?: { path: string; text: string }[];
  rules?: { module: string; rules: string[] }[];
  chapters?: { imports?: string[]; rules?: string[]; stackTerms?: string[]; references?: string[]; notDefined?: string[] };
  undefinedRules?: string[];
};

const INCIDENCE = "us/policies/usitc/us-tariff-incidence/generated";
const OVERLAYS = "us/policies/usitc/us-tariff-duty/overlays";
const LINES = "us/policies/usitc/us-tariff-duty/lines/generated";
const WITNESS = "us/policies/cbp/us-tariff-duty/composition.yaml";
const overlay = (path: string) => `us:policies/usitc/us-tariff-duty/overlays/${path}`;

// Page copy for every family in the certificate's closure ledger
// (axiom-oracles conformance/closure/us-tariff-duty.yaml, committed_decisions).
// The status always comes from the ledger; this map supplies the label and a
// scope note whose clauses the evidence checks at the rulespec pin. "{count}"
// is replaced with the ledger's count. The build fails if the ledger and this
// map name different families. Where a note differs from the ledger's own
// reason string, the note follows the encoded rules.
export const COVERAGE_COPY: Record<string, { label: string; note: string; evidence?: CoverageEvidence }> = {
  "fully-computable-rate-bearing-lines": {
    label: "Ad valorem and Free rate lines",
    note: "{count} lines outside 9802 whose general and column 2 rates are both ad valorem or Free. Each rate cites its Rev. 15 text.",
    evidence: { fileContains: [{ path: `${LINES}/GENERATED-MANIFEST.json`, text: `"snapshot_label": "2026HTSRev15"` }] },
  },
  "non-ad-valorem-or-partial-value-rate-bearing-lines": {
    label: "Other rate lines, including 9802",
    note: "{count} lines where a column is specific, compound, component, conditional, or empty, plus 9802. Those columns and 9802 partial-value bases are not applied.",
    evidence: { chapters: { rules: ["mfn_ad_valorem_rate"], stackTerms: ["mfn_ad_valorem_rate"] } },
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
    note: "Steel and aluminum rates are composed; membership is an entry input. The incidence tables cover only some note 16 and 19 subdivisions.",
    evidence: {
      present: [`${INCIDENCE}/note16-232-steel.yaml`, `${INCIDENCE}/note19-232-aluminum.yaml`],
      chapters: {
        imports: [overlay("section-232-aluminum/general-rate"), overlay("section-232-aluminum/rev12-consolidation")],
        stackTerms: ["section_232_steel_component_rate", "section_232_aluminum_component_rate"],
        references: ["entry_is_section_232_steel", "entry_is_section_232_aluminum"],
      },
      undefinedRules: ["entry_is_section_232_steel", "entry_is_section_232_aluminum"],
    },
  },
  "section-232-non-metal-annexes": {
    label: "Section 232 autos, copper, semiconductors, vehicles, and wood",
    note: "Those proclamation annexes are not encoded. The consolidated 9903.82.02 rate, which also names copper articles, is composed; copper membership is not.",
    evidence: {
      absentMatching: "^us/policies/(usitc|cbp)/.*(auto|copper|semiconductor|vehicle|truck|wood|lumber|timber)",
      rules: [{ module: `${OVERLAYS}/section-232-aluminum/rev12-consolidation.yaml`, rules: ["section_232_non_excepted_aluminum_steel_copper_derivative_articles_additional_duty_rate"] }],
      chapters: {
        imports: [overlay("section-232-aluminum/rev12-consolidation")],
        references: ["section_232_non_excepted_aluminum_steel_copper_derivative_articles_additional_duty_rate"],
      },
    },
  },
  "china-301-original-2018-actions": {
    label: "Section 301 China lists 1–4A (2018–2019 actions)",
    note: "The 2018 and 2019 notices are not in the corpus. Headings 9903.88.03 and 9903.88.15 are composed; list membership is an entry input.",
    evidence: {
      present: [`${INCIDENCE}/note20-china-301.yaml`],
      chapters: {
        imports: [overlay("china-301/list-1-9903-88-03"), overlay("china-301/list-4a-9903-88-15")],
        stackTerms: ["china_section_301_component_rate"],
        references: ["entry_is_china_301_list123", "entry_is_china_301_list4a"],
      },
      undefinedRules: ["entry_is_china_301_list123", "entry_is_china_301_list4a"],
    },
  },
  "china-301-2024-action": {
    label: "Section 301 China 2024 action (note 31)",
    note: "Heading 9903.91.01's rate is composed, but no note 31 membership table exists; membership is an entry input.",
    evidence: {
      absent: [`${INCIDENCE}/note31`],
      chapters: { imports: [overlay("china-301/2024-action-9903-91-01")], stackTerms: ["china_section_301_component_rate"], references: ["entry_is_china_301_2024_action"] },
      undefinedRules: ["entry_is_china_301_2024_action"],
    },
  },
  "brazil-301": {
    label: "Section 301 Brazil (note 50)",
    note: "Heading 9903.05.01's rate is composed, but no note 50 table exists; which articles it covers is an entry input.",
    evidence: {
      absent: [`${INCIDENCE}/note50`],
      chapters: { imports: [overlay("section-301/brazil-9903-05-01")], stackTerms: ["brazil_section_301_component_rate"], references: ["entry_is_brazil_301_listed"] },
      undefinedRules: ["entry_is_brazil_301_listed"],
    },
  },
  "note-52-country-tier-action": {
    label: "Section 301 country-tier action (note 52)",
    note: "Country tiers for headings 9903.05.20–9903.05.84 are composed, but no note 52 table exists; which articles are covered is an entry input.",
    evidence: {
      absent: [`${INCIDENCE}/note52`],
      chapters: { imports: [overlay("section-301/forced-labor-presidential-action")], stackTerms: ["forced_labor_section_301_component_rate"], references: ["entry_is_forced_labor_301_listed"] },
      undefinedRules: ["entry_is_forced_labor_301_listed"],
    },
  },
  "solar-china": {
    label: "Section 301 China solar (heading 9903.91.02)",
    note: "The heading's rate is composed, but no membership table exists; membership is an entry input.",
    evidence: {
      chapters: { stackTerms: ["china_section_301_component_rate"], references: ["entry_is_china_301_solar"] },
      rules: [{ module: "us/policies/cbp/us-tariff-schedule/generated/ch85/ch85.yaml", rules: ["ch85_solar_china_section_301_additional_duty_rate"] }],
      undefinedRules: ["entry_is_china_301_solar"],
    },
  },
  "section-201-proclamation-10339": {
    label: "Section 201 solar safeguard (note 18)",
    note: "The safeguard has expired, so it is composed as a zero rate.",
    evidence: { chapters: { stackTerms: ["section_201_component_rate"] } },
  },
  "section-122-proclamation-11012": {
    label: "Section 122 surcharge (note 2(aa))",
    note: "The 10 percent surcharge is composed for Feb. 24 – July 23, 2026. Exemption is an entry input; the incidence table covers only some note 2(aa) subdivisions.",
    evidence: {
      present: [`${INCIDENCE}/note2aa-122-exemptions.yaml`],
      chapters: { imports: [overlay("section-122/proclamation")], stackTerms: ["section_122_component_rate"], references: ["entry_is_section_122_exempt"] },
      undefinedRules: ["entry_is_section_122_exempt"],
    },
  },
  "ieepa-orders-and-termination": {
    label: "IEEPA fentanyl and reciprocal duties",
    note: "Fentanyl, reciprocal, and Brazil headings are composed. Under Executive Order 14389, the rules apply zero from Feb. 20, 2026.",
    evidence: {
      chapters: {
        imports: [overlay("ieepa/fentanyl-china-9903-01-24"), overlay("ieepa/reciprocal-baseline-9903-01-25"), overlay("ieepa/brazil-9903-01-77"), overlay("ieepa/termination")],
        stackTerms: ["ieepa_component_rate"],
      },
    },
  },
  "section-338-instruments": {
    label: "Section 338 Canada (note 51)",
    note: "Heading 9903.03.12 is composed. The witness composition applies it only to HTS 2203.00.00.30; the chapter compositions take that line flag as an entry input. The note 51 list is not encoded.",
    evidence: {
      absent: [`${INCIDENCE}/note51`, `${OVERLAYS}/section-338`],
      rules: [{ module: WITNESS, rules: ["entry_is_line_d", "section_338_component_rate"] }],
      chapters: { stackTerms: ["section_338_component_rate"], references: ["entry_is_line_d"], notDefined: ["entry_is_line_d"] },
    },
  },
  "historical-vintages": {
    label: "Historical schedule vintages",
    note: "The ledger covers only the Rev. 15 codified state; earlier schedule vintages are not reproduced.",
    evidence: { fileContains: [{ path: `${LINES}/GENERATED-MANIFEST.json`, text: `"snapshot_label": "2026HTSRev15"` }] },
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
type RateLineFields = Pick<TariffLine, "generalDisposition" | "column2Disposition" | "citations">;

function is9802(line: RateLineFields) {
  return Boolean(line.citations[0]?.path.split("/").at(-1)?.startsWith("9802"));
}

export function rateLineClass(line: RateLineFields): "encoded" | "partially encoded" {
  const computable = COMPUTABLE_DISPOSITIONS.has(line.generalDisposition) && COMPUTABLE_DISPOSITIONS.has(line.column2Disposition);
  return computable && !is9802(line) ? "encoded" : "partially encoded";
}

// Says which column the chapter compositions carry and which they do not: a
// generated rate cell exists only for an ad valorem or Free column.
export function rateLineClassNote(line: RateLineFields) {
  if (is9802(line)) return "9802 lines need a partial-value duty base, which is not applied.";
  const columns = [["general", line.generalDisposition], ["column 2", line.column2Disposition]] as const;
  const word = (disposition: string) => disposition.replace("_", " ");
  const carried = columns.filter(([, disposition]) => COMPUTABLE_DISPOSITIONS.has(disposition));
  const missing = columns.filter(([, disposition]) => !COMPUTABLE_DISPOSITIONS.has(disposition));
  if (!missing.length) return "Both columns are ad valorem or Free, and the chapter composition carries both rates.";
  const missingText = missing.map(([column, disposition]) => `the ${column} rate is ${word(disposition)}`).join(" and ");
  const carriedText = carried.length ? `; the chapter composition carries the ${carried[0][0]} rate.` : ".";
  return `${missingText.charAt(0).toUpperCase()}${missingText.slice(1)}, so ${missing.length === 1 ? "it is" : "they are"} not applied${carriedText}`;
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
