"use client";

import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, X } from "lucide-react";
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
import { olderVersion, type ScreenerParity } from "@/lib/axiom/screener-parity";

const number = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const share = (value: number | null) => (value == null ? "—" : `${Math.round(value * 1000) / 10}%`);
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** Provision states as the table's column heads. */
const SHORT_LABELS: Record<ProvisionState, string> = {
  encoded: "Encoded",
  unvalidated: "Unvalidated",
  partly: "Partly",
  deferred: "Deferred",
  in_progress: "Running",
  failed: "Failed",
  not_started: "To do",
};

/**
 * One state scale for both tiers: a cited provision's state in the screener
 * tier, a section's status in the full bundle. The bar and legend use these.
 */
type Shade = "encoded" | "unvalidated" | "partly" | "deferred" | "in_progress" | "failed" | "none" | "missing";
const SHADES: Shade[] = ["encoded", "unvalidated", "partly", "deferred", "in_progress", "failed", "none", "missing"];
const SHADE_LABELS: Record<Shade, string> = {
  encoded: "Encoded",
  unvalidated: "Encoded, not validated",
  partly: "Partly encoded",
  deferred: "Deferred",
  in_progress: "In progress",
  failed: "Failed",
  none: "Not encoded yet",
  missing: "Not in the corpus",
};
const UNIT_SHADE: Record<UnitState, Shade> = {
  encoded: "encoded",
  unvalidated: "unvalidated",
  partly: "partly",
  deferred: "deferred",
  in_progress: "in_progress",
  failed: "failed",
  not_encoded: "none",
  not_in_corpus: "missing",
};
const STATUS_SHADE: Record<DocumentStatus, Shade> = {
  complete: "encoded",
  unvalidated: "unvalidated",
  partly: "partly",
  not_started: "none",
  not_in_corpus: "missing",
};

/** What every cell counts, in both tiers alike. */
type Count = "documents" | "provisions";

const PROVISION_SHADE: Record<ProvisionState, Shade> = {
  encoded: "encoded",
  unvalidated: "unvalidated",
  partly: "partly",
  deferred: "deferred",
  in_progress: "in_progress",
  failed: "failed",
  not_started: "none",
};

/** One cell of the matrix: a part of the program in one tier, counted in documents or provisions. */
interface Cell {
  tier: BundleTierId;
  part: string;
  count: Count;
  documents: BundleDocumentRow[];
  shades: Record<Shade, number>;
  done: number;
  total: number;
  /** Provisions only: documents the corpus does not hold, whose provisions cannot be counted. */
  uncounted: number;
}

/** Encoded, validated or not: what "done" counts everywhere on the page. */
const doneDocuments = (byStatus: Record<DocumentStatus, number>) => byStatus.complete + byStatus.unvalidated;
const doneProvisions = (byState: Record<ProvisionState, number>) => byState.encoded + byState.unvalidated;
const doneUnits = (byState: Record<UnitState, number>) => byState.encoded + byState.unvalidated;

function cellOf(tier: BundleTierId, part: string, rows: BundleDocumentRow[], count: Count): Cell {
  const shades = Object.fromEntries(SHADES.map((s) => [s, 0])) as Record<Shade, number>;
  const documents = rows.filter((r) => r.part === part);
  if (count === "documents") {
    for (const row of documents) if (row.status) shades[STATUS_SHADE[row.status]]++;
    const done = shades.encoded + shades.unvalidated;
    return { tier, part, count, documents, shades, done, total: documents.length, uncounted: 0 };
  }
  let total = 0;
  for (const row of documents) {
    if (!row.in_corpus) continue;
    total += row.provisions;
    const states = provisionCounts(row);
    for (const state of PROVISION_STATES) shades[PROVISION_SHADE[state]] += states[state];
  }
  return {
    tier,
    part,
    count,
    documents,
    shades,
    done: shades.encoded + shades.unvalidated,
    total,
    uncounted: documents.filter((r) => !r.in_corpus).length,
  };
}

const COUNT_WORDS: Record<Count, [string, string, string]> = {
  documents: ["document", "documents", "complete"],
  provisions: ["provision", "provisions", "encoded"],
};
const countWord = (count: Count, n: number) => COUNT_WORDS[count][n === 1 ? 0 : 1];

