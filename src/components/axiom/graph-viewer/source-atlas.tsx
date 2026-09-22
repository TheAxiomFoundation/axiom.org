"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { cachedAtlasGraph, loadAtlasGraph } from "./atlas-graph";
import { cachedAtlasHeadings, loadAtlasHeadings } from "./atlas-headings";
import type { CorpusModule, ModuleGraph } from "@/lib/axiom/corpus-field";
import { humanizeCitation, humanizeRuleName } from "./citations";

export function atlasRuleTitle(module: CorpusModule) {
  if (!module.headlineRule) return humanizeCitation(module.target);
  return humanizeRuleName(module.headlineRule)
    .replace(/\bCDCC\b/g, "Child and dependent care credit")
    .replace(/\bEITC\b/g, "Earned income tax credit");
}

export function atlasSections(modules: CorpusModule[], source: string) {
  const depth = source.split("/").length;
  const groups = new Map<string, { id: string; title: string; modules: CorpusModule[] }>();
  for (const module of modules) {
    const [jurisdiction, path = ""] = module.target.split(":");
    const parts = path.split("/");
    const section = parts.slice(0, depth + 1).join("/");
    const id = `${jurisdiction}:${section}`;
    if (!groups.has(id)) groups.set(id, { id, title: humanizeCitation(id), modules: [] });
    groups.get(id)!.modules.push(module);
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function GraphThumbnail({ graph, loading }: { graph?: ModuleGraph; loading: boolean }) {
  if (!graph) return <div className={loading ? "atlas-preview-loading" : "atlas-preview-retry"}>{loading ? <svg viewBox="0 0 40 40" aria-label="Loading graph preview"><circle cx="20" cy="20" r="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="42 34" /></svg> : <svg viewBox="0 0 80 60" role="img" aria-label="Preview loads on hover"><rect x="26" y="12" width="28" height="36" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M33 22h14M33 28h14M33 34h9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>}</div>;
  if (!graph.n) return <div className="atlas-preview-retry">No nodes reported</div>;
  const point = (index: number) => { const p = graph.p[index]; return p ? [12 + p[0] * 136, 8 + p[1] * 70] : null; };
  return <svg viewBox="0 0 160 90" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth=".85" opacity=".62">{graph.e.map(([a,b],i) => { const start = point(a), end = point(b); return start && end ? <path key={i} d={`M${start[0]},${start[1]}L${end[0]},${end[1]}`} /> : null; })}</g><g fill="currentColor">{graph.p.map((_,i) => { const p = point(i)!; return <circle key={i} cx={p[0]} cy={p[1]} r={graph.n > 80 ? 1.15 : 1.9} />; })}</g></svg>;
}

function PreviewCard({ module, onPick }: { module: CorpusModule; onPick: (target: string) => void }) {
  const [graph, setGraph] = useState(() => cachedAtlasGraph(module.target) ?? module.graph);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(() => Boolean(cachedAtlasGraph(module.target)));
  const button = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const load = () => {
    const cached = cachedAtlasGraph(module.target);
    if (cached) { setGraph(cached); setComplete(true); return; }
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    loadAtlasGraph(module.target, controller.signal).then(value => {
      if (!controller.signal.aborted) { setGraph(value); setComplete(true); }
    }).catch(() => {}).finally(() => {
      if (!controller.signal.aborted) { request.current = null; setLoading(false); }
    });
  };
  useEffect(() => {
    if (complete || !button.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { root: button.current.closest(".source-atlas-gallery-scroll"), rootMargin: "100px" });
    observer.observe(button.current);
    return () => observer.disconnect();
  }, [complete]);
  useEffect(() => () => request.current?.abort(), []);
  return <button ref={button} className="source-atlas-gallery-node" aria-label={atlasRuleTitle(module)} onMouseEnter={load} onFocus={load} onClick={() => onPick(module.target)}>
    <div className="source-atlas-gallery-art"><GraphThumbnail graph={graph} loading={loading} />{graph && !complete && <span className={`atlas-preview-refresh${loading ? " is-updating" : ""}`} role="status" aria-label={loading ? "Updating graph preview" : "Partial graph preview"} title={loading ? "Loading the complete graph, including inputs" : "This preview is partial; hover to refresh"}><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /></svg><span>{loading ? "Updating" : "Partial"}</span></span>}</div>
    <div className="source-atlas-gallery-copy"><strong>{atlasRuleTitle(module)}</strong><span>{humanizeCitation(module.target)}</span></div>
    <span className="source-atlas-gallery-arrow" aria-hidden="true">↗</span>
  </button>;
}

export function SourceAtlas({ modules, source, onPick }: { modules: CorpusModule[]; source: string; onPick: (target: string) => void }) {
  const sections = useMemo(() => atlasSections(modules, source), [modules, source]);
  const [headings, setHeadings] = useState<Record<string, string | null>>(() => cachedAtlasHeadings(sections.map(section => section.id)));
  const headingIds = JSON.stringify(sections.map(section => section.id));
  useEffect(() => {
    const controller = new AbortController();
    setHeadings(cachedAtlasHeadings(JSON.parse(headingIds)));
    loadAtlasHeadings(JSON.parse(headingIds), controller.signal).then(result => { if (!controller.signal.aborted) setHeadings(result); }).catch(() => {});
    return () => controller.abort();
  }, [headingIds]);
  return <div className="source-atlas source-atlas-gallery">
    <div className="source-atlas-gallery-scroll" aria-label="Graphs in this source" tabIndex={0}>
      {sections.map(section => <section className="source-atlas-gallery-section" key={section.id} aria-label={headings[section.id] ?? section.title}>
        <h3><span>{section.title}</span>{headings[section.id] && <strong>{headings[section.id]}</strong>}</h3>
        <div className="source-atlas-gallery-grid">{section.modules.map(module => <PreviewCard key={module.target} module={module} onPick={onPick} />)}</div>
      </section>)}
    </div>
  </div>;
}
