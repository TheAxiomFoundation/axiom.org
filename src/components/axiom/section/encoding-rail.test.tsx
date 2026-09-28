import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { EncodingRail } from "./encoding-rail";
import type { RuleEncodingData } from "@/lib/supabase";
import { _resetRawFetchCache } from "@/lib/axiom/rulespec/raw-cache";
import { trackAxiomEvent } from "@/lib/analytics";

vi.mock("@/lib/analytics", () => ({ trackAxiomEvent: vi.fn() }));

const YAML = [
  "format: rulespec/v1",
  "module:",
  "  name: eitc",
  "rules:",
  "  - name: rule_for_a",
  "    kind: derived",
  "    source: 26 USC 32(a)",
  "    versions:",
  "      - effective_from: '2026-01-01'",
  "        formula: 'x'",
  "  - name: rule_for_b",
  "    kind: derived",
  "    source: 26 USC 32(b)",
  "    versions:",
  "      - effective_from: '2026-01-01'",
  "        formula: 'y'",
].join("\n");

function makeEncoding(): RuleEncodingData {
  return {
    encoding_run_id: "github:statutes/26/32.yaml",
    citation: "26 USC 32",
    session_id: null,
    file_path: "statutes/26/32.yaml",
    rulespec_content: YAML,
    final_scores: null,
    iterations: null,
    total_duration_ms: null,
    agent_type: null,
    agent_model: null,
    data_source: null,
    has_issues: null,
    note: null,
    timestamp: null,
    encoder_version: null,
  };
}

const CHUNKS = [
  {
    anchor: "a",
    designator: "(a)",
    label: "(a) Allowance of credit",
    text: "(a) Allowance of credit, see section 151 for details.",
  },
  {
    anchor: "b",
    designator: "(b)",
    label: "(b) Percentages",
    text: "(b) Percentages table text.",
  },
];
const ENCODED_RULES = [
  { name: "rule_for_a", kind: "derived", anchors: ["a"] },
  { name: "rule_for_b", kind: "derived", anchors: ["b"] },
];

/** Mount fake subsection targets and control their reading-line
 *  positions; the scroll-spy reads getBoundingClientRect().top. */
function placeSections(tops: Record<string, number>) {
  for (const [id, top] of Object.entries(tops)) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("section");
      el.id = id;
      document.body.appendChild(el);
    }
    el.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + 1000,
        left: 0,
        right: 0,
        width: 0,
        height: 1000,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  }
}

function scrollTo(tops: Record<string, number>) {
  placeSections(tops);
  act(() => {
    fireEvent.scroll(window);
  });
}

const OUTGOING = [
  {
    direction: "outgoing" as const,
    citation_text: "section 151",
    pattern_kind: "test",
    confidence: 1,
    start_offset: 0,
    end_offset: 11,
    other_citation_path: "us/statute/26/151",
    other_provision_id: null,
    other_heading: null,
    target_resolved: true,
  },
];

function renderRail() {
  return render(
    <EncodingRail
      encoding={makeEncoding()}
      jurisdiction="us"
      citationPath="us/statute/26/32"
      isRepealed={false}
      chunks={CHUNKS}
      encodedRules={ENCODED_RULES}
      outgoing={OUTGOING}
      incoming={[]}
    />,
  );
}

