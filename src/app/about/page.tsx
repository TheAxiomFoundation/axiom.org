import Link from "next/link";
import type { Metadata } from "next";
import { DemoThumb } from "@/components/landing/demo-thumb";
import { Reveal, RevealGroup, RevealItem } from "@/components/landing/reveal";

export const metadata: Metadata = {
  title: "About — Axiom Foundation",
  description:
    "The Axiom Foundation publishes open, machine-readable encodings of the world's rules, starting with tax and benefit policy — cited, time-aware, and executable.",
};

const BUILD = [
  {
    n: "01",
    title: "The Axiom App",
    desc: "Explore the law: fetch and cite source documents, inspect the RuleSpec encodings that make them executable, and trace the logic through the computation graph. Every value cites its statute; every clause carries an effective date.",
    href: "/axiom",
  },
  {
    n: "02",
    title: "RuleSpec",
    desc: "The open format for encoding statutes and regulations as executable, cited rules.",
    href: "/docs",
  },
  {
    n: "03",
    title: "The Encoder",
    desc: "An AI-assisted pipeline that reads source law, drafts encodings subsection by subsection, and logs every decision with its provenance.",
    // Held back for now — the /encoder page link returns later.
    href: null,
  },
  {
    n: "04",
    title: "Validation",
    desc: "The harness that runs every encoding against engines we don't control — and publishes the comparison so anyone can re-run it.",
    href: "/validation",
  },
];

/** Editorial two-column band: mono label left, prose right. */
function ProseBand({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Reveal className="border-t border-[var(--color-rule)] py-12 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-12">
      <h2 className="m-0 font-display text-[1.35rem] font-light tracking-[0.02em] leading-snug text-[var(--color-ink)] md:pt-0.5">
        <span aria-hidden className="mb-3 hidden h-px w-7 bg-[var(--color-accent)] md:block" />
        {label}
      </h2>
      <div>{children}</div>
    </Reveal>
  );
}

