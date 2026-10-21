import { ArrowLeft } from "lucide-react";
import dashboard from "@/components/axiom/ops-dashboard.module.css";
import {
  formatDuration,
  pct,
  stationLabel,
  type CaseDetail,
  type CitationLane,
  type FlowAlert,
  type FlowModel,
  type StationStats,
  type TryStep,
} from "@/lib/axiom/pipeline-flow";
import type { EventsOrigin } from "@/lib/axiom/pipeline-events-data";
import { stationStatus } from "./flow-layout";
import { CaseCanvas, DocumentsCanvas, LanesCanvas, ProgramsCanvas, type DocumentTile, type ProgramTile } from "./level-canvases";
import { PipelineCanvas, StatusIcon } from "./pipeline-canvas";
import styles from "./flow.module.css";

export type FlowView = "pipeline" | "discovery" | "programs";

export interface FlowParams {
  window: number;
  j: string | null;
  view: FlowView;
  station: string | null;
  citation: string | null;
  case: string | null;
  program: string | null;
  bundle: string | null;
}

/** A link inside /ops/flow that keeps the window and scope and changes the rest. */
export function flowHref(params: FlowParams, change: Partial<FlowParams>): string {
  const next = { ...params, ...change };
  const q = new URLSearchParams();
  if (next.window !== 30) q.set("window", String(next.window));
  if (next.j) q.set("j", next.j);
  if (next.view !== "pipeline") q.set("view", next.view);
  for (const key of ["station", "citation", "case", "program", "bundle"] as const) {
    const v = next[key];
    if (v) q.set(key, v);
  }
  const s = q.toString();
  return s ? `/ops/flow?${s}` : "/ops/flow";
}

const ORIGIN_NOTE: Record<EventsOrigin, string> = {
  table: "Read from encodings.pipeline_events.",
  file: "Read from a local backfill file (AXIOM_OPS_EVENTS_FILE).",
  derived:
    "Derived from encodings.pipeline_attempts in-process: the events table is not there yet, so issue lists beyond each try's first error are missing.",
};

