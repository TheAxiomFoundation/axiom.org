import { describe, expect, it } from "vitest";

import { evalAst, parseFormula } from "./formula";

describe("exactly_one in the formula surface", () => {
  it("parses as one call node with n arguments", () => {
    const ast = parseFormula("exactly_one(a, b, c, d)");
    expect(ast.kind).toBe("call");
    if (ast.kind !== "call") return;
    expect(ast.name).toBe("exactly_one");
    expect(ast.args).toHaveLength(4);
    expect(ast.args.every((arg) => arg.kind === "ident")).toBe(true);
  });

  it("evaluates the gate over boolean arguments", () => {
    const ast = parseFormula("exactly_one(a, b, c)");
    const truth = (values: Record<string, boolean>) =>
      evalAst(ast, (name) => values[name] ?? null);
    expect(truth({ a: true, b: false, c: false })).toBe(true);
    expect(truth({ a: false, b: true, c: false })).toBe(true);
    expect(truth({ a: true, b: true, c: false })).toBe(false);
    expect(truth({ a: false, b: false, c: false })).toBe(false);
    expect(truth({ a: true, b: true, c: true })).toBe(false);
  });

  it("stays null when any argument is unknown — the trace owns the verdict", () => {
    const ast = parseFormula("exactly_one(a, b)");
    expect(evalAst(ast, (name) => (name === "a" ? true : null))).toBeNull();
  });
});

describe("table lookups in evalAst", () => {
  // NYC § 11-1701(a)(1)(A): base tax and rate per tax band.
  const tables: Record<string, { rows: Array<{ key: string; value: number }> }> = {
    base_tax: { rows: [{ key: "0", value: 0 }, { key: "1", value: 583 }, { key: "2", value: 1355 }] },
    rate: { rows: [{ key: "0", value: 0.027 }, { key: "1", value: 0.033 }, { key: "2", value: 0.0335 }] },
  };
  const values: Record<string, number> = { band: 2, income: 60000, floor: 45000 };
  const lookup = (name: string) => values[name] ?? null;
  const formula = parseFormula("base_tax[band] + rate[band] * max(0, income - floor)");

  it("resolves a lookup when the caller has the table's rows", () => {
    expect(evalAst(formula, lookup, (name) => tables[name])).toBeCloseTo(1857.5);
  });
  it("stays unknown without the rows, or when the key has no row", () => {
    expect(evalAst(formula, lookup)).toBeNull();
    expect(evalAst(parseFormula("base_tax[band]"), () => 7, (name) => tables[name])).toBeNull();
  });
});
