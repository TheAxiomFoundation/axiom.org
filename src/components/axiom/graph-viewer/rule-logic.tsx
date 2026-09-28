"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { parseFormulaStrict, type AstNode } from "./formula";
import { humanizeRuleName } from "./citations";
import "./rule-logic.css";

type Entry = { legalId: string; name: string };

/** Resolve only declared dependencies, and never guess between duplicate names. */
export function resolveLogicIdentifier(name: string, dependencies: string[], entries: Map<string, Entry>) {
  const matches = dependencies.filter((id) => {
    const entry = entries.get(id);
    return entry && (entry.name === name || id.split("#").at(-1) === name);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

type Context = { resultName?: string; selectedId?: string; dependencies: string[]; entries: Map<string, Entry>; onSelect: (id: string) => void; hasRun: boolean; value: (id: string) => string };
const operators = { "+": "Add", "-": "Subtract", "*": "Multiply", "/": "Divide", "==": "equals", "!=": "does not equal", "<": "is less than", "<=": "is at most", ">": "is greater than", ">=": "is at least" };

function displayName(name: string) {
  return humanizeRuleName(name).split(" ").map((word, index) => index === 0 || /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()).join(" ");
}

function Expression({ node, context, depth = 0 }: { node: AstNode; context: Context; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const child = (part: AstNode, key?: number) => <Expression key={key} node={part} context={context} depth={depth + 1} />;
  if (depth >= 4 && !expanded && !["ident", "number", "bool"].includes(node.kind)) return <button className="logic-expand" onClick={() => setExpanded(true)}>Explore this {node.kind === "ifElse" ? "decision" : "expression"} →</button>;
  if (node.kind === "ident") {
    const id = resolveLogicIdentifier(node.name, context.dependencies, context.entries);
    return <button className="logic-operand" aria-label={`${humanizeRuleName(node.name)}${id && context.hasRun ? ` ${context.value(id)}` : ""}`} disabled={!id} onClick={() => id && context.onSelect(id)} title={node.name}>
      <span>{displayName(node.name)}</span>{id && <ArrowUpRight size={14} aria-hidden="true" />}
      {id && context.hasRun && <small>{context.value(id)}</small>}
    </button>;
  }
  if (node.kind === "number" || node.kind === "bool") return <span className="logic-literal">{String(node.value)}</span>;
  if (node.kind === "ifElse") return <div className="logic-decision">
    <div className="logic-condition"><h3>If</h3>{child(node.cond)}</div>
    <div className="logic-branches">
      <section><h3><span className="logic-path" />Then</h3>{child(node.then)}</section>
      <section><h3><span className="logic-path" />Otherwise</h3>{child(node.else_)}</section>
    </div>
  </div>;
  if (node.kind === "logical") {
    const parts: AstNode[] = [];
    const collect = (part: AstNode) => { if (part.kind === "logical" && part.op === node.op) { collect(part.left); collect(part.right); } else parts.push(part); };
    collect(node);
    return <div className="logic-operation logic-conditions"><h3>{node.op === "and" ? "All conditions" : "Any condition"}</h3><div className="logic-operands">{parts.map((part, index) => <div className="logic-term" key={index}>{index > 0 && <span className="logic-join">{node.op}</span>}{child(part)}</div>)}</div></div>;
  }
  if (node.kind === "comparison") return <div className="logic-comparison">{child(node.left)}<span>{operators[node.op]}</span>{child(node.right)}</div>;
  if (node.kind === "arith") return <div className="logic-operation"><h3>{operators[node.op]}</h3><div className="logic-operands">{child(node.left)}<span className="logic-symbol">{node.op}</span>{child(node.right)}</div></div>;
  if (node.kind === "call") return <div className="logic-operation"><h3>{node.args.length >= 2 && node.name === "min" ? node.args.length === 2 ? "The smaller of" : "The smallest of" : node.args.length >= 2 && node.name === "max" ? node.args.length === 2 ? "The larger of" : "The largest of" : `${node.name}(…)`}</h3><ol className="logic-arguments">{node.args.map((part, index) => <li key={index}>{child(part)}</li>)}</ol></div>;
  if (node.kind === "unary") return <div className="logic-operation"><h3>{node.op === "not" ? "Not" : "Negate"}</h3>{child(node.operand)}</div>;
  if (node.kind === "index") return <div className="logic-operation"><h3>Look up</h3>{child(node.target)}<span className="logic-index">at index</span>{child(node.index)}</div>;
  return null;
}

export function RuleLogic({ formula, ...context }: Context & { formula?: string | null }) {
  const ast = useMemo(() => formula ? parseFormulaStrict(formula) : null, [formula]);
  return <section className="rule-logic" aria-label="Rule logic">
    {ast ? <>
      {ast.kind === "ifElse" ? <table className="logic-decision-table" aria-label="Rule decision">
        <thead><tr><th scope="col">When</th><th scope="col">{context.resultName ?? "Result"} equals</th></tr></thead>
        <tbody>
          <tr><td><Expression node={ast.cond} context={context} /></td><td><Expression node={ast.then} context={context} /></td></tr>
          <tr><td><span className="logic-otherwise">Otherwise</span></td><td><Expression node={ast.else_} context={context} /></td></tr>
        </tbody>
      </table> : <div className="logic-calculation"><h2>{context.resultName ?? "Result"} equals</h2><Expression node={ast} context={context} /></div>}

      {context.hasRun && <p className="logic-note">Named values come from the last run. Branches show the formula’s logic, not an execution trace.</p>}
    </> : <p className="logic-note">{formula ? "This formula is not yet supported by the visual explanation. Its exact expression and relationships are shown below." : "No formula is available for this item. Explore its recorded relationships below."}</p>}
    {formula && <section className="workspace-formula" aria-label="Exact formula"><h2>Formula</h2><pre>{formula}</pre></section>}
  </section>;
}
