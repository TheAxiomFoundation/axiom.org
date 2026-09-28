"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock3, Search, SlidersHorizontal } from "lucide-react";
import { LibrarySearchResults } from "./library-search-results";
import { LibraryBubbles } from "./library-bubbles";
import type { CorpusModule } from "@/lib/axiom/corpus-field";
import { humanizeCitation, humanizeRuleName, jurisdictionLabel } from "./citations";
import { LIBRARY_EVENT, readRecentRules, readRunCapabilities, type RecentRule, type RunCapability } from "./library-state";
import type { LauncherMode } from "./launcher-mode";
import "./library.css";

const MemoizedLibraryBubbles = memo(LibraryBubbles);

const STARTERS: Record<string, { title: string; description: string }> = {
  "us:statutes/26/32": { title: "Earned income tax credit", description: "Explore eligibility, qualifying children, and the credit calculation." },
  "us:statutes/26/21": { title: "Child and dependent care credit", description: "Follow care expenses through the credit’s rules." },
  "us:statutes/26/25A": { title: "Education credits", description: "Explore how education expenses connect to tax credits." },
};

export function libraryEntries(modules: CorpusModule[]) {
  return modules.map((module) => {
    const citation = humanizeCitation(module.target);
    const title = STARTERS[module.target]?.title ?? (module.headlineRule ? humanizeRuleName(module.headlineRule) : citation);
    return { module, title, citation, haystack: `${title} ${citation} ${module.headlineRule ?? ""} ${module.target} ${jurisdictionLabel(module.jurisdiction)}`.toLowerCase() };
  }).sort((a, b) => a.title.localeCompare(b.title) || a.module.target.localeCompare(b.module.target));
}

