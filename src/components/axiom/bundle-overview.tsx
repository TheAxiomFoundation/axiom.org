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
 * Every program bundle, in two steps: the programs, each with its
 * completeness across the federal law and every state; then the chosen
 * program's federal law and each state, with
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
  // The tier the program list summarizes; choosing one also sorts the states by it.
  const [tier, setTier] = useState<BundleTierId>("screener");
  const chooseTier = (next: BundleTierId) => {
    setTier(next);
    setSort(next);
  };
  if (!bundles.length) return null;

  const byId = new Map(bundles.map((b) => [b.id, b]));
  const title = (p: string) => byId.get(`us/${p}`)?.title.replace(/: federal law$/, "") ?? p.toUpperCase();
  const unit = (tier: BundleTierId) =>
    count === "documents" ? "documents" : tier === "screener" ? "cited provisions" : "provisions";
  const statesOf = (p: string) => bundles.filter((b) => b.program === p && b.jurisdiction !== "us");
  /**
   * A program's completeness: every document (or provision) of its bundles,
   * each once. A state's counts add the federal layer, and counts add up, so
   * the federal layer counts once and each state adds only its own.
   */
  const completeness = (p: string, t: BundleTierId): Share => {
    const federalShare = shareOf(byId.get(`us/${p}`)?.counts[t], count);
    return statesOf(p).reduce(
      (sum, b) => {
        const s = shareOf(b.counts[t], count);
        return { done: sum.done + s.done - federalShare.done, total: sum.total + s.total - federalShare.total };
      },
      { ...federalShare }
    );
  };

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
        <div className={styles.programsPane}>
          <div className={styles.columnHead}>
            <span>Program</span>
            <span className={styles.tierToggle} role="radiogroup" aria-label="Completeness, by tier">
              <span>Completeness</span>
              {(["screener", "full"] as BundleTierId[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={tier === value}
                  onClick={() => chooseTier(value)}
                >
                  {value === "screener" ? "Tier 1" : "Tier 2"}
                </button>
              ))}
            </span>
          </div>
          <ul className={styles.programs} aria-label="Programs">
          {programs.map((p) => {
            const whole = completeness(p, tier);
            const states = statesOf(p).length;
            return (
              <li key={p}>
                <button
                  type="button"
                  aria-pressed={p === program}
                  onClick={() => setProgram(p)}
                  title={`${title(p)}: ${number(whole.done)} of ${number(whole.total)} ${unit(tier)} ${
                    count === "documents" ? "complete" : "encoded"
                  }, across the federal law and ${states} ${states === 1 ? "state" : "states"}`}
                >
                  <span className={styles.programName}>{title(p)}</span>
                  <span className={styles.track} aria-hidden>
                    <span className={styles.fill} style={{ width: `${ratio(whole) * 100}%` }} />
                  </span>
                  <span className={styles.programFigure}>{percent(whole)}</span>
                </button>
              </li>
            );
          })}
          </ul>
        </div>

        <div className={styles.states}>
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
