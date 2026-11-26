const LOWERCASE_STRUCTURAL_SEGMENTS = new Set([
  "article",
  "chapter",
  "legislation",
  "paragraph",
  "part",
  "policy",
  "regulation",
  "schedule",
  "section",
  "ssi",
  "statute",
  "ukpga",
  "uksi",
]);

/**
 * Normalize the stable, structural pieces of a citation_path while
 * preserving legal identifiers whose case can be meaningful in corpus
 * paths, e.g. ``36B``, ``3ZA``, or ``9-CCR-2503-6``.
 */
export function normalizeCitationPathInput(path: string): string {
  const parts = path
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);

  return parts
    .map((part, index) => {
      if (index <= 1) return part.toLowerCase();
      const lower = part.toLowerCase();
      if (LOWERCASE_STRUCTURAL_SEGMENTS.has(lower)) return lower;
      if (lower.startsWith("subpart-")) return lower;
      return part;
    })
    .join("/");
}

/** U+2013, the dash the corpus uses in lettered USC section numbers. */
const EN_DASH = "–";

/**
 * The corpus stores USC lettered sections with an en dash
 * (``us/statute/42/1396u–1``), but people and citation tools type an
 * ASCII hyphen. Given a citation path's segments, return them with every
 * hyphen swapped for an en dash in the segments after the document type.
 * The jurisdiction slug (``us-mt``, index 0) and the document type
 * (index 1) keep their hyphens.
 */
export function enDashCitationSegments(segments: string[]): string[] {
  return segments.map((segment, index) =>
    index < 2 ? segment : segment.replace(/-/g, EN_DASH)
  );
}
