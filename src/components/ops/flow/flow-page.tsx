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
  POPULATION_LABELS,
  type Population,
  retryCutoff,
  trendEnds,
  trendSentence,
  type RuleTrend,
  type StationStats,
} from "@/lib/axiom/pipeline-flow";
import type { EventsOrigin } from "@/lib/axiom/pipeline-events-data";
import { stationStatus } from "./flow-layout";
import { CaseCanvas, DocumentsCanvas, LanesCanvas, ProgramsCanvas, type DocumentTile, type ProgramTile } from "./level-canvases";
import { ProcessMap } from "./process-map";
import { StatusIcon } from "./status-icon";
import styles from "./flow.module.css";

export type FlowView = "pipeline" | "discovery" | "programs";

export interface FlowParams {
  window: number;
  j: string | null;
  /** Which cases the line counts. */
  pop: Population;
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
  if (next.pop !== "all") q.set("pop", next.pop);
  if (next.view !== "pipeline") q.set("view", next.view);
  for (const key of ["station", "citation", "case", "program", "bundle"] as const) {
    const v = next[key];
    if (v) q.set(key, v);
  }
  const s = q.toString();
  return s ? `/ops/flow?${s}` : "/ops/flow";
}

const POPULATION_DESCRIPTIONS: Record<Population, string> = {
  all: "Every case in the window",
  runs: "Targeted re-encode runs: dispatch to merge and after",
  prs: "Module files a PR merged into a rulespec repo with no run behind it; they start at PR checks",
  modules: "Modules the encoder wrote inside another citation's run; they start at Generate",
};

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
            {params.view === "pipeline" ? (
              <nav className={styles.seg} aria-label="Which cases">
                {(["all", "runs", "prs", "modules"] as Population[]).map((p) =>
                  p === params.pop ? (
                    <span key={p} aria-current="page">
                      {POPULATION_LABELS[p]} {model.populations[p].toLocaleString("en-US")}
                    </span>
                  ) : (
                    <a key={p} href={flowHref(params, { pop: p, station: null })} title={POPULATION_DESCRIPTIONS[p]}>
                      {POPULATION_LABELS[p]} {model.populations[p].toLocaleString("en-US")}
                    </a>
                  )
                )}
              </nav>
            ) : null}
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
            {model.stations.length ? (
              <ProcessMap
                model={model}
                selected={selected?.id ?? null}
                href={(change) => flowHref(params, change)}
                detail={selected ? <StationPanel station={selected} model={model} params={params} /> : null}
              />
            ) : (
              <p className={styles.note}>No events in this window and scope. Choose a longer window or another jurisdiction.</p>
            )}
            <StationsTable model={model} params={params} />
            <Trust model={model} />
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
  return (
    <dl className={styles.kpis}>
      <div className={styles.kpi}>
        <dt>How many runs went in?</dt>
        <dd>{t.dispatched.toLocaleString("en-US")}</dd>
        <small>targeted re-encodes dispatched in {model.window.days} days</small>
      </div>
      <div className={styles.kpi}>
        <dt>How many merged?</dt>
        <dd>
          {t.dispatched_merged.toLocaleString("en-US")} <small style={{ display: "inline" }}>({pct(t.dispatched ? t.dispatched_merged / t.dispatched : null)})</small>
        </dd>
        <small>{t.dispatched_landed.toLocaleString("en-US")} also cleared every check after the merge</small>
      </div>
      <div className={styles.kpi}>
        <dt>How long to merge?</dt>
        <dd>{formatDuration(t.dispatch_to_merge_p50_ms)}</dd>
        <small>dispatch to default branch, median</small>
      </div>
      <div className={styles.kpi}>
        <dt>What waits now?</dt>
        <dd>{t.waiting.toLocaleString("en-US")}</dd>
        <small>{t.waiting_over_sla.toLocaleString("en-US")} over their station&apos;s SLA</small>
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

function StationsTable({ model, params }: { model: FlowModel; params: FlowParams }) {
  return (
    <section className={styles.section}>
      <h2>Is each station getting better or worse?</h2>
      <p>The floor&apos;s numbers as a table, with each station&apos;s last 7 days against the 7 before. Yield counts each case&apos;s last visit at the station.</p>
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
              <th>This week against the week before</th>
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
                  <td className={styles.num}>
                    {s.timed ? formatDuration(s.p50_ms) : "not timed"}
                    {s.timed && s.timed_share < 0.5 ? <small style={{ display: "block" }}>{pct(s.timed_share)} of visits timed</small> : null}
                  </td>
                  <td className={styles.num}>{s.timed ? formatDuration(s.p95_ms) : "–"}</td>
                  <td>{trendSentence(s.trend)}</td>
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

/** How much of the window the page can see, and where it is blind. */
function Trust({ model }: { model: FlowModel }) {
  const t = model.trust;
  const share = (n: number) => pct(t.dispatched ? n / t.dispatched : null);
  return (
    <section className={styles.section}>
      <h2>How much can these numbers see?</h2>
      <p>
        {`Of ${t.dispatched.toLocaleString("en-US")} runs dispatched in the window: ${share(t.with_tries)} have the encoder's per-try record${
          t.tries_since ? ` (it exists from ${t.tries_since.slice(0, 10)})` : ""
        }, ${share(t.with_cost)} a recorded model cost, and ${share(t.with_issue_list)} a full issue list for a try. Every other run shows only its first error. `}
        {t.untimed.length ? `Not timed: ${t.untimed.map(stationLabel).join(", ")}. ` : "Every station is timed. "}
        {t.partly_timed.length
          ? `Timed for part of their visits only: ${t.partly_timed.map((x) => `${stationLabel(x.station)} (${pct(x.share)})`).join(", ")}.`
          : ""}
      </p>
    </section>
  );
}

/** One rule's weekly rate as a small line chart, with the encoder PRs that name it marked. */
function RuleTrendChart({ trend }: { trend: RuleTrend }) {
  const w = 300;
  const h = 96;
  const pad = { l: 30, r: 8, t: 10, b: 20 };
  const pts = trend.weekly;
  if (pts.length < 2) return <p className={styles.note}>Too few runs per week to draw.</p>;
  const t0 = Date.parse(pts[0].week);
  const t1 = Date.parse(pts[pts.length - 1].week);
  const x = (ms: number) => pad.l + ((ms - t0) / Math.max(1, t1 - t0)) * (w - pad.l - pad.r);
  const y = (share: number) => pad.t + (1 - share) * (h - pad.t - pad.b);
  const line = pts.map((p) => `${x(Date.parse(p.week)).toFixed(1)},${y(p.hit / p.cases).toFixed(1)}`).join(" ");
  const marks = trend.changes.filter((c) => Date.parse(c.at) >= t0 && Date.parse(c.at) <= t1 + 6 * 86_400_000);
  return (
    <svg className={styles.trendChart} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${trend.rule_id}: share of runs by week`}>
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className={styles.grid} />
          <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className={styles.axis}>
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {marks.map((m) => (
        <g key={`${m.number}-${m.at}`}>
          <line x1={x(Date.parse(m.at))} x2={x(Date.parse(m.at))} y1={pad.t} y2={h - pad.b} className={styles.prMark} />
          <text
            x={x(Date.parse(m.at)) + (x(Date.parse(m.at)) > w - 50 ? -3 : 3)}
            y={pad.t + 8}
            textAnchor={x(Date.parse(m.at)) > w - 50 ? "end" : "start"}
            className={styles.axis}
          >
            #{m.number}
          </text>
          <title>{`#${m.number} merged ${m.at.slice(0, 10)}: ${m.title ?? ""}`}</title>
        </g>
      ))}
      <polyline points={line} className={styles.trendLine} />
      {pts.map((p) => (
        <circle key={p.week} cx={x(Date.parse(p.week))} cy={y(p.hit / p.cases)} r={4} className={styles.trendDot}>
          <title>{`Week of ${p.week}: ${p.hit} of ${p.cases} runs (${pct(p.hit / p.cases)})`}</title>
        </circle>
      ))}
      <text x={pad.l} y={h - 4} className={styles.axis}>
        {pts[0].week.slice(5)}
      </text>
      <text x={w - pad.r} y={h - 4} textAnchor="end" className={styles.axis}>
        {pts[pts.length - 1].week.slice(5)}
      </text>
    </svg>
  );
}

