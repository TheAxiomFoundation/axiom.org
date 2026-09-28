import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ResultGraphPreview } from "./result-graph-preview";
import type { ProgramGraph } from "./types";
it("opens the selected result from its dependency preview", () => {
  const onOpen = vi.fn();
  const graph = { rules: [{ legalId: "law#credit", name: "credit", ruleDeps: ["law#eligible"], inputDeps: [], relationDeps: [] }, { legalId: "law#eligible", name: "eligible" }], inputs: [], relations: [] } as unknown as ProgramGraph;
  render(<ResultGraphPreview graph={graph} rootId="law#credit" onOpen={onOpen} />);
  expect(screen.getByText("Eligible")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open result in graph" }));
  expect(onOpen).toHaveBeenCalledOnce();
});
