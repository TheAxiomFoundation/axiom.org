import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loadAtlasGraph } from "./atlas-graph";
import { atlasSections, SourceAtlas } from "./source-atlas";
import type { CorpusModule } from "@/lib/axiom/corpus-field";
vi.mock("./atlas-graph", () => ({ cachedAtlasGraph: vi.fn(), loadAtlasGraph: vi.fn().mockResolvedValue({ n: 2, p: [[0,0],[1,1]], e: [[0,1]] }) }));
vi.mock("./atlas-headings", () => ({ cachedAtlasHeadings: vi.fn().mockReturnValue({}), loadAtlasHeadings: vi.fn().mockResolvedValue({ "us:statutes/26/21": "Expenses for household and dependent care services necessary for gainful employment", "us:statutes/26/32": null }) }));
const modules: CorpusModule[] = ["21/a", "21/b", "32"].map((path,i) => ({ target: `us:statutes/26/${path}`, jurisdiction: "us", bucket: "statutes", ruleCount: 2, linkedRuleCount: 2, importCount: 0, headlineRule: `rule_${i}`, graph: { n: 2, p: [[0,0],[1,1]], e: [[0,1]] } }));
describe("source gallery", () => {
 it("groups real sections", () => { expect(atlasSections(modules,"statutes/26").map(section => section.modules.length)).toEqual([2,1]); });
 it("shows corpus headings and visible node titles, then opens directly", async () => {
  const onPick = vi.fn();
  render(<SourceAtlas modules={modules} source="statutes/26" onPick={onPick} />);
  expect(await screen.findByText("Expenses for household and dependent care services necessary for gainful employment")).toBeInTheDocument();
  expect(screen.getByText("Rule 0")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Rule 0" }));
  expect(onPick).toHaveBeenCalledWith(modules[0]!.target);
 });
 it("keeps large sources in a scrollable gallery without ranges or bulk graph requests", () => {
  vi.mocked(loadAtlasGraph).mockClear();
  const many = Array.from({length:25},(_,i) => ({...modules[0]!, target:`us:statutes/26/${i+1}`,headlineRule:`example_${i}`}));
  render(<SourceAtlas modules={many} source="statutes/26" onPick={vi.fn()} />);
  expect(screen.queryByText("Section ranges")).not.toBeInTheDocument();
  expect(screen.getByText("Example 24")).toBeVisible();
  expect(loadAtlasGraph).not.toHaveBeenCalled();
 });
});
