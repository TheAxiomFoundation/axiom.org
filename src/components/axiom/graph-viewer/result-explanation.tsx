"use client";

import { useEffect, useRef, useState } from "react";
import type { ProgramGraph } from "./types";
import { humanizeRuleName } from "./citations";
import { parseFormulaStrict, type AstNode } from "./formula";
import { resolveLogicIdentifier } from "./rule-logic";

export type ExplanationRun = {
  outputs: Record<string, unknown>;
  trace: Array<{ variable: string; value: unknown; instances?: Array<{ entity_id: string; value: unknown }>; dependencies?: Array<{ variable: string; entity_id: string; value: unknown }> }>;
  submittedFacts?: Record<string, unknown>;
  submittedPersonIds?: Record<string, string>;
};

export function recordedEvidence(graph: ProgramGraph, run: ExplanationRun, id: string): { value: unknown; origin: string } | undefined {
  const all = [...graph.rules, ...graph.inputs, ...graph.relations];
  const fragment = id.split("#").at(-1)!;
  const unique = all.filter((item) => item.legalId.split("#").at(-1) === fragment).length === 1;
  const trace = run.trace.find((item) => item.variable === id) ?? (unique ? run.trace.find((item) => item.variable === fragment) : undefined);
  const key = Object.hasOwn(run.outputs, id) ? id : unique && Object.hasOwn(run.outputs, fragment) ? fragment : undefined;
  if (trace?.instances?.length) return { value: Object.fromEntries(trace.instances.map(item => [Object.entries(run.submittedPersonIds ?? {}).find(([, engineId]) => engineId === item.entity_id)?.[0] ?? item.entity_id, item.value])), origin: "Recorded by engine" };
  if (key) return { value: run.outputs[key], origin: "Returned result" };
  if (trace) return { value: trace.instances?.length ? Object.fromEntries(trace.instances.map((item) => [item.entity_id, item.value])) : trace.value, origin: "Recorded by engine" };
  const input = graph.inputs.find((item) => item.legalId === id);
  const inputName = input?.name.replace(/^input\./, "");
  if (inputName && Object.hasOwn(run.submittedFacts ?? {}, inputName)) return { value: run.submittedFacts![inputName], origin: "Submitted input" };
  return undefined;
}

/** Only literal parameter declarations are values; do not evaluate expressions or
 * choose a period/version on behalf of the runtime. Preserve decimal precision. */
export function declaredParameterValue(graph: ProgramGraph, id: string): unknown {
  const rule = graph.rules.find(item => item.legalId === id);
  if (rule?.kind !== "parameter") return undefined;
  const literal = rule.formula?.trim();
  if (!literal) return undefined;
  if (/^(?:true|false)$/i.test(literal)) return literal.toLowerCase() === "true";
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(literal)) return literal;
  return undefined;
}

