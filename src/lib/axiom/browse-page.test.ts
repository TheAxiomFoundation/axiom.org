import { describe, it, expect, vi, beforeEach } from "vitest";

const { loadTreeNodesMock, encodingsFromMock, corpusFromMock } = vi.hoisted(
  () => ({
    loadTreeNodesMock: vi.fn(),
    encodingsFromMock: vi.fn(),
    corpusFromMock: vi.fn(),
  })
);

vi.mock("@/lib/axiom/tree-node-loader", () => ({
  loadTreeNodes: loadTreeNodesMock,
}));

vi.mock("@/lib/supabase", () => ({
  supabaseEncodings: { from: encodingsFromMock },
  supabaseCorpus: { from: corpusFromMock },
}));

/** Thenable stand-in for the corpus heading lookup; records the
 *  citation paths it was asked for. */
function corpusHeadingRows(result: { data: unknown; error: unknown }) {
  const asked: string[][] = [];
  corpusFromMock.mockImplementation(() => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.in = (_column: string, paths: string[]) => {
      asked.push(paths);
      return self;
    };
    self.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    return self;
  });
  return asked;
}

/** Thenable PostgREST stand-in resolving one canned mirror result. */
function encodedCountRows(result: { data: unknown; error: unknown }) {
  encodingsFromMock.mockImplementation(() => {
    const self: Record<string, unknown> = {};
    for (const method of ["select", "like", "limit", "not", "order"]) {
      self[method] = () => self;
    }
    self.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    return self;
  });
}

import {
  browseTitle,
  ENCODED_LIST_MAX,
  getBrowsePageData,
  type BrowsePageData,
} from "./browse-page";


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

