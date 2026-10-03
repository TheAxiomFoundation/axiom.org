import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { Reveal, RevealGroup, RevealItem } from "@/components/landing/reveal";

export const metadata: Metadata = {
  title: "Validation — Axiom Foundation",
  description:
    "How the Axiom Foundation compares its encodings with other calculators and USDA's SNAP quality-control data, and how much of the law those comparisons cover.",
};

interface Oracle {
  name: string;
  scope: string;
  body: string;
  href: string;
}

const ORACLES: Oracle[] = [
  {
    name: "PolicyEngine",
    scope: "US + UK tax & benefits",
    body: "Open-source microsimulation of US and UK tax and benefit policy, co-founded by Max Ghenis.",
    href: "https://policyengine.org",
  },
  {
    name: "TAXSIM",
    scope: "US federal & state income tax",
    body: "NBER's tax calculator, the reference standard in economics research for US income tax liabilities. PolicyEngine is building TAXSIM's successor with its author's cooperation, and our runs use the TAXSIM executable that PolicyEngine packages.",
    href: "https://taxsim.nber.org",
  },
  {
    name: "UKMOD / EUROMOD",
    scope: "UK & EU",
    body: "The EUROMOD family of tax-benefit microsimulation models, maintained by university and EC research teams.",
    href: "https://euromod-web.jrc.ec.europa.eu",
  },
  {
    name: "SPSD/M",
    scope: "Canada federal income tax",
    body: "Statistics Canada's Social Policy Simulation Database and Model — the reference microsimulation of Canadian federal and provincial taxes and transfers.",
    href: "https://www.statcan.gc.ca/en/microsimulation/spsdm/spsdm",
  },
  {
    name: "SNAP quality-control data",
    scope: "US food assistance",
    body: "USDA's case-level QC microdata. For reviewed households in six states, the research firm Mathematica computes a benefit for USDA from the edited case record; we compute it from the same record, taking income and several deductions as given, and compare. The file keeps only eligible households, so the replay checks benefit arithmetic and leaves eligibility untested.",
    href: "https://www.fns.usda.gov/snap/quality-control",
  },
];

