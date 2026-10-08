import { ArrowRightIcon } from "@/components/icons";
import { axiomAppHref } from "@/lib/urls";
import { JourneyScrolly } from "./journey-scrolly";
import { Reveal } from "./reveal";

export function EncoderSection() {
  return (
    <section
      id="encoder"
      className="section-tint-cream relative z-1 py-32 px-8"
    >
      <div className="max-w-[1280px] mx-auto">
        <Reveal className="text-center mb-16">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            III &middot; The encoder
          </span>
          <h2 className="heading-section mb-6 mt-2">
            How a statute gets encoded
          </h2>
          {/*
            No human sign-off clause here. The pipeline has no human review
            gate — the gates are deterministic checks, oracle cross-checks
            where a comparison exists, and AI judges; naming a human approver
            would describe a step that does not exist. The heading claims no
            blanket "verified": CI skips validation, companion tests and
            proof checks for modules on rulespec-us's waiver list (1,940 on
            2026-10-02, holding 23,735 of 34,810 US rules).
          */}
          <p className="font-body text-lg text-[var(--color-ink-secondary)] max-w-[640px] mx-auto leading-relaxed">
            An AI-driven pipeline reads a statute and encodes it section by
            section.
          </p>
        </Reveal>

        {/* The journey film, scrubbed by scroll — replaces the old
            terminal animation. */}
        <JourneyScrolly />

        <Reveal
          as="p"
          className="mt-14 text-center font-body text-[0.95rem] text-[var(--color-ink-muted)] max-w-[640px] mx-auto leading-relaxed"
        >
          The encoder logs every decision.{" "}
          <span className="serif-italic text-[var(--color-ink-secondary)]">
            Disagreements are classified and published, including the ones
            not yet explained.
          </span>
        </Reveal>

        <Reveal className="mt-8 text-center">
          <a
            href={axiomAppHref()}
            className="inline-flex items-center gap-2 font-mono text-[0.75rem] tracking-[0.12em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
          >
            Explore the encodings
            <ArrowRightIcon className="w-4 h-4" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
