import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NodeMetadata, selectedMetadata } from "./node-metadata";
import { clearReaderCache } from "./reader-cache";
const content = `module:
  summary: Sibling module description
rules:
  - name: selected
    description: Whether this person qualifies.
    entity: Person
    dtype: Boolean
    default: false
    choices: [false, true]
    versions:
      - effective_from: 2024-01-01
        formula: false
    metadata:
      custom_evidence: preserved
  - name: sibling
    description: Not this node
`;
beforeEach(() => { clearReaderCache(); vi.restoreAllMocks(); });
it("shows encoding description, false default, choices and dates without leaking siblings", () => {
 render(<NodeMetadata id="us:statutes/1#selected" content={content} entry={{unit:"USD",certificateId:"cert-123"}} />);
 expect(screen.getByText(/Whether this person qualifies/, {selector:"p"})).toBeInTheDocument();
 expect(screen.getByText("Declared default").nextElementSibling).toHaveTextContent("false");
 expect(screen.getByText("Allowed choices").nextElementSibling).toHaveTextContent("[false,true]");
 expect(screen.getByText(/2024-01-01 · no end specified/)).toBeInTheDocument();
 fireEvent.click(screen.getByText("All metadata"));
 expect(screen.getByText("custom_evidence:").parentElement).toHaveTextContent("custom_evidence: preserved");
 expect(screen.queryByText(/Sibling module description/)).not.toBeInTheDocument();
 expect(screen.queryByText(/Not this node/)).not.toBeInTheDocument();
});
it("pairs short facts and gives long values their own row after them", () => {
 render(<NodeMetadata id="root#credit" content={`rules:\n  - name: credit\n    entity: TaxUnit\n    dtype: Money\n    source: 26 USC 22(a), 26 USC 22(f)\n    period: Year\n    versions:\n      - effective_from: 2026-01-01`} entry={{certificationStatus:"encoded"}} />);
 const items = [...document.querySelectorAll(".node-metadata dl > div")];
 expect(items.map(item => item.querySelector("dt")?.textContent)).toEqual(["Entity","Value type","Period","Verification status","Source","Encoded effective dates"]);
 expect(items.filter(item => item.classList.contains("node-metadata-wide")).map(item => item.querySelector("dt")?.textContent)).toEqual(["Source","Encoded effective dates"]);
});
it("lays out all metadata as a tree with verbatim formulas and labelled empty fields", () => {
 render(<NodeMetadata id="root#credit" content={`rules:\n  - name: credit\n    versions:\n      - effective_from: 2026-01-01\n        formula: |-\n          if eligible:\n              amount\n          else:\n              0`} entry={{sourceUrl:null,ruleDeps:["root#eligible","root#amount"],inputDeps:[]}} />);
 const [published, loaded] = [...document.querySelectorAll(".node-metadata-raw")];
 expect(published.querySelector("pre")?.textContent).toBe("if eligible:\n    amount\nelse:\n    0");
 expect(within(published as HTMLElement).getByText("effective_from:").closest(".metadata-tree-item")).toHaveTextContent("effective_from: 2026-01-01");
 expect(within(loaded as HTMLElement).getByText("sourceUrl:").parentElement).toHaveTextContent("sourceUrl: —");
 expect(within(loaded as HTMLElement).getByText("inputDeps:").parentElement).toHaveTextContent("inputDeps: none");
 expect([...within(loaded as HTMLElement).getByText("ruleDeps:").parentElement!.querySelectorAll(".metadata-tree-item")].map(item => item.textContent)).toEqual(["root#eligible","root#amount"]);
});
it("rejects ambiguous, missing, file-only and malformed definitions", () => {
 expect(selectedMetadata(content,"us:statutes/1")).toBeNull();
 expect(selectedMetadata(content,"us:statutes/1#unknown")).toBeNull();
 expect(selectedMetadata("rules: [", "us:statutes/1#selected")).toBeNull();
 expect(selectedMetadata("rules: [{name: selected}, {name: selected}]", "us:statutes/1#selected")).toBeNull();
});
it("preserves relationship definitions and arbitrary metadata", () => {
 render(<NodeMetadata id="root#member" content={`relations:\n  - name: member\n    data_relation:\n      predicate: belongs_to\n      arity: 2\n    custom: retained`} />);
 expect(screen.getByText("Relationship").nextElementSibling).toHaveTextContent("belongs_to");
 expect(screen.getByText("Arity").nextElementSibling).toHaveTextContent("2");
 expect(screen.getByText("custom:").parentElement).toHaveTextContent("custom: retained");
});
it("ignores responses for a node that is no longer selected", async () => {
 let finish!: (value: unknown) => void;
 vi.stubGlobal("fetch",vi.fn().mockImplementationOnce(() => new Promise(resolve => {finish=resolve;})).mockResolvedValueOnce({ok:true,json:async()=>({content:"rules: [{name: second, description: Current node}]"})}));
 const {rerender} = render(<NodeMetadata id="root#selected" />);
 rerender(<NodeMetadata id="other#second" />);
 expect(await screen.findByText("Current node", {selector:"p"})).toBeInTheDocument();
 finish({ok:true,json:async()=>({content})});
 await waitFor(() => expect(screen.queryByText(/Whether this person qualifies/)).not.toBeInTheDocument());
});
it("keeps graph details on failure and allows a retry", async () => {
 vi.stubGlobal("fetch",vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ok:true,json:async()=>({content})}));
 render(<NodeMetadata id="root#selected" entry={{entity:"Person"}} />);
 expect(screen.getByText("Person", {selector:"dd"})).toBeInTheDocument();
 fireEvent.click(await screen.findByRole("button",{name:"Retry"}));
 expect(await screen.findByText(/Whether this person qualifies/, {selector:"p"})).toBeInTheDocument();
});
