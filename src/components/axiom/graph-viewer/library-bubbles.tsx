"use client";

import { createPortal } from "react-dom";
import { useId, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CorpusModule } from "@/lib/axiom/corpus-field";
import { humanizeCitation, humanizeRuleName, jurisdictionLabel } from "./citations";

import { BelgiumMap } from "./belgium-map";
import { SourceAtlas } from "./source-atlas";
import states from "./us-state-paths.json";
import nationPath from "./us-nation-path.json";

 type Group = { id: string; label: string; modules: CorpusModule[]; target?: string };
// Official title names from uscode.house.gov; source paths remain the identifiers.
const US_TITLE_NAMES: Record<string, string> = { "26": "Internal Revenue Code", "42": "The Public Health and Welfare", "12": "Banks and Banking" };
function sourceTitle(group: Group): string {
  if (group.modules[0]?.jurisdiction === "us" && group.id.startsWith("statutes/")) {
    return US_TITLE_NAMES[group.id.split("/")[1]!] ?? group.label;
  }
  return group.label.replace(/^(Policies|Regulations|Statutes|Guidance) · /, "").replace(/\b(Usitc|Cbp|Cms|Ssa|Fsa|Ed)\b/g, word => word.toUpperCase());
}

export function sourceGroup(module: CorpusModule): { id: string; label: string } {
  const path = module.target.split(":")[1]?.split("/") ?? [];
  const [kind = module.bucket, first = "", second = ""] = path;
  if (kind === "statutes" && module.jurisdiction === "us") return { id: `${kind}/${first}`, label: `US Code · Title ${first}` };
  const parts = kind === "policies" || kind === "guidance" || kind === "manual" ? [kind, first, second].filter(Boolean) : [kind, first].filter(Boolean);
  return { id: parts.join("/"), label: parts.map(humanizeRuleName).join(" · ") };
}
function groupModules(modules: CorpusModule[], key: (module: CorpusModule) => { id: string; label: string }): Group[] {
  const grouped = new Map<string, Group>();
  for (const module of modules) {
    const { id, label } = key(module);
    if (!grouped.has(id)) grouped.set(id, { id, label, modules: [] });
    grouped.get(id)!.modules.push(module);
  }
  return [...grouped.values()].sort((a, b) => b.modules.length - a.modules.length || a.label.localeCompare(b.label));
}

// Pack groups on a free-form plane, preserving space around every shape.
function packGroups(groups: Group[]) {
  const max = Math.max(1, ...groups.map(group => group.modules.length));
  const placed: Array<{ x: number; y: number; r: number }> = [];
  const cells = new Map<string, Array<{ x: number; y: number; r: number }>>();
  for (const group of groups) {
    const r = 48 + 48 * Math.sqrt(group.modules.length / max);
    let x = 0, y = 0;
    for (let step = 0; step < 100000; step++) {
      const angle = step * .13;
      const distance = 6 * Math.sqrt(step);
      x = Math.cos(angle) * distance * 1.55;
      y = Math.sin(angle) * distance;
      const cx = Math.floor(x / 204), cy = Math.floor(y / 204);
      let overlaps = false;
      for (let dx = -1; dx <= 1 && !overlaps; dx++) {
        for (let dy = -1; dy <= 1 && !overlaps; dy++) {
          overlaps = (cells.get(`${cx + dx}:${cy + dy}`) ?? []).some(other => Math.hypot(x - other.x, y - other.y) < r + other.r + 12);
        }
      }
      if (!overlaps) break;
    }
    const circle = { x, y, r };
    placed.push(circle);
    const cell = `${Math.floor(x / 204)}:${Math.floor(y / 204)}`;
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell)!.push(circle);
  }
  const left = Math.min(...placed.map(p => p.x - p.r), 0);
  const top = Math.min(...placed.map(p => p.y - p.r), 0);
  const width = Math.max(...placed.map(p => p.x + p.r), 0) - left;
  const height = Math.max(...placed.map(p => p.y + p.r), 0) - top;
  return { placed, left, top, width: width || 1, height: height || 1 };
}

