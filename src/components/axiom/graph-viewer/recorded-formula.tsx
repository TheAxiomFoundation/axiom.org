"use client";

import { humanizeRuleName } from "./citations";
import { resolveLogicIdentifier } from "./rule-logic";

/** Substitute only scalar evidence. Strings, member collections and missing values
 * retain their identifiers so they cannot masquerade as scalar calculations. */
export function RecordedFormula({ formula, dependencies, entries, valueOf, hasRun, onSelect, activeId, onHighlight }: {
  formula: string;
  dependencies: string[];
  entries: Map<string, { legalId: string; name: string }>;
  valueOf: (id: string) => unknown;
  hasRun: boolean;
  onSelect: (id: string) => void;
  activeId?: string | null;
  onHighlight?: (id: string | null) => void;
}) {
  // Keep quoted strings, qualified names, numbers and function names intact.
  const tokens = formula.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|[\s\S]/g) ?? [formula];
  return <pre className="recorded-formula" aria-label={hasRun ? "Formula with recorded values" : "Formula with linked dependencies"}>{tokens.map((token, index) => {
    const id = /^[A-Za-z_]\w*$/.test(token) && !tokens.slice(index + 1).join("").trimStart().startsWith("(") ? resolveLogicIdentifier(token, dependencies, entries) : undefined;
    if (!id) return token;
    const raw = hasRun ? valueOf(id) : undefined;
    const scalar = typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw)) || (typeof raw === "string" && /^-?\d+(?:\.\d+)?$/.test(raw));
    const label = humanizeRuleName(entries.get(id)!.name);
    const text = scalar ? String(raw) : token;
    const hint = `${label}${hasRun ? scalar ? ` = ${text}` : " · No scalar value reported" : ""}`;
    return <button type="button" key={index} title={hint} aria-label={hasRun ? hint : token} className={activeId === id ? "is-highlighted" : undefined} onMouseEnter={() => onHighlight?.(id)} onMouseLeave={() => onHighlight?.(null)} onFocus={() => onHighlight?.(id)} onBlur={() => onHighlight?.(null)} onClick={() => onSelect(id)}>{text}</button>;
  })}</pre>;
}
