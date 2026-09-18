import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { HouseholdComposer, groupHouseholdInputs } from "./household-composer";
const fields = [{name: "income", label: "income", entity: "TaxUnit"}, {name: "age", label: "age", entity: "Person"}];
it("places inputs directly under their owning entity and targets the selected person", () => {
  const onAddPerson = vi.fn(), onRemovePerson = vi.fn(), renderControl = vi.fn((field, member) => <input aria-label={`${field.name}:${member ?? "primary"}`} />);
  render(<HouseholdComposer fields={fields} members={["person_2"]} canAddPeople running={false} onAddPerson={onAddPerson} onRemovePerson={onRemovePerson} renderControl={renderControl} />);
  expect(screen.getByRole("textbox", {name: "income:primary"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Person 2"}));
  expect(screen.getByRole("textbox", {name: "age:person_2"})).toBeInTheDocument();
  expect(screen.queryByRole("textbox", {name: "income:primary"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: /Add person/}));
  expect(onAddPerson).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", {name: "Remove Person 2"}));
  expect(onRemovePerson).toHaveBeenCalledWith("person_2");
});
it("does not offer unsupported entity creation and recovers when a selected person is removed", () => {
  const props = {fields, members: ["person_2"], canAddPeople: false, running: false, onAddPerson: vi.fn(), onRemovePerson: vi.fn(), renderControl: () => <input />};
  const {rerender} = render(<HouseholdComposer {...props} />);
  expect(screen.queryByRole("button", {name: /Add person/})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Person 2"}));
  rerender(<HouseholdComposer {...props} members={[]} />);
  expect(screen.getByRole("region", {name: /Tax Unit inputs|TaxUnit inputs/})).toBeInTheDocument();
});

it("groups related inputs consistently regardless of registry order", () => {
 const inputs = ["taxpayer_earned_income_for_cdcc", "filing_status", "age", "spouse_earned_income_for_cdcc", "employment_related_expenses_paid"].map(name => ({name, label: name}));
 const grouped = groupHouseholdInputs(inputs);
 expect(groupHouseholdInputs([...inputs].reverse())).toEqual(grouped);
 expect(grouped.map(group => group.title)).toEqual(["Personal details", "Family & filing", "Income & resources", "Care & expenses"]);
 expect(grouped[2].fields).toHaveLength(2);
 expect(grouped.flatMap(group => group.fields)).toHaveLength(inputs.length);
});
