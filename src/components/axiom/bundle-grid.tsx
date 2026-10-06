"use client";

import { useState } from "react";
import styles from "./bundle-grid.module.css";
import type { BundleTierId } from "@/lib/axiom/program-bundles";
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

/** Shares encoded, as five steps of one green. */
const STEPS = [
  { min: 0.5, label: "50% or more" },
  { min: 0.25, label: "25–49%" },
  { min: 0.1, label: "10–24%" },
  { min: Number.MIN_VALUE, label: "Under 10%" },
  { min: 0, label: "None yet" },
];
const step = (share: number) => STEPS.findIndex((s) => share >= s.min);

/**
 * Every program bundle at a glance: a row per core program, a column for its
 * federal layer and one per state, each cell shaded by how much of the tier is
 * encoded (Tier 1: the provisions PolicyEngine cites; Tier 2: every provision
 * in the corpus). A cell opens its bundle.
 */
export function BundleGrid({ bundles }: { bundles: BundleSummary[] }) {
  const [tier, setTier] = useState<BundleTierId>("screener");
  if (!bundles.length) return null;
  const programs = [...new Set(bundles.map((b) => b.program))].sort(
    (a, b) => (PROGRAM_ORDER.indexOf(a) + 1 || 99) - (PROGRAM_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)
  );
  const states = [...new Set(bundles.map((b) => b.jurisdiction).filter((j) => j !== "us"))].sort();
  const columns = ["us", ...states];
  const byId = new Map(bundles.map((b) => [b.id, b]));
  const programTitle = (program: string) =>
    byId.get(`us/${program}`)?.title.replace(/: federal law$/, "") ?? program.toUpperCase();
  const unit = tier === "screener" ? "cited provisions" : "provisions";

  return (
    <section className={styles.card} aria-labelledby="ops-bundles">
      <div className={styles.head}>
        <h2 id="ops-bundles" className={styles.heading}>
          Program bundles
        </h2>
        <div className={styles.switch} role="radiogroup" aria-label="Tier">
          {(["screener", "full"] as BundleTierId[]).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={tier === value} onClick={() => setTier(value)}>
              {value === "screener" ? "Tier 1 · screener parity" : "Tier 2 · full bundle"}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.note}>
        {`Share of ${unit} encoded, by program and state. A state's bundle includes the program's federal law.`}
      </p>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={`Program bundles, ${tier === "screener" ? "Tier 1" : "Tier 2"}`}>
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
                  const done = counts.byProvisionState.encoded + counts.byProvisionState.unvalidated;
                  const total = counts.provisions;
                  const share = total ? done / total : 0;
                  const text = `${bundle.title}: ${number(done)} of ${number(total)} ${unit} encoded${
                    total ? ` (${Math.round(share * 100)}%)` : ""
                  }`;
                  return (
                    <td key={j} className={styles.cell}>
                      <a
                        href={`/ops/bundles/${bundle.id}`}
                        className={styles.swatch}
                        data-step={total ? step(share) : "empty"}
                        title={text}
                        aria-label={text}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={styles.legend} aria-label="Share encoded">
        {STEPS.map((s, index) => (
          <li key={s.label}>
            <i className={styles.swatch} data-step={index} aria-hidden />
            {s.label}
          </li>
        ))}
        <li>
          <i className={styles.swatch} data-step="empty" aria-hidden />
          Nothing to count yet
        </li>
      </ul>
    </section>
  );
}
