import { describe, it, expect, vi, beforeEach } from "vitest";

const { loadTreeNodesMock, encodingsFromMock } = vi.hoisted(() => ({
  loadTreeNodesMock: vi.fn(),
  encodingsFromMock: vi.fn(),
}));

vi.mock("@/lib/axiom/tree-node-loader", () => ({
  loadTreeNodes: loadTreeNodesMock,
}));

vi.mock("@/lib/supabase", () => ({
  supabaseEncodings: { from: encodingsFromMock },
}));

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

import { browseTitle, getBrowsePageData } from "./browse-page";

describe("getBrowsePageData", () => {
  beforeEach(() => {
    loadTreeNodesMock.mockReset();
    encodingsFromMock.mockReset();
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

  it("shows no encoded coverage for a gated pilot family", async () => {
    // Israel's rulespec-il is registered app_visibility="experimental",
    // so a leaked mirror row must not put coverage marks on its browse
    // rows — the reader would refuse every file behind them.
    encodedCountRows({
      data: [{ citation_path: "il/statute/income-tax-ordinance" }],
      error: null,
    });

    const data = await getBrowsePageData(["il"]);

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
