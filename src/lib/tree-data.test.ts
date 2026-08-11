import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildBreadcrumbs,
  isUUID,
  getJurisdiction,
  getJurisdictionBySlug,
  resolveAxiomPath,
  hasEncodedDescendant,
  resolveDisplayContext,
  getDocTypeNodes,
  getTitleNodes,
  getSectionNodes,
  JURISDICTIONS,
  TreeDataUnavailableError,
} from "./tree-data";
import type { Rule } from "@/lib/supabase";
import { supabaseCorpus } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  supabaseCorpus: { from: vi.fn() },
  supabase: { from: vi.fn() },
}));

function queryMock(result: unknown, terminal = "limit") {
  const query: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "is",
    "gte",
    "lt",
    "order",
    "range",
    "in",
  ]) {
    query[method] = vi.fn(() => query);
  }
  query[terminal] = vi.fn(() => Promise.resolve(result));
  return query as never;
}

describe("JURISDICTIONS", () => {
  it("contains US Federal, Colorado, Ohio, UK, Belgium, and Canada", () => {
    const slugs = JURISDICTIONS.map((j) => j.slug);
    expect(slugs).toContain("us");
    expect(slugs).toContain("us-co");
    expect(slugs).toContain("us-oh");
    expect(slugs).toContain("uk");
    expect(slugs).toContain("be");
    expect(slugs).toContain("be-bru");
    expect(slugs).toContain("ca");
  });

  it("US Federal uses citation paths", () => {
    const us = JURISDICTIONS.find((j) => j.slug === "us");
    expect(us).toBeDefined();
    expect(us!.hasCitationPaths).toBe(true);
  });

  it("UK uses citation paths", () => {
    const uk = JURISDICTIONS.find((j) => j.slug === "uk");
    expect(uk).toBeDefined();
    expect(uk!.hasCitationPaths).toBe(true);
  });
});

describe("getJurisdictionBySlug", () => {
  it("returns config for known jurisdiction", () => {
    const us = getJurisdictionBySlug("us");
    expect(us).toBeDefined();
    expect(us!.label).toBe("US Federal");
  });

  it("returns undefined for unknown jurisdiction", () => {
    expect(getJurisdictionBySlug("mars")).toBeUndefined();
  });
});

describe("getJurisdiction", () => {
  it("returns config for known jurisdiction", () => {
    const us = getJurisdiction("us");
    expect(us).toEqual({
      id: "us",
      label: "US Federal",
      hasCitationPaths: true,
    });
  });

  it("returns config for state jurisdiction", () => {
    const oh = getJurisdiction("us-oh");
    expect(oh).toEqual({
      id: "us-oh",
      label: "Ohio",
      hasCitationPaths: true,
    });
  });

  it("returns undefined for unknown jurisdiction", () => {
    expect(getJurisdiction("mars")).toBeUndefined();
  });

  it("marks US and Ohio as having citation paths", () => {
    expect(getJurisdiction("us")?.hasCitationPaths).toBe(true);
    expect(getJurisdiction("us-oh")?.hasCitationPaths).toBe(true);
  });

  it("marks UK as having citation paths and Canada as not", () => {
    expect(getJurisdiction("uk")?.hasCitationPaths).toBe(true);
    expect(getJurisdiction("be")?.hasCitationPaths).toBe(true);
    expect(getJurisdiction("ca")?.hasCitationPaths).toBe(false);
  });
});

