"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookOpen, GitBranch, LoaderCircle, Network, Play, Search, X } from "lucide-react";
import { axiomAppUrlForCitation, humanizeRuleName, humanizeSource, readableLawTarget } from "./citations";
import type { ProgramGraph, RuleNode } from "./types";
import { MemberCountBreakdown } from "./member-count-breakdown";
import { declaredParameterValue, recordedTableRow, type ExplanationRun } from "./result-explanation";
import { RecordedFormula } from "./recorded-formula";
import { ParameterTableView } from "./parameter-table";
import { rememberRule } from "./library-state";
import { CitationNavigationContext, RuleBody } from "@/components/axiom/rule-body";
import { peekReader, readReader } from "./reader-cache";
import { NodeMetadata } from "./node-metadata";
import { RuleSpecPreview } from "./rulespec-preview";
import type { WorkspaceSource } from "@/lib/axiom/workspace-source";

export type WorkspaceView = "read" | "structure" | "run" | "map";
type Entry = { legalId: string; name: string; kind: string; dtype?: string | null; unit?: string | null };

export function neighborhood(graph: ProgramGraph, id: string) {
  const rule = graph.rules.find((item) => item.legalId === id);
  const dependencies = [...new Set([...(rule?.ruleDeps ?? []), ...(rule?.inputDeps ?? []), ...(rule?.relationDeps ?? [])])];
  const consumers = graph.rules.filter((item) =>
    [...item.ruleDeps, ...item.inputDeps, ...item.relationDeps].includes(id));
  return { rule, dependencies, consumers };
}

function SourceReader({ rule, id, consumers }: { rule?: RuleNode; id: string; consumers: RuleNode[] }) {
  const target = readableLawTarget({ legalId: id, ruleSource: rule?.source ?? null, citation: rule?.source ?? null, curatedCitation: rule?.source ?? null, isQuestion: !rule, consumers });
  const [reference, setReference] = useState<string | null>(() => new URLSearchParams(window.location.search).get("source"));
  useEffect(() => {
    const restore = () => setReference(new URLSearchParams(window.location.search).get("source"));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const referenceHref = (path: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("source", path);
    url.searchParams.set("view", "read");
    url.hash = "";
    return `${url.pathname}${url.search}`;
  };
  const openReference = (path: string) => {
    window.history.pushState(window.history.state, "", referenceHref(path));
    setPending(true);
    setReference(path);
  };
  const href = reference ? `/${reference.replace(/^\/+/, "")}` : target ? axiomAppUrlForCitation(target.fileLegalId, target.citation) : null;
  const root = rule?.fileLegalId ?? id.split("#")[0];
  const sourceUrl = href ? `/api/axiom/source${href}` : null;
  const encodingUrl = `/api/axiom/rulespec?root=${encodeURIComponent(root)}`;
  const cachedSource = sourceUrl ? peekReader(sourceUrl) as WorkspaceSource | undefined : null;
  const cachedEncoding = peekReader(encodingUrl) as { content: string } | undefined;
  const [source, setSource] = useState<WorkspaceSource | null>(cachedSource ?? null);
  const [definition, setDefinition] = useState<string | null>(cachedEncoding?.content ?? null);
  const [error, setError] = useState(false);
  const [definitionError, setDefinitionError] = useState(false);
  const [pending, setPending] = useState(!cachedEncoding || (sourceUrl !== null && !cachedSource));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPending(!peekReader(encodingUrl) || (sourceUrl !== null && !peekReader(sourceUrl)));
    setError(false);
    setDefinitionError(false);
    void Promise.allSettled([
      sourceUrl ? readReader(sourceUrl) : Promise.resolve(null),
      reference ? Promise.resolve(null) : readReader(encodingUrl),
    ]).then(([law, encoding]) => {
      if (cancelled) return;
      setSource(law.status === "fulfilled" ? law.value as WorkspaceSource | null : null);
      setError(law.status === "rejected");
      const content = encoding.status === "fulfilled" ? (encoding.value as { content?: unknown })?.content : undefined;
      setDefinition(typeof content === "string" ? content : null);
      setDefinitionError(typeof content !== "string");
      setPending(false);
    });
    return () => { cancelled = true; };
  }, [sourceUrl, encodingUrl, attempt, reference]);
  if (pending) return <section className="workspace-reader-loading" role="status" aria-label="Loading rule">
    <LoaderCircle size={26} aria-hidden="true" /><span>Loading rule…</span>
  </section>;
  return <section className="workspace-reader" aria-label="Source provision">
    {href ? <>
      <div className="workspace-source-toolbar">{reference && <button onClick={() => window.history.back()}><ArrowLeft size={14} /> Back</button>}<span>{source?.heading ?? "Source provision"}</span>{source?.officialUrl && <a href={source.officialUrl} target="_blank" rel="noreferrer">Official source <ArrowRight size={14} /></a>}</div>
      {error ? <p role="alert">Could not load this provision. <button onClick={() => setAttempt((value) => value + 1)}>Try again</button>.</p> : !source ? <p className="workspace-source-loading" role="status"><LoaderCircle size={18} aria-hidden="true" />Loading source provision…</p> : <>
        {source.origin === "official-live" && <p className="workspace-source-date">Current official source text; may differ from the version used for encoding.</p>}
        {source.effectiveDate && <p className="workspace-source-date">Effective {source.effectiveDate}</p>}
        {source.blocks.length > 1 && <nav className="workspace-source-sections" aria-label="Source subsections">{source.blocks.filter((block) => block.heading).map((block) => <a key={block.anchor} href={`#source-${block.anchor}`}>{block.heading}</a>)}</nav>}
        <CitationNavigationContext.Provider value={{ href: referenceHref, open: openReference }}><article className="workspace-source-text">{source.blocks.map((block) => <section key={block.anchor} id={`source-${block.anchor}`} data-focused={source.focusAnchor === block.anchor || undefined}>
          {block.heading && <h2>{block.heading}</h2>}
          <RuleBody body={block.body} refs={block.refs} citationPath={block.citationPath} />
        </section>)}{!source.blocks.length && <p>No provision text is available for this source.</p>}</article></CitationNavigationContext.Provider>
        {source.truncated && <p role="status">This provision is partially loaded. Open the source to explore further subsections.</p>}
      </>}
    </> : <p>No source provision is available for this item in the loaded graph.</p>}
    {!reference && (definitionError ? <p role="alert">Could not load this node’s definition. <button onClick={() => setAttempt(value => value + 1)}>Try again</button></p> : definition !== null && <RuleSpecPreview content={definition} nodeId={id} />)}
  </section>;
}

