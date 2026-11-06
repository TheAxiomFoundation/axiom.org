import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SourceConflict } from "@/lib/axiom/source-conflicts-normalize";
import { ConflictBadge, ruleCitationPath, SourceConflictList, useConflictIndex } from "./source-conflicts";
import type { ProgramGraph } from "./types";

const conflict = (overrides: Partial<SourceConflict> = {}): SourceConflict => ({
  globalId: "us:dependent-care-exclusion-separate-filer-income",
  repo: "rulespec-us",
  jurisdiction: "us",
  id: "dependent-care-exclusion-separate-filer-income",
  program: "income-tax",
  status: "open",
  question: "Does section 129 limit the exclusion to the lesser spouse's earned income?",
  reading: "Use the taxpayer's own earned income.",
  basis: "Section 21(e)(4) treats the taxpayer as not married.",
  alternatives: [{ id: "lesser-spouse", reading: "Use the lesser spouse's earned income.", effect: "Excludes $500 less." }],
  ruling: null,
  citationPaths: ["us/statute/26/21/e/4"],
  pendingCitations: [{ citation: "26 CFR 1.21-2", kind: "regulation", url: "https://www.ecfr.gov/example" }],
  adoptedBy: [],
  sourceUrl: "https://github.com/TheAxiomFoundation/rulespec-us/blob/main/known-source-conflicts.yaml",
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe("source conflicts in the app", () => {
  it("names the corpus path a rule cites, narrowed by its citation", () => {
    expect(ruleCitationPath("us:statutes/26/21", "26 USC 21(e)(4)")).toBe("us/statute/26/21/e/4");
    expect(ruleCitationPath("us:statutes/26/21", null)).toBe("us/statute/26/21");
    expect(ruleCitationPath("not-a-legal-id", "x")).toBeNull();
  });

  it("marks open conflicts and counts them", () => {
    const onClick = vi.fn();
    render(<ConflictBadge conflicts={[conflict(), conflict({ globalId: "us:b", status: "ruled" })]} onClick={onClick} />);
    const badge = screen.getByRole("button", { name: "2 known source conflicts, 1 open" });
    expect(badge.className).toContain("is-open");
    fireEvent.click(badge);
    expect(onClick).toHaveBeenCalled();
  });

  it("renders nothing without conflicts", () => {
    const { container } = render(<><ConflictBadge conflicts={[]} /><SourceConflictList conflicts={[]} /></>);
    expect(container.innerHTML).toBe("");
  });

  it("lists the question, the adopted and other readings, the sources and the register entry, open first", () => {
    render(<SourceConflictList citationPath="us/statute/26/21/e" conflicts={[conflict({ globalId: "us:ruled-one", status: "ruled", question: "A ruled question?" }), conflict()]} />);
    const summaries = [...document.querySelectorAll("summary")].map((node) => node.textContent);
    expect(summaries[0]).toContain("Open");
    expect(summaries[1]).toContain("A ruled question?");
    expect(screen.getAllByText("Use the taxpayer's own earned income.")).toHaveLength(2);
    expect(screen.getAllByText("Excludes $500 less.")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "us/statute/26/21/e/4" })[0]!.getAttribute("href")).toBe("/us/statute/26/21/e/4");
    expect(screen.getAllByRole("link", { name: /26 CFR 1\.21-2/ })[0]!.getAttribute("href")).toBe("https://www.ecfr.gov/example");
    expect(screen.getByRole("link", { name: /us:dependent-care-exclusion-separate-filer-income in rulespec-us/ })).toBeTruthy();
  });

  it("indexes each rule's conflicts by the path it cites, and keeps the graph usable when the request fails", async () => {
    const graph = {
      rules: [
        { legalId: "us:statutes/26/21#limit", name: "limit", fileLegalId: "us:statutes/26/21", source: "26 USC 21(e)(4)" },
        { legalId: "us:statutes/26/21#credit", name: "credit", fileLegalId: "us:statutes/26/21", source: "26 USC 21(a)" },
      ],
      inputs: [], relations: [], ownOutputs: [], terminalOutputs: [],
    } as unknown as ProgramGraph;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ conflicts: { "us/statute/26/21/e/4": [conflict()] } }) });
    vi.stubGlobal("fetch", fetchMock);
    let index: ReturnType<typeof useConflictIndex> = new Map();
    function Probe() { index = useConflictIndex(graph); return null; }
    render(<Probe />);
    await waitFor(() => expect(index.get("us:statutes/26/21#limit")).toHaveLength(1));
    expect(index.has("us:statutes/26/21#credit")).toBe(false);
    expect(decodeURIComponent(fetchMock.mock.calls[0]![0] as string)).toBe("/api/axiom/source-conflicts?paths=us/statute/26/21/a,us/statute/26/21/e/4");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    let failed: ReturnType<typeof useConflictIndex> = new Map([["x", []]]);
    function FailingProbe() { failed = useConflictIndex(graph); return null; }
    render(<FailingProbe />);
    await waitFor(() => expect(failed.size).toBe(0));
  });
});
