import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex";
import type { FakeNavigationIndex } from "@/test/navigation-index-fake";

// The navigation reads run for real against a stand-in corpus, so these
// follow a ?page= from the route through the loader to the index read.
const navigation = vi.hoisted(() => ({ total: 0 }) as FakeNavigationIndex);

vi.mock("@/lib/supabase", async (importOriginal) => {
  const { fakeEmptyClient, fakeNavigationCorpus } = await import(
    "@/test/navigation-index-fake"
  );
  return {
    ...(await importOriginal<typeof import("@/lib/supabase")>()),
    supabaseCorpus: fakeNavigationCorpus(navigation),
    supabaseEncodings: fakeEmptyClient(),
  };
});

// No encodings anywhere, so the loader's encoding paths find nothing.
vi.mock("@/lib/axiom/rulespec/repo-listing", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/axiom/rulespec/repo-listing")
  >()),
  listEncodedFiles: vi.fn(async () => []),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect to ${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

// Records the path each visit looks up.
vi.mock("@/lib/axiom/browse-page", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/axiom/browse-page")>();
  return { ...actual, getBrowsePageData: vi.fn(actual.getBrowsePageData) };
});

vi.mock("@/lib/axiom/section-page", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/axiom/section-page")>()),
  resolveSection: vi.fn(),
}));

import { notFound, redirect } from "next/navigation";
import { getBrowsePageData } from "@/lib/axiom/browse-page";
import { resolveSection, type SectionResolution } from "@/lib/axiom/section-page";
import { proxy } from "@/proxy";
import { STATEMENT_TIMEOUT } from "@/test/navigation-index-fake";
import SectionPage from "./page";

// Next's own matcher for this route; it decodes each segment once.
const matchRoute = getRouteMatcher(getRouteRegex("/axiom/v2/[...segments]"));

/** What Next hands the page when a browser asks for `href`: the proxy
 *  rewrites the path under /axiom/v2, and Next matches the rewrite. Null
 *  when the page never sees the request: Next redirects a path holding
 *  "//" before any route runs, and answers 400 to a segment that does not
 *  decode. */
function arrive(href: string) {
  const url = new URL(href, "https://axiom.org");
  if (url.pathname.includes("//")) return null;
  const response = proxy(new NextRequest(url));
  const rewrite = new URL(response.headers.get("x-middleware-rewrite") ?? "");
  let params: ReturnType<typeof matchRoute>;
  try {
    params = matchRoute(rewrite.pathname);
  } catch {
    return null;
  }
  if (!params) throw new Error(`${href} does not reach the page`);
  // Next passes every query parameter, and a repeated one as an array.
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(rewrite.searchParams.keys())) {
    const values = rewrite.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return { segments: params.segments as string[], query };
}

function render_(segments: string[], query: Record<string, string | string[]>) {
  return SectionPage({
    params: Promise.resolve({ segments }),
    searchParams: Promise.resolve(query as { page?: string }),
  });
}

function visit(href: string) {
  const arrived = arrive(href);
  if (!arrived) throw new Error(`Next refuses ${href}`);
  return render_(arrived.segments, arrived.query);
}

/** The path the last visit looked up. */
const lastLookup = () => vi.mocked(getBrowsePageData).mock.lastCall?.[0];