export function CorpusLibrary({ modules, active, mode, onModeChange, onPick, country, countries, onCountryChange }: {
  modules: CorpusModule[] | null; active: boolean; mode: LauncherMode; onModeChange: (mode: LauncherMode) => void;
  onPick: (target: string, recent?: RecentRule) => void; country: string; countries: Array<{ id: string; label: string }>; onCountryChange: (country: string) => void;
}) {
  const [query, setQuery] = useState("");
  const broadSearch = mode === "field" && Boolean(query.trim());
  const [jurisdiction, setJurisdiction] = useState("all");
  const [limit, setLimit] = useState(40);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recent, setRecent] = useState<RecentRule[]>([]);
  const [runs, setRuns] = useState<Record<string, RunCapability>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  useEffect(() => {
    const update = () => { setRecent(readRecentRules()); setRuns(readRunCapabilities()); };
    update();
    window.addEventListener(LIBRARY_EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(LIBRARY_EVENT, update); window.removeEventListener("storage", update); };
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      if (contentRef.current) contentRef.current.scrollTop = scrollPosition.current;
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  useEffect(() => { setLimit(40); }, [query, jurisdiction, country]);
  const entries = useMemo(() => libraryEntries(modules ?? []), [modules]);
  const byTarget = useMemo(() => new Map(entries.map((entry) => [entry.module.target, entry])), [entries]);
  const jurisdictions = [...new Set(entries.map((entry) => entry.module.jurisdiction))].sort((a, b) => jurisdictionLabel(a).localeCompare(jurisdictionLabel(b)));
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter((entry) => (jurisdiction === "all" || entry.module.jurisdiction === jurisdiction) && tokens.every((token) => /^\d+$/.test(token) ? (entry.haystack.match(/\d+/g)?.some((number) => number === token) ?? false) : entry.haystack.includes(token)));
  const orderedList = [...filtered].sort((a, b) => {
    const aNational = a.module.jurisdiction === country;
    const bNational = b.module.jurisdiction === country;
    return Number(bNational) - Number(aNational) || jurisdictionLabel(a.module.jurisdiction).localeCompare(jurisdictionLabel(b.module.jurisdiction)) || a.title.localeCompare(b.title);
  });
  const listGroups = Map.groupBy(orderedList.slice(0, limit), entry => entry.module.jurisdiction);
  const documentLabel = (bucket: string) => ({statutes:"Statute",regulations:"Regulation",policies:"Policy",guidance:"Guidance"}[bucket] ?? humanizeRuleName(bucket));
  const mapModules = useMemo(() => (modules ?? []).filter(module => jurisdiction === "all" || module.jurisdiction === jurisdiction), [modules, jurisdiction]);
  const recentHere = recent.filter((item) => byTarget.has(item.target)).slice(0, 3);
  const starters = Object.keys(STARTERS).flatMap((target) => byTarget.has(target) ? [byTarget.get(target)!] : []);
  const open = useCallback((target: string, item?: RecentRule) => {
    scrollPosition.current = contentRef.current?.scrollTop ?? 0;
    onPick(target, item);
    window.scrollTo(0, 0);
  }, [onPick]);
  const reset = () => { setQuery(""); setJurisdiction("all"); };
  return <div className="corpus-library" hidden={!active}>
    <header className="library-brand"><a href="/" aria-label="Axiom home"><img src="/logos/axiom-foundation.svg" alt="Axiom Foundation" /></a></header>
    {!query && jurisdiction === "all" && <section className="library-resume" aria-label={recentHere.length ? "Continue exploring" : "Start exploring"}>
      <div className="library-section-head"><h2>{recentHere.length ? <><Clock3 size={16} /> Continue exploring</> : "Start exploring"}</h2></div>
      <div className="library-starts">{recentHere.length ? recentHere.map((item) => <button key={item.target} onClick={() => open(item.target, item)}><small>{byTarget.get(item.target)?.citation}</small><strong>{item.title}</strong><span>Open graph <ArrowRight size={16} /></span></button>) : starters.map((entry) => <button key={entry.module.target} onClick={() => open(entry.module.target)}><small>{entry.citation}</small><strong>{entry.title}</strong><span>{STARTERS[entry.module.target]!.description}</span><ArrowRight size={16} /></button>)}</div>
    </section>}
    <section className="library-browse" aria-label="Browse the library">


      <div className="library-toolbar">
      <div className="library-section-head"><label className="library-search"><Search size={18} /><input type="search" aria-label="Search the law library" placeholder="Search topics, rules, or citations" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" onClick={() => setQuery("")}>Clear</button>}</label><div className="library-view-switch" aria-label="Library view"><button aria-pressed={mode === "list"} onClick={() => onModeChange("list")}>List</button><button aria-pressed={mode === "field"} onClick={() => onModeChange("field")}>Map</button></div></div>
      <button className="library-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} /> Filters{jurisdiction !== "all" ? " · Active" : ""}</button>
        <aside className={`library-filters ${filtersOpen ? "is-open" : ""}`} aria-label="Filter provisions">
          {countries.length > 1 && <label>Country<select value={country} onChange={(event) => { setJurisdiction("all"); onCountryChange(event.target.value); }}>{countries.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
          <label>Jurisdiction<select value={jurisdiction} onChange={(event) => setJurisdiction(event.target.value)}><option value="all">All jurisdictions</option>{jurisdictions.map((id) => <option key={id} value={id}>{jurisdictionLabel(id)}</option>)}</select></label>
          {(query || jurisdiction !== "all") && <button onClick={reset}>Clear filters and search</button>}
        </aside>
      </div>
      <div className="library-columns">

        <div className="library-content" ref={contentRef} tabIndex={0} aria-label={mode === "field" ? "Corpus map" : "Provision results"}>
          {broadSearch && <LibrarySearchResults availableTargets={entries.map(entry => entry.module.target)} query={query} local={entries.filter(entry => tokens.every(token=>entry.haystack.includes(token))).map(entry=>({target:entry.module.target,title:entry.title}))} onPick={target=>open(target)} />}
          <div hidden={broadSearch} className="library-browse-surface">
          {!modules ? <div className="library-loading" role="status" aria-label="Loading the law library" aria-live="polite">
            <svg className="library-loading-network" viewBox="0 0 320 200" width="320" height="200" fill="none" aria-hidden="true">
              <g className="library-loading-wires">
                <path d="M56 44H110Q126 44 126 60V100H156M56 100H156M56 156H110Q126 156 126 140V100M164 100H194Q210 100 210 84V56H264M210 100V144H264" />
              </g>
              <g className="library-loading-nodes">
                <rect x="24" y="32" width="48" height="24" rx="7" />
                <rect x="24" y="88" width="48" height="24" rx="7" />
                <rect x="24" y="144" width="48" height="24" rx="7" />
                <rect x="248" y="44" width="48" height="24" rx="7" />
                <rect x="248" y="132" width="48" height="24" rx="7" />
              </g>
              <circle className="library-loading-halo" cx="160" cy="100" r="26" />
              <rect className="library-loading-hub" x="140" y="82" width="40" height="36" rx="10" />
            </svg>
          </div> : !(mode === "field" ? mapModules.length : filtered.length) ? <div className="library-empty"><Search size={24} /><h3>No matching provisions</h3><p>Try fewer words, another jurisdiction, or a citation such as 26 USC 32.</p><button onClick={reset}>Show all provisions</button></div> : mode === "field" ? <><div className="library-map"><MemoizedLibraryBubbles scopeKey={`${country}:${jurisdiction}`} onPick={open} modules={mapModules} query="" /></div></> : <>
            <div className="library-document-list">{[...listGroups].map(([id, rows]) => <section key={id} aria-label={`${jurisdictionLabel(id)} provisions`}>
              <h3>{jurisdictionLabel(id)}</h3>
              <div className="library-document-columns" aria-hidden="true"><span>Rule</span><span>Citation</span><span>Source type</span></div>
              {rows.map(entry => <button className="library-document-row" key={entry.module.target} onClick={() => open(entry.module.target)}>
                <span className="library-document-title"><strong>{entry.title}</strong>{runs[entry.module.target]?.available && <small>Run available</small>}</span>
                <span className="library-document-citation">{entry.citation}</span><span className="library-document-type">{documentLabel(entry.module.bucket)}</span>
              </button>)}
            </section>)}</div>
            {filtered.length > limit && <button className="library-more" onClick={() => setLimit((current) => current + 40)}>Show 40 more <span>{Math.min(limit, filtered.length)} of {filtered.length.toLocaleString()}</span></button>}
          </>}
          </div>
        </div>
      </div>
    </section>
  </div>;
}
