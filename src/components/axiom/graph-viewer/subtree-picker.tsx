"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { humanizeCitation, humanizeRuleName } from "./citations";
import {
  ALL_STATES,
  buildListEntries,
  filterListEntries,
  filterModulesByScope,
  LIST_SLAB_SIZE,
  type JurisdictionScope,
} from "./list-entries";
import {
  computeFieldHighlights,
  type CorpusModule,
} from "@/lib/axiom/corpus-field";

/**
 * The launcher's single verb: pick a node → its subgraph opens.
 *
 * Two pieces, composed by the launcher:
 * - SubtreeSearch — a search over EVERY subtree the corpus serves
 *   (matching humanized citation + raw target). Compact mode floats
 *   its results as a dropdown, for the top-right control cluster
 *   over the full-bleed field. Optionally controlled, so the same
 *   query can filter the list mode's full corpus list live.
 * - SubtreeDoors — the census's own computed doors as a featured
 *   band, then the COMPLETE corpus list (the same view set the
 *   field draws), rendered in slabs as the reader scrolls.
 *
 * Picking anything calls onPick(target); the viewer enters compose
 * mode for exactly that root. No program cards, no registry.
 */

const MAX_RESULTS = 40;

export function SubtreeSearch({
  modules,
  onPick,
  compact = false,
  query: controlledQuery,
  onQueryChange,
}: {
  modules: CorpusModule[];
  onPick: (target: string) => void;
  /** Floating variant: results drop down over whatever is beneath. */
  compact?: boolean;
  /** Controlled mode (the launcher shares the query with the full
   *  list, which filters live as the reader types). */
  query?: string;
  onQueryChange?: (query: string) => void;
}) {
  const [ownQuery, setOwnQuery] = useState("");
  const query = controlledQuery ?? ownQuery;
  const setQuery = onQueryChange ?? setOwnQuery;

  // Humanize once — thousands of citations per keystroke is real money.
  const entries = useMemo(
    () =>
      modules.map((module) => {
        const citation = humanizeCitation(module.target);
        // The headline rule is how people actually name a module
        // ("Net Investment Income Tax", "Social Security Benefits
        // Included In Gross Income") — a citation-only haystack made
        // federal statutes unfindable by policy name (their citations
        // are just numbers).
        const headline = module.headlineRule
          ? humanizeRuleName(module.headlineRule)
          : null;
        return {
          module,
          label: headline ?? citation,
          citation,
          haystack:
            `${headline ?? ""} ${citation} ${module.target}`.toLowerCase(),
        };
      }),
    [modules],
  );

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const tokens = trimmed.split(/\s+/);
    // Ranked in three tiers: a hit in the module's NAME (headline
    // rule) beats a hit in its citation, which beats a hit that only
    // lives in the raw file path — "social security" surfaces §86
    // ("Social Security Benefits Included In Gross Income") above
    // state documents merely titled or filed under those words.
    const byHeadline: typeof entries = [];
    const byCitation: typeof entries = [];
    const byPath: typeof entries = [];
    for (const entry of entries) {
      if (!tokens.every((token) => entry.haystack.includes(token))) continue;
      const headline =
        entry.label === entry.citation ? "" : entry.label.toLowerCase();
      const citation = entry.citation.toLowerCase();
      if (headline && tokens.every((token) => headline.includes(token))) {
        byHeadline.push(entry);
      } else if (tokens.every((token) => citation.includes(token))) {
        byCitation.push(entry);
      } else {
        byPath.push(entry);
      }
      if (byHeadline.length >= MAX_RESULTS) break;
    }
    // Within a tier, substantial modules first — the 26-rule §86
    // encoding is a better "social security" answer than a 2-rule
    // side definition that happens to share the words.
    const bySize = (a: (typeof entries)[number], b: (typeof entries)[number]) =>
      b.module.ruleCount - a.module.ruleCount;
    return [
      ...byHeadline.sort(bySize),
      ...byCitation.sort(bySize),
      ...byPath.sort(bySize),
    ].slice(0, MAX_RESULTS);
  }, [entries, query]);

  const searching = query.trim().length > 0;

  return (
    <div className={`subtree-search ${compact ? "is-compact" : ""}`}>
      <input
        type="search"
        className="picker-search"
        data-testid="picker-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${modules.length.toLocaleString("en-US")} provisions…`}
        aria-label="Search every encoded provision"
      />
      {searching && (
        <div
          className={`picker-results ${compact ? "picker-results-floating" : ""}`}
          role="listbox"
          aria-label="Matching provisions"
        >
          {matches.map((entry) => (
            <button
              type="button"
              key={entry.module.target}
              className="picker-result"
              data-testid="picker-result"
              onClick={() => onPick(entry.module.target)}
            >
              <strong>{entry.label}</strong>
              <span className="picker-result-target">
                {entry.label === entry.citation
                  ? entry.module.target
                  : entry.citation}
                {entry.module.ruleCount > 0
                  ? ` · ${entry.module.ruleCount} rules`
                  : ""}
              </span>
            </button>
          ))}
          {matches.length === 0 && (
            <p className="picker-empty">
              No provision matches — try a citation fragment like
              “273.10” or “7 usc 2014”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The door band's label: humanized headline rule first, citation
 *  second — exactly the field doors' naming. */
function doorTitle(module: CorpusModule): string {
  return module.headlineRule
    ? humanizeRuleName(module.headlineRule)
    : humanizeCitation(module.target);
}

export function SubtreeDoors({
  modules,
  onPick,
  query = "",
  scope = "all",
  state = ALL_STATES,
}: {
  modules: CorpusModule[];
  onPick: (target: string) => void;
  /** The launcher's shared search query — filters the full list
   *  live (the doors stay put; they are the "start here" band). */
  query?: string;
  /** All · Nationwide (us) · States (us-XX) — applies to the doors
   *  band AND the complete list, composed with the query. */
  scope?: JurisdictionScope;
  /** One `us-XX` under the States scope (ALL_STATES = every state);
   *  cuts the doors band and the list alike. */
  state?: string;
}) {
  const doors = useMemo(
    () => computeFieldHighlights(filterModulesByScope(modules, scope, state)),
    [modules, scope, state],
  );
  const entries = useMemo(() => buildListEntries(modules), [modules]);
  const filtered = useMemo(
    () => filterListEntries(entries, query, scope, state),
    [entries, query, scope, state],
  );
  // Slab rendering: 2,900 rows of DOM at once is a jank tax — the
  // sentinel at the list's tail appends the next slab on scroll.
  const [slabs, setSlabs] = useState(1);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // A new search, scope, or state restarts the window.
    setSlabs(1);
  }, [query, scope, state]);
  const visible = filtered.slice(0, slabs * LIST_SLAB_SIZE);
  const exhausted = visible.length >= filtered.length;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || exhausted) return;
    if (typeof IntersectionObserver === "undefined") {
      // jsdom / ancient engines: show everything rather than trap
      // the list at one slab.
      setSlabs(Number.MAX_SAFE_INTEGER);
      return;
    }
    const observer = new IntersectionObserver((observed) => {
      if (observed.some((entry) => entry.isIntersecting)) {
        setSlabs((current) => current + 1);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [exhausted, slabs]);

  return (
    <>
      <p className="picker-doors-label">
        start here — the corpus&apos;s deepest subtrees
      </p>
      <div className="picker-doors">
        {doors.map((module, index) => (
          <button
            type="button"
            key={module.target}
            className="picker-door"
            data-testid="picker-door"
            style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
            onClick={() => onPick(module.target)}
          >
            <span className="plane-launcher-chip">
              {module.jurisdiction.toUpperCase()}
            </span>
            <strong>{doorTitle(module)}</strong>
            {module.headlineRule && (
              <span className="picker-door-citation">
                {humanizeCitation(module.target)}
              </span>
            )}
            <span className="plane-launcher-meta">
              {module.ruleCount} rules · {module.bucket}
            </span>
          </button>
        ))}
      </div>
      <p className="picker-list-label">
        the whole corpus —{" "}
        {filtered.length.toLocaleString("en-US")} subtrees
      </p>
      <div
        className="picker-list"
        data-testid="picker-list"
        data-list-total={filtered.length}
        data-list-rendered={visible.length}
      >
        {visible.map((entry) => (
          <button
            type="button"
            key={entry.target}
            className="picker-list-row"
            data-testid="picker-list-row"
            data-jurisdiction={entry.jurisdiction}
            data-target={entry.target}
            title={entry.subtitle ?? entry.title}
            onClick={() => onPick(entry.target)}
          >
            <strong>{entry.title}</strong>
            {entry.subtitle && (
              <span className="picker-list-citation">{entry.subtitle}</span>
            )}
            <span className="picker-list-meta">{entry.meta}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="picker-empty">
            No provision matches — try a citation fragment like
            “273.10” or “7 usc 2014”.
          </p>
        )}
      </div>
      {!exhausted && (
        <div
          ref={sentinelRef}
          className="picker-list-sentinel"
          aria-hidden
        />
      )}
    </>
  );
}