export default function ValidationPage() {
  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="max-w-[1080px] mx-auto">
        <Reveal className="mb-16 max-w-[760px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            Validation &middot; Check our work
          </span>
          <h1 className="heading-page mb-6 mt-2">
            Cross-checks in the open
          </h1>
          <p className="font-body text-[1.2rem] text-[var(--color-ink-secondary)] leading-relaxed text-pretty">
            Open isn&apos;t enough &mdash; an encoding you can read but
            can&apos;t test is still a claim. We compare our rules with other
            calculators and datasets, and publish the comparisons and the code
            that runs them. Max Ghenis is CEO of both Axiom and PolicyEngine,
            the oracle we compare against most, and PSL Foundation fiscally
            sponsors both. In September 2026, 20,780 of our 34,810 US rules had
            no comparison; a{" "}
            <a
              href="https://github.com/TheAxiomFoundation/axiom-oracles/blob/main/dashboard/public/data/rule_verification.json"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] no-underline"
            >
              public file
            </a>{" "}
            gives each rule&apos;s status.
          </p>

        </Reveal>

        {/* Live dashboard — embedded, mirrors the docs architecture embed */}
        <Reveal as="section" className="mb-20">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
            <h2 className="heading-section m-0">The oracle dashboard</h2>
            <a
              href="https://axiom-oracles.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-[0.75rem] tracking-[0.12em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
            >
              Open full size
              <ArrowRightIcon className="w-4 h-4" />
            </a>
          </div>
          <p className="mb-6 max-w-[720px] font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
            Cross-engine comparisons as they stand, including divergences we
            have not yet explained.
          </p>
          {/* The dashboard's own 69px topbar (sticky brand bar) is
              redundant inside this page — shift the iframe up so the
              embed starts at the content. */}
          <div className="h-[560px] border border-[var(--color-rule)] rounded-md overflow-hidden bg-[var(--color-paper-elevated)] shadow-[0_16px_48px_rgba(0,0,0,0.08)]">
            <iframe
              src="https://axiom-oracles.vercel.app"
              title="Validation dashboard"
              loading="lazy"
              className="block w-full h-[629px] -mt-[69px] border-0"
            />
          </div>
        </Reveal>

        <Reveal className="mb-20">
          <h2 className="m-0 mb-8 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
            <span aria-hidden className="mb-3 block h-px w-7 bg-[var(--color-accent)]" />
            The oracles
          </h2>
          <RevealGroup
            className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
            staggerChildren={0.08}
          >
            {ORACLES.map((oracle) => (
              <RevealItem
                key={oracle.name}
                as="div"
                className="card-edition p-6 flex flex-col transition-transform duration-300 hover:-translate-y-1"
              >
                <span className="font-mono text-[0.62rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-3">
                  {oracle.scope}
                </span>
                <h3 className="font-body text-[1.05rem] font-medium text-[var(--color-ink)] mb-2 leading-snug">
                  {oracle.name}
                </h3>
                <p className="font-body text-[0.88rem] text-[var(--color-ink-secondary)] leading-relaxed mb-5">
                  {oracle.body}
                </p>
                <a
                  href={oracle.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex items-center gap-2 font-mono text-[0.7rem] tracking-[0.14em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
                >
                  Visit the oracle
                  <ArrowRightIcon className="w-3.5 h-3.5" />
                </a>
              </RevealItem>
            ))}
          </RevealGroup>
          <p className="mt-8 mb-0 max-w-[720px] font-body text-[0.95rem] leading-relaxed text-[var(--color-ink-secondary)]">
            Three more are not connected yet: SOUTHMOD, PSL Tax-Calculator, and
            ACCESS NYC have no published comparison with our encodings.
          </p>
        </Reveal>

        <Reveal className="mb-20 border-t border-[var(--color-rule)] pt-12">
          <h2 className="m-0 mb-8 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
            <span aria-hidden className="mb-3 block h-px w-7 bg-[var(--color-accent)]" />
            How a comparison runs
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                n: "01",
                title: "Same case, side by side",
                body: "Concept-keyed test cases — a household, an income, a date — run through Axiom and one or two oracles behind thin adapters, so no engine's quirks leak into the comparison.",
              },
              {
                n: "02",
                title: "Normalized outputs",
                body: "Engine results map onto shared program concepts before comparing.",
              },
              {
                n: "03",
                title: "Disagreements classified",
                body: "Reports sort mismatches by cause — an encoding gap, an oracle gap, a harness artifact, or an explained residual — and count the ones still unexplained.",
              },
            ].map((step) => (
              <div key={step.n} className="card-edition p-6">
                <span className="serial block mb-4">Step {step.n}</span>
                <h3 className="font-body text-base font-medium text-[var(--color-ink)] mb-2">
                  {step.title}
                </h3>
                <p className="m-0 font-body text-[0.88rem] text-[var(--color-ink-secondary)] leading-relaxed">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal className="border-t border-[var(--color-rule)] pt-12 text-center">
          <p className="m-0 mb-6 font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed max-w-[640px] mx-auto">
            The comparison harness is open, and every engine behind a thin
            adapter makes the whole ecosystem harder to fool. If you maintain
            a calculator, a screener, or an eligibility system,{" "}
            <span className="serif-italic text-[var(--color-ink)]">
              plug it in and put us to the test.
            </span>
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <a
              href="https://github.com/TheAxiomFoundation/axiom-oracles"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              Contribute an oracle
              <ArrowRightIcon className="w-5 h-5" />
            </a>
            <a
              href="https://github.com/TheAxiomFoundation/axiom-rules-engine/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline"
            >
              Report a discrepancy
            </a>
          </div>
          <p className="mt-8 mb-0 font-body text-[0.85rem] text-[var(--color-ink-muted)]">
            Looking for the engineering contracts behind this?{" "}
            <Link
              href="/docs"
              className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] no-underline"
            >
              Documentation &rarr;
            </Link>
          </p>
        </Reveal>
      </div>
    </div>
  );
}