describe("resolveAxiomPath", () => {
  it("returns jurisdiction-picker for empty segments", () => {
    const result = resolveAxiomPath([]);
    expect(result.phase).toBe("jurisdiction-picker");
    expect(result.ruleSegments).toEqual([]);
  });

  it("returns jurisdiction-picker for unknown jurisdiction", () => {
    const result = resolveAxiomPath(["mars"]);
    expect(result.phase).toBe("jurisdiction-picker");
  });

  it("returns rule phase for US", () => {
    const result = resolveAxiomPath(["us"]);
    expect(result.phase).toBe("rule");
    expect(result.jurisdiction?.slug).toBe("us");
    expect(result.ruleSegments).toEqual([]);
  });

  it("returns rule phase for US with rule segments", () => {
    const result = resolveAxiomPath(["us", "statute", "26"]);
    expect(result.phase).toBe("rule");
    expect(result.jurisdiction?.slug).toBe("us");
    expect(result.ruleSegments).toEqual(["statute", "26"]);
  });

  it("returns rule phase for Ohio", () => {
    const result = resolveAxiomPath(["us-oh", "statute"]);
    expect(result.phase).toBe("rule");
    expect(result.jurisdiction?.slug).toBe("us-oh");
    expect(result.ruleSegments).toEqual(["statute"]);
  });

  it("returns rule phase for Colorado", () => {
    const result = resolveAxiomPath(["us-co", "regulation"]);
    expect(result.phase).toBe("rule");
    expect(result.jurisdiction?.slug).toBe("us-co");
    expect(result.ruleSegments).toEqual(["regulation"]);
  });

  it("returns rule phase for UK", () => {
    const result = resolveAxiomPath(["uk"]);
    expect(result.phase).toBe("rule");
    expect(result.jurisdiction?.slug).toBe("uk");
    expect(result.ruleSegments).toEqual([]);
  });

  it("returns rule phase for UK with rule segments", () => {
    const result = resolveAxiomPath(["uk", "legislation"]);
    expect(result.phase).toBe("rule");
    expect(result.jurisdiction?.slug).toBe("uk");
    expect(result.ruleSegments).toEqual(["legislation"]);
  });

  it("returns rule phase for Canada", () => {
    const result = resolveAxiomPath(["ca"]);
    expect(result.phase).toBe("rule");
    expect(result.jurisdiction?.slug).toBe("ca");
    expect(result.ruleSegments).toEqual([]);
  });

  it("returns rule phase for Belgium and Belgian regions", () => {
    const national = resolveAxiomPath(["be", "statute"]);
    expect(national.phase).toBe("rule");
    expect(national.jurisdiction?.slug).toBe("be");
    expect(national.ruleSegments).toEqual(["statute"]);

    const brussels = resolveAxiomPath(["be-bru", "regulation"]);
    expect(brussels.phase).toBe("rule");
    expect(brussels.jurisdiction?.slug).toBe("be-bru");
    expect(brussels.ruleSegments).toEqual(["regulation"]);
  });
});

