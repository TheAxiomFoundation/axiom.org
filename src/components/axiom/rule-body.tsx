"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject, ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { RuleReference } from "@/lib/supabase";
import {
  buildInlineReferences,
  type InlineReference,
} from "@/lib/axiom/inline-references";

/**
 * Render a rule's body text with outgoing citations spliced in as
 * clickable links.
 *
 * The server-side extractor gives us ``(start_offset, end_offset)``
 * spans computed against the same body string stored in
 * corpus provision body text, so splicing is a single pass: emit the
 * plain-text chunks between refs, wrap each ref's text in an anchor.
 *
 * Refs whose offsets fall outside the body (stale or mismatched),
 * whose spans overlap a previously emitted ref, or whose spans are
 * zero-width are silently skipped — better to lose a link than
 * render garbled text. splice() sorts its input, so the caller can
 * pass refs in any order.
 *
 * A ``?mark=start-end`` query param (used by incoming-reference
 * clicks — see ReferencesPanel) triggers a highlighted ``<mark>``
 * wrapper around the matching byte range and a scroll-into-view on
 * mount so the reader lands on the exact citing passage.
 */

interface RuleBodyProps {
  body: string;
  refs: RuleReference[];
  citationPath?: string;
  testId?: string | null;
  /** Route prefix for spliced citation links — the v2 reader passes
   *  "/axiom/v2" so navigation stays inside the new surface. */
  hrefPrefix?: string;
}

interface Range {
  start: number;
  end: number;
}

interface Segment {
  offset: number;
  text: string;
  kind: "plain" | "ref";
  ref?: InlineReference;
}

interface TableCell {
  text: string;
  start: number;
  end: number;
}

type BodyBlock =
  | { type: "text"; text: string; start: number; end: number }
  | { type: "table"; headers: TableCell[]; rows: TableCell[][] };

function spliceRefs(body: string, refs: InlineReference[]): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  const sorted = [...refs].sort((a, b) => a.start_offset - b.start_offset);
  for (const ref of sorted) {
    if (
      ref.start_offset < cursor ||
      ref.end_offset > body.length ||
      ref.end_offset <= ref.start_offset
    ) {
      continue;
    }
    if (ref.start_offset > cursor) {
      out.push({
        offset: cursor,
        text: body.slice(cursor, ref.start_offset),
        kind: "plain",
      });
    }
    out.push({
      offset: ref.start_offset,
      text: body.slice(ref.start_offset, ref.end_offset),
      kind: "ref",
      ref,
    });
    cursor = ref.end_offset;
  }
  if (cursor < body.length) {
    out.push({
      offset: cursor,
      text: body.slice(cursor),
      kind: "plain",
    });
  }
  return out;
}

/**
 * Split any segment that straddles ``range`` into (pre, overlap, post)
 * so the overlapping slice can be wrapped in a ``<mark>``. Keeps the
 * segment's kind / ref intact across the split — a citation link that
 * happens to lie inside the marked range stays a citation link.
 */
function applyMark(segments: Segment[], range: Range | null): Array<Segment & { marked: boolean }> {
  if (!range) return segments.map((s) => ({ ...s, marked: false }));
  const out: Array<Segment & { marked: boolean }> = [];
  for (const seg of segments) {
    const end = seg.offset + seg.text.length;
    if (range.end <= seg.offset || range.start >= end) {
      out.push({ ...seg, marked: false });
      continue;
    }
    const ovStart = Math.max(range.start, seg.offset);
    const ovEnd = Math.min(range.end, end);
    const local = (p: number) => p - seg.offset;
    if (seg.offset < ovStart) {
      out.push({ ...seg, text: seg.text.slice(0, local(ovStart)), marked: false });
    }
    out.push({
      ...seg,
      offset: ovStart,
      text: seg.text.slice(local(ovStart), local(ovEnd)),
      marked: true,
    });
    if (ovEnd < end) {
      out.push({
        ...seg,
        offset: ovEnd,
        text: seg.text.slice(local(ovEnd)),
        marked: false,
      });
    }
  }
  return out;
}

