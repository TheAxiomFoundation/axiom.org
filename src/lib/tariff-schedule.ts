import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type TariffLine = { hts10: string; displayCode: string; description: string; generalRate: string; column2Rate: string; generalDisposition: string; column2Disposition: string; citations: { field: string; path: string; excerpt: string }[]; memberships: { family: string; explanation: string; citationPath: string }[]; canada338Warning: boolean };
export const tariffMetadata = { rulespecCommit: "c55778119c0dd208a5ea3366092a17d0b0392c8b", corpusRelease: "2026-08-09-usitc-hts-2026-rev15-full-schedule", builtAt: "2026-08-18T19:47:42.000Z" };
let cachedLines: TariffLine[] | undefined;
export function getTariffLines() {
  if (!cachedLines) cachedLines = JSON.parse(readFileSync(resolve(process.cwd(), "public/downloads/tariff-schedule.json"), "utf8")).lines;
  return cachedLines!;
}

export function findTariffLine(hts10: string) {
  return getTariffLines().find((line) => line.hts10 === hts10.replace(/\D/g, ""));
}

export const coverageFamilies = [
  ["Rated schedule lines except 9802", "Encoded", "General and column 2 schedule fields."],
  ["9802 partial-value rated lines", "Partially encoded", "Schedule fields are encoded; dutiable partial value is an entry input."],
  ["Section 232 metals — notes 16 and 19", "Encoded", "Steel and aluminum incidence and overlays."],
  ["Section 201 solar — note 18", "Encoded", "Solar safeguard incidence and overlay."],
  ["Section 301 China lists — note 20", "Encoded", "Original China list incidence tables."],
  ["Section 122 exemptions — note 2(aa)", "Encoded", "Temporary-surcharge incidence and overlay."],
  ["Section 338 Canada — note 51", "Pending merge", "Not on rulespec-us main."],
  ["Brazil Section 301 — note 50", "Pending merge", "Branch module is not on rulespec-us main."],
  ["Forced-labor Section 301 — note 52", "Pending merge", "Branch module is not on rulespec-us main."],
  ["Other chapter 99 pages", "Partially encoded", "No complete page-level coverage census."],
  ["Section 232 non-metal annexes", "Pending", "Auto, copper, semiconductor, vehicle, and wood annexes."],
  ["Original 2018 China Section 301 instruments", "Absent", "Absent from the closure corpus."],
] as const;

export const coverageBurndown = [
  ["9802 partial-value rated lines", "Partially encoded", "Dutiable partial value is supplied as an input, not derived."],
  ["Section 338 / U.S. note 51", "Pending merge", "The note 51 incidence module is not on rulespec-us main."],
  ["Brazil Section 301 / U.S. note 50", "Pending merge", "The branch module is not on rulespec-us main."],
  ["Forced-labor Section 301 / U.S. note 52", "Pending merge", "The branch module is not on rulespec-us main."],
  ["Other chapter 99 pages", "Partially encoded", "No page-level census proves every other chapter 99 note is covered."],
  ["Section 232 non-metal annexes", "Pending", "Auto, copper, semiconductor, vehicle, and wood annexes are not encoded."],
  ["Original 2018 China Section 301 instruments", "Absent", "The instruments are absent from the closure corpus."],
  ["China 2024, Brazil, forced-labor, and solar-China composition", "Partially encoded", "Membership or headings exist, but these families are not all composed into the final result."],
  ["Historical schedule vintages", "Pending", "The closure ledger covers only the Rev. 15 codified state."],
] as const;
