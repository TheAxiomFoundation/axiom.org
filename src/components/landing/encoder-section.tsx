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
          {/* No blanket verification claim: the pinned shared workflow selects
              modules and skips validation, companion tests and proof checks
              for active entries in known-validation-gaps.yaml. Current dated
              counts live in verification-evidence.ts. */}
          <p className="font-body text-lg text-[var(--color-ink-secondary)] max-w-[640px] mx-auto leading-relaxed">
            An AI-driven pipeline reads a statute and encodes it section by
            section.
          </p>
        </Reveal>

        {/* The journey film, scrubbed by scroll — replaces the old
            terminal animation. */}
        <JourneyScrolly />

        {/*
          The encoder's record is its signed apply manifest (axiom-encode
          cli.py _MODEL_APPLY_MANIFEST_FIELDS): the citation, the model, and
          a hash of each file written. It holds a trace's path and hash, not
          the trace, which stays on the machine that ran the encoder. A
          failed re-encode's 90-day diagnostics artifact can contain a trace.
          This line claims the manifest and no per-decision record.
        */}
        <Reveal
          as="p"
          className="mt-14 text-center font-body text-[0.95rem] text-[var(--color-ink-muted)] max-w-[640px] mx-auto leading-relaxed"
        >
          Each time the encoder applies an encoding, it leaves a signed
          manifest naming the source citation and the model.{" "}
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