export function LibraryBubbles({ modules, onPick, query = "", onLevelChange }: { modules: CorpusModule[]; onPick: (target: string) => void; query?: string; onLevelChange?: (level: string) => void }) {
  const [path, setPath] = useState<Array<{ id: string; label: string }>>([]);
  const previewId = useId();
  const [sourcePreview, setSourcePreview] = useState<{ group: Group; x: number; y: number } | null>(null);
  const previewSource = (group: Group, element: HTMLButtonElement) => {
    const rect = element.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    setSourcePreview({ group, x: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), y: rect.bottom + 300 < window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - 296) });
  };
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState("all");
  const [moving, setMoving] = useState(false);
  useEffect(() => setSourcePreview(null), [query, documentType, modules]);
  const surface = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animation = useRef<Animation | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); animation.current?.cancel(); }, []);
  // Filtering/searching changes the available universe; never leave a stale drill-down.
  useEffect(() => { setPath([]); setDocumentType("all"); setMoving(false); if (timer.current) clearTimeout(timer.current); animation.current?.cancel(); }, [modules]);
  useEffect(() => { onLevelChange?.(path.length === 0 ? "jurisdictions" : path.length === 1 ? "sources in " + path[0]!.label : "provisions in " + path[1]!.label); }, [path, onLevelChange]);
  const allGroups = useMemo(() => {
    if (!path.length) return groupModules(modules, module => ({ id: module.jurisdiction, label: jurisdictionLabel(module.jurisdiction) }));
    const scoped = modules.filter(module => module.jurisdiction === path[0]!.id);
    if (path.length === 1) return groupModules(scoped, sourceGroup);
    return scoped.filter(module => sourceGroup(module).id === path[1]!.id).map(module => ({ id: module.target, target: module.target, label: module.headlineRule ? humanizeRuleName(module.headlineRule) : humanizeCitation(module.target), modules: [module] })).sort((a, b) => a.label.localeCompare(b.label));
  }, [modules, path]);
  const groups = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return allGroups.filter(group => {
      const text = `${group.label} ${sourceTitle(group)} ${group.id} ${group.target ? humanizeCitation(group.target) : ""}`.toLowerCase();
      return tokens.every(token => text.includes(token));
    });
  }, [allGroups, query]);
  const showBelgium = !path.length && allGroups.some(group => group.id === "be" || group.id.startsWith("be-"));
  const showMap = !path.length && allGroups.some(group => group.id === "us" || group.id.startsWith("us-"));
  const stateCoverage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const module of modules) {
      if (module.jurisdiction === "us" || module.jurisdiction.startsWith("us-")) counts.set(module.jurisdiction, (counts.get(module.jurisdiction) ?? 0) + 1);
    }
    return { counts, max: Math.max(1, ...counts.values()) };
  }, [modules]);
  const federalCount = stateCoverage.counts.get("us") ?? 0;
  const federalStrength = federalCount ? 12 + 68 * Math.sqrt(federalCount / stateCoverage.max) : 0;
  const shown = groups;
  const packed = useMemo(() => packGroups(!showMap && !showBelgium && path.length === 0 ? groups : []), [groups, showMap, showBelgium, path.length]);
  const transition = (update: () => void, origin?: Element) => {
    if (moving) return;
    const layer = surface.current?.firstElementChild;
    const finish = () => { animation.current?.cancel(); setHoveredState(null); setSourcePreview(null); update(); setMoving(false); };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !layer?.animate) { finish(); return; }
    const box = layer.getBoundingClientRect(), selected = origin?.getBoundingClientRect();
    const transformOrigin = selected ? `${selected.left + selected.width / 2 - box.left}px ${selected.top + selected.height / 2 - box.top}px` : "50% 50%";
    setMoving(true);
    animation.current = layer.animate([
      { transform: "scale(1)", opacity: 1, transformOrigin },
      { transform: "scale(1.015)", opacity: .7, transformOrigin },
    ], { duration: 180, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
    timer.current = setTimeout(finish, 180);
  };
  const enter = (group: Group, button: HTMLButtonElement | SVGPathElement | SVGGElement) => {
    if (moving) return;
    if (group.target) { onPick(group.target); return; }
    transition(() => { if (!path.length) setDocumentType("all"); setPath(previous => [...previous, { id: group.id, label: group.label }]); }, button);
  };
  const back = (depth: number) => { if (depth === path.length) return; transition(() => setPath(previous => previous.slice(0, depth))); };
  const shelves = [...new Set(allGroups.map(group => group.id.split("/")[0]!))].sort((a, b) => {
    const order = ["statutes", "regulations", "policies", "guidance"];
    return (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99);
  });
  const visibleSources = groups.filter(group => documentType === "all" || group.id.split("/")[0] === documentType);
  const clusterModules = useMemo(() => groups.flatMap(group => group.modules), [groups]);
  return <section className="library-bubbles" aria-label="Explore the library by jurisdiction">
    <div className="library-bubble-bar"><nav aria-label="Library location"><button onClick={() => back(0)} disabled={moving} aria-current={!path.length ? "page" : undefined}>All jurisdictions</button>{path.map((part, index) => <span key={part.id}><span aria-hidden="true"> / </span><button disabled={moving} onClick={() => back(index + 1)} aria-current={index === path.length - 1 ? "page" : undefined}>{part.label}</button></span>)}</nav></div>
    {path.length === 1 && <div className="library-document-filter" role="group" aria-label="Document type">{["all", ...shelves].map(kind => <button key={kind} type="button" aria-pressed={documentType === kind} disabled={moving} onClick={() => setDocumentType(kind)}>{kind === "all" ? "All types" : humanizeRuleName(kind)}</button>)}</div>}
    <div className="library-bubble-surface" ref={surface} aria-busy={moving}>
      {!groups.length ? <div className="library-level-empty">No matches in this {path.length === 0 ? "country" : path.length === 1 ? "jurisdiction" : "source"}. Try another search.</div> : showBelgium ? <BelgiumMap groups={groups} modules={modules} moving={moving} onEnter={enter} /> : showMap ? <div className="library-country-map">
        <svg viewBox="-65 0 1220 630" aria-label="United States jurisdictions">
          {groups.find(group => group.id === "us") && <g className="library-federal-boundary" style={{ "--federal-coverage": `${federalStrength}%` } as CSSProperties} data-dark={federalStrength >= 52} role="button" tabIndex={moving ? -1 : 0} aria-label={`Federal, ${groups.find(group => group.id === "us")!.modules.length} provisions, explore`} aria-disabled={moving} onClick={event => enter(groups.find(group => group.id === "us")!, event.currentTarget)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); enter(groups.find(group => group.id === "us")!, event.currentTarget); } }}>
            <path className="library-federal-boundary-hit" d={nationPath} />
            <path className="library-federal-boundary-line" d={nationPath} />
            <g className="library-federal-boundary-label"><rect x={355} y={7} width={212} height={34} rx={5} /><text x={461} y={25}><tspan className="library-federal-label-title">Federal</tspan><tspan className="library-federal-label-subtitle"> · Nationwide law ↗</tspan></text><path d="M461 41V70L440 82" /></g>
            <g className="library-federal-tooltip" aria-hidden="true"><rect x={579} y={0} width={174} height={52} rx={6} /><text className="library-federal-tooltip-count" x={593} y={21}>{federalCount.toLocaleString()}</text><text className="library-federal-tooltip-caption" x={593} y={39}>encoded provisions</text></g>
          </g>}
          {/* Preprojected Census boundaries from us-atlas v3 (ISC); Alaska and Hawaii are insets. */}
          {states.map(state => {
            const group = groups.find(group => group.id === `us-${state.code.toLowerCase()}`);
            const coverage = stateCoverage.counts.get(`us-${state.code.toLowerCase()}`) ?? 0;
            // Square-root scale keeps smaller collections visible beside the largest.
            const strength = coverage ? 12 + 68 * Math.sqrt(coverage / stateCoverage.max) : 0;
            return <g key={state.code} className="library-state-group" onMouseEnter={() => setHoveredState(state.code)} onMouseLeave={() => setHoveredState(null)} onFocus={() => setHoveredState(state.code)} onBlur={() => setHoveredState(null)}><path style={{ "--state-coverage": `${strength}%` } as CSSProperties} d={state.path} className="library-state" data-available={!!group} role="button" tabIndex={group && !moving ? 0 : -1} aria-label={`${state.name}, ${coverage.toLocaleString()} encoded provisions`} aria-disabled={!group || moving} onClick={event => { if (group) enter(group, event.currentTarget); }} onKeyDown={event => { if (group && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); enter(group, event.currentTarget); } }}></path>{!["RI", "DC", "DE", "MD", "CT", "MA", "NJ"].includes(state.code) && <text x={state.x} y={state.y} className="library-state-label" data-dark={!!group && strength >= 52}>{state.code}</text>}</g>;
          })}
          {["MA", "RI", "CT", "NJ", "DE", "MD", "DC"].map((code, index) => {
            const state = states.find(state => state.code === code)!;
            const group = groups.find(group => group.id === `us-${code.toLowerCase()}`);
            const y = 195 + index * 37;
            return <g key={code} className="library-state-callout"><path d={`M${state.x},${state.y} L980,${y + 13} H1000`} /><circle cx={state.x} cy={state.y} r={2.5} /><foreignObject x={1000} y={y} width={145} height={32}><button onMouseEnter={() => setHoveredState(code)} onMouseLeave={() => setHoveredState(null)} onFocus={() => setHoveredState(code)} onBlur={() => setHoveredState(null)} disabled={!group || moving} onClick={event => { if (group) enter(group, event.currentTarget); }}>{code === "DC" ? "Washington, D.C." : state.name}</button></foreignObject></g>;
          })}
          {hoveredState && (() => {
            const state = states.find(state => state.code === hoveredState)!;
            const count = stateCoverage.counts.get(`us-${hoveredState.toLowerCase()}`) ?? 0;
            const x = Math.max(-45, Math.min(955, state.x - 85));
            const y = state.y < 100 ? state.y + 22 : state.y - 85;
            return <g className="library-state-tooltip" transform={`translate(${x},${y})`} aria-hidden="true"><rect width={180} height={66} rx={6} /><text x={12} y={20} className="library-state-tooltip-name">{state.name}</text><text x={12} y={44} className="library-state-tooltip-count">{count.toLocaleString()}<tspan className="library-state-tooltip-unit"> encoded provisions</tspan></text></g>;
          })()}
        </svg>
        <div className="library-coverage-key" aria-label="Jurisdiction shading: number of encoded provisions, square-root scale"><span>Encoded provisions</span><div><span>0</span><i aria-hidden="true" /><span>{stateCoverage.max.toLocaleString()}</span></div></div>
        <div className="library-national-entries">{groups.filter(group => group.id !== "us" && !states.some(state => group.id === `us-${state.code.toLowerCase()}`)).map(group => <button className={group.id === "us" ? "library-federal-country" : undefined} key={group.id} disabled={moving} onClick={event => enter(group, event.currentTarget)} aria-label={`${group.label}, ${group.modules.length} provisions, explore`}>{group.id === "us" && <svg className="library-federal-outline" viewBox="-65 0 1040 630" aria-hidden="true"><path d={nationPath} /></svg>}<strong>{group.id === "us" ? "Federal" : group.label}</strong><span>{group.id === "us" ? "Nationwide law" : "Explore jurisdiction"}<span aria-hidden="true"> ↗</span></span></button>)}</div>

      </div> : path.length === 1 ? <div className="library-source-groups" key={path[0]!.id}>
        {(documentType === "all" ? shelves : [documentType]).map(kind => {
          const sources = visibleSources.filter(group => group.id.split("/")[0] === kind);
          if (!sources.length) return null;
          return <section className="library-source-group" key={kind} aria-label={humanizeRuleName(kind)} style={{ flexGrow: Math.ceil(sources.length / 4) } as CSSProperties}>
            {documentType === "all" && <h3>{humanizeRuleName(kind)}</h3>}
            <div className="library-source-tiles">{sources.map(group => <button className="library-source-tile" key={group.id} disabled={moving} onMouseEnter={event => previewSource(group, event.currentTarget)} onMouseLeave={() => setSourcePreview(null)} onFocus={event => previewSource(group, event.currentTarget)} onBlur={() => setSourcePreview(null)} onKeyDown={event => { if (event.key === "Escape") setSourcePreview(null); }} aria-describedby={sourcePreview?.group.id === group.id ? previewId : undefined} aria-label={`${group.label}, ${group.modules.length} provisions, explore`} onClick={event => enter(group, event.currentTarget)}>
              <strong>{sourceTitle(group)}</strong>{sourceTitle(group) !== group.label && group.id.startsWith("statutes/") && <small>{group.label}</small>}
              <span className="library-source-arrow" aria-hidden="true">↗</span>
            </button>)}</div>
          </section>;
        })}
      </div> : path.length === 2 ? <div className="library-source-clusters" key={path.map(part => part.id).join(":")}><SourceAtlas modules={clusterModules} source={path[1]!.id} onPick={onPick} /></div> : <div key={path.map(part => part.id).join(":")} className="library-bubble-grid" style={{ "--plane-width": packed.width, "--plane-height": packed.height } as CSSProperties} data-moving={moving || undefined}>
        {shown.map((group, index) => <button style={{ left: `${(packed.placed[index]!.x - packed.placed[index]!.r - packed.left) / packed.width * 100}%`, top: `${(packed.placed[index]!.y - packed.placed[index]!.r - packed.top) / packed.height * 100}%`, width: `${packed.placed[index]!.r * 2 / packed.width * 100}%`, height: `${packed.placed[index]!.r * 2 / packed.height * 100}%` }} title={group.label} className="library-bubble" key={group.id} disabled={moving} onClick={event => enter(group, event.currentTarget)} aria-label={`${group.label}, ${group.modules.length} ${group.target ? "provision, open graph" : "provisions, explore"}`}><strong>{group.label}</strong>{group.target && <span>{humanizeCitation(group.target)}</span>}</button>)}
      </div>}
    </div>

    {sourcePreview && createPortal(<div id={previewId} role="tooltip" className="library-source-preview" style={{ left: sourcePreview.x, top: sourcePreview.y }}>
      <strong>{sourceTitle(sourcePreview.group)}</strong>
      <p>{sourcePreview.group.label}</p>
      <div className="library-source-preview-count">{sourcePreview.group.modules.length.toLocaleString()} <span>encoded provisions</span></div>
      <h4>Includes</h4>
      <ul>{[...sourcePreview.group.modules].sort((a, b) => Number(!!a.presumed) - Number(!!b.presumed) || b.ruleCount - a.ruleCount).slice(0, 3).map(module => <li key={module.target}><span>{module.headlineRule ? humanizeRuleName(module.headlineRule) : humanizeCitation(module.target)}</span>{!module.presumed && <b>{module.ruleCount.toLocaleString()} nodes</b>}</li>)}</ul>
      {sourcePreview.group.modules.length > 3 && <div className="library-source-preview-more"><span aria-hidden="true">···</span> {sourcePreview.group.modules.length - 3} more</div>}
    </div>, document.body)}
  </section>;
}
