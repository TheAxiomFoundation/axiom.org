import Link from "next/link";
import {
  railChunksFromProvisions,
  refsForChunk,
  type BodyChunk,
  type SectionPageData,
  type SectionProvision,
} from "@/lib/axiom/section-page";
import { buildInlineReferences } from "@/lib/axiom/inline-references";
import { RuleBody } from "@/components/axiom/rule-body";
import { SectionToc } from "./section-toc";
import { FocusScroll } from "./focus-scroll";
import { EncodingRail } from "./encoding-rail";
import { CitationPreviewLayer } from "./citation-preview";
import { SubsectionActions } from "./subsection-actions";
import { ActionStrip } from "./action-strip";
import { CollapsibleText } from "./collapsible-text";
import { primaryProgram } from "./primary-program";
import { TrackView } from "@/components/axiom/track-view";
import { ReaderTour } from "@/components/axiom/tour/reader-tour";
import {
  builderUrlForRule,
  composeGraphViewerUrl,
  fileGraphFocus,
  graphFocusForCitationPath,
  graphViewerUrl,
  ruleGraphFocus,
} from "@/lib/axiom/runtime/graph-links";
import { formatLegalCitation } from "@/lib/axiom/citation/format";
import {
  sourceCreditForUrl,
  sourceLinkLabel,
} from "@/lib/axiom/source-attribution";
import { baseDirection } from "@/lib/axiom/text-direction";

/**
 * Server-rendered reading column for a section and its full
 * descendant subtree — the v2 replacement for the client-monolith
 * detail panel. Interactivity is limited to islands: RuleBody
 * (?mark= highlighting) and SectionToc (scroll-spy).
 */

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const ORACLE_LABELS: Readonly<Record<string, string>> = {
  policyengine: "PolicyEngine",
  taxsim: "TAXSIM",
  ukmod: "UKMOD",
  euromod: "EUROMOD",
};

/** Past this many subsections the segment map gives way to numerals. */
const COVERAGE_MAP_MAX_UNITS = 16;

const CHIP_CLASS =
  "inline-flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 py-1.5 text-[12px] font-medium leading-none text-[var(--color-ink-secondary)]";

/**
 * The section's trust row — three quiet status chips in the app's
 * sans, product-style rather than typewriter-style:
 *
 *   (∀ 8 rules) (▰▱▱▱▱▱ 1 of 6 subsections) (✓ Verified · PolicyEngine)
 *
 * Coverage is a map, not a meter: one segment per top-level
 * subsection in document order, filled where rules exist; each
 * segment links to its subsection. The verified chip appears only
 * for external-oracle parity comparisons — golden expectations are
 * self-graded and earn nothing. Denominators always shown.
 */
