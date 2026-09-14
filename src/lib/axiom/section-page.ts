import {
  supabaseCorpus,
  supabaseEncodings,
  getRuleReferences,
  type Rule,
  type RuleReference,
  type RuleEncodingData,
} from "@/lib/supabase";
import {
  resolveAxiomPath,
  buildBreadcrumbs,
  type BreadcrumbItem,
} from "@/lib/tree-data";
import { getProvisionByCitationPath } from "@/lib/axiom/navigation-index/read";
import type { NavigationNodeRow } from "@/lib/axiom/navigation-index/types";
import { parseRuleSpec } from "@/lib/axiom/rulespec/doc";
import { isGatedJurisdiction } from "@/lib/axiom/rulespec/index-visibility";
import {
  getProvisionCoverage,
  type ProvisionProgramCoverage,
} from "@/lib/axiom/runtime/coverage";
import { listParityCases } from "@/lib/axiom/runtime/api";
import {
  getSectionEncoding,
  type SectionEncoding,
} from "@/lib/axiom/section-encoding";

/**
 * Data assembly for the v2 server-rendered section page: one reading
 * column holding a provision and its full descendant subtree, plus
 * the navigation context around it (breadcrumbs, table of contents,
 * prev/next siblings).
 *
 * Everything here is fetched server-side in a handful of parallel
 * queries so the page can be cached/ISR'd later without a client
 * data-fetch waterfall. References are fetched via RPC only for the
 * section root; descendant bodies still get inline links through the
 * inferred-reference pass in RuleBody (no per-descendant RPC fan-out
 * — a subtree-references RPC is the planned follow-up).
 */

const SUBTREE_LIMIT = 600;
const SECTION_QUERY_TIMEOUT_MS = 4000;

export interface SectionProvision {
  rule: Rule;
  /** In-page anchor id, e.g. "a-1-B" for …/32/a/1/B under …/32. */
  anchor: string;
  /** Subsection designator chain relative to the root, e.g. "(a)(1)(B)". */
  designator: string;
  /** Depth below the section root (1 = direct child). */
  relativeDepth: number;
}

export interface SectionTocEntry {
  anchor: string;
  label: string;
  children: SectionTocEntry[];
}

export interface SectionNeighbor {
  citationPath: string;
  label: string;
}

/**
 * A top-level subsection sliced out of a section-granular body. The
 * corpus currently stores most sections as one provision row whose
 * body holds the whole section text, so the reading column derives
 * subsection structure by parsing "(a) …" markers instead of
 * fetching descendant rows.
 */
export interface BodyChunk {
  anchor: string;
  designator: string;
  /** Short preview of the subsection's opening text, for the TOC. */
  label: string;
  text: string;
  /** Offset of ``text`` within the full body. */
  start: number;
}

export interface SectionPageData {
  citationPath: string;
  root: Rule;
  breadcrumbs: BreadcrumbItem[];
  provisions: SectionProvision[];
  /**
   * Body-derived subsection chunks; used when the corpus has no
   * descendant rows (the common case today). ``intro`` is any text
   * before the first subsection marker.
   */
  intro: string | null;
  bodyChunks: BodyChunk[];
  toc: SectionTocEntry[];
  rootRefs: RuleReference[];
  /**
   * The root body as ingested, before descendant-duplication
   * trimming — the inferred-reference pass reads this so citations
   * survive the dedupe.
   */
  refBody?: string | null;
  /** RuleSpec encoding for the section (encoding_runs or GitHub). */
  encoding: RuleEncodingData | null;
  /** Rules from ``encoding`` mapped to their subsection anchors. */
  encodedRules: EncodedRuleLink[];
  /**
   * Executable runtime packages containing rules derived from this
   * provision (the provision↔program join). Empty when the runtime
   * API is unconfigured.
   */
  programs: ProvisionProgramCoverage[];
  /** Rule name → repo file path (the file half of its legal ID). */
  ruleFiles: Record<string, string>;
  /** Modules with materialized rules grounded in this provision. */
  citedByFiles: SectionEncoding["citedByFiles"];
  /** Citing rules not shown because the reverse lookup is bounded. */
  citedByOverflow: number;
  /**
   * Set when the requested path was deeper than the ingested corpus
   * row (e.g. …/26/32/a on a section-granular corpus): the section
   * renders in full and the reader highlights + scrolls to this
   * subsection anchor.
   */
  focusAnchor: string | null;
  prev: SectionNeighbor | null;
  next: SectionNeighbor | null;
  /** True when the subtree hit SUBTREE_LIMIT and was cut off. */
  truncated: boolean;
  /**
   * How much of the section the encodings cover: distinct top-level
   * subsections with rules vs. subsections total. Null when the
   * section has no subsection structure to measure against.
   */
  encodedCoverage: { encodedUnits: number; totalUnits: number } | null;
  /**
   * Oracle verification for the section's covering programs.
   * Only external-oracle comparisons earn "verified" — golden
   * expectations alone are self-graded (executable, not verified).
   */
  parity: {
    oracle: string;
    caseCount: number;
    programId: string;
    jurisdiction: string;
    caseDescriptions: string[];
  } | null;
}

/**
 * Segment-wise numeric-aware citation-path ordering: "…/2" sorts
 * before "…/10", and shorter paths sort before their descendants.
 */
