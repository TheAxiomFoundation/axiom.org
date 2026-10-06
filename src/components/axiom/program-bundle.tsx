"use client";

import { ArrowLeft, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import dashboard from "./ops-dashboard.module.css";
import styles from "./program-bundle.module.css";
import { Explain } from "./ops-pipeline";
import { ageLabel, STAGE_COPY } from "@/lib/axiom/encoding-pipeline";
import {
  DOCUMENT_STATUSES,
  partRank,
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
  type UnitState,
} from "@/lib/axiom/program-bundles";

const number = (value: number) => value.toLocaleString("en-US");

/** Provision states as the table's column heads. */
const SHORT_LABELS: Record<(typeof PROVISION_STATES)[number], string> = {
  encoded: "Encoded",
  partly: "Partly",
  in_progress: "Running",
  failed: "Failed",
  not_started: "To do",
};
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/** A filter on one tier: a unit state (screener squares) or a document status. */
type Filter = { tier: BundleTierId; kind: "unit"; value: UnitState } | { tier: BundleTierId; kind: "document"; value: DocumentStatus | "excluded" };

/** What the drawer shows: one screener unit, or one document. */
type Selection = { kind: "unit"; tier: BundleTierId; key: string } | { kind: "document"; tier: BundleTierId; key: string };

/** Parts in reading order, each with its members. */
function byPart<T>(items: T[], partOf: (item: T) => string): Array<[string, T[]]> {
  const parts = new Map<string, T[]>();
  for (const item of items) parts.set(partOf(item), [...(parts.get(partOf(item)) ?? []), item]);
  return [...parts.entries()].sort(([a], [b]) => partRank(a) - partRank(b) || a.localeCompare(b));
}

/**
 * One program bundle as a map of the program: each tier's work in rows by
 * the part of the program it feeds, one square per unit of work. In the
 * screener tier a square is a provision PolicyEngine cites, colored by its
 * parity state; in the full bundle a square is a source section, filled by
 * the share of its provisions encoded. Every count is exact and adds up. A
 * square opens its detail; the table below lists every document.
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
  const [filter, setFilter] = useState<Filter | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);

  const byTier = useMemo(() => {
    const out = new Map<BundleTierId, BundleDocumentRow[]>();
    for (const row of documents) out.set(row.tier, [...(out.get(row.tier) ?? []), row]);
    return out;
  }, [documents]);
  const collectedAt = documents[0]?.collected_at ?? bundle?.collected_at ?? null;

  const toggle = (next: Filter) => {
    setFilter((current) =>
      current && current.tier === next.tier && current.kind === next.kind && current.value === next.value ? null : next
    );
    if (next.kind === "document") setTableTier(next.tier);
  };
  const select = (next: Selection) =>
    setSelected((current) =>
      current && current.kind === next.kind && current.tier === next.tier && current.key === next.key ? null : next
    );

  const tableFilter = filter?.tier === tableTier && filter.kind === "document" ? filter.value : null;
  const tableRows = (byTier.get(tableTier) ?? []).filter((r) =>
    tableFilter === "excluded" ? r.scope === "excluded" : r.scope === "in" && (!tableFilter || r.status === tableFilter)
  );

  let drawer: React.ReactNode = null;
  if (selected) {
    const rows = byTier.get(selected.tier) ?? [];
    if (selected.kind === "unit") {
      const owner = rows.find((r) => r.units.some((u) => u.key === selected.key));
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
    } else {
      const row = rows.find((r) => r.key === selected.key);
      if (row) drawer = <DocumentDetail row={row} referenceMs={referenceMs} onClose={() => setSelected(null)} />;
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
                What each delivery tier holds, by the part of the program it feeds, and how far each piece has come.
                {collectedAt && ` Updated ${ageLabel(collectedAt, referenceMs) ?? "just now"} ago.`}
              </>
            ) : available ? (
              "No bundle file by this name on axiom-corpus main."
            ) : (
              "The bundle tables are not available yet."
            )}
          </p>
        </header>

        {tiers.map((tier, index) =>
          tier.id === "screener" ? (
            <ScreenerTier
              key={tier.id}
              index={index + 1}
              title={tier.title}
              definition={tier.definition}
              rows={byTier.get(tier.id) ?? []}
              filter={filter?.tier === tier.id ? filter : null}
              selectedKey={selected?.tier === tier.id ? selected.key : null}
              onFilter={(f) => toggle({ ...f, tier: tier.id } as Filter)}
              onUnit={(key) => select({ kind: "unit", tier: tier.id, key })}
            />
          ) : (
            <BundleTier
              key={tier.id}
              index={index + 1}
              title={tier.title}
              definition={tier.definition}
              rows={byTier.get(tier.id) ?? []}
              filter={filter?.tier === tier.id ? filter : null}
              selectedKey={selected?.tier === tier.id ? selected.key : null}
              onFilter={(f) => toggle({ ...f, tier: tier.id } as Filter)}
              onDocument={(key) => select({ kind: "document", tier: tier.id, key })}
            />
          )
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
              title={tiers.find((t) => t.id === tableTier)?.title ?? ""}
              rows={tableRows}
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

/** A tier's header: its number, name, meaning, and the one number that says how far it has come. */
function TierHead({
  index,
  title,
  definition,
  done,
  total,
  unit,
}: {
  index: number;
  title: string;
  definition: string;
  done: number;
  total: number;
  unit: string;
}) {
  return (
    <div className={styles.tierHead}>
      <div>
        <p className={styles.tierIndex}>Tier {index}</p>
        <div className={styles.tierTitle}>
          <h2 id={`tier-${index}`}>{title}</h2>
          <Explain label={title}>{definition}</Explain>
        </div>
      </div>
      <p className={styles.headline}>
        <strong>{number(done)}</strong>
        <span>
          of {number(total)} {unit}
          <em>{percent(done, total)}</em>
        </span>
      </p>
    </div>
  );
}

/** The documents of a tier in one line: how many, by status, each a filter on the table. */
function DocumentLine({
  rows,
  filter,
  onFilter,
}: {
  rows: BundleDocumentRow[];
  filter: Filter | null;
  onFilter: (f: { kind: "document"; value: DocumentStatus | "excluded" }) => void;
}) {
  const counts = tierCounts(rows);
  const p = counts.byProvisionState;
  return (
    <dl className={styles.facts}>
      <div>
        <dt>
          Documents
          <Explain label="Documents">
            Every document of the tier. Complete: every one of its provisions is encoded. Partly encoded: some are.
            Not in the corpus: the corpus does not hold it yet, so its provisions cannot be counted.
          </Explain>
        </dt>
        <dd>
          <strong>{number(counts.documents)}</strong>
          {DOCUMENT_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={styles.factButton}
              aria-pressed={filter?.kind === "document" && filter.value === status}
              disabled={counts.byStatus[status] === 0}
              onClick={() => onFilter({ kind: "document", value: status })}
            >
              {number(counts.byStatus[status])} {STATUS_LABELS[status].toLowerCase()}
            </button>
          ))}
          <button
            type="button"
            className={styles.factButton}
            aria-pressed={filter?.kind === "document" && filter.value === "excluded"}
            disabled={counts.excluded === 0}
            onClick={() => onFilter({ kind: "document", value: "excluded" })}
          >
            {number(counts.excluded)} excluded
          </button>
        </dd>
      </div>
      <div>
        <dt>
          Provisions
          <Explain label="Provisions">
            The text-bearing provisions of the documents in the corpus. Encoded: a module&apos;s source is the
            provision or one above it. Partly encoded: a module encodes only a part of it.
          </Explain>
        </dt>
        <dd>
          <strong>{number(counts.provisions)}</strong>
          {PROVISION_STATES.filter((state) => p[state] > 0).map((state) => (
            <span key={state} className={styles.factItem}>
              <i className={styles.swatch} data-state={state} aria-hidden />
              {number(p[state])} {PROVISION_LABELS[state].toLowerCase()}
            </span>
          ))}
        </dd>
      </div>
    </dl>
  );
}

