"use client";

import { useEffect, useRef, useState } from "react";
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

/** Structural dependencies are candidates to review, not proof of an executed branch. */
export function relevantInputs(graph: ProgramGraph, root: string): string[] {
  const rules = new Map(graph.rules.map(rule => [rule.legalId, rule]));
  const inputs = new Set(graph.inputs.map(input => input.legalId));
  const relations = new Map(graph.relations.map(relation => [relation.legalId, relation]));
  const seen = new Set<string>();
  const queue = [root];
  const result: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (inputs.has(id)) result.push(id);
    const rule = rules.get(id);
    if (rule) queue.push(...rule.ruleDeps, ...rule.inputDeps, ...rule.relationDeps);
    queue.push(...(relations.get(id)?.memberInputIds ?? []));
  }
  return result;
}

export function resultReason(graph: ProgramGraph, run: ExplanationRun, id: string): string {
  const evidence = recordedEvidence(graph, run, id);
  if (evidence?.value === null || evidence?.value === undefined) return "This run did not report a value for this node. That does not establish whether it was computed.";
  const rule = graph.rules.find(rule => rule.legalId === id);
  const multiply = /^\s*([a-zA-Z_]\w*)\s*\*\s*([a-zA-Z_]\w*)\s*$/.exec(rule?.formula ?? "");
  const isZero = (value: unknown) => value === 0 || (typeof value === "string" && /^-?0(?:\.0+)?$/.test(value));
  if (isZero(evidence.value) && multiply) {
    const deps = [...(rule?.ruleDeps ?? []), ...(rule?.inputDeps ?? [])];
    const factors = multiply.slice(1).map(name => {
      const matches = deps.filter(dep => dep.split("#").at(-1) === name);
      return matches.length === 1 ? { name, evidence: recordedEvidence(graph, run, matches[0]!) } : undefined;
    });
    if (factors.every(factor => factor?.evidence && (typeof factor.evidence.value === "number" && Number.isFinite(factor.evidence.value) || typeof factor.evidence.value === "string" && /^-?\d+(?:\.\d+)?$/.test(factor.evidence.value)))) {
      const zero = factors.find(factor => isZero(factor?.evidence?.value));
      if (zero) return `${humanizeRuleName(zero.name)} is zero. Multiplying it by the other recorded factor gives zero.`;
    }
  }
  if (isZero(evidence.value)) return "The engine returned zero. Review the recorded values below; zero alone does not establish ineligibility or identify which input caused it.";
  if (evidence.value === false) return "The engine returned false for this condition. Follow its dependencies to inspect the supporting values.";
  return "This is the recorded result for the last run. Follow its dependencies to inspect the supporting values.";
}

export function ResultExplanation({ graph, run, rootId, stale, onRead, onGraph, onEditInputs }: { graph: ProgramGraph; run: ExplanationRun; rootId: string; stale: boolean; onRead: (id: string) => void; onGraph?: (id: string) => void; onEditInputs?: () => void }) {
  const [trail, setTrail] = useState<string[]>([rootId]);
  const [showAllInputs, setShowAllInputs] = useState(false);
  const id = trail.at(-1)!;
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    sectionRef.current?.closest(".exec-panel")?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [id]);
  const rule = graph.rules.find((item) => item.legalId === id);
  const entries = new Map([...graph.rules, ...graph.inputs, ...graph.relations].map((item) => [item.legalId, item]));
  const dependencies = [...new Set([...(rule?.ruleDeps ?? []), ...(rule?.inputDeps ?? []), ...(rule?.relationDeps ?? [])])];
  const label = humanizeRuleName(entries.get(id)?.name ?? id);
  const evidence = recordedEvidence(graph, run, id);
  const inputs = relevantInputs(graph, id);
  const follow = (next: string) => { setTrail(items => [...items, next]); setShowAllInputs(false); };
  return <section ref={sectionRef} className="result-explanation" aria-label="Result explanation">
    <div className="workspace-section-heading"><h2>Result explanation</h2>{trail.length > 1 && <button className="workspace-button" onClick={() => setTrail((items) => items.slice(0, -1))}>Back to previous calculation</button>}</div>
    {stale && <p role="status">Inputs have changed. This explanation uses the previous run.</p>}
    <h3 className="result-summary"><span>{label}</span><strong>{format(evidence?.value)}</strong></h3>
    <div className="result-reason"><h4>Why this result</h4><p>{resultReason(graph, run, id)}</p>{onGraph && <button className="workspace-button" onClick={() => onGraph(id)}>Follow in graph →</button>}</div>
    <div className="result-review-grid">
      <section className="result-review-section" aria-label="Calculation values"><h4>Calculation values</h4>
        <p className="result-section-note">Select a value to follow its dependencies.</p>
        <div className="result-dependencies">{dependencies.map(dep => {
          const item = recordedEvidence(graph, run, dep);
          return <button className="result-dependency" aria-label={`Inspect ${humanizeRuleName(entries.get(dep)?.name ?? dep.split("#").at(-1)!)}`} key={dep} disabled={!entries.has(dep)} onClick={() => follow(dep)}><span>{humanizeRuleName(entries.get(dep)?.name ?? dep.split("#").at(-1)!)}</span><strong>{format(item?.value)}</strong><small>{item?.origin ?? "No execution evidence"}</small></button>;
        })}</div>
        {!dependencies.length && <p>No further dependencies are recorded for this item.</p>}
      </section>
      <section className="result-review-section" aria-label="Inputs to review"><div className="workspace-section-heading"><h4>Inputs to review</h4>{onEditInputs && <button className="workspace-button" onClick={onEditInputs}>Edit inputs</button>}</div>
        <p className="result-section-note">Inputs connected to this calculation. Some may belong to branches that were not used.</p>
        <div className="result-inputs">{(showAllInputs ? inputs : inputs.slice(0, 6)).map(inputId => {
          const item = recordedEvidence(graph, run, inputId);
          return <div className="result-input" key={inputId}><button onClick={() => follow(inputId)}>{humanizeRuleName(entries.get(inputId)?.name.replace(/^input\./, "") ?? inputId)}</button><strong>{format(item?.value)}</strong><small>{item?.origin ?? "Value and default use not reported"}</small></div>;
        })}</div>
        {!inputs.length && <p>No input dependencies are recorded for this node.</p>}
        {inputs.length > 6 && <button className="workspace-button" onClick={() => setShowAllInputs(value => !value)}>{showAllInputs ? "Show fewer inputs" : `Show all ${inputs.length} inputs`}</button>}
      </section>
    </div>
    <details className="result-formula-details"><summary>Formula and source</summary>
      <RuleLogic key={id} formula={rule?.formula} resultName={label} selectedId={id} dependencies={dependencies} entries={entries} onSelect={follow} hasRun={false} value={(next) => format(recordedEvidence(graph, run, next)?.value)} />
      <p className="logic-note">The formula describes the calculation. The engine does not report branch decisions or intermediate expression values.</p>
      <button className="workspace-button" onClick={() => onRead(id)}>Read source provision</button>
    </details>
  </section>;
}
