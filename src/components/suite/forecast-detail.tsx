import Link from "next/link";
import { FORECASTS, FORECASTS_AS_OF, statusOf, type Forecast } from "./forecasts-log";
import { fmtDate, fmtNum } from "./format";

function IntervalChart({ f }: { f: Forecast }) {
  if (!f.interval80 || f.pointEstimate == null) return null;
  const obs = f.score?.observedValue ?? null;
  const vals = [f.interval80.lower, f.interval80.upper, f.pointEstimate, ...(obs != null ? [obs] : [])];
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.25 || 1;
  const lo = min - pad, hi = max + pad;
  const x = (v: number) => 40 + ((v - lo) / (hi - lo)) * 720;
  const covered = f.score?.interval80Covered;
  const color = obs == null ? "#A94E80" : covered ? "#3E7A5E" : "#A94E80";
  return (
    <svg viewBox="0 0 800 120" className="w-full max-w-[800px]" role="img" aria-label="Forecast interval and observed value">
      <line x1={40} x2={760} y1={70} y2={70} stroke="var(--color-rule)" strokeWidth={1} />
      <rect x={x(f.interval80.lower)} y={58} width={x(f.interval80.upper) - x(f.interval80.lower)} height={24} fill={color} opacity={0.18} />
      <line x1={x(f.pointEstimate)} x2={x(f.pointEstimate)} y1={50} y2={90} stroke={color} strokeWidth={3} />
      <text x={x(f.pointEstimate)} y={40} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill="var(--color-ink)">forecast {fmtNum(f.pointEstimate)}</text>
      <text x={x(f.interval80.lower)} y={106} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10} fill="var(--color-ink-muted)">{fmtNum(f.interval80.lower)}</text>
      <text x={x(f.interval80.upper)} y={106} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={10} fill="var(--color-ink-muted)">{fmtNum(f.interval80.upper)}</text>
      {obs != null ? (
        <>
          <circle cx={x(obs)} cy={70} r={7} fill="var(--color-ink)" />
          <text x={x(obs)} y={22} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fill="var(--color-ink)">observed {fmtNum(obs)}</text>
        </>
      ) : null}
    </svg>
  );
}

export function ForecastDetail({ f }: { f: Forecast }) {
  const st = statusOf(f);
  const s = f.score;
  const verdict = st === "scored" ? (s?.interval80Covered ? "Inside the 80% interval." : "Outside the 80% interval. A miss, on the record.") : st === "awaiting" ? "Past its resolution date; the official number has not arrived." : "Open until the official number arrives.";
  return (
    <>
      <section className="relative z-1 px-8 pb-10 pt-16">
        <div className="mx-auto max-w-[1280px]">
          <Link href="/suite/forecasts/log" className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] no-underline hover:text-[var(--color-ink)]">&larr; Axiom Forecasts · the log</Link>
          <h1 className="mt-6 max-w-[960px] font-display text-[clamp(1.8rem,3.2vw,2.8rem)] font-light leading-[1.08] tracking-[-0.02em] text-[var(--color-ink)]">{f.title}</h1>
          <p className="mt-4 max-w-[760px] font-body text-[1.02rem] leading-relaxed text-[var(--color-ink-secondary)]">{f.question}</p>
          <p className="serif-italic mt-5 text-[1.15rem]" style={{ color: st === "scored" && !s?.interval80Covered ? "#A94E80" : "var(--color-ink)" }}>{verdict}</p>
        </div>
      </section>
      <section className="relative z-1 px-8 py-10" style={{ borderTop: "3px solid #A94E80" }}>
        <div className="mx-auto grid max-w-[1280px] gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <IntervalChart f={f} />
            <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-5">
              {[
                [fmtNum(f.pointEstimate, f.unit), "point forecast"],
                [f.interval80 ? `${fmtNum(f.interval80.lower)} to ${fmtNum(f.interval80.upper)}` : "—", "80% interval"],
                [s ? fmtNum(s.observedValue, f.unit) : "—", "observed"],
                [s?.absoluteError != null ? fmtNum(s.absoluteError, f.unit) : "—", "absolute error"],
                [s?.crps != null ? s.crps.toFixed(2) : "—", "CRPS (same units)"],
              ].map(([v, l]) => (
                <div key={l}>
                  <div className="font-display text-[1.5rem] font-light leading-none text-[var(--color-ink)]">{v}</div>
                  <div className="mt-2 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <dl className="grid gap-3 font-body text-[0.92rem]">
            {[
              ["Recorded", f.recordedAt ? fmtDate(f.recordedAt) : "—"],
              ["Resolves", `${fmtDate(f.resolutionDate)}${s?.observedAt ? ` · observed ${fmtDate(s.observedAt)}` : ""}`],
              ["Resolution source", f.resolutionSource || "—"],
              ["Agent · model", `${f.agent || "—"} · ${f.model || "—"}`],
              ["Scoring rule", s ? "numeric CDF CRPS, ledger scale" : "—"],
            ].map(([k, v]) => (
              <div key={k} className="border-b border-[var(--color-rule)] pb-3">
                <dt className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{k}</dt>
                <dd className="mt-1 text-[var(--color-ink)]">{v}</dd>
              </div>
            ))}
            {f.resolutionSourceUrl ? (
              <a href={f.resolutionSourceUrl} className="font-body text-[0.9rem] text-[var(--color-accent-hover)]" target="_blank" rel="noopener noreferrer">Open the resolution source &rarr;</a>
            ) : null}
          </dl>
        </div>
        <div className="mx-auto mt-10 max-w-[1280px]">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">resolution rule</p>
          <p className="mt-2 max-w-[900px] font-body text-[0.9rem] leading-relaxed text-[var(--color-ink-secondary)]">{f.resolutionRule || "—"}</p>
          <p className="mt-8 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">Source: app.thesisinstitute.org, read {FORECASTS_AS_OF}</p>
        </div>
      </section>
    </>
  );
}

export function forecastBySlug(slug: string): Forecast | undefined {
  return FORECASTS.find((f) => f.forecastSlug === slug);
}
