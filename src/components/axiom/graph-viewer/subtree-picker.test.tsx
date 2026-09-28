import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SubtreeDoors, SubtreeSearch } from "./subtree-picker";
import { humanizeCitation } from "./citations";
import type { CorpusModule } from "@/lib/axiom/corpus-field";

function module(overrides: Partial<CorpusModule>): CorpusModule {
  return {
    target: "us:statutes/7/2014",
    jurisdiction: "us",
    bucket: "statutes",
    ruleCount: 5,
    linkedRuleCount: 5,
    importCount: 0,
    imports: [],
    ...overrides,
  };
}

const MODULES: CorpusModule[] = [
  module({ target: "us:regulations/7-cfr/273/10", bucket: "regulations", ruleCount: 40, linkedRuleCount: 40 }),
  module({ target: "us:statutes/7/2014/e/6/A", ruleCount: 22, linkedRuleCount: 22, importCount: 3 }),
  module({ target: "us-ny:regulations/18-nycrr/387/14", jurisdiction: "us-ny", bucket: "regulations", ruleCount: 19, linkedRuleCount: 19 }),
  module({ target: "us-fl:policies/dcf/ess-program-policy-manual/appendix-a-1", jurisdiction: "us-fl", bucket: "policies", ruleCount: 13, linkedRuleCount: 13 }),
];

describe("SubtreeDoors", () => {
  it("offers the computed doors — citations, never program cards", () => {
    const onPick = vi.fn();
    render(<SubtreeDoors modules={MODULES} onPick={onPick} />);
    const doors = screen.getAllByTestId("picker-door");
    expect(doors).toHaveLength(MODULES.length);
    expect(
      doors.some((el) =>
        el.textContent?.includes(
          humanizeCitation("us:regulations/7-cfr/273/10")
        )
      )
    ).toBe(true);
    expect(document.querySelector(".plane-launcher-card")).toBeNull();
    expect(document.querySelector(".constellation-summit")).toBeNull();
    fireEvent.click(doors[0]!);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(MODULES.map((m) => m.target)).toContain(
      onPick.mock.calls[0]![0]
    );
  });

  it("doors lead with the humanized headline rule when the census names one", () => {
    render(
      <SubtreeDoors
        modules={[
          module({
            target: "us:statutes/26/32",
            ruleCount: 24,
            linkedRuleCount: 23,
            headlineRule: "eitc",
          }),
        ]}
        onPick={vi.fn()}
      />
    );
    const door = screen.getByTestId("picker-door");
    expect(door.querySelector("strong")?.textContent).toBe("EITC");
    // The citation demotes to the door's subtitle line.
    expect(door.textContent).toContain("26 USC § 32");
  });

  it("renders the COMPLETE corpus list beneath the doors, humanized", () => {
    const onPick = vi.fn();
    render(<SubtreeDoors modules={MODULES} onPick={onPick} />);
    const list = screen.getByTestId("picker-list");
    // Every module the field shows is a row (jsdom has no
    // IntersectionObserver — the slab window opens fully).
    expect(list.getAttribute("data-list-total")).toBe(
      String(MODULES.length)
    );
    const rows = screen.getAllByTestId("picker-list-row");
    expect(rows).toHaveLength(MODULES.length);
    // No raw slugs: the Florida policy manual row reads humanized.
    const florida = rows.find((el) =>
      el.textContent?.includes("Florida")
    )!;
    expect(florida.textContent).not.toContain("policies/");
    // Meta line: the same fields the doors show.
    expect(
      rows.some((el) => el.textContent?.includes("40 rules · regulations"))
    ).toBe(true);
    // Clicking a row enters that subtree exactly like a door click.
    fireEvent.click(rows[0]!);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(MODULES.map((m) => m.target)).toContain(
      onPick.mock.calls[0]![0]
    );
  });

  it("the shared query filters the full list live; doors stay put", () => {
    render(
      <SubtreeDoors modules={MODULES} onPick={vi.fn()} query="273.10" />
    );
    const rows = screen.getAllByTestId("picker-list-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("7 CFR § 273.10");
    // The featured band is unaffected by the filter.
    expect(screen.getAllByTestId("picker-door")).toHaveLength(
      MODULES.length
    );
    expect(
      screen.getByTestId("picker-list").getAttribute("data-list-total")
    ).toBe("1");
  });

  it("says so when the query matches nothing in the list", () => {
    render(
      <SubtreeDoors modules={MODULES} onPick={vi.fn()} query="zzz-nope" />
    );
    expect(screen.queryAllByTestId("picker-list-row")).toHaveLength(0);
    expect(screen.getByText(/No provision matches/i)).toBeInTheDocument();
  });

  it("the jurisdiction scope cuts the list AND the doors band", () => {
    const { rerender } = render(
      <SubtreeDoors modules={MODULES} onPick={vi.fn()} scope="states" />
    );
    // MODULES: two federal, one us-ny, one us-fl.
    let rows = screen.getAllByTestId("picker-list-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute("data-jurisdiction")).toMatch(/^us-/);
    }
    expect(screen.getAllByTestId("picker-door")).toHaveLength(2);
    rerender(
      <SubtreeDoors modules={MODULES} onPick={vi.fn()} scope="nationwide" />
    );
    rows = screen.getAllByTestId("picker-list-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute("data-jurisdiction")).toBe("us");
    }
    expect(
      screen.getByTestId("picker-list").getAttribute("data-list-total")
    ).toBe("2");
  });

  it("scope composes with the query", () => {
    render(
      <SubtreeDoors
        modules={MODULES}
        onPick={vi.fn()}
        query="273.10"
        scope="states"
      />
    );
    // 273.10 is federal — out of scope, so the list is honest-empty.
    expect(screen.queryAllByTestId("picker-list-row")).toHaveLength(0);
    expect(screen.getByText(/No provision matches/i)).toBeInTheDocument();
  });

  it("one state narrows the list AND the doors under the States scope", () => {
    render(
      <SubtreeDoors
        modules={MODULES}
        onPick={vi.fn()}
        scope="states"
        state="us-ny"
      />
    );
    const rows = screen.getAllByTestId("picker-list-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-jurisdiction")).toBe("us-ny");
    const doors = screen.getAllByTestId("picker-door");
    expect(doors).toHaveLength(1);
    expect(doors[0]!.textContent).toContain("US-NY");
  });
});

