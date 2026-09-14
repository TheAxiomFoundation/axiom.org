import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CorpusLibrary, libraryEntries } from "./corpus-library";
import { readRecentRules, readRunCapabilities, rememberRule, rememberRunCapability } from "./library-state";
import type { CorpusModule } from "@/lib/axiom/corpus-field";

vi.mock("@/components/axiom/corpus-field", () => ({ CorpusField: ({ suppliedModules }: { suppliedModules: CorpusModule[] }) => <div data-testid="filtered-map">{suppliedModules.map((item) => item.target).join(",")}</div> }));
const modules: CorpusModule[] = [
  { target: "us:statutes/26/32", jurisdiction: "us", bucket: "statutes", ruleCount: 24, linkedRuleCount: 24, importCount: 2, headlineRule: "eitc" },
  { target: "us-co:regulations/10/4", jurisdiction: "us-co", bucket: "regulations", ruleCount: 90, linkedRuleCount: 90, importCount: 0, headlineRule: "snap_eligibility" },
];
const props = { modules, active: true, mode: "list" as const, onModeChange: vi.fn(), onPick: vi.fn(), country: "us", countries: [{ id: "us", label: "United States" }], onCountryChange: vi.fn() };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.stubGlobal("scrollTo", vi.fn()); });

describe("law library", () => {
  it("uses recognizable names and searches across jurisdiction and subject words", () => {
    expect(libraryEntries(modules)[0]!.title).toBe("Earned income tax credit");
    render(<CorpusLibrary {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Colorado SNAP" } });
    expect(screen.getByText("SNAP Eligibility")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Earned income tax credit.*24 rules/ })).not.toBeInTheDocument();
  });
  it("never infers executable capability from size and shares filters with the map", () => {
    rememberRunCapability(modules[0]!.target, true);
    const { rerender } = render(<CorpusLibrary {...props} />);
    fireEvent.change(screen.getByLabelText("Jurisdiction"), { target: { value: "us" } });
    expect(screen.getByText("Run available")).toBeInTheDocument();
    expect(screen.queryByText("SNAP Eligibility")).not.toBeInTheDocument();
    rerender(<CorpusLibrary {...props} mode="field" />);
    expect(screen.getByTestId("filtered-map").textContent).toBe(modules[0]!.target);
  });
  it("matches complete citation numbers rather than numeric substrings", () => {
    render(<CorpusLibrary {...props} modules={[...modules, { ...modules[0]!, target: "us:statutes/26/3231", headlineRule: "railroad_compensation" }]} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "26 USC 32" } });
    expect(screen.getByRole("button", { name: /Earned income tax credit.*24 rules/ })).toBeInTheDocument();
    expect(screen.queryByText("Railroad Compensation")).not.toBeInTheDocument();
  });
  it("preserves filters on a round trip and resumes the stored rule and view", () => {
    rememberRule({ target: modules[0]!.target, selection: `${modules[0]!.target}#eitc_allowed`, title: "EITC Allowed", view: "read" });
    const { rerender } = render(<CorpusLibrary {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /EITC Allowed/ }));
    expect(props.onPick).toHaveBeenCalledWith(modules[0]!.target, expect.objectContaining({ view: "read", selection: expect.stringContaining("#eitc_allowed") }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Colorado" } });
    rerender(<CorpusLibrary {...props} active={false} />);
    rerender(<CorpusLibrary {...props} active />);
    expect(screen.getByRole("searchbox")).toHaveValue("Colorado");
  });
  it("explains an empty search and resets it", () => {
    render(<CorpusLibrary {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no matching rule" } });
    expect(screen.getByText("No matching provisions")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all provisions" }));
    expect(screen.getByText("SNAP Eligibility")).toBeInTheDocument();
  });
});

describe("library browser storage", () => {
  it("deduplicates recent provisions while updating their selected rule", () => {
    rememberRule({ target: modules[0]!.target, selection: "first", view: "read", title: "First" });
    rememberRule({ target: modules[0]!.target, selection: "second", view: "structure", title: "Second" });
    expect(readRecentRules()).toHaveLength(1);
    expect(readRecentRules()[0]!.selection).toBe("second");
  });
  it("rejects corrupt storage and expires run checks", () => {
    localStorage.setItem("axiom-library-recent-v1", "{broken");
    expect(readRecentRules()).toEqual([]);
    localStorage.setItem("axiom-library-runs-v1", JSON.stringify({ [modules[0]!.target]: { available: true, checkedAt: Date.now() - 86400001 } }));
    expect(readRunCapabilities()).toEqual({});
  });
});
