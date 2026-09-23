import type { Metadata } from "next";
import { Reveal } from "@/components/landing/reveal";
import { SITE_NAME } from "@/lib/share";

// og:title and og:description fall back to the page's title and
// description. twitter is left to the root layout, which keeps the
// site handle and the large card; Next copies this image into it.
export const metadata: Metadata = {
  title: "Workshop: New technologies for evidence-based policy making — Axiom Foundation",
  description:
    "Free afternoon workshop in Brussels, Thursday 27 August 2026 — the Axiom Foundation and PolicyEngine with CAPE and BEAMM at UCLouvain Saint-Louis. Talks, a live demo, and a roundtable with Belgian policy institutions.",
  openGraph: {
    type: "website",
    url: "./",
    siteName: SITE_NAME,
    images: [
      { url: "https://axiom.org/events/iariw-2026-og2.png", width: 2400, height: 1350 },
    ],
  },
};

const REGISTRATION_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfpfDAGrAeAD4yG1aupgZnJ6VecBGZIaCHqWuVCYRXxuEDWeA/viewform";

const FACTS = [
  { label: "When", value: "Thursday 27 August 2026, 13:00–17:00" },
  {
    label: "Where",
    value:
      "UCLouvain Saint-Louis, Room P02 — Boulevard du Jardin botanique 43, 1000 Brussels",
  },
  { label: "Cost", value: "Free and open — registration requested" },
  {
    label: "Format",
    value: "Talks, a live demo, and a roundtable — coffee on both ends",
  },
];

const PROGRAM: {
  time: string;
  title: string;
  detail?: string;
  people?: string[];
}[] = [
  { time: "13:00", title: "Coffee and arrivals" },
  {
    time: "13:30",
    title: "Welcome",
    detail:
      "Tom Truyts (CAPE, UCLouvain Saint-Louis) and Max Ghenis (Axiom Foundation and PolicyEngine).",
  },
  {
    time: "13:45–14:35",
    title: "BEAMM: Belgium's open microsimulation platform",
    detail: "Talk and live demo — Tom Truyts, CAPE / UCLouvain Saint-Louis.",
  },
  {
    time: "14:40–15:30",
    title: "From open models to executable law: PolicyEngine and Axiom",
    detail:
      "Open US and UK models, simulation-ready microdata, and encoding and certifying policy rules — talk and live demo — Max Ghenis, Axiom Foundation and PolicyEngine.",
  },
  { time: "15:30–16:00", title: "Coffee break" },
  {
    time: "16:00–17:00",
    title:
      "Roundtable: AI and new technologies for open, evidence-based policy making",
    people: [
      "Hélène Latzer — UCLouvain Saint-Louis (moderator)",
      "Koen Algoed — Secretary General, Budget and Finance Department, Flemish Region",
      "Jean-Baptiste Traversa — Head of microsimulation modelling, Federal Public Service Finance",
      "Tom Truyts — CAPE, UCLouvain Saint-Louis",
      "Max Ghenis — Axiom Foundation and PolicyEngine",
    ],
  },
  { time: "17:00", title: "Walk together to the IARIW reception" },
];

export default function IariwWorkshopPage() {
  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="max-w-[960px] mx-auto">
        <Reveal className="mb-14 max-w-[760px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            Workshop &middot; Brussels
          </span>
          <h1 className="heading-page mb-6 mt-2">
            New technologies for evidence-based policy making
          </h1>
          <p className="font-body text-[1.2rem] text-[var(--color-ink-secondary)] leading-relaxed text-pretty">
            A free afternoon workshop during the IARIW 39th General Conference
            week, co-organized by the Axiom Foundation and PolicyEngine with
            CAPE and BEAMM. Where tax-benefit microsimulation is heading:
            open models, simulation-ready microdata, and law encoded as
            executable, cited rules &mdash; with the people who run the models
            inside Belgian government.
          </p>
          <a
            href={REGISTRATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-8 inline-flex"
          >
            Register &mdash; free
          </a>
        </Reveal>

        <Reveal className="mb-14">
          <div className="grid gap-x-12 gap-y-6 sm:grid-cols-2">
            {FACTS.map((f) => (
              <div
                key={f.label}
                className="border-t border-[var(--color-rule)] pt-4"
              >
                <span className="block font-mono text-[0.62rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1">
                  {f.label}
                </span>
                <span className="font-body text-[0.98rem] text-[var(--color-ink)] leading-relaxed">
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal className="mb-14">
          <h2 className="m-0 mb-8 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
            <span
              aria-hidden
              className="mb-3 block h-px w-7 bg-[var(--color-accent)]"
            />
            Program
          </h2>
          <ul className="m-0 flex list-none flex-col gap-6 p-0">
            {PROGRAM.map((item) => (
              <li
                key={item.time}
                className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-8"
              >
                <span className="font-mono text-[0.78rem] tracking-[0.06em] text-[var(--color-accent)] sm:pt-0.5">
                  {item.time}
                </span>
                <div>
                  <span className="font-body text-[1.02rem] font-medium text-[var(--color-ink)] leading-snug">
                    {item.title}
                  </span>
                  {item.detail && (
                    <p className="m-0 mt-1 font-body text-[0.92rem] text-[var(--color-ink-muted)] leading-relaxed">
                      {item.detail}
                    </p>
                  )}
                  {item.people && (
                    <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                      {item.people.map((person) => (
                        <li
                          key={person}
                          className="font-body text-[0.92rem] text-[var(--color-ink-muted)] leading-relaxed"
                        >
                          {person}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="mb-14 max-w-[760px]">
          <h2 className="m-0 mb-5 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
            <span
              aria-hidden
              className="mb-3 block h-px w-7 bg-[var(--color-accent)]"
            />
            Venue and access
          </h2>
          <p className="m-0 font-body text-[0.98rem] text-[var(--color-ink-secondary)] leading-relaxed">
            UCLouvain Saint-Louis is a ten-minute walk from the National Bank
            of Belgium conference venue. Enter via the car park at Rue des
            Marais 119: walk to the back-right corner, through the
            &ldquo;Pr&eacute;fecture&rdquo; door &mdash; Room P02 is
            immediately to the right. At 17:00 we walk together to the IARIW
            reception.
          </p>
        </Reveal>

        <Reveal className="max-w-[760px]">
          <h2 className="m-0 mb-5 font-display text-[1.35rem] font-light tracking-[0.02em] text-[var(--color-ink)]">
            <span
              aria-hidden
              className="mb-3 block h-px w-7 bg-[var(--color-accent)]"
            />
            Co-organizers
          </h2>
          <p className="m-0 font-body text-[0.98rem] text-[var(--color-ink-secondary)] leading-relaxed">
            The Axiom Foundation and{" "}
            <a
              href="https://policyengine.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] no-underline hover:text-[var(--color-accent-hover)] transition-colors"
            >
              PolicyEngine
            </a>
            , with{" "}
            <a
              href="https://cape-saintlouis.be"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] no-underline hover:text-[var(--color-accent-hover)] transition-colors"
            >
              CAPE
            </a>{" "}
            and{" "}
            <a
              href="https://beamm.brussels"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] no-underline hover:text-[var(--color-accent-hover)] transition-colors"
            >
              BEAMM
            </a>{" "}
            at UCLouvain Saint-Louis. Questions:{" "}
            <a
              href="mailto:hello@axiom.org"
              className="text-[var(--color-accent)] no-underline hover:text-[var(--color-accent-hover)] transition-colors"
            >
              hello@axiom.org
            </a>
            .
          </p>
        </Reveal>
      </div>
    </div>
  );
}