describe("SubtreeSearch", () => {
  it("matches against the humanized citation and picks on click", () => {
    const onPick = vi.fn();
    render(<SubtreeSearch modules={MODULES} onPick={onPick} />);
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "273.10" },
    });
    const results = screen.getAllByTestId("picker-result");
    expect(results).toHaveLength(1);
    expect(results[0]!.textContent).toContain("7 CFR § 273.10");
    fireEvent.click(results[0]!);
    expect(onPick).toHaveBeenCalledWith("us:regulations/7-cfr/273/10");
  });

  it("matches against the raw target string too", () => {
    const onPick = vi.fn();
    render(<SubtreeSearch modules={MODULES} onPick={onPick} />);
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "ess-program appendix" },
    });
    const results = screen.getAllByTestId("picker-result");
    expect(results).toHaveLength(1);
    fireEvent.click(results[0]!);
    expect(onPick).toHaveBeenCalledWith(
      "us-fl:policies/dcf/ess-program-policy-manual/appendix-a-1"
    );
  });

  it("every query word must match, any order", () => {
    render(<SubtreeSearch modules={MODULES} onPick={vi.fn()} />);
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "2014 usc 7" },
    });
    const results = screen.getAllByTestId("picker-result");
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      expect(result.textContent).toContain("7 USC § 2014");
    }
  });

  it("says so when nothing matches", () => {
    render(<SubtreeSearch modules={MODULES} onPick={vi.fn()} />);
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "zzz-nothing" },
    });
    expect(screen.queryAllByTestId("picker-result")).toHaveLength(0);
    expect(screen.getByText(/No provision matches/i)).toBeInTheDocument();
  });

  it("controlled mode reports keystrokes and renders the given query", () => {
    const onQueryChange = vi.fn();
    const { rerender } = render(
      <SubtreeSearch
        modules={MODULES}
        onPick={vi.fn()}
        query=""
        onQueryChange={onQueryChange}
      />
    );
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "273.10" },
    });
    expect(onQueryChange).toHaveBeenCalledWith("273.10");
    // The host owns the value: results follow the prop.
    rerender(
      <SubtreeSearch
        modules={MODULES}
        onPick={vi.fn()}
        query="273.10"
        onQueryChange={onQueryChange}
      />
    );
    expect(screen.getAllByTestId("picker-result")).toHaveLength(1);
  });

  it("compact mode floats its results (the top-right cluster)", () => {
    render(<SubtreeSearch modules={MODULES} onPick={vi.fn()} compact />);
    expect(document.querySelector(".subtree-search.is-compact")).not.toBeNull();
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "273.10" },
    });
    expect(
      document.querySelector(".picker-results.picker-results-floating")
    ).not.toBeNull();
    // Clearing the query closes the dropdown.
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "" },
    });
    expect(document.querySelector(".picker-results")).toBeNull();
  });
});

describe("SubtreeSearch headline matching (#find-by-name)", () => {
  const NAMED_MODULES: CorpusModule[] = [
    module({
      target: "us-al:policies/dhr/poe/chapter-06-social-security-numbers/600",
      jurisdiction: "us-al",
      bucket: "policies",
      ruleCount: 2,
      linkedRuleCount: 2,
    }),
    module({
      target: "us:statutes/26/86",
      ruleCount: 26,
      linkedRuleCount: 26,
      headlineRule: "social_security_benefits_included_in_gross_income",
    }),
    module({
      target: "us:statutes/26/1411",
      ruleCount: 14,
      linkedRuleCount: 14,
      headlineRule: "net_investment_income_tax",
    }),
  ];

  it("finds a module by its headline-rule name, not just its citation", () => {
    render(<SubtreeSearch modules={NAMED_MODULES} onPick={vi.fn()} />);
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "net investment" },
    });
    const results = screen.getAllByTestId("picker-result");
    expect(results).toHaveLength(1);
    expect(results[0]!.textContent).toContain("Net Investment Income Tax");
    expect(results[0]!.textContent).toContain("26 USC \u00a7 1411");
  });

  it("ranks name matches above path-only matches", () => {
    render(<SubtreeSearch modules={NAMED_MODULES} onPick={vi.fn()} />);
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "social security" },
    });
    const results = screen.getAllByTestId("picker-result");
    expect(results.length).toBe(2);
    // The statute named "Social Security Benefits…" beats the state
    // policy whose file PATH merely contains social-security.
    expect(results[0]!.textContent).toContain(
      "Social Security Benefits Included In Gross Income"
    );
    expect(results[1]!.textContent).toContain("us-al");
  });

  it("headline title rows demote the citation to the subtitle line", () => {
    render(<SubtreeSearch modules={NAMED_MODULES} onPick={vi.fn()} />);
    fireEvent.change(screen.getByTestId("picker-search"), {
      target: { value: "1411" },
    });
    const row = screen.getAllByTestId("picker-result")[0]!;
    expect(row.querySelector("strong")!.textContent).toBe(
      "Net Investment Income Tax"
    );
    expect(row.textContent).not.toContain("us:statutes/26/1411");
  });
});
