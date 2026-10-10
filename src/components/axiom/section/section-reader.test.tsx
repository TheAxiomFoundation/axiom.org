import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SectionReader } from "./section-reader";
import {
  declaredExternalComparisons,
  type DeclaredExternalComparisons,
  type SectionPageData,
} from "@/lib/axiom/section-page";
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
    encodedCoverage: null,
    externalComparisons: null,
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

  it("isolates Hebrew neighbor labels so the arrows keep their side", () => {
    render(
      <SectionReader
        data={makeData({
          prev: { citationPath: "il/statute/ito/section-120b", label: "הצמדה" },
          next: {
            citationPath: "il/statute/ito/section-121b",
            label: "מס נוסף על הכנסות גבוהות",
          },
        })}
      />
    );
    const prev = screen.getByText("הצמדה");
    expect(prev.tagName).toBe("BDI");
    expect(prev.closest("a")).toHaveAttribute(
      "href",
      "/il/statute/ito/section-120b"
    );
    expect(screen.getByText("מס נוסף על הכנסות גבוהות").tagName).toBe("BDI");
  });

  it("sets a chunk heading's direction on the row, not the label", () => {
    render(<SectionReader data={makeData()} />);
    const row = screen.getByTitle("Open us/statute/26/32/a").closest("h2");
    // Decided by the chunk's own text, so a numeric designator cannot
    // leave a Hebrew chunk's row left-to-right.
    expect(row).toHaveAttribute("dir", "ltr");
    // The label inherits, so designator and label stay adjacent.
    expect(row?.querySelector("span")).not.toHaveAttribute("dir");
  });

  it("gives a Hebrew chunk with a numeric designator a right-to-left row", () => {
    render(
      <SectionReader
        data={makeData({
          bodyChunks: [
            {
              anchor: "1",
              designator: "(1)",
              label: "(1)",
              text: "(1) על כל שקל חדש מ־301,200 השקלים החדשים הראשונים – 31%;",
              start: 0,
            },
          ],
          toc: [{ anchor: "1", label: "(1)", children: [] }],
          encodedRules: [],
        })}
      />
    );
    expect(
      screen.getByTitle("Open us/statute/26/32/1").closest("h2")
    ).toHaveAttribute("dir", "rtl");
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
    // The label sits in a <bdi> inside the link.
    expect(screen.getByText(/§ 31/).closest("a")).toHaveAttribute("rel", "prev");
    expect(screen.getByText(/§ 33/).closest("a")).toHaveAttribute("rel", "next");
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

  describe("external comparison chip", () => {
    /** The chip's visible label excludes its screen-reader description. */
    function visibleLabel(chip: HTMLElement): string {
      return Array.from(chip.childNodes)
        .filter(
          (node) =>
            !(node instanceof HTMLElement && node.classList.contains("sr-only")),
        )
        .map((node) => node.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const NO_RESULT = { match: 0, known_difference: 0, diff: 0, errored: 0, none: 1 };
    type EngineEntry = DeclaredExternalComparisons["engines"][number];
    function engineEntry(overrides: Partial<EngineEntry> = {}): EngineEntry {
      return {
        engine: "policyengine",
        caseCount: 1,
        caseDescriptions: ["Colorado SNAP canonical two-person household."],
        matchingCaseCount: 0,
        matchingAsOf: null,
        matchingEngineVersions: [],
        resultCounts: NO_RESULT,
        ...overrides,
      };
    }
    const coSnap = (engine: Partial<EngineEntry> = {}) => ({
      programId: "co-snap",
      jurisdiction: "us-co",
      engines: [engineEntry(engine)],
    });

    // Invariant (d1020): the chip appears iff every declared case's
    // latest comparison result matches and is fresh: observed at most
    // 7 days ago and at most 5 minutes (clock skew) ahead of now.
    it("hides a declared comparison with no published result", () => {
      const { container } = render(
        <SectionReader data={makeData({ externalComparisons: coSnap() })} />,
      );
      expect(container.innerHTML).not.toMatch(/PolicyEngine|verified|agrees with/i);
      expect(container.innerHTML).not.toContain("⊨");
    });

    it.each(["known_difference", "diff", "errored"] as const)(
      "hides a latest %s result without a neutral comparison chip",
      (status) => {
        const { container } = render(
          <SectionReader
            data={makeData({
              externalComparisons: coSnap({
                resultCounts: { ...NO_RESULT, [status]: 1, none: 0 },
              }),
            })}
          />,
        );
        expect(container.innerHTML).not.toMatch(/PolicyEngine|matches/i);
      },
    );

    it("hides partial matches when any case has a known difference", () => {
      const { container } = render(
        <SectionReader
          data={makeData({
            externalComparisons: coSnap({
              caseCount: 2,
              caseDescriptions: ["Household A.", "Household B"],
              matchingCaseCount: 1,
              matchingAsOf: "2026-10-03T12:41:07.512Z",
              matchingEngineVersions: ["2.9.0"],
              resultCounts: { match: 1, known_difference: 1, diff: 0, errored: 0, none: 0 },
            }),
          })}
        />,
      );
      expect(container.innerHTML).not.toMatch(/PolicyEngine|matches/i);
    });

    it("hides matching results older than seven days", () => {
      const externalComparisons = declaredExternalComparisons(
        [{ programId: "co-snap", jurisdiction: "us-co" }],
        [{
          id: "co-snap-current",
          description: "Colorado SNAP canonical two-person household.",
          program_id: "co-snap",
          jurisdiction: "us-co",
          comparisonEngines: ["policyengine"],
          comparisonResults: [{
            engine: "policyengine",
            status: "match",
            observedAt: "2026-10-01T11:59:59.999Z",
            engineVersion: "2.9.0",
          }],
        }],
        new Date("2026-10-08T12:00:00.000Z"),
      );
      const { container } = render(
        <SectionReader data={makeData({ externalComparisons })} />,
      );
      expect(container.innerHTML).not.toMatch(/PolicyEngine|matches/i);
    });

    const NOW = new Date("2026-10-08T12:00:00.000Z");
    const SEVEN_DAYS = 7 * 86_400_000;
    const FIVE_MINUTES = 5 * 60_000;
    /** One case whose only PolicyEngine result is a match observed then. */
    const matchObserved = (observedAt: string) =>
      declaredExternalComparisons(
        [{ programId: "co-snap", jurisdiction: "us-co" }],
        [{
          id: "co-snap-current",
          description: "Colorado SNAP canonical two-person household.",
          program_id: "co-snap",
          jurisdiction: "us-co",
          comparisonEngines: ["policyengine"],
          comparisonResults: [{
            engine: "policyengine",
            status: "match",
            observedAt,
            engineVersion: "2.9.0",
          }],
        }],
        NOW,
      );

    it("hides a matching result dated in the future", () => {
      // The probe from the review of #299: a match dated 2099 showed the chip.
      const { container } = render(
        <SectionReader
          data={makeData({ externalComparisons: matchObserved("2099-10-08T00:00:00.000Z") })}
        />,
      );
      expect(container.innerHTML).not.toMatch(/PolicyEngine|matches/i);
    });

    it("hides a matching result whose timestamp names no UTC offset", () => {
      // Half an hour old if read as UTC, but Date.parse reads it in the
      // server's timezone, so it never counts.
      const { container } = render(
        <SectionReader
          data={makeData({ externalComparisons: matchObserved("2026-10-08T11:30:00") })}
        />,
      );
      expect(container.innerHTML).not.toMatch(/PolicyEngine|matches/i);
    });

    it.each([
      { when: "exactly seven days old", offsetMs: -SEVEN_DAYS, shown: true },
      { when: "one millisecond older than seven days", offsetMs: -SEVEN_DAYS - 1, shown: false },
      { when: "exactly at the clock-skew tolerance", offsetMs: FIVE_MINUTES, shown: true },
      { when: "one millisecond past the clock-skew tolerance", offsetMs: FIVE_MINUTES + 1, shown: false },
    ])("a match $when shows the chip: $shown", ({ offsetMs, shown }) => {
      const { container } = render(
        <SectionReader
          data={makeData({
            externalComparisons: matchObserved(
              new Date(NOW.getTime() + offsetMs).toISOString(),
            ),
          })}
        />,
      );
      if (shown) {
        const chip = screen.getByText(/Matches PolicyEngine/);
        expect(visibleLabel(chip)).toMatch(/^Matches PolicyEngine 1 of 1 case · /);
      } else {
        expect(container.innerHTML).not.toMatch(/PolicyEngine|matches/i);
      }
    });

    it("never renders the neutral PolicyEngine comparison text", () => {
      const { container } = render(
        <SectionReader data={makeData({ externalComparisons: coSnap() })} />,
      );
      expect(container.innerHTML).not.toContain("PolicyEngine comparison");
    });

    it("says Matches when all latest cases match, with N of M and the oldest observation date", () => {
      const { container } = render(
        <SectionReader
          data={makeData({
            externalComparisons: coSnap({
              caseCount: 2,
              caseDescriptions: ["Household A.", "Household B"],
              matchingCaseCount: 2,
              matchingAsOf: "2026-10-03T12:41:07.512Z",
              matchingEngineVersions: ["2.9.0"],
              resultCounts: { match: 2, known_difference: 0, diff: 0, errored: 0, none: 0 },
            }),
          })}
        />,
      );
      const chip = screen.getByText(/Matches PolicyEngine/);
      expect(visibleLabel(chip)).toBe("Matches PolicyEngine 2 of 2 cases · Oct 3, 2026");
      const description =
        "2 test cases for co-snap (us-co) declare a comparison with " +
        "PolicyEngine (Household A; Household B). In the latest published results, " +
        "as of Oct 3, 2026, 2 of 2 match PolicyEngine on every compared " +
        "output, within each comparison's tolerance (PolicyEngine model " +
        "version 2.9.0). Max Ghenis is CEO of both Axiom and PolicyEngine.";
      expect(chip).toHaveAttribute("title", description);
      // Disclosure must be accessible without relying on a hover tooltip.
      expect(within(chip).getByText(description)).toHaveClass("sr-only");
      expect(chip.querySelector("svg")).toBeNull();
      expect(chip.className).toContain("border-[var(--color-rule)]");
      expect(chip.className).not.toMatch(/success|22,101,52/);
      expect(container.innerHTML).not.toMatch(/verified/i);
      expect(container.innerHTML).not.toContain("PolicyEngine comparison");
    });

    it("reads a single fully matching case in the singular", () => {
      render(
        <SectionReader
          data={makeData({
            externalComparisons: coSnap({
              matchingCaseCount: 1,
              matchingAsOf: "2026-10-03T12:41:07.512Z",
              resultCounts: { ...NO_RESULT, match: 1, none: 0 },
            }),
          })}
        />,
      );
      const chip = screen.getByText(/Matches PolicyEngine/);
      expect(visibleLabel(chip)).toBe("Matches PolicyEngine 1 of 1 case · Oct 3, 2026");
      expect(chip.getAttribute("title")).toContain(
        "In the latest published results, as of Oct 3, 2026, 1 of 1 case matches PolicyEngine on every compared output, within each comparison's tolerance.",
      );
    });

    it("labels an engine named like an Object prototype key literally", () => {
      render(
        <SectionReader
          data={makeData({
            externalComparisons: {
              programId: "snap",
              jurisdiction: "us-ca",
              engines: [engineEntry({
                engine: "constructor",
                caseDescriptions: [],
                matchingCaseCount: 1,
                matchingAsOf: "2026-10-03T12:41:07.512Z",
                resultCounts: { ...NO_RESULT, match: 1, none: 0 },
              })],
            },
          })}
        />,
      );
      const chip = screen.getByText(/Matches constructor/);
      expect(chip.getAttribute("title")).not.toContain("native code");
    });

    it("shows no comparison chip when no covering program declares one", () => {
      const { container } = render(
        <SectionReader data={makeData({ externalComparisons: null })} />,
      );
      expect(screen.queryByText(/comparison/i)).not.toBeInTheDocument();
      expect(container.innerHTML).not.toMatch(/PolicyEngine|verified/i);
    });

    it("gives each fully matching engine its own chip and case count", () => {
      render(
        <SectionReader
          data={makeData({
            externalComparisons: {
              programId: "snap",
              jurisdiction: "us-ca",
              engines: [
                engineEntry({
                  caseCount: 2,
                  caseDescriptions: ["Household A.", "Household B"],
                  matchingCaseCount: 2,
                  matchingAsOf: "2026-10-03T12:41:07.512Z",
                  resultCounts: { ...NO_RESULT, match: 2, none: 0 },
                }),
                engineEntry({
                  engine: "ukmod",
                  caseDescriptions: [],
                  matchingCaseCount: 1,
                  matchingAsOf: "2026-10-03T12:41:07.512Z",
                  resultCounts: { ...NO_RESULT, match: 1, none: 0 },
                }),
              ],
            },
          })}
        />,
      );
      const policyengine = screen.getByText(/Matches PolicyEngine/);
      expect(visibleLabel(policyengine)).toBe("Matches PolicyEngine 2 of 2 cases · Oct 3, 2026");
      expect(policyengine.getAttribute("title")).toMatch(
        /^2 test cases for snap \(us-ca\) declare a comparison with PolicyEngine \(Household A; Household B\)\./,
      );
      const ukmod = screen.getByText(/Matches UKMOD/);
      expect(visibleLabel(ukmod)).toBe("Matches UKMOD 1 of 1 case · Oct 3, 2026");
      expect(ukmod).toHaveAttribute(
        "title",
        "1 test case for snap (us-ca) declares a comparison with UKMOD. " +
          "In the latest published results, as of Oct 3, 2026, 1 of 1 case " +
          "matches UKMOD on every compared output, within each comparison's tolerance.",
      );
    });
  });

  describe("external comparisons without published results", () => {
    // 7 USC 2014 and 7 CFR 273.10 are covered by co-snap (us-co), whose
    // parity case co-snap-us-co-family-1 declares a PolicyEngine
    // comparison. The trust row used to show a green "Verified ·
    // PolicyEngine" chip for it. Without published results, it still
    // shows no comparison chip (Max, d875: "approve, but hide"; d1020).
    const coSnap = {
      jurisdiction: "us-co",
      programId: "co-snap",
      mode: "compiled" as const,
      status: "ready" as const,
      ruleCount: 1,
      anchors: ["a"],
      ruleNames: ["snap_benefit_amount"],
    };

    it.each([
      ["us/statute/7/2014", "Eligible households"],
      ["us/regulation/7/273/10", "Determining household eligibility and benefit levels"],
    ])("shows only the rule and coverage chips on %s", (citationPath, heading) => {
      const { container } = render(
        <SectionReader
          data={makeData({
            citationPath,
            root: { ...ROOT, citation_path: citationPath, heading },
            encodedRules: [
              { name: "snap_benefit_amount", kind: "derived", anchors: ["a", "b"] },
            ],
            programs: [coSnap],
            externalComparisons: null,
          })}
        />,
      );
      const row = screen.getByText("∀").parentElement!.parentElement!;
      expect(Array.from(row.children, (chip) => chip.textContent)).toEqual([
        "∀1 rule",
        "All 2 subsections",
      ]);
      // Markup and attributes both: the old claim lived in a title.
      expect(container.innerHTML).not.toMatch(/PolicyEngine/);
      expect(container.innerHTML).not.toMatch(/verified|agrees with|comparison/i);
      expect(container.innerHTML).not.toContain("⊨");
    });
  });
});
