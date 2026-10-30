import { User } from "lucide-react";
import {
  causeText,
  formatDuration,
  PERSON_STATIONS,
  ruleWords,
  STATION_PHASES,
  type FlowModel,
  type RuleTrend,
  type StationStats,
} from "@/lib/axiom/pipeline-flow";
import styles from "./evidence.module.css";

/**
 * The /ops Pipeline tab as evidence: each stage's counts, times and exits,
 * where the hours go, the encode loop by try, and the validator rules by
 * week. Every number comes from the pipeline event log; nothing here
 * judges or advises.
 */
export function PipelineEvidence({ model }: { model: FlowModel }) {
  const phases = phaseRows(model.stations);
  const maxReached = Math.max(1, ...model.stations.map((s) => s.cases));
  return (
    <div className={styles.evidence}>
      <Panel title="Stages" note={`Cases that reached each stage in the last ${model.window.days} days`}>
        <StageTable phases={phases} maxReached={maxReached} />
      </Panel>
      <Panel title="Where the time goes" note="Summed time of finished visits at each stage">
        <TimeBars stations={phases.flatMap((p) => p.stations)} />
      </Panel>
      {model.retry ? (
        <Panel title="Encode loop" note="Tries that passed validation, by try number">
          <RetryBars steps={model.retry.steps} />
        </Panel>
      ) : null}
      {model.ladder.rules.length ? (
        <Panel title="Validator rules" note="Rules that rejected tries in the window, most tries first">
          <RuleTable model={model} />
        </Panel>
      ) : null}
      {model.trends.length ? (
        <Panel
          title="Validator rules by week"
          note={`Share of runs with a try that hit the rule${model.trends.some((t) => t.changes.length) ? "; dashed lines mark merged encoder PRs that name it" : ""}`}
        >
          <RuleTrends trends={model.trends} />
        </Panel>
      ) : null}
      <Panel title="What the data covers">
        <Coverage model={model} />
      </Panel>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={styles.panel} aria-label={title}>
      <header className={styles.panelHead}>
        <h2>{title}</h2>
        {note ? <p>{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

interface PhaseRow {
  id: string;
  label: string;
  stations: StationStats[];
}

/** The stations in line order, grouped by phase; a station no phase names comes last. */
export function phaseRows(stations: StationStats[]): PhaseRow[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const rows: PhaseRow[] = [];
  const placed = new Set<string>();
  for (const phase of STATION_PHASES) {
    const list = phase.stations.map((id) => byId.get(id)).filter((s): s is StationStats => !!s);
    for (const s of list) placed.add(s.id);
    if (list.length) rows.push({ id: phase.id, label: phase.label, stations: list });
  }
  const other = stations.filter((s) => !placed.has(s.id));
  if (other.length) rows.push({ id: "other", label: "Other", stations: other });
  return rows;
}

const n = (value: number) => value.toLocaleString("en-US");

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A reason in plain words: the cancel and outcome texts the flow knows, a
 * workflow step's name, a failing check's name, an error's leading words,
 * or the validator rule.
 */
export function reasonLabel(cause: string): string {
  const known = causeText(cause);
  if (known) return known;
  const at = cause.indexOf(":");
  const family = at < 0 ? "" : cause.slice(0, at);
  const rest = at < 0 ? cause : cause.slice(at + 1);
  // An error's leading words can end on the word that starts its detail ("…not found: rule `x`").
  if (family === "infra" || family === "text") return sentence(rest.replace(/-+/g, " ").replace(/ rule$/, "").trim());
  if (family === "check") return `Check failed: ${rest}`;
  return ruleWords(cause);
}
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

function StageTable({ phases, maxReached }: { phases: PhaseRow[]; maxReached: number }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label="Stages">
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">Reached</th>
            <th scope="col">Result</th>
            <th scope="col">Passed by week</th>
            <th scope="col" className={styles.num}>Median</th>
            <th scope="col" className={styles.num}>p95</th>
            <th scope="col" className={styles.num}>Open now</th>
            <th scope="col">Main reason a case left</th>
          </tr>
        </thead>
        {phases.map((phase) => (
          <tbody key={phase.id}>
            <tr className={styles.phaseRow}>
              <th scope="rowgroup" colSpan={8}>
                {phase.label}
              </th>
            </tr>
            {phase.stations.map((s) => (
              <StageRow key={s.id} s={s} maxReached={maxReached} />
            ))}
          </tbody>
        ))}
      </table>
      <p className={styles.legend}>
        <span className={styles.keyOk}>passed</span>
        <span className={styles.keyFail}>failed</span>
        <span className={styles.keyCancel}>cancelled</span>
        <span className={styles.keyOpen}>still there</span>
        <span>
          <User size={12} aria-hidden /> a person acts at this stage
        </span>
      </p>
    </div>
  );
}

function StageRow({ s, maxReached }: { s: StationStats; maxReached: number }) {
  const open = s.flow.waiting_here;
  const total = s.ok + s.failed + s.cancelled + open;
  const top = s.flow.exit_causes[0];
  const reasons = s.flow.exit_causes.map((c) => `${c.cases} · ${reasonLabel(c.cause)}`).join("\n");
  const person = PERSON_STATIONS.has(s.id);
  return (
    <tr>
      <th scope="row" title={s.description}>
        <span className={styles.stage}>
          {s.label}
          {person ? <User size={13} aria-label="A person acts here" className={styles.person} /> : null}
        </span>
      </th>
      <td>
        <span className={styles.reached}>
          <span className={styles.reachedBar} style={{ width: `${(s.cases / maxReached) * 100}%` }} />
          <span className={styles.count}>{n(s.cases)}</span>
        </span>
      </td>
      <td>
        <span
          className={styles.result}
          title={`${n(s.ok)} passed · ${n(s.failed)} failed · ${n(s.cancelled)} cancelled · ${n(open)} still there${
            s.tries ? `\nTries: ${n(s.tries.ok)} of ${n(s.tries.total)} passed` : ""
          }${s.waived ? `\n${n(s.waived)} passed under a waiver` : ""}`}
        >
          <span className={styles.stack} aria-hidden>
            {total ? (
              <>
                <span className={styles.ok} style={{ flexGrow: s.ok }} />
                <span className={styles.fail} style={{ flexGrow: s.failed }} />
                <span className={styles.cancel} style={{ flexGrow: s.cancelled }} />
                <span className={styles.open} style={{ flexGrow: open }} />
              </>
            ) : null}
          </span>
          <span className={styles.resultText}>
            {share(s.ok, s.ok + s.failed + s.cancelled)}
            {s.tries ? <span className={styles.sub}> · tries {share(s.tries.ok, s.tries.total)}</span> : null}
          </span>
        </span>
      </td>
      <td>
        <Spark weekly={s.weekly} />
      </td>
      <td className={styles.num}>
        {s.timed ? formatDuration(s.p50_ms) : s.id === "dispatch" ? "" : <span className={styles.none}>not measured</span>}
      </td>
      <td className={styles.num}>{s.timed ? formatDuration(s.p95_ms) : ""}</td>
      <td className={styles.num}>{s.wip ? n(s.wip) : ""}</td>
      <td className={styles.reason} title={reasons || undefined}>
        {top ? (
          <>
            <span className={styles.reasonText}>{reasonLabel(top.cause)}</span>
            <span className={styles.sub}> · {n(top.cases)}</span>
          </>
        ) : null}
      </td>
    </tr>
  );
}

/** Weekly share that passed: one dot per week with a finished visit, on a 0–100% scale. */
function Spark({ weekly }: { weekly: StationStats["weekly"] }) {
  const weeks = weekly.filter((w) => w.finished > 0);
  if (weeks.length < 2) return <span className={styles.none}>{weeks.length ? "1 week" : ""}</span>;
  const w = 88;
  const h = 22;
  const x = (i: number) => 3 + (i / (weeks.length - 1)) * (w - 6);
  const y = (v: number) => 3 + (1 - v) * (h - 6);
  const points = weeks.map((wk, i) => `${x(i).toFixed(1)},${y(wk.ok / wk.finished).toFixed(1)}`).join(" ");
  const title = weeks.map((wk) => `${wk.week}: ${wk.ok} of ${wk.finished} passed`).join("\n");
  return (
    <svg className={styles.spark} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Weekly share passed">
      <title>{title}</title>
      <line x1="0" x2={w} y1={y(0)} y2={y(0)} className={styles.sparkBase} />
      <polyline points={points} className={styles.sparkLine} />
      {weeks.map((wk, i) => (
        <circle key={wk.week} cx={x(i)} cy={y(wk.ok / wk.finished)} r={wk.finished >= 5 ? 2 : 1.4} className={styles.sparkDot} />
      ))}
    </svg>
  );
}

function TimeBars({ stations }: { stations: StationStats[] }) {
  const timed = stations.filter((s) => s.timed_visits > 0 && s.total_ms > 0);
  if (!timed.length) return <p className={styles.none}>No stage carries a measured time in this window.</p>;
  const max = Math.max(...timed.map((s) => s.total_ms));
  return (
    <div className={styles.bars}>
      {timed.map((s) => {
        const person = PERSON_STATIONS.has(s.id);
        return (
          <div key={s.id} className={styles.barRow}>
            <span className={styles.barLabel}>
              {s.label}
              {person ? <User size={12} aria-label="A person acts here" className={styles.person} /> : null}
            </span>
            <span className={styles.barTrack}>
              <span className={person ? styles.barPerson : styles.barMachine} style={{ width: `${Math.max(0.4, (s.total_ms / max) * 100)}%` }} />
            </span>
            <span className={styles.barValue}>
              {formatDuration(s.total_ms)}
              <span className={styles.sub}> · {n(s.timed_visits)} visits</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RetryBars({ steps }: { steps: NonNullable<FlowModel["retry"]>["steps"] }) {
  return (
    <div className={styles.bars}>
      {steps.map((step) => (
        <div key={step.try_no} className={styles.barRow}>
          <span className={styles.barLabel}>
            Try {step.label}
            {step.models.length ? <span className={styles.sub}> · {step.models.join(", ")}</span> : null}
          </span>
          <span className={styles.barTrack} title={`${step.passed} of ${step.tries} tries passed`}>
            <span className={styles.barMachine} style={{ width: `${Math.max(0.4, (step.passed / Math.max(1, step.tries)) * 100)}%` }} />
          </span>
          <span className={styles.barValue}>
            {share(step.passed, step.tries)}
            <span className={styles.sub}>
              {" "}
              · {n(step.passed)} of {n(step.tries)}
              {step.cost_usd ? ` · $${step.cost_usd.toFixed(2)}` : ""}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

const RULE_ROWS = 10;

function RuleTable({ model }: { model: FlowModel }) {
  const rules = [...model.ladder.rules].sort((a, b) => b.occurrences - a.occurrences).slice(0, RULE_ROWS);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label="Validator rules">
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col" className={styles.num}>Tries</th>
            <th scope="col" className={styles.num}>Runs</th>
            <th scope="col" className={styles.num} title="Of tries with a next try: the next try failed the same rule">
              Next try fails it again
            </th>
            <th scope="col" className={styles.num} title="Runs that hit the rule and passed on a later try">
              Passed later
            </th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.rule_id}>
              <th scope="row" className={styles.rule} title={r.rule_id}>
                {reasonLabel(r.rule_id)}
              </th>
              <td className={styles.num}>{n(r.occurrences)}</td>
              <td className={styles.num}>{n(r.cases)}</td>
              <td className={styles.num}>
                {r.stick_rate == null ? "–" : `${Math.round(r.stick_rate * 100)}%`}
                <span className={styles.sub}> · {n(r.persisted)} of {n(r.persisted + r.fixed)}</span>
              </td>
              <td className={styles.num}>{n(r.recovered)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RuleTrends({ trends }: { trends: RuleTrend[] }) {
  return (
    <div className={styles.multiples}>
      {trends.map((t) => (
        <figure key={t.rule_id} className={styles.multiple}>
          <figcaption title={t.rule_id}>{reasonLabel(t.rule_id)}</figcaption>
          <TrendChart trend={t} />
          <p className={styles.sub}>
            {t.rerun.citations
              ? `Run again 7+ days later: ${t.rerun.still} of ${t.rerun.citations} citations still hit it`
              : "No citation run again 7+ days later"}
          </p>
        </figure>
      ))}
    </div>
  );
}

function TrendChart({ trend }: { trend: RuleTrend }) {
  const weeks = trend.weekly;
  const w = 220;
  const h = 64;
  const pad = 4;
  if (!weeks.length) return null;
  const first = Date.parse(weeks[0].week);
  const last = Date.parse(weeks[weeks.length - 1].week) + 7 * 86_400_000;
  const span = Math.max(1, last - first);
  const xt = (ms: number) => pad + ((ms - first) / span) * (w - 2 * pad);
  const xw = (week: string) => xt(Date.parse(week) + 3.5 * 86_400_000);
  // Room above for the value labels and below for the dates.
  const y = (v: number) => 12 + (1 - v) * (h - 26);
  const points = weeks.map((wk) => `${xw(wk.week).toFixed(1)},${y(wk.hit / Math.max(1, wk.cases)).toFixed(1)}`).join(" ");
  const changes = trend.changes.filter((c) => {
    const at = Date.parse(c.at);
    return at >= first && at <= last;
  });
  return (
    <svg className={styles.trend} viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${ruleWords(trend.rule_id)} by week`}>
      <title>{weeks.map((wk) => `${wk.week}: ${wk.hit} of ${wk.cases} runs`).join("\n")}</title>
      <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} className={styles.sparkBase} />
      {changes.map((c, i) => (
        <line key={`${c.at}-${i}`} x1={xt(Date.parse(c.at))} x2={xt(Date.parse(c.at))} y1={pad} y2={y(0)} className={styles.change}>
          <title>{`${c.at.slice(0, 10)} · ${c.number ? `#${c.number} ` : ""}${c.title ?? "encoder change"}`}</title>
        </line>
      ))}
      <polyline points={points} className={styles.sparkLine} />
      {weeks.map((wk) => {
        const v = wk.hit / Math.max(1, wk.cases);
        return (
          <g key={wk.week}>
            <circle cx={xw(wk.week)} cy={y(v)} r={2} className={styles.sparkDot} />
            <text x={xw(wk.week)} y={y(v) - 5} textAnchor="middle" className={styles.axis}>
              {Math.round(v * 100)}%
            </text>
          </g>
        );
      })}
      <text x={pad} y={h - 1} className={styles.axis}>
        {weeks[0].week.slice(5)}
      </text>
      <text x={w - pad} y={h - 1} textAnchor="end" className={styles.axis}>
        {weeks[weeks.length - 1].week.slice(5)}
      </text>
    </svg>
  );
}

function Coverage({ model }: { model: FlowModel }) {
  const t = model.trust;
  const untimed = t.untimed.map((id) => model.stations.find((s) => s.id === id)?.label ?? id);
  return (
    <ul className={styles.coverage}>
      <li>
        {`${n(t.dispatched)} dispatched runs: ${n(t.with_tries)} have per-try records${
          t.tries_since ? ` (recorded since ${t.tries_since.slice(0, 10)})` : ""
        }, ${n(t.with_cost)} have a model cost.`}
      </li>
      {untimed.length ? <li>Time not measured: {untimed.join(", ")}.</li> : null}
      {t.partly_timed.length ? (
        <li>
          Time measured for part of the visits:{" "}
          {t.partly_timed.map((p) => `${model.stations.find((s) => s.id === p.station)?.label ?? p.station} ${Math.round(p.share * 100)}%`).join(", ")}.
        </li>
      ) : null}
      <li>
        Window {model.window.from.slice(0, 10)} to {model.window.to.slice(0, 10)} · {n(model.events)} events · read{" "}
        {model.generated_at.slice(0, 16).replace("T", " ")} UTC.
      </li>
    </ul>
  );
}
