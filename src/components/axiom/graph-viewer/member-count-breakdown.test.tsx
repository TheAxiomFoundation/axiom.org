import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { countRelationship, MemberCountBreakdown, personResult } from "./member-count-breakdown";
import type { ProgramGraph, RuleNode } from "./types";
const rule = (name: string, entity: string): RuleNode => ({legalId: `law#${name}`, name, entity, fileLegalId: "law", kind: "derived", dtype: null, period: null, unit: null, source: null, ruleDeps: [], inputDeps: [], relationDeps: []});
const graph: ProgramGraph = {rules: [{...rule("count", "TaxUnit"), formula: "count_where(members, eligible)", ruleDeps: ["law#members", "law#eligible"]}, {...rule("eligible", "Person"), inputDeps: ["law#age"]}, {...rule("members", "Person"), kind: "relation"}], inputs: [{legalId: "law#age", name: "age", fileLegalId: "law", entity: "Person"}], relations: [], ownOutputs: [], terminalOutputs: []};
it("resolves the exact relation predicate and relevant person inputs", () => {
 expect(countRelationship(graph, "law#count")).toMatchObject({predicateId: "law#eligible", relationId: "law#members", inputs: ["law#age"]});
 expect(countRelationship(graph, "law#eligible")).toBeNull();
});
it("does not assign an aggregate boolean to every person", () => {
 expect(personResult(graph, {outputs: {eligible: true}, trace: [{variable: "eligible", value: true}]}, "law#eligible", "person_2")).toBeUndefined();
 expect(personResult(graph, {outputs: {}, trace: [{variable: "eligible", value: null, instances: [{entity_id: "person_2", value: false}]}]}, "law#eligible", "person_2")).toBe(false);
});
it("targets each person's inputs and does not invent contributions from missing membership", () => {
 const renderInput = vi.fn(() => <input aria-label="Age" />);
 render(<MemberCountBreakdown graph={graph} selectedId="law#count" members={["person_2"]} run={{outputs: {count: 0}, trace: []}} stale={false} renderInput={renderInput} valueOf={() => 0} onSelect={vi.fn()} />);
 expect(screen.getByText("Tax unit 1")).toBeInTheDocument();
 expect(screen.getByText("0")).toBeInTheDocument();
 expect(screen.getByText(/contribution.*unconfirmed/)).toBeInTheDocument();
 expect(renderInput).toHaveBeenCalledWith("law#age", null);
 expect(renderInput).toHaveBeenCalledWith("law#age", "person_2");
});

it("uses the submitted identity mapping after a person was removed", () => {
 const run = {outputs: {}, submittedPersonIds: {person_1: "person:1:1", person_3: "person:1:2"}, trace: [{variable: "eligible", value: null, instances: [{entity_id: "person:1:2", value: false}]}]};
 expect(personResult(graph, run, "law#eligible", "person_3")).toBe(false);
 expect(personResult(graph, run, "law#eligible", "person_2")).toBeUndefined();
});

it("shows contributions only from the count's recorded dependency evaluations", () => {
 render(<MemberCountBreakdown graph={graph} selectedId="law#count" members={["person_2"]} run={{outputs: {count: 1}, submittedPersonIds: {person_1: "person:1:1", person_2: "person:1:2"}, trace: [{variable: "count", value: 1, dependencies: [{variable: "law#eligible", entity_id: "person:1:1", value: true}, {variable: "law#eligible", entity_id: "person:1:2", value: false}]}]}} stale={false} valueOf={() => 1} onSelect={vi.fn()} />);
 expect(screen.getByText("Contributes 1 to the count")).toBeInTheDocument();
 expect(screen.getByText("Does not contribute to the count")).toBeInTheDocument();
 expect(screen.queryByText(/contribution.*unconfirmed/)).not.toBeInTheDocument();
});
