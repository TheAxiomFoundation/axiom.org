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

it("sorts uncategorized inputs alphabetically without interpreting their names", () => {
 const inputs = ["taxpayer_earned_income_for_cdcc", "filing_status", "age", "spouse_earned_income_for_cdcc"].map(name => ({name, label: name}));
 const grouped = groupHouseholdInputs(inputs);
 expect(groupHouseholdInputs([...inputs].reverse())).toEqual(grouped);
 expect(grouped).toHaveLength(1);
 expect(grouped[0].title).toBe("");
 expect(grouped[0].fields.map(field => field.name)).toEqual(["age", "filing_status", "spouse_earned_income_for_cdcc", "taxpayer_earned_income_for_cdcc"]);
});
it("uses explicit categories and ordering even when names suggest something else", () => {
 const groups = groupHouseholdInputs([
  {name: "age", label: "Age", category: "Declared category", order: 2},
  {name: "income", label: "Income", category: "Declared category", order: 1},
  {name: "filing_status", label: "Filing status"},
 ]);
 expect(groups.map(group => group.title)).toEqual(["Declared category", ""]);
 expect(groups[0].fields.map(field => field.name)).toEqual(["income", "age"]);
});
it("does not infer tax-unit membership or assign unknown inputs to Household", () => {
 render(<HouseholdComposer fields={[...fields, {name:"other",label:"Other"}]} members={[]} canAddPeople running={false} onAddPerson={vi.fn()} onRemovePerson={vi.fn()} renderControl={() => <input />} />);
 const people = screen.getByRole("region", {name:"People"});
 expect(screen.getByRole("region", {name:"Tax Unit"})).not.toContainElement(people);
 expect(screen.getByRole("button", {name:"Unspecified Entity"})).toBeInTheDocument();
});
it("searches across entities and edits each result on its owning person", () => {
 const renderControl = vi.fn((field, member) => <input aria-label={`${field.name}:${member ?? 'primary'}`} />);
 render(<HouseholdComposer fields={fields} members={["person_2"]} canAddPeople running={false} onAddPerson={vi.fn()} onRemovePerson={vi.fn()} renderControl={renderControl} />);
 const search = screen.getByRole("searchbox", {name:"Find inputs across all entities"});
 fireEvent.change(search, {target:{value:"age"}});
 expect(screen.getByRole("region", {name:"Person 1 fields"})).toBeInTheDocument();
 expect(screen.getByRole("textbox", {name:"age:person_2"})).toBeInTheDocument();
 expect(screen.queryByRole("textbox", {name:"income:primary"})).not.toBeInTheDocument();
 fireEvent.change(search, {target:{value:"tax unit"}});
 expect(screen.getByRole("textbox", {name:"income:primary"})).toBeInTheDocument();
 fireEvent.change(search, {target:{value:"unmatched"}});
 expect(screen.getByText("No matching inputs across the scenario.")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", {name:"Clear"}));
 expect(screen.getByRole("region", {name:"Tax Unit inputs"})).toBeInTheDocument();
});
