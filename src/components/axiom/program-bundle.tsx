"use client";

import { ArrowLeft, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import dashboard from "./ops-dashboard.module.css";
import styles from "./program-bundle.module.css";
import { Explain } from "./ops-pipeline";
import { ageLabel, STAGE_COPY } from "@/lib/axiom/encoding-pipeline";
import {
  DOCUMENT_STATUSES,
  PROVISION_LABELS,
  PROVISION_STATES,
  provisionCounts,
  STATUS_LABELS,
  tierCounts,
  UNIT_LABELS,
  UNIT_STATES,
  type BundleDocumentRow,
  type BundleRow,
  type BundleTierId,
  type DocumentStatus,
  type ParityUnit,
  type ProvisionState,
  type UnitState,
} from "@/lib/axiom/program-bundles";

const number = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/** Provision states as the table's column heads. */
const SHORT_LABELS: Record<ProvisionState, string> = {
  encoded: "Encoded",
  partly: "Partly",
  in_progress: "Running",
  failed: "Failed",
  not_started: "To do",
};

/**
 * One state scale for both tiers: a cited provision's state in the screener
 * tier, a section's status in the full bundle. The bar and legend use these.
 */
type Shade = "encoded" | "partly" | "in_progress" | "failed" | "none" | "missing";
const SHADES: Shade[] = ["encoded", "partly", "in_progress", "failed", "none", "missing"];
const SHADE_LABELS: Record<Shade, string> = {
  encoded: "Encoded",
  partly: "Partly encoded",
  in_progress: "In progress",
  failed: "Failed",
  none: "Not encoded yet",
  missing: "Not in the corpus",
};
const UNIT_SHADE: Record<UnitState, Shade> = {
  encoded: "encoded",
  partly: "partly",
  in_progress: "in_progress",
  failed: "failed",
  not_encoded: "none",
  not_in_corpus: "missing",
};
const STATUS_SHADE: Record<DocumentStatus, Shade> = {
  complete: "encoded",
  partly: "partly",
  not_started: "none",
  not_in_corpus: "missing",
};

/** One cell of the matrix: a part of the program in one tier. */
interface Cell {
  tier: BundleTierId;
  part: string;
  units: ParityUnit[];
  documents: BundleDocumentRow[];
  shades: Record<Shade, number>;
  done: number;
  total: number;
}

function cellOf(tier: BundleTierId, part: string, rows: BundleDocumentRow[]): Cell {
  const shades = Object.fromEntries(SHADES.map((s) => [s, 0])) as Record<Shade, number>;
  if (tier === "screener") {
    const units = rows.flatMap((r) => r.units).filter((u) => u.part === part);
    for (const unit of units) shades[UNIT_SHADE[unit.state]]++;
    return { tier, part, units, documents: [], shades, done: shades.encoded, total: units.length };
  }
  const documents = rows.filter((r) => r.part === part);
  for (const row of documents) if (row.status) shades[STATUS_SHADE[row.status]]++;
  return { tier, part, units: [], documents, shades, done: shades.encoded, total: documents.length };
}

type Selection =
  | { kind: "cell"; tier: BundleTierId; part: string }
  | { kind: "unit"; tier: BundleTierId; key: string }
  | { kind: "document"; tier: BundleTierId; key: string };

/**
 * One program bundle as a matrix: a row per part of the program, a column per
 * delivery tier. Every cell is a bar of its own units' states, so a tier with
 * more units does not look further along, and under it the exact count. In
 * the screener tier a unit is a provision PolicyEngine cites; in the full
 * bundle, a source section. A cell opens its list; the table below gives
 * every document's provisions by state.
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
  const [tableFilter, setTableFilter] = useState<DocumentStatus | "excluded" | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);

  const inScope = useMemo(() => {
    const out = new Map<BundleTierId, BundleDocumentRow[]>();
    for (const row of documents) if (row.scope === "in") out.set(row.tier, [...(out.get(row.tier) ?? []), row]);
    return out;
  }, [documents]);
  const byTier = (tier: BundleTierId) => documents.filter((r) => r.tier === tier);
  // The bundle's parts that hold anything, in its order; parts the bundle does not list go last.
  const parts = useMemo(() => {
    const used = new Set<string>();
    for (const row of documents) {
      if (row.scope !== "in") continue;
      if (row.tier === "screener") for (const u of row.units) used.add(u.part);
      else used.add(row.part);
    }
    const listed = (bundle?.parts ?? []).filter((p) => used.has(p));
    return [...listed, ...[...used].filter((p) => !listed.includes(p)).sort()];
  }, [bundle, documents]);
  const collectedAt = documents[0]?.collected_at ?? bundle?.collected_at ?? null;

  const select = (next: Selection) =>
    setSelected((current) => (JSON.stringify(current) === JSON.stringify(next) ? null : next));
  const filterTable = (tier: BundleTierId, value: DocumentStatus | "excluded") => {
    setTableTier(tier);
    setTableFilter((current) => (tableTier === tier && current === value ? null : value));
  };

  const tableRows = byTier(tableTier).filter((r) =>
    tableFilter === "excluded" ? r.scope === "excluded" : r.scope === "in" && (!tableFilter || r.status === tableFilter)
  );

  let drawer: React.ReactNode = null;
  if (selected?.kind === "cell") {
    const tier = tiers.find((t) => t.id === selected.tier);
    drawer = tier && (
      <CellDetail
        cell={cellOf(selected.tier, selected.part, inScope.get(selected.tier) ?? [])}
        tierTitle={tier.title}
        onUnit={(key) => setSelected({ kind: "unit", tier: selected.tier, key })}
        onDocument={(key) => setSelected({ kind: "document", tier: selected.tier, key })}
        onClose={() => setSelected(null)}
      />
    );
  } else if (selected?.kind === "unit") {
    const owner = (inScope.get(selected.tier) ?? []).find((r) => r.units.some((u) => u.key === selected.key));
    const unit = owner?.units.find((u) => u.key === selected.key);
    if (owner && unit) {
      drawer = (
        <UnitDetail
          unit={unit}
          document={owner}
          referenceMs={referenceMs}
          onDocument={() => setSelected({ kind: "document", tier: selected.tier, key: owner.key })}
          onClose={() => setSelected(null)}
        />
      );
    }
  } else if (selected?.kind === "document") {
    const row = byTier(selected.tier).find((r) => r.key === selected.key);
    if (row) drawer = <DocumentDetail row={row} referenceMs={referenceMs} onClose={() => setSelected(null)} />;
  }

  return (
    <div className={`${dashboard.dashboard} ${styles.page} min-h-screen pt-28 pb-16`}>
      <div className="max-w-[1100px] mx-auto px-5 md:px-10">
        <a href="/ops" className={styles.back}>
          <ArrowLeft size={13} aria-hidden /> Operations
        </a>
        <header className={dashboard.header}>
          <p className={dashboard.eyebrow}>Axiom / Operations / Bundles</p>
          <h1 className={styles.title}>{bundle?.title ?? "No bundle"}</h1>
          <p className={styles.summary}>
            {bundle ? (
              <>
                Each part of the program, and how far each delivery tier has come in it.
                {collectedAt && ` Updated ${ageLabel(collectedAt, referenceMs) ?? "just now"} ago.`}
              </>
            ) : available ? (
              "No bundle file by this name on axiom-corpus main."
            ) : (
              "The bundle tables are not available yet."
            )}
          </p>
        </header>

        {tiers.length > 0 && (
          <section className={styles.matrixCard} aria-label="Progress by part of the program">
            <div
              className={styles.matrix}
              style={{ gridTemplateColumns: `minmax(150px, 220px) repeat(${tiers.length}, minmax(0, 1fr))` }}
              role="table"
              aria-label="Parts of the program by tier"
            >
              <div role="row" className={styles.matrixRow}>
                <span role="columnheader" className={styles.matrixCorner}>
                  Part of the program
                </span>
                {tiers.map((tier, index) => (
                  <TierHeader key={tier.id} index={index + 1} tier={tier} rows={inScope.get(tier.id) ?? []} />
                ))}
              </div>
              {parts.map((part) => (
                <div key={part} role="row" className={styles.matrixRow}>
                  <span role="rowheader" className={styles.partName}>
                    {part}
                  </span>
                  {tiers.map((tier) => {
                    const cell = cellOf(tier.id, part, inScope.get(tier.id) ?? []);
                    return (
                      <span key={tier.id} role="cell" className={styles.matrixCell}>
                        {cell.total ? (
                          <button
                            type="button"
                            className={styles.cellButton}
                            aria-pressed={selected?.kind === "cell" && selected.tier === tier.id && selected.part === part}
                            aria-label={`${part}, ${tier.title}: ${cell.done} of ${cell.total} ${unitWord(tier.id, cell.total)}`}
                            onClick={() => select({ kind: "cell", tier: tier.id, part })}
                          >
                            <ShadeBar shades={cell.shades} total={cell.total} />
                            <span className={styles.cellCount}>
                              <span>
                                <strong>{number(cell.done)}</strong> of {number(cell.total)}
                              </span>
                              <span>{percent(cell.done, cell.total)}</span>
                            </span>
                          </button>
                        ) : (
                          <span className={styles.cellEmpty}>—</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              ))}
              <FactsRow label="Documents" tiers={tiers} render={(tier) => (
                <DocumentFacts
                  rows={byTier(tier.id)}
                  pressed={tableTier === tier.id ? tableFilter : null}
                  onFilter={(value) => filterTable(tier.id, value)}
                />
              )} />
              <FactsRow label="Provisions" tiers={tiers} render={(tier) => <ProvisionFacts rows={inScope.get(tier.id) ?? []} />} />
            </div>
            <ul className={styles.legend} aria-label="States">
              {SHADES.map((shade) => (
                <li key={shade}>
                  <i className={styles.swatch} data-shade={shade} aria-hidden />
                  {SHADE_LABELS[shade]}
                </li>
              ))}
            </ul>
          </section>
        )}

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
                    onClick={() => {
                      setTableTier(tier.id);
                      setTableFilter(null);
                    }}
                  >
                    {tier.title}
                  </button>
                ))}
                {tableFilter && (
                  <button type="button" className={styles.clear} onClick={() => setTableFilter(null)}>
                    Show all
                  </button>
                )}
              </div>
            </div>
            <DocumentTable
              title={tiers.find((t) => t.id === tableTier)?.title ?? ""}
              rows={tableRows}
              parts={parts}
              excluded={tableFilter === "excluded"}
              selectedKey={selected?.kind === "document" && selected.tier === tableTier ? selected.key : null}
              onSelect={(key) => select({ kind: "document", tier: tableTier, key })}
              referenceMs={referenceMs}
            />
          </section>
        )}
      </div>
      {drawer}
    </div>
  );
}

const unitWord = (tier: BundleTierId, n: number) =>
  tier === "screener" ? (n === 1 ? "cited provision" : "cited provisions") : n === 1 ? "section" : "sections";

/** A bar of one cell's units by state; its segments fill the cell whatever the count. */
function ShadeBar({ shades, total }: { shades: Record<Shade, number>; total: number }) {
  return (
    <span className={styles.shadeBar} aria-hidden>
      {SHADES.map((shade) =>
        shades[shade] > 0 ? <span key={shade} data-shade={shade} style={{ width: `${(shades[shade] / total) * 100}%` }} /> : null
      )}
    </span>
  );
}

/** A tier's column head: its name, what it means, and how far it has come. */
function TierHeader({ index, tier, rows }: { index: number; tier: BundleRow["tiers"][number]; rows: BundleDocumentRow[] }) {
  const counts = tierCounts(rows);
  const done = tier.id === "screener" ? counts.byUnitState.encoded : counts.byStatus.complete;
  const total = tier.id === "screener" ? counts.units : counts.documents;
  return (
    <span role="columnheader" className={styles.tierHeader}>
      <span className={styles.tierIndex}>Tier {index}</span>
      <span className={styles.tierTitle}>
        {tier.title}
        <Explain label={tier.title}>
          {tier.definition}{" "}
          {tier.id === "screener"
            ? "Each unit is a provision PolicyEngine cites, as its parity model reads it: encoded when a module encodes it or its section's module names it."
            : "Each unit is a source section, complete when every one of its provisions is encoded."}
        </Explain>
      </span>
      <span className={styles.tierTotal}>
        <strong>{number(done)}</strong> of {number(total)} {unitWord(tier.id, total)} {tier.id === "screener" ? "encoded" : "complete"}
        <em>{percent(done, total)}</em>
      </span>
    </span>
  );
}

function FactsRow({
  label,
  tiers,
  render,
}: {
  label: string;
  tiers: BundleRow["tiers"];
  render: (tier: BundleRow["tiers"][number]) => React.ReactNode;
}) {
  return (
    <div role="row" className={`${styles.matrixRow} ${styles.factsRow}`}>
      <span role="rowheader" className={styles.factsLabel}>
        {label}
        <Explain label={label}>
          {label === "Documents"
            ? "Every document of the tier. Complete: every one of its provisions is encoded. Not in the corpus: the corpus does not hold it yet, so its provisions cannot be counted."
            : "The text-bearing provisions of the tier's documents in the corpus. Encoded: a module's source is the provision or one above it. Partly encoded: a module encodes only part of it."}
        </Explain>
      </span>
      {tiers.map((tier) => (
        <span key={tier.id} role="cell" className={styles.facts}>
          {render(tier)}
        </span>
      ))}
    </div>
  );
}

function DocumentFacts({
  rows,
  pressed,
  onFilter,
}: {
  rows: BundleDocumentRow[];
  pressed: DocumentStatus | "excluded" | null;
  onFilter: (value: DocumentStatus | "excluded") => void;
}) {
  const counts = tierCounts(rows);
  return (
    <>
      <strong>{number(counts.documents)}</strong>
      {DOCUMENT_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          className={styles.factButton}
          aria-pressed={pressed === status}
          disabled={counts.byStatus[status] === 0}
          onClick={() => onFilter(status)}
        >
          {number(counts.byStatus[status])} {STATUS_LABELS[status].toLowerCase()}
        </button>
      ))}
      <button
        type="button"
        className={styles.factButton}
        aria-pressed={pressed === "excluded"}
        disabled={counts.excluded === 0}
        onClick={() => onFilter("excluded")}
      >
        {number(counts.excluded)} excluded
      </button>
    </>
  );
}

