import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBlogPosts, getBlogPost, getDraftPreview } from "./ghost";

const GHOST_URL = "https://the-axiom-foundation.ghost.io";
const ADMIN_KEY = `abcdef0123456789abcdef01:${"ab".repeat(32)}`;

const POST = {
  slug: "first-post",
  title: "First post",
  custom_excerpt: "Short version.",
  excerpt: "Long version.",
  published_at: "2026-07-20T12:00:00.000+00:00",
  updated_at: "2026-07-21T09:30:00.000+00:00",
  feature_image: "https://example.com/cover.png",
  feature_image_alt: "Sepia illustration of an auditor at a desk.",
  feature_image_caption:
    '<span style="white-space: pre-wrap;">Photo by Martin Romero</span>',
  reading_time: 3,
  html: "<p>Body.</p>",
  authors: [{ name: "Ariel Kennan" }, { name: null }],
  status: "published",
};

function mockFetch(payload: unknown, ok = true) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("ghost content client", () => {
  beforeEach(() => {
    vi.stubEnv("GHOST_CONTENT_API_URL", GHOST_URL);
    vi.stubEnv("GHOST_CONTENT_API_KEY", "contentkey");
    vi.stubEnv("GHOST_ADMIN_API_KEY", ADMIN_KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists published posts, preferring the custom excerpt", async () => {
    const fetchMock = mockFetch({ posts: [POST] });
    const posts = await getBlogPosts();
    expect(posts).toEqual([
      {
        slug: "first-post",
        title: "First post",
        excerpt: "Short version.",
        publishedAt: "2026-07-20T12:00:00.000+00:00",
        featureImage: "https://example.com/cover.png",
        featureImageAlt: "Sepia illustration of an auditor at a desk.",
        featureImageCaption:
          '<span style="white-space: pre-wrap;">Photo by Martin Romero</span>',
        readingTime: 3,
      },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.href).toContain(`${GHOST_URL}/ghost/api/content/posts/`);
    expect(url.searchParams.get("key")).toBe("contentkey");
    // the list endpoint only returns the fields it is asked for
    expect(url.searchParams.get("fields")?.split(",")).toEqual(
      expect.arrayContaining([
        "feature_image",
        "feature_image_alt",
        "feature_image_caption",
      ])
    );
  });

  it("treats missing or empty cover alt text and captions as none", async () => {
    mockFetch({
      posts: [
        { ...POST, slug: "empty", feature_image_alt: "", feature_image_caption: "" },
        {
          ...POST,
          slug: "missing",
          feature_image_alt: undefined,
          feature_image_caption: null,
        },
      ],
    });
    const posts = await getBlogPosts();
    expect(
      posts.map(({ featureImageAlt, featureImageCaption }) => ({
        featureImageAlt,
        featureImageCaption,
      }))
    ).toEqual([
      { featureImageAlt: null, featureImageCaption: null },
      { featureImageAlt: null, featureImageCaption: null },
    ]);
  });

  it("returns [] when unconfigured and on API failure", async () => {
    vi.stubEnv("GHOST_CONTENT_API_KEY", "");
    expect(await getBlogPosts()).toEqual([]);
    vi.stubEnv("GHOST_CONTENT_API_KEY", "contentkey");
    mockFetch({}, false);
    expect(await getBlogPosts()).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    expect(await getBlogPosts()).toEqual([]);
  });

  it("fetches one post with html and clean author names", async () => {
    const fetchMock = mockFetch({ posts: [POST] });
    const post = await getBlogPost("first-post");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/ghost/api/content/posts/slug/first-post/");
    // no field filter, so Ghost sends the cover alt text and caption
    expect(url.searchParams.has("fields")).toBe(false);
    expect(post?.html).toBe("<p>Body.</p>");
    expect(post?.updatedAt).toBe("2026-07-21T09:30:00.000+00:00");
    expect(post?.authors).toEqual(["Ariel Kennan"]);
    expect(post?.status).toBe("published");
    expect(post?.featureImageAlt).toBe(
      "Sepia illustration of an auditor at a desk."
    );
    expect(post?.featureImageCaption).toBe(
      '<span style="white-space: pre-wrap;">Photo by Martin Romero</span>'
    );
  });

  it("reads a post without an edit timestamp as updatedAt null", async () => {
    mockFetch({ posts: [{ ...POST, updated_at: undefined }] });
    expect((await getBlogPost("first-post"))?.updatedAt).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    mockFetch({ posts: [] });
    expect(await getBlogPost("missing")).toBeNull();
  });

  it("previews any-status posts via the admin API with a signed JWT", async () => {
    const fetchMock = mockFetch({ posts: [{ ...POST, status: "draft" }] });
    const post = await getDraftPreview("8add9475-e561-43fe-923c-c20f93e0f54b");
    expect(post?.status).toBe("draft");
    expect(post?.featureImageAlt).toBe(
      "Sepia illustration of an auditor at a desk."
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/ghost/api/admin/posts/");
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Ghost [\w-]+\.[\w-]+\.[\w-]+$/);
    // the JWT header carries the key id
    const header = JSON.parse(
      Buffer.from(auth.split(" ")[1].split(".")[0], "base64url").toString()
    );
    expect(header.kid).toBe(ADMIN_KEY.split(":")[0]);
    expect(init.cache).toBe("no-store");
  });

  it("rejects malformed uuids and missing admin config without fetching", async () => {
    const fetchMock = mockFetch({ posts: [POST] });
    expect(await getDraftPreview("not-a-uuid")).toBeNull();
    vi.stubEnv("GHOST_ADMIN_API_KEY", "");
    expect(
      await getDraftPreview("8add9475-e561-43fe-923c-c20f93e0f54b")
    ).toBeNull();
    vi.stubEnv("GHOST_ADMIN_API_KEY", "no-colon-here");
    expect(
      await getDraftPreview("8add9475-e561-43fe-923c-c20f93e0f54b")
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
