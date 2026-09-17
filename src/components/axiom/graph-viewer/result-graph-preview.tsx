import type { ProgramGraph } from "./types";
import { humanizeRuleName } from "./citations";

export function ResultGraphPreview({ graph, rootId, onOpen }: { graph: ProgramGraph; rootId: string; onOpen: () => void }) {
  const root = graph.rules.find(rule => rule.legalId === rootId);
  const entries = new Map([...graph.rules, ...graph.inputs, ...graph.relations].map(node => [node.legalId, node]));
  const deps = [...new Set([...(root?.ruleDeps ?? []), ...(root?.inputDeps ?? []), ...(root?.relationDeps ?? [])])].slice(0, 3);
  return <button type="button" className="result-graph-preview" onClick={onOpen} aria-label="Open result in graph">
    <svg viewBox="0 0 300 108" aria-hidden="true">
      {deps.map((id, index) => {
        const y = 8 + index * 34;
        return <g key={id}><path d={`M166 ${y + 13} C145 ${y + 13}, 145 54, 122 54`} /><rect x="166" y={y} width="132" height="26" rx="5" /><text x="173" y={y + 17}>{humanizeRuleName(entries.get(id)?.name ?? id.split("#").at(-1)!).slice(0, 23)}</text></g>;
      })}
      <rect className="result-graph-root" x="2" y="37" width="120" height="34" rx="5" />
      <text x="11" y="58">{humanizeRuleName(root?.name ?? "Result").slice(0, 20)}</text>
    </svg>
    <span>Explore in graph <span aria-hidden="true">↗</span></span>
  </button>;
}
