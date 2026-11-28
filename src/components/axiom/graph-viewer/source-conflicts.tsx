"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Scale } from "lucide-react";
import "./source-conflicts.css";
// Type-only: the normalize module parses YAML, which stays out of the
// browser bundle.
import type { SourceConflict, SourceConflictText } from "@/lib/axiom/source-conflicts-normalize";
import { axiomAppUrl, axiomAppUrlForCitation } from "./citations";
import type { ProgramGraph } from "./types";

/**
 * Known source conflicts (the RuleSpec repos' known-source-conflicts.yaml
 * registers, served from encodings.source_conflicts): places where the
 * law's own sources disagree, the reading Axiom adopted, and the others.
 * A rule is marked when the provision it cites is, holds or lies inside a
 * provision an entry quotes.
 */

/** The route's limit on paths per request (MAX_CONFLICT_PATHS). */
const PATHS_PER_REQUEST = 200;
/** The route's limit on the paths parameter (MAX_CONFLICT_PATHS_PARAM). */
const CHARS_PER_REQUEST = 4000;

/** True when one path is the other or lies under it, on "/" boundaries. */
function citationPathsOverlap(a: string, b: string): boolean {
  const x = a.replace(/\/+$/, "");
  const y = b.replace(/\/+$/, "");
  return Boolean(x && y) && (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`));
}

/** The corpus citation path a rule's source names ("us/statute/26/32/a"),
 *  or its file's home when the citation does not narrow it. */
export function ruleCitationPath(fileLegalId: string, source: string | null | undefined): string | null {
  const href = axiomAppUrlForCitation(fileLegalId, source ?? null) ?? axiomAppUrl(fileLegalId);
  return href ? href.replace(/^\/+/, "") : null;
}

/** Per rule legal id, the conflicts its cited provision touches. */
export type ConflictIndex = ReadonlyMap<string, SourceConflict[]>;

export const ConflictIndexContext = createContext<ConflictIndex>(new Map());

export function useConflictsFor(legalId: string | null | undefined): SourceConflict[] {
  const index = useContext(ConflictIndexContext);
  return (legalId && index.get(legalId)) || [];
}

/** Load the conflicts for every rule in the graph: one request per 200
 *  distinct paths, nothing on failure (the graph renders the same). */
export function useConflictIndex(graph: ProgramGraph | null): ConflictIndex {
  const pathsByRule = useMemo(() => {
    const out = new Map<string, string>();
    for (const rule of graph?.rules ?? []) {
      const path = ruleCitationPath(rule.fileLegalId, rule.source);
      if (path) out.set(rule.legalId, path);
    }
    return out;
  }, [graph]);
  const [byPath, setByPath] = useState<Record<string, SourceConflict[]>>({});
  useEffect(() => {
    const paths = [...new Set(pathsByRule.values())].sort();
    if (!paths.length) { setByPath({}); return; }
    let cancelled = false;
    const chunks: string[][] = [];
    // Within the route's limits: 200 paths and 4000 characters a request.
    let chunk: string[] = [];
    let length = 0;
    for (const path of paths) {
      if (chunk.length && (chunk.length >= PATHS_PER_REQUEST || length + path.length + 1 > CHARS_PER_REQUEST)) {
        chunks.push(chunk);
        chunk = [];
        length = 0;
      }
      chunk.push(path);
      length += path.length + 1;
    }
    if (chunk.length) chunks.push(chunk);
    void Promise.allSettled(chunks.map(async (chunk) => {
      const res = await fetch(`/api/axiom/source-conflicts?paths=${encodeURIComponent(chunk.join(","))}`);
      if (!res.ok) return {};
      const body = await res.json() as { conflicts?: Record<string, SourceConflict[]> };
      return body.conflicts ?? {};
    })).then((results) => {
      if (cancelled) return;
      const merged: Record<string, SourceConflict[]> = {};
      for (const result of results) if (result.status === "fulfilled") Object.assign(merged, result.value);
      setByPath(merged);
    });
    return () => { cancelled = true; };
  }, [pathsByRule]);
  return useMemo(() => {
    const index = new Map<string, SourceConflict[]>();
    for (const [legalId, path] of pathsByRule) {
      const found = byPath[path];
      if (found?.length) index.set(legalId, found);
    }
    return index;
  }, [pathsByRule, byPath]);
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  ruled: "Ruled",
  confirmed: "Confirmed",
  contradicted: "Contradicted",
};

export function conflictStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/[-_]/g, " ");
}

/** A small mark for a rule whose cited provision has known conflicts. */
export function ConflictBadge({ conflicts, onClick }: { conflicts: SourceConflict[]; onClick?: () => void }) {
  if (!conflicts.length) return null;
  const open = conflicts.filter((conflict) => conflict.status === "open").length;
  const label = `${conflicts.length} known source ${conflicts.length === 1 ? "conflict" : "conflicts"}${open ? `, ${open} open` : ""}`;
  const content = <><Scale size={12} aria-hidden="true" />{conflicts.length === 1 ? "Source conflict" : `${conflicts.length} source conflicts`}</>;
  return onClick
    ? <button type="button" className={`source-conflict-badge${open ? " is-open" : ""}`} onClick={onClick} aria-label={label} title={label}>{content}</button>
    : <span className={`source-conflict-badge${open ? " is-open" : ""}`} aria-label={label} title={label}>{content}</span>;
}

/** The conflicts behind a rule, short, for the narrow inspector beside the
 *  graph: each question and its status, and one button that opens the
 *  Read view, where the quoted texts and the readings have room. */
export function SourceConflictSummary({ conflicts, onOpen }: { conflicts: SourceConflict[]; onOpen: () => void }) {
  if (!conflicts.length) return null;
  const ordered = [...conflicts].sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || a.globalId.localeCompare(b.globalId));
  return <section className="source-conflicts source-conflicts-summary" aria-label="Known source conflicts">
    <h3 title="The sources for this provision disagree. Axiom encodes one reading."><Scale size={14} aria-hidden="true" />Known source conflicts <span>{conflicts.length}</span></h3>
    <ul>
      {ordered.map((conflict) => <li key={conflict.globalId} data-status={conflict.status}>
        <span className="source-conflict-status">{conflictStatusLabel(conflict.status)}</span>
        <span className="source-conflict-question">{conflict.question}</span>
      </li>)}
    </ul>
    <button type="button" className="source-conflict-open" onClick={onOpen}>Read the sources and readings <ArrowUpRight size={13} aria-hidden="true" /></button>
  </section>;
}

/** The conflicts behind a rule. Each entry opens to the two sides of the
 *  question, short: the reading Axiom uses and the other readings. The
 *  basis, the ruling and the sources wait behind one more click. */
export function SourceConflictList({ conflicts, citationPath, id, defaultOpen = false }: { conflicts: SourceConflict[]; citationPath?: string | null; id?: string; defaultOpen?: boolean }) {
  if (!conflicts.length) return null;
  const ordered = [...conflicts].sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || a.globalId.localeCompare(b.globalId));
  return <section className="source-conflicts" id={id} aria-label="Known source conflicts">
    <h3 title="The sources for this provision disagree. Axiom encodes one reading."><Scale size={14} aria-hidden="true" />Known source conflicts <span>{conflicts.length}</span></h3>
    {ordered.map((conflict) => <SourceConflictEntry key={conflict.globalId} conflict={conflict} citationPath={citationPath ?? null} defaultOpen={defaultOpen} />)}
  </section>;
}

/** A quote this long or shorter shows whole. */
const WHOLE_QUOTE_CHARS = 300;

const STOPWORDS = new Set(("such that this with from which shall have been into under over than then there their them they what when where whether does upon only also other each more most must made make same both either does doesn't would could should about after before being between during under any all and are for not the use uses used its his her who whose our your".split(" ")));

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((word) => !STOPWORDS.has(word)));
}

/**
 * The part of a quote that bears on the question: the whole quote when it
 * is short; otherwise the paragraph (or, in one long paragraph, the
 * sentence) that shares the most words with the question and the
 * readings. Never a cut inside a sentence. `before` and `after` say
 * whether text of the quote lies outside the passage.
 */
export function keyPassage(excerpt: string, context: string): { text: string; before: boolean; after: boolean } {
  const whole = excerpt.trim();
  if (whole.length <= WHOLE_QUOTE_CHARS) return { text: whole, before: false, after: false };
  let parts = whole.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) parts = whole.split(/(?<=[.;:])\s+(?=[A-Z(])/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { text: whole, before: false, after: false };
  const wanted = words(context);
  let best = 0;
  let bestScore = -1;
  parts.forEach((part, index) => {
    // Shared words count; a passage too short to say anything counts less.
    const score = [...words(part)].filter((word) => wanted.has(word)).length - (part.length < 40 ? 2 : 0);
    if (score > bestScore) { best = index; bestScore = score; }
  });
  return { text: parts[best]!, before: best > 0, after: best < parts.length - 1 };
}

const KIND_LABEL: Record<string, string> = {
  statute: "Statute",
  regulation: "Regulation",
  instructions: "Form instructions",
  manual: "Agency manual",
  guidance: "Guidance",
  policy: "Policy",
};

function textKindLabel(kind: string | null): string {
  if (!kind) return "Source";
  return KIND_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/[-_]/g, " ");
}

/** The provision on screen first, then the first text of each other kind
 *  (a statute against form instructions shows both sides in the short
 *  view), then the rest in the register's order. */
function orderTexts(texts: SourceConflictText[], isHere: (path: string | null) => boolean): SourceConflictText[] {
  const here = texts.filter((item) => isHere(item.path));
  const rest = texts.filter((item) => !isHere(item.path));
  const kinds = new Set(here.map((item) => item.kind));
  const firstOfKind: SourceConflictText[] = [];
  const others: SourceConflictText[] = [];
  for (const item of rest) {
    if (kinds.has(item.kind)) others.push(item);
    else { kinds.add(item.kind); firstOfKind.push(item); }
  }
  return [...here, ...firstOfKind, ...others];
}

const PERIOD_LABEL: Record<string, string> = { once: "once", week: "a week", month: "a month", year: "a year" };

/** "4200.00" USD as "$4,200"; cents only when there are any. */
export function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** One quoted source: its key passage, and the whole quote on request. */
function SourceConflictQuote({ item, here, context }: { item: SourceConflictText; here: boolean; context: string }) {
  const [full, setFull] = useState(false);
  const href = item.path ? `/${item.path}` : item.url;
  const external = !item.path;
  const passage = item.excerpt ? keyPassage(item.excerpt, context) : null;
  const partial = Boolean(passage && (passage.before || passage.after));
  return <li className={`source-conflict-text${here ? " is-here" : ""}`}>
    <div className="source-conflict-text-head">
      <span className="source-conflict-kind">{textKindLabel(item.kind)}</span>
      {href
        ? <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{item.citation}{external && <ArrowUpRight size={11} aria-hidden="true" />}</a>
        : <span>{item.citation}</span>}
      {here && <span className="source-conflict-here">This provision</span>}
    </div>
    {passage && <blockquote className={full ? "is-full" : undefined}>
      {full ? item.excerpt : <>{passage.before && "… "}{passage.text}{passage.after && " …"}</>}
    </blockquote>}
    {partial && <button type="button" className="source-conflict-quote-toggle" onClick={() => setFull((value) => !value)} aria-expanded={full}>
      {full ? "Key passage only" : "Full text"}<ChevronDown size={12} aria-hidden="true" />
    </button>}
  </li>;
}

function SourceConflictEntry({ conflict, citationPath, defaultOpen }: { conflict: SourceConflict; citationPath: string | null; defaultOpen: boolean }) {
  const isHere = (path: string | null) => Boolean(path && citationPath && citationPathsOverlap(path, citationPath));
  const texts = orderTexts(conflict.texts ?? [], isHere);
  const alsoFollow = (reading: string) => (conflict.implementations ?? []).filter((item) => item.follows === reading).map((item) => item.by);
  // The words that say what the question is about, to find each quote's key passage.
  const context = [conflict.question, conflict.reading, ...conflict.alternatives.map((alternative) => alternative.reading)].join(" ");
  const money = conflict.moneyCase;
  const readings = [
    { id: "reading", text: conflict.reading, effect: null as string | null | undefined, adopted: true },
    ...conflict.alternatives.map((alternative) => ({ id: alternative.id, text: alternative.reading, effect: alternative.effect, adopted: false })),
  ];
  return <details className="source-conflict" data-status={conflict.status} open={defaultOpen || undefined}>
    <summary>
      <span className="source-conflict-status">{conflictStatusLabel(conflict.status)}</span>
      <span className="source-conflict-question">{conflict.question}</span>
    </summary>
    {texts.length > 0 && <>
      <h4 className="source-conflict-heading">What the sources say</h4>
      <ul className="source-conflict-texts">
        {texts.map((item, index) => <SourceConflictQuote key={`${index}:${item.path ?? item.citation}`} item={item} here={isHere(item.path)} context={context} />)}
      </ul>
    </>}
    <h4 className="source-conflict-heading">How they can be read</h4>
    <div className="source-conflict-readings">
      {readings.map((reading) => {
        const follow = alsoFollow(reading.id);
        return <div key={reading.id} className={`source-conflict-reading${reading.adopted ? " is-adopted" : ""}`}>
          <span className="source-conflict-reading-label">
            {reading.adopted ? <><Check size={11} aria-hidden="true" />Axiom uses</> : "Other reading"}
            {follow.length > 0 && <em>{reading.adopted ? "also " : ""}{follow.join(", ")}</em>}
          </span>
          <p>{reading.text}</p>
          {reading.effect && <p className="source-conflict-effect">{reading.effect}</p>}
        </div>;
      })}
    </div>
    {money && <div className="source-conflict-money">
      <h4 className="source-conflict-heading">Size of the difference</h4>
      <p className="source-conflict-money-amount">{formatMoney(money.amount, money.currency)} <span>{PERIOD_LABEL[money.period] ?? `per ${money.period}`}</span></p>
      <p>{money.description}</p>
      {money.computedBy && <p className="source-conflict-money-test">Computed by the pinned test <code>{money.computedBy}</code></p>}
    </div>}
    {(conflict.basis || conflict.ruling?.by) && <details className="source-conflict-why">
      <summary><ChevronDown size={12} aria-hidden="true" />Why Axiom uses this reading</summary>
      {conflict.basis && <p>{conflict.basis}</p>}
      {conflict.ruling?.by && <p className="source-conflict-ruling">Ruled by {conflict.ruling.by}{conflict.ruling.date ? `, ${conflict.ruling.date}` : ""}{conflict.ruling.record && <> · <a href={conflict.ruling.record} target="_blank" rel="noreferrer">record <ArrowUpRight size={11} aria-hidden="true" /></a></>}</p>}
    </details>}
    <div className="source-conflict-footer">
      <a className="source-conflict-register" href={conflict.sourceUrl} target="_blank" rel="noreferrer" title={`${conflict.globalId} in ${conflict.repo}`}>Register entry <ArrowUpRight size={11} aria-hidden="true" /></a>
    </div>
  </details>;
}
