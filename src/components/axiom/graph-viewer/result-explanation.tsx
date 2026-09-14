"use client";

import { useState } from "react";
import type { ProgramGraph } from "./types";
import { humanizeRuleName } from "./citations";
import { RuleLogic } from "./rule-logic";

export type ExplanationRun = {
  outputs: Record<string, unknown>;
  trace: Array<{ variable: string; value: unknown; instances?: Array<{ entity_id: string; value: unknown }> }>;
  submittedFacts?: Record<string, unknown>;
};

export function recordedEvidence(graph: ProgramGraph, run: ExplanationRun, id: string): { value: unknown; origin: string } | undefined {
  const all = [...graph.rules, ...graph.inputs, ...graph.relations];
  const fragment = id.split("#").at(-1)!;
  const unique = all.filter((item) => item.legalId.split("#").at(-1) === fragment).length === 1;
  const trace = run.trace.find((item) => item.variable === id) ?? (unique ? run.trace.find((item) => item.variable === fragment) : undefined);
  const key = Object.hasOwn(run.outputs, id) ? id : unique && Object.hasOwn(run.outputs, fragment) ? fragment : undefined;
  if (key) return { value: run.outputs[key], origin: "Returned result" };
  if (trace) return { value: trace.instances?.length ? Object.fromEntries(trace.instances.map((item) => [item.entity_id, item.value])) : trace.value, origin: "Recorded by engine" };
  const input = graph.inputs.find((item) => item.legalId === id);
  const inputName = input?.name.replace(/^input\./, "");
  if (inputName && Object.hasOwn(run.submittedFacts ?? {}, inputName)) return { value: run.submittedFacts![inputName], origin: "Submitted input" };
  return undefined;
}

function format(value: unknown): string {
  if (value === undefined || value === null) return "Not reported";
  if (typeof value === "boolean") return value ? "True" : "False";
  return typeof value === "object" ? Object.entries(value).map(([id, item]) => `${humanizeRuleName(id.replace(/[:_]/g, " "))}: ${format(item)}`).join(" · ") : String(value);
}

export function ResultExplanation({ graph, run, rootId, stale, onRead }: { graph: ProgramGraph; run: ExplanationRun; rootId: string; stale: boolean; onRead: (id: string) => void }) {
  const [trail, setTrail] = useState<string[]>([rootId]);
  const id = trail.at(-1)!;
  const rule = graph.rules.find((item) => item.legalId === id);
  const entries = new Map([...graph.rules, ...graph.inputs, ...graph.relations].map((item) => [item.legalId, item]));
  const dependencies = [...new Set([...(rule?.ruleDeps ?? []), ...(rule?.inputDeps ?? []), ...(rule?.relationDeps ?? [])])];
  const label = humanizeRuleName(entries.get(id)?.name ?? id);
  const evidence = recordedEvidence(graph, run, id);
  return <section className="result-explanation" aria-label="Result explanation">
    <div className="workspace-section-heading"><h2>Explain this result</h2>{trail.length > 1 && <button className="workspace-button" onClick={() => setTrail((items) => items.slice(0, -1))}>Back to previous calculation</button>}</div>
    {stale && <p role="status">Inputs have changed. This explanation uses the previous run.</p>}
    <h3>{label} <strong>{format(evidence?.value)}</strong></h3>
    {!evidence && <p>This value was not reported in this run.</p>}
    <table className="explanation-values"><thead><tr><th>Dependency</th><th>Value</th><th>Evidence</th></tr></thead><tbody>{dependencies.map((dep) => {
      const item = recordedEvidence(graph, run, dep);
      return <tr key={dep}><td><button disabled={!entries.has(dep)} onClick={() => setTrail((items) => [...items, dep])}>{humanizeRuleName(entries.get(dep)?.name ?? dep.split("#").at(-1)!)}</button></td><td>{format(item?.value)}</td><td>{item?.origin ?? "Not reported"}</td></tr>;
    })}</tbody></table>
    {!dependencies.length && <p>No further dependencies are recorded for this item.</p>}
    <RuleLogic key={id} formula={rule?.formula} resultName={label} selectedId={id} dependencies={dependencies} entries={entries} onSelect={(next) => setTrail((items) => [...items, next])} hasRun={false} value={(next) => format(recordedEvidence(graph, run, next)?.value)} />
    <p className="logic-note">The formula describes the calculation. The engine does not report branch decisions or intermediate expression values.</p>
    <button className="workspace-button" onClick={() => onRead(id)}>Read source provision</button>
  </section>;
}
