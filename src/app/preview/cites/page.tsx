import { CitesBeat } from "@/components/landing/cites-beat/cites-beat";

// Test of beat 5 built from live components (statute text, code card,
// scroll-drawn threads) with Lenis smooth scroll, to compare against the
// canvas beat. Not linked; the preview layout keeps it out of search.
export default function CitesPreviewPage() {
  return (
    <main>
      <section className="section-tint-cream relative z-1 py-40 px-8">
        <p className="text-center font-body text-lg text-[var(--color-ink-secondary)] max-w-[640px] mx-auto leading-relaxed">
          Scroll down. Each marked phrase of § 2017(a) connects to the line of
          a.yaml that encodes it.
        </p>
      </section>
      <CitesBeat />
      <section className="section-tint-cream relative z-1 py-40 px-8">
        <p className="text-center font-body text-[0.95rem] text-[var(--color-ink-muted)] max-w-[640px] mx-auto leading-relaxed">
          End of the test beat.
        </p>
      </section>
    </main>
  );
}
