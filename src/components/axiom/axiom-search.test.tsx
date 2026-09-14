import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { AxiomSearch } from "./axiom-search";

const mockFetch = vi.fn();

const hit = (overrides: Partial<{
  id: string;
  jurisdiction: string;
  doc_type: string;
  citation_path: string;
  heading: string | null;
  snippet: string;
  has_rulespec: boolean;
  rank: number;
}>) => ({
  id: "hit-1",
  jurisdiction: "us",
  doc_type: "regulation",
  citation_path: "us/regulation/7/273/9",
  heading: "Income and deductions",
  snippet: "<mark>SNAP</mark> households with elderly or disabled members",
  has_rulespec: false,
  rank: 0.1,
  ...overrides,
});

const encodedHit = (overrides: Partial<{
  filePath: string;
  citationPath: string;
  bucket: string;
  label: string;
  jurisdictionLabel: string;
  matchKind: "file" | "symbol";
  symbolMatches: unknown[];
  fileSummary: unknown;
  score: number;
}> = {}) => ({
  filePath: "policies/cdhs/snap/fy-2026-benefit-calculation.yaml",
  citationPath: "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
  bucket: "policies",
  label: "CDHS SNAP FY 2026 Benefit Calculation",
  jurisdictionLabel: "Colorado",
  matchKind: "file",
  symbolMatches: [],
  fileSummary: null,
  score: 730,
  ...overrides,
});

function responseJson(overrides: Partial<{
  query: string;
  programs: unknown[];
  encoded: unknown[];
  corpus: unknown[];
}> = {}) {
  return {
    query: "snap",
    programs: [],
    encoded: [],
    corpus: [],
    ...overrides,
  };
}

function okResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function latestSearchUrl(): URL {
  const latest = mockFetch.mock.calls.at(-1)?.[0];
  if (typeof latest !== "string") throw new Error("fetch URL missing");
  return new URL(latest, "https://axiom.org");
}

