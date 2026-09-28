import type { Metadata } from "next";
import { ArrowRightIcon } from "@/components/icons";
import { Reveal } from "@/components/landing/reveal";

export const metadata: Metadata = {
  title: "Live demos — Axiom Foundation",
  description:
    "Applications running on the Axiom encodings: statutes computed in your browser, AI assistants grounded in cited rules, and policy tools built on the open layer.",
};

/**
 * The demos page embeds the axiom-demo-shell gallery — "every demo,
 * one screen" — instead of maintaining its own card list. The shell
 * is the single source of truth for what's live, its tiles open each
 * demo in an in-page modal with prev/next navigation, and ?d=<id>
 * deep-links straight into a demo (the header dropdown uses this).
 */
// The /demos path, NOT the shell's root — the root 308s to
// axiom.org/demos, which would recurse this very page inside its
// own iframe.
const DEMO_SHELL_URL = "https://axiom-demo-shell.vercel.app/demos";

/** Modal ids the shell accepts via ?d= — mirrors its data.js. */
const SHELL_DEMO_IDS = new Set([
  "chatbot",
  "builder",
  "workflow",
  "snap",
  "microsim",
  "guidance",
  "architecture",
]);

/** Renamed ids — old links keep landing on the right demo. */
const LEGACY_DEMO_IDS: Record<string, string> = { finbot: "chatbot" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DemosPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawDemo = typeof params?.d === "string" ? params.d : "";
  const requested = LEGACY_DEMO_IDS[rawDemo] ?? rawDemo;
  const demo = SHELL_DEMO_IDS.has(requested) ? requested : null;
  const gallerySrc = demo
    ? `${DEMO_SHELL_URL}/?d=${demo}`
    : `${DEMO_SHELL_URL}/`;

  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="max-w-[1240px] mx-auto">
        <Reveal className="mb-12 max-w-[760px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            What&apos;s possible &middot; The application layer
          </span>
          <h1 className="heading-page mb-6 mt-2">Built on the open layer</h1>
          <p className="font-body text-[1.2rem] text-[var(--color-ink-secondary)] leading-relaxed text-pretty">
            Every demo runs on the same published encodings &mdash; the
            statute text, the RuleSpec rules, and the citations connecting
            them. What one encoding powers, anyone can build.
          </p>
        </Reveal>

        <Reveal as="section" amount={0.1}>
          <h2 className="m-0 mb-5 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
            The gallery
          </h2>
          {/* The shell doesn't fit an embedded frame on small screens
              (and some demos error inside it) — below md we link out
              instead. lazy + display:none makes the hidden iframe
              unlikely to load below md, but that's best-effort, and
              from md up this still embeds the gallery's six live
              demos — tap-to-load facades are axiom-demo-shell#7. */}
          <div className="hidden md:block border border-[var(--color-rule)] rounded-md overflow-hidden bg-[var(--color-paper-elevated)] shadow-[0_16px_48px_rgba(0,0,0,0.08)]">
            <iframe
              src={gallerySrc}
              title="Axiom demo gallery"
              loading="lazy"
              className="block w-full h-[80vh] min-h-[640px] border-0"
            />
          </div>
          <div className="md:hidden border border-[var(--color-rule)] rounded-md bg-[var(--color-paper-elevated)] p-8 text-center">
            <p className="m-0 mb-5 font-body text-[0.95rem] text-[var(--color-ink-secondary)] leading-relaxed">
              The gallery works best full-screen on mobile.
            </p>
            <a
              href={gallerySrc}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-[var(--color-rule)] px-6 py-3 font-mono text-[0.8rem] tracking-[0.12em] uppercase text-[var(--color-accent)] no-underline transition-colors hover:border-[var(--color-accent)]"
            >
              Open the gallery
              <ArrowRightIcon className="w-4 h-4" />
            </a>
          </div>
          {/* Axiom local lives on its own surface, outside the shell. */}
          <p className="m-0 mt-5 text-center font-body text-[0.95rem] text-[var(--color-ink-muted)] leading-relaxed">
            Also running:{" "}
            <a
              href="https://axiom.org/local"
              className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] no-underline"
            >
              Axiom local
            </a>{" "}
            &mdash; statutes compiled to WebAssembly, determinations rendered
            in your browser.
          </p>
        </Reveal>

        <Reveal className="mt-20 pt-10 border-t border-[var(--color-rule-subtle)] text-center">
          <p className="m-0 font-body text-[0.95rem] text-[var(--color-ink-muted)] leading-relaxed max-w-[640px] mx-auto">
            These are previews of what open, computable law makes possible.{" "}
            <span className="serif-italic text-[var(--color-ink-secondary)]">
              The layer underneath is the product
            </span>{" "}
            &mdash; explore it in{" "}
            <a
              href="https://axiom.org/app"
              className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] no-underline"
            >
              the Axiom app
            </a>
            .
          </p>
        </Reveal>
      </div>
    </div>
  );
}
