import { JourneyDigital } from "@/components/landing/journey-digital/journey-digital";

// Prototype of the encoder section's scroll story, rebuilt from the real
// artifacts with GSAP. Not linked from anywhere; the preview layout keeps
// it out of search.
export default function JourneyPreviewPage() {
  return (
    <main>
      <section className="section-tint-cream relative z-1 py-32 px-8">
        <div className="max-w-[1280px] mx-auto text-center">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            III &middot; The encoder
          </span>
          <h2 className="heading-section mb-6 mt-2">How a statute gets encoded</h2>
          <p className="font-body text-lg text-[var(--color-ink-secondary)] max-w-[640px] mx-auto leading-relaxed">
            An AI-driven pipeline reads a statute and encodes it section by section.
          </p>
        </div>
      </section>
      <JourneyDigital />
      <section className="section-tint-cream relative z-1 py-32 px-8">
        <p className="text-center font-body text-[0.95rem] text-[var(--color-ink-muted)] max-w-[640px] mx-auto leading-relaxed">
          Each time the encoder applies an encoding, it leaves a signed
          manifest naming the source citation and the model.
        </p>
      </section>
    </main>
  );
}