function EncodingStatusLine({ data }: { data: SectionPageData }) {
  if (data.encodedRules.length === 0) return null;
  const unitAnchors =
    data.provisions.length > 0
      ? data.provisions
          .filter((provision) => provision.relativeDepth === 1)
          .map((provision) => provision.anchor)
      : data.bodyChunks.map((chunk) => chunk.anchor);
  const encodedAnchors = new Set(
    data.encodedRules.flatMap((entry) => entry.anchors),
  );
  const encodedCount = unitAnchors.filter((anchor) =>
    encodedAnchors.has(anchor),
  ).length;

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2">
      <span className={CHIP_CLASS}>
        <span
          aria-hidden
          className="text-[13px] font-semibold text-[var(--color-accent)]"
        >
          ∀
        </span>
        {data.encodedRules.length}{" "}
        {data.encodedRules.length === 1 ? "rule" : "rules"}
      </span>

      {unitAnchors.length > 0 && (
        <span
          className={CHIP_CLASS}
          title={
            encodedCount === unitAnchors.length
              ? "Every subsection has encoded rules"
              : `Encoded so far: ${
                  unitAnchors
                    .filter((anchor) => encodedAnchors.has(anchor))
                    .map((anchor) => `(${anchor})`)
                    .join(" ") || "none at subsection level"
                }`
          }
        >
          {unitAnchors.length <= COVERAGE_MAP_MAX_UNITS && (
            <span className="inline-flex items-center gap-[3px]" aria-hidden>
              {unitAnchors.map((anchor) => (
                <a
                  key={anchor}
                  href={`#${anchor}`}
                  title={`(${anchor}) — ${
                    encodedAnchors.has(anchor) ? "encoded" : "not yet encoded"
                  }`}
                  className={`h-[5px] w-[14px] rounded-full transition-colors ${
                    encodedAnchors.has(anchor)
                      ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                      : "bg-[var(--color-rule)] hover:bg-[var(--color-ink-muted)]"
                  }`}
                />
              ))}
            </span>
          )}
          {encodedCount === unitAnchors.length
            ? `All ${unitAnchors.length} subsections`
            : `${encodedCount} of ${unitAnchors.length} subsections`}
        </span>
      )}

      {data.parity && (
        <span
          className="inline-flex cursor-help items-center gap-2 rounded-full border border-[rgba(22,101,52,0.25)] bg-[rgba(22,101,52,0.06)] px-3 py-1.5 text-[12px] font-medium leading-none text-[var(--color-success)]"
          title={`⊨ Externally verified: ${data.parity.programId} (${data.parity.jurisdiction}) agrees with ${
            ORACLE_LABELS[data.parity.oracle] ?? data.parity.oracle
          } — ${data.parity.caseDescriptions.join(" — ")}`}
        >
          <svg
            aria-hidden
            viewBox="0 0 12 12"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 6.2 4.8 9 10 3.4" />
          </svg>
          Verified · {ORACLE_LABELS[data.parity.oracle] ?? data.parity.oracle}
          <span className="opacity-60">
            {data.parity.caseCount}{" "}
            {data.parity.caseCount === 1 ? "case" : "cases"}
          </span>
        </span>
      )}
    </div>
  );
}

