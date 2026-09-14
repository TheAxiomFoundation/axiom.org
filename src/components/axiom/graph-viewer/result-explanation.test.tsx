import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { recordedEvidence, ResultExplanation, type ExplanationRun } from "./result-explanation";
import type { ProgramGraph, RuleNode } from "./types";
const rule = (legalId: string): RuleNode => ({ legalId, name: legalId.split("#").at(-1)!, fileLegalId: "law", kind: "derived", entity: null, dtype: null, period: null, unit: null, source: null, ruleDeps: [], inputDeps: [], relationDeps: [] });
const graph: ProgramGraph = { rules: [{...rule("law#result"), ruleDeps:["law#condition","law#missing"], formula:"if condition: 5 else: 0"},rule("law#condition")], inputs:[],relations:[],ownOutputs:[],terminalOutputs:[] };
const run: ExplanationRun = { outputs:{result:0},trace:[{variable:"condition",value:false}] };
describe("execution evidence", () => {
 it("preserves false and zero", () => {
  expect(recordedEvidence(graph,run,"law#result")?.value).toBe(0);
  expect(recordedEvidence(graph,run,"law#condition")?.value).toBe(false);
 });
 it("does not guess between duplicate fragments", () => {
  expect(recordedEvidence({...graph,rules:[...graph.rules,rule("other#condition")]},run,"law#condition")).toBeUndefined();
 });
 it("keeps entity identities attached to values", () => {
  expect(recordedEvidence(graph,{...run,trace:[{variable:"condition",value:null,instances:[{entity_id:"person1",value:false},{entity_id:"person2",value:true}]}]},"law#condition")?.value).toEqual({person1:false,person2:true});
 });
 it("shows missing evidence and stale state without inventing branch decisions", () => {
  render(<ResultExplanation graph={graph} run={run} rootId="law#result" stale onRead={vi.fn()} />);
  expect(screen.getByText("False")).toBeInTheDocument();
  expect(screen.getByText(/previous run/)).toBeInTheDocument();
  expect(screen.getAllByText("Not reported").length).toBeGreaterThan(0);
  expect(screen.getByText(/does not report branch decisions/)).toBeInTheDocument();
 });
});

describe("explanation navigation", () => {
 it("credits submitted inputs and formats per-entity values", () => {
  const withInput: ProgramGraph = { ...graph, inputs: [{ legalId: "law#age", name: "input.age" } as unknown as ProgramGraph["inputs"][number]] };
  expect(recordedEvidence(withInput, { ...run, submittedFacts: { age: 30 } }, "law#age")).toEqual({ value: 30, origin: "Submitted input" });
  expect(recordedEvidence(withInput, run, "law#age")).toBeUndefined();
  const { unmount } = render(<ResultExplanation graph={graph} run={{ ...run, trace: [{ variable: "condition", value: null, instances: [{ entity_id: "person_1", value: false }, { entity_id: "person_2", value: true }] }] }} rootId="law#condition" stale={false} onRead={vi.fn()} />);
  expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Person 1: False · Person 2: True");
  unmount();
 });
 it("follows a dependency from the table or the formula and returns", () => {
  const onRead = vi.fn();
  render(<ResultExplanation graph={graph} run={run} rootId="law#result" stale={false} onRead={onRead} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Condition" })[0]!);
  expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Condition");
  fireEvent.click(screen.getByRole("button", { name: "Back to previous calculation" }));
  expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Result");
  fireEvent.click(screen.getAllByRole("button", { name: "Condition" })[1]!);
  expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Condition");
  fireEvent.click(screen.getByRole("button", { name: "Read source provision" }));
  expect(onRead).toHaveBeenCalledWith("law#condition");
 });
});
