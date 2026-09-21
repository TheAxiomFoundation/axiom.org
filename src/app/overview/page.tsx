import type { Metadata } from "next";
import Link from "next/link";
import { axiomAppHref } from "@/lib/urls";
import { ArrowRightIcon } from "@/components/icons";
import { WhatWeEnable } from "@/components/overview/what-we-enable";
import { SubscribeLink } from "@/components/overview/subscribe-link";
import {
  CONTACT_EMAIL,
  HERO,
  LICENSE_LINKS,
  ORG_STATUS,
  OVERVIEW_PDF_PATH,
  SUBSCRIBE_BLURB,
  WHAT_WE_DO,
  WHAT_WE_DO_INTRO,
} from "@/components/overview/overview-content";

export const metadata: Metadata = {
  title: "Overview — the Axiom Foundation",
  description:
    "What the Axiom Foundation does and what the encoded layer enables: open, cited, verified encodings of statutes, regulations, and policy rules, starting with tax and benefit policy.",
  alternates: { canonical: "/overview" },
  openGraph: {
    title: "The Axiom Foundation — overview",
    description:
      "Open, cited, verified encodings of the world's rules, starting with tax and benefit policy.",
    images: ["/og-image.png"],
  },
};

export default function OverviewPage() {
  return (
    <div className="relative z-1 py-32 px-8">
      <div className="max-w-[800px] mx-auto">
        <header className="text-center mb-16">
          <h1 className="heading-page mb-4">{HERO.title}</h1>
          <p className="serif-italic text-xl text-[var(--color-ink)] mb-6">
            {HERO.tagline}
          </p>
          <p className="font-body text-xl text-[var(--color-ink-secondary)] leading-relaxed max-w-[640px] mx-auto">
            {HERO.lede}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <a href={axiomAppHref()} className="btn-primary">
              Open the Axiom App
              <ArrowRightIcon className="w-5 h-5" />
            </a>
            <a
              href={OVERVIEW_PDF_PATH}
              className="btn-outline"
              download
              data-testid="overview-pdf-link"
            >
              Download 1-Page PDF
            </a>
          </div>
        </header>

        <section id="what-we-do" className="mb-16 scroll-mt-24">
          <h2 className="heading-sub mb-4">What we do</h2>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-6">
            {WHAT_WE_DO_INTRO}
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6">
            {WHAT_WE_DO.map((card) => (
              <div key={card.n} className="card-edition p-6">
                {/* Amber numbered step, echoing the PDF's `ol.steps` badges so
                    the two surfaces read as the same three-step story. */}
                <div className="flex items-center gap-3 mb-3">
                  <span
                    aria-hidden="true"
                    className="flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-[var(--color-accent)] text-[var(--color-paper-elevated)] font-mono text-xs font-semibold"
                  >
                    {card.n}
                  </span>
                  <span className="font-mono text-[0.65rem] tracking-[0.22em] uppercase text-[var(--color-accent)]">
                    {card.label}
                  </span>
                </div>
                <h3 className="font-body text-lg text-[var(--color-ink)] mb-2">
                  {card.title}
                </h3>
                <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                  {card.body}
                </p>
              </div>
            ))}
          </div>
          {/* Same claim as the PDF's fine print under the three steps. The two
              licences differ by artefact and both are linked rather than
              asserted — the corpus repos are CC BY 4.0, the code MIT. */}
          <p className="serif-italic text-sm text-[var(--color-ink-muted)] leading-relaxed mt-6 mb-0">
            Encodings are published under{" "}
            <a
              href={LICENSE_LINKS.encodings}
              target="_blank"
              rel="noopener noreferrer"
            >
              CC BY 4.0
            </a>{" "}
            and the code under{" "}
            <a
              href={LICENSE_LINKS.code}
              target="_blank"
              rel="noopener noreferrer"
            >
              MIT
            </a>{" "}
            &mdash; free to use, modify, and redistribute, with attribution.
          </p>
        </section>

        <WhatWeEnable />

        <section id="get-involved" className="mb-16 scroll-mt-24">
          <h2 className="heading-sub mb-4">Where to start</h2>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-6">
            The fastest way to judge the Axiom Foundation is to open a rule and
            read the statute next to the code that runs it. If you find a
            discrepancy, tell us &mdash; we will explain it or fix it.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6">
            <div className="card-edition p-6">
              <h3 className="font-body text-lg text-[var(--color-ink)] mb-2">
                Use the app
              </h3>
              <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed mb-4">
                Search a program, open a provision, and follow it through source
                text, encoding, and computation graph. Every value points at the
                authority it came from.
              </p>
              <a
                href={axiomAppHref()}
                className="font-mono text-sm text-[var(--color-accent)]"
              >
                Open the Axiom App
              </a>
            </div>
            <div className="card-edition p-6">
              <h3 className="font-body text-lg text-[var(--color-ink)] mb-2">
                Get in touch
              </h3>
              <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed mb-4">
                Partnerships, integrations, or a jurisdiction you want encoded.
              </p>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-mono text-sm text-[var(--color-accent)] break-all"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </section>

        <section className="mb-16">
          <h2 className="heading-sub mb-4">Subscribe for updates</h2>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-6">
            {SUBSCRIBE_BLURB}
          </p>
          <SubscribeLink />
        </section>

        <section>
          <h2 className="heading-sub mb-4">Organization</h2>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            {ORG_STATUS}
          </p>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-8">
            <Link href="/team">Meet the team</Link> or write to us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
          <a href={OVERVIEW_PDF_PATH} className="btn-outline" download>
            Download 1-Page PDF
          </a>
        </section>
      </div>
    </div>
  );
}