describe("getBrowsePageData", () => {
  beforeEach(() => {
    loadTreeNodesMock.mockReset();
    encodingsFromMock.mockReset();
    corpusFromMock.mockReset();
    corpusHeadingRows({ data: [], error: null });
    // Default: the mirror answers nothing, as it did before this file
    // mocked it at all (a real client against the placeholder URL).
    encodedCountRows({ data: [], error: null });
    loadTreeNodesMock.mockResolvedValue({
      nodes: [
        {
          segment: "statute",
          label: "Statute",
          hasChildren: true,
          nodeType: "doc_type",
        },
      ],
      hasMore: false,
    });
  });

  it("assembles jurisdiction-level browse data", async () => {
    const data = await getBrowsePageData(["us"]);
    expect(data?.jurisdictionLabel).toBe("US Federal");
    expect(data?.nodes.map((node) => node.segment)).toEqual(["statute"]);
    expect(loadTreeNodesMock).toHaveBeenCalledWith(
      expect.objectContaining({ dbJurisdictionId: "us", ruleSegments: [] })
    );
  });

  it("passes doc-type and title segments through to the loader", async () => {
    await getBrowsePageData(["us", "statute", "26"]);
    expect(loadTreeNodesMock).toHaveBeenCalledWith(
      expect.objectContaining({ ruleSegments: ["statute", "26"] })
    );
  });

  it("rejects section depth and empty paths", async () => {
    expect(await getBrowsePageData([])).toBeNull();
    expect(
      await getBrowsePageData(["us", "statute", "26", "32"])
    ).toBeNull();
    expect(loadTreeNodesMock).not.toHaveBeenCalled();
  });

  it("reports backend failures as unavailable, not nonexistence", async () => {
    loadTreeNodesMock.mockRejectedValue(new Error("db down"));
    expect(await getBrowsePageData(["us"])).toBe("unavailable");
  });

  it("counts encoded files per child segment from the mirror", async () => {
    encodedCountRows({
      data: [
        { citation_path: "us/statute/26" },
        { citation_path: "us/statute/26/32" },
      ],
      error: null,
    });
    const data = await getBrowsePageData(["us"]);
    expect(data).not.toBe("unavailable");
    expect((data as { encodedCounts: Record<string, number> }).encodedCounts)
      .toEqual({ statute: 2 });
  });

  it("lists a small jurisdiction's encodings on its root, with headings", async () => {
    encodedCountRows({
      data: [
        { citation_path: "il/statute/income-tax-ordinance/section-36a" },
        { citation_path: "il/statute/income-tax-ordinance/section-121" },
        { citation_path: "il/statute/composed/net-pipeline" },
        { citation_path: "il/statute/income-tax-ordinance/section-121" },
      ],
      error: null,
    });
    const asked = corpusHeadingRows({
      data: [
        {
          citation_path: "il/statute/income-tax-ordinance/section-121",
          heading: " שיעור המס ליחיד ",
        },
        {
          citation_path: "il/statute/income-tax-ordinance",
          heading: "פקודת מס הכנסה [נוסח חדש]",
        },
      ],
      error: null,
    });
    const data = (await getBrowsePageData(["il"])) as BrowsePageData;
    // Deduplicated, in numeric path order: § 36a sorts before § 121.
    expect(data.encodedEntries).toEqual([
      {
        citationPath: "il/statute/composed/net-pipeline",
        heading: null,
        group: "composed",
        groupHeading: null,
      },
      {
        citationPath: "il/statute/income-tax-ordinance/section-36a",
        heading: null,
        group: "income-tax-ordinance",
        groupHeading: "פקודת מס הכנסה [נוסח חדש]",
      },
      {
        citationPath: "il/statute/income-tax-ordinance/section-121",
        heading: "שיעור המס ליחיד",
        group: "income-tax-ordinance",
        groupHeading: "פקודת מס הכנסה [נוסח חדש]",
      },
    ]);
    // One lookup covers the provisions and their titles.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("il/statute/income-tax-ordinance");
    expect(asked[0]).toContain("il/statute/income-tax-ordinance/section-121");
  });

  it("still lists the paths when the heading lookup fails", async () => {
    encodedCountRows({
      data: [{ citation_path: "il/statute/income-tax-ordinance/section-121" }],
      error: null,
    });
    corpusHeadingRows({ data: null, error: { message: "down" } });
    const data = (await getBrowsePageData(["il"])) as BrowsePageData;
    expect(data.encodedEntries).toEqual([
      {
        citationPath: "il/statute/income-tax-ordinance/section-121",
        heading: null,
        group: "income-tax-ordinance",
        groupHeading: null,
      },
    ]);
  });

  it("lists nothing for a large jurisdiction, below the root, or on later pages", async () => {
    const many = Array.from({ length: ENCODED_LIST_MAX + 1 }, (_, index) => ({
      citation_path: `us/statute/26/${index + 1}`,
    }));
    encodedCountRows({ data: many, error: null });
    const large = (await getBrowsePageData(["us"])) as BrowsePageData;
    expect(large.encodedEntries).toBeUndefined();
    expect(large.encodedCounts).toEqual({ statute: ENCODED_LIST_MAX + 1 });

    encodedCountRows({
      data: [{ citation_path: "il/statute/income-tax-ordinance/section-121" }],
      error: null,
    });
    const deeper = (await getBrowsePageData(["il", "statute"])) as BrowsePageData;
    expect(deeper.encodedEntries).toBeUndefined();
    const later = (await getBrowsePageData(["il"], 1)) as BrowsePageData;
    expect(later.encodedEntries).toBeUndefined();

    encodedCountRows({ data: [], error: null });
    const none = (await getBrowsePageData(["il"])) as BrowsePageData;
    expect(none.encodedEntries).toBeUndefined();
    expect(corpusFromMock).not.toHaveBeenCalled();
  });

  it("shows no encoded coverage for a gated pilot family", async () => {
    // Israel's rulespec-xg is registered app_visibility="experimental",
    // so a leaked mirror row must not put coverage marks on its browse
    // rows — the reader would refuse every file behind them.
    encodedCountRows({
      data: [{ citation_path: "xg/statute/income-tax-ordinance" }],
      error: null,
    });

    const data = await getBrowsePageData(["xg"]);

    expect(data).not.toBe("unavailable");
    expect((data as { encodedCounts: Record<string, number> }).encodedCounts)
      .toEqual({});
    // Refused before the query, not after it.
    expect(encodingsFromMock).not.toHaveBeenCalled();
  });
});

describe("browseTitle", () => {
  it("names a jurisdiction from the seed, falling back to the raw slug", () => {
    // browseTitle reads resolveAxiomPath().jurisdiction?.label, which comes
    // from JURISDICTIONS_SEED, so a seeded slug is the difference between
    // "Israel · Axiom" and "il · Axiom" in the browser tab.
    expect(browseTitle(["il"])).toBe("Israel");
    expect(browseTitle(["us-il"])).toBe("Illinois");
    expect(browseTitle(["il", "statute"])).toBe("Statutes · Israel");
    // An unseeded, unsynthesisable slug still renders, unlabelled.
    expect(browseTitle(["zz"])).toBe("zz");
  });
});