/**
 * The screener tier: every provision PolicyEngine cites, one square each, in
 * rows by the part of the SNAP calculation it feeds.
 */
function ScreenerTier({
  index,
  title,
  definition,
  rows,
  filter,
  selectedKey,
  onFilter,
  onUnit,
}: {
  index: number;
  title: string;
  definition: string;
  rows: BundleDocumentRow[];
  filter: Filter | null;
  selectedKey: string | null;
  onFilter: (f: Omit<Filter, "tier">) => void;
  onUnit: (key: string) => void;
}) {
  const counts = tierCounts(rows);
  const units = rows.filter((r) => r.scope === "in").flatMap((r) => r.units);
  const parts = byPart(units, (u) => u.part);
  const unitFilter = filter?.kind === "unit" ? filter.value : null;
  return (
    <section className={styles.tier} aria-labelledby={`tier-${index}`}>
      <TierHead
        index={index}
        title={title}
        definition={definition}
        done={counts.byUnitState.encoded}
        total={counts.units}
        unit="cited provisions encoded"
      />
      <ul className={styles.legend} aria-label={`${title} by state`}>
        {UNIT_STATES.map((state) => (
          <li key={state}>
            <button
              type="button"
              aria-pressed={unitFilter === state}
              disabled={counts.byUnitState[state] === 0}
              onClick={() => onFilter({ kind: "unit", value: state })}
            >
              <i className={styles.square} data-state={state} aria-hidden />
              {UNIT_LABELS[state]}
              <strong>{number(counts.byUnitState[state])}</strong>
            </button>
          </li>
        ))}
        <li className={styles.legendNote}>
          <Explain label="Cited provision states">
            Each square is a provision PolicyEngine cites for this program here, as its parity model reads it. Encoded:
            a module encodes it, or the module for its section names it. Partly encoded: the section&apos;s module
            does not name it, or only part of it is encoded. In progress and failed: its newest encode run. Not in
            the corpus: the corpus does not hold the source yet.
          </Explain>
        </li>
      </ul>
      <div className={styles.lanes} role="group" aria-label={`${title}: cited provisions by part of the calculation`}>
        {parts.map(([part, members]) => {
          const encoded = members.filter((u) => u.state === "encoded").length;
          return (
            <div key={part} className={styles.lane}>
              <p className={styles.laneName}>{part}</p>
              <ul className={styles.squares}>
                {members
                  .slice()
                  .sort((a, b) => UNIT_STATES.indexOf(a.state) - UNIT_STATES.indexOf(b.state) || a.key.localeCompare(b.key))
                  .map((unit) => (
                    <li key={unit.key}>
                      <button
                        type="button"
                        className={styles.square}
                        data-state={unit.state}
                        data-dim={unitFilter && unit.state !== unitFilter ? true : undefined}
                        aria-pressed={unit.key === selectedKey}
                        aria-label={`${unit.name}: ${UNIT_LABELS[unit.state]}`}
                        title={`${unit.name}\n${UNIT_LABELS[unit.state]}${unit.detail ? ` · ${unit.detail}` : ""}`}
                        onClick={() => onUnit(unit.key)}
                      />
                    </li>
                  ))}
              </ul>
              <p className={styles.laneCount}>
                {number(encoded)} <span>/ {number(members.length)}</span>
              </p>
            </div>
          );
        })}
      </div>
      <DocumentLine rows={rows} filter={filter} onFilter={onFilter} />
    </section>
  );
}

