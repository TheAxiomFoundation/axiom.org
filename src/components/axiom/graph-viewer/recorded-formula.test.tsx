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
  expect(screen.getByRole("button", { name: /Missing/ })).toHaveTextContent("Missing");
  expect(screen.getByRole("button", { name: /Members/ })).toHaveTextContent("Members");
  fireEvent.mouseEnter(value); expect(onHighlight).toHaveBeenLastCalledWith("law#amount");
  fireEvent.focus(value); expect(onHighlight).toHaveBeenLastCalledWith("law#amount");
  fireEvent.click(value); expect(onSelect).toHaveBeenCalledWith("law#amount");
  fireEvent.mouseLeave(value); expect(onHighlight).toHaveBeenLastCalledWith(null);
});
it("preserves strings, qualified references, functions and scientific literals", () => {
  render(<RecordedFormula formula={'amount + "amount" + person.amount + amount(1e3)'} entries={entries} dependencies={[...entries.keys()]} hasRun valueOf={() => 5} onSelect={() => {}} />);
  expect(screen.getByLabelText("Formula with recorded values").textContent).toBe('amount + "amount" + person.amount + amount(1e3)');
});

it("keeps names beside values and preserves nested condition structure", () => {
 render(<RecordedFormula formula="if eligible and amount >= 1: min(amount, 20) else: 0" entries={entries} dependencies={[...entries.keys()]} hasRun valueOf={() => 10} onSelect={() => {}} />);
 expect(screen.getByText("All of these must be true")).toBeInTheDocument();
 expect(screen.getByText("Then return")).toBeInTheDocument();
 expect(screen.getByText("Otherwise return")).toBeInTheDocument();
 expect(screen.getByText("Take the minimum")).toBeInTheDocument();
 expect(screen.getAllByRole("button", {name: "Amount = 10"})[0]).toHaveTextContent("Amount10");
});