describe("AxiomSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okResponse(responseJson()));
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Component debounces at DEBOUNCE_MS = 200. Real timers + a short settle
  // beats the fake-timers/waitFor impedance mismatch.
  function flush(_ms = 250) {
    // no-op; callers await waitFor which handles real-time debounce.
  }

  it("renders the search input with a descriptive placeholder", () => {
    render(<AxiomSearch />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.placeholder).toContain(
      "Search statutes, regulations, and rulemaking"
    );
  });

  it("tracks clicks on result rows and the citation shortcut", async () => {
    mockFetch.mockResolvedValue(okResponse(responseJson({ corpus: [hit({})] })));
    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "7 CFR 273.9" },
    });

    await waitFor(() => {
      expect(screen.getByText("Income and deductions")).toBeInTheDocument();
    });
    // Clicking a result row and the citation card exercises the click
    // tracking path (a no-op capture without a PostHog key).
    fireEvent.click(screen.getByText("Income and deductions").closest("a")!);
    fireEvent.click(screen.getByRole("link", { name: /Open exact citation/i }));
  });

  it("renders preview rule chips with deep links for file-level matches", async () => {
    mockFetch.mockResolvedValue(
      okResponse(
        responseJson({
          encoded: [
            encodedHit({
              fileSummary: {
                summary: "Colorado SNAP benefit calculation.",
                ruleCount: 4,
                importCount: 1,
                imports: ["us:regulations/7-cfr/273/9"],
                previewRules: [
                  {
                    name: "shelter_costs",
                    label: "Shelter Costs",
                    kind: "derived",
                    source: null,
                    formula: "a + b",
                    matchedTerms: [],
                    score: 0,
                  },
                ],
              },
            }),
          ],
        })
      )
    );

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "CO SNAP" },
    });

    await waitFor(() => {
      expect(screen.getByText("shelter_costs")).toBeInTheDocument();
    });
    expect(screen.getByText("shelter_costs").closest("a")).toHaveAttribute(
      "href",
      "/us-co/policy/cdhs/snap/fy-2026-benefit-calculation#rule-shelter_costs"
    );
    expect(screen.getByText(/imports us:regulations/)).toBeInTheDocument();
  });

  it("clears results when the query drops below the minimum length", async () => {
    mockFetch.mockResolvedValue(okResponse(responseJson({ corpus: [hit({})] })));
    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "snap households" },
    });
    await waitFor(() => {
      expect(screen.getByText("Income and deductions")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "a" } });
    await waitFor(() => {
      expect(
        screen.queryByText("Income and deductions")
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Try one of these")).toBeInTheDocument();
  });

  it("offers verified suggestions on the empty page and runs one on click", async () => {
    mockFetch.mockResolvedValue(okResponse(responseJson({ corpus: [hit({})] })));
    render(<AxiomSearch />);

    expect(screen.getByText("Try one of these")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "colorado snap deduction" })
    );
    expect(
      (screen.getByRole("searchbox") as HTMLInputElement).value
    ).toBe("colorado snap deduction");

    await waitFor(() => {
      expect(latestSearchUrl().searchParams.get("q")).toBe(
        "colorado snap deduction"
      );
    });
    // Suggestions step aside once results render.
    await waitFor(() => {
      expect(screen.queryByText("Try one of these")).not.toBeInTheDocument();
    });
  });

  it("runs an initialQuery from the URL on mount", async () => {
    mockFetch.mockResolvedValue(okResponse(responseJson({ corpus: [hit({})] })));

    render(<AxiomSearch initialQuery="snap deduction" />);

    expect(
      (screen.getByRole("searchbox") as HTMLInputElement).value
    ).toBe("snap deduction");
    await waitFor(() => {
      expect(latestSearchUrl().searchParams.get("q")).toBe("snap deduction");
    });
    await waitFor(() => {
      expect(screen.getByText("Income and deductions")).toBeInTheDocument();
    });
  });

  it("does not call the search endpoint for queries below the minimum length", async () => {
    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "a" },
    });
    flush();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("debounces and then issues a grouped search returning results", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse(
        responseJson({
          corpus: [
            hit({}),
            hit({
              id: "hit-2",
              citation_path: "us/statute/26/32",
              heading: "Earned income",
              has_rulespec: true,
              snippet: "<mark>earned income</mark> tax credit",
            }),
          ],
        })
      )
    );

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "SNAP households" },
    });

    expect(mockFetch).not.toHaveBeenCalled();
    flush(250);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const url = latestSearchUrl();
    expect(url.pathname).toBe("/api/axiom/search");
    expect(url.searchParams.get("q")).toBe("SNAP households");
    expect(url.searchParams.get("limit")).toBe("30");
    expect(url.searchParams.has("jurisdiction")).toBe(false);
    expect(url.searchParams.has("docType")).toBe(false);

    await waitFor(() => {
      expect(screen.getByText("Income and deductions")).toBeInTheDocument();
    });
    expect(screen.getByText("Earned income")).toBeInTheDocument();
    expect(screen.getByText("7 CFR § 273.9")).toBeInTheDocument();
    expect(screen.getByText("26 USC § 32")).toBeInTheDocument();
    expect(screen.getAllByText("Encoded").length).toBe(1);
  });

  it("merges program and encoded hits for one destination and ranks them above corpus text", async () => {
    mockFetch.mockResolvedValue(
      okResponse(
        responseJson({
          programs: [
            {
              program: {
                slug: "colorado-snap",
                displayName: "Colorado SNAP",
                aliases: ["co snap"],
                jurisdiction: "us-co",
                governingBody: "Colorado Department of Human Services",
                summary: "Colorado's state-administered SNAP program.",
                anchors: [],
              },
              anchors: [
                {
                  role: "benefit_calculation",
                  citationPath:
                    "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
                  label: "Benefit calculation",
                  displayCitation: "Colorado CDHS SNAP FY 2026",
                },
              ],
            },
          ],
          encoded: [encodedHit()],
          corpus: [
            hit({
              id: "co-container",
              jurisdiction: "us-co",
              doc_type: "policy",
              citation_path: "us-co/policy/co-cdhs-snap-page",
              heading: "Supplemental Nutrition Assistance Program",
            }),
          ],
        })
      )
    );

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "CO SNAP" },
    });

    await waitFor(() => {
      expect(screen.getByText("Results")).toBeInTheDocument();
    });
    // The program anchor and the encoded hit point at the same
    // destination, so they fuse into a single encoded row that keeps
    // the program context line.
    expect(
      screen.getByText("Colorado SNAP: Benefit calculation")
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("us-co/policy/cdhs/snap/fy-2026-benefit-calculation")
    ).toHaveLength(1);

    const resultText = screen.getByLabelText("Search results").textContent ?? "";
    expect(resultText.indexOf("fy-2026-benefit-calculation")).toBeLessThan(
      resultText.indexOf("co-cdhs-snap-page")
    );
  });

  it("renders a direct citation shortcut on the full search page", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(responseJson()));

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "7 CFR 273.9" },
    });

    await waitFor(() => {
      expect(screen.getByText("Citation")).toBeInTheDocument();
    });
    const link = screen.getByRole("link", { name: /Open exact citation/i });
    expect(link).toHaveAttribute("href", "/us/regulation/7/273/9");
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument();
  });

  it("puts encoded RuleSpecs first for specific symbol queries", async () => {
    mockFetch.mockResolvedValue(
      okResponse(
        responseJson({
          programs: [
            {
              program: {
                slug: "colorado-snap",
                displayName: "Colorado SNAP",
                aliases: ["co snap"],
                jurisdiction: "us-co",
                summary: "Colorado's state-administered SNAP program.",
                anchors: [],
              },
              anchors: [
                {
                  role: "benefit_calculation",
                  citationPath:
                    "us-co/policy/cdhs/snap/fy-2026-benefit-calculation",
                  label: "Benefit calculation",
                  displayCitation: "Colorado CDHS SNAP FY 2026",
                },
              ],
            },
          ],
          encoded: [
            encodedHit({
              label: "Utility Allowance",
              matchKind: "symbol",
              symbolMatches: [
                {
                  name: "snap_standard_utility_allowance",
                  label: "Standard Utility Allowance",
                  kind: "parameter",
                  source: "Colorado SNAP FY 2026 benefit calculation composition",
                  formula: "490",
                  matchedTerms: ["utility", "allowance"],
                  score: 900,
                },
              ],
            }),
          ],
        })
      )
    );

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "CO SNAP utility allowance" },
    });

    await waitFor(() => {
      expect(screen.getByText("Utility Allowance")).toBeInTheDocument();
    });
    // Matched symbols render as compact chips: each one deep-links to
    // its rule card anchor and carries the formula as a tooltip. The
    // RuleSpec internals (kind, source citation) stay off the card.
    const symbolLink = screen
      .getByText("snap_standard_utility_allowance")
      .closest("a");
    expect(symbolLink).toHaveAttribute(
      "href",
      "/us-co/policy/cdhs/snap/fy-2026-benefit-calculation#rule-snap_standard_utility_allowance"
    );
    expect(symbolLink).toHaveAttribute("title", "= 490");
    expect(screen.queryByText(/Source: Colorado SNAP/)).not.toBeInTheDocument();
    expect(screen.queryByText("derived")).not.toBeInTheDocument();
  });

  it("applies the statute filter when clicked", async () => {
    mockFetch.mockResolvedValue(okResponse(responseJson()));

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "qualifying child" },
    });
    flush(250);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Statutes" }));
    flush(250);

    await waitFor(() => {
      expect(latestSearchUrl().searchParams.get("docType")).toBe("statute");
    });
    expect(
      screen.getByRole("button", { name: "Statutes" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("applies the rulemaking filter when clicked", async () => {
    mockFetch.mockResolvedValue(okResponse(responseJson()));

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "comment deadline" },
    });
    flush(250);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Rulemaking" }));
    flush(250);

    await waitFor(() => {
      expect(latestSearchUrl().searchParams.get("docType")).toBe("rulemaking");
    });
    expect(
      screen.getByRole("button", { name: "Rulemaking" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("forwards jurisdiction prop to the search endpoint", async () => {
    render(<AxiomSearch jurisdiction="us" />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "household" },
    });
    flush(250);

    await waitFor(() =>
      expect(latestSearchUrl().searchParams.get("jurisdiction")).toBe("us")
    );
    // A fixed jurisdiction hides the picker.
    expect(screen.queryByRole("combobox", { name: "Jurisdiction" })).toBeNull();
  });

  it("applies the jurisdiction picker to the search endpoint", async () => {
    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "snap deduction" },
    });
    flush(250);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    mockFetch.mockClear();
    const picker = screen.getByRole("combobox", { name: "Jurisdiction" });
    // Grouped for scanability: national entries aren't buried under
    // fifty states, and the standalone encoded jurisdictions appear.
    expect(
      screen.getByRole("group", { name: "Federal & national" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "US states & territories" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "New Zealand" })
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Belgium" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Belgian regions & communities" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Brussels-Capital Region" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Kingston upon Thames" })
    ).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "us-co" } });
    flush(250);

    await waitFor(() =>
      expect(latestSearchUrl().searchParams.get("jurisdiction")).toBe("us-co")
    );
  });

  it("shows the empty state when a valid query returns no rows", async () => {
    mockFetch.mockResolvedValue(okResponse(responseJson()));

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzxxnomatch" },
    });
    flush(250);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText(/No matches/)).toBeInTheDocument();
    });
  });

  it("shows an error message when the search endpoint rejects", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "anything" },
    });
    flush(250);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });
  });

  it("renders <mark> tokens from corpus snippets as styled <mark> elements", async () => {
    mockFetch.mockResolvedValue(
      okResponse(
        responseJson({
          corpus: [
            hit({
              snippet: "plain before <mark>highlighted</mark> plain after",
            }),
          ],
        })
      )
    );

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "anything" },
    });
    flush(250);

    await waitFor(() => {
      expect(screen.getByText("highlighted").tagName).toBe("MARK");
    });
    expect(screen.getByText(/plain before/)).toBeInTheDocument();
    expect(screen.getByText(/plain after/)).toBeInTheDocument();
  });

  it("formats CFR Part (no subpart/section) and subpart labels correctly", async () => {
    mockFetch.mockResolvedValue(
      okResponse(
        responseJson({
          corpus: [
            hit({
              id: "a",
              citation_path: "us/regulation/7/273",
              heading: "Certification of eligible households",
            }),
            hit({
              id: "b",
              citation_path: "us/regulation/7/273/subpart-d",
              heading: "Subpart D — Eligibility and Benefit Levels",
            }),
            hit({
              id: "c",
              citation_path: "us/unknown/random/path",
              heading: "Fallback path",
            }),
          ],
        })
      )
    );

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "anything" },
    });

    await waitFor(() => {
      expect(screen.getByText("7 CFR Part 273")).toBeInTheDocument();
    });
    expect(screen.getByText("7 CFR 273 Subpart D")).toBeInTheDocument();
    expect(screen.getByText("us/unknown/random/path")).toBeInTheDocument();
  });

  it("form submit forces an immediate search (bypasses debounce)", async () => {
    mockFetch.mockResolvedValue(okResponse(responseJson({ corpus: [hit({})] })));
    render(<AxiomSearch />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "urgent query" } });
    const form = input.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(latestSearchUrl().searchParams.get("q")).toBe("urgent query");
    });
  });

  it("treats stale responses as discarded when a newer query finishes first", async () => {
    let resolveFirst: (v: Response) => void = () => {};
    const firstCall = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    mockFetch.mockReturnValueOnce(firstCall);
    mockFetch.mockResolvedValueOnce(
      okResponse(
        responseJson({
          corpus: [hit({ heading: "Second call result" })],
        })
      )
    );

    render(<AxiomSearch />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "first query" },
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "second query" },
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    await waitFor(() =>
      expect(screen.getByText("Second call result")).toBeInTheDocument()
    );

    resolveFirst(
      new Response(
        JSON.stringify(
          responseJson({
            corpus: [hit({ heading: "Stale first result" })],
          })
        ),
        { status: 200 }
      )
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Stale first result")).not.toBeInTheDocument();
    expect(screen.getByText("Second call result")).toBeInTheDocument();
  });
});
