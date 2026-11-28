import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const { mockFrom, builders } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  builders: [] as QueryBuilder[],
}));

vi.mock("@/lib/supabase", () => ({
  supabaseCorpus: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  getNavigationDocTypes,
  getNavigationIndexChildren,
  getNavigationIndexNode,
  getNavigationIndexPrefixRows,
  getProvisionCoveredDocTypes,
  getProvisionForNavigationNode,
  getResolvableNavigationNodeIds,
  navigationDocTypeToTreeNode,
  navigationRowToTreeNode,
  NavigationIndexMissingError,
  NavigationIndexUnavailableError,
} from "./read";
import type { NavigationNodeRow } from "./types";
import {
  EMPTY_404,
  PAST_THE_END,
  STATEMENT_TIMEOUT,
} from "@/test/navigation-index-fake";

type QueryResult = {
  data?: unknown;
  count?: number | null;
  error?: unknown;
  status?: number;
};

class QueryBuilder implements PromiseLike<QueryResult> {
  calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(private readonly result: QueryResult | Promise<QueryResult>) {}

  select(...args: unknown[]) {
    return this.call("select", args);
  }

  eq(...args: unknown[]) {
    return this.call("eq", args);
  }

  gte(...args: unknown[]) {
    return this.call("gte", args);
  }

  lt(...args: unknown[]) {
    return this.call("lt", args);
  }

  is(...args: unknown[]) {
    return this.call("is", args);
  }

  in(...args: unknown[]) {
    return this.call("in", args);
  }

  order(...args: unknown[]) {
    return this.call("order", args);
  }

  limit(...args: unknown[]) {
    return this.call("limit", args);
  }

  range(...args: unknown[]) {
    return this.call("range", args);
  }

  or(...args: unknown[]) {
    return this.call("or", args);
  }

  maybeSingle(...args: unknown[]) {
    return this.call("maybeSingle", args);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }

  private call(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    return this;
  }
}

function enqueue(result: QueryResult | Promise<QueryResult>): QueryBuilder {
  const builder = new QueryBuilder(result);
  builders.push(builder);
  mockFrom.mockReturnValueOnce(builder);
  return builder;
}

const DOC_TYPE_CANDIDATES = [
  "form",
  "guidance",
  "legislation",
  "manual",
  "policy",
  "regulation",
  "rulemaking",
  "statute",
] as const;

/**
 * Enqueue the 8 candidate probe queries plus the trailing best-effort scan
 * query that `getNavigationDocTypes` issues. `probes` maps a candidate to a
 * path that should be returned for it (omit to return an empty probe);
 * `scan` overrides the scan response (defaults to an empty success).
 */
function enqueueDocTypeQueries(opts: {
  probes?: Partial<Record<(typeof DOC_TYPE_CANDIDATES)[number], string>>;
  scan?: QueryResult | Promise<QueryResult>;
}): {
  probes: Record<(typeof DOC_TYPE_CANDIDATES)[number], QueryBuilder>;
  scan: QueryBuilder;
} {
  const probeBuilders = {} as Record<
    (typeof DOC_TYPE_CANDIDATES)[number],
    QueryBuilder
  >;
  for (const candidate of DOC_TYPE_CANDIDATES) {
    const path = opts.probes?.[candidate];
    probeBuilders[candidate] = enqueue({
      data: path ? [{ doc_type: candidate, path }] : [],
    });
  }
  const scan = enqueue(opts.scan ?? { data: [] });
  return { probes: probeBuilders, scan };
}

function navRow(
  overrides: Partial<NavigationNodeRow> = {}
): NavigationNodeRow {
  return {
    id: "nav-1",
    jurisdiction: "us",
    doc_type: "statute",
    path: "us/statute/26",
    parent_path: null,
    segment: "26",
    label: "Title 26",
    sort_key: "000026",
    depth: 2,
    provision_id: "provision-1",
    citation_path: "us/statute/26",
    has_children: true,
    child_count: 12,
    has_rulespec: false,
    encoded_descendant_count: 0,
    status: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-02T00:00:00Z",
    ...overrides,
  };
}

function calls(builder: QueryBuilder, method: string): unknown[][] {
  return builder.calls
    .filter((call) => call.method === method)
    .map((call) => call.args);
}

beforeEach(() => {
  mockFrom.mockReset();
  builders.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("navigation index read helpers", () => {
  it("returns the union of probed candidates and the best-effort scan", async () => {
    const { probes, scan } = enqueueDocTypeQueries({
      probes: { legislation: "uk/legislation" },
      scan: {
        data: [
          { doc_type: "statute", path: "uk/statute/some-act" },
          { doc_type: "statute", path: "uk/statute/some-act" },
        ],
      },
    });

    await expect(getNavigationDocTypes("uk", false)).resolves.toEqual({
      docTypes: ["legislation", "statute"],
    });

    expect(mockFrom).toHaveBeenCalledWith("current_navigation_nodes");
    expect(mockFrom).not.toHaveBeenCalledWith("navigation_nodes");
    expect(calls(probes.legislation, "eq")).toContainEqual([
      "jurisdiction",
      "uk",
    ]);
    expect(calls(probes.legislation, "eq")).toContainEqual([
      "doc_type",
      "legislation",
    ]);
    expect(calls(probes.legislation, "is")).toContainEqual([
      "parent_path",
      null,
    ]);
    expect(calls(probes.legislation, "limit")).toContainEqual([1]);
    expect(calls(scan, "is")).toContainEqual(["parent_path", null]);
  });

  it("returns probed candidates without the scan when the scan times out", async () => {
    vi.useFakeTimers();
    enqueueDocTypeQueries({
      probes: { statute: "us/statute/26" },
      scan: new Promise<QueryResult>(() => {
        /* never resolves */
      }),
    });

    const promise = getNavigationDocTypes("us", false);
    await vi.advanceTimersByTimeAsync(1600);

    await expect(promise).resolves.toEqual({ docTypes: ["statute"] });
  });

  it("filters root document segments for encoded descendants on every query", async () => {
    const { probes, scan } = enqueueDocTypeQueries({
      probes: { regulation: "us/regulation" },
    });

    await expect(getNavigationDocTypes("us", true)).resolves.toEqual({
      docTypes: ["regulation"],
    });

    expect(calls(probes.regulation, "or")).toContainEqual([
      "has_rulespec.eq.true,encoded_descendant_count.gt.0",
    ]);
    expect(calls(scan, "or")).toContainEqual([
      "has_rulespec.eq.true,encoded_descendant_count.gt.0",
    ]);
  });

  it("returns the manual candidate when only the manual probe matches", async () => {
    enqueueDocTypeQueries({
      probes: { manual: "us-tx/manual/income-eligibility" },
    });

    await expect(getNavigationDocTypes("us-tx", false)).resolves.toEqual({
      docTypes: ["manual"],
    });
  });

  it("allows an empty encoded-only root without treating the index as missing", async () => {
    enqueueDocTypeQueries({});

    await expect(getNavigationDocTypes("us", true)).resolves.toEqual({
      docTypes: [],
    });
  });

  it("ignores malformed scan rows while discovering document types", async () => {
    enqueueDocTypeQueries({
      scan: {
        data: [
          { doc_type: null, path: null },
          { doc_type: "", path: "us/" },
        ],
      },
    });

    await expect(getNavigationDocTypes("us", true)).resolves.toEqual({
      docTypes: [],
    });
  });

  it("finds root document types with provision coverage", async () => {
    const legislationByDocType = enqueue({ data: [] });
    const guidanceByDocType = enqueue({ data: [] });
    const rulemakingByDocType = enqueue({
      data: [{ doc_type: "rulemaking" }],
    });
    const legislationByPath = enqueue({
      data: [
        { citation_path: "uk/legislation/ukpga/2002/16" },
      ],
    });
    const guidanceByPath = enqueue({ data: [] });

    await expect(
      getProvisionCoveredDocTypes("uk", [
        "legislation",
        "guidance",
        "rulemaking",
      ])
    ).resolves.toEqual(new Set(["legislation", "rulemaking"]));

    expect(mockFrom).toHaveBeenCalledTimes(5);
    expect(calls(legislationByDocType, "eq")).toContainEqual([
      "doc_type",
      "legislation",
    ]);
    expect(calls(rulemakingByDocType, "eq")).toContainEqual([
      "doc_type",
      "rulemaking",
    ]);
    expect(calls(legislationByPath, "eq")).toContainEqual([
      "jurisdiction",
      "uk",
    ]);
    expect(calls(legislationByPath, "or")[0]?.[0]).toContain(
      "and(citation_path.gte.uk/legislation/,citation_path.lt.uk/legislation~)"
    );
    expect(calls(guidanceByPath, "or")[0]?.[0]).toContain(
      "and(citation_path.gte.uk/guidance/,citation_path.lt.uk/guidance~)"
    );
    expect(calls(guidanceByDocType, "limit")).toContainEqual([1]);
  });

  it("returns no covered document types when none are requested", async () => {
    await expect(getProvisionCoveredDocTypes("uk", [])).resolves.toEqual(
      new Set()
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("ignores null citation paths while finding covered document types", async () => {
    enqueue({ data: [] });
    enqueue({ data: [{ citation_path: null }] });

    await expect(
      getProvisionCoveredDocTypes("uk", ["legislation"])
    ).resolves.toEqual(new Set());
  });

  it("assumes coverage when the provision-covered doc_type lookup errors", async () => {
    enqueue({ error: { message: "statement timeout" } });

    await expect(
      getProvisionCoveredDocTypes("uk", ["legislation"])
    ).resolves.toEqual(new Set(["legislation"]));
  });

  it("assumes coverage when the provision-covered doc_type lookup rejects", async () => {
    enqueue(Promise.reject(new Error("network")));

    await expect(
      getProvisionCoveredDocTypes("uk", ["legislation"])
    ).resolves.toEqual(new Set(["legislation"]));
  });

  it("assumes coverage when the citation_path fallback lookup errors", async () => {
    enqueue({ data: [] });
    enqueue({ error: { message: "statement timeout" } });

    await expect(
      getProvisionCoveredDocTypes("uk", ["legislation"])
    ).resolves.toEqual(new Set(["legislation"]));
  });

  it("throws a missing-index error for an empty unfiltered jurisdiction", async () => {
    enqueueDocTypeQueries({});

    await expect(getNavigationDocTypes("canada", false)).rejects.toThrow(
      NavigationIndexMissingError
    );
  });

  it("treats a single failing probe as missing rather than unavailable when others succeed", async () => {
    // The form probe errors but the statute probe matches, so we still
    // surface the statute root instead of failing the whole response.
    enqueue({ error: { message: "statement timeout" } });
    for (let i = 0; i < 6; i++) enqueue({ data: [] });
    enqueue({ data: [{ doc_type: "statute", path: "us/statute/26" }] });
    enqueue({ data: [] });

    await expect(getNavigationDocTypes("us", false)).resolves.toEqual({
      docTypes: ["statute"],
    });
  });

  it("throws an unavailable error when every probe and the scan fail", async () => {
    for (let i = 0; i < 8; i++) {
      enqueue({ error: { message: "statement timeout" } });
    }
    enqueue({ error: { message: "statement timeout" } });

    await expect(getNavigationDocTypes("us", false)).rejects.toThrow(
      NavigationIndexUnavailableError
    );
  });

  it("throws an unavailable error when every probe rejects and the scan fails", async () => {
    for (let i = 0; i < 8; i++) enqueue(Promise.reject(new Error("network")));
    enqueue(Promise.reject(new Error("network")));

    await expect(getNavigationDocTypes("us", false)).rejects.toThrow(
      NavigationIndexUnavailableError
    );
  });

  it("ignores a failing scan as long as the probes succeed", async () => {
    enqueueDocTypeQueries({
      probes: { statute: "us/statute/26" },
      scan: { error: { message: "statement timeout" } },
    });

    await expect(getNavigationDocTypes("us", false)).resolves.toEqual({
      docTypes: ["statute"],
    });
  });

  it("loads paged child rows and computes hasMore from the exact count", async () => {
    const row = navRow();
    const builder = enqueue({ data: [row], count: 201 });

    const result = await getNavigationIndexChildren({
      jurisdiction: "us",
      docType: "statute",
      parentPath: "us/statute",
      encodedOnly: true,
      page: 1,
    });

    expect(result).toEqual({ rows: [row], total: 201, hasMore: true });
    expect(mockFrom).toHaveBeenCalledWith("current_navigation_nodes");
    expect(mockFrom).not.toHaveBeenCalledWith("navigation_nodes");
    expect(calls(builder, "eq")).toContainEqual(["doc_type", "statute"]);
    expect(calls(builder, "eq")).toContainEqual([
      "parent_path",
      "us/statute",
    ]);
    expect(calls(builder, "range")).toContainEqual([100, 199]);
    expect(calls(builder, "or")).toContainEqual([
      "has_rulespec.eq.true,encoded_descendant_count.gt.0",
    ]);
  });

  it("orders child pages by sort_key, then path, then id", async () => {
    // Siblings can share a sort_key (segments 1 and 01 with no ordinal),
    // and the index has shipped two rows for one path, so path and then id
    // break ties and each row lands on one page whatever the query plan.
    // PostgREST's answer to a page that starts exactly at the count.
    const builder = enqueue({ data: [], count: 200, status: 206, error: null });

    await getNavigationIndexChildren({
      jurisdiction: "us",
      docType: "statute",
      parentPath: "us/statute/26",
      encodedOnly: false,
      page: 2,
    });

    expect(calls(builder, "order")).toEqual([["sort_key"], ["path"], ["id"]]);
  });

  it("falls back to row length when child query count is absent", async () => {
    const rows = [navRow({ id: "nav-1" }), navRow({ id: "nav-2" })];
    enqueue({ data: rows, count: null });

    await expect(
      getNavigationIndexChildren({
        jurisdiction: "us",
        docType: "statute",
        parentPath: "us/statute",
        encodedOnly: false,
        page: 0,
      })
    ).resolves.toEqual({ rows, total: 2, hasMore: false });
  });

  it("loads sparse prefix rows for paths whose intermediate parents are omitted", async () => {
    const row = navRow({
      path: "us/guidance/usda/fns/snap-fy2026-cola",
      doc_type: "guidance",
    });
    const builder = enqueue({ data: [row] });

    const result = await getNavigationIndexPrefixRows({
      jurisdiction: "us",
      docType: "guidance",
      pathPrefix: "us/guidance/usda",
      encodedOnly: true,
    });

    expect(result).toEqual([row]);
    expect(mockFrom).toHaveBeenCalledWith("current_navigation_nodes");
    expect(mockFrom).not.toHaveBeenCalledWith("navigation_nodes");
    expect(calls(builder, "eq")).toContainEqual(["jurisdiction", "us"]);
    expect(calls(builder, "eq")).toContainEqual(["doc_type", "guidance"]);
    expect(calls(builder, "gte")).toContainEqual([
      "path",
      "us/guidance/usda/",
    ]);
    expect(calls(builder, "lt")).toContainEqual(["path", "us/guidance/usda~"]);
    expect(calls(builder, "or")).toContainEqual([
      "has_rulespec.eq.true,encoded_descendant_count.gt.0",
    ]);
  });

  it("loads root child rows with a null parent path", async () => {
    const builder = enqueue({ data: [], count: 0 });

    await getNavigationIndexChildren({
      jurisdiction: "us",
      docType: "statute",
      parentPath: null,
      encodedOnly: false,
      page: 0,
    });

    expect(calls(builder, "is")).toContainEqual(["parent_path", null]);
  });

  it.each([["us/statute/26"], [null]])(
    "answers a page past the last child of %s with no rows and the count",
    async (parentPath) => {
      const page = enqueue(PAST_THE_END);
      const count = enqueue({ data: null, count: 15, status: 200, error: null });

      await expect(
        getNavigationIndexChildren({
          jurisdiction: "us",
          docType: "statute",
          parentPath,
          encodedOnly: true,
          page: 1,
        })
      ).resolves.toEqual({ rows: [], total: 15, hasMore: false });

      expect(calls(page, "range")).toEqual([[100, 199]]);
      // The count asks about the same children, with no range.
      expect(mockFrom).toHaveBeenNthCalledWith(2, "current_navigation_nodes");
      expect(calls(count, "select")).toEqual([
        ["*", { count: "exact", head: true }],
      ]);
      for (const method of ["eq", "is", "or"]) {
        expect(calls(count, method)).toEqual(calls(page, method));
      }
      expect(calls(count, "range")).toEqual([]);
    }
  );

  it.each([
    ["a statement timeout", STATEMENT_TIMEOUT],
    // The past-end case is the status, never the message.
    ["a 500 that quotes the range message", { ...PAST_THE_END, status: 500 }],
  ])("still reports %s on a child page as unavailable", async (_, answer) => {
    enqueue(answer);

    await expect(
      getNavigationIndexChildren({
        jurisdiction: "us",
        docType: "statute",
        parentPath: "us/statute/26",
        encodedOnly: false,
        page: 1,
      })
    ).rejects.toThrow(NavigationIndexUnavailableError);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("still reports a child page that never answers as unavailable", async () => {
    vi.useFakeTimers();
    enqueue(
      new Promise<QueryResult>(() => {
        /* never resolves */
      })
    );

    const settled = expect(
      getNavigationIndexChildren({
        jurisdiction: "us",
        docType: "statute",
        parentPath: "us/statute/26",
        encodedOnly: false,
        page: 1,
      })
    ).rejects.toThrow(NavigationIndexUnavailableError);
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
  });

  const pageOne = () =>
    getNavigationIndexChildren({
      jurisdiction: "us",
      docType: "statute",
      parentPath: "us/statute/26",
      encodedOnly: false,
      page: 1,
    });

  /** The count after the 416 ran, as a count-only read. */
  const expectCountRead = (count: QueryBuilder) => {
    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(calls(count, "select")).toEqual([
      ["*", { count: "exact", head: true }],
    ]);
  };

  it.each([
    ["without a count", null],
    ["with a count", 15],
  ])(
    "reports unavailable when the count after a 416 fails %s",
    async (_, total) => {
      enqueue(PAST_THE_END);
      const count = enqueue({
        data: null,
        count: total,
        status: 500,
        error: { message: "statement timeout" },
      });

      await expect(pageOne()).rejects.toThrow(NavigationIndexUnavailableError);
      expectCountRead(count);
    }
  );

  it("reports unavailable when the count after a 416 never answers", async () => {
    vi.useFakeTimers();
    enqueue(PAST_THE_END);
    const count = enqueue(
      new Promise<QueryResult>(() => {
        /* never resolves */
      })
    );

    const settled = expect(pageOne()).rejects.toThrow(
      NavigationIndexUnavailableError
    );
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
    expectCountRead(count);
  });

  it.each([
    ["without a count", null],
    // postgrest-js reads a Content-Range of */* as NaN.
    ["with an unknown total (*/*)", Number.NaN],
    ["with a negative count", -1],
    ["with a fractional count", 1.5],
  ])(
    "reports unavailable when the count after a 416 answers %s",
    async (_, total) => {
      enqueue(PAST_THE_END);
      const count = enqueue({ data: null, count: total, status: 200, error: null });

      await expect(pageOne()).rejects.toThrow(NavigationIndexUnavailableError);
      expectCountRead(count);
    }
  );

  it("answers a page that starts exactly at the count as past the end", async () => {
    enqueue(PAST_THE_END);
    enqueue({ data: null, count: 100, status: 200, error: null });

    await expect(pageOne()).resolves.toEqual({
      rows: [],
      total: 100,
      hasMore: false,
    });
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it("reads the page once more when the count shows rows landed after the 416", async () => {
    const rows = [navRow({ id: "nav-101", path: "us/statute/26/101" })];
    enqueue(PAST_THE_END);
    enqueue({ data: null, count: 250, status: 200, error: null });
    const again = enqueue({ data: rows, count: 250, status: 206, error: null });

    await expect(pageOne()).resolves.toEqual({
      rows,
      total: 250,
      hasMore: true,
    });
    expect(mockFrom).toHaveBeenCalledTimes(3);
    expect(calls(again, "range")).toEqual([[100, 199]]);
    expect(calls(again, "select")).toEqual([
      ["*", { count: "exact", head: false }],
    ]);
  });

  it("reads the page once more when the new count ends inside it", async () => {
    const rows = [navRow({ id: "nav-150", path: "us/statute/26/150" })];
    enqueue(PAST_THE_END);
    enqueue({ data: null, count: 150, status: 200, error: null });
    const again = enqueue({ data: rows, count: 150, status: 206, error: null });

    await expect(pageOne()).resolves.toEqual({
      rows,
      total: 150,
      hasMore: false,
    });
    expect(mockFrom).toHaveBeenCalledTimes(3);
    expect(calls(again, "range")).toEqual([[100, 199]]);
  });

  it.each([
    ["fails", STATEMENT_TIMEOUT],
    ["starts past the end again", PAST_THE_END],
  ])(
    "reports unavailable when that second read %s",
    async (_, answer) => {
      enqueue(PAST_THE_END);
      enqueue({ data: null, count: 250, status: 200, error: null });
      enqueue(answer);
      // A third read would find no answer queued.
      mockFrom.mockImplementation(() => {
        throw new Error("read again");
      });

      await expect(pageOne()).rejects.toThrow(NavigationIndexUnavailableError);
      expect(mockFrom).toHaveBeenCalledTimes(3);
    }
  );

  // postgrest-js turns a 404 with an array body into 200 with that array
  // and no count. EMPTY_404 is its answer to a 404 with no body.
  const ARRAY_404 = { data: [], count: null, error: null, status: 200 };
  // An exact count that reaches into the page, with no rows in it.
  const ROWS_MISSING = { data: [], count: 150, error: null, status: 206 };

  it.each([
    ["an empty 404", EMPTY_404],
    ["a 404 with an empty array", ARRAY_404],
    ["no rows under a count that reaches the page", ROWS_MISSING],
  ])("reports unavailable when that second read answers %s", async (_, answer) => {
    enqueue(PAST_THE_END);
    enqueue({ data: null, count: 250, status: 200, error: null });
    enqueue(answer);

    await expect(pageOne()).rejects.toThrow(NavigationIndexUnavailableError);
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  it("answers past the end when that second read finds the level ends at the page", async () => {
    enqueue(PAST_THE_END);
    enqueue({ data: null, count: 250, status: 200, error: null });
    enqueue({ data: [], count: 100, error: null, status: 206 });

    await expect(pageOne()).resolves.toEqual({
      rows: [],
      total: 100,
      hasMore: false,
    });
  });

  it.each([
    ["an empty 404", EMPTY_404],
    ["a 404 with an empty array", ARRAY_404],
    ["no rows under a count that reaches the page", ROWS_MISSING],
  ])("reports unavailable when a later page answers %s", async (_, answer) => {
    enqueue(answer);

    await expect(pageOne()).rejects.toThrow(NavigationIndexUnavailableError);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("answers a later page that starts exactly at the count with no rows", async () => {
    enqueue({ data: [], count: 100, error: null, status: 206 });

    await expect(pageOne()).resolves.toEqual({
      rows: [],
      total: 100,
      hasMore: false,
    });
  });

  it.each([
    ["an empty 404", EMPTY_404],
    ["a 404 with an empty array", ARRAY_404],
  ])("still answers page 0 from %s as an empty level", async (_, answer) => {
    enqueue(answer);

    await expect(
      getNavigationIndexChildren({
        jurisdiction: "us",
        docType: "statute",
        parentPath: "us/statute/26",
        encodedOnly: false,
        page: 0,
      })
    ).resolves.toEqual({ rows: [], total: 0, hasMore: false });
  });

  it("loads a single navigation node by path", async () => {
    const row = navRow();
    const builder = enqueue({ data: [row] });

    await expect(getNavigationIndexNode("us/statute/26")).resolves.toEqual(row);

    expect(mockFrom).toHaveBeenCalledWith("current_navigation_nodes");
    expect(mockFrom).not.toHaveBeenCalledWith("navigation_nodes");
    expect(calls(builder, "eq")).toContainEqual(["path", "us/statute/26"]);
    // Ordered list query, not maybeSingle(): the index has shipped
    // duplicate rows for one path, which maybeSingle() escalates to
    // a subtree-wide 503.
    expect(calls(builder, "order")).toContainEqual([
      "sort_key",
      { ascending: false },
    ]);
    expect(calls(builder, "limit")).toContainEqual([1]);
  });

  it("picks the canonically-sorted row when the index has duplicates", async () => {
    const good = navRow({ sort_key: "00000026|000000000026" });
    enqueue({ data: [good] });
    await expect(getNavigationIndexNode("us/statute/26")).resolves.toEqual(
      good
    );
  });

  it("loads the provision linked from a navigation node id", async () => {
    const provision = { id: "provision-1", citation_path: "us/statute/26" };
    const builder = enqueue({ data: provision });

    await expect(
      getProvisionForNavigationNode(navRow({ provision_id: "provision-1" }))
    ).resolves.toEqual(provision);

    expect(mockFrom).toHaveBeenCalledWith("current_provisions");
    expect(calls(builder, "eq")).toContainEqual(["id", "provision-1"]);
  });

  it("loads the provision by path when no provision id exists", async () => {
    const builder = enqueue({ data: null });

    await expect(
      getProvisionForNavigationNode(navRow({ provision_id: null }))
    ).resolves.toBeNull();

    expect(calls(builder, "eq")).toContainEqual([
      "citation_path",
      "us/statute/26",
    ]);
  });

  it("loads resolvable leaf navigation ids in a batch", async () => {
    const byId = enqueue({ data: [{ id: "provision-live" }] });
    const byCitationPath = enqueue({
      data: [{ citation_path: "uk/legislation/uksi/2013/376/regulation/22" }],
    });

    const result = await getResolvableNavigationNodeIds([
      navRow({
        id: "parent",
        has_children: true,
        provision_id: "parent-provision",
      }),
      navRow({
        id: "live-by-id",
        has_children: false,
        provision_id: "provision-live",
        citation_path: "uk/legislation/uksi/2013/376/regulation/21",
        path: "uk/legislation/uksi/2013/376/regulation/21",
      }),
      navRow({
        id: "live-by-path",
        has_children: false,
        provision_id: null,
        citation_path: "uk/legislation/uksi/2013/376/regulation/22",
        path: "uk/legislation/uksi/2013/376/regulation/22",
      }),
      navRow({
        id: "stale-leaf",
        has_children: false,
        provision_id: "missing-provision",
        citation_path: "uk/legislation/uksi/2013/376/regulation/23",
        path: "uk/legislation/uksi/2013/376/regulation/23",
      }),
    ]);

    expect(result).toEqual(new Set(["live-by-id", "live-by-path"]));
    expect(calls(byId, "in")).toContainEqual([
      "id",
      ["parent-provision", "provision-live", "missing-provision"],
    ]);
    expect(calls(byCitationPath, "or")[0]?.[0]).toContain(
      "citation_path.eq.uk/legislation/uksi/2013/376/regulation/22"
    );
  });

  it("returns an empty resolvable set when there are no rows", async () => {
    await expect(getResolvableNavigationNodeIds([])).resolves.toEqual(new Set());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("checks resolvable leaves by citation path when no provision ids exist", async () => {
    const byCitationPath = enqueue({
      data: [{ citation_path: "uk/legislation/uksi/2013/376/regulation/22" }],
    });

    const result = await getResolvableNavigationNodeIds([
      navRow({
        id: "live-by-path",
        has_children: false,
        provision_id: null,
        citation_path: "uk/legislation/uksi/2013/376/regulation/22",
        path: "uk/legislation/uksi/2013/376/regulation/22",
      }),
    ]);

    expect(result).toEqual(new Set(["live-by-path"]));
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(calls(byCitationPath, "or")).toContainEqual([
      "citation_path.eq.uk/legislation/uksi/2013/376/regulation/22",
    ]);
  });

  it("marks container rows resolvable when a descendant provision exists", async () => {
    const byId = enqueue({ data: [] });
    const byCitationPath = enqueue({
      data: [
        {
          citation_path:
            "uk/legislation/ukpga/2002/16/section/3ZA/3",
        },
      ],
    });

    const result = await getResolvableNavigationNodeIds([
      navRow({
        id: "container",
        has_children: true,
        provision_id: "missing-container",
        citation_path: "uk/legislation/ukpga/2002/16/section/3ZA",
        path: "uk/legislation/ukpga/2002/16/section/3ZA",
      }),
    ]);

    expect(result).toEqual(new Set(["container"]));
    expect(calls(byId, "in")).toContainEqual(["id", ["missing-container"]]);
    expect(calls(byCitationPath, "or")[0]?.[0]).toContain(
      "and(citation_path.gte.uk/legislation/ukpga/2002/16/section/3ZA/,citation_path.lt.uk/legislation/ukpga/2002/16/section/3ZA~)"
    );
  });

  it("throws unavailable when resolvable provision id lookup errors", async () => {
    enqueue({ error: { message: "statement timeout" } });

    await expect(
      getResolvableNavigationNodeIds([
        navRow({
          id: "leaf",
          has_children: false,
          provision_id: "provision-1",
        }),
      ])
    ).rejects.toThrow(NavigationIndexUnavailableError);
  });

  it("throws unavailable when resolvable citation path lookup errors", async () => {
    enqueue({ error: { message: "statement timeout" } });

    await expect(
      getResolvableNavigationNodeIds([
        navRow({
          id: "leaf",
          has_children: false,
          provision_id: null,
        }),
      ])
    ).rejects.toThrow(NavigationIndexUnavailableError);
  });

  it("throws unavailable when resolvable citation path lookup rejects", async () => {
    enqueue(Promise.reject(new Error("network")));

    await expect(
      getResolvableNavigationNodeIds([
        navRow({
          id: "leaf",
          has_children: false,
          provision_id: null,
        }),
      ])
    ).rejects.toThrow(NavigationIndexUnavailableError);
  });

  it("throws unavailable when resolvable provision id lookup rejects", async () => {
    enqueue(Promise.reject(new Error("network")));

    await expect(
      getResolvableNavigationNodeIds([
        navRow({
          id: "leaf",
          has_children: false,
          provision_id: "provision-1",
        }),
      ])
    ).rejects.toThrow(NavigationIndexUnavailableError);
  });

  it("ignores null matches while resolving navigation leaves", async () => {
    enqueue({ data: [{ id: null }] });
    enqueue({ data: [{ citation_path: null }] });

    const result = await getResolvableNavigationNodeIds([
      navRow({
        id: "leaf",
        has_children: false,
        provision_id: "provision-1",
        citation_path: null,
        path: "uk/legislation/uksi/2013/376/regulation/22",
      }),
    ]);

    expect(result).toEqual(new Set());
  });

  it("maps document types and navigation rows into tree nodes", () => {
    expect(navigationDocTypeToTreeNode("statute")).toEqual(
      expect.objectContaining({ segment: "statute", label: "Statutes" })
    );
    expect(navigationDocTypeToTreeNode("regulation")).toEqual(
      expect.objectContaining({ segment: "regulation", label: "Regulations" })
    );
    expect(navigationDocTypeToTreeNode("policy-guidance")).toEqual(
      expect.objectContaining({
        segment: "policy-guidance",
        label: "Policy Guidance",
      })
    );

    const treeNode = navigationRowToTreeNode(
      navRow({
        child_count: 0,
        has_rulespec: false,
        encoded_descendant_count: 3,
      })
    );

    expect(treeNode).toEqual(
      expect.objectContaining({
        segment: "26",
        label: "Title 26",
        childCount: undefined,
        hasRuleSpec: true,
        rule: expect.objectContaining({
          id: "provision-1",
          citation_path: "us/statute/26",
          updated_at: "2026-05-02T00:00:00Z",
        }),
      })
    );
  });

  it("falls back to navigation row defaults when optional rule fields are absent", () => {
    const treeNode = navigationRowToTreeNode(
      navRow({
        provision_id: null,
        citation_path: null,
        label: "",
        updated_at: null,
        created_at: null,
        child_count: 4,
        has_rulespec: true,
        encoded_descendant_count: 0,
      })
    );

    expect(treeNode).toEqual(
      expect.objectContaining({
        label: "26",
        childCount: 4,
        hasRuleSpec: true,
        rule: expect.objectContaining({
          id: "nav-1",
          citation_path: "us/statute/26",
          updated_at: "",
        }),
      })
    );
  });
});

// The same reads through the installed client over a stubbed fetch, so
// postgrest-js turns each HTTP answer into a result the way it does in
// production.
describe("child pages at the HTTP boundary", () => {
  const sent: Array<{ method: string; url: URL }> = [];
  const replies: Response[] = [];
  const client = createClient("https://placeholder.supabase.co", "placeholder-key", {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
      storageKey: "read-test-http-boundary",
    },
    db: { schema: "corpus" },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ method: init?.method ?? "GET", url: new URL(String(input)) });
        const reply = replies.shift();
        if (!reply) throw new Error("no reply queued");
        return reply;
      },
    },
  });

  const json = (status: number, body: unknown, contentRange?: string) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(contentRange ? { "content-range": contentRange } : {}),
      },
    });
  // PostgREST's 416 for a range past the last row. postgrest-js keeps
  // none of its Content-Range.
  const rangePastTheEnd = () =>
    json(
      416,
      {
        code: "PGRST103",
        details: null,
        hint: null,
        message: "Requested range not satisfiable",
      },
      "*/250"
    );
  const countOf = (total: number) =>
    new Response(null, { status: 200, headers: { "content-range": `*/${total}` } });
  const emptyNotFound = () => new Response("", { status: 404 });

  const childPage = (page: number) =>
    getNavigationIndexChildren({
      jurisdiction: "us",
      docType: "statute",
      parentPath: "us/statute/26",
      encodedOnly: false,
      page,
    });
  const methods = () => sent.map((request) => request.method);

  beforeEach(() => {
    sent.length = 0;
    replies.length = 0;
    mockFrom.mockImplementation((table: string) => client.from(table));
  });

  it("hands back an empty 404 as a 204 with no data, count or error", async () => {
    replies.push(emptyNotFound());

    const result = await client
      .from("current_navigation_nodes")
      .select("*", { count: "exact" })
      .range(100, 199);

    expect(result).toMatchObject({
      status: 204,
      error: null,
      data: null,
      count: null,
    });
  });

  it("reports unavailable when the second read after a 416 is an empty 404", async () => {
    replies.push(rangePastTheEnd(), countOf(250), emptyNotFound());

    await expect(childPage(1)).rejects.toThrow(NavigationIndexUnavailableError);
    expect(methods()).toEqual(["GET", "HEAD", "GET"]);
    for (const read of [sent[0], sent[2]]) {
      expect(read.url.searchParams.get("offset")).toBe("100");
      expect(read.url.searchParams.get("limit")).toBe("100");
    }
  });

  it("reports unavailable when the second read after a 416 is a 404 with an empty array", async () => {
    replies.push(rangePastTheEnd(), countOf(250), json(404, []));

    await expect(childPage(1)).rejects.toThrow(NavigationIndexUnavailableError);
    expect(methods()).toEqual(["GET", "HEAD", "GET"]);
  });

  it("takes a second read after a 416 that lists the page", async () => {
    const row = navRow({ id: "nav-101", path: "us/statute/26/101" });
    replies.push(
      rangePastTheEnd(),
      countOf(250),
      json(206, [row], "100-100/250")
    );

    await expect(childPage(1)).resolves.toEqual({
      rows: [row],
      total: 250,
      hasMore: true,
    });
  });

  it("reports unavailable when the second read after a 416 answers a success PostgREST never sends for a page", async () => {
    // postgrest-js passes any 2xx through as a success with its rows; only
    // 200 and 206 are a page PostgREST sent.
    const row = navRow({ id: "nav-101", path: "us/statute/26/101" });
    replies.push(
      rangePastTheEnd(),
      countOf(250),
      json(203, [row], "100-100/250")
    );

    await expect(childPage(1)).rejects.toThrow(NavigationIndexUnavailableError);
    expect(methods()).toEqual(["GET", "HEAD", "GET"]);
  });

  it("answers a page past the end from the count read", async () => {
    replies.push(rangePastTheEnd(), countOf(15));

    await expect(childPage(1)).resolves.toEqual({
      rows: [],
      total: 15,
      hasMore: false,
    });
    expect(methods()).toEqual(["GET", "HEAD"]);
  });

  it("reports unavailable when the count read fails, whatever Content-Range it carries", async () => {
    // The client keeps a count only from a successful answer, so a failed
    // count read arrives with an error and no count.
    replies.push(
      rangePastTheEnd(),
      new Response(null, { status: 500, headers: { "content-range": "*/250" } })
    );

    await expect(childPage(1)).rejects.toThrow(NavigationIndexUnavailableError);
    expect(methods()).toEqual(["GET", "HEAD"]);
  });

  it.each([[1], [2]])(
    "reports unavailable when page %i is an empty 404",
    async (page) => {
      replies.push(emptyNotFound());

      await expect(childPage(page)).rejects.toThrow(
        NavigationIndexUnavailableError
      );
      expect(methods()).toEqual(["GET"]);
    }
  );

  it("still answers page 0 from an empty 404 as an empty level", async () => {
    replies.push(emptyNotFound());

    await expect(childPage(0)).resolves.toEqual({
      rows: [],
      total: 0,
      hasMore: false,
    });
  });
});
