import Link from "next/link";
import data from "./data/forecasts.json";
import { fmtDate, fmtNum } from "./format";

type Score = { observedValue?: number | null; observedAt?: string | null; interval80Covered?: boolean | null; normalizedCrps?: number | null; crps?: number | null; absoluteError?: number | null } | null;
export type Forecast = {
  forecastSlug: string; title: string; question: string; country: string | null; unit: string | null;
  pointEstimate: number | null; interval80: { lower: number; upper: number } | null;
  resolutionDate: string | null; resolutionSource: string | null; resolutionSourceUrl: string | null; resolutionRule: string | null;
  recordedAt?: string | null; agent?: string | null; model?: string | null; score: Score;
};
export const FORECASTS = (data as { forecasts: Forecast[] }).forecasts;
export const FORECAST_COUNTS = (data as { counts: Record<string, number> }).counts;
export const FORECASTS_AS_OF = (data as { as_of: string }).as_of;

export function statusOf(f: Forecast): "scored" | "awaiting" | "open" {
  if (f.score) return "scored";
  if (f.resolutionDate && f.resolutionDate < FORECASTS_AS_OF) return "awaiting";
  return "open";
}

export function ForecastsLog() {
  const scored = FORECASTS.filter((f) => statusOf(f) === "scored").sort((a, b) => (b.score?.observedAt || "").localeCompare(a.score?.observedAt || ""));
  const open = FORECASTS.filter((f) => statusOf(f) !== "scored").sort((a, b) => (a.resolutionDate || "").localeCompare(b.resolutionDate || ""));
  const covered = scored.filter((f) => f.score?.interval80Covered).length;
  const rows = [...scored, ...open];

  return (
    <>
      <section className="relative z-1 px-8 pb-10 pt-16">
        <div className="mx-auto max-w-[1280px]">
          <span className="kicker mb-6 inline-flex items-center">
            <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: "#A94E80" }} />
            Axiom Forecasts &middot; the log
          </span>
          <h1 className="mt-2 font-display text-[clamp(2rem,3.6vw,3.1rem)] font-light leading-[1.05] tracking-[-0.02em] text-[var(--color-ink)]">
            Every forecast, logged before the number and scored after it.
          </h1>
          <p className="mt-4 max-w-[680px] font-body text-[1.05rem] leading-relaxed text-[var(--color-ink-secondary)]">
            Headline forecasts of official statistics, with the source and the rule each one resolves against. Resolved forecasts show the observed value and the score, hits and misses alike.
          </p>
          <div className="mt-8 grid max-w-[900px] grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              [String(FORECAST_COUNTS.predictions), "forecasts logged"],
              [String(FORECASTS.length), "headline forecasts shown"],
              [String(scored.length), "resolved and scored here"],
              [`${covered} of ${scored.length}`, "inside their 80% interval"],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="font-display text-[2rem] font-light leading-none text-[var(--color-ink)]">{v}</div>
                <div className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{l}</div>
              </div>
            ))}
          </div>
          <p className="mt-6 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
            data: app.thesisinstitute.org/log.json, read {FORECASTS_AS_OF} &middot; one headline run per question; other runs and non-headline agents omitted from this table
          </p>
        </div>
      </section>

      <section className="relative z-1 px-8 pb-20" style={{ borderTop: "3px solid #A94E80" }}>
        <div className="mx-auto max-w-[1280px] overflow-x-auto pt-8">
          <table className="w-full border-collapse text-left font-body text-[0.92rem]">
            <thead>
              <tr>
                {["Forecast", "Point", "80% interval", "Resolves", "Status", "Observed", "Error", "CRPS"].map((h) => (
                  <th key={h} className="border-b border-[var(--color-rule-strong)] py-2 pr-5 font-mono text-[0.6rem] font-normal uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const st = statusOf(f);
                const s = f.score;
                return (
                  <tr key={f.forecastSlug} className="align-top">
                    <td className="border-b border-[var(--color-rule)] py-3 pr-5">
                      <Link href={`/suite/forecasts/f/${f.forecastSlug}`} className="no-underline text-[var(--color-ink)] hover:underline">{f.title}</Link>
                      <div className="mt-0.5 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{f.country || ""} {f.unit ? `· ${f.unit}` : ""}</div>
                    </td>
                    <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap text-[var(--color-ink)]">{fmtNum(f.pointEstimate)}</td>
                    <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap text-[var(--color-ink-secondary)]">{f.interval80 ? `${fmtNum(f.interval80.lower)} to ${fmtNum(f.interval80.upper)}` : "—"}</td>
                    <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap text-[var(--color-ink-secondary)]">{fmtDate(f.resolutionDate)}</td>
                    <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap">
                      <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em]" style={{ color: st === "scored" ? (s?.interval80Covered ? "#3E7A5E" : "#A94E80") : "var(--color-ink-muted)" }}>
                        {st === "scored" ? (s?.interval80Covered ? "scored · covered" : "scored · missed") : st === "awaiting" ? "awaiting resolution" : "open"}
                      </span>
                    </td>
                    <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap text-[var(--color-ink)]">{s ? fmtNum(s.observedValue) : "—"}</td>
                    <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap font-mono text-[0.8rem] text-[var(--color-ink-secondary)]">{s?.absoluteError != null ? fmtNum(s.absoluteError) : "—"}</td>
                    <td className="border-b border-[var(--color-rule)] py-3 pr-5 whitespace-nowrap font-mono text-[0.8rem] text-[var(--color-ink-secondary)]">{s?.crps != null ? s.crps.toFixed(2) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