export function compareCitationPaths(a: string, b: string): number {
  const as = a.split("/");
  const bs = b.split("/");
  const len = Math.min(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const cmp = as[i].localeCompare(bs[i], undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (cmp !== 0) return cmp;
  }
  return as.length - bs.length;
}

export function subtreeAnchor(rootPath: string, citationPath: string): string {
  if (!citationPath.startsWith(`${rootPath}/`)) return "";
  return citationPath
    .slice(rootPath.length + 1)
    .split("/")
    .join("-");
}

export function relativeDesignator(
  rootPath: string,
  citationPath: string,
): string {
  if (!citationPath.startsWith(`${rootPath}/`)) return "";
  return citationPath
    .slice(rootPath.length + 1)
    .split("/")
    .map((seg) => `(${seg})`)
    .join("");
}

function tocLabel(designator: string, heading: string | null): string {
  const trimmed = heading?.trim();
  return trimmed ? `${designator} ${trimmed}` : designator;
}

/**
 * Nest the (path-sorted) subtree into a TOC. Only the first
 * ``maxDepth`` levels below the root are included — deeper paragraphs
 * are readable in the column but don't need TOC rows.
 */
export function buildSectionToc(
  provisions: SectionProvision[],
  maxDepth = 2,
): SectionTocEntry[] {
  const rootEntries: SectionTocEntry[] = [];
  const byAnchor = new Map<string, SectionTocEntry>();

  for (const provision of provisions) {
    if (provision.relativeDepth > maxDepth) continue;
    const entry: SectionTocEntry = {
      anchor: provision.anchor,
      label: tocLabel(provision.designator, provision.rule.heading),
      children: [],
    };
    byAnchor.set(provision.anchor, entry);
    if (provision.relativeDepth === 1) {
      rootEntries.push(entry);
      continue;
    }
    const parentAnchor = provision.anchor.split("-").slice(0, -1).join("-");
    const parent = byAnchor.get(parentAnchor);
    if (parent) {
      parent.children.push(entry);
    } else {
      rootEntries.push(entry);
    }
  }

  return rootEntries;
}

/** An encoded rule tied back to the subsections it implements. */
export interface EncodedRuleLink {
  name: string;
  kind: string | null;
  /** Top-level subsection anchors ("a", "b", …) cited by the rule's
   *  source; empty when it doesn't cite a subsection of this
   *  section. Rules often cite several — eitc_maximum implements
   *  32(a)(2)(A) using the tables in 32(b). */
  anchors: string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Map each rule in the section's RuleSpec to the subsection it
 * implements, using the rule's ``source`` citation ("26 USC
 * 32(b)(1)" → subsection "b"). Rules citing other sections or the
 * section as a whole get a null anchor and stay rail-only.
 */
export function mapRulesToSubsections(
  citationPath: string,
  rulespecContent: string | null,
): EncodedRuleLink[] {
  if (!rulespecContent) return [];
  const doc = parseRuleSpec(rulespecContent);
  if (!doc) return [];
  const section = citationPath.split("/").at(-1) ?? "";
  if (!section) return [];
  // A source like "26 USC 32(a), 32(c)(1)(E), 32(i)" cites several
  // subsections; capture the letter after every "<section>(" token.
  const sourceRe = new RegExp(
    `(?:§+\\s*)?${escapeRegExp(section)}\\s*\\(([a-z]{1,2})\\)`,
    "g",
  );
  return doc.rules.map((rule) => {
    const source = rule.source ?? "";
    const anchors = Array.from(
      new Set(Array.from(source.matchAll(sourceRe), (match) => match[1])),
    );
    return {
      name: rule.name,
      kind: rule.kind ?? null,
      anchors,
    };
  });
}

/**
 * Deep-page variant of the rule↔provision join: the requested page
 * sits BELOW the encoded module (e.g. 7 CFR 273.10(e)(2)(ii)(A) under
 * the section-granular ``regulations/7-cfr/273/10`` file). File
 * anchors can't help — there are no deeper files — so match each
 * rule's full ``source`` parenthetical chain against the page's
 * relative segments: keep rules citing this paragraph or below, and
 * anchor them to the page's own next-level unit when the citation
 * goes deeper still.
 */
export function mapRulesToDeepPath(
  encodingRootPath: string,
  relSegments: string[],
  rulespecContent: string | null,
): EncodedRuleLink[] {
  if (!rulespecContent || relSegments.length === 0) return [];
  const doc = parseRuleSpec(rulespecContent);
  if (!doc) return [];
  const section = encodingRootPath.split("/").at(-1) ?? "";
  if (!section) return [];
  // "273.10(e)(2)(ii)(A)" → chains of parenthetical segments after
  // the section number; a source may cite several chains.
  const chainRe = new RegExp(
    `(?:§+\\s*)?${escapeRegExp(section)}((?:\\s*\\([A-Za-z0-9]{1,4}\\))+)`,
    "g",
  );
  const rel = relSegments.map((segment) => segment.toLowerCase());
  const links: EncodedRuleLink[] = [];
  for (const rule of doc.rules) {
    const source = rule.source ?? "";
    const anchors = new Set<string>();
    let cited = false;
    for (const match of source.matchAll(chainRe)) {
      const segments = Array.from(
        match[1].matchAll(/\(([A-Za-z0-9]{1,4})\)/g),
        (seg) => seg[1],
      );
      const lower = segments.map((segment) => segment.toLowerCase());
      const within =
        lower.length >= rel.length &&
        rel.every((segment, index) => lower[index] === segment);
      if (!within) continue;
      cited = true;
      const next = segments[rel.length];
      if (next) anchors.add(next);
    }
    if (!cited) continue;
    links.push({
      name: rule.name,
      kind: rule.kind ?? null,
      anchors: Array.from(anchors),
    });
  }
  return links;
}

/**
 * Union file-path-derived anchors (subsection-granular repo files)
 * into the source-citation-derived links. File anchors are
 * authoritative — the repo path *is* the legal ID — so they fill in
 * rules whose ``source`` strings the citation regex can't parse.
 */
export function applyFileAnchors(
  links: EncodedRuleLink[],
  fileAnchors: Record<string, string[]>,
): EncodedRuleLink[] {
  return links.map((link) => {
    const extra = fileAnchors[link.name];
    if (!extra || extra.length === 0) return link;
    const anchors = Array.from(new Set([...link.anchors, ...extra]));
    return anchors.length === link.anchors.length ? link : { ...link, anchors };
  });
}

/**
 * Rail scroll-spy chunks for corpus-row-backed sections. Body-parsed
 * sections hand the rail their BodyChunks; sections with real
 * descendant rows previously handed it nothing, leaving the rail
 * stuck in flat "everything" mode with no follow behavior. Each
 * top-level provision becomes one chunk whose text aggregates its
 * whole subtree, so per-node reference scoping keeps working.
 */
export function railChunksFromProvisions(
  provisions: SectionProvision[],
): Array<{ anchor: string; designator: string; label: string; text: string }> {
  const chunks: Array<{
    anchor: string;
    designator: string;
    label: string;
    text: string;
  }> = [];
  let current: (typeof chunks)[number] | null = null;
  for (const provision of provisions) {
    if (provision.relativeDepth === 1) {
      const heading = provision.rule.heading?.trim();
      current = {
        anchor: provision.anchor,
        designator: provision.designator,
        label: heading
          ? `${provision.designator} ${heading}`
          : provision.designator,
        text: provision.rule.body ?? "",
      };
      chunks.push(current);
    } else if (
      current &&
      provision.anchor.startsWith(`${current.anchor}-`) &&
      provision.rule.body
    ) {
      current.text += `\n${provision.rule.body}`;
    }
  }
  return chunks;
}

const LABEL_PREVIEW_LEN = 56;

function chunkLabel(designator: string, text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  let rest = firstLine.replace(/^\([^)]+\)\s*/, "").trim();
  if (!rest) return designator;
  // The corpus flattens each subsection to one line, so the USLM
  // heading runs straight into the first nested marker or chapeau:
  // "(a) Allowance of credit (1) In general …", "(b) Percentages
  // and amounts For purposes of subsection (a)—". Cutting at those
  // boundaries recovers the clean heading.
  const nested = rest.search(/\s\((?:\d+|[A-Z])\)\s|\sFor purposes of\b/);
  if (nested > 0) rest = rest.slice(0, nested).trim();
  if (rest.length <= LABEL_PREVIEW_LEN) return `${designator} ${rest}`;
  const cut = rest.slice(0, LABEL_PREVIEW_LEN);
  const lastSpace = cut.lastIndexOf(" ");
  return `${designator} ${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Ordering rank for lowercase subsection designators: a < b < … < z
 * < aa < bb (USC doubles letters after z).
 */
function designatorRank(designator: string): number {
  return (designator.length - 1) * 26 + (designator.charCodeAt(0) - 97);
}

/**
 * Slice a section-granular body into top-level subsection chunks.
 *
 * A chunk starts at a line-leading "(a)"-style lowercase marker.
 * Nested markers — "(1)", "(A)", and roman "(i)" — must not open a
 * chunk, so markers are accepted only in strictly increasing
 * alphabetical order. Strictly increasing (rather than exactly
 * sequential) matters on real text: repealed subsections leave gaps
 * — current 26 USC § 32 runs (a)–(f) then jumps to (i)–(n).
 * Returns no chunks when fewer than two subsections are found — a
 * single match is more likely a false positive than a
 * one-subsection section.
 */
export function splitBodyIntoSubsections(body: string): {
  intro: string | null;
  chunks: BodyChunk[];
} {
  const markerRe = /^\(([a-z]{1,2})\)\s/gm;
  const boundaries: Array<{ designator: string; start: number }> = [];
  let previousRank = -1;
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(body)) !== null) {
    const designator = match[1];
    const rank = designatorRank(designator);
    if (rank <= previousRank) continue;
    boundaries.push({ designator, start: match.index });
    previousRank = rank;
  }

  if (boundaries.length < 2) {
    return { intro: null, chunks: [] };
  }

  const chunks: BodyChunk[] = boundaries.map((boundary, index) => {
    const end =
      index + 1 < boundaries.length ? boundaries[index + 1].start : body.length;
    const text = body.slice(boundary.start, end).replace(/\s+$/, "");
    return {
      anchor: boundary.designator,
      designator: `(${boundary.designator})`,
      label: chunkLabel(`(${boundary.designator})`, text),
      text,
      start: boundary.start,
    };
  });

  const introText = body.slice(0, boundaries[0].start).trim();
  return { intro: introText.length > 0 ? introText : null, chunks };
}

/**
 * References relevant to one chunk: outgoing refs whose citation
 * text appears in the chunk. RuleBody re-anchors offsets against the
 * chunk body, so offset translation is unnecessary.
 */
export function refsForChunk(
  refs: RuleReference[],
  chunkText: string,
): RuleReference[] {
  return refs.filter(
    (ref) =>
      ref.direction === "outgoing" &&
      Boolean(ref.citation_text) &&
      chunkText.includes(ref.citation_text),
  );
}

/**
 * Stand-in section root for paths whose corpus rows exist only below
 * the section (subsection-granular ingestion with no section row).
 * The synthetic id never matches a DB row, so encoding lookups fall
 * through to the citation-path-keyed mirror, which is what actually
 * serves them.
 */
function synthesizeSectionRoot(
  citationPath: string,
  resolved: ReturnType<typeof resolveAxiomPath>,
  navLabel: string | undefined,
): Rule {
  const segments = citationPath.split("/");
  return {
    id: `synthetic:${citationPath}`,
    jurisdiction: resolved.jurisdiction?.slug ?? segments[0],
    doc_type: segments[1] ?? "statute",
    parent_id: null,
    level: segments.length - 1,
    ordinal: null,
    heading: navLabel ?? null,
    body: null,
    effective_date: null,
    repeal_date: null,
    source_url: null,
    source_path: null,
    citation_path: citationPath,
    rulespec_path: null,
    has_rulespec: false,
    created_at: "",
    updated_at: "",
  };
}

async function getSubtreeProvisions(
  citationPath: string,
): Promise<{ provisions: Rule[]; truncated: boolean }> {
  const result = await withTimeout(
    supabaseCorpus
      .from("current_provisions")
      .select("*")
      .gte("citation_path", `${citationPath}/`)
      .lt("citation_path", `${citationPath}~`)
      .limit(SUBTREE_LIMIT),
    SECTION_QUERY_TIMEOUT_MS,
    null,
  );
  if (!result || result.error) return { provisions: [], truncated: false };
  // The range scan's upper bound (path + "~") also admits
  // letter-suffixed sibling sections ("…/1396a/e" sorts inside
  // ["…/1396/", "…/1396~") because "a" > "/"), so filter to true
  // descendants — otherwise a nonexistent section synthesizes a page
  // out of its siblings' provisions.
  const prefix = `${citationPath}/`;
  const rows = ((result.data ?? []) as Rule[]).filter(
    (row): row is Rule & { citation_path: string } =>
      Boolean(row.citation_path?.startsWith(prefix)),
  );
  rows.sort((a, b) =>
    compareCitationPaths(a.citation_path as string, b.citation_path as string),
  );
  return { provisions: rows, truncated: rows.length >= SUBTREE_LIMIT };
}

async function getNeighbor(
  node: NavigationNodeRow,
  direction: "prev" | "next",
): Promise<SectionNeighbor | null> {
  let query = supabaseCorpus
    .from("navigation_nodes")
    .select("path, citation_path, label, sort_key")
    .eq("jurisdiction", node.jurisdiction)
    .eq("doc_type", node.doc_type)
    .limit(1);
  query =
    node.parent_path === null
      ? query.is("parent_path", null)
      : query.eq("parent_path", node.parent_path);
  query =
    direction === "next"
      ? query.gt("sort_key", node.sort_key).order("sort_key", {
          ascending: true,
        })
      : query.lt("sort_key", node.sort_key).order("sort_key", {
          ascending: false,
        });

  const result = await withTimeout(query, SECTION_QUERY_TIMEOUT_MS, null);
  if (!result || result.error) return null;
  const row = (result.data ?? [])[0] as
    Pick<NavigationNodeRow, "path" | "citation_path" | "label"> | undefined;
  if (!row) return null;
  return {
    citationPath: row.citation_path ?? row.path,
    label: row.label,
  };
}

async function getNavigationNode(
  path: string,
): Promise<NavigationNodeRow | null> {
  const result = await withTimeout(
    supabaseCorpus
      .from("navigation_nodes")
      .select("*")
      .eq("path", path)
      .maybeSingle(),
    SECTION_QUERY_TIMEOUT_MS,
    null,
  );
  if (!result || result.error) return null;
  return (result.data as NavigationNodeRow | null) ?? null;
}

/**
 * The resolution half of the section page: which ingested row (or
 * synthesized root) serves this URL. Split from data assembly so the
 * route can decide 404-vs-render before streaming anything, and so
 * container paths (a CFR part with navigable children but no corpus
 * row of its own) can divert to the browse view.
 */
export interface SectionResolution {
  root: Rule;
  citationPath: string;
  /** The path the URL actually asked for, before any fallback rewrote
   *  it. When it differs from citationPath (doc-type crosswalk, mirror
   *  source lookup), encodings may still be keyed by it. */
  requestedPath: string;
  focusAnchor: string | null;
  /** True when no corpus row exists at the path itself and the root
   *  was synthesized over descendant rows — the signal that the path
   *  may be a navigation container rather than a section. */
  synthetic: boolean;
  /**
   * True when the path names a navigation container (a CFR part, a
   * statute chapter) rather than a section: no body text of its own
   * *and* a navigation node with children. The route diverts these
   * to the browse view. Sections stay readers — 7 USC 2017's nav
   * node has no children, and subsection-granular sections (42 USC
   * 1396a) have no nav node at all.
   */
  containerCandidate: boolean;
  prefetchedSubtree: { provisions: Rule[]; truncated: boolean } | null;
}

/**
 * Does the requested subsection anchor actually exist below this
 * ancestor? Ancestor fallback must never silently satisfy a URL with
 * unrelated ancestor content (…/7/2011 showing all of Title 7).
 */
function anchorExistsUnder(
  root: Rule,
  citationPath: string,
  anchor: string,
  subtree: { provisions: Rule[] },
): boolean {
  const found = subtree.provisions.some((rule) => {
    const relative = subtreeAnchor(
      citationPath,
      (rule.citation_path as string) ?? "",
    );
    return relative === anchor || relative.startsWith(`${anchor}-`);
  });
  if (found) return true;
  if (subtree.provisions.length === 0 && root.body) {
    if (
      splitBodyIntoSubsections(root.body).chunks.some(
        (chunk) => chunk.anchor === anchor,
      )
    ) {
      return true;
    }
    // Some single-row sections run their subsection markers inline
    // ("(a) Month of application—(1) …", 7 CFR 273.10) where the
    // chunker finds no line-anchored boundaries. A literal "(e)"
    // marker in a body-bearing SECTION row is still real evidence the
    // subsection exists — the Title-7 guard case (a body-less
    // container satisfying …/2011) stays refused because it has no
    // body to match against.
    return new RegExp(`\\(${escapeRegExp(anchor)}\\)`).test(root.body);
  }
  return false;
}

/**
 * Joined-segment citation candidates for slash-form section URLs.
 * ruleSegments = [docType, ...numberParts]; emits the dotted join of
 * the first two number parts ("422/12C" → "422.12C") and the dashed
 * join of all of them ("15/1/1" → "15-1-1") — the two conventions
 * state corpora use for single-row sections.
 */
export function joinedSegmentPaths(
  slug: string,
  ruleSegments: string[],
): string[] {
  const [docType, ...parts] = ruleSegments;
  if (!docType || parts.length < 2) return [];
  const paths: string[] = [];
  if (parts.length === 2) {
    paths.push([slug, docType, `${parts[0]}.${parts[1]}`].join("/"));
  }
  paths.push([slug, docType, parts.join("-")].join("/"));
  return paths;
}

/** Document classes the corpus files interchangeably for policy-adjacent
 *  material. An encoding under policies/ may live in the corpus as
 *  manual/ or guidance/ — same document, different classification. */
const DOC_TYPE_SIBLINGS: Record<string, string[]> = {
  policy: ["manual", "guidance"],
  manual: ["policy", "guidance"],
  guidance: ["policy", "manual"],
};

export function docTypeCrosswalk(docType: string | undefined): string[] {
  return docType ? (DOC_TYPE_SIBLINGS[docType] ?? []) : [];
}

/**
 * The corpus home an encoding module attests for itself:
 * `module.source_verification.corpus_citation_path` from the rulespec
 * mirror. Looked up by the reader path (mirror rows are keyed by the
 * file's citation path); subsection tails are trimmed until a row
 * matches, since page-structured sources can't anchor subsections.
 */
export async function rulespecSourceCitationPath(
  slug: string,
  ruleSegments: string[],
): Promise<string | null> {
  // Same registered-visibility refusal the section reader makes: a
  // gated pilot family's module must not attest a corpus home through
  // the mirror when its YAML is unreadable everywhere else.
  if (isGatedJurisdiction(slug)) return null;
  for (let end = ruleSegments.length; end >= 3; end--) {
    const candidate = [slug, ...ruleSegments.slice(0, end)].join("/");
    const { data, error } = await supabaseEncodings
      .from("rulespec_files")
      .select("raw_yaml")
      .eq("citation_path", candidate)
      .limit(3);
    if (error) return null;
    for (const row of data ?? []) {
      const yaml = (row as { raw_yaml: string | null }).raw_yaml;
      if (!yaml) continue;
      // The encoder emits both spellings: singular scalar
      // (`corpus_citation_path: us/...`) and plural list
      // (`corpus_citation_paths:` followed by `- us/...` items). Read
      // the scalar, else the first list item.
      // Same-line value only: an empty scalar followed by another key
      // must not capture the next line's token as a path.
      const single = yaml.match(
        /corpus_citation_path:[ \t]*["']?([\w./-]+)["']?/,
      );
      if (single?.[1]) return single[1];
      const plural = yaml.match(
        /corpus_citation_paths:\s*\n\s*-\s*["']?([\w./-]+)["']?/,
      );
      if (plural?.[1]) return plural[1];
    }
  }
  return null;
}

export async function resolveSection(
  segments: string[],
): Promise<SectionResolution | null> {
  const resolved = resolveAxiomPath(segments);
  if (
    resolved.phase !== "rule" ||
    !resolved.jurisdiction ||
    resolved.ruleSegments.length === 0
  ) {
    return null;
  }
  const slug = resolved.jurisdiction.slug;
  const ruleSegments = resolved.ruleSegments;
  const requestedPath = [slug, ...ruleSegments].join("/");

  // Resolve the deepest ingested row at or above the requested path.
  // The corpus is mostly section-granular, so subsection URLs
  // (…/26/32/a) resolve to their section with a focus anchor.
  let root = await getProvisionByCitationPath(requestedPath).catch(() => null);
  let citationPath = requestedPath;
  let focusAnchor: string | null = null;
  let synthetic = false;
  let prefetchedSubtree: Awaited<
    ReturnType<typeof getSubtreeProvisions>
  > | null = null;
  if (root) {
    // A childless deep leaf (…/26/21/c/1) is one item of an
    // enumeration — its text reads as a fragment ("$3,000 …, or")
    // without the parent's chapeau. When the parent is itself a
    // body-bearing provision, render the parent focused on the leaf
    // instead. Leaves with their own subtrees keep their page.
    const leaf = ruleSegments[ruleSegments.length - 1] ?? "";
    if (ruleSegments.length >= 4 && /^[a-z0-9]{1,4}$/i.test(leaf)) {
      const probe = await getSubtreeProvisions(requestedPath);
      if (probe.provisions.length > 0) {
        prefetchedSubtree = probe;
      } else {
        const parentPath = [slug, ...ruleSegments.slice(0, -1)].join("/");
        const parent = await getProvisionByCitationPath(parentPath).catch(
          () => null,
        );
        if (parent?.body) {
          const parentSubtree = await getSubtreeProvisions(parentPath);
          if (anchorExistsUnder(parent, parentPath, leaf, parentSubtree)) {
            root = parent;
            citationPath = parentPath;
            focusAnchor = leaf;
            prefetchedSubtree = parentSubtree;
          } else {
            prefetchedSubtree = probe;
          }
        } else {
          prefetchedSubtree = probe;
        }
      }
    }
  }
  if (!root) {
    // Some sections are ingested subsection-granular with no section
    // row at all (42 USC 1396a: …/1396a/e/15 exists, …/1396a does
    // not). Climbing up would skip past them — probe the subtree
    // first and synthesize a root over it.
    const probe = await getSubtreeProvisions(requestedPath);
    if (probe.provisions.length > 0) {
      const navNode = await getNavigationNode(requestedPath);
      root = synthesizeSectionRoot(requestedPath, resolved, navNode?.label);
      synthetic = true;
      prefetchedSubtree = probe;
    }
  }
  if (!root) {
    // The corpus stores USC lettered sections with an en dash
    // (us/statute/42/1396u–1) but every human types a hyphen. Retry
    // with hyphens swapped in the rule segments (never the
    // jurisdiction slug) before giving up.
    const dashPath = [
      slug,
      ...ruleSegments.map((segment, index) =>
        index === 0 ? segment : segment.replace(/-/g, "–"),
      ),
    ].join("/");
    if (dashPath !== requestedPath) {
      root = await getProvisionByCitationPath(dashPath).catch(() => null);
      if (root) {
        citationPath = dashPath;
      } else {
        const probe = await getSubtreeProvisions(dashPath);
        if (probe.provisions.length > 0) {
          const navNode = await getNavigationNode(dashPath);
          root = synthesizeSectionRoot(dashPath, resolved, navNode?.label);
          citationPath = dashPath;
          synthetic = true;
          prefetchedSubtree = probe;
        }
      }
    }
  }
  if (!root) {
    // State corpora often store a section's number joined into ONE
    // path segment — dotted ("us-ia/statute/422.12C", Oregon
    // "315.264") or dashed ("us-mt/statute/15-1-1") — while encoding
    // legal ids and human URLs split it on slashes. Retry the joined
    // shapes before climbing to an ancestor.
    for (const candidate of joinedSegmentPaths(slug, ruleSegments)) {
      const rule = await getProvisionByCitationPath(candidate).catch(
        () => null,
      );
      if (rule) {
        root = rule;
        citationPath = candidate;
        break;
      }
    }
  }
  if (!root) {
    for (let end = ruleSegments.length - 1; end >= 2; end--) {
      const candidate = [slug, ...ruleSegments.slice(0, end)].join("/");
      const rule = await getProvisionByCitationPath(candidate).catch(
        () => null,
      );
      if (rule) {
        // Only focus the anchor when it really exists under the
        // ancestor. When it doesn't: a body-bearing section still
        // satisfies the citation (subsection markers vary by ingest —
        // "(3)" vs "3." — and Source links append them best-effort),
        // so render it unfocused; a bodyless container keeps the hard
        // 404 — rendering Title 7 for a missing …/7/2011 would lie.
        const anchor = ruleSegments[end];
        const subtree = await getSubtreeProvisions(candidate);
        const anchored = anchorExistsUnder(rule, candidate, anchor, subtree);
        if (!anchored && !rule.body) {
          return null;
        }
        if (!anchored && process.env.NODE_ENV !== "production") {
          // #190: silent focus no-ops are undiagnosable — say which
          // cited anchor found no home under the resolved section.
          console.warn(
            `[reader] focus anchor "${anchor}" (from ${requestedPath}) ` +
              `not found under ${candidate} — rendering unfocused`,
          );
        }
        root = rule;
        citationPath = candidate;
        focusAnchor = anchored ? anchor : null;
        prefetchedSubtree = subtree;
        break;
      }
    }
  }
  if (!root) {
    // Encoding file paths and corpus paths disagree on document class
    // for policy-adjacent material: a rulespec filed under policies/
    // may be ingested as manual/ or guidance/. Retry the same tail
    // under the sibling classes before giving up (#191).
    for (const sibling of docTypeCrosswalk(ruleSegments[0])) {
      const candidate = [slug, sibling, ...ruleSegments.slice(1)].join("/");
      const rule = await getProvisionByCitationPath(candidate).catch(
        () => null,
      );
      if (rule) {
        root = rule;
        citationPath = candidate;
        break;
      }
      const probe = await getSubtreeProvisions(candidate);
      if (probe.provisions.length > 0) {
        const navNode = await getNavigationNode(candidate);
        root = synthesizeSectionRoot(candidate, resolved, navNode?.label);
        citationPath = candidate;
        synthetic = true;
        prefetchedSubtree = probe;
        break;
      }
    }
  }
  if (!root) {
    // Last rung: the encodings mirror records each module's true corpus
    // home (module.source_verification.corpus_citation_path). A reader
    // URL built from a rule-file legal id — the graph inspector's
    // "Read the law" — resolves through it even when the file and
    // corpus paths diverge entirely (…/capital-gains vs …/page-25).
    const sourcePath = await rulespecSourceCitationPath(
      slug,
      ruleSegments,
    ).catch(() => null);
    if (sourcePath && sourcePath !== requestedPath) {
      const rule = await getProvisionByCitationPath(sourcePath).catch(
        () => null,
      );
      if (rule) {
        root = rule;
        citationPath = sourcePath;
      } else {
        const probe = await getSubtreeProvisions(sourcePath);
        if (probe.provisions.length > 0) {
          const navNode = await getNavigationNode(sourcePath);
          root = synthesizeSectionRoot(sourcePath, resolved, navNode?.label);
          citationPath = sourcePath;
          synthetic = true;
          prefetchedSubtree = probe;
        }
      }
    }
  }
  if (!root) return null;
  let containerCandidate = false;
  if (!root.body) {
    const navNode = await getNavigationNode(citationPath);
    containerCandidate = navNode?.has_children === true;
  }
  return {
    root,
    citationPath,
    requestedPath,
    focusAnchor,
    synthetic,
    containerCandidate,
    prefetchedSubtree,
  };
}

/**
 * Trim the root body when descendant rows repeat its text (mixed
 * ingestion shapes: a subsection row whose body holds the whole
 * subsection *and* paragraph rows below it). Rendering both
 * duplicates statutory text. Keeps any chapeau before the first
 * repeated descendant; drops the body entirely when nothing precedes
 * it.
 */
export function dedupeRootBody(root: Rule, descendants: Rule[]): Rule {
  return splitRootBodyAroundChildren(root, descendants).root;
}

/**
 * Split a root body that repeats its descendants' text into the intro
 * (chapeau before the first child) and the flush text after the LAST
 * child — the trailing sentence enumerations often carry ("The amount
 * determined under paragraph (1) or (2) … shall be reduced …"), which
 * plain intro-trimming silently dropped.
 */
export function splitRootBodyAroundChildren(
  root: Rule,
  descendants: Rule[],
): { root: Rule; flush: string | null } {
  const body = root.body;
  if (!body) return { root, flush: null };
  const childBodies = descendants
    .map((rule) => rule.body?.trim() ?? "")
    .filter((text) => text.length >= 20);
  const firstChildBody = childBodies[0];
  if (!firstChildBody) return { root, flush: null };
  const needle = firstChildBody.slice(0, 60);
  const index = body.indexOf(needle);
  if (index < 0) return { root, flush: null };
  // Child rows store their text without the enumeration marker, so the
  // kept chapeau would end with a dangling "(1)" — strip it.
  const intro = body
    .slice(0, index)
    .trim()
    .replace(/\(\s*[\w.]{1,4}\s*\)\s*$/, "")
    .trim();

  // Locate the end of the last child's text inside the root body; what
  // follows is flush text belonging to the root, not to any child.
  let flush: string | null = null;
  const lastChildBody = childBodies[childBodies.length - 1]!;
  const lastNeedle = lastChildBody.slice(0, 60);
  const lastAt = body.lastIndexOf(lastNeedle);
  if (lastAt >= 0) {
    const tail = body.slice(lastAt + lastChildBody.length).trim();
    if (tail.length >= 20) flush = tail;
  }

  return {
    root: { ...root, body: intro.length > 0 ? intro : null },
    flush,
  };
}

export async function getSectionPageData(
  segments: string[],
): Promise<SectionPageData | null> {
  const resolution = await resolveSection(segments);
  if (!resolution) return null;
  return getSectionPageDataFromResolution(resolution);
}

/**
 * Encoding paths for a section, most likely first: the resolved corpus
 * path, the originally requested path when a fallback rewrote it, and
 * the doc-type crosswalk siblings of both. Rulespec mirror rows are
 * keyed by encoding-file paths, which classify policy-adjacent
 * documents differently from the corpus (#191) — a guidance page's
 * rules may be keyed under policy/, whichever URL the reader arrived
 * from.
 */
export function encodingPathCandidates(
  resolution: Pick<SectionResolution, "citationPath" | "requestedPath">,
): string[] {
  const candidates: string[] = [];
  for (const path of [resolution.citationPath, resolution.requestedPath]) {
    if (!path || candidates.includes(path)) continue;
    candidates.push(path);
    const segments = path.split("/");
    for (const sibling of docTypeCrosswalk(segments[1])) {
      const variant = [segments[0], sibling, ...segments.slice(2)].join("/");
      if (!candidates.includes(variant)) candidates.push(variant);
    }
  }
  return candidates;
}

function hasEncodingContent(
  section: Awaited<ReturnType<typeof getSectionEncoding>>,
): boolean {
  return section.encoding != null || Object.keys(section.ruleFiles).length > 0;
}

async function getSectionEncodingAcrossPaths(
  rootId: string,
  resolution: Pick<SectionResolution, "citationPath" | "requestedPath">,
): Promise<Awaited<ReturnType<typeof getSectionEncoding>>> {
  const candidates = encodingPathCandidates(resolution);
  let first: Awaited<ReturnType<typeof getSectionEncoding>> | null = null;
  for (const candidate of candidates) {
    const section = await getSectionEncoding(rootId, candidate).catch(() => ({
      encoding: null,
      encodingRootPath: null,
      fileAnchors: {},
      ruleFiles: {},
      citedByFiles: [],
      citedByOverflow: 0,
    }));
    if (hasEncodingContent(section)) return section;
    first = first ?? section;
  }
  return (
    first ?? {
      encoding: null,
      encodingRootPath: null,
      fileAnchors: {},
      ruleFiles: {},
      citedByFiles: [],
      citedByOverflow: 0,
    }
  );
}

export async function getSectionPageDataFromResolution(
  resolution: SectionResolution,
): Promise<SectionPageData | null> {
  const { citationPath, focusAnchor, prefetchedSubtree } = resolution;
  let root = resolution.root;

  const [subtree, rootRefs, node, sectionEncoding, programs, parityCases] =
    await Promise.all([
      prefetchedSubtree ?? getSubtreeProvisions(citationPath),
      getRuleReferences(citationPath).catch(() => [] as RuleReference[]),
      getNavigationNode(citationPath),
      getSectionEncodingAcrossPaths(root.id, resolution).catch(() => ({
        encoding: null,
        encodingRootPath: null,
        fileAnchors: {},
        ruleFiles: {},
        citedByFiles: [],
        citedByOverflow: 0,
      })),
      getProvisionCoverage(citationPath).catch(
        () => [] as ProvisionProgramCoverage[],
      ),
      listParityCases().catch(() => []),
    ]);
  const encoding = sectionEncoding.encoding;

  const refBody = root.body;
  const split = splitRootBodyAroundChildren(root, subtree.provisions);
  root = split.root;

  const rootDepth = citationPath.split("/").length;
  const provisions: SectionProvision[] = subtree.provisions.map((rule) => ({
    rule,
    anchor: subtreeAnchor(citationPath, rule.citation_path as string),
    designator: relativeDesignator(citationPath, rule.citation_path as string),
    relativeDepth: (rule.citation_path as string).split("/").length - rootDepth,
  }));
  // Flush text after the last enumerated child belongs to the section,
  // not to any child — render it at the end of the last child's block,
  // where section-granular corpora place it.
  if (split.flush && provisions.length > 0) {
    const last = provisions[provisions.length - 1]!;
    last.rule = {
      ...last.rule,
      body: [last.rule.body, split.flush].filter(Boolean).join("\n\n"),
    };
  }

  const [prev, next] = node
    ? await Promise.all([getNeighbor(node, "prev"), getNeighbor(node, "next")])
    : [null, null];

  // Corpus rows are the preferred structure source; body parsing is
  // the fallback for section-granular corpora (the common case).
  const bodySplit =
    provisions.length === 0 && root.body
      ? splitBodyIntoSubsections(root.body)
      : { intro: null, chunks: [] };
  const toc =
    provisions.length > 0
      ? buildSectionToc(provisions)
      : bodySplit.chunks.map((chunk) => ({
          anchor: chunk.anchor,
          label: chunk.label,
          children: [],
        }));

  const encodingRoot = sectionEncoding.encodingRootPath ?? citationPath;
  const encodedRules =
    encodingRoot === citationPath
      ? applyFileAnchors(
          mapRulesToSubsections(
            citationPath,
            encoding?.rulespec_content ?? null,
          ),
          sectionEncoding.fileAnchors,
        )
      : // The request is DEEPER than the encoded module (paragraph page
        // under a section-granular file): join by each rule's source
        // citation instead of file anchors, keeping only rules that
        // cite this paragraph or below and anchoring them to the
        // page's own next-level units.
        mapRulesToDeepPath(
          encodingRoot,
          citationPath.slice(encodingRoot.length + 1).split("/"),
          encoding?.rulespec_content ?? null,
        );

  // Coverage: which top-level subsections carry rules, out of how
  // many the section has.
  const unitAnchors =
    provisions.length > 0
      ? provisions
          .filter((provision) => provision.relativeDepth === 1)
          .map((provision) => provision.anchor)
      : bodySplit.chunks.map((chunk) => chunk.anchor);
  const encodedAnchors = new Set(
    encodedRules.flatMap((entry) => entry.anchors),
  );
  const encodedCoverage =
    unitAnchors.length > 0 && encodedRules.length > 0
      ? {
          encodedUnits: unitAnchors.filter((anchor) =>
            encodedAnchors.has(anchor),
          ).length,
          totalUnits: unitAnchors.length,
        }
      : null;

  // Oracle verification: the first covering program with an
  // external-oracle parity comparison.
  let parity: SectionPageData["parity"] = null;
  for (const program of programs) {
    const cases = parityCases.filter(
      (item) =>
        item.jurisdiction === program.jurisdiction &&
        item.program_id === program.programId &&
        item.oracles.length > 0,
    );
    if (cases.length > 0) {
      parity = {
        oracle: cases[0].oracles[0],
        caseCount: cases.length,
        programId: program.programId,
        jurisdiction: program.jurisdiction,
        caseDescriptions: cases.map((item) => item.description),
      };
      break;
    }
  }

  return {
    citationPath,
    root,
    refBody,
    breadcrumbs: buildBreadcrumbs(citationPath.split("/")),
    provisions,
    intro: bodySplit.intro,
    bodyChunks: bodySplit.chunks,
    toc,
    rootRefs,
    encoding,
    encodedRules,
    programs,
    ruleFiles: sectionEncoding.ruleFiles,
    citedByFiles: sectionEncoding.citedByFiles,
    citedByOverflow: sectionEncoding.citedByOverflow,
    focusAnchor,
    prev,
    next,
    truncated: subtree.truncated,
    encodedCoverage,
    parity,
  };
}

function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  fallback: T,
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
      },
    );
  });
}
