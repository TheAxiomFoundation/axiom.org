import { ArrowDown, ArrowRight, User } from "lucide-react";
import { formatDuration, PERSON_STATIONS, type StationStats } from "@/lib/axiom/pipeline-flow";
import { reasonLabel, type PhaseRow } from "./pipeline-evidence";
import styles from "./evidence.module.css";

const n = (value: number) => value.toLocaleString("en-US");

/**
 * The line as a diagram: one row per phase, its stages in order. Each stage
 * shows how many cases reached it, the share that passed, its median time
 * and how many left the line there.
 */
export function PipelineDiagram({ phases }: { phases: PhaseRow[] }) {
  return (
    <figure className={styles.diagram} aria-label="The pipeline as a diagram">
      {phases.map((phase, p) => {
        return (
          <div key={phase.id} className={styles.diagramPhase}>
            <div className={styles.diagramRow}>
              <span className={styles.diagramPhaseLabel}>{phase.label}</span>
              <ol className={styles.diagramStages}>
                {phase.stations.map((s, i) => (
                  <li key={s.id} className={styles.diagramStep}>
                    {i > 0 ? <ArrowRight size={14} aria-hidden className={styles.diagramArrow} /> : null}
                    <Node s={s} />
                  </li>
                ))}
              </ol>
            </div>
            {p < phases.length - 1 ? <ArrowDown size={14} aria-hidden className={styles.diagramDown} /> : null}
          </div>
        );
      })}
    </figure>
  );
}

function Node({ s }: { s: StationStats }) {
  const finished = s.ok + s.failed + s.cancelled;
  const left = s.flow.failed_here + s.flow.cancelled_here;
  const top = s.flow.exit_causes[0];
  const person = PERSON_STATIONS.has(s.id);
  return (
    <div className={person ? `${styles.node} ${styles.nodePerson}` : styles.node} title={s.description}>
      <span className={styles.nodeLabel}>
        {s.label}
        {person ? <User size={12} aria-label="A person acts here" className={styles.person} /> : null}
      </span>
      <span className={styles.nodeCount}>{n(s.cases)}</span>
      <span className={styles.nodeLine}>
        {finished ? `${Math.round((s.ok / finished) * 100)}% passed` : "–"}
        {s.timed && s.p50_ms != null ? ` · ${formatDuration(s.p50_ms)}` : ""}
      </span>
      {s.tries && s.tries.ok < s.tries.total ? (
        <span className={styles.nodeLine}>
          tries: {n(s.tries.ok)} of {n(s.tries.total)} passed
        </span>
      ) : null}
      {left ? (
        <span className={styles.nodeExit} title={top ? `Main reason: ${reasonLabel(top.cause)} (${n(top.cases)})` : undefined}>
          {n(left)} left the line
        </span>
      ) : null}
    </div>
  );
}
