import Link from "next/link";
import type { BrowsePageData, EncodedEntry } from "@/lib/axiom/browse-page";
import { TrackView } from "@/components/axiom/track-view";
import {
  sourceCreditForJurisdiction,
  type SourceCredit,
} from "@/lib/axiom/source-attribution";

/** Source labels arrive in every shape — ALL-CAPS USC title names,
 *  section headings leaking into title rows. Title-case the shouty
 *  ones for display; the raw label stays in the tooltip. */
function displayLabel(label: string): string {
  const letters = label.replace(/[^A-Za-z]/g, "");
  if (letters.length > 4 && letters === letters.toUpperCase()) {
    return label
      .toLowerCase()
      .replace(/(^|[\s(-])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
  }
  return label;
}

/**
 * v2 browse page — the levels above a section (jurisdiction, doc
 * type, title) rendered in the reader's visual language: breadcrumb
 * row, a quiet header, and a single reading-width list of children.
 * No search affordance for now — corpus search is deliberately
 * unreachable outside the /axiom landing. Bare citation-path hrefs are canonical;
 * the proxy sends section depth to the reader and browse depth back
 * here.
 */

function Breadcrumbs({ data }: { data: BrowsePageData }) {
  // Ancestors only — the current level is the page title, not a
  // crumb. At /us that leaves just "Axiom".
  const ancestors = data.breadcrumbs.slice(0, -1);
  if (ancestors.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        {ancestors.map((item, index) => (
          <li key={item.href} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden>/</span>}
            <Link
              href={item.href}
              className="text-[var(--color-ink-secondary)] underline decoration-[var(--color-rule)] underline-offset-[3px] hover:text-[var(--color-accent)] hover:decoration-current transition-colors"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Transient-failure state: the URL is valid; the navigation index
 *  didn't answer in time. Distinct from notFound so crawlers and
 *  users never see a valid level as nonexistent. */
export function BrowseUnavailable({ path }: { path: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-24 pb-16">
      <div
        data-testid="browse-unavailable"
        className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-8 text-center"
      >
        <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
          {path}
        </p>
        <p
          className="mt-3 text-base text-[var(--color-ink)]"
          style={{ fontFamily: "var(--f-serif)" }}
        >
          Navigation data is temporarily unavailable
        </p>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)] leading-relaxed">
          The index didn't answer in time — this level exists, the
          backend hiccupped.
        </p>
        <a
          href={`/${path}`}
          className="mt-5 inline-block rounded border border-[var(--color-rule)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-secondary)] no-underline hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
        >
          reload
        </a>
      </div>
    </div>
  );
}

/** One-line, plain-verb description of each collection at the
 *  jurisdiction root. Copy is design material: these answer "which
 *  drawer do I open?" for readers who don't know the taxonomy. */
const DOC_TYPE_BLURBS: Readonly<Record<string, string>> = {
  statute: "Codified acts of the legislature.",
  legislation: "Codified acts of the legislature.",
  regulation: "Rules agencies issue to carry statutes into effect.",
  policy: "Agency operating manuals and internal policy.",
  guidance: "Interpretive letters, notices, and public guidance.",
  form: "Forms and the instructions that accompany them.",
};

/** What one child of this level is, for count lines. */
function childNoun(depth: number, sampleSegment: string | undefined): string {
  if (sampleSegment?.startsWith("subpart")) return "subparts";
  if (depth === 1) return "collections";
  if (depth === 2) return "titles";
  return "sections";
}

/** The numeral (or letter) that names a node in legal ordering:
 *  "26", "54.403", subpart-C → "C". Null for prose segments. */
function orderingKey(segment: string): string | null {
  const subpart = segment.match(/^subpart-(.+)$/i);
  if (subpart) return subpart[1].toUpperCase();
  return /^\d/.test(segment) ? segment : null;
}

function CoverageMark({
  encoded,
  total,
}: {
  encoded?: number;
  total?: number;
}) {
  if (!encoded) return ENCODED_MARK;
  return (
    <span
      className="font-mono text-[11px] leading-none"
      title={
        total
          ? `${encoded} of ${total} ingested ${total === 1 ? "entry" : "entries"} carry RuleSpec encodings`
          : `${encoded} RuleSpec ${encoded === 1 ? "file" : "files"}`
      }
    >
      <span className="text-[var(--color-accent)]">∀ {encoded}</span>
      {total ? (
        <span className="text-[var(--color-ink-muted)]"> / {total}</span>
      ) : null}
    </span>
  );
}

const ENCODED_MARK = (
  <span
    title="Has RuleSpec encodings"
    className="font-mono text-[13px] leading-none text-[var(--color-accent)]"
  >
    ∀
  </span>
);

/** Names the text source where it is not an official publisher, and
 *  credits the people who maintain it. */
function SourceCreditNote({ credit }: { credit: SourceCredit }) {
  return (
    <p
      data-testid="source-credit"
      className="mt-4 text-[13px] leading-relaxed text-[var(--color-ink-muted)]"
    >
      {credit.credit.map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{part}</span>
        ) : (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-ink-secondary)] underline decoration-[var(--color-rule)] underline-offset-2 hover:text-[var(--color-ink)] transition-colors"
          >
            {part.text}
          </a>
        )
      )}
    </p>
  );
}

