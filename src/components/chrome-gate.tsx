"use client";

import { usePathname } from "next/navigation";

/** Paths that render without the site nav and footer: full-screen event pages. */
const BARE_PREFIXES = ["/aspen"];

export function isBarePath(pathname: string | null): boolean {
  if (!pathname) return false;
  return BARE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Renders the site chrome (nav, footer) everywhere except bare paths. */
export function ChromeGate({ children }: { children: React.ReactNode }) {
  return isBarePath(usePathname()) ? null : children;
}
