import type { Metadata } from "next";
import { ScheduleBrowser } from "@/components/tariff/schedule-browser";
import { TariffStatusBlock } from "@/components/tariff/status-block";
import { displayStatus, type IncidenceTable } from "@/lib/tariff-coverage";
import { getTariffMetadata } from "@/lib/tariff-schedule";

function incidenceSummary(table: IncidenceTable) {
  const lines = `${table.lineCount.toLocaleString("en-US")} rate ${table.lineCount === 1 ? "line" : "lines"}`;
  const suffix = table.suffixOnlyLineCount ? `, ${table.suffixOnlyLineCount.toLocaleString("en-US")} of them through statistical numbers only` : "";
  return `subdivisions ${table.subdivisions.join(", ")}; ${lines}${suffix}`;
}

export const metadata: Metadata = { title: "Tariff schedule and coverage browser — Axiom Foundation", description: "Search cited U.S. tariff schedule rates and inspect the current, incomplete encoding coverage." };
export default function TariffSchedulePage() {
  const tariff = getTariffMetadata();
  return <main className="relative z-1 px-5 pb-24 pt-32 sm:px-8"><div className="mx-auto max-w-[1080px]">
    <header className="mb-10 max-w-[800px]"><p className="kicker mb-5 inline-flex">Tariff data</p><h1 className="heading-page mb-5">Tariff schedule and coverage browser</h1><p className="font-body text-lg leading-relaxed text-[var(--color-ink-secondary)]">Search {tariff.lineCount.toLocaleString("en-US")} rated Harmonized Tariff Schedule lines, inspect statutory general and column 2 rate text, and see which encoded incidence tables include each line.</p></header>
    <TariffStatusBlock />
    <aside className="mt-7 border-l-2 border-[var(--color-accent)] pl-4 text-sm leading-relaxed text-[var(--color-ink-secondary)]"><strong className="text-[var(--color-ink)]">Canada Section 338 notice.</strong> U.S. note 51, inserted by Proclamation 11046 (Annex II), lists the Canadian goods subject to heading 9903.03.12. That list is not encoded, so Section 338 membership is not determined across the schedule. Only the beer line 2203.00.00 carries a warning, because the encoded witness entry (2203.00.00.30) falls under it; no other membership is inferred.</aside>
    <nav aria-label="Data downloads and corrections" className="mt-7 flex flex-wrap gap-4 font-mono text-xs"><a className="text-[var(--color-accent)] underline" href="/downloads/tariff-schedule.json" download>Download JSON</a><a className="text-[var(--color-accent)] underline" href="/downloads/tariff-schedule.csv" download>Download CSV</a><a className="text-[var(--color-accent)] underline" href="https://github.com/TheAxiomFoundation/rulespec-us/issues">Changelog and corrections</a></nav>
    <section aria-labelledby="family-coverage" className="mt-10">
      <h2 id="family-coverage" className="heading-section">Coverage by action family</h2>
      <p className="mt-3 max-w-[800px] font-body text-sm leading-relaxed text-[var(--color-ink-secondary)]">Each status and count is the certificate&apos;s closure-ledger decision. The scope notes follow the encoded rules: where a note says a rate is composed or membership is an entry input, the build checks it in all 100 chapter compositions at rulespec-us {tariff.rulespecCommit.slice(0, 10)}. For the Brazil, note 52, China 2024, and China solar families, the ledger&apos;s stated reason (not fed into the final composition) disagrees with those rules; the statuses agree.</p>
      <div className="mt-4 overflow-x-auto border-y border-[var(--color-rule)]">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead><tr className="font-mono text-xs uppercase tracking-wider text-[var(--color-ink-muted)]"><th className="py-3 pr-5">Action family</th><th className="py-3 pr-5">Status</th><th className="py-3">Scope note</th></tr></thead>
          <tbody>{tariff.coverageFamilies.map((row) => <tr key={row.ledgerFamily} className="border-t border-[var(--color-rule)] align-top"><th scope="row" className="py-3 pr-5 font-body font-medium text-[var(--color-ink)]">{row.family}</th><td className="py-3 pr-5 font-mono text-[var(--color-ink)]">{displayStatus(row.status)}</td><td className="py-3 font-body text-[var(--color-ink-secondary)]">{row.note}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
    <section aria-labelledby="incidence-tables" className="mt-10">
      <h2 id="incidence-tables" className="heading-section">Incidence tables behind line memberships</h2>
      <p className="mt-3 max-w-[800px] font-body text-sm leading-relaxed text-[var(--color-ink-secondary)]">Line pages show a membership only from a table at the build pin, and each table encodes only the subdivisions listed. The compositions take membership as an entry input rather than reading these tables.</p>
      <ul className="mt-4 grid gap-2 pl-5 text-sm text-[var(--color-ink-secondary)]">
        {tariff.incidenceTables.map((table) => <li key={table.note}><strong className="text-[var(--color-ink)]">{table.note}, {table.family}</strong> — {table.module ? incidenceSummary(table) : table.detail}</li>)}
      </ul>
    </section>
    <ScheduleBrowser />
  </div></main>;
}
