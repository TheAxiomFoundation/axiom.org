import data from "./data/journal.json";
import { fmtDate, fmtNum } from "./format";

type Row = { line: number; id: string; label: string; value: number | null; unit: string | null; observed_at: string | null; period: string | null; domain: string | null; geo: string | null; accepted_at: string | null; custody: string | null; sha: string | null };
const ROWS = (data as { rows: Row[] }).rows;
const AS_OF = (data as { as_of: string }).as_of;
const PINS = (data as { pins: Record<string, unknown> | null }).pins;

export function RecordsJournal() {
  const rows = [...ROWS].sort((a, b) => b.line - a.line);
  const domains = rows.reduce<Record<string, number>>((acc, r) => { const k = r.domain || "other"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  return (
    <>
      <section className="relative z-1 px-8 pb-10 pt-16">
        <div className="mx-auto max-w-[1280px]">
          <span className="kicker mb-6 inline-flex items-center">
            <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: "#33547D" }} />
            Axiom Records &middot; the journal
          </span>
          <h1 className="mt-2 font-display text-[clamp(2rem,3.6vw,3.1rem)] font-light leading-[1.05] tracking-[-0.02em] text-[var(--color-ink)]">
            What official sources printed, and when: an append-only journal.
          </h1>
          <p className="mt-4 max-w-[680px] font-body text-[1.05rem] leading-relaxed text-[var(--color-ink-secondary)]">
            Each line is a value as first published by a statistical agency, with the date it was observed and the date the journal accepted it. Lines are never edited; a later print gets a later line.
          </p>
          <div className="mt-8 grid max-w-[900px] grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              [String(rows.length), "journal lines"],
              [String(Object.keys(domains).length), "domains"],
              [String(new Set(rows.map((r) => r.geo)).size), "geographies"],
              [fmtDate(rows[0]?.accepted_at), "latest accepted"],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="font-display text-[2rem] font-light leading-none text-[var(--color-ink)]">{v}</div>
                <div className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{l}</div>
              </div>
            ))}
          </div>
          <p className="mt-6 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
            data: chronicle.institute/api/journal, read {AS_OF}{PINS && typeof (PINS as { lineCount?: number }).lineCount === "number" ? ` · pinned line count ${(PINS as { lineCount?: number }).lineCount}` : ""} &middot; the store of 39,173 parsed facts is not shown here
          </p>
        </div>
      </section>
      <section className="relative z-1 px-8 pb-20" style={{ borderTop: "3px solid #33547D" }}>
        <div className="mx-auto max-w-[1280px] overflow-x-auto pt-8">
          <table className="w-full border-collapse text-left font-body text-[0.92rem]">
            <thead>
              <tr>
                {["Line", "Fact", "Value", "Period", "First print", "Accepted", "Address"].map((h) => (
                  <th key={h} className="border-b border-[var(--color-rule-strong)] py-2 pr-5 font-mono text-[0.6rem] font-normal uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} className="align-top">
                  <td className="border-b border-[var(--color-rule)] py-3 pr-5 font-mono text-[0.8rem] text-[var(--color-ink-muted)]">{r.line}</td>
                  <td className="border-b border-[var(--color-rule)] py-3 pr-5 text-[var(--color-ink)]">
                    {r.label}
                    <div className="mt-0.5 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{r.geo || ""}{r.domain ? ` · ${r.domain}` : ""}</div>
                  </td>
                  <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap text-[var(--color-ink)]">{fmtNum(r.value, r.unit)}</td>
                  <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap text-[var(--color-ink-secondary)]">{r.period || "—"}</td>
                  <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap text-[var(--color-ink-secondary)]">{fmtDate(r.observed_at)}</td>
                  <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap text-[var(--color-ink-secondary)]">{fmtDate(r.accepted_at)}</td>
                  <td className="border-b border-[var(--color-rule)] py-3 pr-5 font-mono text-[0.72rem] text-[var(--color-ink-muted)]">{r.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
