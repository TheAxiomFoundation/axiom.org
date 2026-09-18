import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RecordedFormula } from "./recorded-formula";
const entries = new Map(["eligible", "amount", "missing", "members"].map(name => [`law#${name}`, { legalId: `law#${name}`, name }]));
it("substitutes false and zero, links hover/focus to cards and preserves missing and member values", () => {
  const onHighlight = vi.fn(), onSelect = vi.fn();
  render(<RecordedFormula formula="if eligible: amount + missing + members else: 0" entries={entries} dependencies={[...entries.keys()]} hasRun valueOf={id => (new Map<string, unknown>([["law#eligible", false], ["law#amount", 0], ["law#members", { person1: 10 }]])).get(id)} onHighlight={onHighlight} onSelect={onSelect} />);
  const value = screen.getByRole("button", { name: "Amount = 0" });
  expect(value).toHaveTextContent("0");
  expect(screen.getByRole("button", { name: "Eligible = false" })).toHaveTextContent("false");
  expect(screen.getByRole("button", { name: /Missing/ })).toHaveTextContent("missing");
  expect(screen.getByRole("button", { name: /Members/ })).toHaveTextContent("members");
  fireEvent.mouseEnter(value); expect(onHighlight).toHaveBeenLastCalledWith("law#amount");
  fireEvent.focus(value); expect(onHighlight).toHaveBeenLastCalledWith("law#amount");
  fireEvent.click(value); expect(onSelect).toHaveBeenCalledWith("law#amount");
  fireEvent.mouseLeave(value); expect(onHighlight).toHaveBeenLastCalledWith(null);
});
it("preserves strings, qualified references, functions and scientific literals", () => {
  render(<RecordedFormula formula={'amount + "amount" + person.amount + amount(1e3)'} entries={entries} dependencies={[...entries.keys()]} hasRun valueOf={() => 5} onSelect={() => {}} />);
  expect(screen.getByLabelText("Formula with recorded values").textContent).toBe('5 + "amount" + person.amount + amount(1e3)');
});
