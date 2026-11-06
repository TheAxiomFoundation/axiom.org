import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SourceConflict } from "@/lib/axiom/source-conflicts-normalize";
import { ConflictBadge, formatMoney, keyPassage, ruleCitationPath, SourceConflictList, useConflictIndex } from "./source-conflicts";
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
  texts: [
    { citation: "26 USC 21(d)(1)", kind: "statute", path: "us/statute/26/21/d/1", url: null, excerpt: "Except as otherwise provided in this subsection, the amount of the employment-related expenses incurred during any taxable year which may be taken into account under subsection (a) shall not exceed—\n\n(A) in the case of an individual who is not married at the close of such year, such individual's earned income for such year, or\n\n(B) in the case of an individual who is married at the close of such year, the lesser of such individual's earned income or the earned income of his spouse for such year." },
    { citation: "26 USC 21(e)(4)", kind: "statute", path: "us/statute/26/21/e/4", url: null, excerpt: "such individual shall not be considered as married." },
    { citation: "2025 Instructions for Form 2441, line 19", kind: "instructions", path: null, url: "https://www.irs.gov/example", excerpt: "Enter your earned income on line 19." },
    { citation: "26 CFR 1.21-2", kind: "regulation", path: null, url: "https://www.ecfr.gov/example", excerpt: "A regulation excerpt." },
  ],
  moneyCase: null,
  implementations: [{ by: "PolicyEngine", follows: "reading" }],
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

  it("quotes the conflicting texts, this provision first, then the readings; the rest waits for one more click", () => {
    render(<SourceConflictList citationPath="us/statute/26/21/e" conflicts={[conflict({ globalId: "us:ruled-one", status: "ruled", question: "A ruled question?" }), conflict()]} />);
    const summaries = [...document.querySelectorAll("details.source-conflict > summary")].map((node) => node.textContent);
    expect(summaries[0]).toContain("Open");
    expect(summaries[1]).toContain("A ruled question?");
    const open = document.querySelectorAll("details.source-conflict")[0]!;
    // The provision on screen leads, with its quoted words.
    const first = open.querySelector(".source-conflict-text")!;
    expect(first.textContent).toContain("26 USC 21(e)(4)");
    expect(first.textContent).toContain("This provision");
    expect(first.querySelector("blockquote")!.textContent).toBe("such individual shall not be considered as married.");
    expect(first.querySelector("a")!.getAttribute("href")).toBe("/us/statute/26/21/e/4");
    expect(open.querySelector('a[href="https://www.irs.gov/example"]')!.getAttribute("target")).toBe("_blank");
    expect(screen.getAllByText("Use the taxpayer's own earned income.")).toHaveLength(2);
    expect(screen.getAllByText("Excludes $500 less.")).toHaveLength(2);
    expect(screen.getAllByText("also PolicyEngine")).toHaveLength(2);
    // Every source shows: one of each kind first, then the second statute.
    expect([...open.querySelectorAll(".source-conflict-text-head a")].map((a) => a.textContent)).toEqual(["26 USC 21(e)(4)", "2025 Instructions for Form 2441, line 19", "26 CFR 1.21-2", "26 USC 21(d)(1)"]);
    // A short quote shows whole, with no toggle.
    expect(first.querySelector("button")).toBeNull();
    // A long quote shows its key passage, whole, and its own Full text toggle.
    const long = open.querySelectorAll(".source-conflict-text")[3]!;
    expect(long.querySelector("blockquote")!.textContent).toBe("… (B) in the case of an individual who is married at the close of such year, the lesser of such individual's earned income or the earned income of his spouse for such year.");
    const toggle = within(long as HTMLElement).getByRole("button", { name: "Full text" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(long.querySelector("blockquote")!.textContent).toContain("Except as otherwise provided in this subsection");
    // The basis waits in its own disclosure.
    expect(open.querySelector(".source-conflict-why")!.textContent).toContain("Section 21(e)(4) treats the taxpayer as not married.");
    expect((open.querySelector(".source-conflict-why") as HTMLDetailsElement).open).toBe(false);
    expect(screen.getAllByRole("link", { name: /Register entry/ })[0]!.getAttribute("title")).toBe("us:dependent-care-exclusion-separate-filer-income in rulespec-us");
  });

  it("shows the size of the difference that a pinned test computes", () => {
    render(<SourceConflictList conflicts={[conflict({ moneyCase: { description: "A separate filer with lower-earning spouse.", amount: "4200.00", currency: "USD", period: "year", computedBy: "test_separate_filer" } })]} />);
    expect(screen.getByText("Size of the difference")).toBeTruthy();
    expect(document.querySelector(".source-conflict-money-amount")!.textContent).toBe("$4,200 a year");
    expect(screen.getByText("test_separate_filer")).toBeTruthy();
    expect(formatMoney("20.40", "USD")).toBe("$20.40");
    expect(formatMoney("x", "USD")).toBe("x USD");
  });

  it("shows no size without a money case", () => {
    render(<SourceConflictList conflicts={[conflict()]} />);
    expect(screen.queryByText("Size of the difference")).toBeNull();
  });

  it("picks the key passage of a long quote, never cutting a sentence", () => {
    expect(keyPassage("Short text.", "anything")).toEqual({ text: "Short text.", before: false, after: false });
    const long = `Except as provided here, the amount shall not exceed—\n\n(A) for an individual who is not married, the individual's earned income, or\n\n(B) for an individual who is married, the lesser of the individual's earned income or the earned income of the spouse. ${"Filler words. ".repeat(10)}`;
    const passage = keyPassage(long, "Is the exclusion limited to the lesser spouse's earned income when married?");
    expect(passage.text.startsWith("(B) for an individual who is married")).toBe(true);
    expect(passage.before).toBe(true);
    expect(passage.after).toBe(false);
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
