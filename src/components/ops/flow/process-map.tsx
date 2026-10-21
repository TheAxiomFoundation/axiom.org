import type { ReactNode } from "react";
import {
  CAUSE_ORIGINS,
  causeText,
  formatDuration,
  pct,
  POPULATION_LABELS,
  stationLabel,
  type CauseOrigin,
  type FlowModel,
  type StationCause,
  type StationStats,
} from "@/lib/axiom/pipeline-flow";
import { bandWidth, lineEnds, stationStatus, TIME_TICKS, timeShare } from "./flow-layout";
import { StatusIcon, STATUS_LABEL } from "./status-icon";
import styles from "./flow.module.css";

/** How many reasons a row shows before it points to the station's detail. */
const SHOWN_CAUSES = 4;
/** Where the band splits in a row (px from its top): level with the row's first line, so the drain points at "N left here". */
const SPLIT = 12;

type Href = (change: { station?: string | null; citation?: string | null; case?: string | null }) => string;

const n = (x: number) => x.toLocaleString("en-US");
/** A share that is not zero never reads as 0%. */
const share = (part: number, whole: number) => (part > 0 && part / whole < 0.005 ? "<1%" : pct(whole ? part / whole : null));

/**
 * The encoding line as a process map: one row per station in flow order.
 * Each row shows the cases that reached the station and went on (the amber
 * band), the cases that left the line there (the red drain) and why, the
 * time a case spends there, and what waits there now. One row per station,
 * so no line, label or box can lie over another.
 */
