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
        // The mirror has shipped duplicate rows per path.
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
    // Distinct paths, in numeric path order: § 36a sorts before § 121.
    expect(data.encodedEntries).toEqual([
      {
        citationPath: "il/statute/composed/net-pipeline",
        heading: null,
        group: "il/statute/composed",
        groupHeading: null,
      },
      {
        citationPath: "il/statute/income-tax-ordinance/section-36a",
        heading: null,
        group: "il/statute/income-tax-ordinance",
        groupHeading: "פקודת מס הכנסה [נוסח חדש]",
      },
      {
        citationPath: "il/statute/income-tax-ordinance/section-121",
        heading: "שיעור המס ליחיד",
        group: "il/statute/income-tax-ordinance",
        groupHeading: "פקודת מס הכנסה [נוסח חדש]",
      },
    ]);
    // The coverage mark counts the same distinct paths as the list:
    // a duplicate row must not make "∀ 4" sit above "Encoded so far · 3".
    expect(data.encodedCounts).toEqual({ statute: 3 });
    // One lookup covers the provisions and their candidate instruments.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("il/statute/income-tax-ordinance");
    expect(asked[0]).toContain("il/statute/income-tax-ordinance/section-121");
  });

  it("groups at the instrument the corpus names, whatever its depth", async () => {
    encodedCountRows({
      data: [
        { citation_path: "uk/legislation/uksi/2013/376/regulation/22/1/b" },
        { citation_path: "uk/legislation/uksi/2013/376/regulation/36" },
        { citation_path: "uk/legislation/ukpga/2002/16/section/3ZA" },
        { citation_path: "de/statute/bgb" },
      ],
      error: null,
    });
    const asked = corpusHeadingRows({
      data: [
        {
          citation_path: "uk/legislation/uksi/2013/376",
          heading: "The Universal Credit Regulations 2013",
        },
        // A heading deeper than the instrument must not become the group.
        {
          citation_path: "uk/legislation/uksi/2013/376/regulation/22",
          heading: "Deduction of income",
        },
      ],
      error: null,
    });
    const data = (await getBrowsePageData(["uk"])) as BrowsePageData;
    const groups = Object.fromEntries(
      (data.encodedEntries ?? []).map((entry) => [
        entry.citationPath,
        [entry.group, entry.groupHeading],
      ])
    );
    expect(groups).toEqual({
      // The shallowest headed ancestor: the instrument, five segments deep.
      "uk/legislation/uksi/2013/376/regulation/22/1/b": [
        "uk/legislation/uksi/2013/376",
        "The Universal Credit Regulations 2013",
      ],
      "uk/legislation/uksi/2013/376/regulation/36": [
        "uk/legislation/uksi/2013/376",
        "The Universal Credit Regulations 2013",
      ],
      // No headed ancestor: the first three segments.
      "uk/legislation/ukpga/2002/16/section/3ZA": [
        "uk/legislation/ukpga",
        null,
      ],
      // An entry that shallow groups under its doc type, not under itself.
      "de/statute/bgb": ["de/statute", null],
    });
    // Candidates stop at six segments and never include the path itself
    // as its own ancestor.
    expect(asked[0]).toContain("uk/legislation/uksi/2013/376/regulation");
    expect(asked[0]).not.toContain("uk/legislation/uksi/2013/376/regulation/22/1");
    expect(asked[0]).not.toContain("uk/legislation");
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
        group: "il/statute/income-tax-ordinance",
        groupHeading: null,
      },
    ]);
  });

  it("gives the scan and the heading lookup one shared time budget", async () => {
    vi.useFakeTimers();
    try {
      encodedCountRows({
        data: [{ citation_path: "il/statute/income-tax-ordinance/section-121" }],
        error: null,
      });
      // A corpus that never answers.
      corpusFromMock.mockImplementation(() => {
        const self: Record<string, unknown> = {};
        self.select = () => self;
        self.in = () => self;
        self.then = () => new Promise(() => {});
        return self;
      });
      const pending = getBrowsePageData(["il"]);
      // The whole page resolves inside one 3-second budget, not two.
      await vi.advanceTimersByTimeAsync(3000);
      const data = (await pending) as BrowsePageData;
      expect(data.encodedEntries?.map((entry) => entry.heading)).toEqual([null]);
      // Whichever side wins, no timer is left running.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
    expect(corpusFromMock).not.toHaveBeenCalled();
  });

  it("counts duplicates once when deciding whether the list fits", async () => {
    // ENCODED_LIST_MAX distinct paths, each shipped twice: the list
    // still renders. Measured on raw rows it would silently vanish.
    const rows = Array.from({ length: ENCODED_LIST_MAX }, (_, index) => ({
      citation_path: `il/statute/income-tax-ordinance/section-${index + 1}`,
    }));
    encodedCountRows({ data: [...rows, ...rows], error: null });
    const data = (await getBrowsePageData(["il"])) as BrowsePageData;
    expect(data.encodedEntries).toHaveLength(ENCODED_LIST_MAX);
  });

  it("asks the corpus nothing when the scan finds no encodings", async () => {
    encodedCountRows({ data: [], error: null });
    const data = (await getBrowsePageData(["il"])) as BrowsePageData;
    expect(data.encodedEntries).toBeUndefined();
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
    // The list is a second place a gated family could leak: it must
    // name nothing, and must not ask the corpus about its paths.
    expect((data as BrowsePageData).encodedEntries).toBeUndefined();
    expect(corpusFromMock).not.toHaveBeenCalled();
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