describe("buildBreadcrumbs", () => {
  it("returns only Axiom for empty segments", () => {
    const crumbs = buildBreadcrumbs([]);
    expect(crumbs).toEqual([{ label: "Axiom", href: "/axiom" }]);
  });

  it("builds jurisdiction breadcrumb for US", () => {
    const crumbs = buildBreadcrumbs(["us"]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "US Federal", href: "/us" },
    ]);
  });

  it("builds full path for US/statute/26/1", () => {
    const crumbs = buildBreadcrumbs(["us", "statute", "26", "1"]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "US Federal", href: "/us" },
      { label: "Statutes", href: "/us/statute" },
      { label: "Title 26", href: "/us/statute/26" },
      { label: "§ 1", href: "/us/statute/26/1" },
    ]);
  });

  it("formats nested statute breadcrumbs with parenthetical subsections", () => {
    const crumbs = buildBreadcrumbs(["us", "statute", "26", "24", "d", "1", "A"]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "US Federal", href: "/us" },
      { label: "Statutes", href: "/us/statute" },
      { label: "Title 26", href: "/us/statute/26" },
      { label: "§ 24", href: "/us/statute/26/24" },
      { label: "(d)", href: "/us/statute/26/24/d" },
      { label: "(1)", href: "/us/statute/26/24/d/1" },
      { label: "(A)", href: "/us/statute/26/24/d/1/A" },
    ]);
  });

  it("formats federal guidance breadcrumbs as source-document path segments", () => {
    const crumbs = buildBreadcrumbs([
      "us",
      "guidance",
      "usda",
      "fns",
      "snap-fy2026-cola",
    ]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "US Federal", href: "/us" },
      { label: "Guidance", href: "/us/guidance" },
      { label: "USDA", href: "/us/guidance/usda" },
      { label: "FNS", href: "/us/guidance/usda/fns" },
      {
        label: "SNAP FY2026 COLA",
        href: "/us/guidance/usda/fns/snap-fy2026-cola",
      },
    ]);
  });

  it("upper-cases shared-registry acronyms the old breadcrumb set lacked", () => {
    const crumbs = buildBreadcrumbs([
      "us",
      "guidance",
      "hhs",
      "tanf-eitc-notice",
    ]);
    expect(crumbs.slice(3)).toEqual([
      { label: "HHS", href: "/us/guidance/hhs" },
      { label: "TANF EITC Notice", href: "/us/guidance/hhs/tanf-eitc-notice" },
    ]);
  });

  it("builds breadcrumb for Federal Register rulemaking", () => {
    const crumbs = buildBreadcrumbs([
      "us",
      "rulemaking",
      "federal-register",
      "2026-05-15",
    ]);

    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "US Federal", href: "/us" },
      { label: "Rulemaking", href: "/us/rulemaking" },
      { label: "Federal Register", href: "/us/rulemaking/federal-register" },
      {
        label: "2026 05 15",
        href: "/us/rulemaking/federal-register/2026-05-15",
      },
    ]);
  });

  it("builds breadcrumb for UK", () => {
    const crumbs = buildBreadcrumbs(["uk"]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "United Kingdom", href: "/uk" },
    ]);
  });

  it("builds breadcrumb for UK with rule segments", () => {
    const crumbs = buildBreadcrumbs(["uk", "legislation", "uksi", "2013", "376"]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "United Kingdom", href: "/uk" },
      { label: "Legislation", href: "/uk/legislation" },
      { label: "UK Statutory Instruments", href: "/uk/legislation/uksi" },
      { label: "2013", href: "/uk/legislation/uksi/2013" },
      { label: "376", href: "/uk/legislation/uksi/2013/376" },
    ]);
  });

  it("builds breadcrumb for Ohio path", () => {
    const crumbs = buildBreadcrumbs(["us-oh", "statute", "26"]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "Ohio", href: "/us-oh" },
      { label: "Statutes", href: "/us-oh/statute" },
      { label: "Title 26", href: "/us-oh/statute/26" },
    ]);
  });

  it("builds breadcrumb for Colorado regulation path", () => {
    const crumbs = buildBreadcrumbs(["us-co", "regulation", "9-CCR-2503-6", "3.606.1", "I"]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "Colorado", href: "/us-co" },
      { label: "Regulations", href: "/us-co/regulation" },
      { label: "9 CCR 2503-6", href: "/us-co/regulation/9-CCR-2503-6" },
      { label: "§ 3.606.1", href: "/us-co/regulation/9-CCR-2503-6/3.606.1" },
      { label: "(I)", href: "/us-co/regulation/9-CCR-2503-6/3.606.1/I" },
    ]);
  });

  it("builds breadcrumb for Colorado statute path", () => {
    const crumbs = buildBreadcrumbs(["us-co", "statute", "crs", "26-2-703", "2.5"]);
    expect(crumbs).toEqual([
      { label: "Axiom", href: "/axiom" },
      { label: "Colorado", href: "/us-co" },
      { label: "Statutes", href: "/us-co/statute" },
      { label: "Colorado Revised Statutes", href: "/us-co/statute/crs" },
      { label: "§ 26-2-703", href: "/us-co/statute/crs/26-2-703" },
      { label: "(2.5)", href: "/us-co/statute/crs/26-2-703/2.5" },
    ]);
  });

  it("returns only Axiom for unknown jurisdiction", () => {
    const crumbs = buildBreadcrumbs(["mars"]);
    expect(crumbs).toEqual([{ label: "Axiom", href: "/axiom" }]);
  });

  it("does not prefix identifier-style statute segments with 'Title'", () => {
    const crumbs = buildBreadcrumbs(["us-mt", "statute", "Rule 35"]);
    expect(crumbs[3]).toEqual({
      label: "Rule 35",
      href: "/us-mt/statute/Rule 35",
    });
  });

  it("does not prefix identifier-style regulation segments with 'Title'/'Part'", () => {
    const crumbs = buildBreadcrumbs([
      "us-nh",
      "regulation",
      "he-w-700",
      "He-W 734.01",
    ]);
    expect(crumbs[3].label).toBe("He W 700");
    expect(crumbs[4]).toEqual({
      label: "He-W 734.01",
      href: "/us-nh/regulation/he-w-700/He-W 734.01",
    });
  });

  it("keeps numeric titles prefixed with 'Title'", () => {
    const crumbs = buildBreadcrumbs(["us", "statute", "26", "32"]);
    expect(crumbs[3].label).toBe("Title 26");
  });

  it("uses raw segment for unknown doc_type", () => {
    const crumbs = buildBreadcrumbs(["uk", "regulation"]);
    expect(crumbs[2].label).toBe("Regulation");
  });
});

describe("hasEncodedDescendant", () => {
  const paths = new Set(["statute/26/1/j/2", "statute/26/24/a", "statute/5/1"]);

  it("returns true for exact match", () => {
    expect(hasEncodedDescendant(paths, "statute/26/1/j/2")).toBe(true);
  });

  it("returns true for ancestor prefix", () => {
    expect(hasEncodedDescendant(paths, "statute/26")).toBe(true);
    expect(hasEncodedDescendant(paths, "statute/26/1")).toBe(true);
    expect(hasEncodedDescendant(paths, "statute/26/1/j")).toBe(true);
  });

  it("returns false when no encoded descendant exists", () => {
    expect(hasEncodedDescendant(paths, "statute/7")).toBe(false);
    expect(hasEncodedDescendant(paths, "statute/26/2")).toBe(false);
  });

  it("returns false for empty set", () => {
    expect(hasEncodedDescendant(new Set(), "statute/26")).toBe(false);
  });

  it("does not match partial segment names", () => {
    // "statute/26" should not match "statute/260/..."
    const testPaths = new Set(["statute/260/1"]);
    expect(hasEncodedDescendant(testPaths, "statute/26")).toBe(false);
  });
});

