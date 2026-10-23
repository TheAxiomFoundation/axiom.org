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
  retryCutoff,
  trendEnds,
  trendSentence,
  type RuleTrend,
} from "@/lib/axiom/pipeline-flow";
import type { EventsOrigin } from "@/lib/axiom/pipeline-events-data";
import type { BundleMembership } from "@/lib/axiom/program-bundles";
import { bundleHref, tiersLabel } from "@/lib/axiom/program-bundles";
import { stationStatus } from "./flow-layout";
import { CaseCanvas, LanesCanvas } from "./level-canvases";
import { flowHref, type FlowParams } from "./flow-params";
import { PipelineFloor } from "./pipeline-floor";
import { ReasonSources } from "./reason-sources";
import { ScopeNav } from "./scope-nav";
import { StatusIcon } from "./status-icon";
import styles from "./flow.module.css";

export { flowHref, type FlowParams, type FlowView } from "./flow-params";

const ORIGIN_NOTE: Record<EventsOrigin, string> = {
  table: "Read from encodings.pipeline_events.",
  file: "Read from a local backfill file (AXIOM_OPS_EVENTS_FILE).",
  derived:
    "Derived from encodings.pipeline_attempts in-process: the events table is not there yet, so issue lists beyond each try's first error are missing.",
};

/**
 * The /ops "Line" tab: where cases wait, fail or loop. Every encoding as a
 * case moving through stations, mined from the pipeline event log, with the
 * discovery view (which rules follow each other across tries) beside it.
 */
export function FlowLine({
  model,
  origin,
  targetsSeeded,
  error,
  params,
  jurisdictions,
}: {
  model: FlowModel;
  origin: EventsOrigin;
  targetsSeeded: boolean;
  error: string | null;
  params: FlowParams;
  jurisdictions: string[];
}) {
  const selected = params.station ? (model.stations.find((s) => s.id === params.station) ?? null) : null;
  return (
    <section aria-label="The encoding line">
      <header className={styles.head}>
        <p className={styles.lede}>
          Every encoding as a case moving through stations, mined from the pipeline event log: what moves, where it waits, where it leaves the line, and which validator rules
          keep it looping. The stations, edges and colours come from the events.
        </p>
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
          <ScopeNav current={params.j} options={jurisdictions} href={(j) => flowHref(params, { j, station: null })} />
        </div>
      </header>

      <Kpis model={model} />
      <Alerts alerts={model.alerts} />

      <nav className={styles.tabs} aria-label="Views">
        <a href={flowHref(params, { view: "pipeline", station: null })} aria-current={params.view === "pipeline" && !selected ? "page" : undefined}>
          Stations{selected && params.view === "pipeline" ? ` › ${selected.label}` : ""}
        </a>
        <a href={flowHref(params, { view: "discovery", station: null })} aria-current={params.view === "discovery" ? "page" : undefined}>
          Loops and rules
        </a>
      </nav>

      {error ? <p className={styles.note}>Could not read the event log: {error}</p> : null}

      {params.view === "discovery" ? (
        <Discovery model={model} params={params} />
      ) : (
        <>
          {!model.stations.length ? (
            <p className={styles.note}>No events in this window and scope. Choose a longer window or another jurisdiction.</p>
          ) : (
            <PipelineFloor model={model} params={params} />
          )}
          <ReasonSources model={model} />
          <StationsTable model={model} params={params} />
          <Trust model={model} />
        </>
      )}

      <p className={styles.note}>
        {model.events.toLocaleString("en-US")} events ({Object.entries(model.sources).map(([s, n]) => `${s.replace(/_/g, " ")} ${n.toLocaleString("en-US")}`).join(", ")}). {ORIGIN_NOTE[origin]}{" "}
        {targetsSeeded ? "Targets are the migration's starting values (encodings.pipeline_station_targets is not there yet). " : ""}
        Agents: <a href="/api/ops/flow?format=md">markdown brief</a> · <a href="/api/ops/flow">JSON</a>.
      </p>
    </section>
  );
}

/**
 * The one drill-down: a citation's cases, station by station, from the event
 * log; a run's own path when `detail` is set. /api/ops/flow?citation= returns
 * the same lanes as JSON.
 */
export function JourneyView({
  citation,
  stationOrder,
  lanes,
  detail,
  bundles,
  origin,
  error,
}: {
  citation: string | null;
  stationOrder: string[];
  lanes: CitationLane[];
  detail: CaseDetail | null;
  bundles: BundleMembership[];
  origin: EventsOrigin;
  error: string | null;
}) {
  const params: FlowParams = { window: 30, j: null, view: "pipeline", station: null, citation, case: detail?.case_id ?? null, program: null, bundle: null };
  return (
    <div className={`${dashboard.dashboard} ${styles.page} min-h-screen pt-28 pb-16`}>
      <div className={styles.wrap}>
        <a href="/ops?tab=line" style={{ fontSize: 12, color: "var(--color-ink-muted)", display: "inline-flex", gap: 6, alignItems: "center", textDecoration: "none" }}>
          <ArrowLeft size={13} aria-hidden /> Operations
        </a>
        <header className={styles.head} style={{ marginTop: 14 }}>
          <div>
            <p className={styles.eyebrow}>Axiom / Operations / Journey</p>
            <h1 className={styles.title}>{citation ?? "Encoding journey"}</h1>
            <p className={styles.lede}>
              {citation
                ? "Every case of this citation, station by station: each dispatch and its tries, the PR, the merge, the index, the compile sweep, the tests on main and the oracle. Click a lane to open that run."
                : "Pick a citation on the Pipeline tab, or add ?citation=<path> to the address."}
            </p>
          </div>
        </header>

        {bundles.length ? (
          <p className={styles.note}>
            In{" "}
            {bundles.map((b, i) => (
              <span key={b.bundle_id}>
                {i ? ", " : ""}
                <a href={bundleHref(b.bundle_id)}>{b.bundle_title}</a> ({tiersLabel(b)})
              </span>
            ))}
            .
          </p>
        ) : null}

        {citation ? (
          <nav className={styles.crumbs} aria-label="Zoom level">
            <a href={flowHref(params, { case: null })} aria-current={detail ? undefined : "page"}>
              {citation}
            </a>
            {detail ? (
              <>
                <span aria-hidden>›</span>
                <span aria-current="page">Run {detail.case_id}</span>
              </>
            ) : null}
          </nav>
        ) : null}

        {error ? <p className={styles.note}>Could not read the event log: {error}</p> : null}

        {detail ? (
          <div className={styles.floor} data-panel="true">
            <CaseCanvas detail={detail} stationOrder={stationOrder} />
            <CasePanel detail={detail} params={params} />
          </div>
        ) : citation && lanes.length ? (
          <div className={styles.floor}>
            <LanesCanvas lanes={lanes} stationOrder={stationOrder} caseHref={Object.fromEntries(lanes.map((l) => [l.case_id, flowHref(params, { case: l.case_id })]))} />
          </div>
        ) : citation ? (
          <p className={styles.note}>No case of this citation is in the event log.</p>
        ) : null}

        <p className={styles.note}>
          {ORIGIN_NOTE[origin]} Agents: <a href={`/api/ops/flow?citation=${encodeURIComponent(citation ?? "")}`}>this citation as JSON</a>.
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
