import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { recordedEvidence, relevantInputs, resultReason, ResultExplanation, type ExplanationRun } from "./result-explanation";
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
  fireEvent.click(screen.getByRole("button", { name: "Inspect Condition" }));
  expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Condition");
  fireEvent.click(screen.getByRole("button", { name: "Back to previous calculation" }));
  expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Result");
  fireEvent.click(screen.getByText("Formula and source"));
  fireEvent.click(screen.getByRole("button", { name: "Condition" }));
  expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Condition");
  fireEvent.click(screen.getByRole("button", { name: "Read source provision" }));
  expect(onRead).toHaveBeenCalledWith("law#condition");
 });
});


describe("focused result review", () => {
 it("explains zero multiplication only when both factors are recorded", () => {
  const data = { ...graph, rules: [{ ...rule("law#result"), formula: "expenses * rate", ruleDeps: ["law#expenses", "law#rate"] }, rule("law#expenses"), rule("law#rate")] };
  expect(resultReason(data, { outputs: { result: "0.00", expenses: "0", rate: "0.2" }, trace: [] }, "law#result")).toContain("Expenses is zero");
  expect(resultReason(data, { outputs: { result: 0, expenses: 0 }, trace: [] }, "law#result")).toContain("zero alone does not establish");
  expect(resultReason(data, { outputs: {}, trace: [] }, "law#result")).toContain("did not report a value");
 });
 it("collects relevant inputs through shared and cyclic dependencies without artifact siblings", () => {
  const data: ProgramGraph = { ...graph, rules: [{ ...rule("law#result"), ruleDeps: ["law#child"] }, { ...rule("law#child"), ruleDeps: ["law#result"], inputDeps: ["law#age"] }, { ...rule("law#unrelated"), inputDeps: ["law#income"] }], inputs: [{ legalId: "law#age", name: "age", fileLegalId: "law" }, { legalId: "law#income", name: "income", fileLegalId: "law" }] };
  expect(relevantInputs(data, "law#result")).toEqual(["law#age"]);
 });
 it("opens the current calculation in the graph and offers input editing", () => {
  const onGraph = vi.fn(), onEditInputs = vi.fn();
  render(<ResultExplanation graph={graph} run={run} rootId="law#result" stale={false} onRead={vi.fn()} onGraph={onGraph} onEditInputs={onEditInputs} />);
  fireEvent.click(screen.getByRole("button", { name: /Follow in graph/ }));
  expect(onGraph).toHaveBeenCalledWith("law#result");
  fireEvent.click(screen.getByRole("button", { name: "Edit inputs" }));
  expect(onEditInputs).toHaveBeenCalledOnce();
 });
});