describe("EncodingRail", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    // Async like a real frame — the hook assigns the frame id before
    // the callback runs and clears it inside the callback.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetRawFetchCache();
    document.body.innerHTML = "";
  });

  it("shows the section skeleton before any subsection crosses the reading line", () => {
    placeSections({ a: 500, b: 1500 });
    renderRail();
    expect(screen.getByTestId("rail-header")).toHaveTextContent(
      "Whole section",
    );
    // Encodings cards lead the rail; the code drawer sits collapsed
    // beneath them and citations stay collapsed.
    expect(screen.getByTestId("rail-encodings")).toHaveTextContent(
      "Encodings · 2",
    );
    expect(screen.getByTestId("rail-rules")).not.toHaveAttribute("open");
    expect(screen.getByTestId("rail-rules")).toHaveTextContent("rulespec code");
    expect(screen.getByTestId("rail-citations")).toBeInTheDocument();
  });

  it("follows scroll: shows only the active subsection's rules", async () => {
    placeSections({ a: 500, b: 1500 });
    renderRail();

    scrollTo({ a: -200, b: 900 }); // reading (a)
    await waitFor(() => {
      expect(screen.getByText("(a) Allowance of credit")).toBeInTheDocument();
      expect(screen.queryByText("(b) Percentages")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("rule_for_a").length).toBeGreaterThan(0);
    expect(screen.queryByText("rule_for_b")).not.toBeInTheDocument();
    // The node's own citations show; the source-file header does not.
    expect(screen.getByTestId("references-panel")).toBeInTheDocument();
    expect(screen.queryByText("Shown source")).not.toBeInTheDocument();
    // Rule cards link back into the reading column.
    const backLink = screen.getByTitle("Jump to this subsection in the text");
    expect(backLink).toHaveAttribute("href", "#a");

    scrollTo({ a: -1200, b: 100 }); // reading (b)
    await waitFor(() => {
      expect(screen.getByText("(b) Percentages")).toBeInTheDocument();
      expect(
        screen.queryByText("(a) Allowance of credit"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("rule_for_b").length).toBeGreaterThan(0);
  });

  it("renders no executable-programs drawer — coverage only powers links", () => {
    const programs = [
      {
        jurisdiction: "us",
        programId: "us-eitc",
        mode: "compiled" as const,
        status: "ready" as const,
        ruleCount: 3,
        anchors: ["a", "b"],
        ruleNames: ["eitc_amount"],
      },
    ];
    placeSections({ a: 500, b: 1500 });
    render(
      <EncodingRail
        encoding={makeEncoding()}
        jurisdiction="us"
        citationPath="us/statute/26/32"
        isRepealed={false}
        chunks={CHUNKS}
        encodedRules={ENCODED_RULES}
        outgoing={OUTGOING}
        incoming={[]}
        programs={programs}
      />,
    );
    expect(screen.queryByTestId("rail-programs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rail-executable")).not.toBeInTheDocument();
  });

  it("renders rule cards without per-rule link buttons", async () => {
    placeSections({ a: 500, b: 1500 });
    renderRail();
    expect(screen.queryByText("graph ↗")).not.toBeInTheDocument();
    expect(screen.queryByText("use in builder ↗")).not.toBeInTheDocument();
  });

  it("groups policy modules that encode the provision with their rule cards", () => {
    placeSections({ a: 500, b: 1500 });
    render(
      <EncodingRail
        encoding={makeEncoding()}
        jurisdiction="us"
        citationPath="us/statute/26/32"
        isRepealed={false}
        chunks={CHUNKS}
        encodedRules={ENCODED_RULES}
        outgoing={OUTGOING}
        incoming={[]}
        citedByFiles={[
          {
            citationPath: "us/policy/usitc/us-tariff-duty/lines/generated/ch22",
            filePath: "policies/usitc/us-tariff-duty/lines/generated/ch22.yaml",
            rules: [
              {
                renderedName: "rule_for_b",
                canonicalName: "rule_for_b",
                rank: 1,
                atomKinds: ["value"],
              },
            ],
          },
        ]}
      />,
    );

    const group = screen.getByTestId("rail-cited-by");
    expect(
      within(group).getByText("Encoded from this provision"),
    ).toBeInTheDocument();
    expect(
      within(group).getByText(
        "us/policy/usitc/us-tariff-duty/lines/generated/ch22",
      ),
    ).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/rulespec-us/blob/main/us/policies/usitc/us-tariff-duty/lines/generated/ch22.yaml",
    );
    expect(within(group).getByText("rule_for_b")).toBeInTheDocument();

    const cardLists = within(
      screen.getByTestId("rail-encodings"),
    ).getAllByTestId("rule-cards");
    expect(cardLists).toHaveLength(2);
    expect(within(cardLists[0]).getByText("rule_for_a")).toBeInTheDocument();
    expect(
      within(cardLists[0]).queryByText("rule_for_b"),
    ).not.toBeInTheDocument();
  });

  it("shows an alias's canonical name and spotlights it by either name", () => {
    placeSections({ a: 500, b: 1500 });
    const renderedName =
      "rule_for_b@policy.snap.us-ga.fy-2026-benefit-calculation";
    render(
      <EncodingRail
        highlightRule="rule_for_b"
        encoding={{
          ...makeEncoding(),
          rulespec_content: YAML.replace(
            "name: rule_for_b",
            `name: ${renderedName}`,
          ),
        }}
        jurisdiction="us-ga"
        citationPath="us-ga/statute/snap/example"
        isRepealed={false}
        chunks={CHUNKS}
        encodedRules={[
          ENCODED_RULES[0],
          { ...ENCODED_RULES[1], name: renderedName },
        ]}
        outgoing={[]}
        incoming={[]}
        citedByFiles={[
          {
            citationPath:
              "us-ga/policy/snap/fy-2026-benefit-calculation",
            filePath: "policies/snap/fy-2026-benefit-calculation.yaml",
            rules: [
              {
                renderedName,
                canonicalName: "rule_for_b",
                rank: 3,
                atomKinds: ["condition"],
              },
            ],
          },
        ]}
      />,
    );

    const group = screen.getByTestId("rail-cited-by");
    expect(
      within(group).getByText((_, element) =>
        Boolean(
          element?.tagName === "P" &&
            element.textContent ===
              `rule_for_b rendered as ${renderedName}.`,
        ),
      ),
    ).toBeInTheDocument();
    const card = within(group)
      .getAllByText(renderedName)
      .map((element) => element.closest("details"))
      .find(Boolean);
    expect(card).toHaveAttribute("open");
    expect(
      within(card as HTMLElement).getByText("your rule"),
    ).toBeInTheDocument();
  });

  it("tracks expansion of path-matched and cited-by rule cards", () => {
    placeSections({ a: 500, b: 1500 });
    render(
      <EncodingRail
        encoding={makeEncoding()}
        jurisdiction="us"
        citationPath="us/statute/26/32"
        isRepealed={false}
        chunks={CHUNKS}
        encodedRules={ENCODED_RULES}
        outgoing={OUTGOING}
        incoming={[]}
        citedByFiles={[
          {
            citationPath: "us/policy/usitc/us-tariff-duty/lines/generated/ch22",
            filePath: "policies/usitc/us-tariff-duty/lines/generated/ch22.yaml",
            rules: [
              {
                renderedName: "rule_for_b",
                canonicalName: "rule_for_b",
                rank: 1,
                atomKinds: ["value"],
              },
            ],
          },
        ]}
      />,
    );

    const group = screen.getByTestId("rail-cited-by");
    const citedByCard = within(group)
      .getByText("rule_for_b")
      .closest("details")!;
    fireEvent(citedByCard, new Event("toggle", { bubbles: false }));
    Object.defineProperty(citedByCard, "open", { value: true });
    fireEvent(citedByCard, new Event("toggle", { bubbles: false }));

    const pathCard = screen.getAllByText("rule_for_a")[0].closest("details")!;
    Object.defineProperty(pathCard, "open", { value: true });
    fireEvent(pathCard, new Event("toggle", { bubbles: false }));

    expect(vi.mocked(trackAxiomEvent).mock.calls.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(vi.mocked(trackAxiomEvent)).toHaveBeenCalledWith(
      "axiom_encoding_viewed",
      expect.objectContaining({ citation_path: "us/statute/26/32" }),
    );
  });

  it("says how many citing rules the bounded lookup left out", () => {
    placeSections({ a: 500, b: 1500 });
    render(
      <EncodingRail
        encoding={makeEncoding()}
        jurisdiction="us"
        citationPath="us/statute/hts/9903.91.02"
        isRepealed={false}
        chunks={CHUNKS}
        encodedRules={ENCODED_RULES}
        outgoing={OUTGOING}
        incoming={[]}
        citedByFiles={[
          {
            citationPath:
              "us/policy/cbp/us-tariff-schedule/generated/ch01/ch01",
            filePath:
              "policies/cbp/us-tariff-schedule/generated/ch01/ch01.yaml",
            rules: [
              {
                renderedName: "rule_for_b",
                canonicalName: "rule_for_b",
                rank: 3,
                atomKinds: ["condition"],
              },
            ],
          },
        ]}
        citedByOverflow={42}
      />,
    );

    expect(screen.getByTestId("rail-cited-by-overflow")).toHaveTextContent(
      "42 more rules in other modules are grounded in this provision. This view shows the first 120 by rank and module path.",
    );
  });

  it("renders the overflow note even when no cited-by rule is in view", () => {
    placeSections({ a: 500, b: 1500 });
    render(
      <EncodingRail
        encoding={makeEncoding()}
        jurisdiction="us"
        citationPath="us/statute/26/32"
        isRepealed={false}
        chunks={CHUNKS}
        encodedRules={ENCODED_RULES}
        outgoing={OUTGOING}
        incoming={[]}
        citedByFiles={[]}
        citedByOverflow={1}
      />,
    );

    expect(screen.getByTestId("rail-cited-by-overflow")).toHaveTextContent(
      "1 more rules in other modules are grounded in this provision. This view shows the first 120 by rank and module path.",
    );
  });

  it("shows an unlinked module path when no RuleSpec repository is mapped", () => {
    placeSections({ a: 500, b: 1500 });
    render(
      <EncodingRail
        encoding={makeEncoding()}
        jurisdiction="fr"
        citationPath="fr/statute/26/32"
        isRepealed={false}
        chunks={CHUNKS}
        encodedRules={[ENCODED_RULES[0]]}
        outgoing={[]}
        incoming={[]}
        citedByFiles={[
          {
            citationPath: "fr/policy/tariff/ch22",
            filePath: "policies/tariff/ch22.yaml",
            rules: [
              {
                renderedName: "rule_for_a",
                canonicalName: "rule_for_a",
                rank: 0,
                atomKinds: [],
              },
            ],
          },
          {
            citationPath: "fr/policy/tariff/unused",
            filePath: "policies/tariff/unused.yaml",
            rules: [
              {
                renderedName: "not_on_this_section",
                canonicalName: "not_on_this_section",
                rank: 1,
                atomKinds: ["value"],
              },
            ],
          },
        ]}
      />,
    );

    const group = screen.getByTestId("rail-cited-by");
    expect(within(group).getByText("fr/policy/tariff/ch22").tagName).toBe(
      "SPAN",
    );
    expect(
      within(group).queryByText("fr/policy/tariff/unused"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("rail-encodings")).getAllByTestId("rule-cards"),
    ).toHaveLength(1);
  });

  it("renders no programs block when coverage is empty", () => {
    placeSections({ a: 500, b: 1500 });
    renderRail();
    expect(screen.queryByTestId("rail-programs")).not.toBeInTheDocument();
  });

  it("shows an empty state for subsections nothing cites", async () => {
    renderRail();
    scrollTo({ a: -200, b: 900 });
    // Re-point (a)'s rules at nothing by scrolling to a chunk with no rules
    // — simulate by rendering with a rule-less chunk instead.
    document.body.innerHTML = "";
    render(
      <EncodingRail
        encoding={makeEncoding()}
        jurisdiction="us"
        citationPath="us/statute/26/32"
        isRepealed={false}
        chunks={[
          {
            anchor: "j",
            designator: "(j)",
            label: "(j) Inflation adjustments",
            text: "(j) Inflation adjustments text.",
          },
        ]}
        encodedRules={[{ name: "rule_for_a", kind: "derived", anchors: ["a"] }]}
        outgoing={[]}
        incoming={[]}
      />,
    );
    scrollTo({ j: -50 });
    await waitFor(() =>
      expect(
        screen.getByText(
          "No rules are tied directly to this part of the section.",
        ),
      ).toBeInTheDocument(),
    );
  });
});
