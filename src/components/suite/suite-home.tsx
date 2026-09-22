import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { SUITE_AS_OF, SUITE_LINES, type SuiteLine } from "./lines";
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

function Formerly({ line }: { line: SuiteLine }) {
  return (
    <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
      today: {line.today.name} &middot; {line.today.domain}
    </p>
  );
}

const SPECIMENS: { where: string; text: string }[] = [
  {
    where: "A news clause",
    text: "…would cost $317 billion over ten years, according to the Axiom Institute, a nonprofit that builds open models of law and policy.",
  },
  {
    where: "A methods section",
    text: "Estimates are from Axiom Simulator (v1.x), which applies the Axiom Rules encodings to the Axiom Microcosm synthetic population.",
  },
  {
    where: "A fiscal note source line",
    text: "Estimate produced with Axiom Simulator, an open-source microsimulation model published by Axiom; parameters in Appendix A.",
  },
  {
    where: "A terminal",
    text: "pip install policyengine-us   # package names stay as they are",
  },
];

export function SuiteHome() {
  const [rules, ...others] = SUITE_LINES;

  return (
    <>
      <FlipHero />

      <section id="lines" className="relative z-1 px-8 pb-24">
        <div className="mx-auto max-w-[1280px]">
          {/* Rules leads: the law is what every other line computes on. */}
          <Link
            href={`/suite/${rules.slug}`}
            className="card-edition group no-underline min-w-0 mb-5 grid gap-10 p-8 transition-transform duration-300 hover:-translate-y-1 md:grid-cols-[1.4fr_1fr] md:p-10"
            style={{ borderTop: `3px solid ${rules.hue}` }}
          >
            <div>
              <Formerly line={rules} />
              <h2 className="mt-3 font-display text-[clamp(1.8rem,3vw,2.6rem)] font-light leading-tight tracking-[-0.01em] text-[var(--color-ink)]">
                {rules.name}
              </h2>
              <p className="serif-italic mt-1 text-[1.15rem] text-[var(--color-ink)]">
                {rules.forAll}
              </p>
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
                <Formerly line={line} />
                <h2 className="mt-3 font-display text-[1.7rem] font-light leading-tight tracking-[-0.01em] text-[var(--color-ink)]">
                  {line.name}
                </h2>
                <p className="serif-italic mt-1 text-[1.05rem] text-[var(--color-ink)]">
                  {line.forAll}
                </p>
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

      <section className="relative z-1 border-t border-[var(--color-rule)] px-8 py-20">
        <div className="mx-auto max-w-[1280px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            The name in the wild
          </span>
          <h2 className="heading-section mb-3 mt-2">
            Where people would meet it.
          </h2>
          <p className="mb-10 max-w-[640px] font-body text-lg leading-relaxed text-[var(--color-ink-secondary)]">
            Most people never see a homepage. They see the name in a sentence
            somebody else wrote. Four specimens, written for this mock.
          </p>
          <div className="grid gap-5 md:grid-cols-2">
            {SPECIMENS.map((s) => (
              <figure key={s.where} className="card-edition p-6">
                <figcaption className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
                  {s.where} &middot; specimen
                </figcaption>
                <blockquote
                  className={`mt-3 text-[1rem] leading-relaxed text-[var(--color-ink)] ${
                    s.where === "A terminal" ? "font-mono text-[0.85rem]" : "font-body"
                  }`}
                >
                  {s.text}
                </blockquote>
              </figure>
            ))}
          </div>
          <p className="mt-10 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
            Prototype &middot; figures as of {SUITE_AS_OF} &middot; the
            specimens are invented for the mock; everything else is each
            program&apos;s own published copy
          </p>
        </div>
      </section>
    </>
  );
}