export function RuleWorkspace({ graph, rootTarget, selectedId, onSelect, view, onViewChange, scopeLabel, truncated, runReady, scenario, graphControls, onOverview, valueOf, hasRun, stale, renderInput, onRun, running, members = [], run = null, explanationTrail = [], onExplanationTrailChange }: {
  graph: ProgramGraph; rootTarget?: string; selectedId: string; onSelect: (id: string) => void;
  view: WorkspaceView; onViewChange: (view: WorkspaceView) => void;
  scopeLabel: string; truncated: boolean; runReady: boolean; scenario: ReactNode;
  graphControls?: ReactNode;
  explanationTrail?: string[]; onExplanationTrailChange?: (trail: string[]) => void;
  renderInput?: (id: string, member?: string | null) => ReactNode;
  onRun?: () => void; running?: boolean;
  members?: string[]; run?: ExplanationRun | null;
  onOverview?: () => void;
  valueOf: (id: string) => unknown; hasRun: boolean; stale: boolean;
}) {
  const [activeDependency, setActiveDependency] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  type Location = { id: string; view: WorkspaceView; trail: string[] };
  const [history, setHistory] = useState<Location[]>([]);
  const previousLocation = useRef<Location>({ id: selectedId, view, trail: explanationTrail });
  const trailKey = JSON.stringify(explanationTrail);
  useEffect(() => {
    const next = { id: selectedId, view, trail: explanationTrail };
    const previous = previousLocation.current;
    if (previous.id !== next.id || previous.view !== next.view || JSON.stringify(previous.trail) !== trailKey) {
      setHistory(items => [...items, previous]);
      previousLocation.current = next;
    }
  }, [selectedId, view, trailKey]);
  const back = () => {
    const previous = history.at(-1);
    if (!previous) { onOverview?.(); return; }
    // Update the observed location first so restoring does not create a new step.
    previousLocation.current = previous;
    setHistory(items => items.slice(0, -1));
    saveLocation(previous.id, previous.view);
    onSelect(previous.id);
    onViewChange(previous.view);
    onExplanationTrailChange?.(previous.trail);
  };
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    setNavigatorOpen(false);
    requestAnimationFrame(() => searchButtonRef.current?.focus());
  };
  const entries = useMemo(() => new Map<string, Entry>([
    ...graph.rules.map((rule) => [rule.legalId, { ...rule, kind: rule.kind === "parameter" ? "Parameter" : "Rule" }] as const),
    ...graph.inputs.map((input) => [input.legalId, { ...input, kind: "Input" }] as const),
    ...graph.relations.map((relation) => [relation.legalId, { ...relation, kind: "Relation" }] as const),
  ]), [graph]);
  const navigationRef = useRef({ onSelect, onViewChange });
  navigationRef.current = { onSelect, onViewChange };
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const selection = params.get("selection");
      if (selection && entries.has(selection)) navigationRef.current.onSelect(selection);
      const mode = params.get("view");
      if (mode === "read" || mode === "structure" || mode === "run" || mode === "map") navigationRef.current.onViewChange(mode);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [entries]);
  const saveLocation = (id: string, mode: WorkspaceView) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("source");
    url.searchParams.set("selection", id);
    url.searchParams.set("view", mode);
    window.history.replaceState(window.history.state, "", url);
  };
  const changeView = (mode: WorkspaceView) => {
    if (mode === view) return;
    saveLocation(selectedId, mode);
    onViewChange(mode);
  };
  const { rule, dependencies, consumers } = useMemo(() => neighborhood(graph, selectedId), [graph, selectedId]);
  useEffect(() => {
    const entry = entries.get(selectedId);
    if (rootTarget && entry) rememberRule({ target: rootTarget, selection: selectedId, title: humanizeRuleName(entry.name), view: view === "run" ? "structure" : view });
  }, [rootTarget, selectedId, view, entries]);
  const label = (id: string) => humanizeRuleName(entries.get(id)?.name ?? id.split("#").pop() ?? id);
  const navigate = (id: string) => {
    if (id === selectedId || !entries.has(id)) return;
    saveLocation(id, view);
    onSelect(id);
    setNavigatorOpen(false);
  };
  const formatValue = (raw: unknown): string => {
    if (raw === undefined || raw === null) return "Not reported";
    if (typeof raw === "boolean") return raw ? "True" : "False";
    if (typeof raw === "object") return Object.entries(raw).map(([entity, result]) => `${humanizeRuleName(entity)}: ${formatValue(result)}`).join(" · ");
    return String(raw);
  };
  const value = (id: string) => {
    const raw = valueOf(id);
    // A table the run's index doesn't single out (one row per member, or
    // no recorded index) is still declared law, not a missing result.
    const table = graph.rules.find((item) => item.legalId === id)?.table;
    return (raw === undefined || raw === null) && table ? `Table · ${table.rowCount} rows` : formatValue(raw);
  };
  const results = [...entries.values()].filter((entry) => `${label(entry.legalId)} ${entry.legalId}`.toLowerCase().includes(query.toLowerCase()));
  const roots = [...new Set([...graph.terminalOutputs, ...graph.ownOutputs])].filter((id) => entries.has(id));
  return <div className="rule-workspace">
    <nav className="workspace-views" aria-label="Workspace views">
      <button className="workspace-graph-button" aria-current={view === "map" ? "page" : undefined} onClick={() => changeView("map")}><Network size={16} />Graph</button>
      {([ ["read", "Read", BookOpen], ["structure", "Relationships", GitBranch], ["run", "Run", Play] ] as const).filter(([mode]) => mode !== "run" || runReady).map(([mode, title, Icon]) =>
        <button key={mode} aria-current={view === mode ? "page" : undefined} onClick={() => changeView(mode)}><Icon size={16} />{title}</button>)}
      {truncated && <small className="workspace-partial">Partial graph</small>}
      <div className="workspace-nav-finder" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeSearch(); } }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setNavigatorOpen(false); }}>
        {navigatorOpen ? <>
          <label className="workspace-nav-search-field"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a rule…" aria-label="Search this scope" /><button type="button" aria-label="Close rule search" onClick={closeSearch}><X size={16} /></button></label>
          <section className="workspace-search-popover" aria-label="Find a rule in this scope">
            <div className="workspace-search-results">{(query ? results.map((entry) => entry.legalId) : roots).slice(0, 50).map((id) => <button key={id} aria-label={`${label(id)} ${entries.get(id)?.kind}`} onClick={() => { navigate(id); closeSearch(); }}><span>{label(id)}</span><small>{entries.get(id)?.kind}</small></button>)}</div>
            {query && <p>{results.length} matches{results.length > 50 ? " · Showing the first 50; refine your search" : ""}</p>}
          </section>
        </> : <button ref={searchButtonRef} className="workspace-nav-search" onClick={() => setNavigatorOpen(true)} aria-expanded={false}><Search size={16} /> Find a rule</button>}
      </div>
    </nav>
    <div className="workspace-subject">
      <div className="workspace-return-actions">
        {onOverview && <button type="button" className="workspace-button" data-testid="back-to-overview" onClick={onOverview} title="Back to the corpus overview">Overview</button>}
      <button className="workspace-button" disabled={!history.length && !onOverview} aria-label={history.at(-1)?.view !== undefined && history.at(-1)?.view !== view ? "Back to previous view" : history.length ? "Back to previous rule" : onOverview ? "Back to library" : "Back to previous rule"} onClick={back}><ArrowLeft size={16} /> Back</button>
      </div>
      <div><h1>{label(selectedId)}</h1>
        <p className="workspace-citation">{rule?.source ? humanizeSource(rule.source) : "Source not specified"}</p>
      </div>
      {graphControls}
    </div>
    {view !== "run" && view !== "structure" && hasRun && stale && <p className="workspace-stale" role="status">Inputs have changed since the last run. Run again to update the results.</p>}
    {view === "read" && <SourceReader key={selectedId} rule={rule} id={selectedId} consumers={consumers} />}
    {view === "structure" && <section className="workspace-structure" aria-label="Immediate dependencies">
      <div className="workspace-section-heading"><h2>Direct relationships</h2>{onRun && runReady && <div className="workspace-run-actions">{hasRun && stale && <span className="workspace-stale-inline" role="status">Inputs changed · run again to update</span>}<button className={`workspace-button${hasRun && stale && !running ? " workspace-run-needed" : ""}`} disabled={running} onClick={onRun}>{running ? "Running…" : hasRun ? "Run again" : "Run household"}</button></div>}</div>
      <RelationshipDiagram activeId={activeDependency}><div className={`workspace-neighborhood ${dependencies.length ? "has-dependencies" : ""} ${consumers.length ? "has-consumers" : ""}`} key={selectedId}>
        <NeighborColumn title="Built from" ids={dependencies} entries={entries} label={label} onSelect={navigate} hasRun={hasRun} value={value} activeId={activeDependency} onHighlight={setActiveDependency} renderInput={renderInput} empty="No dependencies recorded in this scope." />
        <div className="workspace-anchor" data-relationship-anchor><span className="relationship-caption">Selected rule</span><h3>{label(selectedId)}</h3>
          {rule?.table
            ? <ParameterTableView table={rule.table} unit={rule.unit} selectedKey={hasRun && run ? recordedTableRow(graph, run, selectedId)?.key : null} stale={stale} />
            : <SelectedNodeResult name={label(selectedId)} value={valueOf(selectedId) ?? declaredParameterValue(graph, selectedId)} parameter={rule?.kind === "parameter"} hasRun={hasRun} stale={stale} running={running} entity={rule?.entity} unit={rule?.unit} />}
          {renderInput?.(selectedId)}
          {rule?.formula ? <section className="relationship-formula"><h4>How these values combine</h4><RecordedFormula formula={rule.formula} dependencies={dependencies} entries={entries} valueOf={valueOf} hasRun={hasRun} onSelect={navigate} activeId={activeDependency} onHighlight={setActiveDependency} /></section> : !rule?.table && <p className="relationship-caption">No formula is available for this item.</p>}
          <button onClick={() => changeView("read")}>Read this rule <ArrowRight size={14} /></button></div>
        <NeighborColumn title="Used by" ids={consumers.map((item) => item.legalId)} entries={entries} label={label} onSelect={navigate} hasRun={hasRun} value={value} activeId={activeDependency} onHighlight={setActiveDependency} empty="No consumers recorded in this scope." />
      </div></RelationshipDiagram>
      <NodeMetadata key={selectedId} id={selectedId} entry={rule ?? graph.inputs.find(item => item.legalId === selectedId) ?? graph.relations.find(item => item.legalId === selectedId) ?? {}} />
      <MemberCountBreakdown graph={graph} selectedId={selectedId} members={members} run={run} stale={stale} renderInput={renderInput} valueOf={valueOf} onSelect={navigate} />
      {truncated && <p className="workspace-footnote">This graph is partial; additional relationships may exist.</p>}
    </section>}
    {view === "run" && <section className="workspace-run" aria-label="Scenario workspace"><div className="workspace-section-heading"><h2>Household scenario</h2></div>{runReady ? scenario : <p role="status">Execution is not available for this scope. You can still read and explore its rules.</p>}</section>}
  </div>;
}