export function FlowPage({
  model,
  origin,
  targetsSeeded,
  error,
  params,
  jurisdictions,
  lanes,
  detail,
  programs,
  documents,
  bundleTitle,
}: {
  model: FlowModel;
  origin: EventsOrigin;
  targetsSeeded: boolean;
  error: string | null;
  params: FlowParams;
  jurisdictions: string[];
  lanes: CitationLane[] | null;
  detail: CaseDetail | null;
  programs: ProgramTile[] | null;
  documents: DocumentTile[] | null;
  bundleTitle: string | null;
}) {
  const stationOrder = model.stations.map((s) => s.id);
  const selected = params.station ? (model.stations.find((s) => s.id === params.station) ?? null) : null;
  const level = detail ? "case" : lanes ? "citation" : params.view;
  const hrefFor = Object.fromEntries(
    model.stations.map((s) => [s.id, flowHref(params, { station: params.station === s.id ? null : s.id })])
  );

  return (
    <div className={`${dashboard.dashboard} ${styles.page} min-h-screen pt-28 pb-16`}>
      <div className={styles.wrap}>
        <a href="/ops" className={dashboard.back ?? undefined} style={{ fontSize: 12, color: "var(--color-ink-muted)", display: "inline-flex", gap: 6, alignItems: "center", textDecoration: "none" }}>
          <ArrowLeft size={13} aria-hidden /> Operations
        </a>
        <header className={styles.head} style={{ marginTop: 14 }}>
          <div>
            <p className={styles.eyebrow}>Axiom / Operations / Flow</p>
            <h1 className={styles.title}>The encoding line</h1>
            <p className={styles.lede}>
              Every encoding as a case moving through stations, mined from the pipeline event log: what moves, where it waits, where it leaves the line, and which validator rules
              keep it looping. Nothing on this page is fixed in code; the stations, edges and colours come from the events.
            </p>
          </div>
          <div className={styles.controls}>
            <nav className={styles.seg} aria-label="Window">
              {[7, 30, 90].map((d) =>
                d === params.window ? (
                  <span key={d} aria-current="page">
                    {d} days
                  </span>
                ) : (
                  <a key={d} href={flowHref(params, { window: d })}>
                    {d} days
                  </a>
                )
              )}
            </nav>
            <nav className={styles.seg} aria-label="Jurisdiction">
              {[null, ...jurisdictions].slice(0, 7).map((j) =>
                j === params.j ? (
                  <span key={j ?? "all"} aria-current="page">
                    {j ?? "All"}
                  </span>
                ) : (
                  <a key={j ?? "all"} href={flowHref(params, { j, station: null })}>
                    {j ?? "All"}
                  </a>
                )
              )}
            </nav>
          </div>
        </header>

        <Kpis model={model} />
        <Alerts alerts={model.alerts} />

        <nav className={styles.crumbs} aria-label="Zoom level">
          <a href={flowHref(params, { view: "pipeline", station: null, citation: null, case: null, program: null, bundle: null })} aria-current={level === "pipeline" && !selected ? "page" : undefined}>
            Pipeline
          </a>
          {selected && level === "pipeline" ? (
            <>
              <span aria-hidden>›</span>
              <span aria-current="page">{selected.label}</span>
            </>
          ) : null}
          {params.view === "programs" || params.bundle ? (
            <>
              <span aria-hidden>›</span>
              <a href={flowHref(params, { view: "programs", bundle: null, citation: null, case: null })} aria-current={level === "programs" && !params.bundle ? "page" : undefined}>
                Programs
              </a>
            </>
          ) : null}
          {params.bundle ? (
            <>
              <span aria-hidden>›</span>
              <a href={flowHref(params, { view: "programs", citation: null, case: null })} aria-current={level === "programs" ? "page" : undefined}>
                {bundleTitle ?? params.bundle}
              </a>
            </>
          ) : null}
          {params.citation ? (
            <>
              <span aria-hidden>›</span>
              <a href={flowHref(params, { case: null })} aria-current={level === "citation" ? "page" : undefined}>
                {params.citation}
              </a>
            </>
          ) : null}
          {detail ? (
            <>
              <span aria-hidden>›</span>
              <span aria-current="page">Run {detail.case_id}</span>
            </>
          ) : null}
        </nav>

        {level === "pipeline" || level === "discovery" || level === "programs" ? (
          <nav className={styles.tabs} aria-label="Views">
            <a href={flowHref(params, { view: "pipeline", program: null, bundle: null })} aria-current={params.view === "pipeline" ? "page" : undefined}>
              Line
            </a>
            <a href={flowHref(params, { view: "discovery", station: null, program: null, bundle: null })} aria-current={params.view === "discovery" ? "page" : undefined}>
              Discovery
            </a>
            <a href={flowHref(params, { view: "programs", station: null })} aria-current={params.view === "programs" ? "page" : undefined}>
              Programs
            </a>
          </nav>
        ) : null}

        {error ? <p className={styles.note}>Could not read the event log: {error}</p> : null}

        {level === "case" && detail ? (
          <>
            <div className={styles.floor} data-panel="true">
              <CaseCanvas detail={detail} stationOrder={stationOrder} />
              <CasePanel detail={detail} params={params} />
            </div>
          </>
        ) : level === "citation" && lanes ? (
          <div className={styles.floor}>
            <LanesCanvas lanes={lanes} stationOrder={stationOrder} caseHref={Object.fromEntries(lanes.map((l) => [l.case_id, flowHref(params, { case: l.case_id })]))} />
          </div>
        ) : params.view === "discovery" ? (
          <Discovery model={model} params={params} />
        ) : params.view === "programs" ? (
          <div className={styles.floor}>{documents ? <DocumentsCanvas documents={documents} /> : <ProgramsCanvas programs={programs ?? []} />}</div>
        ) : (
          <>
            <div className={styles.floor} data-panel={selected ? "true" : "false"}>
              {model.stations.length ? (
                <PipelineCanvas model={model} selected={selected?.id ?? null} hrefFor={hrefFor} />
              ) : (
                <div className={styles.canvas}>
                  <div className={styles.empty}>
                    <p>No events in this window and scope. Choose a longer window or another jurisdiction.</p>
                  </div>
                </div>
              )}
              {selected ? <StationPanel station={selected} model={model} params={params} /> : null}
            </div>
            <StationsTable model={model} params={params} />
          </>
        )}

        <p className={styles.note}>
          {model.events.toLocaleString("en-US")} events ({Object.entries(model.sources).map(([s, n]) => `${s.replace(/_/g, " ")} ${n.toLocaleString("en-US")}`).join(", ")}). {ORIGIN_NOTE[origin]}{" "}
          {targetsSeeded ? "Targets are the migration's starting values (encodings.pipeline_station_targets is not there yet). " : ""}
          Agents: <a href="/api/ops/flow?format=md">markdown brief</a> · <a href="/api/ops/flow">JSON</a>.
        </p>
      </div>
    </div>
  );
}

