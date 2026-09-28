import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseFormulaStrict } from "./formula";
import { resolveLogicIdentifier, RuleLogic } from "./rule-logic";

const formula = "if eligible and count >= 1: min(potential, tax) else: 0";
const entries = new Map(["eligible", "count", "potential", "tax"].map((name) => [`law#${name}`, { name, legalId: `law#${name}` }]));
const context = { entries, dependencies: [...entries.keys()], onSelect: vi.fn(), hasRun: false, value: () => "Not evaluated" };

describe("faithful formula explanations", () => {
  it("preserves conditions, minimum operands and the zero branch", () => {
    expect(parseFormulaStrict(formula)).toMatchObject({ kind: "ifElse", cond: { kind: "logical", op: "and", right: { kind: "comparison", op: ">=" } }, then: { kind: "call", name: "min" }, else_: { kind: "number", value: 0 } });
    render(<RuleLogic formula={formula} {...context} />);
    expect(screen.getByRole("table", { name: "Rule decision" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("All conditions")).toBeInTheDocument();
    expect(screen.getByText("The smaller of")).toBeInTheDocument();
    expect(screen.getByText("Otherwise")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Potential" }));
    expect(context.onSelect).toHaveBeenCalledWith("law#potential");
  });
  it.each(["a.b", "a % 2", "'tax'", "1.2.3", "a if b else c", "a < b < c", "a +", "min(a,)", "a ** 2", "None", "a = b"])("rejects unsupported or partial syntax: %s", (source) => {
    expect(parseFormulaStrict(source)).toBeNull();
  });
  it("does not resolve ambiguous names or undeclared dependencies", () => {
    const duplicate = new Map([...entries, ["other#tax", { name: "tax", legalId: "other#tax" }]]);
    expect(resolveLogicIdentifier("tax", [...duplicate.keys()], duplicate)).toBeUndefined();
    expect(resolveLogicIdentifier("tax", [], entries)).toBeUndefined();
  });
  it("keeps unsupported source intact", () => {
    render(<RuleLogic formula="household.income ** 2" {...context} />);
    expect(screen.getByText(/not yet supported/)).toBeInTheDocument();
    expect(screen.getByText("household.income ** 2")).toBeInTheDocument();
  });
  it("does not interpret one-argument min as a binary amount limit", () => {
    render(<RuleLogic formula="min(tax)" {...context} />);
    expect(screen.getByText("min(…)")).toBeInTheDocument();
    expect(screen.queryByText("The smaller of")).not.toBeInTheDocument();
  });
});
