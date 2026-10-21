import { CAUSE_ORIGINS, type CauseOrigin, type FlowModel } from "@/lib/axiom/pipeline-flow";
import styles from "./flow.module.css";

/** Where the reasons on the page come from: the system behind each kind of reason that the stations show. */
export function ReasonSources({ model }: { model: FlowModel }) {
  const origins = new Set<CauseOrigin>();
  for (const s of model.stations) for (const c of [...s.flow.exit_causes, ...s.flow.wait_causes.slice(0, 1)]) origins.add(c.origin);
  if (!origins.size) return null;
  const order = Object.keys(CAUSE_ORIGINS) as CauseOrigin[];
  return (
    <section className={styles.section}>
      <h2>Where do these reasons come from?</h2>
      <p>Each reason is the id or text that a system reported, tagged with that system. Nothing on this page is a fixed list of errors.</p>
      <dl className={styles.origins}>
        {order
          .filter((o) => origins.has(o))
          .map((o) => (
            <div key={o}>
              <dt>
                <span className={styles.originTag} data-origin={o}>
                  {CAUSE_ORIGINS[o].label}
                </span>
              </dt>
              <dd>{CAUSE_ORIGINS[o].source}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
