import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SectionReader } from "./section-reader";
import type { SectionPageData } from "@/lib/axiom/section-page";
import type { Rule } from "@/lib/supabase";
import { _resetRawFetchCache } from "@/lib/axiom/rulespec/raw-cache";

vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ push: vi.fn() }),
}));

const ROOT: Rule = {
  id: "root-1",
  jurisdiction: "us",
  doc_type: "statute",
  parent_id: null,
  level: 3,
  ordinal: 32,
  heading: "Earned income",
  body: "(a) Allowance of credit In general text.\n\n(b) Percentages table text.",
  effective_date: "2026-01-01",
  repeal_date: null,
  source_url: "https://uscode.house.gov/32",
  source_path: null,
  citation_path: "us/statute/26/32",
  rulespec_path: null,
  has_rulespec: true,
  created_at: "",
  updated_at: "",
};

function makeData(overrides: Partial<SectionPageData> = {}): SectionPageData {
  return {
    citationPath: "us/statute/26/32",
    root: ROOT,
    breadcrumbs: [
      { label: "Axiom", href: "/" },
      { label: "United States", href: "/us" },
      { label: "§ 32", href: "/us/statute/26/32" },
    ],
    provisions: [],
    intro: null,
    bodyChunks: [
      {
        anchor: "a",
        designator: "(a)",
        label: "(a) Allowance of credit",
        text: "(a) Allowance of credit In general text.",
        start: 0,
      },
      {
        anchor: "b",
        designator: "(b)",
        label: "(b) Percentages",
        text: "(b) Percentages table text.",
        start: 44,
      },
    ],
    toc: [
      { anchor: "a", label: "(a) Allowance of credit", children: [] },
      { anchor: "b", label: "(b) Percentages", children: [] },
    ],
    rootRefs: [],
    encoding: null,
    encodedRules: [
      // Both anchors: the rail scopes to the subsection under the
      // reading line, which jsdom resolves arbitrarily.
      { name: "eitc_phased_in", kind: "derived", anchors: ["a", "b"] },
    ],
    programs: [],
    ruleFiles: {},
    citedByFiles: [],
    citedByOverflow: 0,
    focusAnchor: null,
    prev: { citationPath: "us/statute/26/31", label: "§ 31" },
    next: { citationPath: "us/statute/26/33", label: "§ 33" },
    truncated: false,
    ...overrides,
  };
}

