import { Reveal, RevealGroup, RevealItem } from "./reveal";

const LAYERS = [
  {
    n: "01",
    kicker: "The source corpus",
    title: "The primary text, gathered and addressable",
    body:
      "We gather national statutes, regulations, agency guidance, and state law from official sources — openly licensed, version-controlled, and addressable by citation. The primary text every encoding points back to.",
    bullets: [
      "United States Code (national statutes)",
      "Code of Federal Regulations",
      "IRS revenue procedures, rulings, and notices",
      "State codes and tax law",
    ],
  },
  {
    n: "02",
    kicker: "Encodings",
    title: "Encoded so anyone can compute them",
    body:
      "We turn the same rules into machine-readable form — every value cites a section, every clause is dated, formulas are executable. Compiles to native code; runs anywhere.",
    bullets: [
      "Cited — every value traces to a statute",
      "Time-aware — effective dates on every clause",
      "Composable — reform a parameter without rewriting",
      "Cross-checked — against other calculators where a comparison exists",
    ],
  },
];

export function EncodedLawSection() {
  return (
    <section
      id="encoded"
      className="section-dark relative z-1 py-32 px-8"
    >
      <div className="max-w-[1280px] mx-auto">
        <Reveal className="text-center mb-20">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            II &middot; What we publish
          </span>
          <h2 className="heading-section mb-6 mt-2">
            Two layers, both in the open
          </h2>
          <p className="font-body text-lg text-[var(--color-ink-secondary)] max-w-[680px] mx-auto leading-relaxed">
            Source documents anyone can fetch and cite, plus the encodings that
            make those rules{" "}
            <span className="serif-italic text-[var(--color-ink)]">
              computable, time-aware, and verifiable
            </span>
            .
          </p>
        </Reveal>

        <RevealGroup
          className="grid gap-6 md:grid-cols-2 max-w-[1080px] mx-auto mb-28"
          staggerChildren={0.12}
        >
          {LAYERS.map((layer) => (
            <RevealItem key={layer.n} as="div" className="card-edition p-8 flex flex-col transition-transform duration-300 hover:-translate-y-1">
              <div className="flex items-baseline justify-between mb-5">
                <span className="font-mono text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]">
                  {layer.kicker}
                </span>
              </div>
              <h3 className="font-display text-[1.4rem] font-light tracking-[0.02em] text-[var(--color-ink)] mb-4 leading-snug">
                {layer.title}
              </h3>
              <p className="font-body text-[0.95rem] text-[var(--color-ink-secondary)] leading-relaxed mb-5">
                {layer.body}
              </p>
              <ul className="mt-auto space-y-1.5 m-0 p-0 list-none font-mono text-[0.78rem] text-[var(--color-ink-muted)] tracking-[0.04em]">
                {layer.bullets.map((b) => (
                  <li key={b}>&middot; {b}</li>
                ))}
              </ul>
            </RevealItem>
          ))}
        </RevealGroup>

      </div>
    </section>
  );
}
