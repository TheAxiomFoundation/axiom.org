import { humanizeRuleName } from "./citations";
import type { ParameterTable, ParameterTableRow, ProgramGraph, RuleNode } from "./types";

/** The node whose value picks a table parameter's row: the rule or input
 *  `indexedBy` names, preferring one declared in the parameter's own file. */
export function tableIndexId(graph: ProgramGraph, rule: RuleNode): string | null {
  const name = rule.table?.indexedBy;
  if (!name) return null;
  const matches = [...graph.rules, ...graph.inputs].filter(
    (item) =>
      item.legalId !== rule.legalId &&
      (item.name === name || item.name.replace(/^input\./, "") === name),
  );
  return (matches.find((item) => item.fileLegalId === rule.fileLegalId) ?? matches[0])?.legalId ?? null;
}

const numeric = (value: string) => value.trim() !== "" && Number.isFinite(Number(value));

/** The row a scalar index value selects; 2, "2" and "2.0" all pick key "2".
 *  A per-entity value (one per member) picks no single row. */
export function tableRowFor(table: ParameterTable, index: unknown): ParameterTableRow | null {
  if (typeof index !== "number" && typeof index !== "string" && typeof index !== "boolean") return null;
  const key = String(index);
  return (
    table.rows.find((row) => row.key === key) ??
    (numeric(key) ? table.rows.find((row) => numeric(row.key) && Number(row.key) === Number(key)) : undefined) ??
    null
  );
}

/** The engine traces no parameters, but it records the index a table is
 *  keyed by — so the row a run used is a lookup, never an evaluation. */
export function lookedUpTableRow(
  graph: ProgramGraph,
  id: string,
  valueOf: (id: string) => unknown,
): ParameterTableRow | null {
  const rule = graph.rules.find((item) => item.legalId === id);
  if (!rule?.table) return null;
  const indexId = tableIndexId(graph, rule);
  return indexId ? tableRowFor(rule.table, valueOf(indexId)) : null;
}

const formatCell = (value: string | number | boolean) =>
  typeof value === "boolean" ? (value ? "True" : "False") : typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : value;

/** A table parameter's rows, with the row a run used marked. */
export function ParameterTableView({ table, unit, selectedKey, stale = false }: { table: ParameterTable; unit?: string | null; selectedKey?: string | null; stale?: boolean }) {
  const keyLabel = table.indexedBy ? humanizeRuleName(table.indexedBy) : "Key";
  return <section className="parameter-table" aria-label="Parameter table">
    <div className="parameter-table-heading"><span>Parameter table</span><small>{table.rowCount} {table.rowCount === 1 ? "row" : "rows"}{unit ? ` · ${unit}` : ""}</small></div>
    <div className="parameter-table-scroll">
      <table>
        <thead><tr><th scope="col">{keyLabel}</th><th scope="col">Value</th></tr></thead>
        <tbody>{table.rows.map((row) => {
          const selected = row.key === selectedKey;
          return <tr key={row.key} className={selected ? "is-selected" : undefined} aria-current={selected ? "true" : undefined}>
            <td>{row.key}</td><td>{formatCell(row.value)}{selected && <small>{stale ? "Used by the last run" : "Used by this run"}</small>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {table.rowCount > table.rows.length && <p className="parameter-table-note">Showing the first {table.rows.length} of {table.rowCount} rows.</p>}
  </section>;
}