describe("SectionReader", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    // jsdom has no scrollIntoView; FocusScroll calls it via rAF.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
    document.body.innerHTML = "";
  });

  it("names a volunteer consolidation instead of calling it official", () => {
    const sourceUrl =
      "https://he.wikisource.org/wiki/%D7%A4%D7%A7%D7%95%D7%93%D7%AA_%D7%9E%D7%A1_%D7%94%D7%9B%D7%A0%D7%A1%D7%94";
    render(
      <SectionReader
        data={makeData({
          citationPath: "il/statute/income-tax-ordinance/section-121",
          root: {
            ...ROOT,
            jurisdiction: "il",
            citation_path: "il/statute/income-tax-ordinance/section-121",
            source_url: sourceUrl,
          },
        })}
      />
    );
    const link = screen.getByText("Open Law Book (Hebrew Wikisource)");
    expect(link).toHaveAttribute("href", sourceUrl);
    expect(link).toHaveAttribute(
      "title",
      expect.stringContaining("Reshumot")
    );
    expect(screen.queryByText("Official source")).not.toBeInTheDocument();
  });

  it("lets the heading set its own base direction", () => {
    render(
      <SectionReader
        data={makeData({ root: { ...ROOT, heading: "שיעור המס ליחיד" } })}
      />
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "dir",
      "auto"
    );
  });

  it("renders header, chunks, chips, TOC, and neighbors", () => {
    render(<SectionReader data={makeData()} />);
    expect(screen.getByText("Earned income")).toBeInTheDocument();
    // The citation path is implied by the breadcrumbs — no eyebrow.
    expect(screen.getByText("Official source")).toHaveAttribute(
      "href",
      "https://uscode.house.gov/32",
    );
    // The header action strip carries the verbs (graph/build/cite).
    const strip = screen.getByTestId("action-strip");
    // Encoded but no known rule file to link from: the strip says so
    // instead of showing dead verbs.
    expect(strip).toHaveTextContent("encoded — links pending mirror sync");
    expect(within(strip).getByTestId("strip-cite")).toBeInTheDocument();
    // Chunk sections with designator links into their own URLs.
    expect(screen.getByTitle("Open us/statute/26/32/a")).toHaveAttribute(
      "href",
      "/us/statute/26/32/a",
    );
    // The encoded layer leads the rail: the encodings block names
    // each rule and grounds it in the subsection it implements.
    const encodings = screen.getByTestId("rail-encodings");
    expect(within(encodings).getByText("eitc_phased_in")).toBeInTheDocument();
    expect(
      within(encodings).getByText(/§ 32 \(a\)\(b\) · derived/),
    ).toBeInTheDocument();
    // Prev/next.
    expect(screen.getByText(/§ 31/)).toHaveAttribute("rel", "prev");
    expect(screen.getByText(/§ 33/)).toHaveAttribute("rel", "next");
  });

  it("keeps section-and-below breadcrumbs in v2, ancestors in v1", () => {
    render(
      <SectionReader
        data={makeData({
          focusAnchor: "b",
          breadcrumbs: [
            { label: "Axiom", href: "/" },
            { label: "Title 26", href: "/us/statute/26" },
            { label: "§ 32", href: "/us/statute/26/32" },
            { label: "(b)", href: "/us/statute/26/32/b" },
          ],
        })}
      />,
    );
    const crumbs = within(
      screen.getByRole("navigation", { name: "Breadcrumb" }),
    );
    expect(crumbs.getByText("Title 26")).toHaveAttribute(
      "href",
      "/us/statute/26",
    );
    expect(crumbs.getByText("§ 32")).toHaveAttribute(
      "href",
      "/us/statute/26/32",
    );
    // Leaf crumb is the current page, not a link.
    expect(crumbs.getByText("(b)").tagName).toBe("SPAN");
  });

  it("highlights and scrolls to the focus anchor", () => {
    render(<SectionReader data={makeData({ focusAnchor: "b" })} />);
    const focused = document.getElementById("b");
    expect(focused?.className).toContain("shadow");
    const other = document.getElementById("a");
    expect(other?.className).not.toContain("shadow");
  });

  it("shows the action row only on the deep-linked subsection", () => {
    render(
      <SectionReader
        data={makeData({
          focusAnchor: "a",
          programs: [
            {
              jurisdiction: "us",
              programId: "us-eitc",
              mode: "compiled",
              status: "ready",
              ruleCount: 1,
              anchors: ["a"],
              ruleNames: ["eitc_phased_in"],
            },
          ],
          ruleFiles: { eitc_phased_in: "statutes/26/32/a.yaml" },
        })}
      />,
    );
    const rows = screen.getAllByTestId("subsection-actions");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Cite label is the formatted legal citation for the subsection.
    expect(
      within(row).getByText("cite · 26 U.S.C. § 32(a)"),
    ).toBeInTheDocument();
    // Graph opens the covering program focused on this subsection.
    const graph = within(row).getByText("graph ↗");
    const graphHref = new URL(graph.getAttribute("href")!, "http://app.test");
    expect(graphHref.searchParams.get("program")).toBe("us/us-eitc");
    expect(graphHref.searchParams.get("focus")).toBe("us:statutes/26/32/a");
    // Builder gets the subsection's encoded rule as the output.
    const builder = within(row).getByText("use in builder ↗");
    const builderHref = new URL(
      builder.getAttribute("href")!,
      "http://app.test",
    );
    // Section-level id: the builder scopes its output picker to the
    // provision and the user selects rules there.
    expect(builderHref.searchParams.get("output")).toBe("us:statutes/26/32");
    // The row belongs to (a); (b) has none.
    expect(row.closest("section")?.id).toBe("a");
  });

  it("omits graph and builder actions without coverage, keeping cite", () => {
    render(
      <SectionReader data={makeData({ focusAnchor: "b", encodedRules: [] })} />,
    );
    const row = screen.getByTestId("subsection-actions");
    expect(
      within(row).getByText("cite · 26 U.S.C. § 32(b)"),
    ).toBeInTheDocument();
    expect(within(row).queryByText("graph ↗")).not.toBeInTheDocument();
    expect(within(row).queryByText("use in builder ↗")).not.toBeInTheDocument();
  });

  it("gives corpus-row sections the same focus behavior as chunked ones", () => {
    render(
      <SectionReader
        data={makeData({
          bodyChunks: [],
          toc: [],
          provisions: [
            {
              rule: {
                ...ROOT,
                id: "p-d",
                heading: "Limitation",
                body: "(d) text",
                citation_path: "us/statute/26/32/d",
              },
              anchor: "d",
              designator: "(d)",
              relativeDepth: 1,
            },
            {
              rule: {
                ...ROOT,
                id: "p-d2",
                heading: null,
                body: "(2) nested",
                citation_path: "us/statute/26/32/d/2",
              },
              anchor: "d-2",
              designator: "(d)(2)",
              relativeDepth: 2,
            },
          ],
          focusAnchor: "d",
          encodedRules: [
            { name: "limit_rule", kind: "derived", anchors: ["d"] },
          ],
          programs: [
            {
              jurisdiction: "us",
              programId: "us-eitc",
              mode: "compiled",
              status: "ready",
              ruleCount: 1,
              anchors: ["d"],
              ruleNames: ["limit_rule"],
            },
          ],
          ruleFiles: { limit_rule: "statutes/26/32/d.yaml" },
        })}
      />,
    );
    // Focus highlight on the top-level provision.
    expect(document.getElementById("d")?.className).toContain("shadow");
    expect(document.getElementById("d-2")?.className).not.toContain("shadow");
    // Action row with the same verbs as chunked sections.
    const row = screen.getByTestId("subsection-actions");
    expect(
      within(row).getByText("cite · 26 U.S.C. § 32(d)"),
    ).toBeInTheDocument();
    expect(within(row).getByText("graph ↗")).toBeInTheDocument();
    const builder = within(row).getByText("use in builder ↗");
    expect(
      new URL(
        builder.getAttribute("href")!,
        "http://app.test",
      ).searchParams.get("output"),
    ).toBe("us:statutes/26/32");
    // A real subsection URL on the designator; rule-name chips no
    // longer sit in the reading flow.
    expect(screen.getByTitle("Open us/statute/26/32/d")).toHaveAttribute(
      "href",
      "/us/statute/26/32/d",
    );
  });

  it("renders intro text and the truncation notice", () => {
    render(
      <SectionReader
        data={makeData({
          intro: "General chapeau text.",
          truncated: true,
          prev: null,
          next: null,
        })}
      />,
    );
    expect(screen.getByText(/General chapeau text/)).toBeInTheDocument();
    expect(screen.getByText(/unusually large/)).toBeInTheDocument();
  });

  it("renders provision rows when the corpus has descendant rows", () => {
    render(
      <SectionReader
        data={makeData({
          bodyChunks: [],
          provisions: [
            {
              rule: {
                ...ROOT,
                id: "child-1",
                heading: "In general",
                body: "Child body text.",
                citation_path: "us/statute/26/32/a",
              },
              anchor: "a",
              designator: "(a)",
              relativeDepth: 1,
            },
            {
              rule: {
                ...ROOT,
                id: "child-2",
                heading: null,
                body: null,
                citation_path: "us/statute/26/32/a/1",
              },
              anchor: "a-1",
              designator: "(a)(1)",
              relativeDepth: 2,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("In general")).toBeInTheDocument();
    expect(screen.getByText("Child body text.")).toBeInTheDocument();
    expect(document.getElementById("a-1")).not.toBeNull();
  });
});
