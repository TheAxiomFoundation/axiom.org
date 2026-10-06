"use client";

import { useState } from "react";
import styles from "./bundle-grid.module.css";
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
type Shade = "encoded" | "unvalidated" | "partly" | "deferred" | "in_progress" | "failed" | "none" | "missing";

/** The bundle page's states and colors, in its order, for each count. */
const LEGEND: Record<Count, Array<[Shade, string]>> = {
  documents: [
    ["encoded", "Complete"],
    ["unvalidated", "Complete, not validated"],
    ["partly", "Partly encoded"],
    ["none", "Not started"],
    ["missing", "Not in the corpus"],
  ],
  provisions: [
    ["encoded", "Encoded"],
    ["unvalidated", "Encoded, not validated"],
    ["partly", "Partly encoded"],
    ["deferred", "Deferred"],
    ["in_progress", "In progress"],
    ["failed", "Failed"],
    ["none", "Not started"],
    ["missing", "Not in the corpus"],
  ],
};

/** A tier's counts as the page's bar segments, in its order. */
function segments(counts: TierCounts, count: Count): Array<[Shade, number]> {
  if (count === "documents") {
    const s = counts.byStatus;
    return [
      ["encoded", s.complete],
      ["unvalidated", s.unvalidated],
      ["partly", s.partly],
      ["none", s.not_started],
      ["missing", s.not_in_corpus],
    ];
  }
  const p = counts.byProvisionState;
  const known = p.encoded + p.unvalidated + p.partly + p.deferred + p.in_progress + p.failed + p.not_started;
  return [
    ["encoded", p.encoded],
    ["unvalidated", p.unvalidated],
    ["partly", p.partly],
    ["deferred", p.deferred],
    ["in_progress", p.in_progress],
    ["failed", p.failed],
    ["none", p.not_started],
    // Tier 1 counts the provisions PolicyEngine cites in documents the corpus does not hold.
    ["missing", Math.max(0, counts.provisions - known)],
  ];
}

/**
 * Every program bundle at a glance: a row per core program, a column for its
 * federal layer and one per state. Each cell is a small copy of its bundle
 * page's bar, in the same tier and count, with the page's colors: documents by
 * status, or provisions by state (Tier 1: the provisions PolicyEngine cites).
 * A cell opens its bundle in that count.
 */
export function BundleGrid({ bundles }: { bundles: BundleSummary[] }) {
  const [tier, setTier] = useState<BundleTierId>("screener");
  const [count, setCount] = useState<Count>("documents");
  if (!bundles.length) return null;
  const programs = [...new Set(bundles.map((b) => b.program))].sort(
    (a, b) => (PROGRAM_ORDER.indexOf(a) + 1 || 99) - (PROGRAM_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)
  );
  const states = [...new Set(bundles.map((b) => b.jurisdiction).filter((j) => j !== "us"))].sort();
  const columns = ["us", ...states];
  const byId = new Map(bundles.map((b) => [b.id, b]));
  const programTitle = (program: string) =>
    byId.get(`us/${program}`)?.title.replace(/: federal law$/, "") ?? program.toUpperCase();
  const unit = count === "documents" ? "documents" : tier === "screener" ? "cited provisions" : "provisions";
  const verb = count === "documents" ? "complete" : "encoded";

  return (
    <section className={styles.card} aria-labelledby="ops-bundles">
      <div className={styles.head}>
        <h2 id="ops-bundles" className={styles.heading}>
          Program bundles
        </h2>
        <div className={styles.switches}>
          <div className={styles.switch} role="radiogroup" aria-label="Tier">
            {(["screener", "full"] as BundleTierId[]).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={tier === value} onClick={() => setTier(value)}>
                {value === "screener" ? "Tier 1 · screener parity" : "Tier 2 · full bundle"}
              </button>
            ))}
          </div>
          <div className={styles.switch} role="radiogroup" aria-label="Count">
            {(["documents", "provisions"] as Count[]).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={count === value} onClick={() => setCount(value)}>
                {value === "documents" ? "Documents" : "Provisions"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className={styles.note}>
        {`Each cell is its bundle page's bar: ${unit} by state, left to right as on the page. A state's bundle includes the program's federal law.`}
      </p>
      <div className={styles.scroll}>
        <table
          className={styles.grid}
          aria-label={`Program bundles, ${tier === "screener" ? "Tier 1" : "Tier 2"}, ${count}`}
        >
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>
                Program
              </th>
              {columns.map((j) => (
                <th key={j} scope="col" className={styles.state}>
                  {j === "us" ? "US" : j.slice(3).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {programs.map((program) => (
              <tr key={program}>
                <th scope="row" className={styles.program}>
                  <a href={`/ops/bundles/us/${program}`}>{programTitle(program)}</a>
                </th>
                {columns.map((j) => {
                  const bundle = byId.get(`${j}/${program}`);
                  const counts = bundle?.counts[tier];
                  if (!bundle || !counts) return <td key={j} className={styles.cell} />;
                  const done =
                    count === "documents"
                      ? counts.byStatus.complete + counts.byStatus.unvalidated
                      : counts.byProvisionState.encoded + counts.byProvisionState.unvalidated;
                  const total = count === "documents" ? counts.documents : counts.provisions;
                  const share = total ? done / total : 0;
                  const text = `${bundle.title}: ${number(done)} of ${number(total)} ${unit} ${verb}${
                    total ? ` (${Math.round(share * 100)}%)` : ""
                  }`;
                  const parts = segments(counts, count);
                  const width = parts.reduce((t, [, n]) => t + n, 0);
                  return (
                    <td key={j} className={styles.cell}>
                      <a
                        href={`/ops/bundles/${bundle.id}${count === "provisions" ? "?count=provisions" : ""}`}
                        className={styles.bar}
                        data-empty={width ? undefined : true}
                        title={text}
                        aria-label={text}
                      >
                        {parts.map(([shade, n]) =>
                          n > 0 ? <span key={shade} data-shade={shade} style={{ flexGrow: n }} /> : null
                        )}
                      </a>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={styles.legend} aria-label="States">
        {LEGEND[count].map(([shade, name]) => (
          <li key={shade}>
            <i className={styles.swatch} data-shade={shade} aria-hidden />
            {name}
          </li>
        ))}
        <li>
          <i className={styles.swatch} data-empty aria-hidden />
          Nothing to count yet
        </li>
      </ul>
    </section>
  );
}
