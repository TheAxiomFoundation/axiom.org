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
    page: 0,
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
              nodeType: "doc_type",
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

  it("lets Hebrew headings and row labels set their own direction", () => {
    const title = "פקודת מס הכנסה [נוסח חדש]";
    render(
      <BrowseView
        data={makeData({
          segments: ["il", "statute"],
          page: 0,
          jurisdictionLabel: "Israel",
          currentRule: null,
          breadcrumbs: [
            { label: "Axiom", href: "/" },
            { label: "Israel", href: "/il" },
            { label: "Statutes", href: "/il/statute" },
          ],
          nodes: [
            {
              segment: "income-tax-ordinance",
              label: title,
              hasChildren: true,
              nodeType: "title",
            },
          ],
        })}
      />
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "dir",
      "auto"
    );
    expect(screen.getByText(title)).toHaveAttribute("dir", "auto");
  });

  const entry = (
    citationPath: string,
    group: string,
    heading: string | null = null,
    groupHeading: string | null = null
  ) => ({ citationPath, heading, group, groupHeading });

  it("lists a small jurisdiction's encodings on its root", () => {
    const ito = "il/statute/income-tax-ordinance";
    const itoHeading = "פקודת מס הכנסה [נוסח חדש]";
    render(
      <BrowseView
        data={makeData({
          segments: ["il"],
          jurisdictionLabel: "Israel",
          breadcrumbs: [{ label: "Axiom", href: "/" }],
          encodedEntries: [
            entry(
              "il/statute/composed/worker-with-children-net",
              "il/statute/composed"
            ),
            entry(`${ito}/section-36a`, ito, null, itoHeading),
            entry(`${ito}/section-121`, ito, "שיעור המס ליחיד", itoHeading),
          ],
        })}
      />
    );
    const list = screen.getByTestId("encoded-list");
    expect(list).toHaveTextContent("Encoded so far · 3");
    // Grouped under the instrument's own heading; a group the corpus
    // has no row for falls back to a plain name.
    expect(screen.getByText(itoHeading)).toHaveAttribute("dir", "auto");
    expect(screen.getByText("Composed pipelines")).toBeInTheDocument();
    // Each row links straight to the provision.
    const row = screen.getByText("שיעור המס ליחיד");
    expect(row).toHaveAttribute("dir", "auto");
    expect(row.closest("a")).toHaveAttribute("href", `/${ito}/section-121`);
    expect(screen.getByText("§ 121")).toBeInTheDocument();
    // A keyed row with no heading says its key once, not "Section 36a" too.
    const bare = screen.getByText("§ 36a").closest("a");
    expect(bare).toHaveAttribute("href", `/${ito}/section-36a`);
    expect(bare).toHaveTextContent(/^§ 36a$/);
    // No heading and no key: the slug, made readable.
    expect(
      screen.getByText("Worker with children net").closest("a")
    ).toHaveAttribute("href", "/il/statute/composed/worker-with-children-net");
  });

  it("keeps two doc types with the same title segment in separate groups", () => {
    render(
      <BrowseView
        data={makeData({
          segments: ["us-xx"],
          encodedEntries: [
            entry("us-xx/regulation/26/1", "us-xx/regulation/26"),
            entry("us-xx/statute/26/32", "us-xx/statute/26"),
            // Out of order on purpose: grouping is keyed, not adjacent.
            entry("us-xx/regulation/26/2", "us-xx/regulation/26"),
          ],
        })}
      />
    );
    const groups = screen.getAllByTestId("encoded-group");
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelectorAll("li")).toHaveLength(2);
    expect(groups[1].querySelectorAll("li")).toHaveLength(1);
    // Each group carries its doc type, and a bare-number volume reads
    // "Title 26", the name the finding list gives it on the same site.
    expect(groups[0]).toHaveTextContent(/^regulationTitle 26/);
    expect(groups[1]).toHaveTextContent(/^statuteTitle 26/);
    expect(screen.getByText("§ 32").closest("a")).toHaveAttribute(
      "href",
      "/us-xx/statute/26/32"
    );
  });

  it("cites UK and Canadian paths the way a reader would", () => {
    const ucr = "uk/legislation/uksi/2013/376";
    render(
      <BrowseView
        data={makeData({
          segments: ["uk"],
          encodedEntries: [
            // Grouped at the instrument: "regulation" introduces the number.
            entry(
              `${ucr}/regulation/22/1/b/i`,
              ucr,
              null,
              "The Universal Credit Regulations 2013"
            ),
            entry(
              "uk/legislation/ukpga/2002/16/section/3ZA/3",
              "uk/legislation/ukpga/2002/16",
              null,
              "Tax Credits Act 2002"
            ),
            // No headed ancestor, so the tail leads with a year. A year
            // is not a section number, and the row is not named "I".
            entry(
              "uk/legislation/uksi/2006/213/regulation/4/b/i",
              "uk/legislation/uksi"
            ),
            entry(
              "ca/statute/rsc-1985/c-1-5th-supp/3/1",
              "ca/statute/rsc-1985"
            ),
          ],
        })}
      />
    );
    expect(screen.getByText("reg. 22(1)(b)(i)")).toBeInTheDocument();
    expect(screen.getByText("§ 3ZA(3)")).toBeInTheDocument();
    expect(screen.queryByText(/§ 20\d\d/)).not.toBeInTheDocument();
    expect(screen.queryByText("I")).not.toBeInTheDocument();
    expect(screen.getByText("2006/213/regulation/4/b/i")).toBeInTheDocument();
    expect(screen.getByText("c-1-5th-supp/3/1")).toBeInTheDocument();
    expect(screen.getByText("UKSI")).toBeInTheDocument();
  });

  it("names rows and groups from real path shapes when the corpus has no heading", () => {
    const at = (citationPath: string) =>
      entry(citationPath, citationPath.split("/").slice(0, 3).join("/"));
    render(
      <BrowseView
        data={makeData({
          segments: ["us-xx"],
          encodedEntries: [
            at("us-xx/policy/cms/chip-eligibility"),
            at("us-xx/policy/dss/4005-10"),
            at("us-xx/statute/income-tax/2026_resident_zero_liability"),
            at("us-xx/regulation/54/54.403/a"),
            at("nz/statute/income-tax-act-2007/CD-1"),
            // Shallow enough to group under its doc type.
            entry("de/statute/bgb", "de/statute"),
          ],
        })}
      />
    );
    // Acronym-length groups read as initialisms; longer ones as words.
    expect(screen.getByText("CMS")).toBeInTheDocument();
    expect(screen.getByText("DSS")).toBeInTheDocument();
    expect(screen.getByText("Income tax")).toBeInTheDocument();
    // The source's own notation stays as written.
    expect(screen.getByText("4005-10")).toBeInTheDocument();
    expect(screen.getByText("CD-1")).toBeInTheDocument();
    // A prose slug that starts with a digit is not a section number.
    expect(screen.getByText("2026 resident zero liability")).toBeInTheDocument();
    expect(screen.queryByText(/§ 2026/)).not.toBeInTheDocument();
    // A real section number with a subsection, in a column that grows
    // to fit it instead of overflowing a fixed width.
    const key = screen.getByText("§ 54.403(a)");
    expect(key.className).toContain("min-w-16");
    expect(key.className).toContain("whitespace-nowrap");
    expect(key.className).not.toMatch(/(^| )w-16( |$)/);
    // A doc-type group is named once: no eyebrow repeating it.
    const docTypeGroup = screen.getByText("Statute").closest("div");
    expect(docTypeGroup?.querySelector("p")).toBeNull();
    // A lone short token reads as an initialism, not "Bgb".
    expect(screen.getByText("BGB")).toBeInTheDocument();
  });

  it("shows no encoded list below the root, even when handed entries", () => {
    render(
      <BrowseView
        data={makeData({
          encodedEntries: [entry("us/statute/26/32", "us/statute/26")],
        })}
      />
    );
    expect(screen.queryByTestId("encoded-list")).not.toBeInTheDocument();
  });

  it("shows no encoded list on a root with no entries", () => {
    render(<BrowseView data={makeData({ segments: ["us"] })} />);
    expect(screen.queryByTestId("encoded-list")).not.toBeInTheDocument();
  });

  it("adds no source credit where the publisher is official", () => {
    render(<BrowseView data={makeData()} />);
    expect(screen.queryByTestId("source-credit")).not.toBeInTheDocument();
  });

  it("shows the empty state", () => {
    render(<BrowseView data={makeData({ nodes: [], hasMore: false })} />);
    expect(
      screen.getByText("Nothing has been ingested at this level yet.")
    ).toBeInTheDocument();
  });
});
