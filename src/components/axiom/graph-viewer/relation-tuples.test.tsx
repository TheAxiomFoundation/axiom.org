import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { describeRelation } from "@/lib/axiom/runtime/relation-roles";
import { RelationTuples } from "./relation-tuples";

const decl = (name: string, args: string[], extra: Record<string, string> = {}) =>
  describeRelation({ name, kind: "data_relation", data_relation: { arity: 2, arguments: args }, ...extra }, "us:statutes/26/22");
const PAY = decl("section_22_payment_of_tax_unit", ["TaxUnit", "Payment"], { source: "26 USC 22(c)(3)" });
const FILER = decl("taxpayer_or_spouse_of_tax_unit", ["TaxUnit", "Person"]);
const ID = "us:statutes/26/22#section_22_payment_of_tax_unit";

it("lists only unit–instance relations, one row per tuple with its slots in declared order", () => {
  render(<RelationTuples relations={[FILER, PAY]} instances={{ Payment: ["payment_1", "payment_2"] }} roles={{ [ID]: ["payment_2"] }} running={false} onChange={vi.fn()} />);
  expect(screen.queryByText("Taxpayer or spouse of tax unit")).not.toBeInTheDocument();
  const relation = screen.getByRole("region", { name: "Section 22 payment of tax unit" });
  expect(relation).toHaveTextContent("26 USC 22(c)(3)");
  const headers = within(relation).getAllByRole("columnheader").map((cell) => cell.textContent);
  expect(headers.slice(0, 2)).toEqual(["Tax unit slot 1", "Payment slot 2"]);
  expect(within(relation).getByRole("combobox", { name: /Tax unit in tuple 1/ })).toBeDisabled();
  expect(within(relation).getByRole("combobox", { name: /Payment in tuple 1/ })).toHaveValue("payment_2");
});

it("adds, changes and removes tuples, never linking one payment twice", () => {
  const onChange = vi.fn();
  const { rerender } = render(<RelationTuples relations={[PAY]} instances={{ Payment: ["payment_1", "payment_2", "payment_3"] }} roles={{}} running={false} onChange={onChange} />);
  expect(screen.getByText(/No tuples/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Add tuple/ }));
  expect(onChange).toHaveBeenLastCalledWith(ID, ["payment_1"]);
  rerender(<RelationTuples relations={[PAY]} instances={{ Payment: ["payment_1", "payment_2", "payment_3"] }} roles={{ [ID]: ["payment_1", "payment_3"] }} running={false} onChange={onChange} />);
  // Each row offers its own payment plus the unlinked ones only.
  const first = screen.getByRole("combobox", { name: /Payment in tuple 1/ });
  expect(within(first).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["payment_1", "payment_2"]);
  fireEvent.change(first, { target: { value: "payment_2" } });
  expect(onChange).toHaveBeenLastCalledWith(ID, ["payment_2", "payment_3"]);
  fireEvent.click(screen.getByRole("button", { name: /Remove tuple 2/ }));
  expect(onChange).toHaveBeenLastCalledWith(ID, ["payment_1"]);
  fireEvent.click(screen.getByRole("button", { name: /Link every payment/ }));
  expect(onChange).toHaveBeenLastCalledWith(ID, ["payment_1", "payment_2", "payment_3"]);
  fireEvent.click(screen.getByRole("button", { name: /Link no payment/ }));
  expect(onChange).toHaveBeenLastCalledWith(ID, []);
  // Everything linked: nothing left to add.
  rerender(<RelationTuples relations={[PAY]} instances={{ Payment: ["payment_1"] }} roles={{ [ID]: ["payment_1"] }} running={false} onChange={onChange} />);
  expect(screen.getByRole("button", { name: /Add tuple/ })).toBeDisabled();
  // Running locks every control.
  rerender(<RelationTuples relations={[PAY]} instances={{ Payment: ["payment_1", "payment_2"] }} roles={{ [ID]: ["payment_1"] }} running onChange={onChange} />);
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  expect(screen.getByRole("combobox", { name: /Payment in tuple 1/ })).toBeDisabled();
});

it("ignores links to payments that are gone and says so when there are none", () => {
  const { rerender } = render(<RelationTuples relations={[PAY]} instances={{ Payment: [] }} roles={{ [ID]: ["payment_4"] }} running={false} onChange={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent(/No payments in this scenario yet/);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  rerender(<RelationTuples relations={[PAY]} instances={{ Payment: ["payment_1"] }} roles={{ [ID]: ["payment_4"] }} running={false} onChange={vi.fn()} />);
  expect(screen.queryByRole("combobox", { name: /Payment in tuple/ })).not.toBeInTheDocument();
});

it("renders the instance slot first when the law declares it first", () => {
  const first = decl("payment_link", ["Payment", "TaxUnit"]);
  render(<RelationTuples relations={[first]} instances={{ Payment: ["payment_1"] }} roles={{ "us:statutes/26/22#payment_link": ["payment_1"] }} running={false} onChange={vi.fn()} />);
  const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
  expect(headers.slice(0, 2)).toEqual(["Payment slot 1", "Tax unit slot 2"]);
});