export default function AboutPage() {
  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="max-w-[960px] mx-auto">
        {/* Header — descriptor as the lede */}
        <Reveal className="mb-20 max-w-[760px]">
          <h1 className="heading-page mb-7">About Axiom</h1>
          <p className="font-body text-[1.35rem] text-[var(--color-ink-secondary)] leading-[1.65] text-pretty">
            The Axiom Foundation publishes open, machine-readable encodings of the
            world&apos;s rules, starting with tax and benefit policy &mdash;
            statutes, regulations, and policy rules turned into{" "}
            <span className="serif-italic text-[var(--color-ink)]">
              cited, time-aware, executable code
            </span>{" "}
            that anyone can run, audit, or reform.
          </p>
          <Link
            href="/overview"
            className="mt-7 inline-flex items-center gap-2 rounded-md border border-[var(--color-rule)] px-5 py-2.5 font-mono text-[0.8rem] tracking-[0.12em] text-[var(--color-accent)] no-underline transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            Read the one-page overview &rarr;
          </Link>
        </Reveal>

        <ProseBand label="Why">
          <p className="m-0 font-body text-[1.05rem] text-[var(--color-ink-secondary)] leading-relaxed text-pretty">
            The rules that decide who gets food assistance, health coverage, and
            tax credits are written in prose &mdash; then re-implemented,
            separately and privately, inside every eligibility system,
            calculator, and policy tool that needs them. The interpretation
            lives in closed code: hard to verify, harder to fix, duplicated
            everywhere. The Axiom Foundation publishes that layer in the open, so
            there is{" "}
            <span className="serif-italic text-[var(--color-ink)]">
              one cited, checkable source for what a rule actually computes
            </span>
            .
          </p>
        </ProseBand>

        {/* What we build — numbered edition cards */}
        <Reveal className="border-t border-[var(--color-rule)] py-12">
          <h2 className="m-0 mb-8 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
            <span aria-hidden className="mb-3 block h-px w-7 bg-[var(--color-accent)]" />
            What we build
          </h2>
          <RevealGroup
            className="grid gap-5 sm:grid-cols-2"
            staggerChildren={0.08}
          >
            {BUILD.map((card) => (
              <RevealItem
                key={card.n}
                as="div"
                className="card-edition p-7 flex flex-col transition-transform duration-300 hover:-translate-y-1"
              >
                <div className="flex items-baseline justify-between mb-4">
                  <span className="font-mono text-[0.65rem] tracking-[0.18em] text-[var(--color-ink-muted)]">
                    {card.n}
                  </span>
                  <span className="h-px flex-1 mx-4 bg-[var(--color-rule-subtle)]" />
                </div>
                <h3 className="font-display text-[1.25rem] font-light tracking-[0.02em] text-[var(--color-ink)] mb-3 leading-snug">
                  {card.title}
                </h3>
                <p className="m-0 font-body text-[0.92rem] text-[var(--color-ink-secondary)] leading-relaxed">
                  {card.desc}
                </p>
                {card.href && (
                  <Link
                    href={card.href}
                    className="mt-auto pt-4 inline-flex items-center gap-2 font-mono text-[0.68rem] tracking-[0.14em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
                  >
                    Explore &rarr;
                  </Link>
                )}
              </RevealItem>
            ))}
          </RevealGroup>

          {/* Demos highlight — a two-column card: the pitch on the
              left, a thumb of the gallery on the right (live iframe on
              desktop only — see DemoThumb). */}
          <Reveal className="mt-8">
            <Link
              href="/demos"
              className="card-edition group/demos grid gap-6 p-7 no-underline transition-transform duration-300 hover:-translate-y-1 md:grid-cols-2 md:items-center"
            >
              <div>
                <h3 className="font-display text-[1.25rem] font-light tracking-[0.02em] text-[var(--color-ink)] mb-3 leading-snug">
                  See it running
                </h3>
                <p className="m-0 font-body text-[0.95rem] text-[var(--color-ink-secondary)] leading-relaxed">
                  We also build demonstrations on top of this layer &mdash;
                  previews of what open, computable law makes possible.{" "}
                  <span className="serif-italic text-[var(--color-ink)]">
                    The layer underneath is the product.
                  </span>
                </p>
                <span className="mt-5 inline-flex items-center gap-2 font-mono text-[0.68rem] tracking-[0.14em] uppercase text-[var(--color-accent)] group-hover/demos:text-[var(--color-accent-hover)] transition-colors">
                  Open the demo gallery &rarr;
                </span>
              </div>
              <DemoThumb
                src="https://axiom-demo-shell.vercel.app/demos/"
                poster="/demo-posters/gallery.png"
                title="Demo gallery — preview"
              />
            </Link>
          </Reveal>
        </Reveal>

        <ProseBand label="How we verify">
          <p className="m-0 font-body text-[1.05rem] text-[var(--color-ink-secondary)] leading-relaxed text-pretty">
            We cross-check every encoding against independent engines and
            datasets: PolicyEngine, TAXSIM, UKMOD, EUROMOD, SOUTHMOD, the PSL
            Tax-Calculator, and SNAP quality-control data. Open isn&apos;t
            enough &mdash; the point is that{" "}
            <span className="serif-italic text-[var(--color-ink)]">
              you can check our work
            </span>
            . Our team has spent years keeping tax-and-benefit rules correct at
            scale, in government, research, and open source.
          </p>
          <Link
            href="/validation"
            className="mt-5 inline-flex items-center gap-2 font-mono text-[0.68rem] tracking-[0.14em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
          >
            See the validation dashboard &rarr;
          </Link>
        </ProseBand>

        <ProseBand label="How we're organized">
          <p className="m-0 font-body text-[1.05rem] text-[var(--color-ink-secondary)] leading-relaxed text-pretty">
            The Axiom Foundation is a fiscally sponsored project of the{" "}
            <a
              href="https://psl-foundation.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] no-underline"
            >
              PSL Foundation
            </a>
            . Our code, our data, and our encoding decisions are public.
          </p>
          <a
            href="https://github.com/TheAxiomFoundation"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 font-mono text-[0.68rem] tracking-[0.14em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
          >
            Browse the code on GitHub &rarr;
          </a>
        </ProseBand>

        <ProseBand label="Founding team">
          <p className="m-0 font-body text-[1.05rem] text-[var(--color-ink-secondary)] leading-relaxed">
            The Axiom Foundation&apos;s founding team is Max Ghenis (CEO and
            Founder), Ariel Kennan (President), and Pavel Makarchuk (Product
            Lead).
          </p>
          <Link
            href="/team"
            className="mt-5 inline-flex items-center gap-2 rounded-md border border-[var(--color-rule)] px-5 py-2.5 font-mono text-[0.8rem] tracking-[0.12em] text-[var(--color-accent)] no-underline transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
          >
            Meet the team &rarr;
          </Link>
        </ProseBand>

        {/* Get in touch — quiet closing card */}
        <Reveal className="border-t border-[var(--color-rule)] pt-16 text-center">
          <h2 className="m-0 mb-5 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
            <span aria-hidden className="mx-auto mb-3 block h-px w-7 bg-[var(--color-accent)]" />
            Get in touch
          </h2>
          <div className="inline-block px-7 py-3.5 bg-[var(--color-paper-elevated)] border border-[var(--color-rule)] rounded-md transition-transform duration-300 hover:-translate-y-0.5">
            <a
              href="mailto:hello@axiom.org"
              className="font-mono text-[var(--color-accent)] text-[0.95rem] no-underline hover:underline"
            >
              hello@axiom.org
            </a>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