describe("v2 browse page past its last page", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
    vi.mocked(notFound).mockClear();
    vi.mocked(getBrowsePageData).mockClear();
    vi.mocked(resolveSection).mockReset();
    navigation.total = 15;
    navigation.childPage = null;
    navigation.missing = [];
    navigation.stale = [];
  });

  it("sends a page past the last child to the level's only page", async () => {
    // https://axiom.org/us/statute/26?page=1, a level with 15 children
    await expect(visit("/us/statute/26?page=1")).rejects.toThrow(
      "redirect to /us/statute/26"
    );
    expect(redirect).toHaveBeenCalledWith("/us/statute/26");
  });

  it("names the last page and keeps the other query parameters", async () => {
    navigation.total = 250;

    await expect(
      visit("/us/statute/26?page=4&embed=1&rule=eitc&from=share")
    ).rejects.toThrow("redirect to");
    expect(redirect).toHaveBeenCalledWith(
      "/us/statute/26?embed=1&rule=eitc&from=share&page=2"
    );
  });

  it("sends a container below title level to its last page too", async () => {
    // 7 CFR Part 273 reads as a browse list, paged like the levels above.
    vi.mocked(resolveSection).mockResolvedValue({
      containerCandidate: true,
    } as unknown as SectionResolution);
    navigation.total = 120;

    await expect(visit("/us/regulation/7/273?page=3")).rejects.toThrow(
      "redirect to"
    );
    expect(redirect).toHaveBeenCalledWith("/us/regulation/7/273?page=1");
  });

  it("escapes a path segment again in the redirect", async () => {
    // Next decodes "5%20App" to "5 App", so the link back encodes it.
    await expect(visit("/us/statute/5%20App?page=1")).rejects.toThrow(
      "redirect to"
    );
    expect(redirect).toHaveBeenCalledWith("/us/statute/5%20App");
  });

  it("keeps a repeated query parameter as one parameter per value", async () => {
    navigation.total = 250;

    await expect(
      visit("/us/statute/26?page=4&from=share&from=search")
    ).rejects.toThrow("redirect to");
    expect(redirect).toHaveBeenCalledWith(
      "/us/statute/26?from=share&from=search&page=2"
    );
  });

  it("sends every path back to the same lookup, one level deep", async () => {
    // Characters a URL treats specially, as typed, escaped once and
    // escaped twice, alone and inside a word.
    const texts = [
      "%",
      "%25",
      "%2525",
      " ",
      "+",
      "/",
      "?",
      "#",
      ".",
      "..",
      "%2E%2E",
      "a%2Fb",
      "5%252520App",
      "%E9",
      String.fromCodePoint(0xe9),
      String.fromCodePoint(0x65e5, 0x672c),
    ].flatMap((text) => [text, `x${text}y`]);
    const raws = texts.flatMap((text) => [
      text,
      encodeURIComponent(text),
      encodeURIComponent(encodeURIComponent(text)),
    ]);
    const level = (segments: string[]) =>
      segments.length === 3 && segments[0] === "us" && segments[1] === "statute";
    let followed = 0;

    for (const raw of raws) {
      const request = arrive(`/us/statute/${raw}?page=3`);
      // Some spellings name another request (a raw "/", "?", "#" or dot
      // segment), and Next answers 400 to a segment that does not decode.
      if (!request || !level(request.segments) || request.query.page !== "3") {
        continue;
      }
      vi.mocked(redirect).mockClear();
      await expect(
        render_(request.segments, request.query),
        raw
      ).rejects.toThrow("redirect to");
      const looked = lastLookup();
      const target = vi.mocked(redirect).mock.lastCall?.[0] as string;

      // Following the redirect reaches the same level and looks up the
      // same path.
      const arrived = arrive(target);
      expect(arrived?.segments, `${raw} -> ${target}`).toSatisfy(
        (segments: string[] | undefined) => Boolean(segments && level(segments))
      );
      await render_(arrived!.segments, arrived!.query);
      expect(lastLookup(), `${raw} -> ${target}`).toEqual(looked);
      followed += 1;
    }
    expect(followed).toBeGreaterThan(40);
  });

  it.each([[["us", "statute", ".."]], [["us", "statute", "."]], [["us", "", "26"]]])(
    "never redirects %j, which no link can name",
    async (segments) => {
      await expect(render_(segments, { page: "3" })).rejects.toThrow("not found");
      expect(redirect).not.toHaveBeenCalled();
    }
  );

  it("answers a missing level past page 0 as it answers page 0", async () => {
    // The index lists no children and no node for the level, so page 0
    // shows the outage notice: the loader cannot tell a missing level from
    // a failing one here.
    navigation.total = 0;
    navigation.missing = ["us/statute/nonexistent"];

    render(await visit("/us/statute/nonexistent"));
    expect(screen.getByTestId("browse-unavailable")).toBeInTheDocument();
    render(await visit("/us/statute/nonexistent?page=1"));
    expect(screen.getAllByTestId("browse-unavailable")).toHaveLength(2);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("answers a missing container past page 0 as it answers page 0", async () => {
    navigation.total = 0;
    navigation.missing = ["us/regulation/7/999"];

    await expect(visit("/us/regulation/7/999")).rejects.toThrow("not found");
    await expect(visit("/us/regulation/7/999?page=2")).rejects.toThrow(
      "not found"
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends an existing level with no children to page 0", async () => {
    navigation.total = 0;

    await expect(visit("/us/statute/27?page=1")).rejects.toThrow(
      "redirect to /us/statute/27"
    );
    expect(redirect).toHaveBeenCalledWith("/us/statute/27");
  });

  it("steps back past a last page whose children are all stale", async () => {
    // 101 children: page 1 holds only the 101st, and its provision is gone.
    navigation.total = 101;
    navigation.stale = [101];

    await expect(visit("/us/statute/26?page=2")).rejects.toThrow(
      "redirect to /us/statute/26"
    );
    expect(redirect).toHaveBeenCalledWith("/us/statute/26");
  });

  it("still shows the outage notice when the index fails", async () => {
    navigation.childPage = STATEMENT_TIMEOUT;

    render(await visit("/us/statute/26?page=1"));

    expect(screen.getByTestId("browse-unavailable")).toHaveTextContent(
      "Navigation data is temporarily unavailable"
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
