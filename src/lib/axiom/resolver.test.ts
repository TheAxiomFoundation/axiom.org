import fc from "fast-check";
import { createClient } from "@supabase/supabase-js";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enDashCitationSegments } from "./citation-path";
import { citationPathPrefixes } from "./resolver";

const { mockIn } = vi.hoisted(() => ({ mockIn: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabaseCorpus: {
    from: () => ({
      select: () => ({
        in: mockIn,
      }),
    }),
  },
}));

// Import after mock registration so ``resolveCitationPath`` picks up
// the mocked ``supabaseCorpus``.
import { DASH_PREFIX_BUDGET, resolveCitationPath } from "./resolver";

describe("citationPathPrefixes", () => {
  it("enumerates deepest-first", () => {
    expect(citationPathPrefixes("us/statute/26/32/b/1")).toEqual([
      "us/statute/26/32/b/1",
      "us/statute/26/32/b",
      "us/statute/26/32",
      "us/statute/26",
      "us/statute",
      "us",
    ]);
  });

  it("handles a single-segment input", () => {
    expect(citationPathPrefixes("us")).toEqual(["us"]);
  });

  it("drops empty segments from duplicate slashes", () => {
    expect(citationPathPrefixes("us//statute//26")).toEqual([
      "us/statute/26",
      "us/statute",
      "us",
    ]);
  });
});

describe("resolveCitationPath", () => {
  beforeEach(() => mockIn.mockReset());

  it("returns match=exact when the full path is ingested", async () => {
    mockIn.mockResolvedValue({
      data: [
        { id: "r1", citation_path: "us/statute/26/32/b/1" },
        { id: "r2", citation_path: "us/statute/26/32" },
      ],
      error: null,
    });
    const out = await resolveCitationPath("us/statute/26/32/b/1");
    expect(out.match).toBe("exact");
    expect(out.rule?.id).toBe("r1");
    expect(out.missingTail).toEqual([]);
  });

  it("returns match=ancestor with missingTail when only a prefix exists", async () => {
    mockIn.mockResolvedValue({
      data: [{ id: "r2", citation_path: "us/statute/26/32" }],
      error: null,
    });
    const out = await resolveCitationPath("us/statute/26/32/b/1");
    expect(out.match).toBe("ancestor");
    expect(out.rule?.id).toBe("r2");
    expect(out.missingTail).toEqual(["b", "1"]);
  });

  it("returns match=none when no prefix is ingested", async () => {
    mockIn.mockResolvedValue({ data: [], error: null });
    const out = await resolveCitationPath("us/statute/99/99");
    expect(out.match).toBe("none");
    expect(out.rule).toBeNull();
    expect(out.missingTail).toEqual([]);
  });

  it("picks the deepest ancestor when multiple prefixes match", async () => {
    mockIn.mockResolvedValue({
      data: [
        { id: "shallow", citation_path: "us/statute/26" },
        { id: "deep", citation_path: "us/statute/26/32" },
      ],
      error: null,
    });
    const out = await resolveCitationPath("us/statute/26/32/z");
    expect(out.match).toBe("ancestor");
    expect(out.rule?.id).toBe("deep");
    expect(out.missingTail).toEqual(["z"]);
  });

  it("normalises leading slashes and structural casing", async () => {
    mockIn.mockResolvedValue({
      data: [{ id: "r", citation_path: "us/statute/26/32" }],
      error: null,
    });
    const out = await resolveCitationPath("/US/Statute/26/32");
    expect(out.citationPath).toBe("us/statute/26/32");
    expect(out.match).toBe("exact");
  });

  it("preserves case-sensitive legal identifier segments", async () => {
    mockIn.mockResolvedValue({
      data: [
        {
          id: "uk",
          citation_path: "uk/legislation/ukpga/2002/16/section/3ZA/3",
        },
      ],
      error: null,
    });
    const out = await resolveCitationPath(
      "/UK/Legislation/UKPGA/2002/16/Section/3ZA/3"
    );
    expect(mockIn).toHaveBeenCalledWith("citation_path", [
      "uk/legislation/ukpga/2002/16/section/3ZA/3",
      "uk/legislation/ukpga/2002/16/section/3ZA",
      "uk/legislation/ukpga/2002/16/section",
      "uk/legislation/ukpga/2002/16",
      "uk/legislation/ukpga/2002",
      "uk/legislation/ukpga",
      "uk/legislation",
      "uk",
    ]);
    expect(out.match).toBe("exact");
    expect(out.citationPath).toBe(
      "uk/legislation/ukpga/2002/16/section/3ZA/3"
    );
  });

  it("returns none on empty input", async () => {
    const out = await resolveCitationPath("");
    expect(out.match).toBe("none");
    expect(out.citationPath).toBe("");
  });

  it("returns none on Supabase error", async () => {
    mockIn.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const out = await resolveCitationPath("us/statute/26/32");
    expect(out.match).toBe("none");
  });
});