describe("getDocTypeNodes", () => {
  beforeEach(() => {
    vi.mocked(supabaseCorpus.from).mockReset();
  });

  it("uses cheap doc-type existence checks instead of citation-path sorting", async () => {
    const orderSpy = vi.fn();
    vi.mocked(supabaseCorpus.from).mockImplementation(() => {
      let docType = "";
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          if (column === "doc_type") docType = value;
          return builder;
        },
        is: () => builder,
        order: orderSpy,
        limit: () =>
          Promise.resolve({
            data: ["statute", "regulation", "rulemaking"].includes(docType)
              ? [{ id: `${docType}-root` }]
              : [],
            error: null,
          }),
      } as never;
      return builder;
    });

    const nodes = await getDocTypeNodes("us-co");

    expect(orderSpy).not.toHaveBeenCalled();
    expect(nodes.map((n) => n.segment)).toEqual([
      "regulation",
      "rulemaking",
      "statute",
    ]);
  });

  it("falls back to an unsorted scan for unexpected doc-type buckets", async () => {
    const rangeSpy = vi.fn();
    vi.mocked(supabaseCorpus.from).mockImplementation(() => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
        range: (...args: unknown[]) => {
          rangeSpy(...args);
          return Promise.resolve({
            data: [{ doc_type: "manual" }],
            error: null,
          });
        },
      } as never;
      return builder;
    });

    const nodes = await getDocTypeNodes("us-co");

    expect(rangeSpy).toHaveBeenCalledWith(0, 999);
    expect(nodes.map((n) => n.segment)).toEqual(["manual"]);
  });

  it("does not expose doc_type values whose citation path uses a different root segment", async () => {
    vi.mocked(supabaseCorpus.from).mockImplementation(() => {
      let docType = "";
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          if (column === "doc_type") docType = value;
          return builder;
        },
        is: () => builder,
        limit: () =>
          Promise.resolve({
            data:
              docType === "regulation"
                ? [{ citation_path: "uk/legislation/uksi/2013/376" }]
                : [],
            error: null,
          }),
        range: () => Promise.resolve({ data: [], error: null }),
      } as never;
      return builder;
    });

    const nodes = await getDocTypeNodes("uk");

    expect(nodes.map((n) => n.segment)).toEqual([]);
  });
});