export function ProcessMap({ model, href, selected, detail }: { model: FlowModel; href: Href; selected: string | null; detail: ReactNode }) {
  const max = Math.max(1, ...model.stations.map((s) => s.cases));
  const exitsTotal = model.stations.reduce((sum, s) => sum + s.flow.failed_here + s.flow.cancelled_here, 0);
  const origins = new Set<CauseOrigin>();
  for (const s of model.stations) for (const c of [...s.flow.exit_causes.slice(0, SHOWN_CAUSES), ...s.flow.wait_causes.slice(0, 1)]) origins.add(c.origin);

  return (
    <>
      <LineEnds model={model} href={href} />
      <div className={styles.map} role="table" aria-label={`The encoding line, ${POPULATION_LABELS[model.population].toLowerCase()}: one row per station`}>
        <div className={styles.mapHead} role="row">
          <span role="columnheader">Station</span>
          <span role="columnheader">Cases</span>
          <span role="columnheader">Left the line here, and why</span>
          <span role="columnheader" className={styles.timeHead}>
            Time at the station
            <span className={styles.ticks} aria-hidden>
              {TIME_TICKS.map((t) => (
                <i key={t.label} style={{ left: `${timeShare(t.ms)! * 100}%` }}>
                  {t.label}
                </i>
              ))}
            </span>
          </span>
          <span role="columnheader">Waiting now</span>
        </div>
        {model.stations.map((s) => (
          <div key={s.id} role="rowgroup">
            <Row station={s} model={model} max={max} exitsTotal={exitsTotal} href={href} selected={selected === s.id} />
            {selected === s.id && detail ? (
              <div className={styles.mapDetail} role="row">
                {detail}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <Origins origins={[...origins]} />
    </>
  );
}

function Row({ station: s, model, max, exitsTotal, href, selected }: { station: StationStats; model: FlowModel; max: number; exitsTotal: number; href: Href; selected: boolean }) {
  const f = s.flow;
  const status = stationStatus(s, model.alerts);
  const left = f.failed_here + f.cancelled_here;
  const first = model.stations[0]?.id === s.id;
  const loops = model.edges.filter((e) => e.from === s.id && e.loop && e.to !== s.id && !e.to.startsWith("exit:"));
  const flowTitle = [
    `${n(s.cases)} reached ${s.label}`,
    !first && f.joined ? `${n(f.joined)} started here` : null,
    `${n(f.moved_on)} went on`,
    left ? `${n(left)} left the line (${n(f.failed_here)} failed, ${n(f.cancelled_here)} cancelled)` : null,
    f.landed_here ? `${n(f.landed_here)} landed here` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={styles.mapRow} role="row" data-selected={selected}>
      <div className={styles.mapStation} role="cell">
        <a href={href({ station: selected ? null : s.id })} className={styles.mapName} aria-expanded={selected}>
          {s.label}
        </a>
        <span className={styles.status} data-status={status}>
          <StatusIcon status={status} size={11} /> {STATUS_LABEL[status]}
        </span>
        <p>{s.description}</p>
        <p className={styles.mapNums}>
          <b>{n(s.cases)}</b> reached · <b>{n(f.moved_on)}</b> went on
          {s.yield != null ? <> · yield {pct(s.yield)}</> : null}
        </p>
        {!first && f.joined ? <p className={styles.joined}>+{n(f.joined)} started here, not from the station above</p> : null}
        {loops.map((e) => (
          <p key={e.to} className={styles.loopNote}>
            ↺ {n(e.cases)} went back to {stationLabel(e.to)}
            {s.tries ? ` · ${pct(s.tries.total ? s.tries.ok / s.tries.total : null)} of ${n(s.tries.total)} tries passed` : ""}
          </p>
        ))}
        {f.landed_here ? <p className={styles.landedNote}>✓ {n(f.landed_here)} landed here (cleared every station they reached)</p> : null}
      </div>

      <div className={styles.mapFlow} role="cell" title={flowTitle} aria-label={flowTitle}>
        {!first && f.joined ? <i className={styles.bandJoin} style={{ top: SPLIT - 12, height: Math.max(4, bandWidth(f.joined, max)) }} /> : null}
        <i className={styles.bandIn} style={{ width: bandWidth(s.cases, max), height: SPLIT + 18 }} />
        <i className={styles.bandOut} style={{ width: bandWidth(f.moved_on, max), top: SPLIT }} />
        {left ? <i className={styles.drain} style={{ top: SPLIT, left: 16 + bandWidth(f.moved_on, max), height: Math.max(3, bandWidth(left, max)) }} /> : null}
        {f.landed_here ? (
          <i
            className={styles.drainLanded}
            style={{ top: SPLIT + (left ? Math.max(3, bandWidth(left, max)) + 4 : 0), left: 16 + bandWidth(f.moved_on, max), height: Math.max(3, bandWidth(f.landed_here, max)) }}
          />
        ) : null}
      </div>

      <div className={styles.mapExits} role="cell">
        {left ? (
          <>
            <p className={styles.exitHead}>
              <b>{n(left)}</b> left here
              <span>
                {" "}
                · {share(left, s.cases)} of those that reached it · {share(left, exitsTotal)} of all exits
              </span>
            </p>
            <p className={styles.exitSplit}>
              {n(f.failed_here)} failed{f.cancelled_here ? ` · ${n(f.cancelled_here)} cancelled` : ""}
            </p>
            <ul className={styles.causes}>
              {f.exit_causes.slice(0, SHOWN_CAUSES).map((c) => (
                <Cause key={c.cause} cause={c} total={left} href={href} />
              ))}
            </ul>
            {f.exit_causes.length > SHOWN_CAUSES ? (
              <a className={styles.moreCauses} href={href({ station: s.id })}>
                {f.exit_causes.length - SHOWN_CAUSES} more reasons →
              </a>
            ) : null}
          </>
        ) : (
          <p className={styles.muted}>None left here.</p>
        )}
      </div>

      <div className={styles.mapTime} role="cell">
        <TimeBar station={s} />
      </div>

      <div className={styles.mapWait} role="cell">
        <Waiting station={s} href={href} />
      </div>
    </div>
  );
}

function Cause({ cause: c, total, href }: { cause: StationCause; total: number; href: Href }) {
  const text = causeText(c.cause);
  return (
    <li className={styles.cause}>
      <span className={styles.causeBar} aria-hidden>
        <i style={{ width: `${(c.cases / Math.max(1, total)) * 100}%` }} data-origin={c.origin} />
      </span>
      <b className={styles.causeCount}>{n(c.cases)}</b>
      <span className={styles.causeBody}>
        <span className={styles.causeLine}>
          <span className={styles.originTag} data-origin={c.origin} title={CAUSE_ORIGINS[c.origin].source}>
            {CAUSE_ORIGINS[c.origin].label}
          </span>
          {text ? <span className={styles.causeText}>{text}</span> : <code className={styles.causeId}>{c.cause}</code>}
        </span>
        <span className={styles.causeLine}>
          {c.message ? (
            <span className={styles.causeMsg} title={c.message}>
              {c.message}
            </span>
          ) : null}
          <a className={styles.causeCase} href={href({ citation: c.example_citation, case: c.example_case, station: null })} title={`The latest case with this reason: ${c.example_citation}`}>
            latest case →
          </a>
        </span>
      </span>
    </li>
  );
}

/** Where a station's time goes, on one log axis shared by every row: the queue before it, and the median and p95 there. */
function TimeBar({ station: s }: { station: StationStats }) {
  const before = timeShare(s.flow.wait_before_ms);
  const p50 = s.timed ? timeShare(s.p50_ms) : null;
  const p95 = s.timed ? timeShare(s.p95_ms) : null;
  if (p50 == null && !before) {
    return (
      <p className={styles.muted} title="The records give a point in time for this station, or only the time a nightly job read it, so there is no duration to show.">
        Not timed
      </p>
    );
  }
  return (
    <div className={styles.time}>
      <span className={styles.track} aria-hidden>
        {TIME_TICKS.map((t) => (
          <i key={t.label} className={styles.tick} style={{ left: `${timeShare(t.ms)! * 100}%` }} />
        ))}
        {before ? <i className={styles.queue} style={{ width: `${before * 100}%` }} /> : null}
        {p50 != null ? <i className={styles.here} style={{ width: `${Math.max(1.5, p50 * 100)}%` }} /> : null}
        {p95 != null ? <i className={styles.p95} style={{ left: `${p95 * 100}%` }} /> : null}
      </span>
      <p>
        {p50 != null ? (
          <>
            median <b>{formatDuration(s.p50_ms)}</b> · p95 {formatDuration(s.p95_ms)}
            {s.timed_share < 0.5 ? <span title={`From ${pct(s.timed_share)} of visits`}> ({pct(s.timed_share)} of visits timed)</span> : null}
          </>
        ) : (
          "Not timed here"
        )}
      </p>
      {s.flow.wait_before_ms ? <p className={styles.queueNote}>queue before it: {formatDuration(s.flow.wait_before_ms)} median</p> : null}
    </div>
  );
}

function Waiting({ station: s, href }: { station: StationStats; href: Href }) {
  if (!s.wip) return <p className={styles.muted}>Nothing waits.</p>;
  const top = s.flow.wait_causes[0];
  const oldest = s.oldest[0];
  const hot = s.target?.max_wip != null ? s.wip > s.target.max_wip : s.over_sla > 0;
  return (
    <div>
      <p className={styles.waitCount} data-hot={hot}>
        <b>{n(s.wip)}</b>
        {s.over_sla ? <span>{s.over_sla === s.wip ? ", all over SLA" : `, ${n(s.over_sla)} over SLA`}</span> : null}
      </p>
      {top ? (
        <p className={styles.waitWhy}>
          {top.cases === s.wip ? "All" : n(top.cases)}: {causeText(top.cause) ?? top.cause}
        </p>
      ) : null}
      {oldest ? (
        <p className={styles.waitWhy}>
          oldest since <a href={href({ citation: oldest.citation, case: oldest.case_id, station: null })}>{oldest.since.slice(0, 10)}</a>
        </p>
      ) : null}
    </div>
  );
}

/** Where the window's cases ended: one bar in line order, so the biggest leak is the widest red block. */
function LineEnds({ model, href }: { model: FlowModel; href: Href }) {
  const segments = lineEnds(model);
  const total = segments.reduce((s, x) => s + x.cases, 0);
  if (!total) return null;
  const exits = segments.filter((s) => s.kind === "exit").sort((a, b) => b.cases - a.cases);
  const exitsTotal = exits.reduce((s, x) => s + x.cases, 0);
  const top = exits.slice(0, 3);
  const causes = model.stations
    .flatMap((s) => s.flow.exit_causes.map((c) => ({ ...c, station: s })))
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 3);
  return (
    <section className={styles.ends} aria-label="Where cases end">
      <h2>Where do cases end?</h2>
      <p>
        Of {n(total)} {model.population === "all" ? "cases" : POPULATION_LABELS[model.population].toLowerCase()} in the last {model.window.days} days, {n(model.totals.landed)} landed ({share(model.totals.landed, total)}),{" "}
        {n(exitsTotal)} left the line ({share(exitsTotal, total)}) and {n(model.totals.open)} are still in it.
        {top.length ? (
          <>
            {" "}
            Most exits are at {top.map((t, i) => `${i ? (i === top.length - 1 ? " and " : ", ") : ""}${t.label} (${n(t.cases)})`).join("")}.
          </>
        ) : null}
      </p>
      <div className={styles.endsBar} role="img" aria-label={segments.map((s) => `${s.label}: ${n(s.cases)}`).join(", ")}>
        {segments.map((s) => (
          <a
            key={s.key}
            href={s.station ? href({ station: s.station }) : undefined}
            className={styles.endSeg}
            data-kind={s.kind}
            style={{ flexGrow: s.cases }}
            title={`${s.kind === "exit" ? `Left at ${s.label}` : s.label}: ${n(s.cases)} (${share(s.cases, total)})`}
          >
            {s.cases / total >= 0.04 ? (
              <span>
                {`${s.label} `}
                <b>{n(s.cases)}</b>
              </span>
            ) : null}
          </a>
        ))}
      </div>
      <p className={styles.endsKey}>
        <span data-kind="landed">Landed</span>
        <span data-kind="exit">Left the line, by station (failed or cancelled)</span>
        <span data-kind="open">Still in the line</span>
      </p>
      {causes.length ? (
        <div className={styles.topCauses}>
          <h3>The biggest reasons cases leave</h3>
          <ol>
            {causes.map((c) => (
              <li key={`${c.station.id}:${c.cause}`}>
                <b>{n(c.cases)}</b> at <a href={href({ station: c.station.id })}>{c.station.label}</a>:{" "}
                {causeText(c.cause) ?? <code>{c.cause}</code>} <span className={styles.originTag} data-origin={c.origin}>{CAUSE_ORIGINS[c.origin].label}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

/** Where the reasons on the map come from: the system behind each kind. */
function Origins({ origins }: { origins: CauseOrigin[] }) {
  if (!origins.length) return null;
  const order = Object.keys(CAUSE_ORIGINS) as CauseOrigin[];
  return (
    <section className={styles.section}>
      <h2>Where do these reasons come from?</h2>
      <p>Each reason is the id or text that a system reported, tagged with that system. Nothing on the map is a fixed list of errors.</p>
      <dl className={styles.origins}>
        {order
          .filter((o) => origins.includes(o))
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
