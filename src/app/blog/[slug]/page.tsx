import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostArticle } from "@/components/blog/post-article";
import { getBlogPost } from "@/lib/ghost";

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
    openGraph: post.featureImage
      ? {
          images: [
            {
              url: post.featureImage,
              alt: post.featureImageAlt ?? undefined,
            },
          ],
        }
      : undefined,
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