describe("getTitleNodes — root navigation", () => {
  beforeEach(() => {
    vi.mocked(supabaseCorpus.from).mockReset();
  });

  it("uses one root-level query for state doc-type navigation", async () => {
    const rootQuery = queryMock({
      data: [
        {
          id: "10-ccr",
          jurisdiction: "us-co",
          doc_type: "regulation",
          citation_path: "us-co/regulation/10-CCR-2506-1",
          heading: "Human Services",
        },
      ],
      error: null,
    }) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    vi.mocked(supabaseCorpus.from).mockReturnValue(rootQuery as never);

    const nodes = await getTitleNodes("us-co", "regulation");

    expect(nodes.map((n) => n.segment)).toEqual(["10-CCR-2506-1"]);
    expect(nodes[0].label).toBe("Human Services");
    expect(rootQuery.eq).toHaveBeenCalledWith("level", 1);
  });

  it("walks citation-path children when root-level rows are absent", async () => {
    const emptyRootQuery = queryMock({ data: [], error: null });
    const emptyAlternateRootQuery = queryMock({ data: [], error: null });
    const pages = [
      [
        {
          id: "bpc",
          jurisdiction: "us-ca",
          doc_type: "statute",
          citation_path: "us-ca/statute/bpc",
          heading: "Business and Professions Code - BPC",
        },
        {
          id: "bpc-1",
          jurisdiction: "us-ca",
          doc_type: "statute",
          citation_path: "us-ca/statute/bpc/1",
          heading: "1.",
        },
      ],
      [
        {
          id: "ccp",
          jurisdiction: "us-ca",
          doc_type: "statute",
          citation_path: "us-ca/statute/ccp",
          heading: "Code of Civil Procedure - CCP",
        },
      ],
      [],
    ];
    const prefixQuery = queryMock(
      { data: [], error: null },
      "limit"
    ) as unknown as Record<string, unknown>;
    prefixQuery.limit = vi.fn(() =>
      Promise.resolve({ data: pages.shift(), error: null })
    );
    vi.mocked(supabaseCorpus.from)
      .mockReturnValueOnce(emptyRootQuery)
      .mockReturnValueOnce(emptyAlternateRootQuery)
      .mockReturnValue(prefixQuery as never);

    const nodes = await getTitleNodes("us-ca", "statute");

    expect(nodes.map((n) => n.segment)).toEqual(["bpc", "ccp"]);
  });

  it("walks citation-path children when root-level navigation queries fail", async () => {
    const failingRootQuery = queryMock({
      data: null,
      error: { message: "root query timed out" },
    });
    const failingAlternateRootQuery = queryMock({
      data: null,
      error: { message: "alternate root query timed out" },
    });
    const pages = [
      [
        {
          id: "crs",
          jurisdiction: "us-co",
          doc_type: "statute",
          citation_path: "us-co/statute/crs",
          heading: "Colorado Revised Statutes",
        },
        {
          id: "crs-26",
          jurisdiction: "us-co",
          doc_type: "statute",
          citation_path: "us-co/statute/crs/26-2-703",
          heading: "26-2-703.",
        },
      ],
      [],
    ];
    const prefixQuery = queryMock(
      { data: [], error: null },
      "limit"
    ) as unknown as Record<string, unknown>;
    prefixQuery.limit = vi.fn(() =>
      Promise.resolve({ data: pages.shift(), error: null })
    );
    vi.mocked(supabaseCorpus.from)
      .mockReturnValueOnce(failingRootQuery)
      .mockReturnValueOnce(failingAlternateRootQuery)
      .mockReturnValue(prefixQuery as never);

    const nodes = await getTitleNodes("us-co", "statute");

    expect(nodes.map((n) => n.segment)).toEqual(["crs"]);
    expect(nodes[0].label).toBe("Colorado Revised Statutes");
  });

  it("derives synthetic title buckets from deeper rows when title roots are absent", async () => {
    const emptyRootQuery = queryMock({ data: [], error: null });
    const emptyAlternateRootQuery = queryMock({ data: [], error: null });
    const pages = [
      [
        {
          id: "title-1-part",
          jurisdiction: "ca",
          doc_type: "regulation",
          citation_path: "ca/regulation/1/1",
          heading: "Part 1",
        },
      ],
      [
        {
          id: "title-10-part",
          jurisdiction: "ca",
          doc_type: "regulation",
          citation_path: "ca/regulation/10/1",
          heading: "Part 1",
        },
      ],
      [],
    ];
    const prefixQuery = queryMock(
      { data: [], error: null },
      "limit"
    ) as unknown as Record<string, unknown>;
    prefixQuery.limit = vi.fn(() =>
      Promise.resolve({ data: pages.shift(), error: null })
    );
    vi.mocked(supabaseCorpus.from)
      .mockReturnValueOnce(emptyRootQuery)
      .mockReturnValueOnce(emptyAlternateRootQuery)
      .mockReturnValue(prefixQuery as never);

    const nodes = await getTitleNodes("ca", "regulation");

    expect(nodes.map((n) => n.segment)).toEqual(["1", "10"]);
    expect(nodes.map((n) => n.rule)).toEqual([undefined, undefined]);
  });

  it("throws unavailable instead of returning an empty tree on corpus errors", async () => {
    const failingRootQuery = queryMock({
      data: null,
      error: { message: "network unavailable" },
    });
    vi.mocked(supabaseCorpus.from).mockReturnValue(failingRootQuery);

    await expect(getTitleNodes("us-co", "statute")).rejects.toBeInstanceOf(
      TreeDataUnavailableError
    );
  });
});

