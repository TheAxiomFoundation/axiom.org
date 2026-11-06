"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Scale } from "lucide-react";
import "./source-conflicts.css";
// Type-only: the normalize module parses YAML, which stays out of the
// browser bundle.
import type { SourceConflict } from "@/lib/axiom/source-conflicts-normalize";
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

/** The conflicts behind a rule: question, adopted reading, the other
 *  readings and the ruling, each linked to the public register. */
export function SourceConflictList({ conflicts, citationPath, id }: { conflicts: SourceConflict[]; citationPath?: string | null; id?: string }) {
  if (!conflicts.length) return null;
  const ordered = [...conflicts].sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || a.globalId.localeCompare(b.globalId));
  return <section className="source-conflicts" id={id} aria-label="Known source conflicts">
    <h3><Scale size={14} aria-hidden="true" />Known source conflicts <span>{conflicts.length}</span></h3>
    <p className="source-conflicts-note">The sources for this provision disagree. Axiom encodes the adopted reading.</p>
    {ordered.map((conflict) => {
      const exact = citationPath ? conflict.citationPaths.filter((path) => citationPathsOverlap(path, citationPath)) : [];
      return <details key={conflict.globalId} className="source-conflict" data-status={conflict.status}>
        <summary>
          <span className="source-conflict-status">{conflictStatusLabel(conflict.status)}</span>
          <span className="source-conflict-question">{conflict.question}</span>
        </summary>
        <dl>
          <div><dt>Adopted reading</dt><dd>{conflict.reading}</dd></div>
          {conflict.alternatives.map((alternative) => <div key={alternative.id}><dt>Other reading</dt><dd>{alternative.reading}{alternative.effect && <small>{alternative.effect}</small>}</dd></div>)}
          {conflict.basis && <div><dt>Basis</dt><dd>{conflict.basis}</dd></div>}
          {conflict.ruling?.by && <div><dt>Ruling</dt><dd>{conflict.ruling.by}{conflict.ruling.date ? `, ${conflict.ruling.date}` : ""}{conflict.ruling.record && <> · <a href={conflict.ruling.record} target="_blank" rel="noreferrer">record <ArrowUpRight size={11} aria-hidden="true" /></a></>}</dd></div>}
          {(exact.length > 0 || conflict.pendingCitations.length > 0) && <div><dt>Sources</dt><dd className="source-conflict-sources">
            {exact.map((path) => <a key={path} href={`/${path}`}>{path}</a>)}
            {conflict.pendingCitations.map((pending) => pending.url
              ? <a key={pending.citation} href={pending.url} target="_blank" rel="noreferrer">{pending.citation} <ArrowUpRight size={11} aria-hidden="true" /></a>
              : <span key={pending.citation}>{pending.citation}</span>)}
          </dd></div>}
        </dl>
        <a className="source-conflict-register" href={conflict.sourceUrl} target="_blank" rel="noreferrer">{conflict.globalId} in {conflict.repo} <ArrowUpRight size={11} aria-hidden="true" /></a>
      </details>;
    })}
  </section>;
}
