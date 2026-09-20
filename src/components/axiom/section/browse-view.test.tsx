import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BrowseView } from "./browse-view";
import type { BrowsePageData } from "@/lib/axiom/browse-page";

function makeData(overrides: Partial<BrowsePageData> = {}): BrowsePageData {
  return {
    segments: ["us", "statute"],
    jurisdictionLabel: "US Federal",
    breadcrumbs: [
      { label: "Axiom", href: "/" },
      { label: "US Federal", href: "/us" },
      { label: "Statute", href: "/us/statute" },
    ],
    currentRule: null,
    nodes: [
      {
        segment: "7",
        label: "Title 7 — Agriculture",
        hasChildren: true,
        childCount: 12,
        nodeType: "title",
        hasRuleSpec: true,
      },
      {
        segment: "26",
        label: "Title 26 — Internal Revenue Code",
        hasChildren: true,
        nodeType: "title",
      },
    ],
    encodedCounts: {},
    hasMore: false,
    ...overrides,
  };
}

describe("BrowseView", () => {
  it("renders children as bare-path links with badges", () => {
    render(<BrowseView data={makeData()} />);
    expect(
      screen.getByText("Title 7 — Agriculture").closest("a")
    ).toHaveAttribute("href", "/us/statute/7");
    // No child-count column; encoded badge remains.
    expect(screen.queryByText("12")).not.toBeInTheDocument();
    expect(screen.getByTitle("Has RuleSpec encodings")).toBeInTheDocument();
    // Breadcrumb shows ancestors only (as links); the eyebrow repeats
    // the parent context; the current level is the H1, not a crumb.
    const crumbLink = screen
      .getAllByText("US Federal")
      .map((el) => el.closest("a"))
      .find(Boolean);
    expect(crumbLink).toHaveAttribute("href", "/us");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Statute"
    );
  });

  it("credits the Open Law Book on Israel browse pages", () => {
    render(
      <BrowseView
        data={makeData({
          segments: ["il"],
          page: 0,
          jurisdictionLabel: "Israel",
          breadcrumbs: [{ label: "Axiom", href: "/" }],
          nodes: [
            {
              segment: "statute",
              label: "Statutes",
              hasChildren: true,
              childCount: 2,
              nodeType: "container",
            },
          ],
        })}
      />
    );
    // One child reads "1 collection", not "1 collections".
    expect(screen.getByText(/^1 collection$/)).toBeInTheDocument();
    const credit = screen.getByTestId("source-credit");
    expect(credit).toHaveTextContent("ספר החוקים הפתוח");
    expect(credit).toHaveTextContent("Reshumot");
    expect(screen.getByRole("link", { name: "Open Law Book" })).toHaveAttribute(
      "href",
      "https://he.wikisource.org/wiki/ספר_החוקים_הפתוח"
    );
    expect(screen.getByRole("link", { name: "Hasadna" })).toHaveAttribute(
      "href",
      "https://www.hasadna.org.il/openlaw/"
    );
  });

  it("adds no source credit where the publisher is official", () => {
    render(<BrowseView data={makeData()} />);
    expect(screen.queryByTestId("source-credit")).not.toBeInTheDocument();
  });

  it("shows the empty state and the has-more note", () => {
    render(<BrowseView data={makeData({ nodes: [], hasMore: false })} />);
    expect(
      screen.getByText("Nothing has been ingested at this level yet.")
    ).toBeInTheDocument();
  });
});
