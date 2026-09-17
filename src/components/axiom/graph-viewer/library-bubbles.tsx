"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CorpusModule } from "@/lib/axiom/corpus-field";
import { humanizeCitation, humanizeRuleName, jurisdictionLabel } from "./citations";

type Group = { id: string; label: string; modules: CorpusModule[]; target?: string };
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

export function LibraryBubbles({ modules, onPick }: { modules: CorpusModule[]; onPick: (target: string) => void }) {
  const [path, setPath] = useState<Array<{ id: string; label: string }>>([]);
  const [page, setPage] = useState(0);
  const [moving, setMoving] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animation = useRef<Animation | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); animation.current?.cancel(); }, []);
  // Filtering/searching changes the available universe; never leave a stale drill-down.
  useEffect(() => { setPath([]); setPage(0); setMoving(false); if (timer.current) clearTimeout(timer.current); animation.current?.cancel(); }, [modules]);
  const groups = useMemo(() => {
    if (!path.length) return groupModules(modules, module => ({ id: module.jurisdiction, label: jurisdictionLabel(module.jurisdiction) }));
    const scoped = modules.filter(module => module.jurisdiction === path[0]!.id);
    if (path.length === 1) return groupModules(scoped, sourceGroup);
    return scoped.filter(module => sourceGroup(module).id === path[1]!.id).map(module => ({ id: module.target, target: module.target, label: module.headlineRule ? humanizeRuleName(module.headlineRule) : humanizeCitation(module.target), modules: [module] })).sort((a, b) => a.label.localeCompare(b.label));
  }, [modules, path]);
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(groups.length / pageSize));
  const shown = groups.slice(page * pageSize, (page + 1) * pageSize);
  const enter = (group: Group, button: HTMLButtonElement) => {
    if (moving) return;
    if (group.target) { onPick(group.target); return; }
    const finish = () => { animation.current?.cancel(); setPath(previous => [...previous, { id: group.id, label: group.label }]); setPage(0); setMoving(false); };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !button.animate || !surface.current) { finish(); return; }
    const b = button.getBoundingClientRect(), box = surface.current.getBoundingClientRect();
    const x = box.left + box.width / 2 - b.left - b.width / 2;
    const y = box.top + box.height / 2 - b.top - b.height / 2;
    const scale = Math.max(box.width / b.width, box.height / b.height) * 1.15;
    setMoving(true);
    animation.current = button.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1, zIndex: 2 },
      { transform: `translate(${x}px,${y}px) scale(${scale})`, opacity: 0, zIndex: 2 },
    ], { duration: 700, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
    timer.current = setTimeout(finish, 700);
  };
  const back = (depth: number) => { if (moving) return; setPath(previous => previous.slice(0, depth)); setPage(0); };
  return <section className="library-bubbles" aria-label="Explore the library by jurisdiction">
    <div className="library-bubble-bar"><nav aria-label="Library location"><button onClick={() => back(0)} disabled={moving} aria-current={!path.length ? "page" : undefined}>All jurisdictions</button>{path.map((part, index) => <span key={part.id}><span aria-hidden="true"> / </span><button disabled={moving} onClick={() => back(index + 1)} aria-current={index === path.length - 1 ? "page" : undefined}>{part.label}</button></span>)}</nav><span>{path.length === 0 ? "Jurisdictions" : path.length === 1 ? "Source groups" : "Provisions"}</span></div>
    <div className="library-bubble-surface" ref={surface} aria-busy={moving}>
      <div key={`${path.map(part => part.id).join(":")}:${page}`} className="library-bubble-grid" style={{ "--bubble-rows": Math.max(1, Math.ceil(shown.length / 4)), "--bubble-rows-mobile": Math.max(1, Math.ceil(shown.length / 3)) } as CSSProperties} data-moving={moving || undefined}>
        {shown.map(group => <button className="library-bubble" key={group.id} disabled={moving} onClick={event => enter(group, event.currentTarget)} aria-label={`${group.label}, ${group.modules.length} ${group.target ? "provision, open graph" : "provisions, explore"}`}><strong>{group.label}</strong><span>{group.target ? humanizeCitation(group.target) : `${group.modules.length.toLocaleString()} provisions`}</span></button>)}
      </div>
    </div>
    {pages > 1 && <div className="library-bubble-pages"><button disabled={page === 0 || moving} onClick={() => setPage(value => value - 1)}>← Previous</button><span>{page + 1} / {pages}</span><button disabled={page + 1 === pages || moving} onClick={() => setPage(value => value + 1)}>Next →</button></div>}
  </section>;
}
