/**
 * Ghost Content API client for the blog (server-side only).
 *
 * Reads the published posts of the foundation's Ghost instance. The
 * Content API is read-only and its key is publishable-class (like the
 * Supabase anon key), but we still keep it in env and off the client.
 * Without configuration the blog renders empty rather than erroring —
 * same posture as the runtime API.
 */

import { createHmac } from "node:crypto";

const REQUEST_TIMEOUT_MS = 6000;
const REVALIDATE_SECONDS = 300;

export interface BlogPostSummary {
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  featureImage: string | null;
  /** Ghost's per-image alt text; null means the cover is decorative. */
  featureImageAlt: string | null;
  /** Ghost's cover caption. HTML (e.g. a photo credit), not plain text. */
  featureImageCaption: string | null;
  readingTime: number | null;
}

export interface BlogPost extends BlogPostSummary {
  html: string;
  authors: string[];
  /** Admin API only ("draft" | "published" | "scheduled" | "sent");
   *  null from the Content API, where published is implied. Note that
   *  drafts can still carry a published_at — status is the truth. */
  status: string | null;
}

interface GhostPost {
  slug: string;
  title: string;
  custom_excerpt?: string | null;
  excerpt?: string | null;
  published_at?: string | null;
  feature_image?: string | null;
  feature_image_alt?: string | null;
  feature_image_caption?: string | null;
  reading_time?: number | null;
  html?: string | null;
  authors?: Array<{ name?: string | null }> | null;
  status?: string | null;
}

function apiUrl(): string | null {
  const base = process.env.GHOST_CONTENT_API_URL;
  return base ? base.replace(/\/$/, "") : null;
}

async function ghostGet(
  resource: string,
  params: Record<string, string>
): Promise<{ posts: GhostPost[] } | null> {
  const base = apiUrl();
  const key = process.env.GHOST_CONTENT_API_KEY;
  if (!base || !key) return null;
  const search = new URLSearchParams({ key, ...params });
  try {
    const response = await fetch(
      `${base}/ghost/api/content/${resource}/?${search}`,
      {
        headers: { "Accept-Version": "v5.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        next: { revalidate: REVALIDATE_SECONDS },
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as { posts: GhostPost[] };
  } catch {
    return null;
  }
}

function toSummary(post: GhostPost): BlogPostSummary {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.custom_excerpt ?? post.excerpt ?? null,
    publishedAt: post.published_at ?? null,
    featureImage: post.feature_image ?? null,
    // An empty string means "none" too, so callers need one check.
    featureImageAlt: post.feature_image_alt || null,
    featureImageCaption: post.feature_image_caption || null,
    readingTime: post.reading_time ?? null,
  };
}

/** Published posts, newest first. Empty when unconfigured or down. */
export async function getBlogPosts(): Promise<BlogPostSummary[]> {
  const data = await ghostGet("posts", {
    fields:
      "slug,title,custom_excerpt,excerpt,published_at,feature_image,feature_image_alt,feature_image_caption,reading_time",
    order: "published_at desc",
    limit: "100",
  });
  return (data?.posts ?? []).map(toSummary);
}

function toPost(post: GhostPost): BlogPost {
  return {
    ...toSummary(post),
    html: post.html ?? "",
    authors: (post.authors ?? [])
      .map((a) => a?.name ?? "")
      .filter((name) => name.length > 0),
    status: post.status ?? null,
  };
}

/** One post with its rendered HTML, or null when absent/unconfigured. */
export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  // No `fields` filter, so the slug endpoint's default response
  // carries feature_image_alt and feature_image_caption.
  const data = await ghostGet(`posts/slug/${encodeURIComponent(slug)}`, {
    include: "authors",
  });
  const post = data?.posts?.[0];
  return post ? toPost(post) : null;
}

/* ── draft previews (Admin API) ──────────────────────────────────────
 *
 * The Content API only serves published posts; previews read through
 * the Admin API instead. Its auth is a short-lived JWT signed with the
 * admin key ("id:hexsecret") — a real secret, so it lives only in
 * .env.local and the Vercel dashboard, never in the committed env. The
 * post's uuid is the share token: unguessable, and useless once the
 * post is published or deleted. */

function adminToken(key: string): string | null {
  const [id, secret] = key.split(":");
  if (!id || !secret) return null;
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "HS256", typ: "JWT", kid: id })}.${b64({
    iat: now,
    exp: now + 300,
    aud: "/admin/",
  })}`;
  const signature = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

/** A post in any status by uuid — for share-link draft previews.
 *  Never cached; null when unconfigured, unknown, or malformed. */
export async function getDraftPreview(uuid: string): Promise<BlogPost | null> {
  const base = apiUrl();
  const key = process.env.GHOST_ADMIN_API_KEY;
  if (!base || !key) return null;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid)) return null;
  const token = adminToken(key);
  if (!token) return null;
  const search = new URLSearchParams({
    filter: `uuid:${uuid}`,
    formats: "html",
    include: "authors",
  });
  try {
    const response = await fetch(
      `${base}/ghost/api/admin/posts/?${search}`,
      {
        headers: {
          Authorization: `Ghost ${token}`,
          "Accept-Version": "v5.0",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { posts: GhostPost[] };
    const post = data.posts?.[0];
    return post ? toPost(post) : null;
  } catch {
    return null;
  }
}
