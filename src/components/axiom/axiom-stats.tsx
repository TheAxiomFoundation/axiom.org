"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAxiomStats,
  type AxiomJurisdictionCount,
  type AxiomStats,
} from "@/lib/supabase";
import { getLandingJurisdictions } from "@/lib/axiom/landing-jurisdictions";
import { RULESPEC_COUNTRY_SLUGS } from "@/lib/axiom/repo-map";
import { JURISDICTIONS, getJurisdictionBySlug } from "@/lib/tree-data";
import { HeroChips } from "./jurisdiction-layouts";

/**
 * Landing-page stat strip + jurisdiction stations grid.
 *
 *  - **Stats strip** — three accent-coloured headline figures with
 *    count-up animation when the RPC resolves.
 *  - **Stations grid** — every ingested jurisdiction is a compact tile
 *    (code + name + count + status dot). Replaces the old phone-book
 *    directory so the page reads as a product surface, not as a
 *    legislative index.
 *
 * Counts hydrate after the stats RPC resolves; the static seed paints
 * the tiles immediately so the page is useful before any server-
 * rendered data arrives.
 */
export function AxiomStats({
  onNavigateHref,
  initialStats = null,
}: {
  onNavigateHref?: (href: string) => void;
  initialStats?: AxiomStats | null;
}) {
  const [stats, setStats] = useState<AxiomStats | null>(initialStats);

  useEffect(() => {
    if (initialStats) return;
    let cancelled = false;
    getAxiomStats().then((s) => {
      if (!cancelled) setStats(s);
    });
    return () => {
      cancelled = true;
    };
  }, [initialStats]);

  const jurisdictions = useMemo(
    () => mergeJurisdictionCounts(stats?.jurisdictions ?? []),
    [stats]
  );
  const jurisdictionStatCount = Math.max(
    stats?.jurisdictions_count ?? 0,
    jurisdictions.length
  );

  return (
    <div data-testid="axiom-stats" className="space-y-14">
      <StatsStrip
        provisionsCount={stats?.provisions_count ?? null}
        referencesCount={stats?.references_count ?? null}
        jurisdictionsCount={stats ? jurisdictionStatCount : null}
      />
      <Stations
        jurisdictions={jurisdictions}
        onNavigateHref={onNavigateHref}
      />
    </div>
  );
}

/**
 * Headline stats row. Three large figures with their long-form labels
 * beneath; the values animate on resolve so the page reads as live
 * rather than static-loaded.
 */
function StatsStrip({
  provisionsCount,
  referencesCount,
  jurisdictionsCount,
}: {
  provisionsCount: number | null;
  referencesCount: number | null;
  jurisdictionsCount: number | null;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-x-12 gap-y-6 sm:gap-x-16">
      <Stat value={provisionsCount} label="provisions indexed" />
      <Stat value={referencesCount} label="citations extracted" />
      <Stat value={jurisdictionsCount} label="jurisdictions" />
    </div>
  );
}

function Stat({ value, label }: { value: number | null; label: string }) {
  const animated = useCountUp(value);
  return (
    <div className="text-center">
      <div
        className={`min-h-[1.2em] min-w-[5ch] font-display text-[clamp(2rem,3.5vw,2.5rem)] font-light tabular-nums text-[var(--color-accent)] transition-opacity duration-300 ${
          value === null ? "opacity-0" : "opacity-100"
        }`}
        title={value === null ? undefined : value.toLocaleString()}
        aria-hidden={value === null}
      >
        {value === null ? "" : formatCompact(animated)}
      </div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </div>
    </div>
  );
}

/**
 * Stations grid — compact tile per jurisdiction with code, name, count,
 * and an indexed/pending status dot. Federal slugs lead, then states
 * alphabetically. Pending (count 0) tiles are visible but non-clickable
 * so users understand the corpus's full footprint without being able
 * to navigate into an empty page.
 */
function Stations({
  jurisdictions,
  onNavigateHref,
}: {
  jurisdictions: JurisdictionNavCount[];
  onNavigateHref?: (href: string) => void;
}) {
  const ordered = useMemo(
    () => orderForStations(jurisdictions),
    [jurisdictions]
  );

  return (
    <section aria-label="Choose a jurisdiction" data-testid="axiom-stats-pills">
      <HeroChips items={ordered} onNavigateHref={onNavigateHref} />
    </section>
  );
}

type JurisdictionNavCount =
  | AxiomJurisdictionCount
  | { jurisdiction: string; count: null };

/**
 * Order the stations grid: federal/national first (US, UK, Belgium, Canada),
 * then US states + territories sorted by descending rule count so the
 * biggest corpora surface near the top. Pending tiles fall to the
 * bottom of the states block so the grid leads with what's actually
 * available.
 */