function SelectedNodeResult({ name, value, hasRun, stale, running, entity, unit, parameter }: {
  name: string; value: unknown; parameter?: boolean; hasRun: boolean; stale: boolean; running?: boolean; entity?: string | null; unit?: string | null;
}) {
  if (!hasRun && !running && !(parameter && value !== undefined && value !== null)) return null;
  const format = (raw: unknown): string => raw === null || raw === undefined ? "Not reported" : typeof raw === "boolean" ? raw ? "True" : "False" : String(raw);
  const instances = value !== null && typeof value === "object" ? Object.entries(value) : null;
  return <section className="relationship-result" aria-label={`Result for ${name}`} aria-live="polite">
    <div className="relationship-result-heading"><span>{parameter ? "Parameter value" : stale ? "Previous result" : "Result"}</span>{entity && <small>{humanizeRuleName(entity.replace(/([a-z])([A-Z])/g, "$1 $2"))}</small>}</div>
    {running ? <p className="relationship-result-status">Calculating…</p> : instances ? <dl className="relationship-result-instances">{instances.map(([id, result]) => <div key={id}><dt>{humanizeRuleName(id)}</dt><dd>{format(result)}{unit && ` ${unit}`}</dd></div>)}</dl> : <strong className={`relationship-result-value ${value === undefined || value === null ? "is-missing" : ""}`}>{format(value)}{unit && value !== undefined && value !== null && <small>{unit}</small>}</strong>}
  </section>;
}

