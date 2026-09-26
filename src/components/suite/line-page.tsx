import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { SUITE_AS_OF, SUITE_LINES, type SuiteLine } from "./lines";

export function LinePage({ line }: { line: SuiteLine }) {
  const others = SUITE_LINES.filter((l) => l.slug !== line.slug);

  return (
    <>
      <section className="relative z-1 px-8 pb-14 pt-20">
        <div className="mx-auto grid max-w-[1280px] items-end gap-14 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <span className="kicker mb-6 inline-flex items-center">
              <span
                aria-hidden
                className="mr-2 inline-block h-2 w-2 rounded-full"
                style={{ background: line.hue }}
              />
              {line.name} &middot; {line.noun}
            </span>
            <h1 className="mt-2 text-balance font-display text-[clamp(2rem,3.6vw,3.1rem)] font-light leading-[1.05] tracking-[-0.02em] text-[var(--color-ink)]">
              {line.headline}
            </h1>
            {/* Rules' headline already is its tagline; say it once. */}
            {line.forAll !== line.headline ? (
              <p className="serif-italic mt-4 text-[1.2rem] text-[var(--color-ink)]">
                {line.forAll}
              </p>
            ) : null}
            <p className="mt-4 max-w-[680px] text-pretty font-body text-[1.05rem] leading-relaxed text-[var(--color-ink-secondary)]">
              {line.body}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href={line.today.href} className="btn-primary">
                {line.cta}
                <ArrowRightIcon className="h-5 w-5" />
              </a>
              {line.deep ? (
                line.deep.href.startsWith("/") ? (
                  <Link href={line.deep.href} className="btn-outline">{line.deep.label}</Link>
                ) : (
                  <a href={line.deep.href} className="btn-outline">{line.deep.label}</a>
                )
              ) : null}
              <Link href="/suite" className="font-body text-[0.95rem] text-[var(--color-ink-secondary)]">
                All of Axiom
              </Link>
            </div>
          </div>
          {line.figure ? (
            <div className="border-l pl-8" style={{ borderColor: line.hue }}>
              <div className="font-display text-[clamp(2.6rem,5vw,4rem)] font-light leading-none tracking-[-0.02em] text-[var(--color-ink)]">
                {line.figure.value}
              </div>
              <div className="mt-3 font-mono text-[0.62rem] uppercase leading-relaxed tracking-[0.16em] text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
                {line.figure.label}
                <br />
                {line.figure.source} &middot; {line.figure.asOf ?? SUITE_AS_OF}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {line.promise ? (
        <section className="relative z-1 px-8 pb-14">
          <div className="mx-auto max-w-[1280px]">
            <div className="max-w-[820px] border-l-2 pl-6" style={{ borderColor: line.hue }}>
              <h2 className="font-mono text-[0.62rem] font-normal uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
                The promise
              </h2>
              <p className="mt-3 text-pretty font-body text-[1.02rem] leading-relaxed text-[var(--color-ink)]">
                {line.promise}
              </p>
              {line.checks?.length ? (
                <p className="mt-3 font-body text-[0.9rem] text-[var(--color-ink-secondary)]">
                  Checked on{" "}
                  {line.checks.map((c, i) => (
                    <span key={c.href}>
                      {i > 0 ? " · " : null}
                      <a href={c.href} className="underline decoration-[var(--color-rule-strong)] underline-offset-2">
                        {c.label}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section
        className="relative z-1 px-8 py-14"
        style={{ borderTop: `3px solid ${line.hue}` }}
      >
        <div className="mx-auto grid max-w-[1280px] gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {line.features.map((f) => (
            <div key={f.title} className="card-edition p-6">
              <h3 className="font-display text-[1.2rem] font-normal text-[var(--color-ink)]">
                {f.title}
              </h3>
              <p className="mt-2 font-body text-[0.95rem] leading-relaxed text-[var(--color-ink-secondary)]">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {line.inside ? (
        <section className="relative z-1 border-t border-[var(--color-rule)] px-8 py-16">
          <div className="mx-auto max-w-[1280px]">
            <h2 className="heading-section mb-6">{line.inside.heading}</h2>
            <div className="grid gap-5 md:grid-cols-3">
              {line.inside.items.map((b) => {
                const inner = (
                  <>
                    <h3 className="font-display text-[1.2rem] font-normal text-[var(--color-ink)]">{b.title}</h3>
                    <p className="mt-2 font-body text-[0.95rem] leading-relaxed text-[var(--color-ink-secondary)]">{b.body}</p>
                  </>
                );
                return b.href ? (
                  <a key={b.title} href={b.href} className="card-edition no-underline p-6" style={{ borderTop: `3px solid ${line.hue}` }}>
                    {inner}
                  </a>
                ) : (
                  <div key={b.title} className="card-edition p-6" style={{ borderTop: `3px solid ${line.hue}` }}>
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {line.snapshot ? (
        <section className="relative z-1 border-t border-[var(--color-rule)] px-8 py-16">
          <div className="mx-auto max-w-[1280px]">
            <h2 className="heading-section mb-2">{line.snapshot.heading}</h2>
            <p className="mb-6 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
              {line.snapshot.note} &middot; read {line.snapshot.asOf ?? SUITE_AS_OF}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left font-body text-[0.95rem]">
                <thead>
                  <tr>
                    {line.snapshot.rows[0].map((h) => (
                      <th
                        key={h}
                        className="border-b border-[var(--color-rule-strong)] py-2 pr-6 font-mono text-[0.62rem] font-normal uppercase tracking-[0.16em] text-[var(--color-ink-muted)]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {line.snapshot.rows.slice(1).map((row) => (
                    <tr key={row.join("|")}>
                      {row.map((cell, i) => (
                        <td
                          key={i}
                          className="border-b border-[var(--color-rule)] py-3 pr-6 align-top text-[var(--color-ink)]"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <section className="relative z-1 border-t border-[var(--color-rule)] px-8 py-16">
        <div className="mx-auto max-w-[1280px]">
          <p className="mb-6 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
            Also from Axiom
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {others.map((o) => (
              <Link
                key={o.slug}
                href={`/suite/${o.slug}`}
                className="card-edition group no-underline min-w-0 p-5 transition-transform duration-300 hover:-translate-y-1"
                style={{ borderTop: `3px solid ${o.hue}` }}
              >
                <div className="font-display text-[1.15rem] text-[var(--color-ink)]">
                  {o.name}
                </div>
                <div className="serif-italic mt-1 text-[0.95rem] text-[var(--color-ink-secondary)]">
                  {o.forAll}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
