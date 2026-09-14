import type { Metadata } from "next";
import { ArchitectureStrip } from "@/components/docs/architecture-strip";
import { CoreExecutionPath } from "@/components/docs/core-execution-path";
import { Reveal } from "@/components/landing/reveal";

export const metadata: Metadata = {
  title: "Documentation — Axiom Foundation",
  description:
    "Axiom architecture: the implemented core and encoder execution path, planned admission and publication, and repository ownership.",
};

const repoMap = [
  {
    repo: "axiom-corpus",
    owns: "Corpus source text, anchors, hierarchy, tables, hashes, source claims, and signed source releases.",
  },
  {
    repo: "axiom-encode",
    owns: "Candidate generation, harness and proof validation, eval suites, and explicit BuildSpec export. Export does not change signed apply or acceptance-test trust.",
  },
  {
    repo: "axiom-core",
    owns: "Local development bundle identity, pinned compilation, offline verification, strict execution receipts, and the thin Python transport.",
  },
  {
    repo: "axiom-oracles",
    owns: "Oracle adapters, comparison workloads, and evidence used to evaluate candidate behavior against external implementations.",
  },
  {
    repo: "axiom-rules-engine",
    owns: "RuleSpec language, compiler, runtime, test runner, and executable semantics.",
  },
  {
    repo: "rulespec-*",
    owns: "Jurisdiction RuleSpec corpora: checked-in .yaml rules and companion .test.yaml cases.",
  },
  {
    repo: "axiom.org",
    owns: "Public site, Axiom app shell, docs index, and cross-system presentation.",
  },
];

export default function DocsPage() {
  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="mx-auto max-w-[960px]">
        {/* Header */}
        <Reveal className="mb-14 max-w-[760px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            Documentation
          </span>
          <h1 className="heading-page mb-6 mt-2">
            Docs live with the system that enforces them
          </h1>
          <p className="font-body text-[1.2rem] leading-relaxed text-[var(--color-ink-secondary)] text-pretty">
            This page is the public map. Implementation detail stays in the
            owning repo, with the system that enforces it.
          </p>
        </Reveal>

        <section id="core-execution" className="mb-20 scroll-mt-28">
          <h2 className="heading-section m-0 mb-6">The architecture</h2>
          <p className="mb-6 max-w-[720px] font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
            The core and encoder now connect an explicitly selected candidate
            to a verifiable local bundle and a real engine response. This is a
            working development checkpoint; admission and publication remain
            separate work.
          </p>
          <CoreExecutionPath />
          <p className="m-0 font-body text-[0.88rem] leading-relaxed text-[var(--color-ink-secondary)]">
            Merged implementation: {" "}
            <a href="https://github.com/TheAxiomFoundation/axiom-core/pull/1">core bundles and execution</a>
            {", "}
            <a href="https://github.com/TheAxiomFoundation/axiom-encode/pull/1581">explicit encoder export</a>
            {", and "}
            <a href="https://github.com/TheAxiomFoundation/axiom-core/pull/2">real encoder/core integration tests</a>.
          </p>
          <details className="mt-10 border-y border-[var(--color-rule)] py-5">
            <summary className="cursor-pointer font-body text-[1rem] text-[var(--color-ink)]">
              The broader pipeline
            </summary>
            <p className="mt-5 mb-6 max-w-[720px] font-body text-[0.92rem] leading-relaxed text-[var(--color-ink-secondary)]">
              This conceptual map follows source intake, corpus, encoding,
              RuleSpec, and the rule graph to application surfaces. Its
              illustrative compile seal does not represent a signed or admitted
              core bundle. The implemented and planned boundaries are shown above.
            </p>
            <ArchitectureStrip />
          </details>
        </section>

        {/* Repo ownership */}
        <Reveal as="section">
          <h2 className="heading-section mb-3">Repository ownership</h2>
          <p className="mb-8 max-w-[720px] font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
            The repo split is part of the documentation model: engineering
            docs live in the repo that owns the code or contract, and a doc
            moves only when the owning system moves.
          </p>
          <div className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
            {repoMap.map((item) => (
              <div
                key={item.repo}
                className="grid grid-cols-[220px_minmax(0,1fr)] gap-6 py-5 max-md:grid-cols-1 max-md:gap-2"
              >
                <p className="m-0 font-mono text-[0.85rem] text-[var(--color-ink)]">
                  {item.repo}
                </p>
                <p className="m-0 font-body text-[0.92rem] leading-relaxed text-[var(--color-ink-secondary)]">
                  {item.owns}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </div>
  );
}