function Kpis({ model }: { model: FlowModel }) {
  const t = model.totals;
  const finished = t.landed + t.failed + t.cancelled;
  // The loop station whose tries pass least often (the encode loop's checks).
  const validate = model.stations
    .filter((s) => s.tries && s.tries.total)
    .sort((a, b) => a.tries!.ok / a.tries!.total - b.tries!.ok / b.tries!.total)[0];
  const wip = model.stations.reduce((s, x) => s + x.wip, 0);
  return (
    <dl className={styles.kpis}>
      <div className={styles.kpi}>
        <dt>Cases started</dt>
        <dd>{t.cases.toLocaleString("en-US")}</dd>
        <small>last {model.window.days} days</small>
      </div>
      <div className={styles.kpi}>
        <dt>Landed per week</dt>
        <dd>{t.landed_per_week.toFixed(1)}</dd>
        <small>{t.landed.toLocaleString("en-US")} cleared every station</small>
      </div>
      <div className={styles.kpi}>
        <dt>End-to-end yield</dt>
        <dd>{pct(finished ? t.landed / finished : null)}</dd>
        <small>
          {t.failed.toLocaleString("en-US")} failed · {t.cancelled.toLocaleString("en-US")} cancelled
        </small>
      </div>
      {validate?.tries ? (
        <div className={styles.kpi}>
          <dt>{validate.label} pass per try</dt>
          <dd>{pct(validate.tries.total ? validate.tries.ok / validate.tries.total : null)}</dd>
          <small>{validate.tries.total.toLocaleString("en-US")} tries</small>
        </div>
      ) : null}
      <div className={styles.kpi}>
        <dt>Open now</dt>
        <dd>{wip.toLocaleString("en-US")}</dd>
        <small>waiting at a station, all time</small>
      </div>
      <div className={styles.kpi}>
        <dt>Lead time, p50</dt>
        <dd>{formatDuration(t.lead_p50_ms)}</dd>
        <small>first event to last timed one</small>
      </div>
    </dl>
  );
}

const SHOWN_ALERTS = 5;

