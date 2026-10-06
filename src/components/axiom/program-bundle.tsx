"use client";

import { ArrowLeft, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import dashboard from "./ops-dashboard.module.css";
import styles from "./program-bundle.module.css";
import { Explain } from "./ops-pipeline";
import { ageLabel, STAGE_COPY } from "@/lib/axiom/encoding-pipeline";
import {
  documentGroup,
  PROVISION_LABELS,
  PROVISION_STATES,
  provisionCounts,
  STATUS_LABELS,
  tierCounts,
  type BundleDocumentRow,
  type BundleRow,
  type BundleTierId,
  type ProvisionState,
} from "@/lib/axiom/program-bundles";
import { squarify, type TreemapRect } from "@/lib/axiom/treemap";

/** What a tier's rows filter the map and the table to. */
type Filter = ProvisionState | "not_in_corpus" | "excluded";

const number = (value: number) => value.toLocaleString("en-US");

const FILTER_LABELS: Record<Filter, string> = {
  ...PROVISION_LABELS,
  not_in_corpus: "Not in the corpus yet",
  excluded: "Excluded",
};

/** Whether a document has anything the filter names. */
function matches(row: BundleDocumentRow, filter: Filter | null): boolean {
  if (filter === "excluded") return row.scope === "excluded";
  if (row.scope !== "in") return false;
  if (!filter) return true;
  if (filter === "not_in_corpus") return !row.in_corpus;
  return row.in_corpus && provisionCounts(row)[filter] > 0;
}

/** Map bands in reading order: federal law first, then guidance, then the state's own sources. */
const GROUP_ORDER = [
  "Federal statutes",
  "Federal regulations",
  "Federal manuals",
  "Federal guidance",
  "Federal forms",
  "Federal sources not in the corpus",
  "State statutes",
  "State regulations",
  "State manuals",
  "State state plans",
  "State guidance",
  "State sources not in the corpus",
];

const GROUP_LABELS: Record<string, string> = {
  "State state plans": "State plans",
  "Federal sources not in the corpus": "Federal sources the corpus does not hold yet",
  "State sources not in the corpus": "State sources the corpus does not hold yet",
};

/**
 * One program bundle: each delivery tier's documents and where every one of
 * their provisions stands, from the served corpus, the RuleSpec rule index
 * and the encode runs. Both tiers show at once: the provisions by state
 * beside a treemap where every document's area is its provisions and its fill
 * the states of those provisions. A cell opens the document; the table below
 * lists every document with its exact counts.
 */
export function ProgramBundle({
  bundle,
  documents,
  available,
  referenceMs,
}: {
  bundle: BundleRow | null;
  documents: BundleDocumentRow[];
  available: boolean;
  referenceMs: number;
}) {
  const tiers = bundle?.tiers ?? [];
  const [tableTier, setTableTier] = useState<BundleTierId>(tiers[0]?.id ?? "screener");
  const [filter, setFilter] = useState<{ tier: BundleTierId; value: Filter } | null>(null);
  const [selected, setSelected] = useState<{ tier: BundleTierId; key: string } | null>(null);

  const byTier = useMemo(() => {
    const out = new Map<BundleTierId, BundleDocumentRow[]>();
    for (const row of documents) out.set(row.tier, [...(out.get(row.tier) ?? []), row]);
    return out;
  }, [documents]);
  const selectedRow = selected ? ((byTier.get(selected.tier) ?? []).find((r) => r.key === selected.key) ?? null) : null;
  const tableFilter = filter?.tier === tableTier ? filter.value : null;
  const tableRows = (byTier.get(tableTier) ?? []).filter((r) => matches(r, tableFilter));
  const tableTitle = tiers.find((t) => t.id === tableTier)?.title ?? "";
  const collectedAt = documents[0]?.collected_at ?? bundle?.collected_at ?? null;

  const toggleFilter = (tier: BundleTierId, value: Filter) => {
    setFilter((current) => (current?.tier === tier && current.value === value ? null : { tier, value }));
    setTableTier(tier);
  };
  const select = (tier: BundleTierId, key: string) =>
    setSelected((current) => (current?.tier === tier && current.key === key ? null : { tier, key }));

  return (
    <div className={`${dashboard.dashboard} ${styles.page} min-h-screen pt-28 pb-16`}>
      <div className="max-w-[1180px] mx-auto px-5 md:px-10">
        <a href="/ops" className={styles.back}>
          <ArrowLeft size={13} aria-hidden /> Operations
        </a>
        <header className={dashboard.header}>
          <p className={dashboard.eyebrow}>Axiom / Operations / Bundles</p>
          <h1 className={styles.title}>{bundle?.title ?? "No bundle"}</h1>
          <p className={styles.summary}>
            {bundle ? (
              <>
                What each delivery tier holds, and where every provision stands.
                {collectedAt && ` Updated ${ageLabel(collectedAt, referenceMs) ?? "just now"} ago.`}
              </>
            ) : available ? (
              "No bundle file by this name on axiom-corpus main."
            ) : (
              "The bundle tables are not available yet."
            )}
          </p>
        </header>

        {tiers.map((tier, index) => (
          <TierSection
            key={tier.id}
            index={index + 1}
            title={tier.title}
            definition={tier.definition}
            notes={tier.notes}
            rows={byTier.get(tier.id) ?? []}
            filter={filter?.tier === tier.id ? filter.value : null}
            selectedKey={selected?.tier === tier.id ? selected.key : null}
            onFilter={(value) => toggleFilter(tier.id, value)}
            onSelect={(key) => select(tier.id, key)}
          />
        ))}

        {tiers.length > 0 && (
          <section className={styles.panel} aria-labelledby="bundle-documents">
            <div className={styles.panelHead}>
              <h2 id="bundle-documents">
                Documents
                <span className={styles.panelCount}>
                  {tableFilter ? `${FILTER_LABELS[tableFilter]} · ` : ""}
                  {number(tableRows.length)}
                </span>
              </h2>
              <div className={styles.tableTabs} role="tablist" aria-label="Tier">
                {tiers.map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    role="tab"
                    aria-selected={tier.id === tableTier}
                    onClick={() => setTableTier(tier.id)}
                  >
                    {tier.title}
                  </button>
                ))}
                {tableFilter && (
                  <button type="button" className={styles.clear} onClick={() => setFilter(null)}>
                    Show all
                  </button>
                )}
              </div>
            </div>
            <DocumentTable
              title={tableTitle}
              rows={tableRows}
              excluded={tableFilter === "excluded"}
              selectedKey={selected?.tier === tableTier ? selected.key : null}
              onSelect={(key) => select(tableTier, key)}
              referenceMs={referenceMs}
            />
          </section>
        )}
      </div>
      {selectedRow && <DocumentDetail row={selectedRow} referenceMs={referenceMs} onClose={() => setSelected(null)} />}
    </div>
  );
}