function Breadcrumbs({ data }: { data: SectionPageData }) {
  // Bare citation-path hrefs are canonical: the proxy routes
  // section-depth paths to this reader and browse levels to the v1
  // tree browser.
  return (
    <nav aria-label="Breadcrumb" data-tour="breadcrumbs">
      <ol className="flex flex-wrap items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        {data.breadcrumbs.map((item, index) => (
          <li key={item.href} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden>/</span>}
            {index === data.breadcrumbs.length - 1 ? (
              <span aria-current="page" className="text-[var(--color-ink)]">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="text-[var(--color-ink-secondary)] underline decoration-[var(--color-rule)] underline-offset-[3px] hover:text-[var(--color-accent)] hover:decoration-current transition-colors"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function AnchorLink({ anchor }: { anchor: string }) {
  return (
    <a
      href={`#${anchor}`}
      aria-label={`Link to subsection ${anchor}`}
      className="opacity-0 transition-opacity group-hover:opacity-100 text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] font-mono text-sm"
    >
      #
    </a>
  );
}

/** Top-level provision with its whole subtree — one collapsible unit
 *  so provision-backed sections compress the same way chunked ones
 *  do. Heading, chips, and actions stay outside the clamp. */
function ProvisionGroup({
  head,
  children: childProvisions,
  data,
  sectionFocus,
}: {
  head: SectionProvision;
  children: SectionProvision[];
  data: SectionPageData;
  sectionFocus: string | null;
}) {
  const anchor = head.anchor;
  const focused = data.focusAnchor === anchor;
  const groupRules = data.encodedRules.filter((entry) =>
    entry.anchors.includes(anchor),
  );
  const { graphHref, builderHref } = focused
    ? subsectionActionHrefs(data, anchor, groupRules)
    : { graphHref: null, builderHref: null };
  const heading = head.rule.heading?.trim();
  const textLength =
    (head.rule.body?.length ?? 0) +
    childProvisions.reduce(
      (sum, child) => sum + (child.rule.body?.length ?? 0),
      0,
    );
  const clamp = data.encodedRules.length > 0 && !focused && textLength > 420;
  const content = (
    <>
      {head.rule.body && (
        <div className="mt-2">
          <RuleBody
            body={head.rule.body}
            refs={[]}
            citationPath={head.rule.citation_path ?? undefined}
            testId={null}
          />
        </div>
      )}
      {childProvisions.map((child) => (
        <ProvisionBlock
          key={child.rule.id}
          provision={child}
          data={data}
          sectionFocus={sectionFocus}
        />
      ))}
    </>
  );
  return (
    <section
      id={anchor}
      className={`group scroll-mt-24 ${focused ? FOCUSED_SUBSECTION_CLASS : ""}`}
    >
      <h2 className="mt-7 flex items-baseline gap-2 text-lg font-semibold text-[var(--color-ink)]">
        <Link
          href={`/${data.citationPath}/${anchor}`}
          className="font-mono text-[0.85em] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] transition-colors"
          title={`Open ${data.citationPath}/${anchor}`}
        >
          {head.designator}
        </Link>
        {heading && <span className="min-w-0 truncate">{heading}</span>}
        {groupRules.length > 0 && (
          <span
            className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)]"
            title={groupRules.map((entry) => entry.name).join(", ")}
          >
            ∀ {groupRules.length}
          </span>
        )}
        <AnchorLink anchor={anchor} />
      </h2>
      {focused && (
        <SubsectionActions
          citationLabel={formatLegalCitation(data.citationPath, anchor)}
          href={`/${data.citationPath}/${anchor}`}
          graphHref={graphHref}
          builderHref={builderHref}
        />
      )}
      {clamp ? <CollapsibleText>{content}</CollapsibleText> : content}
    </section>
  );
}

/** Split the flat, path-sorted provision list into top-level groups.
 *  Orphans before the first top-level provision pass through. */
function groupProvisions(provisions: SectionProvision[]): Array<{
  head: SectionProvision | null;
  children: SectionProvision[];
}> {
  const groups: Array<{
    head: SectionProvision | null;
    children: SectionProvision[];
  }> = [];
  let current: (typeof groups)[number] | null = null;
  for (const provision of provisions) {
    if (provision.relativeDepth === 1) {
      current = { head: provision, children: [] };
      groups.push(current);
    } else if (
      current?.head &&
      provision.anchor.startsWith(`${current.head.anchor}-`)
    ) {
      current.children.push(provision);
    } else {
      if (!current || current.head) {
        current = { head: null, children: [] };
        groups.push(current);
      }
      current.children.push(provision);
    }
  }
  return groups;
}

function ProvisionBlock({
  provision,
  data,
  sectionFocus,
}: {
  provision: SectionProvision;
  data: SectionPageData;
  sectionFocus: string | null;
}) {
  const { rule, anchor, designator, relativeDepth } = provision;
  const heading = rule.heading?.trim();
  const HeadingTag = relativeDepth === 1 ? "h2" : "h3";
  const isTopLevel = relativeDepth === 1;
  // Top-level provisions get everything a body chunk gets — focus
  // highlight, action row, encoded-rule chips, and a real subsection
  // URL on the designator — so the two column shapes behave the same
  // for readers.
  const focused = isTopLevel && data.focusAnchor === anchor;
  const provisionRules = isTopLevel
    ? data.encodedRules.filter((entry) => entry.anchors.includes(anchor))
    : [];
  const { graphHref, builderHref } = focused
    ? subsectionActionHrefs(data, anchor, provisionRules)
    : { graphHref: null, builderHref: null };
  return (
    <section
      id={anchor}
      className={`group scroll-mt-24 ${focused ? FOCUSED_SUBSECTION_CLASS : ""}`}
    >
      <HeadingTag
        className={`flex items-baseline gap-2 text-[var(--color-ink)] ${
          isTopLevel
            ? "mt-10 text-lg font-semibold"
            : "mt-6 text-base font-medium"
        }`}
      >
        {isTopLevel ? (
          <Link
            href={`/${data.citationPath}/${anchor}`}
            className="font-mono text-[0.85em] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] transition-colors"
            title={`Open ${data.citationPath}/${anchor}`}
          >
            {designator}
          </Link>
        ) : (
          <span className="font-mono text-[0.85em] text-[var(--color-ink-muted)]">
            {designator}
          </span>
        )}
        {heading && <span>{heading}</span>}
        <AnchorLink anchor={anchor} />
      </HeadingTag>
      {focused && (
        <SubsectionActions
          citationLabel={formatLegalCitation(data.citationPath, anchor)}
          href={`/${data.citationPath}/${anchor}`}
          graphHref={graphHref}
          builderHref={builderHref}
        />
      )}
      {rule.body && (
        <div className="mt-2">
          <RuleBody
            body={rule.body}
            refs={[]}
            citationPath={rule.citation_path ?? undefined}
            testId={null}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Action-row targets for one top-level subsection: the covering
 * program's graph focused on it, and its first encoded rule as a
 * builder output. Shared by both column shapes (body chunks and
 * corpus provisions) so deep links behave identically.
 */
function subsectionActionHrefs(
  data: SectionPageData,
  anchor: string,
  subsectionRules: SectionPageData["encodedRules"],
): { graphHref: string | null; builderHref: string | null } {
  const sectionFocus = graphFocusForCitationPath(data.citationPath);
  const slug = data.citationPath.split("/")[0];
  const graphProgram =
    data.programs.find(
      (program) =>
        program.status === "ready" && program.anchors.includes(anchor),
    ) ??
    data.programs.find((program) => program.anchors.includes(anchor)) ??
    primaryProgram(data.programs);
  const inPrograms = new Set(
    data.programs.flatMap((program) => program.ruleNames),
  );
  const sorted = [...subsectionRules].sort(
    (a, b) => Number(b.kind === "derived") - Number(a.kind === "derived"),
  );
  // No package covers this section: compose the graph on demand from
  // the subsection's encoded file instead of dropping the link.
  const composeRule = sorted.find((rule) => data.ruleFiles[rule.name]);
  const graphHref =
    graphProgram && sectionFocus
      ? graphViewerUrl(graphProgram, `${sectionFocus}/${anchor}`)
      : composeRule && slug
        ? composeGraphViewerUrl(
            fileGraphFocus(slug, data.ruleFiles[composeRule.name]),
          )
        : null;
  // Builder gets the section-level legal id: its deep-link handler
  // scopes the output picker to this provision and the user selects
  // which rules become outputs there — no per-rule link picking here.
  const builderHref =
    sectionFocus && subsectionRules.length > 0
      ? builderUrlForRule(sectionFocus)
      : null;
  return { graphHref, builderHref };
}

/**
 * Builder target for the header strip: the section-level legal id.
 * The builder resolves a program containing the section's rules and
 * lands on its output picker scoped to this provision, where the
 * user selects which rulespec rules become calculator outputs.
 */
function stripBuilderHref(data: SectionPageData): string | null {
  const sectionFocus = graphFocusForCitationPath(data.citationPath);
  if (!sectionFocus || data.encodedRules.length === 0) return null;
  return builderUrlForRule(sectionFocus);
}

/**
 * Header-strip graph target when no compiled package covers this
 * section: compose the graph on demand from the section's encoded
 * file (the viewer's ?compose= mode, backed by the encodings mirror).
 */
function stripComposeHref(data: SectionPageData): string | null {
  const rule = data.encodedRules.find((entry) => data.ruleFiles[entry.name]);
  if (!rule) return null;
  const slug = data.citationPath.split("/")[0];
  return composeGraphViewerUrl(fileGraphFocus(slug, data.ruleFiles[rule.name]));
}

const FOCUSED_SUBSECTION_CLASS =
  "rounded-md -mx-3 px-3 pb-3 shadow-[0_0_0_1px_rgba(146,64,14,0.35)] bg-[rgba(146,64,14,0.05)]";

function ChunkBlock({
  chunk,
  data,
}: {
  chunk: BodyChunk;
  data: SectionPageData;
}) {
  const focused = data.focusAnchor === chunk.anchor;
  const chunkRules = data.encodedRules.filter((rule) =>
    rule.anchors.includes(chunk.anchor),
  );
  const { graphHref, builderHref } = focused
    ? subsectionActionHrefs(data, chunk.anchor, chunkRules)
    : { graphHref: null, builderHref: null };
  // The encoded layer leads the page; long source text sits behind a
  // clamped preview unless the reader deep-linked to this subsection
  // or the section carries no encodings at all (then text is the
  // only content and stands open).
  const clamp =
    data.encodedRules.length > 0 && !focused && chunk.text.length > 420;
  const body = (
    <RuleBody
      body={chunk.text}
      refs={refsForChunk(data.rootRefs, chunk.text)}
      citationPath={data.root.citation_path ?? undefined}
      testId={null}
    />
  );
  return (
    <section
      id={chunk.anchor}
      className={`group scroll-mt-24 ${focused ? FOCUSED_SUBSECTION_CLASS : ""}`}
    >
      {/* The row follows the chunk's text, not its designator: "(1)"
          is all weak characters, so auto alone would leave a Hebrew
          chunk's heading row left-to-right. */}
      <h2
        dir={baseDirection(`${chunk.label} ${chunk.text}`) ?? "auto"}
        className="mt-7 flex items-baseline gap-2"
      >
        <Link
          href={`/${data.citationPath}/${chunk.anchor}`}
          className="font-mono text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] transition-colors"
          title={`Open ${data.citationPath}/${chunk.anchor}`}
        >
          {chunk.designator}
        </Link>
        <span
          className="min-w-0 truncate text-[15px] text-[var(--color-ink)]"
          style={{ fontFamily: "var(--f-serif)" }}
        >
          {chunk.label.replace(/^\([a-z]{1,2}\)\s*/, "")}
        </span>
        {chunkRules.length > 0 && (
          <span
            className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)]"
            title={chunkRules.map((rule) => rule.name).join(", ")}
          >
            ∀ {chunkRules.length}
          </span>
        )}
        <AnchorLink anchor={chunk.anchor} />
      </h2>
      {focused && (
        <SubsectionActions
          citationLabel={formatLegalCitation(data.citationPath, chunk.anchor)}
          href={`/${data.citationPath}/${chunk.anchor}`}
          graphHref={graphHref}
          builderHref={builderHref}
        />
      )}
      <div className="mt-1">
        {clamp ? <CollapsibleText>{body}</CollapsibleText> : body}
      </div>
    </section>
  );
}

function NeighborNav({ data }: { data: SectionPageData }) {
  if (!data.prev && !data.next) return null;
  return (
    <nav
      aria-label="Adjacent sections"
      className="mt-12 flex justify-between gap-4 border-t border-[var(--color-rule)] pt-5 text-sm"
    >
      {data.prev ? (
        <Link
          href={`/${data.prev.citationPath}`}
          rel="prev"
          className="max-w-[45%] truncate text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)] transition-colors"
        >
          {/* The arrows are page chrome and keep their side; <bdi>
              isolates a Hebrew label so it cannot reorder them. */}
          ← <bdi>{data.prev.label}</bdi>
        </Link>
      ) : (
        <span />
      )}
      {data.next ? (
        <Link
          href={`/${data.next.citationPath}`}
          rel="next"
          className="max-w-[45%] truncate text-right text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)] transition-colors"
        >
          <bdi>{data.next.label}</bdi> →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function SectionReader({
  data,
  highlightRule = null,
}: {
  data: SectionPageData;
  /** Rule name the visitor navigated from (graph inspector's
   *  Read-the-law) — the rail spotlights its card. */
  highlightRule?: string | null;
}) {
  const heading = data.root.heading?.trim();
  const effective = formatDate(data.root.effective_date);
  const outgoing = buildInlineReferences(
    data.refBody ?? data.root.body,
    data.citationPath,
    data.rootRefs,
  ).filter((ref) => ref.direction === "outgoing");
  const incoming = data.rootRefs.filter((ref) => ref.direction === "incoming");
  const sectionFocus = graphFocusForCitationPath(data.citationPath);

  return (
    <div className="mx-auto grid w-full max-w-[88rem] grid-cols-1 gap-10 px-4 pt-24 pb-16 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[210px_minmax(0,1fr)_400px]">
      <TrackView
        event="axiom_rule_viewed"
        properties={{
          citation_path: data.citationPath,
          jurisdiction: data.root.jurisdiction,
          has_rulespec: data.root.has_rulespec,
        }}
      />
      <aside className="hidden xl:block">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
          <SectionToc entries={data.toc} />
        </div>
      </aside>

      <article data-testid="section-reader">
        <ReaderTour />
        <CitationPreviewLayer />
        {data.focusAnchor && <FocusScroll anchor={data.focusAnchor} />}
        <div className="mb-4">
          <Breadcrumbs data={data} />
        </div>

        <header className="border-b border-[var(--color-rule)] pb-5">
          {heading && (
            <h1
              dir="auto"
              className="text-2xl font-semibold text-[var(--color-ink)]"
              style={{ fontFamily: "var(--f-serif)" }}
            >
              {heading}
            </h1>
          )}
          <EncodingStatusLine data={data} />
          <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-[var(--color-ink-muted)]">
            {effective && <span>Effective {effective}</span>}
            {data.root.source_url && (
              <a
                href={data.root.source_url}
                target="_blank"
                rel="noreferrer"
                // A volunteer consolidation is not an official
                // publication: it carries its own name.
                title={sourceCreditForUrl(data.root.source_url)?.linkTitle}
                className="underline decoration-[var(--color-rule)] underline-offset-2 hover:text-[var(--color-ink)] transition-colors"
              >
                {sourceLinkLabel(data.root.source_url)}
              </a>
            )}
          </div>
          <ActionStrip
            encodedRuleCount={data.encodedRules.length}
            graphHref={(() => {
              const program = primaryProgram(data.programs);
              return program && sectionFocus
                ? graphViewerUrl(program, sectionFocus)
                : stripComposeHref(data);
            })()}
            builderHref={stripBuilderHref(data)}
            citationLabel={formatLegalCitation(data.citationPath)}
            href={`/${data.citationPath}`}
          />
        </header>

        {data.bodyChunks.length > 0 ? (
          <>
            {data.intro && (
              <div className="mt-6">
                <RuleBody
                  body={data.intro}
                  refs={refsForChunk(data.rootRefs, data.intro)}
                  citationPath={data.root.citation_path ?? undefined}
                />
              </div>
            )}
            {data.bodyChunks.map((chunk) => (
              <ChunkBlock key={chunk.anchor} chunk={chunk} data={data} />
            ))}
          </>
        ) : (
          data.root.body && (
            <div className="mt-6">
              <RuleBody
                body={data.root.body}
                refs={data.rootRefs}
                citationPath={data.root.citation_path ?? undefined}
              />
            </div>
          )
        )}

        {groupProvisions(data.provisions).map((group, index) =>
          group.head ? (
            <ProvisionGroup
              key={group.head.rule.id}
              head={group.head}
              data={data}
              sectionFocus={sectionFocus}
            >
              {group.children}
            </ProvisionGroup>
          ) : (
            group.children.map((provision) => (
              <ProvisionBlock
                key={provision.rule.id}
                provision={provision}
                data={data}
                sectionFocus={sectionFocus}
              />
            ))
          ),
        )}

        {data.truncated && (
          <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
            This section is unusually large; deeper subsections were cut off.
            Open a subsection via its designator link — for example{" "}
            {data.toc[0] ? (
              <Link
                href={`/${data.citationPath}/${data.toc[0].anchor.split("-")[0]}`}
                className="underline decoration-[var(--color-rule)] underline-offset-2 hover:text-[var(--color-ink)]"
              >
                {data.toc[0].label.split(" ")[0]}
              </Link>
            ) : (
              "its heading"
            )}{" "}
            — to read its full text.
          </p>
        )}

        <NeighborNav data={data} />
      </article>

      {/* Encoding + citation-graph rail. Pinned on xl+ so the
          encoding stays in view while the source scrolls — the
          "prove faithfulness" pairing from the v1 detail panel. */}
      <aside className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
        <EncodingRail
          highlightRule={highlightRule}
          encoding={data.encoding}
          jurisdiction={data.root.jurisdiction}
          citationPath={data.root.citation_path}
          isRepealed={Boolean(data.root.repeal_date)}
          chunks={
            data.bodyChunks.length > 0
              ? data.bodyChunks.map((chunk) => ({
                  anchor: chunk.anchor,
                  designator: chunk.designator,
                  label: chunk.label,
                  text: chunk.text,
                }))
              : railChunksFromProvisions(data.provisions)
          }
          encodedRules={data.encodedRules}
          outgoing={outgoing}
          incoming={incoming}
          programs={data.programs}
          ruleFiles={data.ruleFiles}
          citedByFiles={data.citedByFiles}
          citedByOverflow={data.citedByOverflow}
        />
      </aside>
    </div>
  );
}
