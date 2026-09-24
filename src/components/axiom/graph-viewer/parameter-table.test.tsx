import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { lookedUpTableRow, ParameterTableView, tableIndexId, tableRowFor } from "./parameter-table";
import { inputAwareEvidence, recordedTableRow, type ExplanationRun } from "./result-explanation";
import type { ParameterTable, ProgramGraph, RuleNode } from "./types";

const FILE = "us-ny:statutes/NYC/11-1701";
const rule = (name: string, overrides: Partial<RuleNode> = {}): RuleNode => ({
  legalId: `${FILE}#${name}`, name, fileLegalId: FILE, kind: "derived", entity: null, dtype: null,
  period: null, unit: null, source: null, ruleDeps: [], inputDeps: [], relationDeps: [], ...overrides,
});
// NYC § 11-1701(a)(1)(A): the joint-return base tax, one amount per tax band.
const baseTaxTable: ParameterTable = {
  indexedBy: "tax_band",
  rows: [{ key: "0", value: 0 }, { key: "1", value: 583 }, { key: "2", value: 1355 }, { key: "3", value: 2863 }],
  rowCount: 4,
};
const baseTax = rule("base_tax", { kind: "parameter", formula: null, table: baseTaxTable, unit: "USD" });
const graph: ProgramGraph = {
  rules: [baseTax, rule("tax_band", { inputDeps: [`${FILE}#city_taxable_income`] }), rule("first_ceiling", { kind: "parameter", formula: "21600" })],
  inputs: [{ legalId: `${FILE}#city_taxable_income`, name: "city_taxable_income", fileLegalId: FILE }],
  relations: [], ownOutputs: [], terminalOutputs: [],
};
const run: ExplanationRun = { outputs: {}, trace: [{ variable: "tax_band", value: 2 }] };

describe("table parameter lookup", () => {
  it("resolves the index by name, preferring the parameter's own file", () => {
    const elsewhere = rule("tax_band", { legalId: "us-ny:statutes/TAX/601#tax_band", fileLegalId: "us-ny:statutes/TAX/601" });
    expect(tableIndexId({ ...graph, rules: [elsewhere, ...graph.rules] }, baseTax)).toBe(`${FILE}#tax_band`);
    expect(tableIndexId(graph, { ...baseTax, table: { ...baseTaxTable, indexedBy: null } })).toBeNull();
  });

  it("matches numeric keys by value and refuses per-member values", () => {
    expect(tableRowFor(baseTaxTable, 2)?.value).toBe(1355);
    expect(tableRowFor(baseTaxTable, "2.0")?.value).toBe(1355);
    expect(tableRowFor(baseTaxTable, 7)).toBeNull();
    expect(tableRowFor(baseTaxTable, { person_1: 1, person_2: 2 })).toBeNull();
    expect(tableRowFor(baseTaxTable, undefined)).toBeNull();
  });

  it("reads the row a run's recorded index picked", () => {
    const valueOf = (id: string) => (id === `${FILE}#tax_band` ? 2 : undefined);
    expect(lookedUpTableRow(graph, baseTax.legalId, valueOf)).toEqual({ key: "2", value: 1355 });
    expect(lookedUpTableRow(graph, `${FILE}#first_ceiling`, valueOf)).toBeNull();
  });

  it("gives evidence the looked-up row after a run, and nothing before one", () => {
    expect(inputAwareEvidence(graph, run, baseTax.legalId, {})).toBe(1355);
    expect(inputAwareEvidence(graph, null, baseTax.legalId, {})).toBeUndefined();
    // Scalar parameters keep their declared literal.
    expect(inputAwareEvidence(graph, run, `${FILE}#first_ceiling`, {})).toBe("21600");
  });
});

describe("table rows need a recorded index", () => {
  // CO SNAP: the allotment table is keyed by an input. Unanswered, the
  // engine takes the package's own household (two people → $546), which
  // the viewer can't see — its default of 1 would mark the $298 row.
  const allotment = rule("snap_maximum_allotment_table", {
    kind: "parameter", formula: null,
    table: { indexedBy: "household_size", rows: [{ key: "1", value: 298 }, { key: "2", value: 546 }, { key: "3", value: 785 }], rowCount: 3 },
  });
  const snap: ProgramGraph = {
    rules: [allotment], relations: [], ownOutputs: [], terminalOutputs: [],
    inputs: [{ legalId: `${FILE}#input.household_size`, name: "household_size", fileLegalId: FILE }],
  };
  it("never picks a row from a site-side default", () => {
    const unanswered: ExplanationRun = { outputs: {}, trace: [], submittedFacts: {} };
    expect(inputAwareEvidence(snap, unanswered, allotment.legalId, { household_size: 1 })).toBeUndefined();
    expect(recordedTableRow(snap, unanswered, allotment.legalId)).toBeNull();
  });
  it("picks the row an answered input selects", () => {
    const answered: ExplanationRun = { outputs: {}, trace: [], submittedFacts: { household_size: 3 } };
    expect(inputAwareEvidence(snap, answered, allotment.legalId, { household_size: 1 })).toBe(785);
    expect(recordedTableRow(snap, answered, allotment.legalId)?.key).toBe("3");
  });
});

describe("ParameterTableView", () => {
  it("lists every row and marks the one the run used", () => {
    render(<ParameterTableView table={baseTaxTable} unit="USD" selectedKey="2" />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Tax Band" })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    const used = within(table).getByText("Used by this run").closest("tr")!;
    expect(used).toHaveAttribute("aria-current", "true");
    expect(used).toHaveTextContent("1,355");
    expect(screen.getByText("4 rows · USD")).toBeInTheDocument();
  });

  it("says when a large table arrived in part", () => {
    render(<ParameterTableView table={{ ...baseTaxTable, rowCount: 250 }} stale selectedKey="1" />);
    expect(screen.getByText("Showing the first 4 of 250 rows.")).toBeInTheDocument();
    expect(screen.getByText("Used by the last run")).toBeInTheDocument();
  });
});