function groupRows(rows: BundleDocumentRow[]): Array<[string, BundleDocumentRow[]]> {
  const groups = new Map<string, BundleDocumentRow[]>();
  for (const row of rows) {
    const group = documentGroup(row);
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
    .map(([group, members]) => [group, members.sort((a, b) => b.provisions - a.provisions || a.name.localeCompare(b.name))]);
}

/** A bar split by provision state, in state order; the states add up to the whole. */
function StateBar({ counts, total, className }: { counts: Record<ProvisionState, number>; total: number; className?: string }) {
  return (
    <span className={`${styles.stateBar} ${className ?? ""}`} aria-hidden>
      {PROVISION_STATES.map((state) =>
        counts[state] > 0 ? <span key={state} data-state={state} style={{ width: `${(counts[state] / total) * 100}%` }} /> : null
      )}
    </span>
  );
}

/**
 * A tier: how many of its provisions are encoded, one row per provision
 * state (the map's legend and its filters), the documents the corpus does not
 * hold yet, and the map of its documents.
 */
function TierSection({
  index,
  title,
  definition,
  notes,
  rows,
  filter,
  selectedKey,
  onFilter,
  onSelect,
}: {
  index: number;
  title: string;
  definition: string;
  notes?: string[];
  rows: BundleDocumentRow[];
  filter: Filter | null;
  selectedKey: string | null;
  onFilter: (value: Filter) => void;
  onSelect: (key: string) => void;
}) {
  const counts = tierCounts(rows);
  const inScope = rows.filter((r) => r.scope === "in");
  const total = Math.max(1, counts.provisions);
  const id = `tier-${index}`;
  return (
    <section className={styles.tier} aria-labelledby={id}>
      <div className={styles.tierHead}>
        <p className={styles.tierIndex}>Tier {index}</p>
        <h2 id={id}>{title}</h2>
        <Explain label={title}>
          {definition}
          {notes?.map((note) => (
            <span key={note} className={styles.explainLine}>
              {note}
            </span>
          ))}
        </Explain>
        <p className={styles.headline}>
          <strong>{number(counts.byProvisionState.encoded)}</strong> of {number(counts.provisions)} provisions encoded
          <span>
            {number(counts.byStatus.encoded)} of {number(counts.documents)} documents complete
          </span>
        </p>
      </div>
      <div className={styles.tierBody}>
        <div className={styles.tierSide}>
          <p className={styles.sideLabel}>
            Provisions
            <Explain label="Provision states">
              Every provision of a document the corpus holds is in one state. Encoded: a rule in the index cites it, or
              its latest run reached the index. In progress: its latest run is running, waiting for approval, in
              review, or merged and waiting for the index. Failed: its latest run failed, or its PR closed or merged
              into another branch. Not started: no rule and no run.
            </Explain>
          </p>
          <StateBar counts={counts.byProvisionState} total={total} className={styles.tierBar} />
          <ul className={styles.statusRows} aria-label={`${title} provisions by state`}>
            {PROVISION_STATES.map((state) => (
              <li key={state}>
                <button
                  type="button"
                  className={styles.statusRow}
                  aria-pressed={filter === state}
                  disabled={counts.byProvisionState[state] === 0}
                  onClick={() => onFilter(state)}
                >
                  <span className={styles.swatch} data-state={state} aria-hidden />
                  <span className={styles.statusLabel}>{PROVISION_LABELS[state]}</span>
                  <strong>{number(counts.byProvisionState[state])}</strong>
                  <span className={styles.statusShare}>
                    {Math.round((counts.byProvisionState[state] / total) * 100)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <dl className={styles.stats}>
            <div>
              <dt>
                Documents not in the corpus yet
                <Explain label="Documents not in the corpus yet">
                  The corpus does not hold these documents, so their provisions are not counted above. Each needs a
                  source manifest and ingestion first.
                </Explain>
              </dt>
              <dd>
                <button
                  type="button"
                  className={styles.link}
                  aria-pressed={filter === "not_in_corpus"}
                  disabled={counts.byStatus.not_in_corpus === 0}
                  onClick={() => onFilter("not_in_corpus")}
                >
                  {number(counts.byStatus.not_in_corpus)}
                </button>
              </dd>
            </div>
            {counts.citedTotal > 0 && (
              <div className={styles.statWide}>
                <dt>
                  PolicyEngine-cited provisions
                  <Explain label="PolicyEngine-cited provisions">
                    The provisions PolicyEngine-US cites in these documents. Encoded: a rule encodes the provision or
                    one below it. Inside: a rule encodes only a provision above it (for example the whole section),
                    which may or may not carry it.
                  </Explain>
                </dt>
                <dd>
                  {number(counts.citedCovered)} encoded · {number(counts.citedWithin)} inside ·{" "}
                  {number(counts.citedTotal - counts.citedCovered - counts.citedWithin)} not encoded
                </dd>
              </div>
            )}
            <div>
              <dt>Excluded with a reason</dt>
              <dd>
                <button
                  type="button"
                  className={styles.link}
                  aria-pressed={filter === "excluded"}
                  disabled={counts.excluded === 0}
                  onClick={() => onFilter("excluded")}
                >
                  {number(counts.excluded)} {counts.excluded === 1 ? "document" : "documents"}
                </button>
              </dd>
            </div>
          </dl>
        </div>
        <ProvisionMap label={title} rows={inScope} filter={filter} selectedKey={selectedKey} onSelect={onSelect} />
      </div>
    </section>
  );
}

/** The treemap's own units: 1000 wide, laid out for a 16:9-ish box. */
const MAP_W = 1000;
const MAP_H = 560;
const BAND_HEAD = 26;
const BAND_GAP = 3;
/** A cell names its document only when the name has room to read (about 55 by 24 px on a wide screen). */
const LABEL_MIN_W = 90;
const LABEL_MIN_H = 40;

/** A document's area: its provisions; one the corpus does not hold gets a small fixed size. */
const mapWeight = (row: BundleDocumentRow) => (row.in_corpus ? Math.max(row.provisions, 2) : 4);

const box = (r: TreemapRect) => ({
  left: `${(r.x / MAP_W) * 100}%`,
  top: `${(r.y / MAP_H) * 100}%`,
  width: `${(r.w / MAP_W) * 100}%`,
  height: `${(r.h / MAP_H) * 100}%`,
});

/**
 * The tier's documents as a treemap: a band per kind of source, and in it a
 * cell per document whose area follows its provisions, so the big documents
 * (and the big gaps) stand out. A cell's fill splits by its provisions'
 * states; a document the corpus does not hold is a small dashed cell. A
 * filter dims the documents with nothing in the filtered state.
 */
function ProvisionMap({
  label,
  rows,
  filter,
  selectedKey,
  onSelect,
}: {
  label: string;
  rows: BundleDocumentRow[];
  filter: Filter | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const groups = groupRows(rows);
  const bands = squarify(
    groups.map(([group, members]) => ({ weight: members.reduce((sum, r) => sum + mapWeight(r), 0), item: { group, members } })),
    { x: 0, y: 0, w: MAP_W, h: MAP_H }
  );
  if (!bands.length) return <p className={styles.empty}>No documents in scope.</p>;
  return (
    <figure className={styles.mapFigure}>
      <div
        className={styles.treemap}
        style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}
        role="group"
        aria-label={`${label}: documents by kind`}
      >
        {bands.map((band) => {
          const head = band.h > BAND_HEAD * 2 ? BAND_HEAD : 0;
          const cells = squarify(
            band.item.members.map((row) => ({ weight: mapWeight(row), item: row })),
            { x: band.x + BAND_GAP, y: band.y + head, w: band.w - BAND_GAP * 2, h: band.h - head - BAND_GAP }
          );
          return (
            <Fragment key={band.item.group}>
              <div className={styles.band} style={box(band)}>
                {head > 0 && (
                  <span className={styles.bandLabel}>
                    {GROUP_LABELS[band.item.group] ?? band.item.group}
                    <span>{number(band.item.members.length)}</span>
                  </span>
                )}
              </div>
              {cells.map((cell) => {
                const row = cell.item;
                const states = provisionCounts(row);
                const summary = row.in_corpus
                  ? PROVISION_STATES.filter((s) => states[s] > 0)
                      .map((s) => `${number(states[s])} ${PROVISION_LABELS[s].toLowerCase()}`)
                      .join(" · ")
                  : STATUS_LABELS.not_in_corpus;
                return (
                  <button
                    key={row.key}
                    type="button"
                    className={styles.cell}
                    style={box(cell)}
                    data-corpus={row.in_corpus ? undefined : "missing"}
                    data-dim={filter && filter !== "excluded" && !matches(row, filter) ? true : undefined}
                    aria-pressed={row.key === selectedKey}
                    aria-label={`${row.name}: ${summary}`}
                    title={`${row.name}\n${summary}`}
                    onClick={() => onSelect(row.key)}
                  >
                    {row.in_corpus && <StateBar counts={states} total={Math.max(1, row.provisions)} className={styles.cellFill} />}
                    {cell.w >= LABEL_MIN_W && cell.h >= LABEL_MIN_H && <span className={styles.cellName}>{row.name}</span>}
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
      <figcaption className={styles.mapCaption}>
        Area: a document&apos;s provisions in the corpus. Fill: its provisions by state. Dashed: not in the corpus yet.
      </figcaption>
    </figure>
  );
}

/** The selected document, in a drawer: its provisions by state, what PolicyEngine cites in it, and its open runs. */
function DocumentDetail({
  row,
  referenceMs,
  onClose,
}: {
  row: BundleDocumentRow;
  referenceMs: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const states = provisionCounts(row);
  return (
    <aside className={styles.detail} aria-label="Document">
      <div className={styles.detailTop}>
        <p className={styles.detailStatus}>{row.status ? STATUS_LABELS[row.status] : "Excluded"}</p>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <h3 className={styles.detailName}>{row.name}</h3>
      {row.citation_path ? (
        row.in_corpus ? (
          <a className={styles.detailPath} href={`/${row.citation_path}`}>
            {row.citation_path}
          </a>
        ) : (
          <p className={styles.detailPath}>{row.citation_path}</p>
        )
      ) : (
        row.source_url && (
          <a className={styles.detailPath} href={row.source_url} target="_blank" rel="noreferrer">
            {row.source_url}
          </a>
        )
      )}

      {row.in_corpus && (
        <div className={styles.detailBlock}>
          <p className={styles.detailLabel}>
            Provisions<span>{number(row.provisions)}</span>
          </p>
          <StateBar counts={states} total={Math.max(1, row.provisions)} className={styles.meter} />
          <ul className={styles.detailStates}>
            {PROVISION_STATES.map((state) => (
              <li key={state}>
                <span className={styles.swatch} data-state={state} aria-hidden />
                {PROVISION_LABELS[state]}
                <strong>{number(states[state])}</strong>
              </li>
            ))}
          </ul>
          <p className={styles.detailNote}>
            {number(row.rules)} {row.rules === 1 ? "rule cites" : "rules cite"} this document.
          </p>
        </div>
      )}
      {!row.in_corpus && row.scope === "in" && (
        <p className={styles.detailNote}>
          {row.citation_path
            ? "The corpus does not serve this citation path yet."
            : "No corpus document holds this source yet: it needs a source manifest and ingestion."}
        </p>
      )}

      {row.open_provisions.length > 0 && (
        <div className={styles.detailBlock}>
          <p className={styles.detailLabel}>
            Open runs<span>{number(row.open_provisions.length)}</span>
          </p>
          <ul className={styles.openList}>
            {row.open_provisions.map((p) => (
              <li key={p.path} data-state={p.state}>
                <span className={styles.swatch} data-state={p.state} aria-hidden />
                <a href={`/ops/journey?citation=${encodeURIComponent(p.citation)}`} className={styles.citedPath}>
                  {p.path.slice((row.citation_path ?? "").length) || p.path}
                </a>
                <span className={styles.citedState}>
                  {STAGE_COPY[p.stage].label} · {ageLabel(p.at, referenceMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.cited.length > 0 && (
        <div className={styles.detailBlock}>
          <p className={styles.detailLabel}>
            PolicyEngine cites
            <span>
              {number(row.cited_covered)} encoded · {number(row.cited_within)} inside of {number(row.cited_total)}
            </span>
          </p>
          <ul className={styles.citedList}>
            {row.cited.map((c) => (
              <li key={c.path} data-state={c.state}>
                <span aria-hidden className={styles.citedMark} />
                <span className={styles.citedPath}>{c.path.slice((row.citation_path ?? "").length) || c.path}</span>
                <span className={styles.citedState}>
                  {c.state === "encoded" ? "encoded" : c.state === "within" ? "inside" : "not encoded"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.detailBlock}>
        <p className={styles.detailLabel}>
          Encode runs<span>{number(row.runs)}</span>
        </p>
        {row.latest_stage && row.latest_citation ? (
          <p className={styles.detailNote}>
            Latest {ageLabel(row.latest_run_at, referenceMs) ?? ""} ago ·{" "}
            <a href={`/ops/journey?citation=${encodeURIComponent(row.latest_citation)}`}>
              {STAGE_COPY[row.latest_stage].label}
            </a>
          </p>
        ) : (
          <p className={styles.detailNote}>No targeted encode run yet.</p>
        )}
      </div>

      <p className={styles.detailSources}>
        In the bundle from{" "}
        {row.sources.map((s) => (s === "plan" ? "the plan" : "PolicyEngine references")).join(" and ") ||
          "a source manifest"}
        {row.manifest && ` (${row.manifest})`}.
      </p>
    </aside>
  );
}

/** Every shown document as a row with its exact provision counts, or the excluded list with reasons. */
function DocumentTable({
  title,
  rows,
  excluded,
  selectedKey,
  onSelect,
  referenceMs,
}: {
  title: string;
  rows: BundleDocumentRow[];
  excluded: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  referenceMs: number;
}) {
  const sorted = [...rows].sort((a, b) =>
    excluded
      ? (a.reason ?? "").localeCompare(b.reason ?? "") || a.name.localeCompare(b.name)
      : GROUP_ORDER.indexOf(documentGroup(a)) - GROUP_ORDER.indexOf(documentGroup(b)) || a.name.localeCompare(b.name)
  );
  const totals = rows.reduce(
    (sum, row) => {
      const states = provisionCounts(row);
      for (const state of PROVISION_STATES) sum[state] += row.in_corpus ? states[state] : 0;
      return sum;
    },
    { encoded: 0, in_progress: 0, failed: 0, not_started: 0 } as Record<ProvisionState, number>
  );
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label={`${title} documents`}>
        <thead>
          <tr>
            <th scope="col">Document</th>
            {excluded ? (
              <th scope="col">Why it is excluded</th>
            ) : (
              <>
                {PROVISION_STATES.map((state) => (
                  <th key={state} scope="col" className={styles.num}>
                    <span className={styles.swatch} data-state={state} aria-hidden /> {PROVISION_LABELS[state]}
                  </th>
                ))}
                <th scope="col">Latest run</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const states = provisionCounts(row);
            return (
              <tr key={row.key} aria-selected={row.key === selectedKey}>
                <th scope="row">
                  {excluded ? (
                    <span className={styles.rowName}>{row.name}</span>
                  ) : (
                    <button type="button" className={styles.rowName} onClick={() => onSelect(row.key)}>
                      {row.name}
                    </button>
                  )}
                </th>
                {excluded ? (
                  <td>{row.reason ?? "—"}</td>
                ) : (
                  <>
                    {row.in_corpus ? (
                      PROVISION_STATES.map((state) => (
                        <td key={state} className={styles.num} data-zero={states[state] === 0 ? true : undefined}>
                          {number(states[state])}
                        </td>
                      ))
                    ) : (
                      <td colSpan={PROVISION_STATES.length} className={styles.notHeld}>
                        Not in the corpus yet
                      </td>
                    )}
                    <td>
                      {row.latest_stage && row.latest_citation ? (
                        <a href={`/ops/journey?citation=${encodeURIComponent(row.latest_citation)}`}>
                          {STAGE_COPY[row.latest_stage].label}
                          <span className={styles.age}> · {ageLabel(row.latest_run_at, referenceMs)}</span>
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
        {!excluded && rows.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {PROVISION_STATES.map((state) => (
                <td key={state} className={styles.num}>
                  {number(totals[state])}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