/**
 * The full bundle: every source section, one square each, in rows by the part
 * of the program's manual it belongs to; a square's fill is the share of its
 * provisions encoded.
 */
function BundleTier({
  index,
  title,
  definition,
  rows,
  filter,
  selectedKey,
  onFilter,
  onDocument,
}: {
  index: number;
  title: string;
  definition: string;
  rows: BundleDocumentRow[];
  filter: Filter | null;
  selectedKey: string | null;
  onFilter: (f: Omit<Filter, "tier">) => void;
  onDocument: (key: string) => void;
}) {
  const counts = tierCounts(rows);
  const inScope = rows.filter((r) => r.scope === "in");
  const parts = byPart(inScope, (r) => r.part);
  const statusFilter = filter?.kind === "document" && filter.value !== "excluded" ? filter.value : null;
  return (
    <section className={styles.tier} aria-labelledby={`tier-${index}`}>
      <TierHead
        index={index}
        title={title}
        definition={definition}
        done={counts.byStatus.complete}
        total={counts.documents}
        unit="sections complete"
      />
      <ul className={styles.legend} aria-label={`${title} by status`}>
        {DOCUMENT_STATUSES.map((status) => (
          <li key={status}>
            <button
              type="button"
              aria-pressed={statusFilter === status}
              disabled={counts.byStatus[status] === 0}
              onClick={() => onFilter({ kind: "document", value: status })}
            >
              <i className={styles.square} data-status={status} aria-hidden>
                <i style={{ height: status === "complete" ? "100%" : status === "partly" ? "45%" : "0%" }} />
              </i>
              {STATUS_LABELS[status]}
              <strong>{number(counts.byStatus[status])}</strong>
            </button>
          </li>
        ))}
        <li className={styles.legendNote}>
          <Explain label="Section squares">
            Each square is a source section of the program here. Its fill is the share of its provisions encoded:
            full when complete. A dashed square is a section the corpus does not hold yet.
          </Explain>
        </li>
      </ul>
      <div className={styles.lanes} role="group" aria-label={`${title}: sections by part`}>
        {parts.map(([part, members]) => {
          const complete = members.filter((r) => r.status === "complete").length;
          return (
            <div key={part} className={styles.lane}>
              <p className={styles.laneName}>{part}</p>
              <ul className={styles.squares}>
                {members
                  .slice()
                  .sort((a, b) => share(b) - share(a) || a.name.localeCompare(b.name))
                  .map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        className={`${styles.square} ${styles.sectionSquare}`}
                        data-status={row.status ?? undefined}
                        data-dim={statusFilter && row.status !== statusFilter ? true : undefined}
                        aria-pressed={row.key === selectedKey}
                        aria-label={`${row.name}: ${row.status ? STATUS_LABELS[row.status] : ""}`}
                        title={`${row.name}\n${
                          row.in_corpus
                            ? `${number(row.encoded_provisions)} of ${number(row.provisions)} provisions encoded`
                            : STATUS_LABELS.not_in_corpus
                        }`}
                        onClick={() => onDocument(row.key)}
                      >
                        <i style={{ height: `${share(row) * 100}%` }} aria-hidden />
                      </button>
                    </li>
                  ))}
              </ul>
              <p className={styles.laneCount}>
                {number(complete)} <span>/ {number(members.length)}</span>
              </p>
            </div>
          );
        })}
      </div>
      <DocumentLine rows={rows} filter={filter} onFilter={onFilter} />
    </section>
  );
}

