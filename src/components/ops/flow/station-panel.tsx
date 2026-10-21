import { formatDuration, pct, trendSentence, type FlowModel, type StationStats } from "@/lib/axiom/pipeline-flow";
import { stationStatus } from "./flow-layout";
import { flowHref, type FlowParams } from "./flow-params";
import { StatusIcon } from "./status-icon";
import styles from "./flow.module.css";

/** A station's detail beside the diagram. With `onClose` it closes in place, without a page load. */
export function StationPanel({ station: s, model, params, onClose }: { station: StationStats; model: FlowModel; params: FlowParams; onClose?: () => void }) {
  const status = stationStatus(s, model.alerts);
  const maxFail = Math.max(1, ...s.failures.map((f) => f.count));
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
      {s.failures.length ? (
        <>
          <h3>Why cases fail or wait here</h3>
          <div className={styles.bars}>
            {s.failures.map((f) => (
              <div key={f.rule_id} className={styles.bar}>
                <code>{f.rule_id}</code>
                <span>
                  {f.count} · {f.cases} cases
                </span>
                <i style={{ width: `${(f.count / maxFail) * 100}%` }} />
                {f.example ? (
                  <small>
                    latest: <a href={flowHref(params, { citation: f.example, station: null })}>{f.example}</a>
                  </small>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
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
