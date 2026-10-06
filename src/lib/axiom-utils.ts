import type { Rule, RuleEncodingData } from "@/lib/supabase";
import { formatNhRuleSection } from "@/lib/axiom/citation/nh-admin-rules";

/** True when the encoding was fetched from a GitHub rulespec-* repo (not from the encoding DB). */
export function isGitHubEncoding(encoding: RuleEncodingData | null): boolean {
  return !!encoding?.encoding_run_id.startsWith("github:");
}

/** True when the encoding comes from a stored Encoder run. */
export function isEncodingRun(encoding: RuleEncodingData | null): boolean {
  return !!encoding && !encoding.encoding_run_id.startsWith("github:");
}

const REPO_BUCKET_SINGULARS: Readonly<Record<string, string>> = Object.freeze({
  statutes: "statute",
  regulations: "regulation",
  policies: "policy",
});

/**
 * The encoding lookup walks ancestor paths, so a subsection page can
 * end up displaying the encoding of its parent section. Detect that
 * case: translate the repo file path back into citation-path dialect
 * (plural buckets → singular, ``7-cfr`` → ``7``, duplicated terminal
 * section dropped) and compare against the rule's citation path.
 * Returns the ancestor's citation path when the encoding belongs to a
 * strict ancestor, or null when it covers this exact provision (or
 * can't be related at all).
 */
export function encodingAncestorCitationPath(
  filePath: string,
  citationPath: string | null | undefined
): string | null {
  if (!citationPath) return null;
  const [jurisdiction, ...tailParts] = citationPath.split("/").filter(Boolean);
  if (!jurisdiction || tailParts.length === 0) return null;

  const encParts = filePath
    .replace(/\.yaml$/, "")
    .split("/")
    .filter(Boolean);
  if (encParts.length === 0) return null;
  encParts[0] = REPO_BUCKET_SINGULARS[encParts[0]] ?? encParts[0];
  if (encParts[0] === "regulation" && encParts[1]?.endsWith("-cfr")) {
    encParts[1] = encParts[1].slice(0, -"-cfr".length);
  }
  // The repo duplicates terminal sections ("statute/26/32/32.yaml").
  if (
    encParts.length === 4 &&
    encParts[0] === "statute" &&
    encParts[3] === encParts[2]
  ) {
    encParts.pop();
  }

  const tail = tailParts.join("/");
  const encodingPath = encParts.join("/");
  if (encodingPath === tail) return null;
  if (tail.startsWith(`${encodingPath}/`)) {
    return `${jurisdiction}/${encodingPath}`;
  }
  return null;
}

export interface ViewerDocument {
  citation: string;
  title: string;
  subsections: Array<{ id: string; text: string }>;
  hasRuleSpec: boolean;
  jurisdiction: string;
  citationPath?: string;
  sourcePath: string | null;
  isRepealed?: boolean;
  contextText?: string;
  highlightedSubsection?: string;
  /**
   * Raw body text for leaf rules (no real children). When set, SourceTab
   * renders it directly so outgoing citation refs — whose offsets index
   * into this exact string — can be spliced in as inline links.
   * Omitted when the rule's content is distributed across children.
   */
  body?: string;
}

export function getJurisdictionLabel(jurisdiction: string): string {
  switch (jurisdiction) {
    case "ca":
      return "CA";
    case "be":
      return "BE";
    case "uk":
      return "UK";
    default:
      if (jurisdiction.startsWith("us-")) {
        return jurisdiction.replace("us-", "").toUpperCase();
      }
      return "US";
  }
}

function isHumanReadableCitation(sourcePath: string): boolean {
  return /\b(?:U\.?S\.?C\.?|USC|C\.?F\.?R\.?|CFR|Code|Act)\b|§/.test(
    sourcePath
  );
}

function formatSubsectionSuffix(subsections: string[]): string {
  return subsections.map((segment) => `(${segment})`).join("");
}

