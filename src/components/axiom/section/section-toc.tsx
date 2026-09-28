"use client";

import type { SectionTocEntry } from "@/lib/axiom/section-page";
import { useActiveAnchor } from "./use-active-anchor";

/**
 * Sticky "On this page" table of contents for the v2 section reader.
 * Server-renderable markup with one client behaviour: a scroll-spy
 * that highlights the subsection currently in view.
 */

function collectAnchors(entries: SectionTocEntry[]): string[] {
  const anchors: string[] = [];
  for (const entry of entries) {
    anchors.push(entry.anchor);
    anchors.push(...collectAnchors(entry.children));
  }
  return anchors;
}

function TocList({
  entries,
  active,
  depth,
}: {
  entries: SectionTocEntry[];
  active: string | null;
  depth: number;
}) {
  if (entries.length === 0) return null;
  return (
    // The list takes one direction from its first label, and nesting
    // indents from that side (ms-, not ml-): a Hebrew outline nests
    // from the right. The anchors carry no dir of their own: the auto
    // scan skips text under a descendant that has one, so a dir on
    // every anchor would leave the list nothing to read and pin it LTR.
    <ol
      {...(depth === 0 && { dir: "auto" })}
      className={depth === 0 ? "space-y-1" : "mt-1 ms-3 space-y-1"}
    >
      {entries.map((entry) => (
        <li key={entry.anchor}>
          <a
            href={`#${entry.anchor}`}
            aria-current={active === entry.anchor ? "location" : undefined}
            className={`block truncate rounded-sm px-2 py-1 text-[0.8rem] leading-snug transition-colors ${
              active === entry.anchor
                ? "bg-[var(--color-surface-raised,rgba(0,0,0,0.05))] text-[var(--color-ink)] font-medium"
                : "text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
            }`}
          >
            {entry.label}
          </a>
          <TocList entries={entry.children} active={active} depth={depth + 1} />
        </li>
      ))}
    </ol>
  );
}

export function SectionToc({ entries }: { entries: SectionTocEntry[] }) {
  const active = useActiveAnchor(collectAnchors(entries));
  if (entries.length === 0) return null;

  return (
    <nav
      aria-label="On this page"
      data-testid="section-toc"
      className="text-sm"
    >
      <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        On this page
      </p>
      <TocList entries={entries} active={active} depth={0} />
    </nav>
  );
}
