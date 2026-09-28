"use client";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, LoaderCircle } from "lucide-react";
import { findPrograms } from "@/lib/axiom/programs";
import type { AxiomSearchResults } from "@/lib/axiom/search";
import { humanizeCitation, jurisdictionLabel, readableSourceFileLegalId } from "./citations";

type Hit = { target: string; title: string; group?: string; summary?: string };
const cache = new Map<string, AxiomSearchResults>();
export function LibrarySearchResults({ query, local, availableTargets = [], onPick }: { query: string; local: Hit[]; availableTargets?: string[]; onPick: (target: string) => void }) {
  const key = query.trim().toLowerCase();
  const [response, setResponse] = useState<{ key: string; data: AxiomSearchResults } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<{key:string; groups:string[]}>({key:"",groups:[]});
  const [retry, setRetry] = useState(0);
  const data = response?.key === key ? response.data : cache.get(key);
  useEffect(() => {
    if (cache.has(key)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/axiom/search?${new URLSearchParams({q:query.trim(),limit:"40"})}`, {signal:controller.signal});
        if (!response.ok) throw new Error("Search failed");
        const result = await response.json() as AxiomSearchResults;
        if (controller.signal.aborted) return;
        cache.set(key,result);
        if(cache.size>40) cache.delete(cache.keys().next().value!);
        setResponse({key,data:result}); setFailed(null);
      } catch { if(!controller.signal.aborted) setFailed(key); }
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, retry]);
  const hits = new Map<string,Hit>();
  const available = new Set([...availableTargets, ...local.map(hit => hit.target)]);
  const groupFor = (target: string) => ({statutes:"Statutes",regulations:"Regulations",policies:"Policies",guidance:"Guidance"}[target.split(':')[1]?.split('/')[0] ?? ''] ?? "Other encoded rules");
  const programs = [...findPrograms(query).map(program => ({program, anchors:program.anchors})), ...(data?.programs ?? [])];
  for (const match of programs) for (const anchor of match.anchors) {
    const target = readableSourceFileLegalId(anchor.citationPath);
    if(target && (available.has(target) || data?.encoded.some(item=>item.citationPath===anchor.citationPath))) hits.set(target,{target,title:match.program.displayName,group:groupFor(target)});
  }
  for(const hit of local) if(!hits.has(hit.target)) hits.set(hit.target,{...hit,group:groupFor(hit.target)});
  for(const match of data?.encoded ?? []) {
    const jurisdiction=match.citationPath.split('/')[0]!;
    const path=match.filePath.replace(/\.yaml$/, '').replace(new RegExp(`^${jurisdiction}/`), '');
    const target=`${jurisdiction}:${path}`;
    if(!hits.has(target)) hits.set(target,{target,title:match.symbolMatches[0]?.label ?? match.label,group:groupFor(target)});
  }
  const groups = ["Statutes", "Regulations", "Policies", "Guidance", "Other encoded rules"];
  const searching = !data && failed !== key;
  return <section className="library-global-search" aria-label="Search across the library">
    <div className="library-global-search-heading"><span>Across all sources and jurisdictions</span>{!data && failed!==key && <span role="status"><LoaderCircle size={14} className="library-search-spinner" /> Finding more matches…</span>}</div>
    {failed===key && !data && <p role="status">Broader search is unavailable. Showing local matches. <button onClick={()=>{setFailed(null);setRetry(n=>n+1);}}>Retry</button></p>}
    {groups.map(group => {
      const matches = [...hits.values()].filter(hit => hit.group === group);
      if (!matches.length) return null;
      return <section key={group} className="library-search-group" aria-label={group}>
        <h3><BookOpen size={15} />{group}<span>{matches.length}</span></h3>
        <div className="library-results">{matches.slice(0, expanded.key === key && expanded.groups.includes(group) ? matches.length : 12).map(hit=><button className="library-row" key={hit.target} onClick={()=>onPick(hit.target)}><div><strong>{hit.title}</strong><p>{jurisdictionLabel(hit.target.split(':')[0]!)} · {humanizeCitation(hit.target)}</p>{hit.summary && <span className="library-search-description">{hit.summary}</span>}</div><ArrowRight size={18}/></button>)}</div>
        {matches.length > 12 && !(expanded.key === key && expanded.groups.includes(group)) && <button className="library-more" onClick={()=>setExpanded(previous=>({key,groups:[...(previous.key === key ? previous.groups : []),group]}))}>Show {matches.length - 12} more</button>}
      </section>;
    })}
    {searching && <div className="library-search-pending" aria-hidden="true"><span/><span/><span/></div>}
    {data && !hits.size && <p>No matching encoded graphs. Try a program name, abbreviation, or citation.</p>}
  </section>;
}