type Selection =
  | { kind: "cell"; tier: BundleTierId; part: string }
  | { kind: "parity"; tier: BundleTierId }
  | { kind: "unit"; tier: BundleTierId; key: string }
  | { kind: "document"; tier: BundleTierId; key: string };

/**
 * One program bundle as a matrix: a row per part of the program, a column per
 * delivery tier, and one unit for both tiers, documents or provisions, chosen
 * with a switch. Every cell is a bar of its own units' states, so a tier with
 * more units does not look further along, and under it the exact count. The
 * screener tier's header also gives its PolicyEngine parity. A cell opens its
 * documents; the table below gives every document's provisions by state.
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
  const [count, setCount] = useState<Count>("documents");

  const inScope = useMemo(() => {
    const out = new Map<BundleTierId, BundleDocumentRow[]>();
    for (const row of documents) if (row.scope === "in") out.set(row.tier, [...(out.get(row.tier) ?? []), row]);
    return out;
  }, [documents]);
  const byTier = (tier: BundleTierId) => documents.filter((r) => r.tier === tier);
  // The bundle's parts that hold a document, in its order; parts the bundle does not list go last.
  const parts = useMemo(() => {
    const used = new Set<string>();
    for (const row of documents) if (row.scope === "in") used.add(row.part);
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
        cell={cellOf(selected.tier, selected.part, inScope.get(selected.tier) ?? [], count)}
        tierTitle={tier.title}
        onDocument={(key) => setSelected({ kind: "document", tier: selected.tier, key })}
        onClose={() => setSelected(null)}
      />
    );
  } else if (selected?.kind === "parity") {
    drawer = (
      <ParityDetail
        parity={bundle?.parity ?? null}
        newest={bundle?.policyengine_latest ?? null}
        rows={inScope.get(selected.tier) ?? []}
        parts={bundle?.parts ?? []}
        onUnit={(key) => setSelected({ kind: "unit", tier: selected.tier, key })}
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
    if (row) {
      drawer = (
        <DocumentDetail
          row={row}
          referenceMs={referenceMs}
          onUnit={(key) => setSelected({ kind: "unit", tier: selected.tier, key })}
          onClose={() => setSelected(null)}
        />
      );
    }
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
            <div className={styles.countSwitch} role="radiogroup" aria-label="Count">
              <span>Count</span>
              {(["documents", "provisions"] as Count[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={count === value}
                  onClick={() => setCount(value)}
                >
                  {value === "documents" ? "Documents" : "Provisions"}
                </button>
              ))}
              <Explain label="Count">
                Documents: each document counts once, complete when every one of its provisions is encoded. Provisions:
                every text-bearing provision of the documents in the corpus; a document the corpus does not hold has
                no provisions to count, so it shows apart.
              </Explain>
            </div>
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
                  <TierHeader
                    key={tier.id}
                    index={index + 1}
                    tier={tier}
                    rows={inScope.get(tier.id) ?? []}
                    count={count}
                    parity={tier.id === "screener" ? (bundle?.parity ?? null) : null}
                    newest={bundle?.policyengine_latest ?? null}
                    onParity={() => select({ kind: "parity", tier: tier.id })}
                  />
                ))}
              </div>
              {parts.map((part) => (
                <div key={part} role="row" className={styles.matrixRow}>
                  <span role="rowheader" className={styles.partName}>
                    {part}
                  </span>
                  {tiers.map((tier) => {
                    const cell = cellOf(tier.id, part, inScope.get(tier.id) ?? [], count);
                    return (
                      <span key={tier.id} role="cell" className={styles.matrixCell}>
                        {cell.documents.length ? (
                          <button
                            type="button"
                            className={styles.cellButton}
                            aria-pressed={selected?.kind === "cell" && selected.tier === tier.id && selected.part === part}
                            aria-label={`${part}, ${tier.title}: ${cell.done} of ${cell.total} ${countWord(count, cell.total)} ${COUNT_WORDS[count][2]}`}
                            onClick={() => select({ kind: "cell", tier: tier.id, part })}
                          >
                            {cell.total ? (
                              <ShadeBar shades={cell.shades} total={cell.total} />
                            ) : (
                              <span className={styles.shadeBar} data-empty aria-hidden />
                            )}
                            <span className={styles.cellCount}>
                              <span>
                                <strong>{number(cell.done)}</strong> of {number(cell.total)}
                                {cell.uncounted > 0 && (
                                  <span className={styles.uncounted}>
                                    {" "}
                                    + {number(cell.uncounted)} not in the corpus
                                  </span>
                                )}
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
              {(count === "documents"
                ? (["encoded", "unvalidated", "partly", "none", "missing"] as Shade[])
                : (["encoded", "unvalidated", "partly", "deferred", "in_progress", "failed", "none"] as Shade[])
              ).map((shade) => (
                <li key={shade}>
                  <i className={styles.swatch} data-shade={shade} aria-hidden />
                  {(count === "documents" ? DOCUMENT_SHADE_LABELS : SHADE_LABELS)[shade]}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tiers.length > 0 && <Provenance bundle={bundle} tiers={tiers} rows={documents} />}

        {tiers.length > 0 && (
          <section className={styles.panel} aria-labelledby="bundle-documents">
            <div className={styles.panelHead}>
              <h2 id="bundle-documents">Documents</h2>
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
                    {tableFilter === "excluded" ? "Excluded" : STATUS_LABELS[tableFilter]} · Show all
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

const DOCUMENT_SHADE_LABELS: Record<Shade, string> = {
  ...SHADE_LABELS,
  encoded: "Complete",
  unvalidated: "Complete, not validated",
  none: "Not started",
};

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

/**
 * A tier's column head: its name and what it means, its headline, and how far
 * its documents have come in the chosen count. The screener tier's headline
 * is screener-level parity, from its comparison against PolicyEngine; its
 * document counts follow as the work behind it.
 */