/**
 * A lowercase word slug as words: "worker-with-children" → "Worker
 * with children"; a lone short token as an initialism: "bgb" → "BGB".
 * Anything else is the source's own notation and stays as written: a
 * number ("4005-10"), or a designator with capitals ("CD-1").
 */
function humanizeSlug(slug: string): string {
  // A lone short token is an initialism far more often than a word
  // in these paths (bgb, snap, tanf, chip).
  if (/^[a-z]{2,4}$/.test(slug)) return slug.toUpperCase();
  if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(slug) || !/[a-z]{3}/.test(slug)) {
    return slug;
  }
  const words = slug.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An entry's path below its group, as segments. */
function entryTail(entry: EncodedEntry): string[] {
  return entry.citationPath === entry.group
    ? []
    : entry.citationPath.slice(entry.group.length + 1).split("/");
}

/** Path words that introduce a provision number, and how a reader
 *  writes each. */
const NUMBER_MARKERS: Readonly<Record<string, string>> = {
  section: "§",
  regulation: "reg.",
  article: "art.",
};
const SECTION_NUMBER_RE = /^\d[\d.]*[A-Za-z]{0,2}$/;
const SUBDIVISION_RE = /^[0-9A-Za-z]{1,4}$/;

/**
 * The entry's place in its instrument, as a reader cites it:
 * "section-121" → "§ 121", "32/a" → "§ 32(a)", "regulation/22/1/b" →
 * "reg. 22(1)(b)". Null unless the whole tail reads as a number with
 * short subdivisions — a year-led path ("2013/376/regulation/22") or
 * a prose slug that starts with a digit is not a section number.
 */
function sectionKey(entry: EncodedEntry): string | null {
  const tail = entryTail(entry);
  if (tail.length === 0) return null;
  let mark = "§";
  let tokens = tail;
  const marker = NUMBER_MARKERS[tail[0].toLowerCase()];
  const joined = tail[0].match(/^section-(\d[\dA-Za-z.]*)$/i);
  if (marker && tail.length > 1) {
    mark = marker;
    tokens = tail.slice(1);
  } else if (joined) {
    tokens = [joined[1], ...tail.slice(1)];
  }
  const [number, ...subdivisions] = tokens;
  if (!SECTION_NUMBER_RE.test(number)) return null;
  if (!subdivisions.every((part) => SUBDIVISION_RE.test(part))) return null;
  return `${mark} ${number}${subdivisions.map((part) => `(${part})`).join("")}`;
}