describe("isUUID", () => {
  it("detects valid UUIDs", () => {
    expect(isUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
  });

  it("rejects non-UUIDs", () => {
    expect(isUUID("us")).toBe(false);
    expect(isUUID("statute")).toBe(false);
    expect(isUUID("26")).toBe(false);
    expect(isUUID("not-a-uuid-at-all")).toBe(false);
    expect(isUUID("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });
});

const mockRule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "test-id",
  jurisdiction: "us",
  doc_type: "statute",
  parent_id: null,
  level: 0,
  ordinal: null,
  heading: null,
  body: null,
  effective_date: null,
  repeal_date: null,
  source_url: null,
  source_path: null,
  citation_path: null,
  rulespec_path: null,
  has_rulespec: false,
  created_at: "",
  updated_at: "",
  ...overrides,
});

describe("resolveDisplayContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns self as displayRoot with empty children for root-level node", async () => {
    const rule = mockRule({ id: "root-1", parent_id: null });

    const result = await resolveDisplayContext(rule);

    expect(result.rule).toEqual(rule);
    expect(result.parentBody).toBeNull();
    expect(result.siblings).toEqual([rule]);
    expect(result.targetIndex).toBe(0);
  });

  it("fetches parent and siblings for leaf with parent", async () => {
    const parentRule = mockRule({ id: "parent-1", heading: "Parent" });
    const sibling1 = mockRule({ id: "sib-1", parent_id: "parent-1", ordinal: 1 });
    const sibling2 = mockRule({ id: "sib-2", parent_id: "parent-1", ordinal: 2 });
    const leaf = mockRule({ id: "leaf-1", parent_id: "parent-1", ordinal: 3 });

    const mockSingle = vi.fn().mockResolvedValue({ data: parentRule, error: null });
    const mockEqParent = vi.fn().mockReturnValue({ single: mockSingle });
    const mockOrder = vi.fn().mockResolvedValue({
      data: [sibling1, sibling2, leaf],
      error: null,
    });
    const mockEqSiblings = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn((col: string, val: string) => {
        if (col === "id") return mockEqParent(col, val);
        if (col === "parent_id") return mockEqSiblings(col, val);
        return { single: mockSingle };
      }),
    });
    vi.mocked(supabaseCorpus.from).mockReturnValue({ select: mockSelect } as any);

    const result = await resolveDisplayContext(leaf);

    expect(result.rule).toEqual(leaf);
    expect(result.parentBody).toBeNull(); // parentRule has no body
    expect(result.siblings).toEqual([sibling1, sibling2, leaf]);
    expect(result.targetIndex).toBe(2);
  });

  it("falls back to self when parent fetch fails", async () => {
    const leaf = mockRule({ id: "leaf-1", parent_id: "parent-1" });

    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } });
    const mockEqParent = vi.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ single: mockSingle }),
    });
    vi.mocked(supabaseCorpus.from).mockReturnValue({ select: mockSelect } as any);

    const result = await resolveDisplayContext(leaf);

    expect(result.rule).toEqual(leaf);
    expect(result.parentBody).toBeNull();
    expect(result.siblings).toEqual([leaf]);
    expect(result.targetIndex).toBe(0);
  });

  it("returns children ordered by ordinal for multiple siblings", async () => {
    const parentRule = mockRule({ id: "parent-1" });
    const child1 = mockRule({ id: "c1", parent_id: "parent-1", ordinal: 1 });
    const child3 = mockRule({ id: "c3", parent_id: "parent-1", ordinal: 3 });
    const child2 = mockRule({ id: "c2", parent_id: "parent-1", ordinal: 2 });
    const leaf = mockRule({ id: "c2", parent_id: "parent-1", ordinal: 2 });

    const mockSingle = vi.fn().mockResolvedValue({ data: parentRule, error: null });
    const mockOrder = vi.fn().mockResolvedValue({
      data: [child1, child2, child3],
      error: null,
    });
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn((col: string) => {
        if (col === "id") return { single: mockSingle };
        if (col === "parent_id") return { order: mockOrder };
        return { single: mockSingle };
      }),
    });
    vi.mocked(supabaseCorpus.from).mockReturnValue({ select: mockSelect } as any);

    const result = await resolveDisplayContext(leaf);

    expect(result.siblings).toEqual([child1, child2, child3]);
    expect(result.siblings[0].ordinal).toBe(1);
    expect(result.siblings[1].ordinal).toBe(2);
    expect(result.siblings[2].ordinal).toBe(3);
  });

  it("falls back to empty siblings when siblings query returns null data", async () => {
    const parentRule = mockRule({ id: "parent-1", body: "intro text" });
    const leaf = mockRule({ id: "leaf-1", parent_id: "parent-1" });

    const mockSingle = vi.fn().mockResolvedValue({ data: parentRule, error: null });
    const mockOrder = vi.fn().mockResolvedValue({ data: null, error: { message: "fail" } });
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn((col: string) => {
        if (col === "id") return { single: mockSingle };
        if (col === "parent_id") return { order: mockOrder };
        return { single: mockSingle };
      }),
    });
    vi.mocked(supabaseCorpus.from).mockReturnValue({ select: mockSelect } as any);

    const result = await resolveDisplayContext(leaf);

    expect(result.siblings).toEqual([]);
    expect(result.targetIndex).toBe(0);
    expect(result.parentBody).toBe("intro text");
  });

  it("defaults targetIndex to 0 when leaf not found in siblings", async () => {
    const parentRule = mockRule({ id: "parent-1" });
    const otherChild = mockRule({ id: "other-1", parent_id: "parent-1", ordinal: 1 });
    const leaf = mockRule({ id: "leaf-missing", parent_id: "parent-1" });

    const mockSingle = vi.fn().mockResolvedValue({ data: parentRule, error: null });
    const mockOrder = vi.fn().mockResolvedValue({ data: [otherChild], error: null });
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn((col: string) => {
        if (col === "id") return { single: mockSingle };
        if (col === "parent_id") return { order: mockOrder };
        return { single: mockSingle };
      }),
    });
    vi.mocked(supabaseCorpus.from).mockReturnValue({ select: mockSelect } as any);

    const result = await resolveDisplayContext(leaf);

    expect(result.targetIndex).toBe(0);
    expect(result.siblings).toEqual([otherChild]);
  });
});

