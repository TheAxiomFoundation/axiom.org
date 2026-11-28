import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FakeNavigationIndex } from "@/test/navigation-index-fake";

// The navigation reads run for real against a stand-in corpus, so these
// follow a ?page= from the route through the loader to the index read.
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

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect to ${url}`);
  }),
}));

vi.mock("@/lib/axiom/section-page", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/axiom/section-page")>()),
  resolveSection: vi.fn(),
}));

import { redirect } from "next/navigation";
import { resolveSection, type SectionResolution } from "@/lib/axiom/section-page";
import { PAST_THE_END, STATEMENT_TIMEOUT } from "@/test/navigation-index-fake";
import SectionPage from "./page";

function visit(path: string, query: Record<string, string>) {
  return SectionPage({
    params: Promise.resolve({ segments: path.split("/") }),
    // Next passes every query parameter, not only the ones the page names.
    searchParams: Promise.resolve(query as { page?: string }),
  });
}

describe("v2 browse page past its last page", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
    vi.mocked(resolveSection).mockReset();
    navigation.childPage = PAST_THE_END;
  });

  it("sends a page past the last child to the level's only page", async () => {
    // https://axiom.org/us/statute/26?page=1, a level with 15 children
    navigation.total = 15;

    await expect(visit("us/statute/26", { page: "1" })).rejects.toThrow(
      "redirect to /us/statute/26"
    );
    expect(redirect).toHaveBeenCalledWith("/us/statute/26");
  });

  it("names the last page and keeps the other query parameters", async () => {
    navigation.total = 250;

    await expect(
      visit("us/statute/26", {
        page: "4",
        embed: "1",
        rule: "eitc",
        from: "share",
      })
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

    await expect(visit("us/regulation/7/273", { page: "3" })).rejects.toThrow(
      "redirect to"
    );
    expect(redirect).toHaveBeenCalledWith("/us/regulation/7/273?page=1");
  });

  it("still shows the outage notice when the index fails", async () => {
    navigation.childPage = STATEMENT_TIMEOUT;
    navigation.total = 15;

    render(await visit("us/statute/26", { page: "1" }));

    expect(screen.getByTestId("browse-unavailable")).toHaveTextContent(
      "Navigation data is temporarily unavailable"
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
