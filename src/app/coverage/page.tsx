import type { Metadata } from "next";
import { Reveal } from "@/components/landing/reveal";
import { CoverageHeader } from "@/components/coverage/header";
import { StackHero } from "@/components/coverage/stack-hero";
import { JurisdictionBreakdown } from "@/components/coverage/jurisdiction-breakdown";
import {
  getCoverageData,
  type CoverageData,
} from "@/lib/axiom/coverage-page";

export const metadata: Metadata = {
  title: "Coverage — Axiom Foundation",
  description:
    "What Axiom holds today: legal documents by type and jurisdiction, provision counts, and RuleSpec encoding files — refreshed from the live corpus.",
};

// Static page revalidated from the live corpus; counts change only
// when a release is activated or the encodings mirror syncs.
export const revalidate = 600;

export default async function CoveragePage() {
  // The whole stack, every jurisdiction the corpus and the encodings
  // mirror hold — the breakdown's country filter does the narrowing.
  const data = await getCoverageData();

  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="max-w-[1080px] mx-auto">
        {/* No Reveal on the header: the loading state already shows
            it, so re-animating on the stream swap reads as a jump. */}
        <div className="mb-14 max-w-[760px]">
          <CoverageHeader />
        </div>

        {data === null ? (
          <Reveal className="py-16 text-center text-[var(--color-ink-muted)]">
            Live counts are temporarily unavailable. Reload to try again.
          </Reveal>
        ) : (
          <CoverageBody data={data} />
        )}
      </div>
    </div>
  );
}

function CoverageBody({ data }: { data: CoverageData }) {
  return (
    <>
      {/* No Reveal wrapper here: its transform would break the
          sticky scrollytelling stage inside the hero. */}
      <div className="mb-20">
        <StackHero data={data} />
      </div>

      {/* Reveal on first contact, not at the default 20% in view: the
          breakdown is taller than any viewport now (200 rows), so a
          fractional threshold can never be met and the section would
          stay hidden. */}
      <Reveal as="section" className="mb-16" amount={0}>
        <JurisdictionBreakdown jurisdictions={data.jurisdictions} />
      </Reveal>
    </>
  );
}