describe("getTitleNodes — encoded-only at /us/regulation", () => {
  beforeEach(() => {
    vi.mocked(supabaseCorpus.from).mockReset();
  });

  it("returns exactly the three CFR Title 7 sections we have encoded today", async () => {
    // Corpus has no row for ``us/regulation`` itself — the parent
    // lookup falls through to the encoded-only branch.
    // The function fans out into two different query shapes:
    //   • parent lookup:    .select().eq().maybeSingle() → null
    //   • per-title count:  .select().gte().lt().is()    → count: 1
    const countResult = Promise.resolve({ count: 1, data: null, error: null });
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lt: () => builder,
      is: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: countResult.then.bind(countResult),
    } as unknown as never;
    vi.mocked(supabaseCorpus.from).mockReturnValue(builder);

    // After ``parseTreeEntries`` strips the ``-cfr`` suffix on US
    // regulation titles, the three encoded ``rulespec-us`` files surface
    // in the encoded-paths set as ``regulation/7/273/{3,4,5}``.
    const encodedPaths = new Set<string>([
      "regulation/7/273/3",
      "regulation/7/273/4",
      "regulation/7/273/5",
      "statute/26/3101/a",
      "policy/usda/snap/fy-2026-cola/deductions",
    ]);

    const nodes = await getTitleNodes("us", "regulation", encodedPaths, true);

    // The three encoded sections all live under CFR Title 7, so the
    // title-level list collapses to a single entry.
    expect(nodes.map((n) => n.segment)).toEqual(["7"]);
    expect(nodes[0]).toMatchObject({
      segment: "7",
      label: "Title 7",
      hasChildren: true,
      nodeType: "title",
    });
  });

  it("returns an empty list when no encoded path lives under the requested doc-type", async () => {
    // The function fans out into two different query shapes:
    //   • parent lookup:    .select().eq().maybeSingle() → null
    //   • per-title count:  .select().gte().lt().is()    → count: 1
    const countResult = Promise.resolve({ count: 1, data: null, error: null });
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lt: () => builder,
      is: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: countResult.then.bind(countResult),
    } as unknown as never;
    vi.mocked(supabaseCorpus.from).mockReturnValue(builder);

    const encodedPaths = new Set<string>([
      "statute/26/3101/a",
      "policy/usda/snap/fy-2026-cola/deductions",
    ]);

    const nodes = await getTitleNodes(
      "us",
      "regulation",
      encodedPaths,
      true
    );
    expect(nodes).toEqual([]);
  });
});

describe("getSectionNodes — encoded-only short-circuit", () => {
  beforeEach(() => {
    vi.mocked(supabaseCorpus.from).mockReset();
  });

  it("pulls encoded sections directly when the parent_id tree puts them under intermediate subparts", async () => {
    // Corpus parents 7 CFR 273.3 under ``subpart-B`` while the
    // rulespec-us repo files it as bare ``273/3.yaml``. The encoded-only
    // branch should resolve that mismatch by querying the encoded
    // citation paths directly.
    const partRow = {
      id: "part-273",
      citation_path: "us/regulation/7/273",
      heading: "CERTIFICATION OF ELIGIBLE HOUSEHOLDS",
    };
    const encodedRow = {
      id: "section-273-3",
      citation_path: "us/regulation/7/273/3",
      heading: "Residency",
      jurisdiction: "us",
      doc_type: "regulation",
      parent_id: "subpart-B",
      has_rulespec: false,
    };
    const inSpy = vi.fn();
    vi.mocked(supabaseCorpus.from).mockImplementation(() => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: (...args: unknown[]) => {
          inSpy(...args);
          return builder;
        },
        order: () =>
          Promise.resolve({ data: [encodedRow], error: null }),
        maybeSingle: () => Promise.resolve({ data: partRow, error: null }),
      } as never;
      return builder;
    });

    const result = await getSectionNodes(
      "us/regulation/7/273",
      0,
      new Set([
        "regulation/7/273/3",
        "regulation/7/273/4",
        "regulation/7/273/5",
        "statute/26/3101/a",
      ]),
      true
    );

    expect(result.nodes.map((n) => n.rule?.citation_path)).toEqual([
      "us/regulation/7/273/3",
    ]);
    expect(inSpy).toHaveBeenCalledWith(
      "citation_path",
      expect.arrayContaining([
        "us/regulation/7/273/3",
        "us/regulation/7/273/4",
        "us/regulation/7/273/5",
      ])
    );
  });

  it("returns an empty list (with currentRule) when no encoded path lives under the requested prefix", async () => {
    const partRow = {
      id: "part-273",
      citation_path: "us/regulation/7/273",
      heading: "CERTIFICATION OF ELIGIBLE HOUSEHOLDS",
    };
    vi.mocked(supabaseCorpus.from).mockImplementation(() => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: partRow, error: null }),
      } as never;
      return builder;
    });

    const result = await getSectionNodes(
      "us/regulation/7/273",
      0,
      new Set(["statute/26/3101/a"]),
      true
    );
    expect(result.nodes).toEqual([]);
    expect(result.currentRule?.citation_path).toBe("us/regulation/7/273");
  });
});

