import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCorpusRpc, mockCorpusFrom, mockEncodingsFrom } = vi.hoisted(() => ({
  mockCorpusRpc: vi.fn(),
  mockCorpusFrom: vi.fn(),
  mockEncodingsFrom: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabaseCorpus: { rpc: mockCorpusRpc, from: mockCorpusFrom },
  supabaseEncodings: { from: mockEncodingsFrom },
}));

import { getCoverageData, _resetCoverageCache } from "./coverage-page";

/** Thenable builder chain: every method returns the chain; awaiting
 *  yields the result queued for that call of from(). */
function chainFor(
  mock: ReturnType<typeof vi.fn>,
  perCall: (callIndex: number) => { data: unknown; error: unknown; count?: number },
  notCalls?: unknown[][]
) {
  let call = 0;
  mock.mockImplementation(() => {
    const result = perCall(call++);
    const self: Record<string, unknown> = {};
    for (const method of ["select", "is", "eq", "not", "order", "range", "limit"]) {
      self[method] = (...args: unknown[]) => {
        if (method === "not") notCalls?.push(args);
        return self;
      };
    }
    self.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    return self;
  });
}

const STATS = {
  provisions_count: 5000,
  references_count: 10,
  jurisdictions_count: 2,
  jurisdictions: [
    { jurisdiction: "us", count: 4000 },
    { jurisdiction: "nz", count: 1000 },
  ],
};

describe("getCoverageData", () => {
  beforeEach(() => {
    mockCorpusRpc.mockReset();
    mockCorpusFrom.mockReset();
    mockEncodingsFrom.mockReset();
    _resetCoverageCache();
  });

  it("joins corpus stats, root document counts, and encoding counts", async () => {
    mockCorpusRpc.mockResolvedValue({ data: STATS, error: null });
    // navigation_nodes root queries: one per corpus jurisdiction, in
    // stats order (us, nz).
    chainFor(mockCorpusFrom, (i) =>
      i === 0
        ? {
            data: [
              { doc_type: "statute" },
              { doc_type: "statute" },
              { doc_type: "regulation" },
              { doc_type: "guidance" },
            ],
            error: null,
            count: 4,
          }
        : { data: [{ doc_type: "statute" }], error: null, count: 1 }
    );
    // Encodings mirror sweep: uk exists only on the encodings side.
    chainFor(mockEncodingsFrom, () => ({
      data: [
        { jurisdiction: "us" },
        { jurisdiction: "us" },
        { jurisdiction: "uk" },
      ],
      error: null,
    }));

    const data = await getCoverageData();
    expect(data?.totals).toEqual({
      jurisdictions: 3,
      documents: 5,
      provisions: 5000,
      encodingFiles: 3,
    });
    expect(data?.docTypeTotals[0]).toEqual({ type: "statute", count: 3 });
    // Sorted by provisions desc; encodings-only uk trails.
    expect(data?.jurisdictions.map((j) => j.slug)).toEqual(["us", "nz", "uk"]);
    const us = data?.jurisdictions[0];
    expect(us).toMatchObject({
      label: "US Federal",
      documents: { statute: 2, regulation: 1, guidance: 1 },
      documentTotal: 4,
      provisionCount: 4000,
      encodingFileCount: 2,
    });
    const uk = data?.jurisdictions[2];
    expect(uk).toMatchObject({
      provisionCount: 0,
      documentTotal: 0,
      encodingFileCount: 1,
    });
  });

  it("returns null when the corpus stats RPC is unavailable", async () => {
    mockCorpusRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    chainFor(mockEncodingsFrom, () => ({ data: [], error: null }));
    expect(await getCoverageData()).toBeNull();
  });

  it("degrades a failed per-jurisdiction document query to an empty breakdown", async () => {
    mockCorpusRpc.mockResolvedValue({ data: STATS, error: null });
    chainFor(mockCorpusFrom, (i) =>
      i === 0
        ? { data: null, error: { message: "boom" } }
        : { data: [{ doc_type: "statute" }], error: null, count: 1 }
    );
    chainFor(mockEncodingsFrom, () => ({ data: [], error: null }));

    const data = await getCoverageData();
    expect(data?.jurisdictions[0]).toMatchObject({
      slug: "us",
      documents: {},
      documentTotal: 0,
      provisionCount: 4000,
    });
    expect(data?.jurisdictions[1].documentTotal).toBe(1);
  });

  it("leaves a gated pilot family out of the published census", async () => {
    // A leaked or pre-gating rulespec_files row must not put Israel on
    // the coverage table with an encoding count — nothing else on the
    // site can open those files.
    mockCorpusRpc.mockResolvedValue({ data: STATS, error: null });
    chainFor(mockCorpusFrom, () => ({ data: [], error: null, count: 0 }));
    const notCalls: unknown[][] = [];
    chainFor(
      mockEncodingsFrom,
      () => ({
        data: [
          { jurisdiction: "us" },
          { jurisdiction: "il" },
          { jurisdiction: "il-tlv" },
        ],
        error: null,
      }),
      notCalls
    );

    const data = await getCoverageData();

    expect(data?.jurisdictions.map((j) => j.slug)).toEqual(["us", "nz"]);
    expect(data?.totals.encodingFiles).toBe(1);
    // Excluded in the query as well, so the sweep's page bound is spent
    // on rows the census may actually count.
    expect(notCalls).toContainEqual(["citation_path", "like", "il/%"]);
    expect(notCalls).toContainEqual(["citation_path", "like", "il-%"]);
  });

  it("tolerates an encodings mirror outage", async () => {
    mockCorpusRpc.mockResolvedValue({ data: STATS, error: null });
    chainFor(mockCorpusFrom, () => ({ data: [], error: null, count: 0 }));
    chainFor(mockEncodingsFrom, () => ({
      data: null,
      error: { message: "boom" },
    }));

    const data = await getCoverageData();
    expect(data?.totals.encodingFiles).toBe(0);
    expect(data?.jurisdictions.map((j) => j.slug)).toEqual(["us", "nz"]);
  });
});
