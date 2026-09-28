import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
 expect(screen.getByText(/custom_evidence: preserved/)).toBeInTheDocument();
 expect(screen.queryByText(/Sibling module description/)).not.toBeInTheDocument();
 expect(screen.queryByText(/Not this node/)).not.toBeInTheDocument();
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
 expect(screen.getByText(/custom: retained/)).toBeInTheDocument();
});
it("ignores responses for a node that is no longer selected", async () => {
 let finish!: (value: unknown) => void;
 vi.stubGlobal("fetch",vi.fn().mockImplementationOnce(() => new Promise(resolve => {finish=resolve;})).mockResolvedValueOnce({ok:true,json:async()=>({content:"rules: [{name: second, description: Current node}]"})}));
 const {rerender} = render(<NodeMetadata id="root#selected" />);
 rerender(<NodeMetadata id="other#second" />);
 expect(await screen.findByText("Current node")).toBeInTheDocument();
 finish({ok:true,json:async()=>({content})});
 await waitFor(() => expect(screen.queryByText(/Whether this person qualifies/)).not.toBeInTheDocument());
});
it("keeps graph details on failure and allows a retry", async () => {
 vi.stubGlobal("fetch",vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ok:true,json:async()=>({content})}));
 render(<NodeMetadata id="root#selected" entry={{entity:"Person"}} />);
 expect(screen.getByText("Person")).toBeInTheDocument();
 fireEvent.click(await screen.findByRole("button",{name:"Retry"}));
 expect(await screen.findByText(/Whether this person qualifies/, {selector:"p"})).toBeInTheDocument();
});
