import { formatDuration, PERSON_STATIONS, type StationStats } from "@/lib/axiom/pipeline-flow";
import { reasonLabel, type PhaseRow } from "./pipeline-evidence";
import styles from "./diagram.module.css";

const n = (value: number) => value.toLocaleString("en-US");

// The drawing's grid, in viewBox units.
const LABEL_W = 92;
const COL_W = 236;
const NODE_W = 188;
const NODE_H = 104;
const ROW_H = 196;
const TOP = 44;
const WIDTH = LABEL_W + 4 * COL_W - (COL_W - NODE_W) + 16;

interface Placed {
  s: StationStats;
  x: number;
  y: number;
}

/** Line width for a flow of `cases`, on a square-root scale so small flows stay visible. */
function flowWidth(cases: number, max: number): number {
  return cases > 0 ? 1.5 + 9 * Math.sqrt(cases / max) : 0;
}

/**
 * The line as a diagram on a dark screen: one row per phase, each stage a
 * node with how many cases reached it, the share that passed (and its
 * bar), its median time, and how many left the line there. Lines between
 * stages are as wide as the cases that reached the next one; the encode
 * loop shows its retries. Stages where a person acts are marked.
 */
export function PipelineDiagram({ phases }: { phases: PhaseRow[] }) {
  const placed: Placed[][] = phases.map((phase, r) =>
    phase.stations.map((s, c) => ({ s, x: LABEL_W + c * COL_W, y: TOP + r * ROW_H }))
  );
  const all = placed.flat();
  const max = Math.max(1, ...all.map((p) => p.s.cases));
  const height = TOP + phases.length * ROW_H - 40;
  const generate = all.find((p) => p.s.id === "generate");
  const validate = all.find((p) => p.s.id === "validate");
  const retries = generate?.s.tries ? Math.max(0, generate.s.tries.total - generate.s.cases) : 0;

  return (
    <figure className={styles.screen} aria-label="The pipeline as a diagram">
      <div className={styles.scroll}>
        <svg viewBox={`0 0 ${WIDTH} ${height}`} className={styles.svg} role="img" aria-label="Stages of the encoding pipeline">
          <defs>
            <pattern id="ops-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" className={styles.grid} />
            </pattern>
            <marker id="ops-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.arrowHead} />
            </marker>
            <marker id="ops-loop-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.loopHead} />
            </marker>
          </defs>
          <rect width={WIDTH} height={height} fill="url(#ops-grid)" />

          {phases.map((phase, r) => (
            <text key={phase.id} x={14} y={TOP + r * ROW_H + NODE_H / 2 + 4} className={styles.phase}>
              {phase.label.toUpperCase()}
            </text>
          ))}

          {/* Flows inside a phase: node to node. */}
          {placed.map((row) =>
            row.slice(1).map((to, i) => {
              const from = row[i];
              const y = from.y + NODE_H / 2;
              const d = `M ${from.x + NODE_W} ${y} L ${to.x - 6} ${y}`;
              return <Flow key={`${from.s.id}-${to.s.id}`} d={d} width={flowWidth(to.s.cases, max)} cases={to.s.cases} label={to.s.label} />;
            })
          )}

          {/* Flows between phases: from the last stage of a row down to the first of the next. */}
          {placed.slice(1).map((row, r) => {
            const from = placed[r].at(-1);
            const to = row[0];
            if (!from || !to) return null;
            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y - 6;
            const mid = (y1 + y2) / 2 + 8;
            const k = 18;
            const d = `M ${x1} ${y1} L ${x1} ${mid - k} Q ${x1} ${mid} ${x1 - k} ${mid} L ${x2 + k} ${mid} Q ${x2} ${mid} ${x2} ${mid + k} L ${x2} ${y2}`;
            return <Flow key={`${from.s.id}-${to.s.id}`} d={d} width={flowWidth(to.s.cases, max)} cases={to.s.cases} label={to.s.label} />;
          })}

          {/* The encode loop: a rejected try goes back to Generate. */}
          {generate && validate && retries > 0 ? (
            <g>
              <path
                d={`M ${validate.x + 44} ${validate.y + NODE_H} C ${validate.x + 44} ${validate.y + NODE_H + 30}, ${generate.x + NODE_W - 44} ${generate.y + NODE_H + 30}, ${generate.x + NODE_W - 44} ${generate.y + NODE_H + 6}`}
                className={styles.loop}
                markerEnd="url(#ops-loop-arrow)"
              />
              <text x={(generate.x + NODE_W + validate.x) / 2} y={generate.y + NODE_H + 40} textAnchor="middle" className={styles.loopText}>
                ↺ {n(retries)} retries
              </text>
            </g>
          ) : null}

          {all.map((p) => (
            <Node key={p.s.id} {...p} />
          ))}
        </svg>
      </div>
      <figcaption className={styles.caption}>
        <span>
          <i className={styles.keyFlow} /> line width: cases that reached the stage
        </span>
        <span>
          <i className={styles.keyPerson} /> a person acts
        </span>
        <span>
          <i className={styles.keyExit} /> left the line there
        </span>
      </figcaption>
    </figure>
  );
}

