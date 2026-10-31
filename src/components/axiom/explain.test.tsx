import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Explain } from "./explain";

describe("Explain", () => {
  it("opens its note on click, and closes on Escape or a click outside", () => {
    render(
      <div>
        <Explain label="Yield">Share of finished cases that moved on.</Explain>
        <button type="button">Elsewhere</button>
      </div>
    );
    const button = screen.getByRole("button", { name: "What Yield means" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("note")).toBeNull();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note")).toHaveTextContent("Share of finished cases that moved on.");
    expect(button).toHaveAttribute("aria-controls", screen.getByRole("note").id);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("note")).toBeNull();

    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("stays open on a click inside it, and toggles shut on a second click", () => {
    render(<Explain label="Rework">Later merges.</Explain>);
    const button = screen.getByRole("button", { name: "What Rework means" });
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole("note"));
    expect(screen.getByRole("note")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("aligns its note right when it would run past the window's edge", () => {
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { left: window.innerWidth - 40, width: 300, top: 0, right: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    try {
      render(<Explain label="Not measured">No result yet.</Explain>);
      fireEvent.click(screen.getByRole("button", { name: "What Not measured means" }));
      expect(screen.getByRole("note")).toHaveAttribute("data-align", "right");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
    }
  });
});
