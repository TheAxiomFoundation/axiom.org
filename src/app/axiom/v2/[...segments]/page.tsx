import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import {
  buildLegislationJsonLd,
  metadataForResolution,
  unresolvedMetadata,
} from "@/lib/axiom/metadata";
import { JsonLd } from "@/components/json-ld";
import { DEFAULT_SHARE_IMAGE, SITE_NAME } from "@/lib/share";
import {
  getSectionPageDataFromResolution,
  resolveSection,
  type SectionResolution,
} from "@/lib/axiom/section-page";
import { SectionReader } from "@/components/axiom/section/section-reader";
import { SectionSkeleton } from "@/components/axiom/section/section-skeleton";
import {
  browseTitle,
  getBrowsePageData,
  MAX_BROWSE_SEGMENTS,
} from "@/lib/axiom/browse-page";
import {
  BrowseView,
  BrowseUnavailable,
} from "@/components/axiom/section/browse-view";

/**
 * v2 section reader — the first server-rendered surface of the app
 * rebuild. Renders a provision and its whole subtree as one reading
 * column (single-column reader + sticky TOC), instead of the
 * client-monolith tree browser.
 *
 * The route resolves existence *before* streaming: a missing path
 * must produce a real HTTP 404, not a 200 shell that client-renders
 * a not-found screen (the old route-level loading.tsx committed the
 * status before notFound() could run). The heavy data assembly
 * (encodings, coverage, graphs) still streams behind Suspense.
 *
 * Preview route: kept noindex with a canonical pointing at the v1
 * URL until it replaces the v1 rule page as the canonical statute
 * surface.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segments: string[] }>;
  searchParams?: Promise<{ page?: string; embed?: string; rule?: string }>;
}

/** The reader's resolution of a path, once per request: React cache
 *  memoizes by argument, so the decoded segments are keyed as a string. */
const resolveSectionOnce = cache((key: string) =>
  resolveSection(JSON.parse(key) as string[]),
);
const resolveDecoded = (decoded: string[]) =>
  resolveSectionOnce(JSON.stringify(decoded));

function decodeSegments(segments: string[]): string[] {
  return segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { segments } = await params;
  const decoded = decodeSegments(segments);
  if (decoded.length <= MAX_BROWSE_SEGMENTS) {
    return {
      title: `${browseTitle(decoded)} · Axiom`,
      robots: { index: false, follow: true },
    };
  }
  // Metadata describes what the reader renders, so canonical and og:url
  // name the resolved section, never an unmatched suffix of the request.
  const resolution = await resolveDecoded(decoded);
  const meta = resolution
    ? metadataForResolution(resolution)
    : unresolvedMetadata(decoded.join("/"));
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: meta.canonicalUrl },
    // Without its own openGraph the page inherits the root layout's,
    // whose relative og:url echoes the request path, suffix and all.
    // This restates the brand card, as the v1 page does.
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: meta.canonicalUrl,
      type: "article",
      siteName: SITE_NAME,
      images: [DEFAULT_SHARE_IMAGE],
    },
    // Launch flip: the whole /axiom subtree is noindexed until the
    // Jul 28 reveal (see src/app/axiom/layout.tsx).
    robots: { index: false, follow: true },
  };
}

async function SectionBody({
  resolution,
  highlightRule,
}: {
  resolution: SectionResolution;
  highlightRule: string | null;
}) {
  const data = await getSectionPageDataFromResolution(resolution);
  if (!data) notFound();

  const jsonLd = buildLegislationJsonLd(metadataForResolution(resolution));

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}
      <SectionReader data={data} highlightRule={highlightRule} />
    </>
  );
}

export default async function SectionPage({
  params,
  searchParams,
}: PageProps) {
  const { segments } = await params;
  const decoded = decodeSegments(segments);
  const query = await searchParams;
  // ?embed=1 renders the page for the Plane's law popup: same
  // content, no site chrome, no cross-navigation (CSS handles both).
  const embed = query?.embed === "1";
  const shell = (node: React.ReactNode) =>
    embed ? <div className="embed-page">{node}</div> : <>{node}</>;
  // ?rule= names the encoded rule the visitor navigated from (the
  // graph inspector's Read-the-law) — the rail spotlights its card.
  const rawRule = query?.rule ?? "";
  const highlightRule = /^\w{1,120}$/.test(rawRule) ? rawRule : null;
  const rawPage = Number(query?.page ?? "0");
  const page =
    Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 50) : 0;

  // Browse depth (jurisdiction / doc type / title) renders the list
  // view; section depth and deeper renders the reader.
  if (decoded.length <= MAX_BROWSE_SEGMENTS) {
    const browse = await getBrowsePageData(decoded, page);
    if (browse === "unavailable") {
      // Transient backend failure — render a retryable notice, never
      // a 404 for a valid URL.
      return shell(<BrowseUnavailable path={decoded.join("/")} />);
    }
    if (!browse) notFound();
    return shell(<BrowseView data={browse} />);
  }

  const resolution = await resolveDecoded(decoded);

  // Container paths (a CFR part, a statute chapter) — bodyless roots
  // whose subtrees blow the reader cap — divert to the browse view
  // when the navigation index can list children here. Sections stay
  // readers; see SectionResolution.containerCandidate.
  if (!resolution || resolution.containerCandidate) {
    const browse = await getBrowsePageData(decoded, page, {
      allowDeep: true,
    }).catch(() => null);
    if (browse && browse !== "unavailable" && browse.nodes.length > 0) {
      return shell(<BrowseView data={browse} />);
    }
  }
  if (!resolution) notFound();

  return shell(
    <Suspense fallback={<SectionSkeleton />}>
      <SectionBody resolution={resolution} highlightRule={highlightRule} />
    </Suspense>,
  );
}
