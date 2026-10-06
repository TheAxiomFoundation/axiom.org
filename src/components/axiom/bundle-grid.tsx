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

type Count = "documents" | "provisions";

/**
 * Every program bundle at a glance: a row per core program, a column for its
 * federal layer and one per state. Each cell is shaded by the same number its
 * bundle page leads with, in the same tier and count: documents complete, or
 * provisions encoded (Tier 1: the provisions PolicyEngine cites). A cell opens
 * its bundle in that count.
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
        {`Share of ${unit} ${verb}, by program and state: the number each bundle's page leads with. A state's bundle includes the program's federal law.`}
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
                  return (
                    <td key={j} className={styles.cell}>
                      <a
                        href={`/ops/bundles/${bundle.id}${count === "provisions" ? "?count=provisions" : ""}`}
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
      <ul className={styles.legend} aria-label={`Share ${verb}`}>
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
