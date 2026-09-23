import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostArticle } from "@/components/blog/post-article";
import { getBlogPost } from "@/lib/ghost";
import { DEFAULT_SHARE_IMAGE, SITE_NAME } from "@/lib/share";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) return { title: "Blog — Axiom Foundation" };
  return {
    title: `${post.title} — Axiom Foundation`,
    description: post.excerpt ?? undefined,
    // Next merges metadata per top-level key, so this block replaces the
    // root layout's openGraph wholesale: it restates the url and brand
    // card rather than inheriting them. The url resolves against the
    // layout's metadataBase, like its canonical.
    openGraph: {
      type: "article",
      url: "./",
      siteName: SITE_NAME,
      title: post.title,
      description: post.excerpt ?? undefined,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt ?? undefined,
      authors: post.authors.length > 0 ? post.authors : undefined,
      images: post.featureImage
        ? [
            {
              url: post.featureImage,
              alt: post.featureImageAlt ?? undefined,
            },
          ]
        : [DEFAULT_SHARE_IMAGE],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) notFound();

  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <PostArticle post={post} />
    </div>
  );
}