/** What a row says when the corpus has no heading for it. */
function entryFallbackLabel(entry: EncodedEntry): string {
  const tail = entryTail(entry);
  const last = tail.at(-1) ?? entry.citationPath.split("/").at(-1) ?? "";
  const words = humanizeSlug(last);
  // A readable last segment names the row. Otherwise show the whole
  // tail as written, not its last letter ("…/22/1/b/i" is not "I").
  return words !== last || tail.length <= 1 ? words : tail.join("/");
}

/** A group the corpus has no heading for, named from its path. */
function groupFallbackName(group: string): string {
  const [, docType, ...rest] = group.split("/");
  const slug = rest.at(-1);
  // An entry shallow enough to group under its doc type.
  if (!slug) return displayDocType(docType ?? "");
  if (slug === "composed") return "Composed pipelines";
  // The finding list on this page names a bare-number volume "Title 26".
  if (
    rest.length === 1 &&
    /^\d/.test(slug) &&
    (docType === "statute" || docType === "regulation")
  ) {
    return `Title ${slug}`;
  }
  // Acronym-length segments read as initialisms (CMS, AAC), as the
  // browse loader names synthesized containers.
  if (/^[a-z]{2,5}$/i.test(slug)) return slug.toUpperCase();
  return humanizeSlug(slug);
}

function displayDocType(docType: string): string {
  return docType.charAt(0).toUpperCase() + docType.slice(1);
}

/** Every encoded provision in a small jurisdiction, one click from
 *  its root, grouped under the instrument each belongs to. */