function ProvisionFacts({ rows }: { rows: BundleDocumentRow[] }) {
  const counts = tierCounts(rows);
  const p = counts.byProvisionState;
  return (
    <>
      <strong>{number(counts.provisions)}</strong>
      {PROVISION_STATES.filter((state) => p[state] > 0).map((state) => (
        <span key={state} className={styles.factItem}>
          {number(p[state])} {PROVISION_LABELS[state].toLowerCase()}
        </span>
      ))}
    </>
  );
}

/** Esc closes a drawer. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function DrawerTop({ label, shade, onClose }: { label: string; shade?: Shade; onClose: () => void }) {
  return (
    <div className={styles.detailTop}>
      <p className={styles.detailStatus}>
        {shade && <i className={styles.swatch} data-shade={shade} aria-hidden />}
        {label}
      </p>
      <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** One cell's units: how many in each state, and each one to open. */
function CellDetail({
  cell,
  tierTitle,
  onUnit,
  onDocument,
  onClose,
}: {
  cell: Cell;
  tierTitle: string;
  onUnit: (key: string) => void;
  onDocument: (key: string) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <aside className={styles.detail} aria-label="Part of the program">
      <DrawerTop label={tierTitle} onClose={onClose} />
      <h3 className={styles.detailName}>{cell.part}</h3>
      <div className={styles.detailBlock}>
        <p className={styles.detailLabel}>
          {cell.tier === "screener" ? "Cited provisions" : "Sections"}
          <span>
            {number(cell.done)} of {number(cell.total)} {cell.tier === "screener" ? "encoded" : "complete"}
          </span>
        </p>
        <ShadeBar shades={cell.shades} total={cell.total} />
        <ul className={styles.detailStates}>
          {SHADES.filter((shade) => cell.shades[shade] > 0).map((shade) => (
            <li key={shade}>
              <i className={styles.swatch} data-shade={shade} aria-hidden />
              {SHADE_LABELS[shade]}
              <strong>{number(cell.shades[shade])}</strong>
            </li>
          ))}
        </ul>
      </div>
      <ul className={styles.memberList}>
        {cell.tier === "screener"
          ? [...cell.units]
              .sort((a, b) => UNIT_STATES.indexOf(a.state) - UNIT_STATES.indexOf(b.state) || a.name.localeCompare(b.name))
              .map((unit) => (
                <li key={unit.key}>
                  <button type="button" onClick={() => onUnit(unit.key)} title={unit.detail ?? undefined}>
                    <i className={styles.swatch} data-shade={UNIT_SHADE[unit.state]} aria-hidden />
                    <span>{unit.name}</span>
                    <span className={styles.muted}>{UNIT_LABELS[unit.state].toLowerCase()}</span>
                  </button>
                </li>
              ))
          : [...cell.documents]
              .sort((a, b) => (b.provisions ? b.encoded_provisions / b.provisions : -1) - (a.provisions ? a.encoded_provisions / a.provisions : -1) || a.name.localeCompare(b.name))
              .map((row) => (
                <li key={row.key}>
                  <button type="button" onClick={() => onDocument(row.key)}>
                    <i className={styles.swatch} data-shade={row.status ? STATUS_SHADE[row.status] : "none"} aria-hidden />
                    <span>{row.name}</span>
                    <span className={styles.muted}>
                      {row.in_corpus ? `${number(row.encoded_provisions)} of ${number(row.provisions)}` : "not in the corpus"}
                    </span>
                  </button>
                </li>
              ))}
      </ul>
    </aside>
  );
}

