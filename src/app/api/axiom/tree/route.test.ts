import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { FakeNavigationIndex } from "@/test/navigation-index-fake";

// The loader and the index read run for real against a stand-in corpus.
const navigation = vi.hoisted(
  () => ({ childPage: null, total: 0 }) as unknown as FakeNavigationIndex
);

vi.mock("@/lib/supabase", async (importOriginal) => {
  const { fakeNavigationCorpus } = await import("@/test/navigation-index-fake");
  return {
    ...(await importOriginal<typeof import("@/lib/supabase")>()),
    supabaseCorpus: fakeNavigationCorpus(navigation),
  };
});

import { PAST_THE_END, STATEMENT_TIMEOUT } from "@/test/navigation-index-fake";
import { GET } from "./route";

const titlePage = (page: number) =>
  GET(
    new NextRequest(
      `http://localhost/api/axiom/tree?jurisdiction=us&segments=statute%2F26&hasCitationPaths=1&encodedOnly=0&page=${page}`
    )
  );

describe("GET /api/axiom/tree", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    navigation.childPage = PAST_THE_END;
    navigation.total = 15;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers a page past the last child with no nodes and no more", async () => {
    const response = await titlePage(1);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nodes: [],
      hasMore: false,
      currentRule: null,
      leafRule: null,
    });
  });

  it("still answers 503 when the index fails", async () => {
    navigation.childPage = STATEMENT_TIMEOUT;

    const response = await titlePage(1);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Navigation data is temporarily unavailable.",
    });
  });
});
