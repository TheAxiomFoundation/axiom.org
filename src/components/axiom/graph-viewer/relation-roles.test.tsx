import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { describeRelation } from "@/lib/axiom/runtime/relation-roles";
import { ConventionNote, RelationRoles } from "./relation-roles";

const relation = (file: string, name: string, extra: Record<string, string> = {}) =>
  describeRelation({ name, kind: "data_relation", data_relation: { arity: 2, arguments: ["TaxUnit", "Person"] }, ...extra }, file);
const relations = [
  relation("us:statutes/26/32", "qualifying_child_of_tax_unit"),
  relation("us:statutes/26/151", "senior_deduction_individual_of_tax_unit", { label: "Senior deduction individual", description: "Taxpayer or spouse aged 65 or over", source: "26 USC 151(d)(5)(C)" }),
];

it("asks who belongs to each declared relation, starting from no one", () => {
  const onChange = vi.fn();
  render(<RelationRoles relations={relations} members={["person_3"]} roles={{}} running={false} onChange={onChange} />);
  expect(screen.getByText("2 of 2 relationships have no members yet.")).toBeInTheDocument();
  expect(screen.getByText("Qualifying child of tax unit")).toBeInTheDocument();
  expect(screen.getByText("Senior deduction individual")).toBeInTheDocument();
  expect(screen.getByText("Taxpayer or spouse aged 65 or over")).toBeInTheDocument();
  expect(screen.getByText(/26 USC 151\(d\)\(5\)\(C\)/)).toBeInTheDocument();
  const child = screen.getByRole("checkbox", { name: "Person 3 in Qualifying child of tax unit" });
  expect(child).not.toBeChecked();
  fireEvent.click(child);
  expect(onChange).toHaveBeenLastCalledWith("us:statutes/26/32#qualifying_child_of_tax_unit", ["person_3"]);
  fireEvent.click(screen.getByRole("button", { name: "Everyone in Senior deduction individual" }));
  expect(onChange).toHaveBeenLastCalledWith("us:statutes/26/151#senior_deduction_individual_of_tax_unit", ["person_1", "person_3"]);
});

it("keeps household order when ticking, unticks, clears, and locks while running", () => {
  const onChange = vi.fn();
  const roles = { "us:statutes/26/32#qualifying_child_of_tax_unit": ["person_3"] };
  const { rerender } = render(<RelationRoles relations={relations} members={["person_2", "person_3"]} roles={roles} running={false} onChange={onChange} />);
  expect(screen.getByText("1 of 2 relationships have no members yet.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Person 2 in Qualifying child of tax unit" }));
  expect(onChange).toHaveBeenLastCalledWith("us:statutes/26/32#qualifying_child_of_tax_unit", ["person_2", "person_3"]);
  fireEvent.click(screen.getByRole("checkbox", { name: "Person 3 in Qualifying child of tax unit" }));
  expect(onChange).toHaveBeenLastCalledWith("us:statutes/26/32#qualifying_child_of_tax_unit", []);
  fireEvent.click(screen.getByRole("button", { name: "No one in Qualifying child of tax unit" }));
  expect(onChange).toHaveBeenLastCalledWith("us:statutes/26/32#qualifying_child_of_tax_unit", []);
  rerender(<RelationRoles relations={relations} members={[]} roles={roles} running onChange={onChange} />);
  expect(screen.getByRole("checkbox", { name: "Person 1 in Qualifying child of tax unit" })).toBeDisabled();
});

it("renders nothing without relations and names the convention for a single one", () => {
  const { container } = render(<RelationRoles relations={[]} members={[]} roles={{}} running={false} onChange={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
  render(<ConventionNote relation={relations[0]} />);
  expect(screen.getByRole("note")).toHaveTextContent("Everyone in this scenario counts as a member of “Qualifying child of tax unit”");
  const empty = render(<ConventionNote relation={undefined} />);
  expect(empty.container).toBeEmptyDOMElement();
});

it("lists the relationships the headline result reads first", () => {
  render(<RelationRoles relations={relations} members={[]} roles={{}} running={false} onChange={vi.fn()} inUse={new Set(["us:statutes/26/151#senior_deduction_individual_of_tax_unit"])} usedBy="Senior deduction" />);
  const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
  expect(rows[1]).toContain("Senior deduction individual");
  expect(rows[2]).toContain("Also declared in this scope, but not read by Senior deduction:");
  expect(rows[3]).toContain("Qualifying child of tax unit");
});
