import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TextSizeButton } from "./text-size";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("TextSizeButton", () => {
  it("steps the page's text up, then back to standard, and remembers it", () => {
    render(<TextSizeButton />);
    const root = document.documentElement;
    expect(root).not.toHaveAttribute("data-aspen-text");
    fireEvent.click(screen.getByRole("button", { name: "Text size: Standard. Change to Large." }));
    expect(root).toHaveAttribute("data-aspen-text", "large");
    expect(JSON.parse(localStorage.getItem("aspen.textSize.v1")!)).toBe("large");
    fireEvent.click(screen.getByRole("button", { name: "Text size: Large. Change to Larger." }));
    expect(root).toHaveAttribute("data-aspen-text", "larger");
    fireEvent.click(screen.getByRole("button", { name: "Text size: Larger. Change to Standard." }));
    expect(root).not.toHaveAttribute("data-aspen-text");
  });

  it("starts from the size this phone picked before, and leaves the page alone once gone", () => {
    localStorage.setItem("aspen.textSize.v1", JSON.stringify("larger"));
    const { unmount } = render(<TextSizeButton />);
    expect(document.documentElement).toHaveAttribute("data-aspen-text", "larger");
    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-aspen-text");
  });

  it("ignores a stored size it doesn't know", () => {
    localStorage.setItem("aspen.textSize.v1", JSON.stringify("huge"));
    render(<TextSizeButton />);
    expect(document.documentElement).not.toHaveAttribute("data-aspen-text");
  });
});
