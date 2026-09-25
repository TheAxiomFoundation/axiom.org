import { describe, expect, it } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { inputContextSubgraph, dependencySubgraph, focusLayout, scopeRootFor, upstreamIds } from "./focus-layout";
const nodes: Node[] = [
 {id:"a",position:{x:0,y:0},width:240,height:90,data:{legalId:"a",kind:"input"}},
 {id:"b",position:{x:0,y:150},width:240,height:90,data:{legalId:"b",kind:"input"}},
 {id:"c",position:{x:400,y:0},width:240,height:90,data:{legalId:"c",kind:"output"}},
 {id:"d",position:{x:400,y:200},width:240,height:90,data:{legalId:"d",kind:"output"}},
];
const edges: Edge[] = [{id:"ac",source:"a",target:"c"},{id:"bd",source:"b",target:"d"}];
describe("focus and context layout",()=>{
 it("finds the complete upstream closure without unrelated nodes",()=>{
  expect([...upstreamIds(nodes,edges,"c")].sort()).toEqual(["a","c"]);
  expect(upstreamIds(nodes,edges,null).size).toBe(0);
 });
 it("terminates for shared dependencies and cycles",()=>{
  expect(upstreamIds(nodes,[...edges,{id:"ca",source:"c",target:"a"}],"c").size).toBe(2);
 });
 it("retains all identities and vertical order while allocating more space to the selected branch",()=>{
  const laid = focusLayout(nodes,new Set(["a","c"]));
  expect(laid.map(n=>n.id)).toEqual(nodes.map(n=>n.id));
  expect(laid[0]!.width).toBe(240);
  expect(laid[1]!.width).toBe(164);
  expect(laid[0]!.position.y).toBeLessThan(laid[1]!.position.y);
  expect(nodes[0]!.position).toEqual({x:0,y:0});
  for(let i=0;i<laid.length;i++) for(let j=i+1;j<laid.length;j++) {
   const a=laid[i]!,b=laid[j]!;
   const overlap=a.position.x<b.position.x+b.width! && b.position.x<a.position.x+a.width! && a.position.y<b.position.y+b.height! && b.position.y<a.position.y+a.height!;
   expect(overlap).toBe(false);
  }
 });
 it("keeps inputs near consumers and every DAG edge moving forward",()=>{
  const extra:Node={id:"e",position:{x:800,y:0},width:240,height:90,data:{legalId:"e"}};
  const links=[...edges,{id:"ce",source:"c",target:"e"},{id:"be",source:"b",target:"e"}];
  const laid=focusLayout([...nodes,extra],new Set(["a","c","e"]),links);
  const byId=new Map(laid.map(n=>[n.id,n]));
  for(const edge of links) expect(byId.get(edge.source)!.position.x+byId.get(edge.source)!.width!).toBeLessThan(byId.get(edge.target)!.position.x);
 });
 it("limits depth by named dependencies while passing through operators",()=>{
  const op:Node={id:"op",position:{x:200,y:0},data:{kind:"operator"}};
  const links=[{id:"aop",source:"a",target:"op"},{id:"opc",source:"op",target:"c"},{id:"ba",source:"b",target:"a"}];
  expect([...upstreamIds([...nodes,op],links,"c",1)].sort()).toEqual(["a","c","op"]);
  expect([...upstreamIds([...nodes,op],links,"c",2)].sort()).toEqual(["a","b","c","op"]);
 });
 it("returns deterministically to the original compact arrangement",()=>{
  expect(focusLayout(nodes,new Set())).toEqual(focusLayout(nodes,new Set()));
  expect(focusLayout([],new Set())).toEqual([]);
 });
});

describe("selected-node graph scope", () => {
 it("shows only a standalone selected parameter", () => {
  const result = dependencySubgraph(nodes, [], "b");
  expect(result.nodes.map(n => n.id)).toEqual(["b"]);
  expect(result.edges).toEqual([]);
 });
 it("includes dependencies but excludes sibling outputs and consumers", () => {
  const result = dependencySubgraph(nodes, edges, "c");
  expect(result.nodes.map(n => n.id)).toEqual(["a", "c"]);
  expect(result.edges.map(e => e.id)).toEqual(["ac"]);
  expect(dependencySubgraph(nodes, edges, "a").nodes.map(n => n.id)).toEqual(["a"]);
 });
 it("limits depth and restores the full tree without mutating the loaded graph", () => {
  const links = [...edges, {id:"ba",source:"b",target:"a"}];
  expect(dependencySubgraph(nodes, links, "c", 1).nodes.map(n=>n.id)).toEqual(["a","c"]);
  const full = dependencySubgraph(nodes, links, "c");
  expect(full.nodes.map(n=>n.id)).toEqual(["a","b","c"]);
  full.nodes[0]!.position.x = 999;
  expect(nodes[0]!.position.x).toBe(0);
 });
 it("never falls back to the entire artifact for an unknown selection", () => {
  expect(dependencySubgraph(nodes, edges, "missing").nodes).toEqual([]);
 });
});

it("input deep links retain consumers and their other dependencies, not unrelated roots", () => {
 const links = [...edges, {id:"bc",source:"b",target:"c"}];
 expect(inputContextSubgraph(nodes,links,"a").nodes.map(node => node.id)).toEqual(["a","b","c"]);
 expect(inputContextSubgraph(nodes,links,"a").edges.map(edge => edge.id)).toEqual(["ac","bc"]);
 expect(inputContextSubgraph(nodes,links,"missing").nodes).toEqual([]);
 expect(inputContextSubgraph(nodes,[...links,{id:"ca",source:"c",target:"a"}],"a").nodes).toHaveLength(3);
});

describe("scopeRootFor", () => {
  // summit ← band ← income; sibling ← income; a standalone rule.
  const node = (id: string, kind = "ruleRef"): Node => ({ id, position: { x: 0, y: 0 }, data: { legalId: id, kind } });
  const graphNodes = [node("summit", "output"), node("band"), node("income", "input"), node("sibling", "output"), node("lonely")];
  const graphEdges: Edge[] = [
    { id: "b-s", source: "band", target: "summit" },
    { id: "i-b", source: "income", target: "band" },
    { id: "i-x", source: "income", target: "sibling" },
  ];
  const outputs = ["summit", "sibling"];
  it("opens an intermediate rule inside the output tree that uses it", () => {
    expect(scopeRootFor(graphNodes, graphEdges, outputs, "band")).toBe("summit");
  });
  it("re-roots on another output when the node is that output", () => {
    expect(scopeRootFor(graphNodes, graphEdges, outputs, "sibling")).toBe("sibling");
  });
  it("keeps an input's own context view, and roots unreachable nodes on themselves", () => {
    expect(scopeRootFor(graphNodes, graphEdges, outputs, "income")).toBe("income");
    expect(scopeRootFor(graphNodes, graphEdges, outputs, "lonely")).toBe("lonely");
  });
  it("falls back to the first drawn output", () => {
    expect(scopeRootFor(graphNodes, graphEdges, outputs, null)).toBe("summit");
    expect(scopeRootFor(graphNodes, graphEdges, outputs, "missing")).toBe("summit");
  });
});