function formatCitationPath(
  citationPath: string,
  jurisdiction: string,
  docType: string
): string | null {
  const parts = citationPath.split("/").filter(Boolean);
  if (parts.length < 4) {
    return null;
  }

  if (jurisdiction === "uk" && docType === "legislation") {
    const [, kind, instrumentType, year, number, ...rest] = parts;
    if (!kind || !instrumentType || !year || !number) {
      return null;
    }
    const suffixText =
      rest.length > 0 ? " " + rest.join(" ").replace(/[-_]/g, " ") : "";
    return `${instrumentType.toUpperCase()} ${year}/${number}${suffixText}`;
  }

  if (jurisdiction === "us-co" && docType === "regulation") {
    const [, , instrument, section, ...subsections] = parts;
    if (!instrument || !section) {
      return null;
    }
    const suffix = formatSubsectionSuffix(subsections);
    return `${instrument.replace("-CCR-", " CCR ")} § ${section}${suffix}`;
  }

  if (jurisdiction === "us" && docType === "regulation") {
    const [, , title, part, first, ...subsections] = parts;
    if (!title || !part || !first) {
      return null;
    }
    if (first.startsWith("subpart-")) {
      return `${title} CFR ${part} Subpart ${first
        .slice("subpart-".length)
        .toUpperCase()}`;
    }
    const suffix = formatSubsectionSuffix(subsections);
    return `${title} CFR § ${part}.${first}${suffix}`;
  }

  if (jurisdiction.startsWith("us-") && docType === "regulation") {
    // State regulation sections are cited by their own identifier. A
    // New Hampshire section minted as a bare number
    // (``he-w-800/801.01``) takes its rule prefix from the chapter slug
    // ("He-W 801.01"); a legacy segment that already carries it
    // (``He-W 734.01``) is used as is.
    const [, , chapter, section, ...subsections] = parts;
    if (!section) {
      return null;
    }
    const label =
      jurisdiction === "us-nh" ? formatNhRuleSection(chapter, section) : section;
    return `${label}${formatSubsectionSuffix(subsections)}`;
  }

  if (jurisdiction === "us-co" && docType === "statute") {
    const [, , collection, section, ...subsections] = parts;
    if (collection !== "crs" || !section) {
      return null;
    }
    const suffix = formatSubsectionSuffix(subsections);
    return `C.R.S. § ${section}${suffix}`;
  }

  if (docType !== "statute") {
    return null;
  }

  const [, , title, section, ...subsections] = parts;
  const suffix = formatSubsectionSuffix(subsections);

  if (jurisdiction === "us") {
    return `${title} U.S.C. § ${section}${suffix}`;
  }

  if (jurisdiction.startsWith("us-")) {
    return `${title} § ${section}${suffix}`;
  }

  return null;
}

/**
 * Last-resort citation label from the canonical path. Strips the
 * jurisdiction and doc-type buckets and keeps the identifying tail —
 * ``us-mt/statute/Rule 35`` → "Rule 35", ``us-nh/regulation/
 * he-w-700/He-W 734.01`` → "He-W 734.01". Anything is better than the
 * raw ingestion file path (``sources/us-mt/.../0250-0200-0050.HTML``)
 * the heading used to fall back to.
 */
function citationFromPathTail(citationPath: string): string | null {
  const parts = citationPath.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const tail = parts[parts.length - 1];
  // Bare ordinals ("9") make meaningless headings — only use the tail
  // when it reads as an identifier on its own.
  return /[A-Za-z. -]/.test(tail) ? tail : null;
}

function getRuleCitation(rule: Rule): string {
  const sourcePath = rule.source_path?.trim();
  if (sourcePath && isHumanReadableCitation(sourcePath)) {
    return sourcePath;
  }

  if (rule.citation_path) {
    const formatted = formatCitationPath(
      rule.citation_path,
      rule.jurisdiction,
      rule.doc_type
    );
    if (formatted) {
      return formatted;
    }
    const tail = citationFromPathTail(rule.citation_path);
    if (tail) {
      return tail;
    }
  }

  return rule.citation_path || sourcePath || rule.id;
}

export function isRuleRepealed(rule: Rule): boolean {
  if (rule.repeal_date) return true;
  return /^\s*\[?\s*repealed\b/i.test(rule.heading ?? "");
}

export function transformRuleToViewerDoc(
  rule: Rule,
  children: Rule[],
  options?: { contextText?: string; highlightId?: string }
): ViewerDocument {
  const subsections = children.map((child, i) => {
    const segments = child.citation_path?.split("/").filter(Boolean);
    const id = segments?.at(-1) || String.fromCharCode(97 + i);
    return {
      id,
      text: child.body || child.heading || "",
    };
  });

  // Leaf rules (no children, has body): expose the raw body verbatim so
  // SourceTab can render citation refs inline at their true offsets.
  // ``subsections`` is reserved for materialized child rule rows only.
  const isLeafWithBody = subsections.length === 0 && !!rule.body;

  return {
    citation: getRuleCitation(rule),
    title: rule.heading || "Untitled",
    subsections,
    hasRuleSpec: rule.has_rulespec,
    jurisdiction: rule.jurisdiction,
    ...(rule.citation_path && { citationPath: rule.citation_path }),
    sourcePath: rule.source_path,
    ...(isRuleRepealed(rule) && { isRepealed: true }),
    ...(options?.contextText && { contextText: options.contextText }),
    ...(options?.highlightId && { highlightedSubsection: options.highlightId }),
    ...(isLeafWithBody && { body: rule.body! }),
  };
}
