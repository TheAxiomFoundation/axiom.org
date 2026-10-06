"use client";

import { useState } from "react";
import styles from "./bundle-overview.module.css";
import type { BundleTierId, TierCounts } from "@/lib/axiom/program-bundles";
import type { BundleSummary } from "@/lib/axiom/program-bundles-data";

const number = (value: number) => value.toLocaleString("en-US");

/** The core programs, in the order the plan names them. */
const PROGRAM_ORDER = [
  "snap",
  "medicaid",
  "chip",
  "tanf",
  "ssi",
  "ccdf",
  "liheap",
  "wic",
  "ui",
  "medicare",
  "income_tax",
  "eitc",
  "ctc",
];

type Count = "documents" | "provisions";
type Sort = BundleTierId | "name";

interface Share {
  done: number;
  total: number;
}

/** A tier's headline, as its bundle page leads with it: documents complete, or provisions encoded. */
function shareOf(counts: TierCounts | undefined, count: Count): Share {
  if (!counts) return { done: 0, total: 0 };
  if (count === "documents") {
    return { done: counts.byStatus.complete + counts.byStatus.unvalidated, total: counts.documents };
  }
  return { done: counts.byProvisionState.encoded + counts.byProvisionState.unvalidated, total: counts.provisions };
}

const ratio = (s: Share) => (s.total ? s.done / s.total : 0);
const percent = (s: Share) => (s.total ? `${Math.round(ratio(s) * 100)}%` : "—");

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One share as a bar: encoded in green on a grey track, the exact count beside it. */
function Meter({ share, unit }: { share: Share; unit: string }) {
  return (
    <span className={styles.meter}>
      <span className={styles.track} aria-hidden>
        <span className={styles.fill} style={{ width: `${ratio(share) * 100}%` }} />
      </span>
      <strong className={styles.percent}>{percent(share)}</strong>
      <span className={styles.figure}>
        {number(share.done)} of {number(share.total)} {unit}
      </span>
    </span>
  );
}

/**
 * Every program bundle, in two steps: the programs, each with its states'
 * median share; then the chosen program's federal law and each state, with
 * both tiers side by side and the exact counts. Each share is the number the
 * bundle's page leads with, in the same count; a state opens its bundle.
 */
export function BundleOverview({ bundles }: { bundles: BundleSummary[] }) {
  const programs = [...new Set(bundles.map((b) => b.program))].sort(
    (a, b) => (PROGRAM_ORDER.indexOf(a) + 1 || 99) - (PROGRAM_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)
  );
  const [count, setCount] = useState<Count>("documents");
  const [program, setProgram] = useState(programs[0]);
  const [sort, setSort] = useState<Sort>("screener");
  if (!bundles.length) return null;

  const byId = new Map(bundles.map((b) => [b.id, b]));
  const title = (p: string) => byId.get(`us/${p}`)?.title.replace(/: federal law$/, "") ?? p.toUpperCase();
  const unit = (tier: BundleTierId) =>
    count === "documents" ? "documents" : tier === "screener" ? "cited provisions" : "provisions";
  const statesOf = (p: string) => bundles.filter((b) => b.program === p && b.jurisdiction !== "us");
  const medianOf = (p: string, tier: BundleTierId) =>
    median(statesOf(p).map((b) => shareOf(b.counts[tier], count)).filter((s) => s.total).map(ratio));

  const federal = byId.get(`us/${program}`);
  const states = [...statesOf(program)].sort((a, b) =>
    sort === "name"
      ? a.title.localeCompare(b.title)
      : ratio(shareOf(b.counts[sort], count)) - ratio(shareOf(a.counts[sort], count)) || a.title.localeCompare(b.title)
  );
  const link = (id: string) => `/ops/bundles/${id}${count === "provisions" ? "?count=provisions" : ""}`;
  const head = (key: Sort, label: string) => (
    <th scope="col" aria-sort={sort === key ? (key === "name" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => setSort(key)}>
        {label}
      </button>
    </th>
  );

  return (
    <section className={styles.card} aria-labelledby="ops-bundles">
      <div className={styles.head}>
        <div>
          <h2 id="ops-bundles" className={styles.heading}>
            Program bundles
          </h2>
          <p className={styles.note}>
            {count === "documents"
              ? "Documents complete, as each bundle's page leads with them."
              : "Provisions encoded (Tier 1: the provisions PolicyEngine cites), as each bundle's page counts them."}{" "}
            A state&apos;s bundle includes the program&apos;s federal law.
          </p>
        </div>
        <div className={styles.switch} role="radiogroup" aria-label="Count">
          {(["documents", "provisions"] as Count[]).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={count === value} onClick={() => setCount(value)}>
              {value === "documents" ? "Documents" : "Provisions"}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.layout}>
        <ul className={styles.programs} aria-label="Programs">
          {programs.map((p) => {
            const tier1 = medianOf(p, "screener");
            return (
              <li key={p}>
                <button type="button" aria-pressed={p === program} onClick={() => setProgram(p)}>
                  <span className={styles.programName}>{title(p)}</span>
                  <span className={styles.track} aria-hidden>
                    <span className={styles.fill} style={{ width: `${(tier1 ?? 0) * 100}%` }} />
                  </span>
                  <span className={styles.programFigure}>
                    {tier1 == null ? "—" : `${Math.round(tier1 * 100)}%`}
                  </span>
                </button>
              </li>
            );
          })}
          <li className={styles.programsNote}>Tier 1, median state</li>
        </ul>

        <div className={styles.states}>
          <h3 className={styles.statesTitle}>{title(program)}</h3>
          <table className={styles.table} aria-label={`${title(program)} by state`}>
            <thead>
              <tr>
                {head("name", "State")}
                {head("screener", "Tier 1 · screener parity")}
                {head("full", "Tier 2 · full bundle")}
              </tr>
            </thead>
            <tbody>
              {federal && (
                <tr className={styles.federal}>
                  <th scope="row">
                    <a href={link(federal.id)}>Federal law</a>
                    <span>shared by every state</span>
                  </th>
                  <td>
                    <Meter share={shareOf(federal.counts.screener, count)} unit={unit("screener")} />
                  </td>
                  <td>
                    <Meter share={shareOf(federal.counts.full, count)} unit={unit("full")} />
                  </td>
                </tr>
              )}
              {states.map((b) => (
                <tr key={b.id}>
                  <th scope="row">
                    <a href={link(b.id)}>{b.title.replace(new RegExp(` ${title(program)}$`), "")}</a>
                  </th>
                  <td>
                    <Meter share={shareOf(b.counts.screener, count)} unit={unit("screener")} />
                  </td>
                  <td>
                    <Meter share={shareOf(b.counts.full, count)} unit={unit("full")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