function parseMark(raw: string | null): Range | null {
  if (!raw) return null;
  const m = raw.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return null;
  }
  return { start, end };
}

/**
 * Stored reference offsets are frequently stale (computed against an
 * older or longer body revision), so a raw ``?mark=`` range can land
 * on the wrong words. When the link also carries the cited text
 * (``mt``), trust the range only if it matches; otherwise re-anchor
 * on the first occurrence of the text, and drop the highlight rather
 * than mark unrelated text. Without ``mt`` (legacy/external links)
 * keep the old in-bounds behaviour.
 */
function resolveMarkRange(
  range: Range | null,
  markText: string | null,
  body: string
): Range | null {
  if (!range) return null;
  const inBounds = range.end <= body.length;
  if (!markText) return inBounds ? range : null;
  if (inBounds && body.slice(range.start, range.end) === markText) {
    return range;
  }
  const index = body.indexOf(markText);
  if (index === -1) return null;
  return { start: index, end: index + markText.length };
}

function parseTableLine(line: string, lineOffset: number): TableCell[] {
  const pipeIndexes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|") pipeIndexes.push(i);
  }
  if (pipeIndexes.length < 2) return [];

  const cells: TableCell[] = [];
  for (let i = 0; i < pipeIndexes.length - 1; i++) {
    const rawStart = pipeIndexes[i] + 1;
    const rawEnd = pipeIndexes[i + 1];
    const raw = line.slice(rawStart, rawEnd);
    const leftTrim = raw.match(/^\s*/)?.[0].length ?? 0;
    const rightTrim = raw.match(/\s*$/)?.[0].length ?? 0;
    const start = rawStart + leftTrim;
    const end = Math.max(start, rawEnd - rightTrim);
    cells.push({
      text: line.slice(start, end),
      start: lineOffset + start,
      end: lineOffset + end,
    });
  }
  return cells;
}

function isSeparatorRow(cells: TableCell[]): boolean {
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.text.replace(/\s+/g, "")))
  );
}

function normaliseRow(row: TableCell[], width: number): TableCell[] {
  if (row.length >= width) return row.slice(0, width);
  return [
    ...row,
    ...Array.from({ length: width - row.length }, () => ({
      text: "",
      start: 0,
      end: 0,
    })),
  ];
}

function rowFromPipeIndexes(
  body: string,
  pipes: number[],
  startIndex: number,
  endIndex: number
): { start: number; end: number; cells: TableCell[] } {
  const start = pipes[startIndex];
  const end = pipes[endIndex] + 1;
  return {
    start,
    end,
    cells: parseTableLine(body.slice(start, end), start),
  };
}

function hasOnlyWhitespaceBetween(body: string, leftEnd: number, rightStart: number): boolean {
  return body.slice(leftEnd, rightStart).trim() === "";
}

function findNextTableBlock(
  body: string,
  pipes: number[],
  pipeStartIndex: number
): { block: BodyBlock; start: number; end: number; nextPipeIndex: number } | null {
  for (let sepStartIndex = pipeStartIndex + 1; sepStartIndex < pipes.length; sepStartIndex++) {
    const maxEndIndex = Math.min(sepStartIndex + 10, pipes.length - 1);
    for (let sepEndIndex = sepStartIndex + 2; sepEndIndex <= maxEndIndex; sepEndIndex++) {
      const separator = rowFromPipeIndexes(
        body,
        pipes,
        sepStartIndex,
        sepEndIndex
      );
      if (!isSeparatorRow(separator.cells)) continue;

      const width = separator.cells.length;
      const headerEndIndex = sepStartIndex - 1;
      const headerStartIndex = headerEndIndex - width;
      if (headerStartIndex < pipeStartIndex) continue;

      const header = rowFromPipeIndexes(
        body,
        pipes,
        headerStartIndex,
        headerEndIndex
      );
      if (header.cells.length !== width) continue;
      if (
        !hasOnlyWhitespaceBetween(
          body,
          header.end,
          separator.start
        )
      ) {
        continue;
      }

      const rows: TableCell[][] = [];
      let previousEndIndex = sepEndIndex;
      let rowStartIndex = sepEndIndex + 1;
      while (rowStartIndex + width < pipes.length) {
        if (
          !hasOnlyWhitespaceBetween(
            body,
            pipes[previousEndIndex] + 1,
            pipes[rowStartIndex]
          )
        ) {
          break;
        }
        const rowEndIndex = rowStartIndex + width;
        const row = rowFromPipeIndexes(body, pipes, rowStartIndex, rowEndIndex);
        if (row.cells.length !== width) break;
        rows.push(normaliseRow(row.cells, width));
        previousEndIndex = rowEndIndex;
        rowStartIndex = rowEndIndex + 1;
      }
      if (rows.length === 0) continue;

      return {
        block: { type: "table", headers: header.cells, rows },
        start: header.start,
        end: pipes[previousEndIndex] + 1,
        nextPipeIndex: rowStartIndex,
      };
    }
  }

  return null;
}

