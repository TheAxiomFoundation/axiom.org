import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/landing/reveal";
import { getBlogPosts } from "@/lib/ghost";

export const metadata: Metadata = {
  title: "Blog — Axiom Foundation",
  description:
    "News and writing from the Axiom Foundation — encoding the world's rules as open, executable, cited infrastructure.",
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date);
}

export default async function BlogPage() {
  const posts = await getBlogPosts();

  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="max-w-[960px] mx-auto">
        <Reveal className="mb-16 max-w-[760px]">
          <h1 className="heading-page mb-7">Blog</h1>
          <p className="font-body text-[1.35rem] text-[var(--color-ink-secondary)] leading-[1.65] text-pretty">
            News and writing from the foundation.
          </p>
        </Reveal>

        {posts.length === 0 ? (
          <Reveal className="border-t border-[var(--color-rule)] py-12">
            <p className="m-0 font-body text-[1.05rem] text-[var(--color-ink-muted)]">
              No posts yet — check back soon.
            </p>
          </Reveal>
        ) : (
          <ol className="m-0 list-none p-0">
            {posts.map((post, index) => {
              const date = formatDate(post.publishedAt);
              const titleId = `blog-post-${index}`;
              return (
                <Reveal as="li" key={post.slug} className="border-t border-[var(--color-rule)]">
                  <Link
                    href={`/blog/${post.slug}`}
                    aria-labelledby={titleId}
                    className={`group grid items-center gap-6 py-9 text-[var(--color-ink)] no-underline outline-offset-8 ${post.featureImage ? "md:grid-cols-[280px_minmax(0,1fr)] md:gap-9" : ""}`}
                  >
                    {post.featureImage && (
                      <div className="aspect-[16/10] overflow-hidden rounded-sm bg-[var(--color-surface)]">
                        {/* Ghost supplies the original cover URL and its editorial alt text. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={post.featureImage}
                          alt={post.featureImageAlt ?? ""}
                          width={560}
                          height={350}
                          loading={index === 0 ? "eager" : "lazy"}
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      {(date || post.readingTime) && (
                        <p className="m-0 mb-3 font-mono text-[0.68rem] tracking-[0.1em] uppercase text-[var(--color-ink-muted)]">
                          {date && <time dateTime={post.publishedAt!}>{date}</time>}
                          {date && post.readingTime ? " · " : null}
                          {post.readingTime ? `${post.readingTime} min read` : null}
                        </p>
                      )}
                      <h2 id={titleId} className="m-0 mb-3 font-display text-[1.5rem] font-light tracking-[0.01em] leading-snug transition-colors group-hover:text-[var(--color-accent)]">
                        {post.title}
                      </h2>
                      {post.excerpt && (
                        <p className="m-0 font-body text-[1.02rem] text-[var(--color-ink-secondary)] leading-relaxed text-pretty line-clamp-3">
                          {post.excerpt}
                        </p>
                      )}
                      <span aria-hidden="true" className="mt-4 inline-flex items-center gap-2 font-mono text-[0.7rem] text-[var(--color-accent)]">
                        Read article <span>→</span>
                      </span>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
