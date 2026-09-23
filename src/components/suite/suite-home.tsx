import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { SUITE_LINES, type SuiteLine } from "./lines";
import { FlipHero } from "./flip-hero";

function Figure({ line, large = false }: { line: SuiteLine; large?: boolean }) {
  if (!line.figure) return null;
  return (
    <div className="min-w-0">
      <div
        className={`font-display font-light leading-none tracking-[-0.02em] text-[var(--color-ink)] ${
          large ? "text-[clamp(2.6rem,5vw,4rem)]" : "text-[2rem]"
        }`}
      >
        {line.figure.value}
      </div>
      <div className="mt-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
        {line.figure.label} &middot; {line.figure.source}
      </div>
    </div>
  );
}

export function SuiteHome() {
  const [rules, ...others] = SUITE_LINES;

  return (
    <>
      <FlipHero />

      <section id="lines" className="relative z-1 px-8 pb-24">
        <div className="mx-auto max-w-[1280px]">
          {/* Rules leads the page. */}
          <Link
            href={`/suite/${rules.slug}`}
            className="card-edition group no-underline min-w-0 mb-5 grid gap-10 p-8 transition-transform duration-300 hover:-translate-y-1 md:grid-cols-[1.4fr_1fr] md:p-10"
            style={{ borderTop: `3px solid ${rules.hue}` }}
          >
            <div>
              <h2 className="mt-3 font-display text-[clamp(1.8rem,3vw,2.6rem)] font-light leading-tight tracking-[-0.01em] text-[var(--color-ink)]">
                {rules.name}
              </h2>
              <p className="mt-4 max-w-[560px] font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
                {rules.body}
              </p>
              <span className="mt-6 inline-flex items-center gap-2 font-body text-[0.95rem] text-[var(--color-accent-hover)]">
                {rules.cta}
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>
            <div className="flex items-end md:justify-end">
              <Figure line={rules} large />
            </div>
          </Link>

          <div className="grid gap-5 md:grid-cols-2">
            {others.map((line) => (
              <Link
                key={line.slug}
                href={`/suite/${line.slug}`}
                className="card-edition group no-underline min-w-0 flex flex-col p-7 transition-transform duration-300 hover:-translate-y-1"
                style={{ borderTop: `3px solid ${line.hue}` }}
              >
                <h2 className="mt-3 font-display text-[1.7rem] font-light leading-tight tracking-[-0.01em] text-[var(--color-ink)]">
                  {line.name}
                </h2>
                <p className="mt-3 flex-1 font-body text-[0.95rem] leading-relaxed text-[var(--color-ink-secondary)]">
                  {line.body}
                </p>
                <div className="mt-6 flex min-w-0 items-end justify-between gap-6">
                  <Figure line={line} />
                  <ArrowRightIcon className="h-5 w-5 shrink-0 text-[var(--color-ink-muted)] transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

    </>
  );
}
