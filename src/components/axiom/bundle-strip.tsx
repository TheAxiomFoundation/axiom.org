import styles from "./bundle-strip.module.css";
import type { BundleSummary } from "@/lib/axiom/program-bundles-data";

const number = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * The way from /ops to each program bundle: its title, and per tier how much
 * is encoded (Tier 1 counts the provisions PolicyEngine cites) and how many
 * documents are complete.
 */
export function BundleStrip({ bundles }: { bundles: BundleSummary[] }) {
  if (!bundles.length) return null;
  return (
    <section className={styles.strip} aria-labelledby="ops-bundles">
      <h2 id="ops-bundles" className={styles.heading}>
        Program bundles
      </h2>
      <ul className={styles.list}>
        {bundles.map((bundle) => (
          <li key={bundle.id}>
            <a className={styles.bundle} href={`/ops/bundles/${bundle.id}`}>
              <span className={styles.title}>
                {bundle.title} <span aria-hidden>→</span>
              </span>
              {bundle.tiers.map((tier, index) => {
                const c = tier.counts;
                const done = c.byProvisionState.encoded + c.byProvisionState.unvalidated;
                const complete = c.byStatus.complete + c.byStatus.unvalidated;
                return (
                  <span key={tier.id} className={styles.tier}>
                    <span className={styles.tierName}>
                      Tier {index + 1} · {tier.title}
                    </span>
                    <span>
                      <strong>{number(done)}</strong> of {number(c.provisions)}{" "}
                      {tier.id === "screener" ? "cited provisions" : "provisions"} encoded
                      <em>{percent(done, c.provisions)}</em>
                    </span>
                    <span className={styles.muted}>
                      {number(complete)} of {number(c.documents)} documents complete
                    </span>
                  </span>
                );
              })}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
