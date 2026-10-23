import { supabaseCorpus, type Rule } from "@/lib/supabase";
import { AXIOM_APP_URL, SITE_URL } from "@/lib/urls";
import { citationPathLookupCandidates } from "./citation-path-aliases";
import { citationPathPrefixes } from "./resolver";
import { MAX_BROWSE_SEGMENTS } from "./browse-page";

/**
 * Canonical base URL for Axiom app links in OpenGraph, sitemap, and
 * JSON-LD. Overridable via NEXT_PUBLIC_AXIOM_APP_URL for previews.
 */
export { AXIOM_APP_URL, SITE_URL };

/**
 * Shape the viewer + external share surfaces consume for a single
 * rule. Server-rendered so the OpenGraph preview has real text and
 * not a "loading…" placeholder.
 */
export interface AxiomRuleMetadata {
  rule: Rule | null;
  title: string;
  description: string;
  canonicalUrl: string;
  citationPath: string;
  jurisdiction: string | null;
  docType: string | null;
}

const METADATA_QUERY_TIMEOUT_MS = 1200;

/**
 * Absolute app URL for a citation path. Each segment is percent-encoded
 * (after undoing any encoding it arrived with, so already-encoded and
 * decoded spellings give the same URL): a segment can't add a path
 * level, a query, a fragment, or markup. Dot segments are dropped, since
 * a URL parser would collapse them even percent-encoded. toWellFormed
 * keeps a lone surrogate from making encodeURIComponent throw.
 */
export function citationUrl(citationPath: string): string {
  const encoded = citationPath
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecode(segment).toWellFormed())
    .filter((segment) => segment !== "." && segment !== "..")
    .map(encodeURIComponent)
    .join("/");
  return encoded ? `${AXIOM_APP_URL}/${encoded}` : AXIOM_APP_URL;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function firstSentence(text: string, maxLen = 200): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

/**
 * Fetch the rule at a citation_path (or the deepest ingested
 * ancestor) and build human-readable title + description strings.
 *
 * Called from ``generateMetadata`` on the server so Axiom rule URLs
 * render as first-class shareable objects — the OG preview shows the
 * actual citation and a snippet of body text, not a generic header.
 *
 * The v1 page's resolver. The v2 reader resolves paths its own way
 * (en-dash spellings, synthetic roots …) and uses
 * metadataForResolution instead.
 */
export async function getAxiomRuleMetadata(
  segments: string[] | undefined
): Promise<AxiomRuleMetadata> {
  const citationPath = (segments ?? []).join("/");
  if (!citationPath) return unresolvedMetadata("");

  const lookupCandidates = citationPathLookupCandidates(citationPath);
  const prefixes = uniqueCitationPaths([
    ...lookupCandidates,
    ...citationPathPrefixes(citationPath),
  ]);
  const result = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*")
      .in("citation_path", prefixes),
    METADATA_QUERY_TIMEOUT_MS,
    null
  );
  const data = result?.data ?? null;

  const byPath = new Map<string, Rule>();
  for (const row of (data as Rule[] | null) ?? []) {
    if (row.citation_path) byPath.set(row.citation_path, row);
  }
  let rule: Rule | null = null;
  for (const prefix of prefixes) {
    const hit = byPath.get(prefix);
    if (hit) {
      rule = hit;
      break;
    }
  }

  if (!rule) return unresolvedMetadata(citationPath);

  // The row's own URL is canonical when the row is what the request
  // names (an exact or alias hit) or a body-bearing ancestor, which the
  // reader shows in the request's place. A bodyless ancestor is a
  // container the page doesn't show, so the request keeps its own URL.
  const rowPath = rule.citation_path ?? citationPath;
  const named = rowPath === citationPath || lookupCandidates.includes(rowPath);
  const canonicalPath = named || rule.body?.trim() ? rowPath : citationPath;
  return describeRule(rule, citationPath, citationUrl(canonicalPath));
}

/**
 * Metadata for a page the v2 reader resolved. The resolution is what the
 * page shows, so its citation path is the canonical URL: a suffix the
 * corpus doesn't have collapses to the section rendered in its place,
 * and paths the reader resolves its own way (synthetic roots, en-dash
 * spellings, NYCRR splits) keep their section's URL. A subsection the
 * page is focused on keeps its own URL, as the reader's cite links give
 * it: pass `focusAnchor` only for a structural one (structuralFocus in
 * section-page.ts), not a marker matched in running text.
 *
 * One exception: a section stored at browse depth (a joined "422.12C"
 * segment) has no reader URL of its own, since paths that short route to
 * the browse view, so it keeps the spelling that reached the reader. The
 * JSON-LD names the row either way.
 */
