"use client";

import { ArrowLeft, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import dashboard from "./ops-dashboard.module.css";
import styles from "./program-bundle.module.css";
import { Explain } from "./ops-pipeline";
import { ageLabel, STAGE_COPY } from "@/lib/axiom/encoding-pipeline";
import {
  documentGroup,
  DOCUMENT_STATUSES,
  STATUS_LABELS,
  tierCounts,
  type BundleDocumentRow,
  type BundleRow,
  type BundleTierId,
  type DocumentStatus,
} from "@/lib/axiom/program-bundles";
import { squarify, type TreemapRect } from "@/lib/axiom/treemap";

type Filter = DocumentStatus | "excluded";

const number = (value: number) => value.toLocaleString("en-US");

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
 * One program bundle: each delivery tier's documents and how far each has
 * come, from the served corpus, the RuleSpec rule index and the encode runs.
 * Both tiers show at once: their status counts beside a map where every
 * document is a block sized by its provisions and filled by the share a rule
 * encodes. A block opens the document; the table below lists every document.
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
  const selectedRow = selected ? (byTier.get(selected.tier) ?? []).find((r) => r.key === selected.key) ?? null : null;
  const tableFilter = filter?.tier === tableTier ? filter.value : null;
  const tableRows = (byTier.get(tableTier) ?? []).filter((r) =>
    tableFilter === "excluded" ? r.scope === "excluded" : r.scope === "in" && (!tableFilter || r.status === tableFilter)
  );
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
                What each delivery tier holds, and how far each document has come.
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
                  {tableFilter ? `${tableFilter === "excluded" ? "Excluded" : STATUS_LABELS[tableFilter]} · ` : ""}
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

/**
 * A tier: its headline, one row per status (the map's legend and its
 * filters), and the map of its documents.
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
  const largest = Math.max(1, ...DOCUMENT_STATUSES.map((s) => counts.byStatus[s]));
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
          <strong>{number(counts.byStatus.encoded)}</strong> of {number(counts.documents)} documents encoded
          <span>
            {number(counts.encodedProvisions)} of {number(counts.provisions)} provisions with rules
          </span>
        </p>
      </div>
      <div className={styles.tierBody}>
        <div className={styles.tierSide}>
          <ul className={styles.statusRows} aria-label={`${title} by status`}>
            {DOCUMENT_STATUSES.map((status) => (
              <li key={status}>
                <button
                  type="button"
                  className={styles.statusRow}
                  aria-pressed={filter === status}
                  disabled={counts.byStatus[status] === 0}
                  onClick={() => onFilter(status)}
                >
                  <span className={styles.statusLabel}>{STATUS_LABELS[status]}</span>
                  <strong>{number(counts.byStatus[status])}</strong>
                  <span className={styles.statusTrack} aria-hidden>
                    <span
                      data-status={status}
                      style={{ width: `${(counts.byStatus[status] / largest) * 100}%` }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <dl className={styles.stats}>
            {counts.citedTotal > 0 && (
              <div>
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
        <ProvisionMap
          label={title}
          rows={inScope}
          filter={filter}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
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
 * (and the big gaps) stand out. A cell's fill is the share of its provisions
 * a rule encodes; a document the corpus does not hold is a small dashed cell.
 * A status filter dims the other cells.
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
      <div className={styles.treemap} style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }} role="group" aria-label={`${label}: documents by kind`}>
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
                const share = row.provisions ? row.encoded_provisions / row.provisions : 0;
                const status = row.status ? STATUS_LABELS[row.status] : "Excluded";
                return (
                  <button
                    key={row.key}
                    type="button"
                    className={styles.cell}
                    style={box(cell)}
                    data-status={row.status ?? undefined}
                    data-dim={filter && filter !== "excluded" && row.status !== filter ? true : undefined}
                    aria-pressed={row.key === selectedKey}
                    aria-label={`${row.name}: ${status}`}
                    title={`${row.name}\n${status}${
                      row.in_corpus ? ` · ${number(row.encoded_provisions)} of ${number(row.provisions)} provisions with rules` : ""
                    }`}
                    onClick={() => onSelect(row.key)}
                  >
                    <span className={styles.cellFill} style={{ width: `${share * 100}%` }} aria-hidden />
                    {cell.w >= LABEL_MIN_W && cell.h >= LABEL_MIN_H && <span className={styles.cellName}>{row.name}</span>}
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
      <figcaption className={styles.mapCaption}>
        Area: a document&apos;s provisions in the corpus. Fill: the share a rule encodes. Dashed: not in the corpus yet.
      </figcaption>
    </figure>
  );
}

/** The selected document, in a drawer: where it stands, what PolicyEngine cites in it, and its newest run. */
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
  const share = row.provisions ? row.encoded_provisions / row.provisions : 0;
  return (
    <aside className={styles.detail} aria-label="Document">
      <div className={styles.detailTop}>
        <p className={styles.detailStatus} data-status={row.status ?? undefined}>
          {row.status ? STATUS_LABELS[row.status] : "Excluded"}
        </p>
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
            Provisions with rules
            <span>
              {number(row.encoded_provisions)} of {number(row.provisions)}
            </span>
          </p>
          <div className={styles.meter} aria-hidden>
            <span style={{ width: `${share * 100}%` }} />
          </div>
          <p className={styles.detailNote}>
            {number(row.rules)} {row.rules === 1 ? "rule cites" : "rules cite"} this document.
          </p>
        </div>
      )}
      {!row.in_corpus && row.scope === "in" && (
        <p className={styles.detailNote}>
          {row.citation_path
            ? "The corpus does not serve this citation path yet."
            : "No corpus document holds this source yet: it needs a manifest and ingestion."}
        </p>
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
        In the bundle from {row.sources.map((s) => (s === "plan" ? "the plan" : "PolicyEngine references")).join(" and ") || "a source manifest"}
        {row.manifest && ` (${row.manifest})`}.
      </p>
    </aside>
  );
}

/** Every shown document as a row: the accessible view of the map, and the excluded list with reasons. */
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
                <th scope="col">Status</th>
                <th scope="col" className={styles.num}>
                  Provisions with rules
                </th>
                <th scope="col" className={styles.num}>
                  Runs
                </th>
                <th scope="col">Latest run</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
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
                  <td>
                    <span className={styles.status} data-status={row.status ?? undefined}>
                      <span className={styles.swatch} data-status={row.status ?? undefined} aria-hidden />
                      {row.status ? STATUS_LABELS[row.status] : "—"}
                    </span>
                  </td>
                  <td className={styles.num}>
                    {row.in_corpus ? `${number(row.encoded_provisions)} / ${number(row.provisions)}` : "—"}
                  </td>
                  <td className={styles.num}>{row.runs ? number(row.runs) : "—"}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