function NeighborColumn({ title, ids, entries, label, onSelect, hasRun, value, empty, activeId, onHighlight, renderInput }: {
  title: string; ids: string[]; entries: Map<string, Entry>; label: (id: string) => string; onSelect: (id: string) => void; hasRun: boolean; value: (id: string) => string; empty: string; activeId: string | null; onHighlight: (id: string | null) => void; renderInput?: (id: string) => ReactNode;
}) {
  const [limit, setLimit] = useState(6);
  return <div className="workspace-neighbors" data-relationship-side={title === "Built from" ? "left" : "right"}><h3>{title}</h3>{ids.slice(0, limit).map((id) => <Fragment key={id}><button data-neighbor-id={id} className={activeId === id ? "is-highlighted" : undefined} onMouseEnter={() => onHighlight(id)} onMouseLeave={() => onHighlight(null)} onFocus={() => onHighlight(id)} onBlur={() => onHighlight(null)} aria-label={`${entries.get(id)?.kind ?? "Outside loaded scope"} ${label(id)}${hasRun ? ` ${value(id)}` : ""}`} disabled={!entries.has(id)} onClick={() => onSelect(id)}><small>{entries.get(id)?.kind ?? "Outside loaded scope"}{entries.get(id)?.dtype ? ` · ${entries.get(id)?.dtype}` : ""}</small><span>{label(id)}</span>{hasRun && <strong>{value(id)}</strong>}<ArrowRight size={14} aria-hidden="true" /></button>{renderInput?.(id)}</Fragment>)}{!ids.length && <p>{empty}</p>}{ids.length > limit && <button className="workspace-more" onClick={() => setLimit((current) => current + 12)}>Show {Math.min(12, ids.length - limit)} more · {ids.length - limit} hidden</button>}</div>;
}