/** Declared constants/defaults never stand in for unreported calculations. */
export function inputAwareEvidence(graph: ProgramGraph, run: ExplanationRun | null, id: string, defaults: Record<string, unknown>): unknown {
  const evidence = run ? recordedEvidence(graph, run, id)?.value : undefined;
  if (evidence !== undefined && evidence !== null) return evidence;
  const input = graph.inputs.find(item => item.legalId === id);
  if (!input) return declaredParameterValue(graph, id) ?? evidence;
  return defaults[input.name] ?? defaults[input.name.replace(/^input\./, "")];
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

type ResultBlocker = { id: string; explanation: string };

/** Explain only false required checks supported by recorded scalar evidence.
 * An AND needs only one false operand; unknown checks remain unknown. ORs,
 * aggregates, decimal arithmetic and per-entity conditions are not guessed. */
export function resultBlockers(graph: ProgramGraph, run: ExplanationRun, id: string): ResultBlocker[] {
  const rule = graph.rules.find(item => item.legalId === id);
  const ast = rule?.formula ? parseFormulaStrict(rule.formula) : null;
  const result = recordedEvidence(graph, run, id)?.value;
  const zero = result === 0 || typeof result === "string" && /^-?0(?:\.0+)?$/.test(result);
  const condition = zero && ast?.kind === "ifElse" && ast.else_.kind === "number" && ast.else_.value === 0
    ? ast.cond : result === false ? ast : null;
  if (!condition || !rule) return [];
  const deps = [...rule.ruleDeps, ...rule.inputDeps, ...rule.relationDeps];
  const entries = new Map([...graph.rules, ...graph.inputs, ...graph.relations].map(item => [item.legalId, item]));
  const resolve = (node: AstNode) => node.kind === "ident" ? resolveLogicIdentifier(node.name, deps, entries) : undefined;
  const label = (key: string) => humanizeRuleName(entries.get(key)?.name ?? key);
  const integer = (value: unknown): number | undefined => {
    const number = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(?:\.0+)?$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(number) ? number : undefined;
  };
  const checks = (node: AstNode): ResultBlocker[] => {
    if (node.kind === "logical" && node.op === "and") return [...checks(node.left), ...checks(node.right)];
    const key = resolve(node);
    if (key && recordedEvidence(graph, run, key)?.value === false) return [{ id: key, explanation: `${label(key)} is false; this check must be true.` }];
    if (node.kind === "unary" && node.op === "not") {
      const key = resolve(node.operand);
      if (key && recordedEvidence(graph, run, key)?.value === true) return [{ id: key, explanation: `${label(key)} is true; this check requires it to be false.` }];
    }
    if (node.kind === "comparison" && node.right.kind === "number") {
      const key = resolve(node.left);
      const value = key ? integer(recordedEvidence(graph, run, key)?.value) : undefined;
      const threshold = integer(node.right.value);
      if (key && value !== undefined && threshold !== undefined) {
        const pass = { "==": value === threshold, "!=": value !== threshold, "<": value < threshold, "<=": value <= threshold, ">": value > threshold, ">=": value >= threshold }[node.op];
        const required = { "==": "equal to", "!=": "different from", "<": "less than", "<=": "at most", ">": "greater than", ">=": "at least" }[node.op];
        if (!pass) return [{ id: key, explanation: `${label(key)} is ${value}; it must be ${required} ${threshold}.` }];
      }
    }
    return [];
  };
  return [...new Map(checks(condition).map(item => [item.id, item])).values()];
}

export function resultReason(graph: ProgramGraph, run: ExplanationRun, id: string): string {
  const evidence = recordedEvidence(graph, run, id);
  if (evidence?.value === null || evidence?.value === undefined) return "This run did not report a value for this node. That does not establish whether it was computed.";
  const blockers = resultBlockers(graph, run, id);
  if (blockers.length) return evidence.value === false
    ? "This condition requires every check below to pass. The recorded values show these checks are not satisfied."
    : "This formula returns zero when a required condition is not met. The recorded values show these checks are not satisfied.";
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
  if (isZero(evidence.value)) return "The result is zero, but the run did not report enough supported evidence to explain its cause.";
  if (evidence.value === false) return "The engine returned false for this condition. Follow its dependencies to inspect the supporting values.";
  return "This is the recorded result for the last run. Follow its dependencies to inspect the supporting values.";
}

function ResultOverview({ graph, run, id, onRelationships, displayValue }: { graph: ProgramGraph; run: ExplanationRun; id: string; onRelationships?: (id: string) => void; displayValue: (id: string) => unknown }) {
  const rule = graph.rules.find(item => item.legalId === id);
  const ids = [...new Set([...(rule?.ruleDeps ?? []), ...(rule?.inputDeps ?? []), ...(rule?.relationDeps ?? [])])];
  const entries = new Map([...graph.rules, ...graph.inputs, ...graph.relations].map(item => [item.legalId, item]));
  const label = (key: string) => humanizeRuleName(entries.get(key)?.name.replace(/^input\./, "") ?? key);
  if (!ids.length) return null;
  return <section className="result-overview" aria-label="Calculation overview"><h4>Calculation overview</h4>
    <div className="result-calculation-table"><table><thead><tr><th>Calculation or input</th><th>Value</th><th><span className="sr-only">Explore</span></th></tr></thead><tbody>{ids.map(key => {
      const dependency = graph.rules.find(item => item.legalId === key);
      const children = [...new Set([...(dependency?.ruleDeps ?? []), ...(dependency?.inputDeps ?? []), ...(dependency?.relationDeps ?? [])])].filter(child => child !== id && child !== key);
      return <tr key={key}><th scope="row"><span>{label(key)}</span>
        {children.length > 0 && <details className="result-calculation-inputs"><summary>Supporting values</summary><dl>{children.map(child => <div key={child}><dt>{label(child)}</dt><dd>{format(displayValue(child))}</dd></div>)}</dl></details>}
        {dependency?.kind === "parameter" && !recordedEvidence(graph, run, key) && <small>Declared parameter</small>}
      </th><td className="result-calculation-value">{format(displayValue(key))}</td><td>{onRelationships && <button className="result-overview-link" onClick={() => onRelationships(key)} aria-label={`Explore relationships for ${label(key)}`}>Relationships →</button>}</td></tr>;
    })}</tbody></table></div>
  </section>;
}

export function ResultExplanation({ graph, run, rootId, stale, onRead, onGraph, onRelationships, onEditInputs, trail: controlledTrail, onTrailChange }: { trail?: string[]; onTrailChange?: (trail: string[]) => void; graph: ProgramGraph; run: ExplanationRun; rootId: string; stale: boolean; onRead: (id: string) => void; onGraph?: (id: string) => void; onRelationships?: (id: string) => void; onEditInputs?: () => void }) {
  const [localTrail, setLocalTrail] = useState<string[]>([rootId]);
  const trail = controlledTrail?.length ? controlledTrail : localTrail;
  const setTrail = (update: (items: string[]) => string[]) => {
    const next = update(trail);
    if (onTrailChange) onTrailChange(next);
    else setLocalTrail(next);
  };
  const [selectedEntities, setSelectedEntities] = useState<Record<string, string>>({});
  const [showAllInputs, setShowAllInputs] = useState(false);
  const id = trail.at(-1)!;
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    sectionRef.current?.closest(".exec-panel")?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [id]);
  const entries = new Map([...graph.rules, ...graph.inputs, ...graph.relations].map((item) => [item.legalId, item]));
  // Each entity type has its own selection: a person is never substituted
  // for a tax unit. Scalars stay shared; absent instance values stay unknown.
  const entityOf = (key: string) => {
    const entry = entries.get(key);
    return entry && "entity" in entry && entry.entity ? entry.entity : "Entity";
  };
  const rawValue = (key: string) => recordedEvidence(graph, run, key)?.value ?? declaredParameterValue(graph, key);
  const instanceMap = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const entityGroups = new Map<string, Set<string>>();
  const relevant = new Set<string>();
  const visit = (key: string) => {
    if (relevant.has(key)) return;
    relevant.add(key);
    const rule = graph.rules.find(item => item.legalId === key);
    for (const dep of [...(rule?.ruleDeps ?? []), ...(rule?.inputDeps ?? []), ...(rule?.relationDeps ?? [])]) visit(dep);
  };
  visit(id);
  for (const key of relevant) {
    const instances = instanceMap(rawValue(key));
    if (!instances) continue;
    const type = entityOf(key);
    const ids = entityGroups.get(type) ?? new Set<string>();
    Object.keys(instances).forEach(instance => ids.add(instance));
    entityGroups.set(type, ids);
  }
  const chosenEntity = (type: string) => {
    const ids = entityGroups.get(type);
    return ids?.has(selectedEntities[type] ?? "") ? selectedEntities[type] : ids?.values().next().value;
  };
  const displayValue = (key: string) => {
    const raw = rawValue(key), instances = instanceMap(raw);
    const selected = chosenEntity(entityOf(key));
    return instances ? selected ? instances[selected] : undefined : raw;
  };
  const label = humanizeRuleName(entries.get(id)?.name ?? id);
  const evidence = recordedEvidence(graph, run, id);
  const inputs = relevantInputs(graph, id);
  const blockers = resultBlockers(graph, run, id);
  return <section ref={sectionRef} className="result-explanation" aria-label="Result explanation">
    <div className="workspace-section-heading result-explanation-heading"><h2>Result explanation</h2>{!onTrailChange && trail.length > 1 && <button className="workspace-button" onClick={() => setTrail((items) => items.slice(0, -1))}>Back to previous calculation</button>}</div>
    {stale && <p role="status">Inputs have changed. This explanation uses the previous run.</p>}
    {entityGroups.size > 0 && <div className="result-entity-context" aria-label="Result entity">{[...entityGroups].map(([type, ids]) => <label key={type}><span>{humanizeRuleName(type)}</span><select aria-label={`Selected ${humanizeRuleName(type)}`} value={chosenEntity(type)} onChange={event => setSelectedEntities(current => ({...current, [type]:event.target.value}))}>{[...ids].map(key => <option key={key} value={key}>{humanizeRuleName(key.replace(/[:_]/g, " "))}</option>)}</select></label>)}</div>}
    <h3 className="result-summary"><span>{label}</span><strong>{format(displayValue(id))}</strong></h3>
    {(blockers.length > 0 || !evidence || evidence.value === 0 || evidence.value === false) && <div className="result-reason"><h4>{blockers.length ? "Failed required checks" : "Recorded result"}</h4>
      <p className="result-reason-description">{blockers.length ? "Recorded values checked against the displayed formula; not a complete causal trace." : resultReason(graph, run, id)}</p>
    </div>}
    <ResultOverview graph={graph} run={run} id={id} onRelationships={onRelationships} displayValue={displayValue} />
    {blockers.length > 0 && <ul className="result-blockers">{blockers.map(blocker => <li key={blocker.id}>
      <span>{blocker.explanation}</span>
      {onRelationships && <button className="workspace-button" onClick={() => onRelationships(blocker.id)} aria-label={`View relationships for ${humanizeRuleName(entries.get(blocker.id)?.name ?? blocker.id)}`}>View relationships →</button>}
    </li>)}</ul>}
    <div className="result-primary-actions">{onEditInputs && <button className="workspace-button" onClick={onEditInputs}>Edit inputs</button>}{onRelationships && <button className="workspace-button result-relationships-link" onClick={() => onRelationships(id)}>View result relationships →</button>}</div>
      <details className="result-review-section result-input-review"><summary>Inputs to review</summary><section aria-label="Inputs to review"><div className="workspace-section-heading"><h4>Inputs to review</h4></div>
        <p className="result-section-note">Inputs connected to this calculation. Some may belong to branches that were not used.</p>
        <div className="result-inputs">{(showAllInputs ? inputs : inputs.slice(0, 6)).map(inputId => {
          const item = recordedEvidence(graph, run, inputId);
          return <div className="result-input" key={inputId}><span>{humanizeRuleName(entries.get(inputId)?.name.replace(/^input\./, "") ?? inputId)}</span><strong>{format(displayValue(inputId))}</strong>{item && <small>{item.origin}</small>}</div>;
        })}</div>
        {!inputs.length && <p>No input dependencies are recorded for this node.</p>}
        {inputs.length > 6 && <button className="workspace-button" onClick={() => setShowAllInputs(value => !value)}>{showAllInputs ? "Show fewer inputs" : `Show all ${inputs.length} inputs`}</button>}
      </section></details>

  </section>;
}
