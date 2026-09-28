"use client";
import { useState, type CSSProperties } from "react";
import regions from "./be-region-paths.json";
import type { CorpusModule } from "@/lib/axiom/corpus-field";
import { jurisdictionLabel } from "./citations";
type Group = { id: string; label: string; modules: CorpusModule[] };
export function BelgiumMap({ groups, modules, moving, onEnter }: { groups: Group[]; modules: CorpusModule[]; moving: boolean; onEnter: (group: Group, element: SVGPathElement | SVGGElement) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const count = (id: string) => modules.filter(module => module.jurisdiction === id).length;
  const max = Math.max(1,...["be","be-vlg","be-wal","be-bru","be-dg"].map(count));
  const strength = (id: string) => count(id) ? 12 + 68 * Math.sqrt(count(id)/max) : 0;
  const props = (id: string) => {
    const group = groups.find(group => group.id === id);
    const activate = (element: SVGPathElement | SVGGElement) => { if (group && !moving) onEnter(group,element); };
    return { role: "button", tabIndex: group && !moving ? 0 : -1, "aria-disabled": !group || moving, "aria-label": `${id === "be" ? "Federal" : jurisdictionLabel(id)}, ${count(id)} encoded provision${count(id) === 1 ? "" : "s"}`, onMouseEnter: () => setHovered(id), onMouseLeave: () => setHovered(null), onFocus: () => setHovered(id), onBlur: () => setHovered(null), onClick: (event: React.MouseEvent<SVGPathElement | SVGGElement>) => activate(event.currentTarget), onKeyDown: (event: React.KeyboardEvent<SVGPathElement | SVGGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(event.currentTarget); } } };
  };
  return <div className="library-country-map library-belgium-map"><svg viewBox="0 0 900 650" aria-label="Belgium jurisdictions">
    {groups.some(group => group.id === "be") && <g {...props("be")} className="library-federal-boundary" data-dark={strength("be") >= 52} style={{ "--federal-coverage": `${strength("be")}%` } as CSSProperties}>
      <path d={regions.map(region=>region.path).join("")} className="library-federal-boundary-hit" />
      <path d={regions.map(region=>region.path).join("")} className="library-federal-boundary-line" />
      <g className="library-federal-boundary-label"><rect x="335" y="15" width="212" height="34" rx="5" /><text x="441" y="33"><tspan className="library-federal-label-title">Federal</tspan><tspan className="library-federal-label-subtitle"> · Nationwide law ↗</tspan></text><path d="M441 49V75" /></g>
    </g>}
    {regions.filter(region => region.id !== "be-bru").map(region => <g key={region.id} className="library-state-group"><path {...props(region.id)} d={region.path} className="library-state" data-available={groups.some(group=>group.id===region.id)} style={{ "--state-coverage": `${strength(region.id)}%` } as CSSProperties} /><text x={region.id === "be-vlg" ? 350 : 430} y={region.id === "be-vlg" ? 175 : 365} className="library-state-label" data-dark={strength(region.id)>=52}>{jurisdictionLabel(region.id)}</text></g>)}
    <path {...props("be-bru")} d={regions.find(region=>region.id==="be-bru")!.path} className="library-state" data-available={groups.some(group=>group.id==="be-bru")} style={{ "--state-coverage": `${strength("be-bru")}%` } as CSSProperties}/>
    <g {...props("be-bru")} className="belgium-jurisdiction-callout"><path d="M350 230L210 310H90"/><rect x="80" y="298" width="125" height="32" rx="4"/><text x="92" y="318">Brussels ↗</text></g>
    <g {...props("be-dg")} className="belgium-jurisdiction-callout"><path d="M593 278L680 320H720"/><circle cx="593" cy="278" r="3"/><rect x="680" y="310" width="210" height="48" rx="4"/><text x="692" y="330">German-speaking<tspan x="692" dy="16">Community ↗</tspan></text></g>
    {hovered && <g className="library-state-tooltip" transform="translate(655,85)" aria-hidden="true"><rect width="230" height="66" rx="6"/><text x="12" y="20" className="library-state-tooltip-name">{hovered === "be" ? "Federal" : jurisdictionLabel(hovered)}</text><text x="12" y="44" className="library-state-tooltip-count">{count(hovered)}<tspan className="library-state-tooltip-unit">{count(hovered) === 1 ? " encoded provision" : " encoded provisions"}</tspan></text></g>}
  </svg><div className="library-coverage-key"><span>Encoded provisions</span><div><span>0</span><i aria-hidden="true"/><span>{max}</span></div></div><a className="belgium-map-attribution" href="https://www.geoboundaries.org/" target="_blank" rel="noreferrer">Boundaries: Eurostat / geoBoundaries · CC BY 4.0</a></div>;
}
