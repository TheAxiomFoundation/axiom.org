import {
  CAUSE_ORIGINS,
  causeOrigin,
  causeText,
  formatDuration,
  pct,
  ruleWords,
  splitMessage,
  trendEnds,
  trendSentence,
  type FlowModel,
  type StationStats,
} from "@/lib/axiom/pipeline-flow";
import { stationStatus } from "./flow-layout";
import { flowHref, type FlowParams } from "./flow-params";
import { StatusIcon } from "./status-icon";
import styles from "./flow.module.css";

/** A station's detail beside the diagram. With `onClose` it closes in place, without a page load. */
export function StationPanel({ station: s, model, params, onClose }: { station: StationStats; model: FlowModel; params: FlowParams; onClose?: () => void }) {
  const status = stationStatus(s, model.alerts);
  const alerts = model.alerts.filter((a) => a.station === s.id);
  const t = s.target;
  return (
    <aside className={styles.panel} aria-label={`${s.label} details`}>
      <a
        className={styles.close}
        href={flowHref(params, { station: null })}
        onClick={
          onClose
            ? (e) => {
                e.preventDefault();
                onClose();
              }
            : undefined
        }
      >
        Close
      </a>
      <h2>{s.label}</h2>
      <p className={styles.status} data-status={status} style={{ marginTop: 4 }}>
        <StatusIcon status={status} /> {status === "neutral" ? "No target set" : status === "good" ? "On target" : status === "warning" ? "Off target" : "Alert"}
      </p>
      <p style={{ marginTop: 8 }}>{s.description}</p>
      <p style={{ marginTop: 8 }}>
        <b>This week:</b> {trendSentence(s.trend)}
      </p>
      <h3>Last {model.window.days} days</h3>
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span>Yield</span>
          <b>{pct(s.yield)}</b>
          <small>{t?.min_yield != null ? `target ${pct(t.min_yield)}` : "no target"}</small>
        </div>
        <div className={styles.metric}>
          <span>Open now</span>
          <b>{s.wip.toLocaleString("en-US")}</b>
          <small>{t?.max_wip != null ? `limit ${t.max_wip}` : `${s.over_sla} over SLA`}</small>
        </div>
        <div className={styles.metric}>
          <span>p50 / p95</span>
          <b>{s.timed ? `${formatDuration(s.p50_ms)} / ${formatDuration(s.p95_ms)}` : "not timed"}</b>
          <small>{t?.max_p95_hours != null ? `p95 target ${formatDuration(t.max_p95_hours * 3_600_000)}` : "no target"}</small>
        </div>
        <div className={styles.metric}>
          <span>Finished</span>
          <b>{(s.ok + s.failed + s.cancelled).toLocaleString("en-US")}</b>
          <small>
            {s.ok} ok{s.waived ? ` (${s.waived} waived)` : ""} · {s.failed} failed · {s.cancelled} cancelled
          </small>
        </div>
        {s.tries ? (
          <div className={styles.metric}>
            <span>Tries</span>
            <b>{s.tries.total.toLocaleString("en-US")}</b>
            <small>{pct(s.tries.total ? s.tries.ok / s.tries.total : null)} passed</small>
          </div>
        ) : null}
      </div>
      {alerts.length ? (
        <>
          <h3>Alerts</h3>
          <ul className={styles.items}>
            {alerts.map((a) => (
              <li key={a.id}>
                <span>{a.title}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <FailureModes station={s} model={model} params={params} />
      {s.oldest.length ? (
        <>
          <h3>Oldest open</h3>
          <ul className={styles.items}>
            {s.oldest.map((o) => (
              <li key={o.case_id}>
                <a href={flowHref(params, { citation: o.citation, case: o.case_id, station: null })}>
                  <code>{o.citation}</code>
                </a>
                <span>{o.since.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {s.id === "validate" ? (
        <p style={{ marginTop: 16 }}>
          <a href={flowHref(params, { view: "discovery", station: null })}>See how rules follow each other across tries →</a>
        </p>
      ) : null}
    </aside>
  );
}

/**
 * Each way cases fail at the station, as one card: what the check said,
 * how many runs it ended, whether another try fixes it, whether it is
 * getting worse, and the latest cases. Sorted by the runs it ended.
 */
function FailureModes({ station: s, model, params }: { station: StationStats; model: FlowModel; params: FlowParams }) {
  const ended = new Map(s.flow.exit_causes.map((c) => [c.cause, c]));
  const ids = [...new Set([...s.flow.exit_causes.map((c) => c.cause), ...s.failures.map((f) => f.rule_id)])];
  const modes = ids
    .map((id) => {
      const f = s.failures.find((x) => x.rule_id === id) ?? null;
      const e = ended.get(id) ?? null;
      return {
        id,
        hits: f?.count ?? e?.cases ?? 0,
        cases: f?.cases ?? e?.cases ?? 0,
        ended: e?.cases ?? 0,
        message: f?.message ?? e?.message ?? null,
        examples: f?.examples.length ? f.examples : e ? [{ citation: e.example_citation, case_id: e.example_case }] : [],
        ladder: model.ladder.rules.find((r) => r.rule_id === id) ?? null,
        trend: model.trends.find((t) => t.rule_id === id) ?? null,
      };
    })
    .sort((a, b) => b.ended - a.ended || b.hits - a.hits)
    .slice(0, 8);
  if (!modes.length) return null;
  const left = s.flow.failed_here + s.flow.cancelled_here;
  return (
    <>
      <h3>How cases fail here</h3>
      <p className={styles.modesLede}>
        {left
          ? `${left.toLocaleString("en-US")} cases left the line here. Each card is one failure: what was reported, the runs it ended, and whether a retry fixes it.`
          : "No case left the line here. These are the failures that a later step or try recovered from."}
      </p>
      <ol className={styles.modes}>
        {modes.map((m) => {
          const origin = causeOrigin(m.id);
          const split = m.message ? splitMessage(m.message) : null;
          const ends = m.trend ? trendEnds(m.trend) : null;
          const next = m.ladder?.followed_by[0];
          return (
            <li key={m.id} className={styles.mode}>
              <div className={styles.modeHead}>
                <b>{causeText(m.id) ?? ruleWords(m.id.replace(/^text:/, ""))}</b>
                <span className={styles.originTag} title={CAUSE_ORIGINS[origin].source}>
                  {CAUSE_ORIGINS[origin].label}
                </span>
              </div>
              <code className={styles.modeId}>{m.id}</code>
              {split ? (
                <p className={styles.modeMsg} title={m.message ?? undefined}>
                  <span className={styles.modeMsgText}>
                    {split.text}
                    {split.file ? <span> in {split.file}</span> : null}
                  </span>
                </p>
              ) : null}
              <div className={styles.modeImpact}>
                <span className={styles.modeEnded} data-zero={m.ended === 0}>
                  <b>{m.ended.toLocaleString("en-US")}</b> runs ended
                </span>
                <span>
                  hit {m.cases.toLocaleString("en-US")} cases{m.hits !== m.cases ? `, ${m.hits.toLocaleString("en-US")} times` : ""}
                </span>
              </div>
              {m.ladder && m.ladder.stick_rate != null ? (
                <p className={styles.modeLine} data-bad={m.ladder.stick_rate >= 0.5}>
                  Another try fails it again {pct(m.ladder.stick_rate)} of the time; {m.ladder.recovered.toLocaleString("en-US")} cases recovered later.
                </p>
              ) : null}
              {ends ? (
                <p className={styles.modeLine} data-bad={ends.last > ends.first + 0.03}>
                  {ends.last > ends.first + 0.03 ? "Getting worse" : ends.last < ends.first - 0.03 ? "Getting better" : "Steady"}: in {pct(ends.first)} of runs in the week of {ends.firstWeek.slice(5)}, {pct(ends.last)} in the week of {ends.lastWeek.slice(5)}.
                </p>
              ) : null}
              {next ? (
                <p className={styles.modeLine}>
                  When a try fixes it, <code>{next.rule_id}</code> often fails next ({next.count}×).
                </p>
              ) : null}
              {m.examples.length ? (
                <p className={styles.modeCases}>
                  Latest:{" "}
                  {m.examples.map((x, i) => (
                    <span key={x.case_id}>
                      {i ? ", " : ""}
                      <a href={flowHref(params, { citation: x.citation, case: x.case_id, station: null })}>{x.citation}</a>
                    </span>
                  ))}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}
