import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team — Axiom Foundation",
  description:
    "The founding team of the Axiom Foundation — we've spent years making policy rules computable, in government, in research, and in open source.",
};

// TODO(⛳): confirm LinkedIn URLs with each subject before ship.
const MEMBERS = [
  {
    name: "Max Ghenis",
    // Reframed 2026-10-06 per Max's 2026-10-05 direction: a leader described
    // by his organizations' missions, with no builder lines. Wording from his
    // own Aspen (2026-06-15) and Center for Civic Futures (2026-06-07) bios;
    // facts carried from the version he confirmed 2026-07-12 and revised
    // 2026-07-14 (Round1-Website-Copy.md §3).
    title: "Chief Executive Officer and Founder",
    image: "/team/max-ghenis.jpg",
    linkedin: "https://www.linkedin.com/in/maxghenis",
    bio: [
      "Max leads the Axiom Foundation, which publishes open, machine-readable encodings of the world's rules — starting with tax and benefit policy — so anyone can run, audit, or reform them. He is also co-founder and CEO of PolicyEngine, a nonprofit whose open-source software computes how taxes and benefits affect households and populations in the US and UK, and how proposed reforms would change eligibility, costs, and poverty. The Joint Economic Committee, the Bureau of Economic Analysis, and 10 Downing Street use PolicyEngine, and it powers the benefit screeners several partners run to connect families with programs they qualify for.",
      "Before PolicyEngine, he founded the UBI Center, a think tank whose team published 60+ open studies of universal basic income and cash transfers. Earlier, he spent eight years at Google and YouTube as a data scientist and people-analytics manager. He holds a bachelor's in operations research from UC Berkeley and a master's in Data, Economics, and Development Policy from MIT, and is an elected member of the National Academy of Social Insurance.",
    ],
  },
  {
    name: "Ariel Kennan",
    title: "President",
    image: "/team/ariel-kennan.jpg",
    linkedin: "https://www.linkedin.com/in/arielkennan",
    bio: [
      "Ariel leads the Axiom Foundation's strategy, operations, partnerships, fundraising, and team-building — after more than a decade of senior leadership making government benefits computable, humane, and accountable. As Director of Design and Product at the NYC Mayor's Office for Economic Opportunity, she founded the nation's first municipal service design studio and built and led the product portfolio, including ACCESS NYC, the first open-source, API-driven benefits screener.",
      "She conducted some of the earliest US research on rules as code approaches as Senior Director at Georgetown University's Beeck Center for Social Impact + Innovation, where she cultivated the Digital Benefits Network and convened the Rules as Code Community of Practice. That community is where she met Max and the PolicyEngine team. She is a visiting lecturer at Cornell Tech, where she co-teaches the Public Interest Technology Impact Studio. Previously she was Director of Civic Innovation at Sidewalk Labs, where she led design and product strategy for new urban systems.",
    ],
  },
  {
    name: "Pavel Makarchuk",
    title: "Product Lead",
    image: "/team/pavel-makarchuk.webp",
    linkedin: "https://www.linkedin.com/in/pavel-makarchuk",
    bio: [
      "Pavel leads the product and applications layer that turns the Axiom Foundation from a technically credible rules stack into something partners can actually use. At PolicyEngine he became one of the deepest hands-on contributors to U.S. tax-and-benefit encoding work, shipping rules, reviewing edge cases, and managing contributor throughput across a sprawling production codebase.",
      "He also led PolicyEngine's validation partnerships: a source-corpus pilot with the Atlanta Federal Reserve, storing and validating hundreds of federal and state source documents to prove the source-archive and document-linking model in practice, and model validation with NBER, cross-checking calculations against TAXSIM over thousands of representative cases. That work sits directly upstream of the Axiom Foundation's app challenge: how do encoded rules, source provenance, and real implementation detail become tools that governments, partners, and downstream applications can actually trust?",
    ],
  },
];

export default function TeamPage() {
  return (
    <div className="relative z-1 py-32 px-8">
      <div className="max-w-[800px] mx-auto">
        <header className="mb-16">
          <h1 className="heading-page mb-6">Founding team</h1>
          <p className="font-body text-xl text-[var(--color-ink-secondary)] leading-relaxed">
            We&apos;re the founding team of the Axiom Foundation &mdash; and
            we&apos;ve spent years making policy rules computable, in
            government, in research, and in open source.
          </p>
        </header>

        <div className="flex flex-col gap-16">
          {MEMBERS.map((member) => (
            <section
              key={member.name}
              className="flex gap-8 items-start max-md:flex-col"
            >
              <Image
                src={member.image}
                alt={member.name}
                width={140}
                height={140}
                className="rounded-full shrink-0 object-cover w-[140px] h-[140px]"
              />
              <div>
                <h2 className="font-body text-2xl text-[var(--color-ink)] mb-1">
                  {member.name}
                </h2>
                <p className="font-mono text-[0.72rem] tracking-[0.16em] uppercase text-[var(--color-ink-muted)] mb-4">
                  {member.title}
                </p>
                {member.bio.map((para, i) => (
                  <p
                    key={i}
                    className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4"
                  >
                    {para}
                  </p>
                ))}
                <a
                  href={member.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-mono text-[0.75rem] tracking-[0.12em] uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
                >
                  LinkedIn
                </a>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