describe("resolveCitationPath with a hyphen typed for an en dash", () => {
  // The corpus stores lettered US Code sections with an en dash
  // (us/statute/42/1395w–113); people and citation tools type a hyphen.
  const EN = String.fromCharCode(0x2013);

  type Row = { id: string; citation_path: string };

  // Answer only the paths the query asked for, like the real ``.in()``.
  function corpus(rows: Row[]) {
    mockIn.mockImplementation((_column: string, paths: string[]) =>
      Promise.resolve({
        data: rows.filter((row) => paths.includes(row.citation_path)),
        error: null,
      })
    );
  }

  function queriedPaths(): string[] {
    expect(mockIn).toHaveBeenCalledTimes(1);
    return mockIn.mock.calls[0][1] as string[];
  }

  // A block body: ``mockReset`` returns the mock, and vitest would run
  // a function returned from ``beforeEach`` as a teardown hook.
  beforeEach(() => {
    mockIn.mockReset();
  });

  it("matches the en-dash row exactly and keeps the path as typed", async () => {
    corpus([
      { id: "title", citation_path: "us/statute/42" },
      { id: "section", citation_path: `us/statute/42/1395w${EN}113` },
    ]);
    const out = await resolveCitationPath("us/statute/42/1395w-113");
    expect(out.match).toBe("exact");
    expect(out.rule?.id).toBe("section");
    expect(out.rule?.citation_path).toBe(`us/statute/42/1395w${EN}113`);
    expect(out.missingTail).toEqual([]);
    expect(out.citationPath).toBe("us/statute/42/1395w-113");
  });

  it("queries the prefixes of both spellings in one call", async () => {
    corpus([]);
    await resolveCitationPath("us/statute/42/1395w-113");
    expect(queriedPaths()).toEqual([
      "us/statute/42/1395w-113",
      "us/statute/42",
      "us/statute",
      "us",
      `us/statute/42/1395w${EN}113`,
    ]);
  });

  it("prefers the path as typed when both spellings exist at the same depth", async () => {
    corpus([
      { id: "dash", citation_path: `us/statute/42/1395w${EN}113` },
      { id: "typed", citation_path: "us/statute/42/1395w-113" },
    ]);
    const out = await resolveCitationPath("us/statute/42/1395w-113");
    expect(out.match).toBe("exact");
    expect(out.rule?.id).toBe("typed");
    expect(out.missingTail).toEqual([]);
  });

  it("takes a deeper en-dash match over a shallower match as typed", async () => {
    corpus([
      { id: "typed-section", citation_path: "us/statute/42/1395w-113" },
      { id: "dash-sub", citation_path: `us/statute/42/1395w${EN}113/a` },
    ]);
    const out = await resolveCitationPath("us/statute/42/1395w-113/a");
    expect(out.match).toBe("exact");
    expect(out.rule?.id).toBe("dash-sub");
    expect(out.missingTail).toEqual([]);
    expect(out.citationPath).toBe("us/statute/42/1395w-113/a");
  });

  it("takes a deeper en-dash section over the title as an ancestor", async () => {
    corpus([
      { id: "title", citation_path: "us/statute/42" },
      { id: "section", citation_path: `us/statute/42/1395w${EN}113` },
    ]);
    const out = await resolveCitationPath("us/statute/42/1395w-113/a/1");
    expect(out.match).toBe("ancestor");
    expect(out.rule?.id).toBe("section");
    expect(out.missingTail).toEqual(["a", "1"]);
  });

  it("takes a deeper match as typed over a shallower en-dash match", async () => {
    corpus([
      { id: "dash-section", citation_path: `us/statute/42/1395w${EN}113` },
      { id: "typed-sub", citation_path: "us/statute/42/1395w-113/a" },
    ]);
    const out = await resolveCitationPath("us/statute/42/1395w-113/a");
    expect(out.match).toBe("exact");
    expect(out.rule?.id).toBe("typed-sub");
  });

  it("never changes the hyphens in the jurisdiction slug", async () => {
    corpus([
      { id: "typed", citation_path: "us-mt/statute/15-1-1" },
      { id: "dash", citation_path: `us-mt/statute/15${EN}1${EN}1` },
    ]);
    const out = await resolveCitationPath("us-mt/statute/15-1-1");
    expect(out.match).toBe("exact");
    expect(out.rule?.id).toBe("typed");
    const paths = queriedPaths();
    expect(paths).toEqual([
      "us-mt/statute/15-1-1",
      "us-mt/statute",
      "us-mt",
      `us-mt/statute/15${EN}1${EN}1`,
    ]);
    expect(paths.some((path) => path.includes(`us${EN}mt`))).toBe(false);
  });

  it("queries only the path as typed when the slug holds its only hyphen", async () => {
    corpus([{ id: "title", citation_path: "us-mt/statute/15" }]);
    const out = await resolveCitationPath("us-mt/statute/15");
    expect(out.match).toBe("exact");
    expect(queriedPaths()).toEqual(["us-mt/statute/15", "us-mt/statute", "us-mt"]);
  });

  it("issues one query over the typed prefixes for a path with no hyphen", async () => {
    corpus([{ id: "section", citation_path: "us/statute/26/32" }]);
    const out = await resolveCitationPath("us/statute/26/32/b/1");
    expect(out.match).toBe("ancestor");
    expect(queriedPaths()).toEqual([
      "us/statute/26/32/b/1",
      "us/statute/26/32/b",
      "us/statute/26/32",
      "us/statute/26",
      "us/statute",
      "us",
    ]);
  });

  // The real client, never awaited: it builds the query string an
  // ``.in()`` filter sends, so the tests measure what the resolver's
  // query would cost on the wire.
  const realClient = createClient("http://resolver.test", "test-key", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: "corpus" },
  });
  function queryLength(paths: string[]): number {
    const builder = realClient
      .from("current_provisions")
      .select("*")
      .in("citation_path", paths);
    // ``url`` is protected in the client's types; the tests read it.
    return (builder as unknown as { url: URL }).url.search.length;
  }
  function addedLength(paths: string[], typed: string[]): number {
    return queryLength(paths) - queryLength(typed);
  }

  // A section of ``lead``, letters, then hyphens whose en-dash spelling
  // adds ``target`` bytes to the query of us/statute/42/<section>. A
  // comma or parenthesis in ``lead`` makes the client quote the value.
  function sectionAdding(
    target: number,
    lead: string
  ): { section: string; stored: string } {
    const typed = ["us/statute/42", "us/statute", "us"];
    const room = target - addedLength([...typed, `us/statute/42/${lead}a`], typed);
    const hyphens = Math.floor(room / 9);
    const pad = "b".repeat(room - 9 * hyphens);
    return {
      section: `${lead}${pad}a${"-".repeat(hyphens)}`,
      stored: `us/statute/42/${lead}${pad}a${EN.repeat(hyphens)}`,
    };
  }

  const LEADS = [
    ["letters", ""],
    ["a parenthesis", "("],
    ["a comma", ","],
  ];

  it.each(LEADS)("adds the en-dash prefixes when they add exactly the budget, %s", async (_name, lead) => {
    const { section, stored } = sectionAdding(DASH_PREFIX_BUDGET, lead);
    corpus([{ id: "section", citation_path: stored }]);
    const out = await resolveCitationPath(`us/statute/42/${section}`);
    expect(out.match).toBe("exact");
    expect(out.rule?.id).toBe("section");
    const queried = queriedPaths();
    expect(queried).toContain(stored);
    expect(addedLength(queried, citationPathPrefixes(out.citationPath))).toBe(
      DASH_PREFIX_BUDGET
    );
  });

  it.each(LEADS)("queries the typed prefixes alone one byte over the budget, %s", async (_name, lead) => {
    const { section, stored } = sectionAdding(DASH_PREFIX_BUDGET + 1, lead);
    const typed = citationPathPrefixes(`us/statute/42/${section}`);
    expect(addedLength([...typed, stored], typed)).toBe(DASH_PREFIX_BUDGET + 1);
    corpus([{ id: "section", citation_path: stored }]);
    const out = await resolveCitationPath(`us/statute/42/${section}`);
    expect(out.match).toBe("none");
    expect(queriedPaths()).toEqual(typed);
  });

  it.each([
    ["2,000 hyphens", "a" + "-".repeat(2000)],
    // Within the budget by encodeURIComponent's count, 2 bytes over on
    // the wire: the separator encodes as %2C.
    ["225 hyphens after two letters", "aa" + "-".repeat(225)],
    // Quoted, with each parenthesis encoded as %28: about 6 KB on the wire.
    ["a hyphen then 2,018 parentheses", "-" + "(".repeat(2018)],
  ])("queries the typed prefixes alone for %s", async (_name, section) => {
    corpus([{ id: "title", citation_path: "us/statute/42" }]);
    const out = await resolveCitationPath(`us/statute/42/${section}`);
    expect(out.match).toBe("ancestor");
    expect(out.rule?.id).toBe("title");
    expect(out.missingTail).toEqual([section]);
    expect(queriedPaths()).toEqual(citationPathPrefixes(`us/statute/42/${section}`));
  });

  it("adds the en-dash prefixes exactly when the real query grows by at most the budget", async () => {
    const LONE_SURROGATE = String.fromCharCode(0xd800);
    const char = fc.constantFrom(
      "a", "1", "-", "-", "-", EN, "(", ")", ",", '"', "~", "!", "'", " ", LONE_SURROGATE
    );
    const segment = fc
      .array(char, { minLength: 1, maxLength: 400 })
      .map((chars) => chars.join(""));
    await fc.assert(
      fc.asyncProperty(fc.array(segment, { minLength: 1, maxLength: 3 }), async (segments) => {
        mockIn.mockReset();
        corpus([]);
        const out = await resolveCitationPath(["us", "statute", "42", ...segments].join("/"));
        const typed = citationPathPrefixes(out.citationPath);
        const dashed = citationPathPrefixes(
          enDashCitationSegments(out.citationPath.split("/")).join("/")
        ).filter((prefix) => !typed.includes(prefix));
        const fits = addedLength([...typed, ...dashed], typed) <= DASH_PREFIX_BUDGET;
        expect(queriedPaths()).toEqual(fits ? [...typed, ...dashed] : typed);
      }),
      { numRuns: 300 }
    );
  });

  it("gives the missing tail in the spelling of the path that matched", async () => {
    corpus([
      { id: "title", citation_path: "us/statute/42" },
      { id: "section", citation_path: `us/statute/42/1395w${EN}113` },
    ]);
    const out = await resolveCitationPath("us/statute/42/1395w-113/a/1-b");
    expect(out.match).toBe("ancestor");
    expect(out.rule?.id).toBe("section");
    expect(out.missingTail).toEqual(["a", `1${EN}b`]);
    expect(out.citationPath).toBe("us/statute/42/1395w-113/a/1-b");
  });

  it("keeps the tail as typed when neither spelling of the section is ingested", async () => {
    corpus([{ id: "title", citation_path: "us/statute/42" }]);
    const out = await resolveCitationPath("us/statute/42/1395w-113");
    expect(out.match).toBe("ancestor");
    expect(out.rule?.id).toBe("title");
    expect(out.missingTail).toEqual(["1395w-113"]);
  });
});