export function metadataForResolution(resolution: {
  root: Rule;
  citationPath: string;
  requestedPath: string;
  focusAnchor: string | null;
}): AxiomRuleMetadata {
  const { root, citationPath, requestedPath, focusAnchor } = resolution;
  const own = citationUrl(citationPath);
  const levels = own.slice(AXIOM_APP_URL.length).split("/").filter(Boolean).length;
  const canonical =
    levels <= MAX_BROWSE_SEGMENTS
      ? citationUrl(requestedPath)
      : focusAnchor
        ? citationUrl(`${citationPath}/${focusAnchor}`)
        : own;
  return describeRule(root, citationPath, canonical);
}

/**
 * Metadata for a path no row answers: generic copy, and the path itself,
 * encoded, as the canonical URL. No JSON-LD is written for it.
 */
export function unresolvedMetadata(citationPath: string): AxiomRuleMetadata {
  if (!citationPath) {
    return {
      rule: null,
      title: "Axiom — Axiom Foundation",
      description:
        "Browse every atomic rule in the encoded legal code: source text, RuleSpec encoding, and the citation graph that ties them together.",
      canonicalUrl: AXIOM_APP_URL,
      citationPath: "",
      jurisdiction: null,
      docType: null,
    };
  }
  return {
    rule: null,
    title: `${citationPath} — Axiom`,
    description:
      "Browse available Axiom legal-code entries for this citation path, including source text, RuleSpec encodings, and citation graph context.",
    canonicalUrl: citationUrl(citationPath),
    citationPath,
    jurisdiction: null,
    docType: null,
  };
}

/** Title and description for `rule`, on a page canonical at `canonicalUrl`. */
function describeRule(
  rule: Rule,
  citationPath: string,
  canonicalUrl: string
): AxiomRuleMetadata {
  const heading = rule.heading?.trim();
  const body = rule.body?.trim();
  const citationLabel = rule.citation_path ?? citationPath;
  const title = heading
    ? `${citationLabel} — ${heading} · Axiom`
    : `${citationLabel} · Axiom`;
  const description = body
    ? firstSentence(body)
    : heading
      ? `Atomic rule: ${heading}. Source text and encoding in Axiom.`
      : `Atomic rule at ${citationLabel} — view source and encoding in Axiom.`;

  return {
    rule,
    title,
    description,
    canonicalUrl,
    citationPath,
    jurisdiction: rule.jurisdiction,
    docType: rule.doc_type,
  };
}

function uniqueCitationPaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function withTimeout<T>(
  promise: PromiseLike<T>,
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

/**
 * JSON-LD for a rule — uses schema.org's Legislation type so search
 * engines and downstream citation tools (Zotero, Perplexity, LLMs
 * with retrieval) recognise the object properly.
 */
export function buildLegislationJsonLd(meta: AxiomRuleMetadata): object | null {
  if (!meta.rule) return null;
  const citationLabel = meta.rule.citation_path ?? meta.citationPath;
  return {
    "@context": "https://schema.org",
    "@type": "Legislation",
    name: meta.rule.heading || citationLabel,
    alternateName: citationLabel,
    identifier: citationLabel,
    legislationIdentifier: citationLabel,
    legislationJurisdiction: meta.rule.jurisdiction || undefined,
    legislationType:
      meta.rule.doc_type === "regulation"
        ? "Regulation"
        : meta.rule.doc_type === "legislation"
          ? "Act"
          : "Statute",
    // The described row's own URL, never the request's: a reader URL
    // may carry a suffix the row doesn't have.
    url: citationUrl(citationLabel),
    inLanguage: inferLanguage(meta.rule.jurisdiction),
    text: meta.rule.body || undefined,
    dateModified: meta.rule.updated_at || undefined,
  };
}

function inferLanguage(jurisdiction: string | null): string {
  if (!jurisdiction) return "en";
  // Canadian federal code exists in en + fr; default to en.
  return "en";
}
