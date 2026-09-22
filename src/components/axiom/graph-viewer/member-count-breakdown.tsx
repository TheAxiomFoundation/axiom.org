"use client";

import type { ReactNode } from "react";
import type { ProgramGraph } from "./types";
import { parseFormulaStrict } from "./formula";
import { resolveLogicIdentifier } from "./rule-logic";
import { relevantInputs, type ExplanationRun } from "./result-explanation";
import { humanizeRuleName } from "./citations";

export function countRelationship(graph: ProgramGraph, selectedId: string) {
  const rule = graph.rules.find(item => item.legalId === selectedId);
  const ast = rule?.formula ? parseFormulaStrict(rule.formula) : null;
  if (!rule || rule.entity !== "TaxUnit" || ast?.kind !== "call" || ast.name !== "count_where" || ast.args.length !== 2 || ast.args[0].kind !== "ident" || ast.args[1].kind !== "ident") return null;
  const entries = new Map([...graph.rules, ...graph.inputs, ...graph.relations].map(item => [item.legalId, item]));
  const deps = [...rule.ruleDeps, ...rule.relationDeps];
  const relationId = resolveLogicIdentifier(ast.args[0].name, deps, entries);
  const predicateId = resolveLogicIdentifier(ast.args[1].name, deps, entries);
  if (!relationId || !predicateId || graph.rules.find(item => item.legalId === predicateId)?.entity !== "Person") return null;
  return {rule, relationId, predicateId, inputs: relevantInputs(graph, predicateId).filter(id => graph.inputs.find(item => item.legalId === id)?.entity === "Person")};
}

/** A scalar person output cannot identify which member qualified. */
export function personResult(graph: ProgramGraph, run: ExplanationRun | null, predicateId: string, personId: string) {
  const fragment = predicateId.split("#").at(-1);
  const unique = graph.rules.filter(item => item.legalId.split("#").at(-1) === fragment).length === 1;
  const trace = run?.trace.find(item => item.variable === predicateId) ?? (unique ? run?.trace.find(item => item.variable === fragment) : undefined);
  return trace?.instances?.find(item => item.entity_id === (run?.submittedPersonIds?.[personId] ?? personId))?.value;
}

export function MemberCountBreakdown({ graph, selectedId, members, run, stale, renderInput, valueOf, onSelect }: {
  graph: ProgramGraph; selectedId: string; members: string[]; run: ExplanationRun | null; stale: boolean;
  renderInput?: (id: string, member?: string | null) => ReactNode;
  valueOf: (id: string) => unknown; onSelect: (id: string) => void;
}) {
  const count = countRelationship(graph, selectedId);
  if (!count) return null;
  const total = valueOf(selectedId);
  const exactTrace = run?.trace.find(item => item.variable === selectedId);
  const shortName = selectedId.split("#").at(-1);
  const unique = graph.rules.filter(item => item.legalId.split("#").at(-1) === shortName).length === 1;
  const countTrace = exactTrace ?? (unique ? run?.trace.find(item => item.variable === shortName) : undefined);
  const evaluatedPeople = countTrace?.dependencies?.filter(item => item.variable === count.predicateId);

  return <section className="member-count-breakdown" aria-label="People in this count">
    <header><div><h3>Tax unit 1</h3><p>{humanizeRuleName(count.rule.name)}</p></div><div className="member-count-total"><span>{stale ? "Previous count" : "Calculated count"}</span><strong>{run ? typeof total === "number" || typeof total === "string" ? String(total) : "Not reported" : "Not run"}</strong></div></header>
    {!evaluatedPeople?.length && <p className="member-count-evidence">The runtime has not reported this relationship’s membership. Scenario people are shown below; their contribution to this count is unconfirmed.</p>}
    <div className="member-count-people">{["person_1", ...members].map(personId => {
      const evaluated = evaluatedPeople?.find(item => item.entity_id === (run?.submittedPersonIds?.[personId] ?? personId));
      const result = evaluated ? evaluated.value : personResult(graph, run, count.predicateId, personId);
      return <section className="member-count-person" key={personId} aria-label={humanizeRuleName(personId)}>
        <header><h4>{humanizeRuleName(personId)}</h4><span>{stale ? "Previous qualifying result: " : "Qualifying result: "}<strong>{result === true ? "True" : result === false ? "False" : run ? "Not reported" : "Not run"}</strong></span></header>
        {evaluated && <p className="member-count-contribution">{stale ? "Previous run: " : ""}{result === true ? "Contributes 1 to the count" : result === false ? "Does not contribute to the count" : "Contribution not reported"}</p>}
        <button type="button" className="workspace-button" onClick={() => onSelect(count.predicateId)}>Inspect qualifying rule →</button>
        <div className="member-count-inputs">{count.inputs.map(id => <div key={id}>{renderInput?.(id, personId === "person_1" ? null : personId)}</div>)}</div>
      </section>;
    })}</div>
  </section>;
}