const share = (row: BundleDocumentRow) => (row.provisions ? row.encoded_provisions / row.provisions : 0);

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
      <div className={styles.detailTop}>
        <p className={styles.detailStatus}>
          <i className={styles.square} data-state={unit.state} aria-hidden />
          {UNIT_LABELS[unit.state]}
        </p>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
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
          <dt>Part of the calculation</dt>
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
      {row.scope === "excluded" && row.reason && <p className={styles.detailNote}>Excluded: {row.reason}.</p>}

      {row.in_corpus ? (
        <div className={styles.detailBlock}>
          <p className={styles.detailLabel}>
            Provisions<span>{number(row.provisions)}</span>
          </p>
          <span className={styles.stateBar} aria-hidden>
            {PROVISION_STATES.map((state) =>
              states[state] > 0 ? (
                <span key={state} data-state={state} style={{ width: `${(states[state] / Math.max(1, row.provisions)) * 100}%` }} />
              ) : null
            )}
          </span>
          <ul className={styles.detailStates}>
            {PROVISION_STATES.map((state) => (
              <li key={state}>
                <i className={styles.swatch} data-state={state} aria-hidden />
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
                <i className={styles.swatch} data-state={p.state} aria-hidden />
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
                <i className={styles.swatch} data-state={u.state} aria-hidden />
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
      : partRank(a.part) - partRank(b.part) || a.name.localeCompare(b.name)
  );
  const totals = Object.fromEntries(PROVISION_STATES.map((s) => [s, 0])) as Record<(typeof PROVISION_STATES)[number], number>;
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
