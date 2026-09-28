"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { TariffLine } from "@/lib/tariff-schedule";

const PAGE_SIZE = 100;
export function ScheduleBrowser() {
  const [lines, setLines] = useState<TariffLine[]>([]); const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState(""); const [shown, setShown] = useState(PAGE_SIZE); const deferred = useDeferredValue(query.trim().toLowerCase());
  useEffect(() => { fetch("/downloads/tariff-schedule.json").then((response) => { if (!response.ok) throw new Error("schedule unavailable"); return response.json(); }).then((data) => setLines(data.lines)).catch(() => setLoadError(true)); }, []);
  const results = useMemo(() => {
    if (!deferred) return lines;
    const code = deferred.replace(/\D/g, "");
    return lines.filter((line) => (code && line.hts10.startsWith(code)) || line.description.toLowerCase().includes(deferred));
  }, [deferred, lines]);
  return <section aria-labelledby="schedule-results" className="mt-10">
    <label htmlFor="tariff-search" className="block font-body text-sm font-medium text-[var(--color-ink)]">Search by HTS code prefix or description</label>
    <input id="tariff-search" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE_SIZE); }} placeholder="For example, 2203 or beer" className="mt-2 w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-4 py-3 font-body text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]" />
    <div className="mt-4 flex items-baseline justify-between gap-4">
      <h2 id="schedule-results" className="m-0 font-body text-lg font-medium text-[var(--color-ink)]">Schedule lines</h2>
      <p aria-live="polite" className="m-0 font-mono text-xs text-[var(--color-ink-muted)]">{loadError ? "Schedule unavailable" : lines.length ? `${results.length.toLocaleString()} results` : "Loading schedule"}</p>
    </div>
    <div className="mt-3 overflow-x-auto border-y border-[var(--color-rule)]">
      <table className="w-full min-w-[720px] border-collapse text-left"><thead><tr className="font-mono text-xs uppercase tracking-wider text-[var(--color-ink-muted)]"><th className="py-3 pr-5">HTS code</th><th className="py-3 pr-5">Description</th><th className="py-3 pr-5">General</th><th className="py-3">Column 2</th></tr></thead>
      <tbody>{results.slice(0, shown).map((line) => <tr key={line.hts10} className="border-t border-[var(--color-rule)] align-top text-sm">
        <td className="py-4 pr-5 font-mono"><Link className="text-[var(--color-accent)] underline" href={`/tariff/schedule/${line.hts10}`}>{line.displayCode}</Link></td>
        <td className="max-w-[480px] py-4 pr-5 font-body text-[var(--color-ink-secondary)]">{line.description}</td><td className="py-4 pr-5 font-mono text-[var(--color-ink)]">{line.generalRate}</td><td className="py-4 font-mono text-[var(--color-ink)]">{line.column2Rate}</td>
      </tr>)}</tbody></table>
    </div>
    {shown < results.length && <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} className="btn-outline mt-6">Show 100 more</button>}
  </section>;
}
