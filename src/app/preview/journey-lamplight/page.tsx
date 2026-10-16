import { JourneyLamplight } from "@/components/landing/journey-lamplight/journey-lamplight";

// Production candidate of the encoder section's story (Lamplight): the
// section header, the pinned journey, and what follows it. Not linked;
// the preview layout keeps it out of search.
export default function JourneyLamplightPreviewPage() {
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
      <JourneyLamplight />
      <section className="section-tint-cream relative z-1 py-32 px-8">
        <p className="text-center font-body text-[0.95rem] text-[var(--color-ink-muted)] max-w-[640px] mx-auto leading-relaxed">
          The encoder logs every decision.
        </p>
      </section>
    </main>
  );
}
