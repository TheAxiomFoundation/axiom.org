/**
 * New Hampshire Code of Administrative Rules labels.
 *
 * NH cites an administrative rule by its agency prefix and number:
 * "He-W 704.04" is section 704.04 of chapter He-W 700. The corpus
 * slugs the chapter from that prefix (``us-nh/regulation/he-w-700``)
 * and mints each section segment in one of two shapes:
 *
 *   - the bare number, ``he-w-800/801.01`` (He-W 800 today, and
 *     He-W 700 once it is re-minted as ``he-w-700/704.04``). The
 *     segment alone drops the prefix the citation needs.
 *   - the printed label, ``he-w-700/He-W 734.01`` (the original
 *     He-W 700 scope). The segment already carries the prefix.
 *
 * These helpers put the prefix back for the first shape and pass the
 * second through, so both read "He-W 704.04".
 */

/**
 * Chapter-slug prefixes mapped to the prefix as NH prints it. Only
 * He-W chapters (he-w-700, he-w-800) exist in the corpus today. The
 * printed casing is the publisher's, so add a prefix here only after
 * checking it against the source text rather than deriving it from
 * the slug.
 */
const NH_RULE_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  "he-w": "He-W",
});

/** ``he-w-700`` → slug prefix ``he-w``, chapter number ``700``. */
const NH_CHAPTER_SLUG_RE = /^([a-z]+(?:-[a-z]+)*)-(\d+)$/;

interface NhRuleChapter {
  /** Printed agency prefix: "He-W". */
  prefix: string;
  /** Chapter number: "700". */
  number: string;
}

function parseNhRuleChapter(slug: string | undefined): NhRuleChapter | null {
  const match = slug ? NH_CHAPTER_SLUG_RE.exec(slug) : null;
  if (!match) return null;
  const prefix = NH_RULE_PREFIXES[match[1]];
  return prefix ? { prefix, number: match[2] } : null;
}

/**
 * Chapter label as NH prints it: ``he-w-700`` → "He-W 700". Null for
 * any slug that is not a known rule chapter (``recovery``, say), so
 * callers keep their existing label.
 */
export function formatNhRuleChapter(slug: string | undefined): string | null {
  const chapter = parseNhRuleChapter(slug);
  return chapter ? `${chapter.prefix} ${chapter.number}` : null;
}

/**
 * Section label as NH prints it. A bare-number segment gets the
 * chapter's prefix (``he-w-700`` + ``704.04`` → "He-W 704.04"). A
 * segment that already reads as a label ("He-W 734.01"), or one under
 * a chapter slug this module does not know, is returned unchanged.
 */
export function formatNhRuleSection(
  chapterSlug: string | undefined,
  section: string
): string {
  const chapter = parseNhRuleChapter(chapterSlug);
  if (!chapter || !/^\d/.test(section)) return section;
  return `${chapter.prefix} ${section}`;
}
