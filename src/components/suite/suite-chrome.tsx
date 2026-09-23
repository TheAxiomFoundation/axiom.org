"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SUITE_AS_OF, SUITE_LINES } from "./lines";

/** Prototype banner + the suite's own nav: the wordmark, then the five
 *  lines. The site's normal nav is suppressed on /suite (nav-client). */
export function SuiteChrome() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40">
      <div className="bg-[var(--color-ink)] px-4 py-1.5 text-center font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[var(--color-paper)]">
        Prototype &middot; not public &middot; figures read from each program&apos;s live site, {SUITE_AS_OF} and 22 Sep 2026
      </div>
      <nav
        aria-label="Axiom suite"
        className="border-b border-[var(--color-rule)] bg-[color-mix(in_srgb,var(--color-paper)_92%,transparent)] backdrop-blur"
      >
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-8 gap-y-2 px-8 py-3">
          <Link href="/suite" aria-label="Axiom" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/axiom-wordmark-bare.svg"
              alt="Axiom"
              className="h-[22px] w-auto"
            />
          </Link>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-1">
            {SUITE_LINES.map((line) => {
              const href = `/suite/${line.slug}`;
              const active = pathname === href;
              return (
                <li key={line.slug}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    style={{ color: active ? "var(--color-ink)" : "var(--color-ink-secondary)" }}
                    className={`group inline-flex items-center gap-2 border-b py-1 no-underline font-body text-[0.92rem] transition-colors ${
                      active
                        ? "border-[var(--color-ink)] text-[var(--color-ink)]"
                        : "border-transparent text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: line.hue }}
                    />
                    {line.name.replace("Axiom ", "")}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </header>
  );
}
