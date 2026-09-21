import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LibraryBubbles, sourceGroup } from "./library-bubbles";
import type { CorpusModule } from "@/lib/axiom/corpus-field";
vi.mock("./source-atlas", () => ({ SourceAtlas: ({ modules: suppliedModules, onPick }: { modules: CorpusModule[]; onPick: (target: string) => void }) => <div aria-label="Source node clusters">{suppliedModules.map(module => <button key={module.target} onClick={() => onPick(module.target)}>{module.target}</button>)}</div> }));
const modules: CorpusModule[] = [21, 32].map(section => ({ target: `us:statutes/26/${section}`, jurisdiction: "us", bucket: "statutes", ruleCount: 30, linkedRuleCount: 30, importCount: 0 }));
describe("layered library", () => {
 it("groups a shared code title without calling each section a document", () => {
  expect(sourceGroup(modules[0]!)).toEqual(sourceGroup(modules[1]!));
  expect(sourceGroup(modules[0]!).label).toBe("US Code · Title 26");
 });
 it("opens jurisdiction, then source group, then provision; breadcrumbs return to overview", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const onPick = vi.fn();
  render(<LibraryBubbles modules={modules} onPick={onPick} />);
  fireEvent.click(screen.getByRole("button", { name: /2 provisions, explore/ }));
  fireEvent.click(screen.getByRole("button", { name: /US Code · Title 26, 2 provisions, explore/ }));
  expect(screen.getByLabelText("Source node clusters")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "us:statutes/26/21" }));
  expect(onPick).toHaveBeenCalledWith("us:statutes/26/21");
  fireEvent.click(screen.getByRole("button", { name: "All jurisdictions" }));
  expect(screen.getByRole("button", { name: /2 provisions, explore/ })).toBeInTheDocument();
 });
 it("resets a drill-down when the explicit library scope changes", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { rerender } = render(<LibraryBubbles modules={modules} onPick={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /2 provisions, explore/ }));
  rerender(<LibraryBubbles modules={[modules[0]!]} scopeKey="us:us" onPick={vi.fn()} />);
  expect(screen.getByRole("button", { name: "All jurisdictions" })).toHaveAttribute("aria-current", "page");
 });
 it("preserves the source, document filter and search when returning from a graph refresh", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const onPick = vi.fn();
  const onLevelChange = vi.fn();
  const { rerender } = render(<LibraryBubbles modules={modules} onPick={onPick} onLevelChange={onLevelChange} />);
  fireEvent.click(screen.getByRole("button", { name: /2 provisions, explore/ }));
  fireEvent.click(screen.getByRole("button", { name: "Statutes" }));
  fireEvent.click(screen.getByRole("button", { name: /US Code · Title 26, 2 provisions, explore/ }));
  rerender(<LibraryBubbles modules={modules} onPick={onPick} query="32" onLevelChange={onLevelChange} />);
  fireEvent.click(screen.getByRole("button", { name: "us:statutes/26/32" }));
  onLevelChange.mockClear();
  rerender(<LibraryBubbles modules={modules.map(module => ({ ...module }))} onPick={onPick} query="32" onLevelChange={onLevelChange} />);
  expect(screen.getByRole("button", { name: "US Code · Title 26" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "us:statutes/26/32" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "us:statutes/26/21" })).not.toBeInTheDocument();
  expect(onLevelChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Federal" }));
  expect(screen.getByRole("button", { name: "Statutes" })).toHaveAttribute("aria-pressed", "true");
 });
 it("filters source types without changing the selected jurisdiction", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const policy = { ...modules[0]!, target: "us:policies/irs/manual", bucket: "policies" };
  render(<LibraryBubbles modules={[...modules, policy]} onPick={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /3 provisions, explore/ }));
  fireEvent.click(screen.getByRole("button", { name: "Policies" }));
  expect(screen.queryByRole("button", { name: /US Code · Title 26/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Policies · IRS · Manual/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All types" }));
  expect(screen.getByRole("button", { name: /US Code · Title 26/ })).toBeInTheDocument();
 });

 it("searches within the open source without returning to the map", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const onPick = vi.fn();
  const { rerender } = render(<LibraryBubbles modules={modules} onPick={onPick} />);
  fireEvent.click(screen.getByRole("button", { name: /2 provisions, explore/ }));
  fireEvent.click(screen.getByRole("button", { name: /US Code · Title 26, 2 provisions, explore/ }));
  rerender(<LibraryBubbles modules={modules} onPick={onPick} query="32" />);
  expect(screen.queryByRole("button", { name: "us:statutes/26/21" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "us:statutes/26/32" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "US Code · Title 26" })).toHaveAttribute("aria-current", "page");
  rerender(<LibraryBubbles modules={modules} onPick={onPick} query="unmatched" />);
  expect(screen.getByText(/No matches in this source/)).toBeInTheDocument();
 });

 it("opens Belgium regions through sources to their provision graphs", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const belgium: CorpusModule[] = ["be", "be-vlg", "be-wal", "be-bru", "be-dg"].map(jurisdiction => ({ ...modules[0]!, jurisdiction, target: `${jurisdiction}:statutes/family_benefits/eligibility` }));
  const onPick = vi.fn();
  render(<LibraryBubbles modules={belgium} onPick={onPick} />);
  expect(screen.getByLabelText("Belgium jurisdictions")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Federal, 1 encoded provision" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "German-speaking Community, 1 encoded provision" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Flanders, 1 encoded provision" }));
  fireEvent.click(screen.getByRole("button", { name: /Statutes · Family Benefits, 1 provisions, explore/ }));
  fireEvent.click(screen.getByRole("button", { name: "be-vlg:statutes/family_benefits/eligibility" }));
  expect(onPick).toHaveBeenCalledWith("be-vlg:statutes/family_benefits/eligibility");
 });

});