function TierHeader({
  index,
  tier,
  rows,
  count,
  parity,
  newest,
  onParity,
}: {
  index: number;
  tier: BundleRow["tiers"][number];
  rows: BundleDocumentRow[];
  count: Count;
  parity: ScreenerParity | null;
  newest: string | null;
  onParity: () => void;
}) {
  const counts = tierCounts(rows);
  const done = count === "documents" ? doneDocuments(counts.byStatus) : doneProvisions(counts.byProvisionState);
  const total = count === "documents" ? counts.documents : counts.provisions;
  const unitsDone = doneUnits(counts.byUnitState);
  const screener = tier.id === "screener";
  const stale = olderVersion(parity?.policyengine_us ?? null, newest);
  return (
    <span role="columnheader" className={styles.tierHeader}>
      <span className={styles.tierIndex}>Tier {index}</span>
      <span className={styles.tierTitle}>
        {tier.title}
        <Explain label={tier.title}>{tier.definition}</Explain>
      </span>
      {screener && (
        <button type="button" className={styles.parityHead} onClick={onParity}>
          {parity?.eligible_matching != null ? (
            <>
              <span className={styles.tierTotal}>
                <strong>{share(parity.eligible_matching)}</strong> of eligible households match PolicyEngine
              </span>
              <span className={styles.parityFacts}>
                {number(parity.axiom_errors)} Axiom {parity.axiom_errors === 1 ? "error" : "errors"} to fix ·
                PolicyEngine-US {parity.policyengine_us ?? "?"}
                {stale && <span className={styles.stale}> (newest {newest})</span>} · {day(parity.generated_at)}
              </span>
            </>
          ) : (
            <span className={styles.parityFacts}>No comparison against PolicyEngine yet</span>
          )}
        </button>
      )}
      <span className={screener ? styles.tierCount : styles.tierTotal}>
        <strong>{number(done)}</strong> of {number(total)} {countWord(count, total)} {COUNT_WORDS[count][2]}
        <em>{percent(done, total)}</em>
      </span>
      {counts.units > 0 && (
        <button type="button" className={styles.parityLine} onClick={onParity}>
          PolicyEngine citations encoded: <strong>{number(unitsDone)}</strong> of {number(counts.units)} ·{" "}
          {percent(unitsDone, counts.units)}
        </button>
      )}
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
            ? "Every document of the tier. Complete: a rule cites every one of its provisions. Not validated: some of those rules merged under a validation waiver. Not in the corpus: the corpus does not hold it yet, so its provisions cannot be counted."
            : "The text-bearing provisions of the tier's documents in the corpus. Encoded: a rule cites the provision or one above it, and nothing in it is deferred. Not validated: every such rule merged under a validation waiver. Partly encoded: rules cite only parts of it, or defer a part. Deferred: a module defers it and no rule cites it. A module's declared source alone is not counted; encode runs only mark in progress or failed."}
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

/** One cell: its documents, how many in each state (in the chosen count), and each one to open. */
function CellDetail({
  cell,
  tierTitle,
  onDocument,
  onClose,
}: {
  cell: Cell;
  tierTitle: string;
  onDocument: (key: string) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const labels = cell.count === "documents" ? DOCUMENT_SHADE_LABELS : SHADE_LABELS;
  return (
    <aside className={styles.detail} aria-label="Part of the program">
      <DrawerTop label={tierTitle} onClose={onClose} />
      <h3 className={styles.detailName}>{cell.part}</h3>
      <div className={styles.detailBlock}>
        <p className={styles.detailLabel}>
          {cell.count === "documents" ? "Documents" : "Provisions"}
          <span>
            {number(cell.done)} of {number(cell.total)} {COUNT_WORDS[cell.count][2]}
          </span>
        </p>
        {cell.total > 0 && <ShadeBar shades={cell.shades} total={cell.total} />}
        <ul className={styles.detailStates}>
          {SHADES.filter((shade) => cell.shades[shade] > 0).map((shade) => (
            <li key={shade}>
              <i className={styles.swatch} data-shade={shade} aria-hidden />
              {labels[shade]}
              <strong>{number(cell.shades[shade])}</strong>
            </li>
          ))}
        </ul>
        {cell.uncounted > 0 && (
          <p className={styles.detailNote}>
            {number(cell.uncounted)} {cell.uncounted === 1 ? "document is" : "documents are"} not in the corpus, so
            their provisions are not counted.
          </p>
        )}
      </div>
      <ul className={styles.memberList}>
        {[...cell.documents]
          .sort(
            (a, b) =>
              (b.provisions ? (b.encoded_provisions + b.unvalidated_provisions) / b.provisions : -1) -
                (a.provisions ? (a.encoded_provisions + a.unvalidated_provisions) / a.provisions : -1) ||
              a.name.localeCompare(b.name)
          )
          .map((row) => (
            <li key={row.key}>
              <button type="button" onClick={() => onDocument(row.key)}>
                <i className={styles.swatch} data-shade={row.status ? STATUS_SHADE[row.status] : "none"} aria-hidden />
                <span>{row.name}</span>
                <span className={styles.muted}>
                  {row.in_corpus
                    ? `${number(row.encoded_provisions + row.unvalidated_provisions)} of ${number(row.provisions)} encoded`
                    : "not in the corpus"}
                </span>
              </button>
            </li>
          ))}
      </ul>
    </aside>
  );
}

/**
 * The screener tier's headline in full: the comparison against PolicyEngine
 * (households, eligibility, mismatches and who fixes them), then every
 * provision PolicyEngine cites by part, each one to open.
 */
function ParityDetail({
  parity,
  newest,
  rows,
  parts,
  onUnit,
  onClose,
}: {
  parity: ScreenerParity | null;
  newest: string | null;
  rows: BundleDocumentRow[];
  parts: string[];
  onUnit: (key: string) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const units = rows.flatMap((r) => r.units);
  const byPart = new Map<string, ParityUnit[]>();
  for (const unit of units) byPart.set(unit.part, [...(byPart.get(unit.part) ?? []), unit]);
  const rank = (part: string) => (parts.includes(part) ? parts.indexOf(part) : parts.length);
  const encoded = units.filter((u) => u.state === "encoded" || u.state === "unvalidated").length;
  return (
    <aside className={styles.detail} aria-label="Screener-level parity">
      <DrawerTop label="Screener-level parity" onClose={onClose} />
      {parity ? (
        <>
          <h3 className={styles.detailName}>
            {share(parity.eligible_matching)} of eligible households match PolicyEngine
          </h3>
          <p className={styles.detailNote}>
            Of the households either engine finds eligible, the share that gets the same eligibility and benefit from
            Axiom and PolicyEngine (survey-weighted). Households neither engine finds eligible match trivially, so they
            are left out.
          </p>
          <dl className={styles.detailFacts}>
            <div>
              <dt>Eligible households</dt>
              <dd>
                PolicyEngine {share(parity.eligible_policyengine)} · Axiom {share(parity.eligible_axiom)}
              </dd>
            </div>
            <div>
              <dt>Survey households</dt>
              <dd>
                {number(parity.households_matching)} of {number(parity.households)} match on every output
              </dd>
            </div>
            {parity.outputs.map((output) => (
              <div key={output.concept}>
                <dt>{output.description}</dt>
                <dd>{number(output.mismatches)} households differ</dd>
              </div>
            ))}
            <div>
              <dt>Axiom errors to fix</dt>
              <dd>
                {number(parity.axiom_errors)} of {number(parity.mismatches)} mismatches
              </dd>
            </div>
            {Object.entries(parity.by_disposition).map(([disposition, n]) => (
              <div key={disposition}>
                <dt className={styles.mono}>{disposition}</dt>
                <dd>{number(n)}</dd>
              </div>
            ))}
            {parity.issues.map((issue) => (
              <div key={issue.url}>
                <dt>Held by</dt>
                <dd>
                  <a href={issue.url} target="_blank" rel="noreferrer">
                    {issue.url.replace("https://github.com/TheAxiomFoundation/", "").replace("/issues/", "#")}
                  </a>{" "}
                  · {number(issue.mismatches)} mismatches
                </dd>
              </div>
            ))}
            <div>
              <dt>PolicyEngine-US</dt>
              <dd>
                {parity.policyengine_us ?? "?"}
                {olderVersion(parity.policyengine_us, newest) && <span className={styles.stale}> · newest is {newest}</span>}
              </dd>
            </div>
            <div>
              <dt>Comparison</dt>
              <dd>
                <a href={parity.report_url} target="_blank" rel="noreferrer">
                  {parity.suite}
                </a>{" "}
                · {day(parity.generated_at)}
                {parity.run_kind ? ` · ${parity.run_kind} run` : ""}
                {parity.reemitted ? " · re-emitted" : ""}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <h3 className={styles.detailName}>No comparison against PolicyEngine yet</h3>
      )}
      <p className={styles.detailLabel}>
        PolicyEngine citations
        <span>
          {number(encoded)} of {number(units.length)} encoded
        </span>
      </p>
      <p className={styles.detailNote}>
        Each provision PolicyEngine cites for this program at the pinned release: encoded when a rule cites it or a
        provision above it and nothing in it is deferred; partly encoded when rules cite only parts of it; deferred when
        a module defers it. This is coverage of what PolicyEngine cites, not a comparison of results: the comparison
        against PolicyEngine is its own check.
      </p>
      {[...byPart.entries()]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([part, members]) => {
          const shades = Object.fromEntries(SHADES.map((s) => [s, 0])) as Record<Shade, number>;
          for (const unit of members) shades[UNIT_SHADE[unit.state]]++;
          return (
            <div key={part} className={styles.detailBlock}>
              <p className={styles.detailLabel}>
                {part}
                <span>
                  {number(shades.encoded + shades.unvalidated)} of {number(members.length)}
                </span>
              </p>
              <ShadeBar shades={shades} total={members.length} />
              <ul className={styles.memberList}>
                {[...members]
                  .sort((a, b) => UNIT_STATES.indexOf(a.state) - UNIT_STATES.indexOf(b.state) || a.name.localeCompare(b.name))
                  .map((unit) => (
                    <li key={unit.key}>
                      <button type="button" onClick={() => onUnit(unit.key)} title={unit.detail ?? undefined}>
                        <i className={styles.swatch} data-shade={UNIT_SHADE[unit.state]} aria-hidden />
                        <span>{unit.name}</span>
                        <span className={styles.muted}>{UNIT_LABELS[unit.state].toLowerCase()}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
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
  onUnit,
  onClose,
}: {
  row: BundleDocumentRow;
  referenceMs: number;
  onUnit: (key: string) => void;
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
                  data-shade={PROVISION_SHADE[state]}
                  style={{ width: `${(states[state] / Math.max(1, row.provisions)) * 100}%` }}
                />
              ) : null
            )}
          </span>
          <ul className={styles.detailStates}>
            {PROVISION_STATES.map((state) => (
              <li key={state}>
                <i className={styles.swatch} data-shade={PROVISION_SHADE[state]} aria-hidden />
                {PROVISION_LABELS[state]}
                <strong>{number(states[state])}</strong>
              </li>
            ))}
          </ul>
          <p className={styles.detailNote}>
            {number(row.modules)} {row.modules === 1 ? "module has a rule that cites" : "modules have rules that cite"}{" "}
            this document.
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
          <ul className={styles.memberList}>
            {row.units.map((u) => (
              <li key={u.key}>
                <button type="button" onClick={() => onUnit(u.key)} title={u.detail ?? undefined}>
                  <i className={styles.swatch} data-shade={UNIT_SHADE[u.state]} aria-hidden />
                  <span className={styles.mono}>{u.path?.slice((row.citation_path ?? "").length) || "the whole document"}</span>
                  <span className={styles.muted}>{UNIT_LABELS[u.state].toLowerCase()}</span>
                </button>
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

      {row.note && <p className={styles.detailNote}>{row.note}.</p>}
      <p className={styles.detailSources}>
        Part: {row.part}. In the tier from {sourceWords(row.sources, row.manifest)}.
      </p>
    </aside>
  );
}

/**
 * Where the numbers come from: each tier's membership rule and its pinned
 * inputs, read from the bundle file, and the documents by layer.
 */
function Provenance({
  bundle,
  tiers,
  rows,
}: {
  bundle: BundleRow | null;
  tiers: BundleRow["tiers"];
  rows: BundleDocumentRow[];
}) {
  const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : null);
  return (
    <section className={styles.panel} aria-labelledby="bundle-provenance">
      <div className={styles.panelHead}>
        <h2 id="bundle-provenance">Where the numbers come from</h2>
      </div>
      <div className={styles.provenance}>
        {tiers.map((tier, index) => {
          const m = tier.membership;
          const inScope = rows.filter((r) => r.tier === tier.id && r.scope === "in");
          const layers = new Map<string, number>();
          for (const row of inScope) layers.set(row.layer, (layers.get(row.layer) ?? 0) + 1);
          const inputs: Array<[string, string | null]> =
            tier.id === "screener"
              ? [
                  [
                    "PolicyEngine-US",
                    text(m.policyengine_us_version) &&
                      `${text(m.policyengine_us_version)} (${String(m.policyengine_us_commit ?? "").slice(0, 10)}), ${text(m.reference_count)} references` +
                        (olderVersion(text(m.policyengine_us_version), bundle?.policyengine_latest ?? null)
                          ? `; newest is ${bundle?.policyengine_latest}`
                          : bundle?.policyengine_latest
                            ? "; the newest release"
                            : ""),
                  ],
                  [
                    "Comparison",
                    bundle?.parity
                      ? `${bundle.parity.suite}, PolicyEngine-US ${bundle.parity.policyengine_us ?? "?"}, ${day(bundle.parity.generated_at)}`
                      : null,
                  ],
                  ["Plan", text(m.plan_as_of) && `${text(m.plan_documents)} documents, ${text(m.plan_as_of)}`],
                  ["Fiscal year", text(m.fiscal_year) && `FY${text(m.fiscal_year)}`],
                ]
              : [
                  ["Screener tier", text(m.screener_documents) && `${text(m.screener_documents)} documents, all included`],
                  ["Federal law", text(m.federal_schema)],
                  ["State manifests", Array.isArray(m.manifests) ? `${m.manifests.length} manifests` : null],
                  ["Not in the corpus yet", text(m.known_sources) && `${text(m.known_sources)} known state sources`],
                ];
          return (
            <div key={tier.id} className={styles.provenanceTier}>
              <p className={styles.detailLabel}>
                Tier {index + 1}: {tier.title}
                <span>{number(inScope.length)} documents</span>
              </p>
              <p className={styles.detailNote}>{text(m.rule)}.</p>
              <dl className={styles.detailFacts}>
                {inputs
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                <div>
                  <dt>By layer</dt>
                  <dd>
                    {[...layers.entries()]
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([layer, n]) => `${number(n)} ${layer}`)
                      .join(", ")}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
      <p className={styles.detailSources}>
        Membership: {bundle?.source ?? "the bundle file"}, built from its config in axiom-corpus. Progress: the served
        corpus, every RuleSpec module&apos;s rules and deferrals, the validation waivers, and the encode runs, read by the
        collector every 30 minutes.
      </p>
    </section>
  );
}

/** Where a document's place in its tier comes from, in words. */
function sourceWords(sources: string[], manifest: string | null): string {
  const words = new Set<string>();
  for (const source of sources) {
    if (source === "plan") words.add("the plan");
    else if (source === "policyengine-references") words.add("PolicyEngine references");
    else if (source === "screener") words.add("the screener tier");
    else if (source.startsWith("schema:")) words.add("the federal law of the program (needs-closure schema)");
    else if (source === "known-source") words.add("the list of state sources the corpus does not hold yet");
    else words.add(`a source manifest (${source})`);
  }
  if (!words.size && manifest) words.add(`a source manifest (${manifest})`);
  return [...words].join(", ") || "a source manifest";
}

type GroupBy = "part" | "layer" | "status";
type SortKey = "name" | "part" | ProvisionState | "provisions" | "run";
interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

const GROUP_BY_LABELS: Record<GroupBy, string> = { part: "Part", layer: "Layer", status: "Status" };
const LAYER_ORDER = ["federal", "state", "other state"];
const LAYER_LABELS: Record<string, string> = { federal: "Federal", state: "State", "other state": "Other state" };

/** A row's value for a sort column; a document the corpus does not hold sorts below every count. */
function sortValue(row: BundleDocumentRow, key: SortKey, rank: (part: string) => number): number | string {
  if (key === "name") return row.name.toLowerCase();
  if (key === "part") return rank(row.part);
  if (key === "run") return row.latest_run_at ?? "";
  if (!row.in_corpus) return -1;
  return key === "provisions" ? row.provisions : provisionCounts(row)[key];
}

interface Group {
  key: string;
  label: string;
  rows: BundleDocumentRow[];
}

/**
 * Every document of the tier, in collapsible groups (by part of the program,
 * layer or status; the excluded list by reason), each group headed by its
 * documents and provisions at a glance. Every column sorts.
 */
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
  const [groupBy, setGroupBy] = useState<GroupBy>("part");
  const [sort, setSort] = useState<Sort>({ key: "provisions", dir: "desc" });
  const [open, setOpen] = useState<Set<string>>(new Set());

  const groups = useMemo<Group[]>(() => {
    const rank = (part: string) => (parts.includes(part) ? parts.indexOf(part) : parts.length);
    const keyOf = (row: BundleDocumentRow) =>
      excluded
        ? (row.reason ?? "No reason recorded")
        : groupBy === "part"
          ? row.part
          : groupBy === "layer"
            ? row.layer
            : (row.status ?? "not_started");
    const byKey = new Map<string, BundleDocumentRow[]>();
    for (const row of rows) byKey.set(keyOf(row), [...(byKey.get(keyOf(row)) ?? []), row]);
    const order = (key: string) =>
      excluded
        ? -(byKey.get(key)?.length ?? 0)
        : groupBy === "part"
          ? rank(key)
          : groupBy === "layer"
            ? LAYER_ORDER.indexOf(key)
            : DOCUMENT_STATUSES.indexOf(key as DocumentStatus);
    const label = (key: string) =>
      excluded || groupBy === "part"
        ? key
        : groupBy === "layer"
          ? (LAYER_LABELS[key] ?? key)
          : STATUS_LABELS[key as DocumentStatus];
    const compare = (a: BundleDocumentRow, b: BundleDocumentRow) => {
      const [x, y] = [sortValue(a, sort.key, rank), sortValue(b, sort.key, rank)];
      const by = x < y ? -1 : x > y ? 1 : 0;
      return (sort.dir === "asc" ? by : -by) || a.name.localeCompare(b.name);
    };
    return [...byKey.keys()]
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
      .map((key) => ({ key, label: label(key), rows: [...(byKey.get(key) ?? [])].sort(compare) }));
  }, [rows, excluded, groupBy, sort, parts]);

  // A selected document's group stays open; so does a lone group.
  const isOpen = (group: Group) =>
    open.has(group.key) || groups.length === 1 || group.rows.some((r) => r.key === selectedKey);
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allOpen = groups.every(isOpen);
  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "part" ? "asc" : "desc" }
    );

  const columns = excluded ? 2 : PROVISION_STATES.length + 4;
  const head = (key: SortKey, label: string, className?: string, hint?: string) => (
    <th
      key={key}
      scope="col"
      className={className}
      title={hint}
      aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button type="button" className={styles.sortButton} onClick={() => sortBy(key)}>
        {label}
        {sort.key === key &&
          (sort.dir === "asc" ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
      </button>
    </th>
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
    <>
      <div className={styles.tableTools}>
        {!excluded && (
          <div className={styles.countSwitch} role="radiogroup" aria-label="Group by">
            <span>Group by</span>
            {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={groupBy === value} onClick={() => setGroupBy(value)}>
                {GROUP_BY_LABELS[value]}
              </button>
            ))}
          </div>
        )}
        {groups.length > 1 && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.key)))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={`${title} documents`}>
          <thead>
            <tr>
              {head("name", "Document")}
              {excluded ? (
                <th scope="col">Why it is excluded</th>
              ) : (
                <>
                  {head("part", "Part")}
                  {PROVISION_STATES.map((state) => head(state, SHORT_LABELS[state], styles.num, PROVISION_LABELS[state]))}
                  {head("provisions", "Provisions", styles.num)}
                  {head("run", "Latest run")}
                </>
              )}
            </tr>
          </thead>
          {groups.map((group) => {
            const expanded = isOpen(group);
            return (
              <tbody key={group.key}>
                <tr className={styles.groupRow}>
                  <th scope="rowgroup" colSpan={columns}>
                    <GroupHead group={group} expanded={expanded} excluded={excluded} onToggle={() => toggle(group.key)} />
                  </th>
                </tr>
                {expanded &&
                  group.rows.map((row) => {
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
            );
          })}
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
    </>
  );
}

/** A group's head: its name, its documents, and its provisions as a bar and a count. */
function GroupHead({
  group,
  expanded,
  excluded,
  onToggle,
}: {
  group: Group;
  expanded: boolean;
  excluded: boolean;
  onToggle: () => void;
}) {
  const shades = Object.fromEntries(SHADES.map((s) => [s, 0])) as Record<Shade, number>;
  let total = 0;
  for (const row of group.rows) {
    if (!row.in_corpus) continue;
    total += row.provisions;
    const states = provisionCounts(row);
    for (const state of PROVISION_STATES) shades[PROVISION_SHADE[state]] += states[state];
  }
  const done = shades.encoded + shades.unvalidated;
  const complete = group.rows.filter((r) => r.status === "complete" || r.status === "unvalidated").length;
  const missing = group.rows.filter((r) => r.scope === "in" && !r.in_corpus).length;
  const n = group.rows.length;
  return (
    <button type="button" className={styles.groupToggle} aria-expanded={expanded} onClick={onToggle}>
      <ChevronRight size={14} aria-hidden className={styles.groupChevron} />
      <span className={styles.groupName}>{group.label}</span>
      <span className={styles.groupMeta}>
        {number(n)} {n === 1 ? "document" : "documents"}
        {!excluded && ` · ${number(complete)} complete`}
        {!excluded && missing > 0 && ` · ${number(missing)} not in the corpus`}
      </span>
      {!excluded && (
        <span className={styles.groupProgress}>
          {total > 0 ? <ShadeBar shades={shades} total={total} /> : <span className={styles.shadeBar} data-empty aria-hidden />}
          <span>
            {number(done)} of {number(total)} provisions encoded
          </span>
        </span>
      )}
    </button>
  );
}
