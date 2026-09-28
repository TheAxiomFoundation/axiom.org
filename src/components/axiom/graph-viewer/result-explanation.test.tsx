import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { inputAwareEvidence, recordedEvidence, relevantInputs, resultReason, resultBlockers, ResultExplanation, type ExplanationRun } from "./result-explanation";
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
  expect(screen.getByText(/Condition is false/)).toBeInTheDocument();
  expect(screen.getByText(/previous run/)).toBeInTheDocument();
  expect(screen.queryByRole("region", {name:"Calculation trace"})).not.toBeInTheDocument();
  expect(screen.getByText(/not a complete causal trace/)).toBeInTheDocument();
 });
});

describe("explanation navigation", () => {
 it("credits submitted inputs and formats per-entity values", () => {
  const withInput: ProgramGraph = { ...graph, inputs: [{ legalId: "law#age", name: "input.age" } as unknown as ProgramGraph["inputs"][number]] };
  expect(recordedEvidence(withInput, { ...run, submittedFacts: { age: 30 } }, "law#age")).toEqual({ value: 30, origin: "Submitted input" });
  expect(recordedEvidence(withInput, run, "law#age")).toBeUndefined();
  const { unmount } = render(<ResultExplanation graph={graph} run={{ ...run, trace: [{ variable: "condition", value: null, instances: [{ entity_id: "person_1", value: false }, { entity_id: "person_2", value: true }] }] }} rootId="law#condition" stale={false} onRead={vi.fn()} />);
  expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("False");
  fireEvent.change(screen.getByRole("combobox"), {target:{value:"person_2"}});
  expect(screen.getByRole("heading", {level:3})).toHaveTextContent("True");
  unmount();
 });
 it("links the result and failed checks to the existing relationships view", () => {
  const onRelationships = vi.fn();
  render(<ResultExplanation graph={graph} run={run} rootId="law#result" stale={false} onRead={vi.fn()} onRelationships={onRelationships} />);
  fireEvent.click(screen.getByRole("button", {name:"View relationships for Condition"}));
  expect(onRelationships).toHaveBeenLastCalledWith("law#condition");
  fireEvent.click(screen.getByRole("button", {name:"View result relationships →"}));
  expect(onRelationships).toHaveBeenLastCalledWith("law#result");
  expect(screen.queryByText("Formula and source")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", {name:"Calculation trace"})).not.toBeInTheDocument();
 });

});


describe("focused result review", () => {
 it("explains zero multiplication only when both factors are recorded", () => {
  const data = { ...graph, rules: [{ ...rule("law#result"), formula: "expenses * rate", ruleDeps: ["law#expenses", "law#rate"] }, rule("law#expenses"), rule("law#rate")] };
  expect(resultReason(data, { outputs: { result: "0.00", expenses: "0", rate: "0.2" }, trace: [] }, "law#result")).toContain("Expenses is zero");
  expect(resultReason(data, { outputs: { result: 0, expenses: 0 }, trace: [] }, "law#result")).toContain("did not report enough supported evidence");
  expect(resultReason(data, { outputs: {}, trace: [] }, "law#result")).toContain("did not report a value");
 });
 it("collects relevant inputs through shared and cyclic dependencies without artifact siblings", () => {
  const data: ProgramGraph = { ...graph, rules: [{ ...rule("law#result"), ruleDeps: ["law#child"] }, { ...rule("law#child"), ruleDeps: ["law#result"], inputDeps: ["law#age"] }, { ...rule("law#unrelated"), inputDeps: ["law#income"] }], inputs: [{ legalId: "law#age", name: "age", fileLegalId: "law" }, { legalId: "law#income", name: "income", fileLegalId: "law" }] };
  expect(relevantInputs(data, "law#result")).toEqual(["law#age"]);
 });
 it("opens the current calculation in the graph and offers input editing", () => {
  const onRelationships = vi.fn(), onEditInputs = vi.fn();
  render(<ResultExplanation graph={graph} run={run} rootId="law#result" stale={false} onRead={vi.fn()} onRelationships={onRelationships} onEditInputs={onEditInputs} />);
  fireEvent.click(screen.getByRole("button", { name: /View result relationships/ }));
  expect(onRelationships).toHaveBeenCalledWith("law#result");
  fireEvent.click(screen.getByText("Inputs to review", {selector:"summary"}));
  fireEvent.click(screen.getByRole("button", { name: "Edit inputs" }));
  expect(onEditInputs).toHaveBeenCalledOnce();
 });
});


describe("recorded eligibility blockers", () => {
 const data: ProgramGraph = { ...graph, rules: [{ ...rule("law#result"), formula: "if claim_ok and qualifying_count >= 1: min(potential, tax) else: 0", ruleDeps: ["law#claim_ok", "law#qualifying_count"] }, rule("law#claim_ok"), rule("law#qualifying_count")] };
 it("explains CDCC-style zero results from failed required checks", () => {
  const result = resultBlockers(data, { outputs: { result: 0, claim_ok: false, qualifying_count: "0" }, trace: [] }, "law#result");
  expect(result.map(item => item.id)).toEqual(["law#claim_ok", "law#qualifying_count"]);
  expect(result[1]!.explanation).toContain("must be at least 1");
 });
 it("does not invent missing, per-entity or successful blockers", () => {
  expect(resultBlockers(data, { outputs: { result: 0 }, trace: [] }, "law#result")).toEqual([]);
  expect(resultBlockers(data, { outputs: { result: 0, claim_ok: true, qualifying_count: 2 }, trace: [] }, "law#result")).toEqual([]);
  expect(resultBlockers(data, { outputs: { result: 0, qualifying_count: { household: 0 } }, trace: [] }, "law#result")).toEqual([]);
 });
 it("does not blame a false alternative in an OR or an inactive branch", () => {
  const either = { ...data, rules: [{ ...data.rules[0]!, formula: "if claim_ok or qualifying_count >= 1: 5 else: 0" }, ...data.rules.slice(1)] };
  expect(resultBlockers(either, { outputs: { result: 0, claim_ok: false }, trace: [] }, "law#result")).toEqual([]);
  expect(resultBlockers(data, { outputs: { result: 5, claim_ok: false }, trace: [] }, "law#result")).toEqual([]);
 });
});

it("uses declared input defaults only when evidence is absent", () => {
 const data = { ...graph, inputs: [{legalId: "law#input.flag", name: "flag", fileLegalId: "law"}, {legalId: "law#input.amount", name: "amount", fileLegalId: "law"}] };
 const defaults = { flag: false, amount: 0, missing: 0 };
 expect(inputAwareEvidence(data, run, "law#input.flag", defaults)).toBe(false);
 expect(inputAwareEvidence(data, run, "law#input.amount", defaults)).toBe(0);
 expect(inputAwareEvidence(data, {...run, submittedFacts: {amount: 25}}, "law#input.amount", defaults)).toBe(25);
 expect(inputAwareEvidence(data, run, "law#missing", defaults)).toBeUndefined();
 expect(inputAwareEvidence(data, run, "law#input.flag", {})).toBeUndefined();
});

it("uses literal parameter values without inventing calculation results", () => {
 const data = {...graph, rules: [
  {...rule("law#age_limit"), kind:"parameter", formula:"13"},
  {...rule("law#rate"), kind:"parameter", formula:"0.1234567890123456789"},
  {...rule("law#disabled"), kind:"parameter", formula:"false"},
  {...rule("law#expression"), kind:"parameter", formula:"rate * 2"},
  {...rule("law#calculation"), formula:"13"},
 ]};
 expect(inputAwareEvidence(data, run, "law#age_limit", {})).toBe("13");
 expect(inputAwareEvidence(data, null, "law#rate", {})).toBe("0.1234567890123456789");
 expect(inputAwareEvidence(data, null, "law#disabled", {})).toBe(false);
 expect(inputAwareEvidence(data, run, "law#expression", {})).toBeUndefined();
 expect(inputAwareEvidence(data, run, "law#calculation", {})).toBeUndefined();
 expect(inputAwareEvidence(data, {outputs:{age_limit:12},trace:[]}, "law#age_limit", {})).toBe(12);
});

it("shows top-level amounts and supporting values for a successful result", () => {
 const data = {...graph, rules:[
  {...rule("law#cdcc"), ruleDeps:["law#potential", "law#tax", "law#claim_ok"], formula:"if claim_ok: min(potential, tax) else: 0"},
  {...rule("law#potential"), ruleDeps:["law#rate"], inputDeps:["law#expenses"]},
  rule("law#tax"), rule("law#claim_ok"), {...rule("law#rate"), kind:"parameter", formula:"0.2"},
 ], inputs:[{legalId:"law#expenses", name:"expenses", fileLegalId:"law"}]};
 const onRelationships = vi.fn();
 render(<ResultExplanation graph={data} run={{outputs:{cdcc:1500,potential:1800,tax:1500,claim_ok:true},trace:[],submittedFacts:{expenses:9000}}} rootId="law#cdcc" stale={false} onRead={vi.fn()} onRelationships={onRelationships} />);
 expect(screen.getByRole("row", {name:/Potential/})).toHaveTextContent("1800");
 expect(screen.getByRole("region", {name:"Calculation overview"})).toHaveTextContent("Expenses9000");
 expect(screen.getByRole("region", {name:"Calculation overview"})).toHaveTextContent("Tax1500");
 expect(screen.queryByText(/This is the recorded result for the last run/)).not.toBeInTheDocument();
 fireEvent.click(screen.getAllByRole("button", {name:/Explore relationships/})[0]!);
 expect(onRelationships).toHaveBeenCalledWith("law#potential");
});

it("keeps person and tax-unit selections independent, preserving shared constants and missing values", () => {
 const data: ProgramGraph = {...graph, rules:[
  {...rule("law#result"), entity:"Person", ruleDeps:["law#check", "law#limit", "law#income"]},
  {...rule("law#check"), entity:"Person"},
  {...rule("law#limit"), kind:"parameter", formula:"1000"},
  {...rule("law#income"), entity:"TaxUnit"},
 ]};
 const trace = [
  {variable:"result",value:null,instances:[{entity_id:"person_1",value:100},{entity_id:"person_2",value:200}]},
  {variable:"check",value:null,instances:[{entity_id:"person_1",value:false}]},
  {variable:"income",value:null,instances:[{entity_id:"unit_1",value:3000},{entity_id:"unit_2",value:4000}]},
 ];
 render(<ResultExplanation graph={data} run={{outputs:{},trace}} rootId="law#result" stale={false} onRead={vi.fn()}/>);
 expect(screen.getByRole("row",{name:/Check/})).toHaveTextContent("False");
 fireEvent.change(screen.getByRole("combobox",{name:"Selected Person"}),{target:{value:"person_2"}});
 expect(screen.getByRole("heading",{level:3})).toHaveTextContent("200");
 expect(screen.getByRole("row",{name:/Check/})).toHaveTextContent("Not reported");
 expect(screen.getByRole("row",{name:/Limit/})).toHaveTextContent("1000");
 expect(screen.getByRole("row",{name:/Income/})).toHaveTextContent("3000");
 fireEvent.change(screen.getByRole("combobox",{name:/Selected Tax/}),{target:{value:"unit_2"}});
 expect(screen.getByRole("row",{name:/Income/})).toHaveTextContent("4000");
 expect(screen.getByRole("heading",{level:3})).toHaveTextContent("200");
});
