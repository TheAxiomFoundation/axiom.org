/**
 * The legacy rule-detail rail, end to end:
 * ``RuleDetailPanel`` → ``useEncoding`` → ``getRuleEncoding`` → the
 * registered ``app_visibility`` gate.
 *
 * Nothing between the component and the Supabase client is stubbed.
 * ``new-components.test.tsx`` mocks ``useEncoding`` wholesale, which is
 * right for rendering assertions and useless here: it would assert
 * against the mock rather than against the reader the rail actually
 * calls. The v2 section reader refuses a gated family's provision
 * (``getSectionEncoding``); this file is the proof that the v1 rail,
 * which never goes through it, refuses the same provision — with a
 * populated ``encoding_runs`` row waiting behind the reader, which is
 * the case that used to be served.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// The panel's SiblingStrip needs a router and its own resolver read.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/axiom/resolver", () => ({
  getSiblings: vi.fn().mockResolvedValue([]),
}));

// Keep the GitHub listing paths out of the test: this file is about
// what the DB reader hands back, and the repo-listing gate already has
// its own coverage in ``rulespec/visibility.test.ts``.
vi.mock("@/lib/axiom/rulespec/repo-listing", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/axiom/rulespec/repo-listing")
  >()),
  listEncodedFiles: vi.fn().mockResolvedValue([]),
  findEncodedDescendants: vi.fn().mockResolvedValue([]),
  fetchEncodedFile: vi.fn().mockResolvedValue(null),
}));

import { RuleDetailPanel } from "./rule-detail-panel";
import { _resetRawFetchCache } from "@/lib/axiom/rulespec/raw-cache";
import type { ViewerDocument } from "@/lib/axiom-utils";
import type { Rule } from "@/lib/supabase";


// A synthetic gated ("xg") family: with every real family public, the
// gate has no live instance to test against.
vi.mock("@/lib/axiom/rulespec-families", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/axiom/rulespec-families")>();
  return {
    ...actual,
    RULESPEC_FAMILIES: Object.freeze([
      ...actual.RULESPEC_FAMILIES,
      { slug: "xg", repo: "rulespec-xg", appVisibility: "experimental" },
    ]),
  };
});
vi.mock("@/lib/axiom/jurisdictions-seed", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/axiom/jurisdictions-seed")>();
  return {
    ...actual,
    JURISDICTIONS_SEED: [
      ...actual.JURISDICTIONS_SEED,
      { slug: "xg", label: "Xgated", hasCitationPaths: true },
    ],
  };
});

const ISRAEL_RULE_NAME = "il_income_tax_pilot_rate";
const ISRAEL_YAML = `format: rulespec/v1
module:
  name: il.statutes.income-tax-ordinance.section-121
rules:
  - name: ${ISRAEL_RULE_NAME}
    kind: parameter
    versions:
      - effective_from: '2025-01-01'
        formula: '0.10'
`;

const US_RULE_NAME = "us_income_tax_control_rate";
const US_YAML = `format: rulespec/v1
module:
  name: us.statutes.26.1
rules:
  - name: ${US_RULE_NAME}
    kind: parameter
    versions:
      - effective_from: '2025-01-01'
        formula: '0.10'
`;

function makeDoc(overrides: Partial<ViewerDocument> = {}): ViewerDocument {
  return {
    citation: "26 USC 1",
    title: "Tax imposed",
    subsections: [{ id: "a", text: "There is hereby imposed a tax." }],
    hasRuleSpec: true,
    jurisdiction: "us",
    sourcePath: "statute/26/1.json",
    ...overrides,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    jurisdiction: "us",
    doc_type: "statute",
    parent_id: null,
    level: 0,
    ordinal: 1,
    heading: "Tax imposed",
    body: null,
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: "statute/26/1",
    citation_path: "us/statute/26/1",
    rulespec_path: null,
    has_rulespec: true,
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
    ...overrides,
  };
}

/**
 * A corpus provision row plus a populated ``encoding_runs`` row —
 * content, not telemetry — so a missing gate would render the YAML.
 */
