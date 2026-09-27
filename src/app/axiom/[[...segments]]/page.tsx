import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  buildLegislationJsonLd,
  getAxiomRuleMetadata,
} from "@/lib/axiom/metadata";
import { AXIOM_ENCODED_ONLY_COOKIE } from "@/lib/axiom/preferences";
import { DEFAULT_SHARE_IMAGE, SITE_NAME } from "@/lib/share";
import { resolveAxiomPath } from "@/lib/tree-data";
import {
  treeNodesCacheKey,
  type InitialTreeNodesState,
} from "@/lib/axiom/tree-cache";
import { loadTreeNodes } from "@/lib/axiom/tree-node-loader";
import { getAxiomStats, type AxiomStats } from "@/lib/supabase";
import { AxiomClient } from "./axiom-client";
import V2SectionPage, {
  generateMetadata as generateV2Metadata,
} from "../v2/[...segments]/page";

interface PageProps {
  params: Promise<{ segments?: string[] }>;
}

const INITIAL_TREE_STATE_TIMEOUT_MS = 1500;
const INITIAL_AXIOM_STATS_TIMEOUT_MS = 1500;

/** Turbopack dev lazily compiles routes, and until the sibling
 *  ``/axiom/v2/[...segments]`` route is compiled this optional
 *  catch-all can win the match for ``/axiom/v2/*`` — silently
 *  rendering v1 for the whole promoted surface. Delegating makes the
 *  router's pick irrelevant. */
function v2Params(segments: string[]) {
  return { params: Promise.resolve({ segments: segments.slice(1) }) };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { segments } = await params;
  if (segments?.[0] === "v2" && segments.length > 1) {
    return generateV2Metadata(v2Params(segments));
  }
  const meta = await getAxiomRuleMetadata(segments);
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: meta.canonicalUrl },
    // Replaces the root layout's openGraph wholesale, so it restates the
    // brand card. No twitter block: the layout's keeps the site handle
    // and large card, and Next fills title, description and image from
    // this openGraph.
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: meta.canonicalUrl,
      type: "article",
      siteName: SITE_NAME,
      images: [DEFAULT_SHARE_IMAGE],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function AxiomPage({ params }: PageProps) {
  const { segments } = await params;
  if (segments?.[0] === "v2" && segments.length > 1) {
    return V2SectionPage(v2Params(segments));
  }
  const [meta, initialEncodedOnly, initialStats] = await Promise.all([
    getAxiomRuleMetadata(segments),
    getInitialEncodedOnly(),
    getInitialAxiomStats(segments ?? []),
  ]);
  const initialTreeState = await getInitialTreeState(
    segments ?? [],
    initialEncodedOnly
  );
  const jsonLd = buildLegislationJsonLd(meta);

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <AxiomClient
        segments={segments ?? []}
        initialTreeState={initialTreeState}
        initialStats={initialStats}
        initialEncodedOnly={initialEncodedOnly}
      />
    </>
  );
}

async function getInitialEncodedOnly(): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get(AXIOM_ENCODED_ONLY_COOKIE)?.value === "1";
  } catch {
    return false;
  }
}

async function getInitialAxiomStats(
  segments: string[]
): Promise<AxiomStats | null> {
  if (segments.length > 0) return null;
  return withTimeout(
    getAxiomStats(),
    INITIAL_AXIOM_STATS_TIMEOUT_MS,
    null
  );
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function getInitialTreeState(
  segments: string[],
  encodedOnly: boolean
): Promise<InitialTreeNodesState | null> {
  const decodedSegments = segments.map(decodeSegment);
  const resolved = resolveAxiomPath(decodedSegments);
  if (resolved.phase !== "rule" || !resolved.jurisdiction) {
    return null;
  }

  const {
    jurisdiction: { slug, hasCitationPaths },
    ruleSegments,
  } = resolved;
  const cacheKey = treeNodesCacheKey(slug, ruleSegments, encodedOnly);

  const result = await withTimeout(
    loadTreeNodes({
      dbJurisdictionId: slug,
      ruleSegments,
      hasCitationPaths,
      encodedOnly,
      page: 0,
    }),
    INITIAL_TREE_STATE_TIMEOUT_MS,
    null
  );
  if (!result) return null;

  return {
    cacheKey,
    nodes: result.nodes,
    hasMore: result.hasMore,
    currentRule: result.currentRule ?? null,
    leafRule: result.leafRule ?? null,
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}
