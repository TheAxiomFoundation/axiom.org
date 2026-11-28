import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex";
import type { FakeNavigationIndex } from "@/test/navigation-index-fake";

// The navigation reads run for real against a stand-in corpus, so these
// follow a ?page= from the route through the loader to the index read.
const navigation = vi.hoisted(() => ({ total: 0 }) as FakeNavigationIndex);
// The request headers the page reads, as Next hands them over.
const incoming = vi.hoisted(() => ({ headers: new Headers() }));

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

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => incoming.headers),
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
import {
  EMPTY_404,
  PAST_THE_END,
  STATEMENT_TIMEOUT,
} from "@/test/navigation-index-fake";
import SectionPage from "./page";

// Next's own matcher for this route. It decodes each segment once, then
// drops one leading "_NEXTSEP_" from each.
const matchRoute = getRouteMatcher(getRouteRegex("/axiom/v2/[...segments]"));

/** The header the proxy hands the page the request's public path in. */
const PUBLIC_PATH = "x-axiom-public-path";

/** What Next hands the page when a browser asks for `href`, sending the
 *  headers in `sent`: the proxy rewrites the path under /axiom/v2, and
 *  Next matches the rewrite and gives the page the request headers the
 *  proxy names, or the browser's own when it names none. Null when the
 *  page never sees the request: Next redirects a path holding "//" before
 *  any route runs, and answers 400 to a segment that does not decode. */
function arrive(href: string, sent: Record<string, string> = {}) {
  const url = new URL(href, "https://axiom.org");
  if (url.pathname.includes("//")) return null;
  const response = proxy(new NextRequest(url, { headers: sent }));
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
  const listed = response.headers.get("x-middleware-override-headers");
  const headers = new Headers(listed === null ? sent : {});
  for (const name of (listed ?? "").split(",").filter(Boolean)) {
    headers.set(name, response.headers.get(`x-middleware-request-${name}`) ?? "");
  }
  return {
    path: url.pathname,
    segments: params.segments as string[],
    query,
    headers,
  };
}

function render_(
  segments: string[],
  query: Record<string, string | string[]>,
  headers = new Headers()
) {
  incoming.headers = headers;
  return SectionPage({
    params: Promise.resolve({ segments }),
    searchParams: Promise.resolve(query as { page?: string }),
  });
}

function visit(href: string, sent: Record<string, string> = {}) {
  const arrived = arrive(href, sent);
  if (!arrived) throw new Error(`Next refuses ${href}`);
  return render_(arrived.segments, arrived.query, arrived.headers);
}

/** The path the last visit looked up. */
const lastLookup = () => vi.mocked(getBrowsePageData).mock.lastCall?.[0];
/** Where the last redirect pointed. */
const lastTarget = () => vi.mocked(redirect).mock.lastCall?.[0] as string;

/** A container below title level that the reader does not resolve as a
 *  section, so it reads as a browse list (7 CFR Part 273). */
const asContainer = () =>
  vi.mocked(resolveSection).mockResolvedValue({
    containerCandidate: true,
  } as unknown as SectionResolution);