function RelationshipDiagram({ children, activeId }: { children: ReactNode; activeId: string | null }) {
  const container = useRef<HTMLDivElement>(null);
  const markerId = useId();
  const [paths, setPaths] = useState<{ id: string; d: string }[]>([]);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const bounds = el.getBoundingClientRect();
      const anchor = el.querySelector("[data-relationship-anchor]")?.getBoundingClientRect();
      if (!anchor) return;
      const cy = anchor.top + anchor.height / 2 - bounds.top;
      setPaths([...el.querySelectorAll<HTMLElement>("[data-neighbor-id]")].map((row) => {
        const r = row.getBoundingClientRect();
        const left = row.closest("[data-relationship-side]")?.getAttribute("data-relationship-side") === "left";
        const startX = (left ? r.right : anchor.right) - bounds.left;
        const endX = (left ? anchor.left : r.left) - bounds.left;
        const startY = left ? r.top + r.height / 2 - bounds.top : cy;
        const endY = left ? cy : r.top + r.height / 2 - bounds.top;
        const mid = (startX + endX) / 2;
        return { id: row.dataset.neighborId!, d: `M ${startX} ${startY} H ${mid} V ${endY} H ${endX}` };
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);
  return <div className="relationship-diagram" ref={container}><svg className="relationship-wires" aria-hidden="true"><defs><marker id={markerId} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8" fill="currentColor" /></marker></defs>{paths.map((path, index) => <path key={`${path.id}-${index}`} d={path.d} className={activeId === path.id ? "is-highlighted" : undefined} markerEnd={`url(#${markerId})`} />)}</svg>{children}</div>;
}
