"use client";

import { useEffect, useMemo, useState } from "react";
import { CORE_SCHEMA, load } from "js-yaml";
import { LoaderCircle } from "lucide-react";
import { peekReader, readReader } from "./reader-cache";
import { humanizeRuleName } from "./citations";

type Fields = Record<string, unknown>;
const record = (value: unknown): Fields | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : null;
const present = (value: unknown) => value !== null && value !== undefined && value !== "";
const text = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value);

export function selectedMetadata(content: string, id: string): Fields | null {
  const name = id.includes("#") ? id.split("#").at(-1) : null;
  if (!name) return null;
  try {
    const doc = record(load(content, { schema: CORE_SCHEMA }));
    // Only an exact, unique definition belongs to this node. Never use the
    // enclosing module summary or a similarly named sibling as its description.
    const matches = [doc?.rules, doc?.inputs, doc?.relations].flatMap(items => Array.isArray(items) ? items.filter(item => record(item)?.name === name) : []);
    return matches.length === 1 ? record(matches[0]) : null;
  } catch { return null; }
}

const blank = (value: unknown) => !present(value) || (Array.isArray(value) && value.length === 0) || (record(value) !== null && Object.keys(value as Fields).length === 0);

// The raw fields as a tree rather than a YAML/JSON dump: nesting is drawn by
// guides instead of leading spaces, so a value that wraps in the narrow
// inspector keeps its indent instead of restarting at the left edge.
function MetadataTree({ value }: { value: Fields | unknown[] }) {
  const entries: Array<[string | null, unknown]> = Array.isArray(value) ? value.map(item => [null, item]) : Object.entries(value);
  return <div className="metadata-tree">{entries.map(([name,item],index) => <MetadataEntry key={name ?? index} name={name} value={item} />)}</div>;
}

// Ids and paths break after "/" or "#" before they break mid-word.
const breakable = (value: string) => value.split(/(?<=[/#])/).flatMap((part, index) => index ? [<wbr key={index} />, part] : [part]);

function MetadataEntry({ name, value }: { name: string | null; value: unknown }) {
  const item = name === null ? " metadata-tree-item" : "";
  const key = name === null ? null : <span className="metadata-tree-key">{name}:</span>;
  if (!blank(value) && (Array.isArray(value) || record(value))) return <div className={`metadata-tree-entry${item}`}>{key}<MetadataTree value={value as Fields | unknown[]} /></div>;
  if (typeof value === "string" && value.includes("\n")) return <div className={`metadata-tree-entry${item}`}>{key}<pre>{value}</pre></div>;
  return <div className={`metadata-tree-entry metadata-tree-leaf${item}`}>{key}{key && " "}{blank(value) ? <span className="metadata-tree-empty">{Array.isArray(value) || record(value) ? "none" : "—"}</span> : <span>{breakable(text(value))}</span>}</div>;
}

export function NodeMetadata({ id, entry = {}, content }: { id: string; entry?: object; content?: string }) {
  const fallback = entry as Fields;
  const root = typeof fallback.fileLegalId === "string" ? fallback.fileLegalId : id.split("#")[0];
  const url = `/api/axiom/rulespec?root=${encodeURIComponent(root)}`;
  const [loaded, setLoaded] = useState<{url: string; content?: string; failed?: boolean} | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cached = peekReader(url) as { content?: string } | undefined;
  const definition = content ?? cached?.content ?? (loaded?.url === url ? loaded.content : undefined);
  const failed = loaded?.url === url && loaded.failed;
  useEffect(() => {
    if (content !== undefined) return;
    let cancelled = false;
    readReader(url).then(value => {
      const source = (value as {content?: unknown})?.content;
      if (!cancelled) setLoaded({url, content: typeof source === "string" ? source : undefined, failed: typeof source !== "string"});
    }).catch(() => { if (!cancelled) setLoaded({url, failed:true}); });
    return () => { cancelled = true; };
  }, [url, content, attempt]);
  const node = useMemo(() => definition === undefined ? null : selectedMetadata(definition, id), [definition, id]);
  const metadata = record(node?.metadata);
  const description = [node?.description, node?.summary, metadata?.description, metadata?.summary].find(value => typeof value === "string" && value.trim());
  const value = (key: string) => node?.[key] ?? fallback[key];
  const rows: Array<[string, unknown]> = [
    ["Entity", value("entity")], ["Value type", value("dtype")], ["Unit", value("unit")], ["Period", value("period")],
    ["Declared default", node?.default], ["Allowed choices", node?.choices ?? node?.enum ?? metadata?.choices],
    ["Source", value("source")], ["Verification status", fallback.certificationStatus],
    ["Certificate", fallback.certificateId], ["Incomplete by declaration", fallback.incompleteByDeclaration],
  ];
  const versions = Array.isArray(node?.versions) ? node.versions.map(record).filter((item): item is Fields => !!item) : [];
  const dates = versions.filter(version => present(version.effective_from) || present(version.effective_to));
  const relation = record(node?.data_relation);
  if (relation) rows.push(["Relationship", relation.predicate], ["Arity", relation.arity]);
  if (dates.length > 0) rows.push(["Encoded effective dates", dates.map(version => `${present(version.effective_from) ? text(version.effective_from) : "Start unspecified"}${present(version.effective_to) ? ` to ${text(version.effective_to)}` : " · no end specified"}`).join("\n")]);
  // Short facts pair up across the grid; a long value takes a whole row so it
  // wraps in its own cell rather than squeezing beside a neighbour. Short rows
  // come first so reading order and visual order stay the same.
  const visible = rows.filter(([,value]) => present(value)).map(([label,value]) => ({ label, value: text(value), wide: text(value).split("\n").some(line => line.length > 16) }));
  const ordered = [...visible.filter(row => !row.wide), ...visible.filter(row => row.wide)];
  return <section className="node-metadata" aria-label="Details">
    <h3>Details</h3>
    {typeof description === "string" && <p className="node-metadata-description">{String(description)}<small>Description from encoding</small></p>}
    {ordered.length > 0 && <dl>{ordered.map(({label,value,wide}) => <div key={label} className={wide ? "node-metadata-wide" : undefined}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {definition === undefined && !failed && <span className="node-metadata-loading" role="status"><LoaderCircle size={14} />Loading metadata…</span>}
    {failed && <p className="node-metadata-note">Encoding metadata could not be loaded. <button onClick={() => { setLoaded(null); setAttempt(value => value + 1); }}>Retry</button></p>}
    {definition !== undefined && !node && <p className="node-metadata-note">No exact standalone definition was found for this node. Showing available graph metadata.</p>}
    <details><summary>All metadata</summary>
      {node && <><h4>Published encoding</h4><div className="node-metadata-raw"><MetadataTree value={node} /></div></>}
      <h4>Loaded graph</h4><div className="node-metadata-raw"><MetadataTree value={{ ...fallback, legalId:id }} /></div>
    </details>
  </section>;
}
