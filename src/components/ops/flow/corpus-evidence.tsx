import { CORPUS_FLAG_LABELS, type CorpusView } from "@/lib/axiom/corpus-releases";
import { ageLabel } from "@/lib/axiom/encoding-pipeline";
import styles from "./evidence.module.css";

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/**
 * The Program coverage tab's corpus stage, as evidence: per jurisdiction,
 * the release the site serves and since when, the newest signed release
 * that waits for activation, and the release its rulespec repo pins for the
 * encoder. Read from the corpus release tables and the repos' toolchain pins.
 */
export function CorpusEvidence({ view, referenceMs }: { view: CorpusView; referenceMs: number }) {
  const rows = view.jurisdictions.filter((j) => j.serving || j.newest || j.encoder?.release);
  const outOfSync = rows.filter((j) => j.flags.length > 0).length;
  return (
    <section className={styles.panel} aria-label="Corpus releases">
      <header className={styles.panelHead}>
        <h2>Corpus releases</h2>
        <p>
          What the site serves, what waits for activation, and what each encoder reads · {outOfSync} of {rows.length} out of sync
          {view.lastPublish ? ` · last publish ${day(view.lastPublish.at)} (${view.lastPublish.conclusion})` : ""}
          {view.openPrs ? ` · ${view.openPrs.count} open corpus PRs` : ""}
          {view.readAt ? ` · read ${ageLabel(view.readAt, referenceMs)} ago` : ""}
        </p>
      </header>
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label="Corpus releases by jurisdiction">
          <thead>
            <tr>
              <th scope="col">Jurisdiction</th>
              <th scope="col">Serves</th>
              <th scope="col" className={styles.num}>Since</th>
              <th scope="col">Signed, not activated</th>
              <th scope="col" className={styles.num}>Waiting</th>
              <th scope="col">Encoder pin</th>
              <th scope="col">Out of sync</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => {
              const waiting = j.next ?? j.other;
              return (
                <tr key={j.jurisdiction}>
                  <th scope="row">{j.name}</th>
                  <td className={styles.release}>{j.serving?.release ?? <span className={styles.none}>none</span>}</td>
                  <td className={styles.num}>{day(j.serving?.since)}</td>
                  <td className={styles.release}>
                    {waiting ? (
                      <>
                        {waiting.release}
                        <span className={styles.sub}>
                          {" "}
                          · {"adds" in waiting ? `adds ${waiting.adds} scopes` : `drops ${waiting.lacks.toLocaleString("en-US")} served scopes`}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td className={styles.num}>{waiting ? ageLabel(waiting.signedAt, referenceMs) : ""}</td>
                  <td className={styles.release}>
                    {j.encoder ? (
                      <>
                        {j.encoder.release ?? <span className={styles.none}>none</span>}
                        {j.encoder.state !== "signed" && j.encoder.release ? <span className={styles.sub}> · {j.encoder.state}</span> : null}
                      </>
                    ) : (
                      <span className={styles.none}>no repo</span>
                    )}
                  </td>
                  <td className={styles.flags}>{j.flags.map((f) => CORPUS_FLAG_LABELS[f]).join(" · ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
