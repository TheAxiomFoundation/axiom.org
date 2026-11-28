import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { FakeNavigationIndex } from "@/test/navigation-index-fake";

// The loader and the index read run for real against a stand-in corpus.
const navigation = vi.hoisted(() => ({ total: 0 }) as FakeNavigationIndex);

vi.mock("@/lib/supabase", async (importOriginal) => {
  const { fakeNavigationCorpus } = await import("@/test/navigation-index-fake");
  return {
    ...(await importOriginal<typeof import("@/lib/supabase")>()),
    supabaseCorpus: fakeNavigationCorpus(navigation),
  };
});

// No encodings anywhere, so the loader's encoding paths find nothing.
vi.mock("@/lib/axiom/rulespec/repo-listing", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/axiom/rulespec/repo-listing")
  >()),
  listEncodedFiles: vi.fn(async () => []),
}));

import { STATEMENT_TIMEOUT } from "@/test/navigation-index-fake";
import { GET } from "./route";

const levelPage = (segments: string, page: number) =>
  GET(
    new NextRequest(
      `http://localhost/api/axiom/tree?jurisdiction=us&segments=${encodeURIComponent(segments)}&hasCitationPaths=1&encodedOnly=0&page=${page}`
    )
  );

const answer = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

describe("GET /api/axiom/tree", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    navigation.childPage = null;
    navigation.total = 15;
    navigation.missing = [];
    navigation.stale = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers a page past the last child with no nodes and no more", async () => {
    const response = await levelPage("statute/26", 1);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nodes: [],
      hasMore: false,
      currentRule: null,
      leafRule: null,
    });
  });

  it("answers a missing level past page 0 as it answers page 0", async () => {
    navigation.total = 0;
    navigation.missing = ["us/statute/nonexistent"];

    const first = await answer(await levelPage("statute/nonexistent", 0));
    expect(first.status).toBe(404);
    expect(await answer(await levelPage("statute/nonexistent", 1))).toEqual(
      first
    );
  });

  it("answers an existing level with no children past page 0 with an empty page", async () => {
    // Page 0 finds the level. A later page lists nothing and names no
    // rules, and the hook keeps the rules page 0 named.
    navigation.total = 0;

    expect((await levelPage("statute/27", 0)).status).toBe(200);
    expect(await answer(await levelPage("statute/27", 1))).toEqual({
      status: 200,
      body: { nodes: [], hasMore: false, currentRule: null, leafRule: null },
    });
  });

  it("still answers 503 when the index fails", async () => {
    navigation.childPage = STATEMENT_TIMEOUT;

    const response = await levelPage("statute/26", 1);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Navigation data is temporarily unavailable.",
    });
  });
});