function parseBodyBlocks(body: string): BodyBlock[] {
  const pipes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "|") pipes.push(i);
  }
  const blocks: BodyBlock[] = [];
  let textStart = 0;
  let pipeStartIndex = 0;

  const pushText = (end: number) => {
    if (end <= textStart) return;
    blocks.push({
      type: "text",
      text: body.slice(textStart, end),
      start: textStart,
      end,
    });
  };

  while (pipeStartIndex < pipes.length) {
    const table = findNextTableBlock(body, pipes, pipeStartIndex);
    if (!table) break;
    pushText(table.start);
    blocks.push(table.block);
    textStart = table.end;
    pipeStartIndex = table.nextPipeIndex;
  }

  pushText(body.length);
  return blocks;
}

function Citation({
  ref,
  text,
  hrefPrefix = "",
}: {
  ref: InlineReference;
  text: string;
  hrefPrefix?: string;
}) {
  // Incoming refs carry offsets into the citing (target) body; pass them
  // through as a ``mark`` query so the target page lands on the exact
  // passage. ``mt`` carries the cited text so the target can verify the
  // offsets against its own body and re-anchor when they are stale.
  const markQuery =
    ref.direction === "incoming"
      ? `?mark=${ref.start_offset}-${ref.end_offset}&mt=${encodeURIComponent(
          ref.citation_text
        )}`
      : "";
  const href = `${hrefPrefix}/${ref.other_citation_path}${markQuery}`;
  const title = ref.inferred
    ? `Inferred link to ${ref.other_citation_path}`
    : ref.target_resolved
      ? `${ref.other_citation_path}${ref.other_heading ? ` — ${ref.other_heading}` : ""}`
      : `${ref.other_citation_path} — not yet ingested`;
  const classes = ref.target_resolved
    ? "text-[var(--color-accent)] underline decoration-[var(--color-rule)] underline-offset-2 hover:decoration-[var(--color-accent)] transition-colors"
    : "text-[var(--color-ink-secondary)] underline decoration-dotted decoration-[var(--color-rule)] underline-offset-2";
  return (
    <Link
      href={href}
      className={classes}
      title={title}
      {...(ref.target_resolved && { "data-cite": ref.other_citation_path })}
    >
      {text}
    </Link>
  );
}

function SourceLead({
  line,
  segments,
  firstMarkOffset,
  firstMarkRef,
  hrefPrefix,
}: {
  line: TextLine;
  segments: Array<Segment & { marked: boolean }>;
  firstMarkOffset: number | null;
  firstMarkRef: MutableRefObject<HTMLElement | null>;
  hrefPrefix: string;
}) {
  const match = line.text.match(/^(\s*)(Sources?:)(\s*)/i);
  if (!match) {
    return (
      <>
        {renderInlineSegments({
          segments,
          start: line.start,
          end: line.end,
          firstMarkOffset,
          firstMarkRef,
          hrefPrefix,
        })}
      </>
    );
  }
  const leadStart = line.start + match[1].length;
  const leadEnd = leadStart + match[2].length;
  const restStart = leadEnd + match[3].length;
  return (
    <>
      {match[1]}
      <strong className="font-semibold text-[var(--color-ink)]">
        {renderInlineSegments({
          segments,
          start: leadStart,
          end: leadEnd,
          firstMarkOffset,
          firstMarkRef,
          hrefPrefix,
        })}
      </strong>
      {match[3]}
      {renderInlineSegments({
        segments,
        start: restStart,
        end: line.end,
        firstMarkOffset,
        firstMarkRef,
        hrefPrefix,
      })}
    </>
  );
}