function orderForStations(
  jurisdictions: JurisdictionNavCount[]
): Array<{ slug: string; label: string; count: number | null }> {
  type Item = { slug: string; label: string; count: number | null };
  const federal: Item[] = [];
  const states: Item[] = [];
  const other: Item[] = [];

  for (const j of jurisdictions) {
    const config = getJurisdictionBySlug(j.jurisdiction);
    const item: Item = {
      slug: j.jurisdiction,
      label: config?.label ?? humanizeIdentifier(j.jurisdiction),
      count: j.count,
    };
    if (RULESPEC_COUNTRY_SLUGS.includes(j.jurisdiction)) {
      federal.push(item);
    } else if (j.jurisdiction.startsWith("us-")) {
      states.push(item);
    } else {
      other.push(item);
    }
  }

  const byCountDesc = (a: Item, b: Item) => {
    const aEmpty = a.count === null || a.count === 0;
    const bEmpty = b.count === null || b.count === 0;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    return (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label);
  };
  federal.sort(byCountDesc);
  states.sort(byCountDesc);
  other.sort(byCountDesc);

  return [...federal, ...states, ...other];
}

function mergeJurisdictionCounts(
  counts: AxiomJurisdictionCount[]
): JurisdictionNavCount[] {
  const seededSlugs = new Set(JURISDICTIONS.map((j) => j.slug));
  const countBySlug = new Map(counts.map((j) => [j.jurisdiction, j.count]));
  // An empty `counts` array means the stats RPC hasn't returned yet,
  // so seeded slugs render as "loading" (null) tiles. Once the RPC
  // has produced *any* row we know the corpus's full ledger of
  // non-empty jurisdictions, so seeded slugs missing from the payload
  // are confirmed-empty (count: 0) — shown as dimmed pending tiles
  // that are not clickable.
  const statsResolved = counts.length > 0;

  const seeded = getLandingJurisdictions(countedSlugs(counts)).map(
    (jurisdiction) => ({
      jurisdiction: jurisdiction.slug,
      count:
        countBySlug.get(jurisdiction.slug) ??
        (statsResolved ? 0 : null),
    })
  );

  const unseeded = counts
    .filter((j) => !seededSlugs.has(j.jurisdiction))
    .map((j) => ({ jurisdiction: j.jurisdiction, count: j.count }));

  return [...seeded, ...unseeded];
}

function countedSlugs(counts: AxiomJurisdictionCount[]): Set<string> {
  return new Set(counts.map((j) => j.jurisdiction));
}

/**
 * Animate a number from 0 (or the previous value) to a target on
 * mount/change. Uses `requestAnimationFrame` for a smooth ease-out.
 * Users who prefer reduced motion get the target value directly on
 * the same render — no transient zero state — so screen readers and
 * tests observe the final value immediately.
 */
function useCountUp(target: number | null, durationMs = 900): number {
  const reduced =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [animated, setAnimated] = useState(0);
  const previousRef = useRef(0);

  useEffect(() => {
    if (target === null || reduced) return;
    /* v8 ignore start -- requestAnimationFrame branch; tests always
       run with prefers-reduced-motion mocked so this animation path
       is exercised manually rather than by the unit suite. */
    const start = performance.now();
    const from = previousRef.current;
    const to = target;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (to - from) * eased);
      setAnimated(next);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        previousRef.current = to;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    /* v8 ignore stop */
  }, [target, durationMs, reduced]);

  if (target === null) return 0;
  if (reduced) return target;
  return animated;
}

/**
 * Render a jurisdiction code as its short display label.
 *
 *   'us'     → 'USC+CFR'    (federal statutes + regulations)
 *   'us-ny'  → 'NY'
 *   'us-dc'  → 'DC'
 *   'uk'     → 'UK'
 *   'be'     → 'BE'
 *   'canada' → 'CAN'
 */
export function jurisdictionDisplay(jurisdiction: string): string {
  if (jurisdiction === "us") return "USC+CFR";
  if (jurisdiction === "ca") return "CAN";
  if (jurisdiction === "nz") return "NZ";
  if (jurisdiction === "uk") return "UK";
  if (jurisdiction === "be") return "BE";
  if (jurisdiction.startsWith("us-")) {
    return jurisdiction.slice(3).toUpperCase();
  }
  // Uncurated slugs render as the raw slug uppercased (preserving
  // separators) so the station's code chip stays distinct from its
  // humanized full label.
  return jurisdiction.toUpperCase();
}

export function humanizeIdentifier(value: string): string {
  // Jurisdiction-identifier casing only — EU/UN are geography, not the
  // program vocabulary in src/lib/display-acronyms.ts (where "un" or "eu"
  // inside a rule fragment would be an ordinary word, not an acronym).
  const acronyms = new Set(["us", "uk", "eu", "un", "dc"]);

  return value
    .trim()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (acronyms.has(part.toLowerCase())) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Render a count as a compact human-readable string.
 *
 *   1,234       → "1.2K"
 *   658,899     → "659K"
 *   1,500,000   → "1.5M"
 *   17          → "17"
 */
export function formatCompact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 10_000) return (n / 1_000).toFixed(1) + "K";
  if (n < 1_000_000) return Math.round(n / 1_000) + "K";
  return (n / 1_000_000).toFixed(1) + "M";
}
