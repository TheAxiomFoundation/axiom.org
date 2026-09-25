import { Reveal, RevealGroup, RevealItem } from "./reveal";

export function TheGapSection() {
  return (
    <section
      id="gap"
      className="relative z-1 py-32 px-8"
    >
      <div className="max-w-[1280px] mx-auto">
        <Reveal className="text-center mb-16">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            I &middot; The gap
          </span>
          <h2 className="heading-section mb-6 mt-2">
            We didn&rsquo;t write the law for computers.
          </h2>
        </Reveal>

        <Reveal
          delay={0.05}
          className="max-w-[720px] mx-auto font-body text-[1.05rem] text-[var(--color-ink-secondary)] leading-relaxed space-y-6"
        >
          <p>
            Every benefit calculator, tax program, and policy assistant has to
            translate the law from human prose into something a machine can run.
            Most do it from scratch. Most do it differently. Most do it
            out of public view, making it hard to verify and harder to fix.
          </p>
          <p>
            There is no shared layer to point at. No canonical source for what
            the Earned Income Tax Credit actually computes, or how the SNAP
            standard medical deduction should treat a 2024 medical expense in
            Tennessee. The text exists. The closed interpretation does too. The
            connection between them does not.
          </p>
          <p>
            <span className="font-bold text-[var(--color-ink)]">The Axiom Foundation</span>{" "}
            publishes that layer &mdash; statute by statute, citation by
            citation as rules as code &mdash; in the open, free for anyone to
            use.
          </p>
        </Reveal>

        <RevealGroup
          className="mt-20 max-w-[860px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--color-rule)] border border-[var(--color-rule)] rounded-md overflow-hidden"
          staggerChildren={0.12}
          amount={0.3}
        >
          {[
            {
              label: "Today",
              lines: [
                "Each system reimplements the law",
                "Numbers without citations",
                "No shared way to verify",
              ],
            },
            {
              label: "Encoded",
              lines: [
                "One source of truth",
                "Every value cites a statute",
                "Anyone can run, audit, or reform",
              ],
              highlight: true,
            },
            {
              label: "Why now",
              lines: [
                "AI needs ground truth",
                "People are asking models policy questions",
                "There has to be an answer key",
              ],
            },
          ].map((col) => (
            <RevealItem
              key={col.label}
              className={`p-6 ${
                col.highlight
                  ? "bg-[var(--color-accent-light)]"
                  : "bg-[var(--color-paper-elevated)]"
              }`}
            >
              <div
                className={`font-mono text-[0.65rem] tracking-[0.2em] uppercase mb-4 ${
                  col.highlight
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-ink-muted)]"
                }`}
              >
                {col.label}
              </div>
              <ul className="space-y-2 m-0 p-0 list-none">
                {col.lines.map((l) => (
                  <li
                    key={l}
                    className="font-body text-[0.9rem] text-[var(--color-ink-secondary)] leading-snug"
                  >
                    {l}
                  </li>
                ))}
              </ul>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
