/**
 * Citation parsing for the ops dashboard. Encoding telemetry reports
 * citations in three formats:
 *
 * - current path form: `us-ma:regulations/106-cmr/704`
 * - legacy path form with the jurisdiction nested: `us:us-ma/regulations/...`
 * - human-readable federal statutes: `26 USC 1(j)(2)`
 *
 * All three normalize to a scope (jurisdiction), a singular document class,
 * and path segments, so runs group by real document and can be joined to
 * corpus navigation nodes (whose paths are `us/statute/26/24`-shaped) for
 * human-readable labels.
 */

const CLASS_SINGULAR: Record<string, string> = {
  statutes: "statute",
  statute: "statute",
  regulations: "regulation",
  regulation: "regulation",
  policies: "policy",
  policy: "policy",
  manuals: "manual",
  manual: "manual",
  forms: "form",
  form: "form",
  guidance: "guidance",
  rulemaking: "rulemaking",
};

const USC_CITATION = /^(\d+)\s+U\.?S\.?C\.?\s+§*\s*(.+)$/i;

export interface ParsedCitation {
  /** Jurisdiction, e.g. `us` or `us-ma`. Empty for unparseable citations. */
  scope: string;
  /** Path segments after the scope; the singular document class first. */
  segments: string[];
  /** Segments up to this index name the document; the rest are sections. */
  documentDepth: number;
}

export function parseCitation(citation: string): ParsedCitation {
  const usc = citation.match(USC_CITATION);
  if (usc) {
    return {
      scope: "us",
      segments: ["statute", usc[1], usc[2].trim()],
      documentDepth: 2,
    };
  }

  const colon = citation.indexOf(":");
  let scope = colon >= 0 ? citation.slice(0, colon) : "";
  const segments = (colon >= 0 ? citation.slice(colon + 1) : citation)
    .split("/")
    .filter(Boolean);
  if (
    segments.length > 1 &&
    /^[a-z]{2}(-[a-z0-9]+)*$/.test(segments[0]) &&
    CLASS_SINGULAR[segments[1]] != null
  ) {
    scope = segments.shift() as string;
  }
  if (segments.length > 0 && CLASS_SINGULAR[segments[0]] != null) {
    segments[0] = CLASS_SINGULAR[segments[0]];
  }
  const documentDepth = /^(polic|manual|guidance)/.test(segments[0] ?? "")
    ? 3
    : 2;
  return {
    scope,
    segments,
    documentDepth: Math.min(documentDepth, segments.length),
  };
}

export function documentKeyFromCitation(citation: string): string {
  const { scope, segments, documentDepth } = parseCitation(citation);
  if (!scope && segments.length <= 1) return citation;
  return `${scope}:${segments.slice(0, documentDepth).join("/")}`;
}

/** The part of a run's citation that locates it inside its document. */
export function sectionWithinDocument(
  citation: string | null,
  documentKey: string
): string {
  if (!citation) return "—";
  const { segments, documentDepth } = parseCitation(citation);
  const tail = segments.slice(documentDepth).join("/");
  if (tail) return tail;
  // The run covered the document root, or the citation isn't a path.
  return documentKeyFromCitation(citation) === documentKey
    ? "(document)"
    : citation;
}

export interface CorpusPathsForCitation {
  /** Corpus navigation path of the containing document, e.g. `us/statute/26`. */
  document: string | null;
  /** Corpus navigation path of the section itself, when deeper than the
   *  document. Subsection parentheses are stripped (`1(j)(2)` → `1`) to match
   *  section-level navigation nodes. */
  section: string | null;
}

export function corpusPathsForCitation(
  citation: string
): CorpusPathsForCitation {
  const { scope, segments, documentDepth } = parseCitation(citation);
  if (!scope || segments.length === 0) return { document: null, section: null };
  const document = [scope, ...segments.slice(0, documentDepth)].join("/");
  const sectionSegments = segments
    .slice(documentDepth)
    .map((segment) => segment.replace(/\(.*$/, "").trim())
    .filter(Boolean);
  const section =
    sectionSegments.length > 0
      ? [document, ...sectionSegments].join("/")
      : null;
  return { document, section };
}

/** Corpus navigation path for a `scope:class/...` document key. */
export function corpusPathForDocumentKey(key: string): string | null {
  const colon = key.indexOf(":");
  if (colon <= 0) return null;
  return `${key.slice(0, colon)}/${key.slice(colon + 1)}`;
}

/**
 * Every corpus navigation path that could label this citation, document
 * first, deepest (most specific) last. Includes the ancestors between
 * document and section so a citation with an unindexed leaf (e.g. a
 * `document-1` suffix) still resolves to its section's label.
 */
export function corpusLookupPathsForCitation(citation: string): string[] {
  const { scope, segments, documentDepth } = parseCitation(citation);
  if (!scope || segments.length === 0) return [];
  const cleaned = segments
    .map((segment) => segment.replace(/\(.*$/, "").trim())
    .filter(Boolean);
  const paths: string[] = [];
  for (let depth = documentDepth; depth <= cleaned.length; depth++) {
    paths.push([scope, ...cleaned.slice(0, depth)].join("/"));
  }
  return [...new Set(paths)];
}
