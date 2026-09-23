import { ArrowRightIcon } from "@/components/icons";
import { axiomAppHref } from "@/lib/urls";
import { IllustratedJourney } from "./illustrated-journey";
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
            Statutes encoded and verified
          </h2>
          {/*
            No human sign-off clause here. The pipeline has no human review
            gate — the gates are deterministic checks, independent oracle
            cross-checks, and AI judges. The heading above already carries
            "before they ship"; naming a human approver would describe a
            step that does not exist.
          */}
          <p className="font-body text-lg text-[var(--color-ink-secondary)] max-w-[640px] mx-auto leading-relaxed">
            An AI-driven pipeline reads a statute, encodes it section by
            section, and runs the result against oracles like PolicyEngine
            and TAXSIM.
          </p>
        </Reveal>

        {/* The journey film, scrubbed by scroll — replaces the old
            terminal animation. */}
        <IllustratedJourney />

        <Reveal
          as="p"
          className="mt-14 text-center font-body text-[0.95rem] text-[var(--color-ink-muted)] max-w-[640px] mx-auto leading-relaxed"
        >
          The encoder logs every decision.{" "}
          <span className="serif-italic text-[var(--color-ink-secondary)]">
            Disagreements get explained, not erased.
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
