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
/** Between two stages stacked in one column: room for the upper one's exit note. */
const LANE_GAP = 34;
const WIDTH = LABEL_W + 4 * COL_W - (COL_W - NODE_W) + 16;

interface Placed {
  s: StationStats;
  x: number;
  y: number;
}

interface RowLayout {
  top: number;
  height: number;
  /** The row's columns, left to right; parallel stages share a column, stacked. */
  cols: Placed[][];
}

/** Each phase as a row of columns. A run of parallel stages takes one column and makes its row taller. */
export function layoutRows(phases: PhaseRow[]): RowLayout[] {
  let top = TOP;
  return phases.map((phase) => {
    const parallel = new Set(phase.parallel ?? []);
    const cols: StationStats[][] = [];
    for (const s of phase.stations) {
      const last = cols.at(-1);
      if (last && parallel.has(s.id) && parallel.has(last[0].id)) last.push(s);
      else cols.push([s]);
    }
    const stackH = (count: number) => count * NODE_H + (count - 1) * LANE_GAP;
    const height = stackH(Math.max(1, ...cols.map((col) => col.length)));
    const row: RowLayout = {
      top,
      height,
      cols: cols.map((col, c) => {
        const y0 = top + (height - stackH(col.length)) / 2;
        return col.map((s, i) => ({ s, x: LABEL_W + c * COL_W, y: y0 + i * (NODE_H + LANE_GAP) }));
      }),
    };
    top += height + ROW_H - NODE_H;
    return row;
  });
}

