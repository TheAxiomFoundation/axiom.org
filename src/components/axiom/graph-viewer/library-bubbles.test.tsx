import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LibraryBubbles, sourceGroup } from "./library-bubbles";
import type { CorpusModule } from "@/lib/axiom/corpus-field";
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
  fireEvent.click(screen.getByRole("button", { name: /26 USC § 21, 1 provision, open graph/ }));
  expect(onPick).toHaveBeenCalledWith("us:statutes/26/21");
  fireEvent.click(screen.getByRole("button", { name: "All jurisdictions" }));
  expect(screen.getByRole("button", { name: /2 provisions, explore/ })).toBeInTheDocument();
 });
 it("resets a drill-down when the search or filters change", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { rerender } = render(<LibraryBubbles modules={modules} onPick={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /2 provisions, explore/ }));
  rerender(<LibraryBubbles modules={[modules[0]!]} onPick={vi.fn()} />);
  expect(screen.getByRole("button", { name: "All jurisdictions" })).toHaveAttribute("aria-current", "page");
 });
});
