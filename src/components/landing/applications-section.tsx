import { ArrowRightIcon } from "@/components/icons";
import { DemoThumb } from "./demo-thumb";
import { Reveal, RevealGroup, RevealItem } from "./reveal";

/**
 * Each use-case card carries a proof: a preview of the matching demo
 * (the shell gallery's thumb pattern), deep-linked into /demos?d=<id>
 * so a click lands in the gallery with that demo open. The public card
 * links straight to the Axiom app — the app is the demo. The preview
 * is a live scaled iframe only on desktop-class devices; elsewhere
 * DemoThumb serves the static poster (iPhone visitors reported
 * forced-reload loops on these surfaces — see DemoThumb).
 */
const APPLICATIONS = [
  {
    n: "01",
    title: "Calculators that audit themselves",
    body:
      "Tax software, benefit estimators, eligibility tools — all running off the same encoding, all able to point at the statute behind any number.",
    actor: "for builders",
    demo: {
      label: "SNAP workflow checker",
      href: "/demos?d=workflow",
      src: "https://co-snap-workflow-checker.vercel.app/",
      poster: "/demo-posters/workflow.png",
    },
  },
  {
    n: "02",
    title: "Ground truth for AI",
    body:
      "People keep asking models policy questions. The Axiom Foundation gives them a key — verifiable answers grounded in actual law, useful for both training and inference.",
    actor: "for AI labs",
    demo: {
      label: "A grounded assistant",
      href: "/demos?d=chatbot",
      src: "https://axiom.org/chatbot",
      poster: "/demo-posters/chatbot.png",
    },
  },
  {
    n: "03",
    title: "Reform without rewriting",
    body:
      "Change a parameter, re-run the calculation. Compare current law against any proposed amendment without touching the surrounding rules.",
    actor: "for analysts",
    demo: {
      label: "Reform SNAP live",
      href: "/demos?d=snap",
      src: "https://axiom-co-snap.vercel.app/",
      poster: "/demo-posters/snap.png",
    },
  },
  {
    n: "04",
    title: "Government in plain sight",
    body:
      "Every value cites its source. Every formula is open. Anyone can read the law, run it, and check that the answer follows.",
    actor: "for the public",
    demo: {
      label: "Explore the law",
      href: "https://axiom.org/app",
      src: "https://axiom.org/app",
      poster: "/demo-posters/app.png",
    },
  },
];

export function ApplicationsSection() {
  return (
    <section
      id="applications"
      className="relative z-1 py-24 px-8"
    >
      <div className="max-w-[1280px] mx-auto">
        <Reveal className="text-center mb-12">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            IV &middot; What it powers
          </span>
          <h2 className="heading-section mb-5 mt-2">
            One encoding. Many places to use it.
          </h2>
          <p className="font-body text-lg text-[var(--color-ink-secondary)] max-w-[640px] mx-auto leading-relaxed">
            Encode a rule once, in the open, and everyone can build on it
            &mdash;{" "}
            <span className="serif-italic text-[var(--color-ink)]">
              correctly, affordably, and in plain sight
            </span>
            .
          </p>
        </Reveal>

        <RevealGroup
          className="grid gap-5 md:grid-cols-2 lg:grid-cols-4"
          staggerChildren={0.08}
        >
          {APPLICATIONS.map((app) => (
            <RevealItem
              key={app.n}
              className="card-edition p-5 flex flex-col transition-transform duration-300 hover:-translate-y-1"
            >
              <div className="flex items-baseline justify-between mb-3">
                <span className="serif-italic text-[0.85rem] text-[var(--color-ink-muted)]">
                  {app.actor}
                </span>
                <span className="font-mono text-[0.58rem] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]">
                  {app.n}
                </span>
              </div>
              <h3 className="font-body text-[1rem] font-medium text-[var(--color-ink)] mb-2 leading-snug">
                {app.title}
              </h3>
              <p className="font-body text-[0.83rem] text-[var(--color-ink-secondary)] leading-relaxed m-0">
                {app.body}
              </p>
              <a
                href={app.demo.href}
                className="group/demo mt-auto pt-4 block no-underline"
                aria-label={`Open demo: ${app.demo.label}`}
              >
                <DemoThumb
                  src={app.demo.src}
                  poster={app.demo.poster}
                  title={`${app.demo.label} — preview`}
                />
                <span className="mt-2.5 inline-flex items-center gap-2 font-mono text-[0.58rem] tracking-[0.16em] uppercase text-[var(--color-accent)] group-hover/demo:text-[var(--color-accent-hover)] transition-colors">
                  Explore
                  <ArrowRightIcon className="w-3 h-3" />
                </span>
              </a>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-10 text-center">
          <a
            href="/demos"
            className="inline-flex items-center gap-2 font-mono text-[0.75rem] tracking-[0.12em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
          >
            Open the full demo gallery
            <ArrowRightIcon className="w-4 h-4" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
