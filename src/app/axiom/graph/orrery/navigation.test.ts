import { describe, expect, it } from "vitest";
import type { GraphDocument } from "@axiom-foundation/orrery";
import { initialOrreryLocation, nativeGraphHref, readOrreryRequest } from "./navigation";

const id = "us:statutes/26/1#amount";
const graph: GraphDocument = { schemaVersion: "graph-explorer/v1", id: "fixture", title: "Synthetic navigation", nodes: [{ id, kind: "rule", label: "Amount" }], edges: [] };

describe("Orrery host navigation", () => {
  it("uses the existing program contract and rejects invalid runtime slugs", () => {
    expect(readOrreryRequest("?program=us-co/co-snap").program).toEqual({ jurisdiction: "us-co", programId: "co-snap" });
    expect(readOrreryRequest("?program=us/../secret").error).toBeTruthy();
    expect(readOrreryRequest("?program=us").program).toBeUndefined();
    expect(readOrreryRequest("?compose=us%3Astatutes%2F26%2F1").compose).toBe("us:statutes/26/1");
  });

  it("preserves the native program/compose address and encodes exact selection", () => {
    const href = nativeGraphHref("?program=us/oasdi&year=2026", id);
    const url = new URL(href, "https://axiom.org");
    expect(url.pathname).toBe("/axiom/graph");
    expect(url.searchParams.get("program")).toBe("us/oasdi");
    expect(url.searchParams.get("year")).toBe("2026");
    expect(url.searchParams.get("focus")).toBe(id);
    expect(url.hash).toBe("");
    expect(new URL(nativeGraphHref("?compose=us%3Astatutes%2F26%2F1"), url).searchParams.get("compose")).toBe("us:statutes/26/1");
  });

  it("honors shared hash navigation over native focus and never invents a file node", () => {
    expect(initialOrreryLocation("#selectedId=another&depth=2", { focus: id }, graph)).toMatchObject({ selectedId: "another", depth: 2 });
    expect(initialOrreryLocation("", { focus: id }, graph)).toMatchObject({ selectedId: id, focusId: id, depth: 1 });
    expect(initialOrreryLocation("", { focus: "us:statutes/26/1" }, graph)).toEqual({});
  });
});