function Alerts({ alerts }: { alerts: FlowAlert[] }) {
  if (!alerts.length) return <p className={styles.note}>No alerts: every station is within its targets.</p>;
  const row = (a: FlowAlert) => (
    <li key={a.id} className={styles.alert} data-severity={a.severity}>
      <span className={styles.sevTag} data-severity={a.severity}>
        {a.severity}
      </span>
      <div>
        <strong>{a.title}</strong>
        {a.detail ? <p>{a.detail}</p> : null}
      </div>
      {a.href ? <a href={a.href}>Open</a> : <span />}
    </li>
  );
  return (
    <section aria-label="Alerts">
      <ul className={styles.alerts}>{alerts.slice(0, SHOWN_ALERTS).map(row)}</ul>
      {alerts.length > SHOWN_ALERTS ? (
        <details className={styles.more}>
          <summary>{alerts.length - SHOWN_ALERTS} more alerts</summary>
          <ul className={styles.alerts}>{alerts.slice(SHOWN_ALERTS).map(row)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function StationPanel({ station: s, model, params }: { station: StationStats; model: FlowModel; params: FlowParams }) {
  const status = stationStatus(s, model.alerts);
  const maxFail = Math.max(1, ...s.failures.map((f) => f.count));
  const alerts = model.alerts.filter((a) => a.station === s.id);
  const t = s.target;
  return (
    <aside className={styles.panel} aria-label={`${s.label} details`}>
      <a className={styles.close} href={flowHref(params, { station: null })}>
        Close
      </a>
      <h2>{s.label}</h2>
      <p className={styles.status} data-status={status} style={{ marginTop: 4 }}>
        <StatusIcon status={status} /> {status === "neutral" ? "No target set" : status === "good" ? "On target" : status === "warning" ? "Off target" : "Alert"}
      </p>
      <p style={{ marginTop: 8 }}>{s.description}</p>
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
          <b>
            {formatDuration(s.p50_ms)} / {formatDuration(s.p95_ms)}
          </b>
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

function StationsTable({ model, params }: { model: FlowModel; params: FlowParams }) {
  return (
    <section className={styles.section}>
      <h2>Stations as a table</h2>
      <p>The same numbers as the floor, for reading and for screen readers. Yield counts each case's last visit; tries count every visit of a loop station.</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Station</th>
              <th>Status</th>
              <th className={styles.num}>Cases</th>
              <th className={styles.num}>Yield</th>
              <th className={styles.num}>Open</th>
              <th className={styles.num}>p50</th>
              <th className={styles.num}>p95</th>
              <th>Top cause</th>
            </tr>
          </thead>
          <tbody>
            {model.stations.map((s) => {
              const status = stationStatus(s, model.alerts);
              return (
                <tr key={s.id}>
                  <td>
                    <a href={flowHref(params, { station: s.id })}>{s.label}</a>
                  </td>
                  <td>
                    <span className={styles.status} data-status={status}>
                      <StatusIcon status={status} /> {status}
                    </span>
                  </td>
                  <td className={styles.num}>{s.cases.toLocaleString("en-US")}</td>
                  <td className={styles.num}>
                    {pct(s.yield)}
                    {s.tries ? ` (${pct(s.tries.total ? s.tries.ok / s.tries.total : null)}/try)` : ""}
                  </td>
                  <td className={styles.num}>{s.wip.toLocaleString("en-US")}</td>
                  <td className={styles.num}>{formatDuration(s.p50_ms)}</td>
                  <td className={styles.num}>{formatDuration(s.p95_ms)}</td>
                  <td>{s.failures[0] ? <code>{`${s.failures[0].rule_id} (${s.failures[0].count})`}</code> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Below this pass rate a later try is not worth its cost (as the retry alert). */
const LOW_PASS = 0.05;

/** The first try number from which every later try passes under LOW_PASS. */
export function retryVerdict(steps: TryStep[]): { from: TryStep; tries: number; passed: number; cost: number } | null {
  for (let i = 1; i < steps.length; i++) {
    const rest = steps.slice(i);
    const tries = rest.reduce((s, x) => s + x.tries, 0);
    const passed = rest.reduce((s, x) => s + x.passed, 0);
    if (tries && passed / tries < LOW_PASS) {
      return { from: steps[i], tries, passed, cost: rest.reduce((s, x) => s + x.cost_usd, 0) };
    }
  }
  return null;
}

function Discovery({ model, params }: { model: FlowModel; params: FlowParams }) {
  const retry = model.retry;
  const verdict = retry ? retryVerdict(retry.steps) : null;
  const totalPassed = retry ? retry.steps.reduce((s, x) => s + x.passed, 0) : 0;
  const maxTries = retry ? Math.max(1, ...retry.steps.map((s) => s.tries)) : 1;
  const maxShare = Math.max(0.01, ...model.variants.map((v) => v.share));
  const loopCost = model.looping.reduce((s, l) => s + (l.cost_usd ?? 0), 0);
  const loopUnpriced = model.looping.filter((l) => l.cost_usd == null).length;
  return (
    <>
      <p className={styles.lede} style={{ marginTop: 16 }}>
        Patterns across runs and tries, for decisions the Line tab cannot show: whether another try is worth it, which rules the encoder does not fix, and which citations to stop
        dispatching. The agent brief starts with the same three answers.
      </p>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="retry-h">
          <p className={styles.eyebrow}>1 · Is retrying worth it?</p>
          <h2 id="retry-h">{retry ? `${stationLabel(retry.judge)} pass rate by try` : "No retry loop in this window"}</h2>
          {retry ? (
            <>
              <p className={styles.answer}>
                {verdict
                  ? `From try ${verdict.from.label} on, ${verdict.passed} of ${verdict.tries} tries pass (${pct(verdict.passed / verdict.tries)}) for $${verdict.cost.toFixed(2)} of model cost. Cap the loop at ${verdict.from.try_no - 1} tries, or change what the encoder gets before try ${verdict.from.label}.`
                  : `Every try still passes at least ${pct(LOW_PASS)} of the time; the loop earns its cost.`}
              </p>
              <ol className={styles.tryBars} aria-label="Tries and passes by try number">
                {retry.steps.map((st) => {
                  const rate = st.tries ? st.passed / st.tries : 0;
                  const low = st.try_no > 1 && rate < LOW_PASS;
                  return (
                    <li key={st.label}>
                      <span className={styles.tryLabel}>Try {st.label}</span>
                      <span className={styles.tryTrack} title={`${st.tries} tries, ${st.passed} passed`}>
                        <i style={{ width: `${(st.tries / maxTries) * 100}%` }} />
                        <b data-low={low} style={{ width: `${(st.passed / maxTries) * 100}%` }} />
                      </span>
                      <span className={styles.tryNum}>
                        {pct(rate)} <small>({st.passed}/{st.tries})</small>
                        {low ? <em> below {pct(LOW_PASS)}</em> : null}
                      </span>
                      <span className={styles.tryNum}>${st.cost_usd.toFixed(2)}</span>
                    </li>
                  );
                })}
              </ol>
              <p className={styles.note}>
                Dark bar: tries that passed; light bar: tries that reached this number. {totalPassed} passes in all. Cost is the recorded model cost of {stationLabel(retry.work)} on that try
                (runs before the cost ledger have none).
              </p>
            </>
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="stubborn-h">
          <p className={styles.eyebrow}>2 · Which rules does the encoder not fix?</p>
          <h2 id="stubborn-h">Rules that come back on the next try</h2>
          <p className={styles.answer}>
            {model.ladder.stubborn[0]
              ? `${model.ladder.stubborn[0].rule_id} fails ${model.ladder.stubborn[0].occurrences} tries, and the next try fails it again ${pct(model.ladder.stubborn[0].stick_rate)} of the time. Another try does not fix these; change the prompt, the example or the check.`
              : "No rule with enough tries in this window."}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Rule</th>
                  <th className={styles.num}>Failed tries</th>
                  <th>Next try fails it again</th>
                  <th className={styles.num}>Cases recovered</th>
                  <th>When fixed, next comes</th>
                </tr>
              </thead>
              <tbody>
                {model.ladder.stubborn.map((r) => (
                  <tr key={r.rule_id}>
                    <td>
                      <code>{r.rule_id}</code>
                    </td>
                    <td className={styles.num}>
                      {r.occurrences.toLocaleString("en-US")} <small>in {r.cases}</small>
                    </td>
                    <td>
                      <span className={styles.stick}>
                        <i style={{ width: `${(r.stick_rate ?? 0) * 100}%` }} />
                      </span>{" "}
                      {pct(r.stick_rate)}
                    </td>
                    <td className={styles.num}>
                      {r.recovered} <small>of {r.cases}</small>
                    </td>
                    <td>
                      {r.followed_by.slice(0, 2).map((f) => (
                        <code key={f.rule_id} style={{ display: "block" }}>
                          → {f.rule_id} ({f.count})
                        </code>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="looping-h">
          <p className={styles.eyebrow}>3 · Which citations to stop dispatching?</p>
          <h2 id="looping-h">Dispatched again and again, never merged</h2>
          <p className={styles.answer}>
            {model.looping.length
              ? `${model.looping.length} citations ran ${model.looping.reduce((s, l) => s + l.cases, 0)} times in ${model.window.days} days with no merge, for $${loopCost.toFixed(2)} of recorded model cost${loopUnpriced ? ` (${loopUnpriced} of them ran before the cost ledger)` : ""}. Do not dispatch them again until something changes for their top rule.`
              : "No citation looped in this window."}
          </p>
          {model.looping.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Citation</th>
                    <th className={styles.num}>Runs</th>
                    <th className={styles.num}>Failures</th>
                    <th className={styles.num}>Cost</th>
                    <th>Fails on</th>
                  </tr>
                </thead>
                <tbody>
                  {model.looping.map((l) => (
                    <tr key={l.citation}>
                      <td>
                        <a href={flowHref(params, { citation: l.citation, view: "pipeline" })}>
                          <code>{l.citation}</code>
                        </a>
                      </td>
                      <td className={styles.num}>{l.cases}</td>
                      <td className={styles.num}>{l.failed_visits}</td>
                      <td className={styles.num}>{l.cost_usd == null ? "–" : `$${l.cost_usd.toFixed(2)}`}</td>
                      <td>
                        {l.rules.map((r) => (
                          <code key={r} style={{ display: "block" }}>
                            {r}
                          </code>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>

      {model.cooccurrence.length ? (
        <section className={styles.section}>
          <h2>Failure modes that come together</h2>
          <p>Pairs of rules in the same try. Lift above 1 means they come together more often than chance; one fix may clear both.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>With</th>
                  <th className={styles.num}>Tries</th>
                  <th className={styles.num}>Lift</th>
                </tr>
              </thead>
              <tbody>
                {model.cooccurrence.slice(0, 8).map((c) => (
                  <tr key={`${c.a}|${c.b}`}>
                    <td>
                      <code>{c.a}</code>
                    </td>
                    <td>
                      <code>{c.b}</code>
                    </td>
                    <td className={styles.num}>{c.count.toLocaleString("en-US")}</td>
                    <td className={styles.num}>{c.lift}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <section className={styles.section}>
        <h2>Common paths</h2>
        <p>Each case&apos;s stations in order (first visit of each) and where it ended, most common first.</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Share</th>
                <th>Path</th>
                <th className={styles.num}>Lead p50</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {model.variants.map((v) => (
                <tr key={`${v.path.join(">")}|${v.end}`}>
                  <td className={styles.num} style={{ whiteSpace: "nowrap" }}>
                    <span className={styles.share} style={{ width: `${(v.share / maxShare) * 60}px` }} aria-hidden />
                    {pct(v.share)} ({v.cases})
                  </td>
                  <td>
                    <span className={styles.path}>
                      {v.path.map((s) => (
                        <span key={s} className={styles.chip}>
                          {stationLabel(s)}
                        </span>
                      ))}
                      <span aria-hidden>→</span>
                      <span className={styles.chip} data-end={v.end.split(" ")[0]}>
                        {v.end.replace(/ at (\w+)/, (_, s: string) => ` at ${stationLabel(s)}`)}
                      </span>
                      {v.median_repeats > 1 ? <span className={styles.more}>×{v.median_repeats} tries</span> : null}
                    </span>
                  </td>
                  <td className={styles.num}>{formatDuration(v.median_lead_ms)}</td>
                  <td>
                    <a href={flowHref(params, { citation: v.example_citation, case: v.example_case, view: "pipeline" })}>
                      <code>{v.example_citation}</code>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** "Try 2" before "Try 10", the final candidate last. */
function tryOrder(label: string): number {
  const n = Number(label.replace(/\D+/g, ""));
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

function CasePanel({ detail, params }: { detail: CaseDetail; params: FlowParams }) {
  const byTry = new Map<string, CaseDetail["issues"]>();
  for (const i of detail.issues) {
    const key = i.try_no != null ? `Try ${i.try_no}` : "Final candidate";
    byTry.set(key, [...(byTry.get(key) ?? []), i]);
  }
  const links = [...new Map(detail.visits.filter((v) => v.ref_url).map((v) => [v.ref_url!, v.station])).entries()];
  const cost = detail.visits.reduce((s, v) => s + (v.cost_usd ?? 0), 0);
  const tries = detail.visits.filter((v) => v.station === "validate").length;
  return (
    <aside className={styles.panel} aria-label="Run details">
      <a className={styles.close} href={flowHref(params, { case: null })}>
        Back
      </a>
      <h2>{detail.citation}</h2>
      <p style={{ marginTop: 6 }}>
        Started {detail.start.slice(0, 16).replace("T", " ")} UTC · <b>{detail.end}</b>
      </p>
      <div className={styles.metrics} style={{ marginTop: 12 }}>
        <div className={styles.metric}>
          <span>Tries</span>
          <b>{tries}</b>
        </div>
        <div className={styles.metric}>
          <span>Model cost</span>
          <b>{cost ? `$${cost.toFixed(2)}` : "–"}</b>
          <small>recorded tries only</small>
        </div>
        <div className={styles.metric}>
          <span>Encoder</span>
          <b style={{ fontSize: 13 }}>{detail.encoder_version ?? "–"}</b>
        </div>
        <div className={styles.metric}>
          <span>Issues archived</span>
          <b>{detail.issues.length}</b>
        </div>
      </div>
      <h3>Pages</h3>
      <ul className={styles.items}>
        {links.map(([url, station]) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer">
              {stationLabel(station)}
            </a>
            <code>{url.replace("https://github.com/TheAxiomFoundation/", "")}</code>
          </li>
        ))}
        <li>
          <a href={`/ops/journey?citation=${encodeURIComponent(detail.citation)}`}>Journey page</a>
          <span />
        </li>
      </ul>
      {[...byTry.entries()].sort(([a], [b]) => tryOrder(a) - tryOrder(b)).map(([label, issues]) => {
        const counts = new Map<string, number>();
        for (const i of issues) counts.set(i.rule_id ?? "unknown", (counts.get(i.rule_id ?? "unknown") ?? 0) + 1);
        return (
          <div key={label}>
            <h3>
              {label}: {issues.length} issues
            </h3>
            <ul className={styles.items}>
              {[...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([rule, n]) => (
                  <li key={rule}>
                    <code>{rule}</code>
                    <span>{n}</span>
                  </li>
                ))}
            </ul>
            <details className={styles.more}>
              <summary>Messages</summary>
              <ul className={styles.items}>
                {issues.slice(0, 30).map((i, n) => (
                  <li key={n} style={{ display: "block" }}>
                    <code>{i.message}</code>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        );
      })}
      {!detail.issues.length ? (
        <p style={{ marginTop: 12 }}>No archived issue list for this run: its record keeps only the first error of each try (shown on the try).</p>
      ) : null}
    </aside>
  );
}