interface TextLine {
  text: string;
  start: number;
  end: number;
}

interface TextParagraph {
  lines: TextLine[];
  startsWithSource: boolean;
}

function isStructuralLine(text: string): boolean {
  return /^\s*(?:\([^)]+\)|Sources?:)/i.test(text);
}

function pushParagraph(
  paragraphs: TextParagraph[],
  lines: TextLine[]
): TextLine[] {
  if (lines.length === 0) return lines;
  paragraphs.push({
    lines,
    startsWithSource: /^\s*Sources?:/i.test(lines[0].text),
  });
  return [];
}

function splitTextParagraphs(block: Extract<BodyBlock, { type: "text" }>): TextParagraph[] {
  const paragraphs: TextParagraph[] = [];
  let current: TextLine[] = [];
  let cursor = 0;

  for (const rawLine of block.text.split("\n")) {
    const start = block.start + cursor;
    const end = start + rawLine.length;
    cursor += rawLine.length + 1;

    if (!rawLine.trim()) {
      current = pushParagraph(paragraphs, current);
      continue;
    }

    const line = { text: rawLine, start, end };
    if (current.length > 0 && isStructuralLine(rawLine)) {
      current = pushParagraph(paragraphs, current);
    }
    current.push(line);
  }

  pushParagraph(paragraphs, current);
  return paragraphs;
}

