"use client";

import { humanizeRuleName } from "./citations";
import { resolveLogicIdentifier } from "./rule-logic";
import { parseFormulaStrict, type AstNode } from "./formula";

type Props = {
  formula: string;
  dependencies: string[];
  entries: Map<string, { legalId: string; name: string }>;
  valueOf: (id: string) => unknown;
  hasRun: boolean;
  onSelect: (id: string) => void;
  activeId?: string | null;
  onHighlight?: (id: string | null) => void;
};
const comparison = { "==": "equals", "!=": "does not equal", ">": "is greater than", ">=": "is at least", "<": "is less than", "<=": "is at most" };
const symbols = { "+": "+", "-": "−", "*": "×", "/": "÷" };
function showValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "Not reported";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  if (typeof raw === "object") return Object.entries(raw).map(([name, value]) => `${humanizeRuleName(name)}: ${showValue(value)}`).join(" · ");
  return String(raw);
}
function Expression({ node, context, compact = false }: {node: AstNode; context: Props; compact?: boolean}) {
  const child = (part: AstNode, key?: number) => <Expression key={key} node={part} context={context} />;
  if (node.kind === "ident") {
    const id = resolveLogicIdentifier(node.name, context.dependencies, context.entries);
    const raw = id && context.hasRun ? context.valueOf(id) : undefined;
    const label = humanizeRuleName(id ? context.entries.get(id)!.name : node.name);
    const value = showValue(raw);
    const hint = `${label}${context.hasRun ? raw === undefined || raw === null ? " · No scalar value reported" : ` = ${value}` : ""}`;
    return <button type="button" className={`formula-reference ${context.activeId === id ? "is-highlighted" : ""}`} title={node.name} aria-label={context.hasRun ? hint : node.name} disabled={!id} onMouseEnter={() => id && context.onHighlight?.(id)} onMouseLeave={() => context.onHighlight?.(null)} onFocus={() => id && context.onHighlight?.(id)} onBlur={() => context.onHighlight?.(null)} onClick={() => id && context.onSelect(id)}>
      <span className="formula-reference-name">{label}</span>
      {context.hasRun && <span className={`formula-reference-value ${raw === undefined || raw === null ? "is-missing" : ""}`}>{value}</span>}
    </button>;
  }
  if (node.kind === "number" || node.kind === "bool") return <span className="formula-constant">{String(node.value)}</span>;
  if (node.kind === "logical") {
    const parts: AstNode[] = [];
    const collect = (part: AstNode) => { if (part.kind === "logical" && part.op === node.op) {collect(part.left); collect(part.right);} else parts.push(part); };
    collect(node);
    return <section className="formula-group"><h5>{node.op === "and" ? "All of these must be true" : "Any of these must be true"}</h5><ol className="formula-conditions">{parts.map((part, index) => <li key={index}>{child(part)}</li>)}</ol></section>;
  }
  if (node.kind === "ifElse") return <div className="formula-branches"><section><h5>If</h5>{child(node.cond)}</section><section><h5>Then return</h5>{child(node.then)}</section><section><h5>Otherwise return</h5>{child(node.else_)}</section></div>;
  if (node.kind === "comparison") return <div className="formula-comparison">{child(node.left)}<span className="formula-operation-label">{comparison[node.op]}</span>{child(node.right)}</div>;
  if (node.kind === "arith") {
    // Flatten only the left-associated sum: preserve explicit right-hand grouping.
    if (node.op === "+" && !compact) {
      const terms: AstNode[] = [];
      const collect = (part: AstNode) => {
        if (part.kind === "arith" && part.op === "+") { collect(part.left); terms.push(part.right); }
        else terms.push(part);
      };
      collect(node);
      return <section className="formula-sum"><h5>Sum of</h5><ol>{terms.map((term, index) => <li key={index}><span className="formula-sum-sign" aria-hidden="true">{index ? "+" : ""}</span><Expression node={term} context={context} compact /></li>)}</ol></section>;
    }
    return <span className="formula-inline-math"><span className="formula-punctuation">(</span><Expression node={node.left} context={context} compact /><span className="formula-operation-label">{symbols[node.op]}</span><Expression node={node.right} context={context} compact /><span className="formula-punctuation">)</span></span>;
  }
  if (node.kind === "unary") return <div className="formula-unary"><span className="formula-operation-label">{node.op === "not" ? "Not" : "Negate"}</span>{child(node.operand)}</div>;
  if (node.kind === "call") {
    if (compact) return <span className="formula-inline-call"><span className="formula-function-name">{node.name}</span><span className="formula-punctuation">(</span>{node.args.map((arg, index) => <span className="formula-inline-argument" key={index}>{index > 0 && <span className="formula-punctuation">, </span>}<Expression node={arg} context={context} compact /></span>)}<span className="formula-punctuation">)</span></span>;
    if (node.name === "count_where" && node.args.length === 2) return <section className="formula-group"><h5>Count matching members</h5><div className="formula-count"><span>From</span>{child(node.args[0])}<span>Where true</span>{child(node.args[1])}</div></section>;
    const title = node.name === "min" ? "Take the minimum" : node.name === "max" ? "Take the maximum" : node.name;
    return <section className="formula-group"><h5>{title}</h5><ol className="formula-conditions">{node.args.map((arg, index) => <li key={index}>{child(arg)}</li>)}</ol></section>;
  }
  if (node.kind === "index") return <section className="formula-group"><h5>Look up</h5>{child(node.target)}<span className="formula-operation-label">at index</span>{child(node.index)}</section>;
  return <pre>{node.text}</pre>;
}

/** The written formula remains authoritative; values annotate references, never replace their identity. */
export function RecordedFormula(props: Props) {
  const ast = parseFormulaStrict(props.formula);
  return <div className="readable-formula" aria-label={props.hasRun ? "Formula with recorded values" : "Formula with linked dependencies"}>
    {ast ? <><Expression node={ast} context={props} /><details className="formula-source"><summary>Exact formula</summary><pre>{props.formula}</pre></details></> : <pre className="formula-source-fallback">{props.formula}</pre>}
  </div>;
}