describe("getSectionNodes — citation path aliases", () => {
  beforeEach(() => {
    vi.mocked(supabaseCorpus.from).mockReset();
  });

  it("resolves chapter-prefixed state statute URLs to canonical section rows", async () => {
    const canonical = {
      id: "ky-12-215",
      jurisdiction: "us-ky",
      doc_type: "statute",
      parent_id: "chapter-12",
      level: 2,
      ordinal: 12215,
      heading: "Expenses incurred by Attorney General",
      body: "The expenses incurred by the Attorney General...",
      effective_date: null,
      repeal_date: null,
      source_url: null,
      source_path: null,
      citation_path: "us-ky/statute/3/12.215",
      rulespec_path: null,
      has_rulespec: false,
      created_at: "",
      updated_at: "",
    };

    vi.mocked(supabaseCorpus.from).mockImplementation(() => {
      let citationPath = "";
      const builder = {
        select: () => builder,
        eq: (_column: string, value: string) => {
          citationPath = value;
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data:
              citationPath === "us-ky/statute/3/12.215" ? canonical : null,
            error: null,
          }),
        gte: () => builder,
        lt: () => builder,
        is: () => builder,
        order: () => builder,
        range: () => Promise.resolve({ data: [], error: null }),
      } as never;
      return builder;
    });

    const result = await getSectionNodes(
      "us-ky/statute/3/chapter-12/12.215"
    );

    expect(result.leafRule?.citation_path).toBe("us-ky/statute/3/12.215");
    expect(result.leafRule?.heading).toBe(
      "Expenses incurred by Attorney General"
    );
  });

  it("lists Colorado policy agency folders from canonical page rows", async () => {
    const snapPage = {
      id: "snap-page",
      jurisdiction: "us-co",
      doc_type: "policy",
      parent_id: null,
      level: 1,
      ordinal: 2,
      heading: "Supplemental Nutrition Assistance Program (SNAP)",
      body: null,
      effective_date: null,
      repeal_date: null,
      source_url: null,
      source_path: null,
      citation_path: "us-co/policy/co-cdhs-snap-page",
      rulespec_path: null,
      has_rulespec: false,
      created_at: "",
      updated_at: "",
    };
    const abawdPage = {
      ...snapPage,
      id: "abawd-page",
      ordinal: 1,
      heading: "Able-Bodied Adults Without Dependents",
      citation_path: "us-co/policy/co-cdhs-abawd-page",
    };

    const parentLookup = {
      select: () => parentLookup,
      eq: () => parentLookup,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    } as never;
    const agencyLookup = {
      select: () => agencyLookup,
      gte: () => agencyLookup,
      lt: () => agencyLookup,
      order: () => agencyLookup,
      range: () =>
        Promise.resolve({ data: [snapPage, abawdPage], error: null }),
    } as never;

    vi.mocked(supabaseCorpus.from)
      .mockReturnValueOnce(parentLookup)
      .mockReturnValueOnce(agencyLookup);

    const result = await getSectionNodes("us-co/policy/cdhs");

    expect(result.nodes.map((node) => node.segment)).toEqual([
      "abawd-page",
      "snap-page",
    ]);
    expect(result.nodes.map((node) => node.rule?.citation_path)).toEqual([
      "us-co/policy/co-cdhs-abawd-page",
      "us-co/policy/co-cdhs-snap-page",
    ]);
  });

  it("resolves Colorado policy agency URLs to canonical page rows", async () => {
    const parent = {
      id: "snap-page",
      jurisdiction: "us-co",
      doc_type: "policy",
      parent_id: null,
      level: 1,
      ordinal: 1,
      heading: "Supplemental Nutrition Assistance Program (SNAP)",
      body: null,
      effective_date: null,
      repeal_date: null,
      source_url: null,
      source_path: null,
      citation_path: "us-co/policy/co-cdhs-snap-page",
      rulespec_path: null,
      has_rulespec: false,
      created_at: "",
      updated_at: "",
    };
    const child = {
      ...parent,
      id: "block-1",
      parent_id: "snap-page",
      level: 2,
      heading: "How it works",
      citation_path: "us-co/policy/co-cdhs-snap-page/block-1",
    };

    vi.mocked(supabaseCorpus.from).mockImplementation(() => {
      let citationPath = "";
      let parentId = "";
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          if (column === "citation_path") citationPath = value;
          if (column === "parent_id") parentId = value;
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data:
              citationPath === "us-co/policy/co-cdhs-snap-page"
                ? parent
                : null,
            error: null,
          }),
        order: () => builder,
        range: () =>
          Promise.resolve({
            data: parentId === "snap-page" ? [child] : [],
            count: parentId === "snap-page" ? 1 : 0,
            error: null,
          }),
      } as never;
      return builder;
    });

    const result = await getSectionNodes("us-co/policy/cdhs/snap-page");

    expect(result.currentRule?.citation_path).toBe(
      "us-co/policy/co-cdhs-snap-page"
    );
    expect(result.nodes.map((node) => node.segment)).toEqual(["block-1"]);
  });
});
