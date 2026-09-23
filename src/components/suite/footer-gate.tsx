"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SUITE_LINES } from "./lines";

/** PROTOTYPE (suite-mock): on /suite the site footer (which describes
 *  the rules program only) gives way to one that lists the five lines. */
export function FooterGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!pathname?.startsWith("/suite")) return <>{children}</>;

  return (
    <footer className="relative z-10 border-t border-[var(--color-rule)] px-8 py-14">
      <div className="mx-auto grid max-w-[1280px] gap-10 md:grid-cols-[1.2fr_2fr]">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/axiom-wordmark-bare.svg" alt="Axiom" className="h-[26px] w-auto" />
          {pathname !== "/suite" && (
            <p className="mt-4 max-w-[340px] font-body text-[0.85rem] leading-relaxed text-[var(--color-ink-muted)]">
              The Axiom Institute builds open models of law and policy.
            </p>
          )}
        </div>
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {SUITE_LINES.map((line) => (
            <li key={line.slug}>
              <Link href={`/suite/${line.slug}`} className="no-underline">
                <span className="flex items-center gap-2 font-body text-[0.98rem] text-[var(--color-ink)]">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: line.hue }} />
                  {line.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