function Flow({ d, width, cases, label }: { d: string; width: number; cases: number; label: string }) {
  if (!width) return null;
  return (
    <g>
      <title>{`${n(cases)} reached ${label}`}</title>
      <path d={d} className={styles.flow} strokeWidth={width} markerEnd="url(#ops-arrow)" />
      <path d={d} className={styles.pulse} />
    </g>
  );
}

function Node({ s, x, y }: Placed) {
  const finished = s.ok + s.failed + s.cancelled;
  const left = s.flow.failed_here + s.flow.cancelled_here;
  const top = s.flow.exit_causes[0];
  const person = PERSON_STATIONS.has(s.id);
  const barW = NODE_W - 28;
  const okW = finished ? (s.ok / finished) * barW : 0;
  const failW = finished ? (s.failed / finished) * barW : 0;
  const cancelW = finished ? (s.cancelled / finished) * barW : 0;
  const line = [finished ? `${Math.round((s.ok / finished) * 100)}% passed` : "no finished visits", s.timed && s.p50_ms != null ? formatDuration(s.p50_ms) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <g>
      <title>{`${s.label}: ${s.description}`}</title>
      <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={12} className={person ? styles.nodePerson : styles.node} />
      <text x={x + 14} y={y + 20} className={person ? styles.nodeLabelPerson : styles.nodeLabel}>
        {s.label.toUpperCase()}
        {person ? " · PERSON" : ""}
      </text>
      <text x={x + 14} y={y + 48} className={styles.nodeCount}>
        {n(s.cases)}
      </text>
      <text x={x + 14} y={y + 66} className={styles.nodeLine}>
        {line}
      </text>
      {s.tries && s.tries.ok < s.tries.total ? (
        <text x={x + 14} y={y + 82} className={styles.nodeTries}>
          tries: {n(s.tries.ok)} of {n(s.tries.total)} passed
        </text>
      ) : null}
      <rect x={x + 14} y={y + NODE_H - 15} width={barW} height={4} rx={2} className={styles.barTrack} />
      {okW > 0 ? <rect x={x + 14} y={y + NODE_H - 15} width={okW} height={4} rx={2} className={styles.barOk} /> : null}
      {failW > 0 ? <rect x={x + 14 + okW} y={y + NODE_H - 15} width={failW} height={4} className={styles.barFail} /> : null}
      {cancelW > 0 ? <rect x={x + 14 + okW + failW} y={y + NODE_H - 15} width={cancelW} height={4} className={styles.barCancel} /> : null}
      {left ? (
        <g>
          <title>{top ? `Main reason: ${reasonLabel(top.cause)} (${n(top.cases)})` : "Left the line here"}</title>
          <path d={`M ${x + NODE_W - 26} ${y + NODE_H} L ${x + NODE_W - 26} ${y + NODE_H + 16}`} className={styles.exit} />
          <text x={x + NODE_W - 20} y={y + NODE_H + 15} className={styles.exitText}>
            {n(left)} left the line
          </text>
        </g>
      ) : null}
    </g>
  );
}