describe("v2 browse page past its last page", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(redirect).mockClear();
    vi.mocked(notFound).mockClear();
    vi.mocked(getBrowsePageData).mockClear();
    vi.mocked(resolveSection).mockReset();
    navigation.total = 15;
    navigation.childPage = null;
    navigation.childPages = [];
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
    asContainer();
    navigation.total = 120;

    await expect(visit("/us/regulation/7/273?page=3")).rejects.toThrow(
      "redirect to"
    );
    expect(redirect).toHaveBeenCalledWith("/us/regulation/7/273?page=1");
  });

  it("keeps an escaped segment as the request spelled it", async () => {
    // A fixed case: one decode or two give the same lookup here, so the
    // generated round trips below are the ones that tell them apart.
    await expect(visit("/us/statute/5%20App?page=1")).rejects.toThrow(
      "redirect to"
    );
    expect(redirect).toHaveBeenCalledWith("/us/statute/5%20App");
  });

  it("keeps a twice-escaped segment below title level", async () => {
    // Next hands the page "a%2Fb" and the page looks up a/b; the link
    // back keeps the request's spelling, so Next hands over "a%2Fb" again.
    asContainer();
    navigation.total = 120;

    await expect(visit("/us/regulation/7/a%252Fb?page=3")).rejects.toThrow(
      "redirect to"
    );
    expect(lastLookup()).toEqual(["us", "regulation", "7", "a/b"]);
    expect(redirect).toHaveBeenCalledWith("/us/regulation/7/a%252Fb?page=1");
    expect(arrive(lastTarget())?.segments).toEqual(["us", "regulation", "7", "a%2Fb"]);
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

  it.each([
    // Next drops one leading _NEXTSEP_, so the page looks up _NEXTSEP_26;
    // a link to /us/statute/_NEXTSEP_26 would look up 26.
    ["/us/statute/_NEXTSEP__NEXTSEP_26?page=1", "/us/statute/_NEXTSEP__NEXTSEP_26", "_NEXTSEP_26"],
    ["/us/statute/%5FNEXTSEP_%5FNEXTSEP_26?page=1", "/us/statute/%5FNEXTSEP_%5FNEXTSEP_26", "_NEXTSEP_26"],
    // Segments no link spells as they are: Next hands over ".", ".." and "".
    ["/us/statute/_NEXTSEP_.?page=1", "/us/statute/_NEXTSEP_.", "."],
    ["/us/statute/_NEXTSEP_..?page=1", "/us/statute/_NEXTSEP_..", ".."],
    ["/us/statute/_NEXTSEP_?page=1", "/us/statute/_NEXTSEP_", ""],
    ["/us/regulation/7/_NEXTSEP__NEXTSEP_273?page=3", "/us/regulation/7/_NEXTSEP__NEXTSEP_273?page=1", "_NEXTSEP_273"],
    ["/us/regulation/7/_NEXTSEP_..?page=3", "/us/regulation/7/_NEXTSEP_..?page=1", ".."],
  ])("sends %s back to the level it looked up", async (href, target, last) => {
    asContainer();
    navigation.total = href.includes("regulation") ? 120 : 15;
    const request = arrive(href)!;

    await expect(visit(href)).rejects.toThrow("redirect to");
    const looked = lastLookup()!;
    expect(looked[looked.length - 1]).toBe(last);
    expect(redirect).toHaveBeenCalledWith(target);
    // Following the link hands the page the same segments, so it looks up
    // the same path.
    expect(arrive(target)?.segments).toEqual(request.segments);
    await visit(target);
    expect(lastLookup()).toEqual(looked);
  });

  // Characters a URL treats specially, as typed, escaped once and escaped
  // twice, alone and inside a word.
  const raws = [
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
    "_NEXTSEP_",
    "_NEXTSEP_.",
    "_NEXTSEP_..",
    "_NEXTSEP__NEXTSEP_26",
    "_NEXTSEP_%2E",
  ]
    .flatMap((text) => [text, `x${text}y`])
    .flatMap((text) => [
      text,
      encodeURIComponent(text),
      encodeURIComponent(encodeURIComponent(text)),
    ]);

  it.each([
    ["at browse depth", "/us/statute/", ["us", "statute"], 15],
    ["below title level", "/us/regulation/7/", ["us", "regulation", "7"], 120],
  ])(
    "sends every spelling back to the same segments %s",
    async (_, prefix, parents, total) => {
      asContainer();
      navigation.total = total;
      const level = (segments: string[] | undefined) =>
        segments?.length === parents.length + 1 &&
        parents.every((parent, i) => segments[i] === parent);
      let followed = 0;

      for (const raw of raws) {
        const request = arrive(`${prefix}${raw}?page=3`);
        // Some spellings name another request (a raw "/", "?", "#" or dot
        // segment), and Next answers 400 to a segment that does not decode.
        if (!request || !level(request.segments) || request.query.page !== "3") {
          continue;
        }
        vi.mocked(redirect).mockClear();
        await expect(
          render_(request.segments, request.query, request.headers),
          raw
        ).rejects.toThrow("redirect to");
        const looked = lastLookup();
        const target = lastTarget();

        // The link keeps the path the request named, so following it hands
        // the page the same segments and looks up the same path.
        expect(target.split("?")[0], raw).toBe(request.path);
        const arrived = arrive(target);
        expect(arrived?.segments, `${raw} -> ${target}`).toEqual(request.segments);
        await render_(arrived!.segments, arrived!.query, arrived!.headers);
        expect(lastLookup(), `${raw} -> ${target}`).toEqual(looked);
        followed += 1;
      }
      // 109 of the 126 spellings at either depth.
      expect(followed).toBeGreaterThan(100);
    }
  );

  it("takes the path from the proxy, never from the request's own header", async () => {
    await expect(
      visit("/us/statute/26?page=1", { [PUBLIC_PATH]: "//evil.example" })
    ).rejects.toThrow("redirect to /us/statute/26");
    expect(redirect).toHaveBeenCalledWith("/us/statute/26");
  });

  // These render the page directly, past the proxy: a request the proxy
  // did not rewrite, or a path header that names somewhere else.
  it.each([
    ["no path header", null],
    ["a protocol-relative path", "//evil.example"],
    ["a backslash after the slash", "/\\evil.example"],
    ["a scheme and host", "https://evil.example/us/statute/26"],
    ["a script scheme", "javascript:alert(1)"],
    ["a dot segment that leaves the level", "/us/statute/26/../27"],
    ["a tab a browser drops", "/\t/evil.example"],
  ])("never redirects with %s", async (_, path) => {
    const headers = new Headers();
    if (path !== null) headers.set(PUBLIC_PATH, path);

    await expect(
      render_(["us", "statute", "26"], { page: "3" }, headers)
    ).rejects.toThrow("not found");
    expect(redirect).not.toHaveBeenCalled();
  });

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

  // 501 children under a part the reader does not resolve, with every
  // child from the 101st on stale: pages 1 to 5 list nothing.
  const staleFrom = (first: number) =>
    Array.from({ length: 502 - first }, (_, i) => first + i);

  it("sends a container whose later pages list nothing to a page 0 that lists a child", async () => {
    vi.mocked(resolveSection).mockResolvedValue(null);
    navigation.total = 501;
    navigation.stale = staleFrom(101);

    await expect(visit("/us/regulation/7/273?page=6")).rejects.toThrow(
      "redirect to"
    );
    expect(redirect).toHaveBeenCalledWith("/us/regulation/7/273");
    render(await visit("/us/regulation/7/273"));
    expect(screen.getByTestId("browse-list")).toBeInTheDocument();
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("answers a container whose every page lists nothing as page 0 does", async () => {
    vi.mocked(resolveSection).mockResolvedValue(null);
    navigation.total = 501;
    navigation.stale = staleFrom(1);

    await expect(visit("/us/regulation/7/273")).rejects.toThrow("not found");
    await expect(visit("/us/regulation/7/273?page=6")).rejects.toThrow(
      "not found"
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still shows the outage notice when the index fails", async () => {
    navigation.childPage = STATEMENT_TIMEOUT;

    render(await visit("/us/statute/26?page=1"));

    expect(screen.getByTestId("browse-unavailable")).toHaveTextContent(
      "Navigation data is temporarily unavailable"
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["a later page", [EMPTY_404]],
    ["the second read after a 416", [PAST_THE_END, EMPTY_404]],
  ])(
    "shows the outage notice when %s comes back as an empty 404",
    async (_, answers) => {
      // postgrest-js hands an empty 404 back as a 204 with no rows.
      navigation.total = 250;
      navigation.childPages = [...answers];

      render(await visit("/us/statute/26?page=1"));

      expect(screen.getByTestId("browse-unavailable")).toBeInTheDocument();
      expect(redirect).not.toHaveBeenCalled();
    }
  );
});