function mockPopulatedEncoding(provision: {
  citation_path: string;
  jurisdiction: string;
  content: string;
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "current_provisions") {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  citation_path: provision.citation_path,
                  jurisdiction: provision.jurisdiction,
                  rulespec_path: null,
                  has_rulespec: true,
                },
                error: null,
              }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        in: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: `enc-${provision.jurisdiction}`,
                  citation: provision.citation_path,
                  session_id: null,
                  file_path: "statutes/pilot.yaml",
                  rulespec_content: provision.content,
                  final_scores: null,
                },
              ],
              error: null,
            }),
        }),
      }),
    };
  });
}

describe("RuleDetailPanel encoding visibility", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    // ``getRuleReferences`` runs alongside the encoding read.
    mockRpc.mockResolvedValue({ data: [], error: null });
    _resetRawFetchCache();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders no pilot YAML for a gated family, even with a populated run row", async () => {
    mockPopulatedEncoding({
      citation_path: "xg/statute/income-tax-ordinance/section-121",
      jurisdiction: "xg",
      content: ISRAEL_YAML,
    });

    const { container } = render(
      <RuleDetailPanel
        document={makeDoc({
          jurisdiction: "xg",
          citation: "פקודת מס הכנסה 121",
          title: "שיעורי המס ליחיד",
        })}
        rule={makeRule({
          id: "rule-il",
          jurisdiction: "xg",
          citation_path: "xg/statute/income-tax-ordinance/section-121",
          source_path: "statute/income-tax-ordinance/section-121",
        })}
      />
    );

    expect(await screen.findByText("Not yet encoded")).toBeInTheDocument();
    // Neither as a rule card nor as raw YAML in a code block.
    expect(container.textContent).not.toContain(ISRAEL_RULE_NAME);
    expect(container.textContent).not.toContain("format: rulespec/v1");
    // No "| RuleSpec available" in the status bar either.
    expect(container.textContent).not.toContain("RuleSpec available");
  });

  it("renders no pilot YAML for a gated family reached by a synthesised github: id", async () => {
    // The rail is handed a synth id when no corpus row backs the path.
    // The corpus table must not be queried at all, and the run row must
    // still not reach the page.
    mockFrom.mockImplementation((table: string) => {
      if (table === "current_provisions") {
        throw new Error("synthesised id should not query corpus");
      }
      return {
        select: () => ({
          in: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: "enc-il-synth",
                    citation: "xg/statute/income-tax-ordinance/section-121",
                    session_id: null,
                    file_path: "statutes/income-tax-ordinance/section-121.yaml",
                    rulespec_content: ISRAEL_YAML,
                    final_scores: null,
                  },
                ],
                error: null,
              }),
          }),
        }),
      };
    });

    const { container } = render(
      <RuleDetailPanel
        document={makeDoc({ jurisdiction: "xg", citation: "ITO 121" })}
        rule={makeRule({
          id: "github:xg/statute/income-tax-ordinance/section-121",
          jurisdiction: "xg",
          citation_path: "xg/statute/income-tax-ordinance/section-121",
        })}
      />
    );

    expect(await screen.findByText("Not yet encoded")).toBeInTheDocument();
    expect(container.textContent).not.toContain(ISRAEL_RULE_NAME);
    expect(mockFrom).not.toHaveBeenCalledWith("encoding_runs");
  });

  it("still renders a populated run row for a family the app reads", async () => {
    // The control: identical harness, ungated family. Without it the
    // two refusals above could pass for any reason at all.
    mockPopulatedEncoding({
      citation_path: "us/statute/26/1",
      jurisdiction: "us",
      content: US_YAML,
    });

    const { container } = render(
      <RuleDetailPanel document={makeDoc()} rule={makeRule()} />
    );

    await waitFor(() =>
      expect(container.textContent).toContain(US_RULE_NAME)
    );
    expect(screen.queryByText("Not yet encoded")).toBeNull();
  });
});