function trendAnswer(t: RuleTrend): string {
  const ends = trendEnds(t);
  const parts: string[] = [];
  if (ends) {
    const delta = Math.round((ends.last - ends.first) * 100);
    parts.push(
      Math.abs(delta) < 5
        ? `Steady at about ${pct(ends.last)} of runs`
        : `${delta > 0 ? "Up" : "Down"} from ${pct(ends.first)} to ${pct(ends.last)} of runs`
    );
  }
  if (t.rerun.citations) parts.push(`${t.rerun.still} of ${t.rerun.citations} citations still hit it when run again a week or more later`);
  parts.push(t.changes.length ? `after ${t.changes.length === 1 ? "PR" : "PRs"} ${t.changes.map((c) => `#${c.number}`).join(", ")}` : "no encoder PR names it");
  return `${parts.join("; ")}.`;
}

function Discovery({ model, params }: { model: FlowModel; params: FlowParams }) {
  const cut = model.retry ? retryCutoff(model.retry.steps) : null;
  const loopCost = model.looping.reduce((s, l) => s + (l.cost_usd ?? 0), 0);
  const loopUnpriced = model.looping.filter((l) => l.cost_usd == null).length;
  const rerun = model.trends.reduce((acc, t) => ({ citations: acc.citations + t.rerun.citations, still: acc.still + t.rerun.still }), { citations: 0, still: 0 });
  const worse = model.trends.filter((t) => {
    const e = trendEnds(t);
    return e && e.last - e.first >= 0.05;
  });
  return (
    <>
      <p className={styles.lede} style={{ marginTop: 16 }}>
        Patterns across runs and tries that one station cannot show. Each card answers one question; its numbers are the evidence. The agent brief starts with the same answers.
      </p>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="fixes-h">
          <p className={styles.eyebrow}>1 · Did our fixes work?</p>
          <h2 id="fixes-h">The rules the encoder does not fix, week by week</h2>
          <p className={styles.answer}>
            {model.trends.length
              ? worse.length
                ? `${worse.length} of ${model.trends.length} rules hit a larger share of runs now than in the first week with try records.${rerun.citations ? ` When the same citation ran again a week or more later, it still hit the rule in ${rerun.still} of ${rerun.citations} cases (${pct(rerun.still / rerun.citations)}).` : ""}`
                : `None of these rules got more frequent in the window.${rerun.citations ? ` Re-runs of the same citation still hit them in ${rerun.still} of ${rerun.citations} cases.` : ""}`
              : "No runs with try records in this window."}
          </p>
          <div className={styles.trendGrid}>
            {model.trends.map((t) => (
              <div key={t.rule_id} className={styles.trendCell}>
                <code>{t.rule_id}</code>
                <RuleTrendChart trend={t} />
                <p>{trendAnswer(t)}</p>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            Share of runs with the encoder&apos;s per-try record whose tries hit the rule, per week with 15 runs or more. Dashed lines: merged axiom-encode PRs that name the rule. The mix
            of citations changes each week; the re-run count compares the same citation.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="follows-h">
          <p className={styles.eyebrow}>2 · What follows a fix?</p>
          <h2 id="follows-h">When one rule is fixed, which one comes next</h2>
          <p className={styles.answer}>
            {model.follows[0]
              ? `When ${model.follows[0].fixed} is fixed, ${model.follows[0].next} appears in the next try ${pct(model.follows[0].share)} of the time, ${model.follows[0].lift}× its usual rate. Fix such pairs together.`
              : "No pair of rules follows each other much more often than chance."}
          </p>
          {model.follows.length ? (
            <ol className={styles.follows}>
              {model.follows.map((f) => (
                <li key={`${f.fixed}|${f.next}`}>
                  <code>{f.fixed}</code>
                  <span aria-hidden>→</span>
                  <code>{f.next}</code>
                  <span className={styles.followStat}>
                    {pct(f.share)} · {f.lift}× usual · {f.count} tries
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="stubborn-h">
          <p className={styles.eyebrow}>3 · Which rules does another try not fix?</p>
          <h2 id="stubborn-h">Rules that come back on the next try</h2>
          <p className={styles.answer}>
            {model.ladder.stubborn[0]
              ? `${model.ladder.stubborn[0].rule_id} fails ${model.ladder.stubborn[0].occurrences} tries, and the next try fails it again ${pct(model.ladder.stubborn[0].stick_rate)} of the time.`
              : "No rule with enough tries in this window."}
            {cut ? ` From try ${cut.from.label} on, ${cut.passed} of ${cut.tries} tries pass (${pct(cut.passed / cut.tries)}) for $${cut.cost.toFixed(2)}.` : ""}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Rule</th>
                  <th className={styles.num}>Failed tries</th>
                  <th>Next try fails it again</th>
                  <th className={styles.num}>Cases recovered</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="looping-h">
          <p className={styles.eyebrow}>4 · Which citations to stop dispatching?</p>
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