/** One cited provision: its state and why, how often PolicyEngine cites it, its document, and its newest run. */
function UnitDetail({
  unit,
  document,
  referenceMs,
  onDocument,
  onClose,
}: {
  unit: ParityUnit;
  document: BundleDocumentRow;
  referenceMs: number;
  onDocument: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <aside className={styles.detail} aria-label="Cited provision">
      <DrawerTop label={UNIT_LABELS[unit.state]} shade={UNIT_SHADE[unit.state]} onClose={onClose} />
      <h3 className={styles.detailName}>{unit.name}</h3>
      {unit.path ? (
        document.in_corpus ? (
          <a className={styles.detailPath} href={`/${unit.path}`}>
            {unit.path}
          </a>
        ) : (
          <p className={styles.detailPath}>{unit.path}</p>
        )
      ) : (
        unit.url && (
          <a className={styles.detailPath} href={unit.url} target="_blank" rel="noreferrer">
            {unit.url}
          </a>
        )
      )}
      {unit.detail && <p className={styles.detailNote}>{unit.detail}.</p>}
      <dl className={styles.detailFacts}>
        <div>
          <dt>Part of the program</dt>
          <dd>{unit.part}</dd>
        </div>
        <div>
          <dt>PolicyEngine references</dt>
          <dd>{unit.references ? number(unit.references) : "—"}</dd>
        </div>
        <div>
          <dt>Document</dt>
          <dd>
            <button type="button" className={styles.link} onClick={onDocument}>
              {document.name}
            </button>
          </dd>
        </div>
        <div>
          <dt>Newest run</dt>
          <dd>
            {unit.run ? (
              <a href={`/ops/journey?citation=${encodeURIComponent(unit.run.citation)}`}>
                {STAGE_COPY[unit.run.stage].label} · {ageLabel(unit.run.at, referenceMs)}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

/** One document: its provisions by state, its open runs, and where it came from. */
function DocumentDetail({
  row,
  referenceMs,
  onClose,
}: {
  row: BundleDocumentRow;
  referenceMs: number;
  onClose: () => void;
}) {
  useEscape(onClose);
  const states = provisionCounts(row);
  return (
    <aside className={styles.detail} aria-label="Document">
      <DrawerTop
        label={row.status ? STATUS_LABELS[row.status] : "Excluded"}
        shade={row.status ? STATUS_SHADE[row.status] : undefined}
        onClose={onClose}
      />
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
      {row.scope === "excluded" && row.reason && <p className={styles.detailNote}>Excluded: {row.reason}.</p>}

      {row.in_corpus ? (
        <div className={styles.detailBlock}>
          <p className={styles.detailLabel}>
            Provisions<span>{number(row.provisions)}</span>
          </p>
          <span className={styles.shadeBar} aria-hidden>
            {PROVISION_STATES.map((state) =>
              states[state] > 0 ? (
                <span
                  key={state}
                  data-shade={state === "not_started" ? "none" : state}
                  style={{ width: `${(states[state] / Math.max(1, row.provisions)) * 100}%` }}
                />
              ) : null
            )}
          </span>
          <ul className={styles.detailStates}>
            {PROVISION_STATES.map((state) => (
              <li key={state}>
                <i className={styles.swatch} data-shade={state === "not_started" ? "none" : state} aria-hidden />
                {PROVISION_LABELS[state]}
                <strong>{number(states[state])}</strong>
              </li>
            ))}
          </ul>
          <p className={styles.detailNote}>
            {number(row.modules)} {row.modules === 1 ? "module encodes" : "modules encode"} provisions of this document.
          </p>
        </div>
      ) : (
        row.scope === "in" && (
          <p className={styles.detailNote}>
            {row.citation_path
              ? "The corpus does not serve this citation path yet."
              : "No corpus document holds this source yet: it needs a source manifest and ingestion."}
          </p>
        )
      )}

      {row.open_provisions.length > 0 && (
        <div className={styles.detailBlock}>
          <p className={styles.detailLabel}>
            Open runs<span>{number(row.open_provisions.length)}</span>
          </p>
          <ul className={styles.openList}>
            {row.open_provisions.map((p) => (
              <li key={p.path}>
                <i className={styles.swatch} data-shade={p.state} aria-hidden />
                <a href={`/ops/journey?citation=${encodeURIComponent(p.citation)}`} className={styles.mono}>
                  {p.path.slice((row.citation_path ?? "").length) || p.path}
                </a>
                <span className={styles.muted}>
                  {STAGE_COPY[p.stage].label} · {ageLabel(p.at, referenceMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.units.length > 0 && (
        <div className={styles.detailBlock}>
          <p className={styles.detailLabel}>
            PolicyEngine cites<span>{number(row.units.length)}</span>
          </p>
          <ul className={styles.openList}>
            {row.units.map((u) => (
              <li key={u.key} title={u.detail ?? undefined}>
                <i className={styles.swatch} data-shade={UNIT_SHADE[u.state]} aria-hidden />
                <span className={styles.mono}>{u.path?.slice((row.citation_path ?? "").length) || "the whole document"}</span>
                <span className={styles.muted}>{UNIT_LABELS[u.state].toLowerCase()}</span>
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
        Part: {row.part}. In the bundle from{" "}
        {row.sources.map((s) => (s === "plan" ? "the plan" : "PolicyEngine references")).join(" and ") ||
          "a source manifest"}
        {row.manifest && ` (${row.manifest})`}.
      </p>
    </aside>
  );
}

/** Every document with its exact provision counts, or the excluded list with reasons. */
function DocumentTable({
  title,
  rows,
  parts,
  excluded,
  selectedKey,
  onSelect,
  referenceMs,
}: {
  title: string;
  rows: BundleDocumentRow[];
  parts: string[];
  excluded: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  referenceMs: number;
}) {
  const rank = (part: string) => (parts.includes(part) ? parts.indexOf(part) : parts.length);
  const sorted = [...rows].sort((a, b) =>
    excluded
      ? (a.reason ?? "").localeCompare(b.reason ?? "") || a.name.localeCompare(b.name)
      : rank(a.part) - rank(b.part) || a.name.localeCompare(b.name)
  );
  const totals = Object.fromEntries(PROVISION_STATES.map((s) => [s, 0])) as Record<ProvisionState, number>;
  let provisions = 0;
  for (const row of rows) {
    if (!row.in_corpus) continue;
    provisions += row.provisions;
    const states = provisionCounts(row);
    for (const state of PROVISION_STATES) totals[state] += states[state];
  }
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
                <th scope="col">Part</th>
                {PROVISION_STATES.map((state) => (
                  <th key={state} scope="col" className={styles.num} title={PROVISION_LABELS[state]}>
                    {SHORT_LABELS[state]}
                  </th>
                ))}
                <th scope="col" className={styles.num}>
                  Provisions
                </th>
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
                  <button type="button" className={styles.rowName} onClick={() => onSelect(row.key)}>
                    {row.name}
                  </button>
                  {!excluded && row.status && <span className={styles.rowStatus}>{STATUS_LABELS[row.status]}</span>}
                </th>
                {excluded ? (
                  <td>{row.reason ?? "—"}</td>
                ) : (
                  <>
                    <td className={styles.muted}>{row.part}</td>
                    {row.in_corpus ? (
                      <>
                        {PROVISION_STATES.map((state) => (
                          <td key={state} className={styles.num} data-zero={states[state] === 0 ? true : undefined}>
                            {number(states[state])}
                          </td>
                        ))}
                        <td className={styles.num}>{number(row.provisions)}</td>
                      </>
                    ) : (
                      <td colSpan={PROVISION_STATES.length + 1} className={styles.notHeld}>
                        Not in the corpus yet
                      </td>
                    )}
                    <td>
                      {row.latest_stage && row.latest_citation ? (
                        <a href={`/ops/journey?citation=${encodeURIComponent(row.latest_citation)}`}>
                          {STAGE_COPY[row.latest_stage].label}
                          <span className={styles.muted}> · {ageLabel(row.latest_run_at, referenceMs)}</span>
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
              <td />
              {PROVISION_STATES.map((state) => (
                <td key={state} className={styles.num}>
                  {number(totals[state])}
                </td>
              ))}
              <td className={styles.num}>{number(provisions)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