/** From one node's right side to another's left side; a curve when they sit at different heights. */
function sidePath(from: Placed, to: Placed): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x - 6;
  const y2 = to.y + NODE_H / 2;
  if (y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const dx = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/** A short note in lines of at most `width` characters, at most `max` lines. */
export function wrapWords(text: string, width = 26, max = 2): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last != null && last.length + 1 + word.length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = `${lines[max - 1].slice(0, width - 1)}…`;
  }
  return lines;
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
  const rows = layoutRows(phases);
  const all = rows.flatMap((row) => row.cols.flat());
  const max = Math.max(1, ...all.map((p) => p.s.cases));
  const lastRow = rows.at(-1);
  const height = lastRow ? lastRow.top + lastRow.height + ROW_H - NODE_H - 40 : TOP;
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

          {rows.map((row, r) => (
            <text key={phases[r].id} x={14} y={row.top + row.height / 2 + 4} className={styles.phase}>
              {phases[r].label.toUpperCase()}
            </text>
          ))}

          {/* Parallel stages: a note above their column. */}
          {rows.flatMap((row) =>
            row.cols
              .filter((col) => col.length > 1)
              .map((col) => (
                <text key={`par-${col[0].s.id}`} x={col[0].x + NODE_W / 2} y={col[0].y - 10} textAnchor="middle" className={styles.phase}>
                  IN PARALLEL
                </text>
              ))
          )}

          {/* Flows inside a phase: each node of a column to each node of the next (a fork into parallel stages). */}
          {rows.flatMap((row) =>
            row.cols.slice(1).flatMap((tos, c) =>
              row.cols[c].flatMap((from) =>
                tos.map((to) => {
                  const d = sidePath(from, to);
                  // The line runs through a stage that is not measured: a dashed connector, no width.
                  if (from.s.unmeasured || to.s.unmeasured) return <path key={`${from.s.id}-${to.s.id}`} d={d} className={styles.ghostFlow} markerEnd="url(#ops-arrow)" />;
                  return <Flow key={`${from.s.id}-${to.s.id}`} d={d} width={flowWidth(to.s.cases, max)} cases={to.s.cases} label={to.s.label} />;
                })
              )
            )
          )}

          {/* Flows between phases: from the last stage of a row down to the first of the next. Parallel last stages join first. */}
          {rows.slice(1).map((row, r) => {
            const froms = rows[r].cols.at(-1) ?? [];
            const to = row.cols[0]?.[0];
            if (!froms.length || !to) return null;
            const k = 18;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y - 6;
            if (froms.length === 1) {
              const from = froms[0];
              const x1 = from.x + NODE_W / 2;
              const y1 = from.y + NODE_H;
              const mid = (y1 + y2) / 2 + 8;
              const d = `M ${x1} ${y1} L ${x1} ${mid - k} Q ${x1} ${mid} ${x1 - k} ${mid} L ${x2 + k} ${mid} Q ${x2} ${mid} ${x2} ${mid + k} L ${x2} ${y2}`;
              return <Flow key={`${from.s.id}-${to.s.id}`} d={d} width={flowWidth(to.s.cases, max)} cases={to.s.cases} label={to.s.label} />;
            }
            // Each parallel stage runs right to a join beside the column, then one line runs down.
            const jx = froms[0].x + NODE_W + (COL_W - NODE_W) / 2;
            const jy = rows[r].top + rows[r].height;
            const mid = (jy + y2) / 2 + 8;
            const down = `M ${jx} ${jy} L ${jx} ${mid - k} Q ${jx} ${mid} ${jx - k} ${mid} L ${x2 + k} ${mid} Q ${x2} ${mid} ${x2} ${mid + k} L ${x2} ${y2}`;
            return (
              <g key={`join-${to.s.id}`}>
                {froms.map((from) => {
                  const y = from.y + NODE_H / 2;
                  const d = `M ${from.x + NODE_W} ${y} L ${jx - k} ${y} Q ${jx} ${y} ${jx} ${y + k} L ${jx} ${jy}`;
                  if (from.s.unmeasured) return <path key={from.s.id} d={d} className={styles.ghostFlow} />;
                  return <Flow key={from.s.id} d={d} width={flowWidth(from.s.cases, max)} cases={from.s.cases} label={from.s.label} arrow={false} verb="left" />;
                })}
                <Flow d={down} width={flowWidth(to.s.cases, max)} cases={to.s.cases} label={to.s.label} />
              </g>
            );
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
        {all.some((p) => p.s.unmeasured) ? (
          <span>
            <i className={styles.keyGhost} /> not measured yet
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

function Flow({ d, width, cases, label, arrow = true, verb = "reached" }: { d: string; width: number; cases: number; label: string; arrow?: boolean; verb?: "reached" | "left" }) {
  if (!width) return null;
  return (
    <g>
      <title>{`${n(cases)} ${verb} ${label}`}</title>
      <path d={d} className={styles.flow} strokeWidth={width} markerEnd={arrow ? "url(#ops-arrow)" : undefined} />
      <path d={d} className={styles.pulse} />
    </g>
  );
}

function Node({ s, x, y }: Placed) {
  if (s.unmeasured) return <GhostNode s={s} x={x} y={y} />;
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

/** A stage of the line no event reached yet: dashed, with why it is not measured. */
function GhostNode({ s, x, y }: Placed) {
  const person = PERSON_STATIONS.has(s.id);
  return (
    <g>
      <title>{`${s.label}: ${s.description} Not measured: ${s.unmeasured}.`}</title>
      <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={12} className={styles.nodeGhost} />
      <text x={x + 14} y={y + 20} className={person ? styles.nodeLabelPerson : styles.nodeLabel}>
        {s.label.toUpperCase()}
        {person ? " · PERSON" : ""}
      </text>
      <text x={x + 14} y={y + 48} className={styles.nodeGhostCount}>
        —
      </text>
      <text x={x + 14} y={y + 66} className={styles.nodeLine}>
        not measured
      </text>
      {wrapWords(s.unmeasured ?? "").map((line, i) => (
        <text key={i} x={x + 14} y={y + 82 + i * 13} className={styles.nodeGhostNote}>
          {line}
        </text>
      ))}
    </g>
  );
}
