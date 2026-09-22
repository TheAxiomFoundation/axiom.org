import data from "./data/microcosm.json";
import { fmtDate, pct } from "./format";

type M = typeof data;
const m = data as M;

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 700 + 20},${110 - ((v - min) / (max - min || 1)) * 90}`).join(" ");
  return (
    <svg viewBox="0 0 740 130" className="w-full max-w-[740px]" role="img" aria-label="Calibration loss over training">
      <polyline points={pts} fill="none" stroke="#3E7A5E" strokeWidth={2.5} />
      <text x={20} y={125} fontFamily="var(--font-mono)" fontSize={10} fill="var(--color-ink-muted)">epoch 0 · loss {m.initial_loss.toFixed(3)}</text>
      <text x={720} y={125} textAnchor="end" fontFamily="var(--font-mono)" fontSize={10} fill="var(--color-ink-muted)">epoch {m.epochs} · loss {m.final_loss.toFixed(4)}</text>
    </svg>
  );
}

export function MicrocosmRelease() {
  const cov = m.coverage_summary as { hard_target: { families: number; package_aliases: number; covered_package_aliases: number; missing_package_aliases: number }; validation_only: { families: number }; source_gap: { families: number; missing_source_packages: number } };
  const gate = m.gate as { name: string; passed: boolean };
  return (
    <>
      <section className="relative z-1 px-8 pb-10 pt-16">
        <div className="mx-auto max-w-[1280px]">
          <span className="kicker mb-6 inline-flex items-center">
            <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: "#3E7A5E" }} />
            Axiom Microcosm &middot; latest US release
          </span>
          <h1 className="mt-2 font-display text-[clamp(2rem,3.6vw,3.1rem)] font-light leading-[1.05] tracking-[-0.02em] text-[var(--color-ink)]">
            <span className="font-mono text-[0.55em] tracking-normal">{m.release_id}</span>
          </h1>
          <p className="mt-4 max-w-[720px] font-body text-[1.05rem] leading-relaxed text-[var(--color-ink-secondary)]">
            The economy in miniature: {m.n_records.toLocaleString()} synthetic households, weighted so that {m.n_targets.toLocaleString()} published totals come out right. No real person or firm appears in it. Published {fmtDate(m.updated_at)} on Hugging Face as <span className="font-mono text-[0.9em]">{m.repo}</span>.
          </p>
          <div className="mt-8 grid max-w-[1000px] grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              [m.n_records.toLocaleString(), "synthetic households"],
              [m.n_targets.toLocaleString(), "calibration targets"],
              [pct(m.fraction_within_10pct), "targets within 10%"],
              [Math.round(m.effective_sample_size).toLocaleString(), "effective sample size"],
              [m.realized_max_weight_ratio.toFixed(2), "max weight ratio (cap 5)"],
              [pct(m.top_1pct_weight_share), "weight in the top 1%"],
              [m.n_nonzero.toLocaleString(), "records with nonzero weight"],
              [gate?.passed ? "passed" : "failed", `coverage gate · ${gate?.name || ""}`],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="font-display text-[1.8rem] font-light leading-none text-[var(--color-ink)]">{v}</div>
                <div className="mt-2 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="relative z-1 px-8 py-12" style={{ borderTop: "3px solid #3E7A5E" }}>
        <div className="mx-auto grid max-w-[1280px] gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="mb-3 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">calibration · {m.method} · {m.epochs.toLocaleString()} epochs · weight entity {m.weight_entity}</p>
            <Sparkline values={m.loss_trajectory} />
          </div>
          <dl className="grid gap-3 font-body text-[0.92rem]">
            {[
              ["Release type", String(m.release_type)],
              ["Runs with", (m.compatible_model_packages as { name: string; specifier: string }[]).map((p) => `${p.name} ${p.specifier}`).join(", ") + "; " + (m.compatible_core_packages as { name: string; specifier: string }[]).map((p) => `${p.name} ${p.specifier}`).join(", ")],
              ["Data package", `${(m.data_package as { name: string; version: string }).name} ${(m.data_package as { name: string; version: string }).version}`],
              ["Source coverage", `${cov.hard_target.families} hard-target families · ${cov.hard_target.covered_package_aliases} of ${cov.hard_target.package_aliases} package aliases covered, ${cov.hard_target.missing_package_aliases} missing · ${cov.source_gap.families} families with source gaps`],
            ].map(([k, v]) => (
              <div key={k} className="border-b border-[var(--color-rule)] pb-3">
                <dt className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">{k}</dt>
                <dd className="mt-1 text-[var(--color-ink)]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mx-auto mt-10 max-w-[1280px] font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">Source: the release manifests on Hugging Face, read {m.as_of}</p>
      </section>
    </>
  );
}