function renderTextBlock({
  block,
  segments,
  firstMarkOffset,
  firstMarkRef,
  hrefPrefix,
}: {
  block: Extract<BodyBlock, { type: "text" }>;
  segments: Array<Segment & { marked: boolean }>;
  firstMarkOffset: number | null;
  firstMarkRef: MutableRefObject<HTMLElement | null>;
  hrefPrefix: string;
}): ReactNode {
  const paragraphs = splitTextParagraphs(block);

  if (paragraphs.length === 0) return null;

  return (
    <div key={`text-${block.start}`}>
      {paragraphs.map((paragraph, index) => {
        return (
          <p
            key={`${paragraph.lines[0].start}-${paragraph.lines.at(-1)?.end}`}
            // Provision text sets its own base direction: a Hebrew
            // paragraph lays out right-to-left, so its designator
            // and punctuation land on the correct side.
            dir="auto"
            className={`m-0 whitespace-pre-wrap ${
              index === 0 ? "" : paragraph.startsWithSource ? "mt-7" : "mt-5"
            }`}
          >
            {paragraph.lines.map((line, lineIndex) => (
              <span key={`${line.start}-${line.end}`}>
                {lineIndex > 0 ? " " : null}
                <SourceLead
                  line={line}
                  segments={segments}
                  firstMarkOffset={firstMarkOffset}
                  firstMarkRef={firstMarkRef}
                  hrefPrefix={hrefPrefix}
                />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInlineSegments({
  segments,
  start,
  end,
  firstMarkOffset,
  firstMarkRef,
  hrefPrefix,
}: {
  segments: Array<Segment & { marked: boolean }>;
  start: number;
  end: number;
  firstMarkOffset: number | null;
  firstMarkRef: MutableRefObject<HTMLElement | null>;
  hrefPrefix: string;
}): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const seg of segments) {
    const segEnd = seg.offset + seg.text.length;
    if (segEnd <= start || seg.offset >= end) continue;
    const sliceStart = Math.max(start, seg.offset);
    const sliceEnd = Math.min(end, segEnd);
    const localStart = sliceStart - seg.offset;
    const localEnd = sliceEnd - seg.offset;
    const text = seg.text.slice(localStart, localEnd);
    const inner =
      seg.kind === "ref" && seg.ref ? (
        <Citation ref={seg.ref} text={text} hrefPrefix={hrefPrefix} />
      ) : (
        text
      );
    const key = `${sliceStart}-${sliceEnd}`;
    if (!seg.marked) {
      nodes.push(<span key={key}>{inner}</span>);
      continue;
    }
    nodes.push(
      <mark
        key={key}
        ref={(el) => {
          if (sliceStart === firstMarkOffset) firstMarkRef.current = el;
        }}
        className="axiom-mark bg-[rgba(146,64,14,0.18)] text-[var(--color-ink)] px-1 -mx-0.5 rounded-sm shadow-[0_0_0_1px_rgba(146,64,14,0.35)] decoration-[var(--color-accent)]"
      >
        {inner}
      </mark>
    );
  }
  return nodes;
}

export function RuleBody({
  body,
  refs,
  citationPath,
  testId = "rule-body-inline",
  hrefPrefix = "",
}: RuleBodyProps) {
  const searchParams = useSearchParams();
  const markString = searchParams?.get("mark") ?? null;
  const markText = searchParams?.get("mt") ?? null;
  const markRange = parseMark(markString);
  const firstMarkRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!markRange) return;
    const el = firstMarkRef.current;
    if (!el) return;
    // Defer one frame so layout has settled before we measure /
    // scroll — the body is rendered after a Supabase fetch and
    // the rail's sticky positioning can shift things mid-mount.
    const handle = window.requestAnimationFrame(() => {
      const headerOffset = 96; // nav bar height; scroll above the mark
      const rect = el.getBoundingClientRect();
      const top = window.scrollY + rect.top - headerOffset;
      window.scrollTo({ top, behavior: "smooth" });
      // Brief flash so the user clearly sees where they landed.
      el.classList.add("axiom-mark-flash");
      window.setTimeout(() => el.classList.remove("axiom-mark-flash"), 1600);
    });
    return () => window.cancelAnimationFrame(handle);
    // markString (a primitive) is the right dependency — the parsed
    // object would be a new reference every render and re-fire the
    // effect for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markString]);

  if (!body) return null;

  const inlineRefs = buildInlineReferences(body, citationPath, refs);
  const segments = applyMark(
    spliceRefs(body, inlineRefs),
    resolveMarkRange(markRange, markText, body)
  );

  // Precompute the index of the first marked segment so the ref
  // callback doesn't rely on a mutated closure variable during map
  // — cleaner under React 19's concurrent rendering.
  const firstMarkIndex = segments.findIndex((s) => s.marked);
  const firstMarkOffset =
    firstMarkIndex >= 0 ? segments[firstMarkIndex].offset : null;
  const blocks = parseBodyBlocks(body);

  return (
    <div
      {...(testId && { "data-testid": testId })}
      className="text-[0.95rem] text-[var(--color-ink-secondary)] leading-[1.8] whitespace-pre-wrap"
      style={{ fontFamily: "var(--f-serif)" }}
    >
      {blocks.map((block, blockIndex) => {
        if (block.type === "text") {
          return renderTextBlock({
            block,
            segments,
            firstMarkOffset,
            firstMarkRef,
            hrefPrefix,
          });
        }
        return (
          <div
            key={`table-${blockIndex}`}
            className="my-5 overflow-x-auto whitespace-normal"
          >
            {/* One direction for the whole table, taken from its first
                strong character: a Hebrew table orders its columns
                right-to-left and no single Latin cell ("NIS") flips
                out of its column. */}
            <table
              dir="auto"
              className="w-full min-w-[520px] border-collapse text-sm leading-normal font-sans"
            >
              <thead>
                <tr className="border-b border-[var(--color-rule)]">
                  {block.headers.map((header, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="px-3 py-2 text-start align-bottom font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)] font-normal"
                    >
                      {header.text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="border-b border-[var(--color-rule-subtle)] last:border-0"
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-3 py-2 align-top text-[var(--color-ink-secondary)]"
                      >
                        {cell.start === cell.end
                          ? cell.text
                          : renderInlineSegments({
                              segments,
                              start: cell.start,
                              end: cell.end,
                              firstMarkOffset,
                              firstMarkRef,
                              hrefPrefix,
                            })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
