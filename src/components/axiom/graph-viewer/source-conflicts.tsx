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

/** The conflicts behind a rule. Each entry opens to the two sides of the
 *  question, short: the reading Axiom uses and the other readings. The
 *  basis, the ruling and the sources wait behind one more click. */
export function SourceConflictList({ conflicts, citationPath, id }: { conflicts: SourceConflict[]; citationPath?: string | null; id?: string }) {
  if (!conflicts.length) return null;
  const ordered = [...conflicts].sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || a.globalId.localeCompare(b.globalId));
  return <section className="source-conflicts" id={id} aria-label="Known source conflicts">
    <h3 title="The sources for this provision disagree. Axiom encodes one reading."><Scale size={14} aria-hidden="true" />Known source conflicts <span>{conflicts.length}</span></h3>
    {ordered.map((conflict) => <SourceConflictEntry key={conflict.globalId} conflict={conflict} citationPath={citationPath ?? null} />)}
  </section>;
}

/** Texts shown before "Full text": enough to see the disagreement. */
const TEXTS_SHOWN = 3;

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

function SourceConflictEntry({ conflict, citationPath }: { conflict: SourceConflict; citationPath: string | null }) {
  const [full, setFull] = useState(false);
  const isHere = (path: string | null) => Boolean(path && citationPath && citationPathsOverlap(path, citationPath));
  const texts = orderTexts(conflict.texts ?? [], isHere);
  const shown = full ? texts : texts.slice(0, TEXTS_SHOWN);
  const hidden = texts.length - shown.length;
  const alsoFollow = (reading: string) => (conflict.implementations ?? []).filter((item) => item.follows === reading).map((item) => item.by);
  const more = [hidden > 0 ? `${hidden} more ${hidden === 1 ? "source" : "sources"}` : null, conflict.basis ? "why" : null].filter(Boolean);
  return <details className={`source-conflict${full ? " is-full" : ""}`} data-status={conflict.status}>
    <summary>
      <span className="source-conflict-status">{conflictStatusLabel(conflict.status)}</span>
      <span className="source-conflict-question">{conflict.question}</span>
    </summary>
    {shown.length > 0 && <>
      <h4 className="source-conflict-heading">What the sources say</h4>
      <ul className="source-conflict-texts">
        {shown.map((item) => {
          const href = item.path ? `/${item.path}` : item.url;
          const external = !item.path;
          return <li key={`${item.path ?? item.citation}`} className={`source-conflict-text${isHere(item.path) ? " is-here" : ""}`}>
            <div className="source-conflict-text-head">
              <span className="source-conflict-kind">{textKindLabel(item.kind)}</span>
              {href
                ? <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{item.citation}{external && <ArrowUpRight size={11} aria-hidden="true" />}</a>
                : <span>{item.citation}</span>}
              {isHere(item.path) && <span className="source-conflict-here">This provision</span>}
            </div>
            {item.excerpt && <blockquote>{item.excerpt}</blockquote>}
          </li>;
        })}
      </ul>
    </>}
    <h4 className="source-conflict-heading">How they can be read</h4>
    <div className="source-conflict-readings">
      <div className="source-conflict-reading is-adopted">
        <span className="source-conflict-reading-label"><Check size={11} aria-hidden="true" />Axiom uses{alsoFollow("reading").length > 0 && <em>also {alsoFollow("reading").join(", ")}</em>}</span>
        <p>{conflict.reading}</p>
      </div>
      {conflict.alternatives.map((alternative) => <div key={alternative.id} className="source-conflict-reading">
        <span className="source-conflict-reading-label">Other reading{alsoFollow(alternative.id).length > 0 && <em>{alsoFollow(alternative.id).join(", ")}</em>}</span>
        <p>{alternative.reading}</p>
        {alternative.effect && <p className="source-conflict-effect">{alternative.effect}</p>}
      </div>)}
    </div>
    {full && (conflict.basis || conflict.ruling?.by) && <dl className="source-conflict-more">
      {conflict.basis && <div><dt>Why Axiom uses this reading</dt><dd>{conflict.basis}</dd></div>}
      {conflict.ruling?.by && <div><dt>Ruling</dt><dd>{conflict.ruling.by}{conflict.ruling.date ? `, ${conflict.ruling.date}` : ""}{conflict.ruling.record && <> · <a href={conflict.ruling.record} target="_blank" rel="noreferrer">record <ArrowUpRight size={11} aria-hidden="true" /></a></>}</dd></div>}
    </dl>}
    <div className="source-conflict-footer">
      <button type="button" onClick={() => setFull((value) => !value)} aria-expanded={full}>
        {full ? "Show less" : `Full text${more.length ? `, ${more.join(" and ")}` : ""}`}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <a className="source-conflict-register" href={conflict.sourceUrl} target="_blank" rel="noreferrer" title={`${conflict.globalId} in ${conflict.repo}`}>Register entry <ArrowUpRight size={11} aria-hidden="true" /></a>
    </div>
  </details>;
}
