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
  trendSentence,
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
 * The /ops "Pipeline" tab (`?tab=line`): where cases wait, fail or loop.
 * Every encoding as a case moving through stations, mined from the
 * pipeline event log.
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
  return (
    <section aria-label="The encoding line">
      <header className={styles.head}>
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

      {error ? <p className={styles.note}>Could not read the event log: {error}</p> : null}

      {!model.stations.length ? (
        <p className={styles.note}>No events in this window and scope. Choose a longer window or another jurisdiction.</p>
      ) : (
        <PipelineFloor model={model} params={params} />
      )}
      <Alerts alerts={model.alerts} />
      <ReasonSources model={model} />
      <StationsTable model={model} params={params} />
      <Trust model={model} />

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
