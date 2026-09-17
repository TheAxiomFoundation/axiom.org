import type { Metadata } from "next";
import { Reveal } from "@/components/landing/reveal";
import { SITE_URL } from "@/lib/urls";

// The manuscript embeds from the receipt repo's Pages deployment
// (rendered by its docs workflow into paper/web; vercel.json rewrites
// /receipt/paper/web/* there). Bump PAPER_VERSION on every manuscript
// revision — the iframe and every standalone link stay in lockstep so
// caches can't serve a stale manuscript behind a fresh wrapper
// (page.test.tsx enforces).
const PAPER_VERSION = "r14-20260910";
const WEB_HREF = `/receipt/paper/web/index.html?v=${PAPER_VERSION}`;
const PDF_HREF = `/receipt/paper/web/index.pdf?v=${PAPER_VERSION}`;

const TITLE = "receipt: verifiable custody of agent-produced records";
const DESCRIPTION =
  "Working paper: what an offline check of agent-produced records establishes, why the design pins trust anchors in the verifier's own code, and the four evidence classes behind the package's extraction from production systems.";

export const metadata: Metadata = {
  title: `${TITLE} — working paper`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/receipt/paper` },
  openGraph: {
    type: "article",
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/receipt/paper`,
  },
};

const ACTIONS = [
  { href: WEB_HREF, label: "Open standalone HTML" },
  { href: PDF_HREF, label: "Download PDF" },
  { href: "/receipt", label: "Package page" },
  { href: "https://github.com/TheAxiomFoundation/receipt", label: "Code and evidence" },
];

export default function ReceiptPaperPage() {
  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="mx-auto max-w-[960px]">
        <Reveal className="mb-10 max-w-[760px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            receipt &middot; working paper
          </span>
          <p className="m-0 mb-4 font-mono text-[0.72rem] uppercase tracking-wider text-[var(--color-ink-muted)]">
            The package page:{" "}
            <a href="/receipt" className="text-[var(--color-accent)] hover:underline">
              axiom.org/receipt
            </a>{" "}
            &middot; the API reference:{" "}
            <a href="/receipt/api/" className="text-[var(--color-accent)] hover:underline">
              axiom.org/receipt/api
            </a>
          </p>
          <h1 className="heading-page mb-6 mt-2">
            Verifiable custody of agent-produced records
          </h1>
          <p className="font-body text-[1.05rem] leading-relaxed text-[var(--color-ink-secondary)] text-pretty">
            What an offline check of agent-produced records establishes,
            why the design pins trust anchors in the verifier&rsquo;s own
            committed code, and the four evidence classes behind the
            package&rsquo;s extraction from production systems. The embed
            below is the current manuscript snapshot.
          </p>
          <p className="mt-4 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            Revision 14 &middot; 2026-09-10 &middot; Max Ghenis, the Axiom
            Foundation
          </p>
        </Reveal>

        <Reveal as="section" className="mb-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {ACTIONS.map((action) => (
              <a
                key={action.href}
                href={action.href}
                className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] no-underline"
                {...(action.href.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {action.label}
              </a>
            ))}
          </div>
        </Reveal>

        <Reveal as="section" className="mb-10">
          <div className="rounded-md border border-[var(--color-rule)] overflow-hidden">
            <iframe
              src={WEB_HREF}
              title="receipt working paper manuscript"
              loading="lazy"
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="same-origin"
              className="block w-full"
              style={{
                height: "calc(100vh - 16rem)",
                minHeight: 720,
                background: "#fff",
              }}
            />
          </div>
          <p className="mt-3 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            <a href="#top" className="text-[var(--color-accent)] hover:underline">
              &uarr; Back to top
            </a>{" "}
            &middot;{" "}
            <a href={WEB_HREF} className="text-[var(--color-accent)] hover:underline">
              Open the manuscript in a new page
            </a>
          </p>
        </Reveal>
      </div>
    </div>
  );
}
