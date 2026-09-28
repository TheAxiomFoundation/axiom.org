import type { Metadata } from "next";
import { ScheduleBrowser } from "@/components/tariff/schedule-browser";
import { TariffStatusBlock } from "@/components/tariff/status-block";
import { coverageFamilies } from "@/lib/tariff-schedule";

export const metadata: Metadata = { title: "Tariff schedule and coverage browser — Axiom Foundation", description: "Search cited U.S. tariff schedule rates and inspect the current, incomplete encoding coverage." };
export default function TariffSchedulePage() {
  return <main className="relative z-1 px-5 pb-24 pt-32 sm:px-8"><div className="mx-auto max-w-[1080px]">
    <header className="mb-10 max-w-[800px]"><p className="kicker mb-5 inline-flex">Tariff data</p><h1 className="heading-page mb-5">Tariff schedule and coverage browser</h1><p className="font-body text-lg leading-relaxed text-[var(--color-ink-secondary)]">Search 13,790 rated Harmonized Tariff Schedule lines, inspect statutory general and column 2 rate text, and see which encoded action-family incidence lists include each line.</p></header>
    <TariffStatusBlock />
    <aside className="mt-7 border-l-2 border-[var(--color-accent)] pl-4 text-sm leading-relaxed text-[var(--color-ink-secondary)]"><strong className="text-[var(--color-ink)]">Canada Section 338 notice.</strong> U.S. note 51 — the note that governs the Section 338 headings — is not in the corpus ingest and is not encoded, so membership is not determined across the schedule. A line-specific warning appears only on the encoded witness beer line; no other membership is inferred.</aside>
    <nav aria-label="Data downloads and corrections" className="mt-7 flex flex-wrap gap-4 font-mono text-xs"><a className="text-[var(--color-accent)] underline" href="/downloads/tariff-schedule.json" download>Download JSON</a><a className="text-[var(--color-accent)] underline" href="/downloads/tariff-schedule.csv" download>Download CSV</a><a className="text-[var(--color-accent)] underline" href="https://github.com/TheAxiomFoundation/rulespec-us/issues">Changelog and corrections</a></nav>
    <section aria-labelledby="family-coverage" className="mt-10">
      <h2 id="family-coverage" className="heading-section">Coverage by action family</h2>
      <div className="mt-4 overflow-x-auto border-y border-[var(--color-rule)]">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead><tr className="font-mono text-xs uppercase tracking-wider text-[var(--color-ink-muted)]"><th className="py-3 pr-5">Action family</th><th className="py-3 pr-5">Status</th><th className="py-3">Scope note</th></tr></thead>
          <tbody>{coverageFamilies.map(([family, status, note]) => <tr key={family} className="border-t border-[var(--color-rule)] align-top"><th scope="row" className="py-3 pr-5 font-body font-medium text-[var(--color-ink)]">{family}</th><td className="py-3 pr-5 font-mono text-[var(--color-ink)]">{status}</td><td className="py-3 font-body text-[var(--color-ink-secondary)]">{note}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
    <ScheduleBrowser />
  </div></main>;
}
