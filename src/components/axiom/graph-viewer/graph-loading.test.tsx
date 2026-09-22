import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { GraphLoading } from "./graph-loading";

it("announces the loading state with its label", () => {
  render(<GraphLoading label="Arranging the graph…" />);
  expect(screen.getByRole("status")).toHaveTextContent("Arranging the graph…");
});
