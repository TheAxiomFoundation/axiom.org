"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Nav } from "@axiom-foundation/ui";

interface NavClientProps {
  baseUrl?: string;
  appUrl?: string;
}

/** The nav carries no search trigger for now: the palette's results
 *  lead into the raw corpus tree, which isn't the front door we want
 *  yet. The ⌘K shortcut is retired too — corpus search is reachable
 *  only from the /axiom landing's own triggers. When the trigger
 *  returns, gate it to app surfaces with a pattern that matches /app
 *  on BOTH server and client — the proxy rewrites /app to
 *  /axiom/graph, and a one-sided match hydration-crashes (#418) on
 *  every /app load. */
export function NavClient({ baseUrl, appUrl }: NavClientProps) {
  const pathname = usePathname();

  return (
    <Nav
      pathname={pathname}
      renderLink={Link}
      baseUrl={baseUrl}
      appUrl={appUrl}
    />
  );
}
