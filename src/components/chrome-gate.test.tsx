import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUsePathname = vi.fn<() => string | null>();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

import { ChromeGate, isBarePath } from "./chrome-gate";

describe("isBarePath", () => {
  it("matches the event page and its sub-paths", () => {
    expect(isBarePath("/aspen")).toBe(true);
    expect(isBarePath("/aspen/present")).toBe(true);
    expect(isBarePath("/aspen/sign-in")).toBe(true);
  });

  it("does not match other paths or a missing path", () => {
    expect(isBarePath("/")).toBe(false);
    expect(isBarePath("/aspenx")).toBe(false);
    expect(isBarePath("/about/aspen")).toBe(false);
    expect(isBarePath("")).toBe(false);
    expect(isBarePath(null)).toBe(false);
  });
});

describe("ChromeGate", () => {
  it("hides the site chrome on /aspen", () => {
    mockUsePathname.mockReturnValue("/aspen");
    const { container } = render(
      <ChromeGate>
        <nav>Site nav</nav>
      </ChromeGate>,
    );
    expect(screen.queryByText("Site nav")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the site chrome everywhere else", () => {
    mockUsePathname.mockReturnValue("/about");
    render(
      <ChromeGate>
        <nav>Site nav</nav>
      </ChromeGate>,
    );
    expect(screen.getByText("Site nav")).toBeInTheDocument();
  });

  it("renders the site chrome when the path is unknown", () => {
    mockUsePathname.mockReturnValue(null);
    render(
      <ChromeGate>
        <footer>Site footer</footer>
      </ChromeGate>,
    );
    expect(screen.getByText("Site footer")).toBeInTheDocument();
  });
});
