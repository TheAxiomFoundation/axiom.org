import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SectionToc } from "./section-toc";
import type { SectionTocEntry } from "@/lib/axiom/section-page";

const ENTRIES: SectionTocEntry[] = [
  {
    anchor: "a",
    label: "(a) Allowance of credit",
    children: [{ anchor: "a-1", label: "(a)(1)", children: [] }],
  },
  { anchor: "b", label: "(b) Percentages", children: [] },
];

function placeSections(tops: Record<string, number>) {
  for (const [id, top] of Object.entries(tops)) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("section");
      el.id = id;
      document.body.appendChild(el);
    }
    el.getBoundingClientRect = () =>
      ({ top, bottom: top + 400, left: 0, right: 0, width: 0, height: 400, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  }
}

describe("SectionToc", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("lets Hebrew labels set their own base direction", () => {
    render(
      <SectionToc
        entries={[{ anchor: "a", label: "(א) שיעור המס", children: [] }]}
      />
    );
    expect(screen.getByText("(א) שיעור המס")).toHaveAttribute("dir", "auto");
  });

  it("takes one direction for the outline and nests from that side", () => {
    const { container } = render(<SectionToc entries={ENTRIES} />);
    const lists = container.querySelectorAll("ol");
    expect(lists[0]).toHaveAttribute("dir", "auto");
    // Nested lists inherit, and indent with a logical margin.
    expect(lists[1]).not.toHaveAttribute("dir");
    expect(lists[1].className).toContain("ms-3");
    expect(lists[1].className).not.toContain("ml-3");
  });

  it("renders nothing for empty entries", () => {
    const { container } = render(<SectionToc entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nested entries as anchor links", () => {
    placeSections({ a: 500, "a-1": 700, b: 900 });
    render(<SectionToc entries={ENTRIES} />);
    expect(screen.getByRole("navigation", { name: "On this page" })).toBeInTheDocument();
    expect(screen.getByText("(a) Allowance of credit")).toHaveAttribute(
      "href",
      "#a"
    );
    expect(screen.getByText("(a)(1)")).toHaveAttribute("href", "#a-1");
    expect(screen.getByText("(b) Percentages")).toHaveAttribute("href", "#b");
  });

  it("highlights the entry whose section is being read", async () => {
    placeSections({ a: 500, "a-1": 700, b: 900 });
    render(<SectionToc entries={ENTRIES} />);
    placeSections({ a: -100, "a-1": 300, b: 600 });
    act(() => {
      fireEvent.scroll(window);
    });
    await waitFor(() =>
      expect(screen.getByText("(a) Allowance of credit")).toHaveAttribute(
        "aria-current",
        "location"
      )
    );
    expect(screen.getByText("(b) Percentages")).not.toHaveAttribute(
      "aria-current"
    );
  });
});
