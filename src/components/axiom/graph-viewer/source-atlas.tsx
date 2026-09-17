"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
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
  const [liveGraphs, setLiveGraphs] = useState<Record<string, ModuleGraph>>({});
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const refreshPreview = useCallback((target: string) => {
    const cached = cachedAtlasGraph(target);
    if (cached) setLiveGraphs(previous => previous[target] === cached ? previous : { ...previous, [target]: cached });
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    refreshTimer.current = setTimeout(() => {
      setRefreshing(target);
      loadAtlasGraph(target, controller.signal).then(graph => {
        if (!controller.signal.aborted) setLiveGraphs(previous => ({ ...previous, [target]: graph }));
      }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setRefreshing(null); });
    }, 650);
  }, []);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); refreshController.current?.abort(); }, [modules]);
  return <div className="source-atlas source-atlas-gallery">
    <div className="source-atlas-gallery-scroll" aria-label="Graphs in this source" tabIndex={0}>
      {sections.map(section => <section className="source-atlas-gallery-section" key={section.id} aria-label={headings[section.id] ?? section.title}>
        <h3><span>{section.title}</span>{headings[section.id] && <strong>{headings[section.id]}</strong>}</h3>
        <div className="source-atlas-gallery-grid">{section.modules.map(module => {
          const graph = liveGraphs[module.target] ?? cachedAtlasGraph(module.target) ?? module.graph;
          return <button className="source-atlas-gallery-node" key={module.target} aria-label={atlasRuleTitle(module)} onMouseEnter={() => refreshPreview(module.target)} onFocus={() => refreshPreview(module.target)} onClick={() => onPick(module.target)}>
            <div className="source-atlas-gallery-art"><GraphThumbnail graph={graph} loading={refreshing === module.target} /></div>
            <div className="source-atlas-gallery-copy"><strong>{atlasRuleTitle(module)}</strong><span>{humanizeCitation(module.target)}</span></div>
            <span className="source-atlas-gallery-arrow" aria-hidden="true">↗</span>
          </button>;
        })}</div>
      </section>)}
    </div>
  </div>;
}