function EncodedList({ entries }: { entries: EncodedEntry[] }) {
  // Keyed, not run-length: the grouping must not depend on the
  // loader's sort keeping each instrument's entries adjacent.
  const byGroup = new Map<string, EncodedEntry[]>();
  for (const entry of entries) {
    const items = byGroup.get(entry.group);
    if (items) items.push(entry);
    else byGroup.set(entry.group, [entry]);
  }
  const groups = Array.from(byGroup, ([group, items]) => ({ group, items }));
  return (
    <section data-testid="encoded-list" className="mt-12">
      <h2 className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        <span className="text-[var(--color-accent)]">∀</span> Encoded so far ·{" "}
        {entries.length}
      </h2>
      {groups.map(({ group, items }) => {
        const [, docType, ...rest] = group.split("/");
        return (
          <div key={group} className="mt-6" data-testid="encoded-group">
            {/* The doc type is the eyebrow — unless it is the group. */}
            {rest.length > 0 && (
              <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                {docType}
              </p>
            )}
            <h3
              dir="auto"
              className="mt-0.5 text-lg text-[var(--color-ink)]"
              style={{ fontFamily: "var(--f-serif)" }}
            >
              {items[0].groupHeading ?? groupFallbackName(group)}
            </h3>
            <ol className="mt-2 border-t border-[var(--color-rule)]">
              {items.map((entry) => {
                const key = sectionKey(entry);
                // A keyed row with no heading says its key and nothing
                // else: "§ 36a  Section 36a" would say it twice.
                const label =
                  entry.heading ?? (key ? null : entryFallbackLabel(entry));
                return (
                  <li
                    key={entry.citationPath}
                    className="border-b border-[var(--color-rule)]"
                  >
                    <Link
                      href={`/${entry.citationPath}`}
                      title={entry.citationPath}
                      className="group flex items-baseline gap-3 py-2.5 no-underline sm:gap-4"
                    >
                      {key && (
                        <span className="min-w-16 shrink-0 whitespace-nowrap font-mono text-[12px] text-[var(--color-ink-muted)] group-hover:text-[var(--color-accent)] transition-colors">
                          {key}
                        </span>
                      )}
                      {label && (
                        <span
                          dir="auto"
                          className="min-w-0 flex-1 truncate text-[15px] text-[var(--color-ink-secondary)] group-hover:text-[var(--color-ink)] transition-colors"
                        >
                          {label}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

export function BrowseView({ data }: { data: BrowsePageData }) {
  const heading =
    data.currentRule?.heading?.trim() ||
    (data.segments.length === 1
      ? data.jurisdictionLabel
      : data.breadcrumbs.at(-1)?.label ?? data.segments.at(-1));
  const basePath = data.segments.join("/");
  const depth = data.segments.length;
  const isRoot = depth === 1;
  const noun = childNoun(depth, data.nodes[0]?.segment);
  const encodedCount = data.nodes.filter((n) => n.hasRuleSpec).length;
  const sourceCredit = sourceCreditForJurisdiction(data.segments[0]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-24 pb-16">
      <TrackView
        event="axiom_tree_navigated"
        properties={{ depth, segment: data.segments.at(-1) ?? "" }}
      />
      <header className="mb-8">
        <Breadcrumbs data={data} />
        <h1
          dir="auto"
          className="mt-5 text-[2.4rem] leading-[1.1] font-semibold text-[var(--color-ink)]"
          style={{ fontFamily: "var(--f-serif)" }}
        >
          {displayLabel(heading ?? "")}
        </h1>
        {data.nodes.length > 0 && !data.hasMore && data.page === 0 && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
            {data.nodes.length}{" "}
            {data.nodes.length === 1 ? noun.replace(/s$/, "") : noun}
            {encodedCount > 0 && (
              <>
                {" "}· <span className="text-[var(--color-accent)]">∀</span>{" "}
                {encodedCount} with encodings
              </>
            )}
          </p>
        )}
        {sourceCredit && <SourceCreditNote credit={sourceCredit} />}
      </header>

      {data.nodes.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)] leading-relaxed">
          Nothing has been ingested at this level yet.
        </p>
      ) : isRoot ? (
        /* The jurisdiction root is a shelf of collections — each row
           names a drawer and says what lives inside it. */
        <ol
          data-testid="browse-list"
          className="divide-y divide-[var(--color-rule)] border-t border-b border-[var(--color-rule)]"
        >
          {data.nodes.map((node) => (
            <li key={node.segment}>
              <Link
                href={
                  node.rule?.citation_path
                    ? `/${node.rule.citation_path}`
                    : `/${basePath}/${node.segment}`
                }
                title={node.label}
                className="group block py-5 no-underline"
              >
                <span className="flex items-baseline justify-between gap-4">
                  <span
                    dir="auto"
                    className="text-xl text-[var(--color-ink)] group-hover:text-[var(--color-accent)] transition-colors"
                    style={{ fontFamily: "var(--f-serif)" }}
                  >
                    {displayLabel(node.label)}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] text-[var(--color-ink-muted)]">
                    {data.encodedCounts?.[node.segment] ? (
                      <CoverageMark
                        encoded={data.encodedCounts?.[node.segment]}
                      />
                    ) : (
                      node.hasRuleSpec && ENCODED_MARK
                    )}
                    {typeof node.childCount === "number" &&
                      node.childCount > 0 && (
                        <span>{node.childCount}</span>
                      )}
                  </span>
                </span>
                {DOC_TYPE_BLURBS[node.segment] && (
                  <span className="mt-1 block text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                    {DOC_TYPE_BLURBS[node.segment]}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        /* Finding list — the front-matter of a code volume: ordering
           numerals as tab dividers, dotted leaders running to the
           counts, ∀ marking what is machine-readable. */
        <ol data-testid="browse-list" className="border-t border-[var(--color-rule)]">
          {(() => {
            const hasGutter = data.nodes.some(
              (n) => orderingKey(n.segment) !== null
            );
            return data.nodes.map((node) => {
            const raw = displayLabel(node.label);
            // A label that just repeats the segment carries no
            // information at the title level — name the volume.
            const bareNumber = raw === node.segment && /^\d/.test(node.segment);
            let label =
              bareNumber &&
              depth === 2 &&
              (data.segments[1] === "statute" ||
                data.segments[1] === "regulation")
                ? `Title ${node.segment}`
                : raw;
            const key = orderingKey(node.segment);
            const showKey = key !== null && label !== node.segment;
            // The key column already says "C" — "Subpart C - Education…"
            // repeating it reads as a stutter.
            if (showKey && /^subpart-/i.test(node.segment)) {
              label = label.replace(/^subpart\s+\S+\s*[-—–]\s*/i, "");
            }
            return (
              <li
                key={node.segment}
                className="border-b border-[var(--color-rule)]"
              >
                <Link
                  // Canonical citation-path hrefs where known: deep
                  // containers flatten children out of their own path
                  // (…/subpart-C lists …/1302/30), so appending the
                  // segment would 404.
                  href={
                    node.rule?.citation_path
                      ? `/${node.rule.citation_path}`
                      : `/${basePath}/${node.segment}`
                  }
                  title={node.label}
                  className="group flex items-baseline gap-3 py-3 no-underline sm:gap-4"
                >
                  {showKey && (
                    <span
                      aria-hidden
                      className="w-10 shrink-0 text-right text-[1.15rem] leading-none text-[var(--color-ink-muted)] group-hover:text-[var(--color-accent)] transition-colors sm:w-14"
                      style={{
                        fontFamily: "var(--f-serif)",
                        fontFeatureSettings: "'onum'",
                      }}
                    >
                      {key}
                    </span>
                  )}
                  <span
                    dir="auto"
                    className={`min-w-0 truncate text-[15px] text-[var(--color-ink-secondary)] group-hover:text-[var(--color-ink)] transition-colors ${
                      hasGutter && !showKey ? "ml-[3.25rem] sm:ml-[4.5rem]" : ""
                    }`}
                  >
                    {label}
                  </span>
                  {/* Dotted leader, exactly as a printed table of
                      contents runs the eye to the page number. */}
                  <span
                    aria-hidden
                    className="min-w-6 flex-1 border-b border-dotted border-[var(--color-rule)] group-hover:border-[var(--color-ink-muted)] transition-colors"
                  />
                  <span className="flex shrink-0 items-baseline gap-2.5 font-mono text-[11px] text-[var(--color-ink-muted)]">
                    {data.encodedCounts?.[node.segment] ? (
                      <CoverageMark
                        encoded={data.encodedCounts?.[node.segment]}
                        total={node.childCount}
                      />
                    ) : (
                      node.hasRuleSpec && ENCODED_MARK
                    )}
                    {!data.encodedCounts?.[node.segment] &&
                      typeof node.childCount === "number" &&
                      node.childCount > 0 && (
                        <span className="hidden sm:inline">
                          {node.childCount}{" "}
                          {childNoun(depth + 1, undefined).replace(
                            /s$/,
                            node.childCount === 1 ? "" : "s"
                          )}
                        </span>
                      )}
                  </span>
                </Link>
              </li>
            );
          });
          })()}
        </ol>
      )}
      {isRoot && data.encodedEntries && data.encodedEntries.length > 0 && (
        <EncodedList entries={data.encodedEntries} />
      )}
      {(data.hasMore || data.page > 0) && (
        <nav
          aria-label="Browse pages"
          className="mt-6 flex items-center justify-between font-mono text-[11px] uppercase tracking-wider"
        >
          {data.page > 0 ? (
            <Link
              href={`/${basePath}${data.page - 1 > 0 ? `?page=${data.page - 1}` : ""}`}
              className="text-[var(--color-ink-muted)] no-underline hover:text-[var(--color-accent)]"
            >
              ← previous
            </Link>
          ) : (
            <span />
          )}
          {data.hasMore && (
            <Link
              href={`/${basePath}?page=${data.page + 1}`}
              className="text-[var(--color-ink-muted)] no-underline hover:text-[var(--color-accent)]"
            >
              more →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
