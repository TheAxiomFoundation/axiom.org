import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CoverageRow, TariffArtifact } from "./tariff-coverage";

export type { TariffLine } from "./tariff-coverage";

// Every commit, count and coverage row on the tariff pages comes from the
// regenerated download (scripts/build-tariff-schedule-data.ts), so the page
// cannot drift from the artifacts it links.
let cachedArtifact: TariffArtifact | undefined;
export function getTariffArtifact() {
  if (!cachedArtifact) cachedArtifact = JSON.parse(readFileSync(resolve(process.cwd(), "public/downloads/tariff-schedule.json"), "utf8")) as TariffArtifact;
  return cachedArtifact;
}

export function getTariffMetadata() {
  return getTariffArtifact().metadata;
}

export function getTariffLines() {
  return getTariffArtifact().lines;
}

export function findTariffLine(hts10: string) {
  return getTariffLines().find((line) => line.hts10 === hts10.replace(/\D/g, ""));
}

// The named burndown is every ledger family that is not yet encoded or
// excluded, in ledger order.
export function coverageBurndown(rows: CoverageRow[]) {
  return rows.filter((row) => row.status === "partially encoded" || row.status === "pending");
}
