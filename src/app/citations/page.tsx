import type { Metadata } from "next";
import Image from "next/image";
import { ArrowRightIcon } from "@/components/icons";
import { Reveal, RevealGroup, RevealItem } from "@/components/landing/reveal";
import {
  CITATIONS,
  formatCitationDate,
  groupedCitations,
} from "@/lib/citations";

export const metadata: Metadata = {
  title: "Citations — Axiom Foundation",
  description:
    "Who cites Axiom: the articles, papers, reports, and products that discuss or build on the corpus, the RuleSpec encodings, and the engine.",
};

export default function CitationsPage() {
  const groups = groupedCitations(CITATIONS);

  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="max-w-[1080px] mx-auto">
        <Reveal className="mb-16 max-w-[760px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            Citations
          </span>
          <h1 className="heading-page mb-6 mt-2">Who cites Axiom</h1>
          <p className="font-body text-[1.2rem] text-[var(--color-ink-secondary)] leading-relaxed text-pretty">
            The articles, papers, reports, and products that discuss or build
            on the corpus, the RuleSpec encodings, or the engine.
          </p>
        </Reveal>

        {groups.map((group) => (
          <Reveal key={group.kind} as="section" className="mb-20">
            <h2 className="m-0 mb-8 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
              <span
                aria-hidden
                className="mb-3 block h-px w-7 bg-[var(--color-accent)]"
              />
              {group.label}
            </h2>
            <RevealGroup
              className="grid gap-6 sm:grid-cols-2"
              staggerChildren={0.08}
            >
              {group.entries.map((entry) => (
                <RevealItem
                  key={entry.id}
                  as="div"
                  className="card-edition citation-card flex flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-1"
                >
                  {/* The source's own card image, cropped to a link
                      preview's 1.91:1 — the page reads as a shelf of
                      the pieces themselves, not a list about them. */}
                  <a
                    href={entry.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    tabIndex={-1}
                    aria-hidden
                    className="block aspect-[1.91/1] overflow-hidden border-b border-[var(--color-rule)] bg-[var(--color-rule-subtle)]"
                  >
                    <Image
                      src={entry.image.src}
                      alt={entry.image.alt}
                      width={entry.image.width}
                      height={entry.image.height}
                      sizes="(min-width: 640px) 520px, 100vw"
                      className="h-full w-full object-cover"
                    />
                  </a>
                  <div className="flex flex-1 flex-col p-6">
                    <span className="font-mono text-[0.62rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-3">
                      {entry.source} &middot;{" "}
                      <time dateTime={entry.date}>
                        {formatCitationDate(entry.date)}
                      </time>
                    </span>
                    <h3 className="font-body text-[1.05rem] font-medium text-[var(--color-ink)] mb-1 leading-snug text-balance">
                      {entry.title}
                    </h3>
                    <p className="font-body text-[0.8rem] text-[var(--color-ink-muted)] mb-3">
                      {entry.by}
                    </p>
                    <p className="font-body text-[0.88rem] text-[var(--color-ink-secondary)] leading-relaxed mb-5">
                      {entry.summary}
                    </p>
                    <a
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-auto inline-flex items-center gap-2 font-mono text-[0.7rem] tracking-[0.14em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
                    >
                      Read the piece
                      <ArrowRightIcon className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
