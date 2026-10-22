import type { PipelineEvent } from "@/lib/axiom/pipeline-events";
import styles from "./flow.module.css";

/**
 * Validation waivers by repo: how many modules each repo's
 * known-validation-gaps.yaml waives, and when the first of them expires.
 * They come from the event log's waiver_ledger rows (the backfill's
 * --waivers pass).
 */
export function Waivers({ events, referenceMs }: { events: PipelineEvent[]; referenceMs: number }) {
  const byRepo = new Map<string, { count: number; next: string | null; href: string }>();
  for (const e of events) {
    if (e.source !== "waiver_ledger") continue;
    const repo = typeof e.attrs.repo === "string" ? e.attrs.repo : (e.jurisdiction ?? "?");
    const expires = typeof e.attrs.expires_at === "string" ? e.attrs.expires_at : null;
    const entry = byRepo.get(repo) ?? { count: 0, next: null, href: `https://github.com/TheAxiomFoundation/${repo}/blob/main/known-validation-gaps.yaml` };
    entry.count++;
    if (expires && (!entry.next || expires < entry.next)) entry.next = expires;
    byRepo.set(repo, entry);
  }
  const rows = [...byRepo.entries()].sort((a, b) => b[1].count - a[1].count);
  const day = 86_400_000;
  return (
    <section aria-label="Validation waivers">
      <h2 className={styles.sectionTitle}>Validation waivers</h2>
      {rows.length ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Repo</th>
              <th scope="col">Waived modules</th>
              <th scope="col">First expiry</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([repo, w]) => {
              const days = w.next ? Math.round((Date.parse(w.next) - referenceMs) / day) : null;
              return (
                <tr key={repo}>
                  <th scope="row">
                    <a href={w.href}>{repo}</a>
                  </th>
                  <td>{w.count.toLocaleString("en-US")}</td>
                  <td>{w.next ? `${w.next.slice(0, 10)} (${days != null && days < 0 ? `${-days} days ago` : `in ${days} days`})` : "none set"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className={styles.note}>
          No waiver rows in the event log. They come from each RuleSpec repo&apos;s <code>known-validation-gaps.yaml</code> when the events backfill runs with{" "}
          <code>--waivers</code>.
        </p>
      )}
      <p className={styles.note}>A waived module counts as merged, not accepted, on the Output tab.</p>
    </section>
  );
}
