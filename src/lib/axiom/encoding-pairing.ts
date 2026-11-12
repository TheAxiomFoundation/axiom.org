/**
 * Encoding attempt pairing: one record per target citation, paired with
 * every run, every try's gate, every fix PR and every rulespec PR, and the
 * state the target is in (and was in) over time.
 *
 * Pure functions over encodings.pipeline_events rows (PipelineEvent). Nothing
 * here reads a table or GitHub, and nothing is stored: the state is computed
 * from the events each time, as the stages on /ops are.
 *
 * Ported from the Python prototype in axiom-encode-economics
 * (src/encoding_economics/model/pairing.py and pairing_build.py, branch
 * pavel/encoding-pairing). Gate names, the gate tables, the cascade-step rule
 * and the state machine match the prototype, so the two agree on the same
 * history. What differs is the input: the prototype parsed run logs and
 * guessed fix-PR links from PR text; here the links are events.
 *
 * What the events carry, per case (a case is one run):
 *   run       dispatch / approval / setup / target_gate / generate / validate /
 *             publish events (pipeline-events.ts attemptEvents). A local run
 *             is a case `local:<ledger id>` with generate / validate events
 *             only; no producer writes those yet (the collector will, after
 *             axiom-encode #1750), so today every run is a dispatch
 *   tries     a generate `enter` per try (try_no, actor = model) and a validate
 *             `leave` or `fail`; `issue` events add archived findings per try
 *   rulespec  pr_checks / review / merge events of the run's signed manifest PR
 *   fix PRs   station `encoder_fix` (axiom-encode PRs with `Fixes-Run:` lines,
 *             axiom-encode #2156): case_id = the run it answered, or
 *             `target:<citation>` for `Fixes-Run: none`
 *
 * Unknown stays null, never a guess.
 *
 * Known limit of the producer: attemptEvents stops at a failing or pending
 * check on an unmerged PR and emits no close for it, so a PR closed in that
 * condition still reads as open here until the collector records the close.
 */

import type { PipelineEvent } from "./pipeline-events";

/** A pipeline_events row; `source` is free text in the table (encoder_pr, *_backfill, ...). */
export type PairingEvent = Omit<PipelineEvent, "source"> & { source: string };

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * FINDING_GATES classifies the text of an encoder refusal, "<stage>: <message>"
 * (or the message alone). Read top to bottom, first match wins. Used only for
 * findings without a typed check id (see gateForCheck).
 */
export const FINDING_GATES: ReadonlyArray<readonly [string, RegExp]> = [
  ["oracle", /existing-target-oracle-contract|\boracle\b/i],
  ["numeric-recall", /numeric-recall|ungrounded generated numeric literal|ungrounded[_ ]literal|embedded[_ ]scalar[_ ]literal|embedded scalar literal/i],
  ["compile", /^compile:|yaml parse|invalid yaml|failed compile validation|rules engine compile/i],
  [
    "dependencies",
    /must directly import|required atomic module|temporal-dependency-coverage|legacy scalar rule|external source replacement|source relation target|legacy replacement|replacement (rulespec|legacy|plural|target|source)|legacy (citation|provision index)|import cycle/i,
  ],
  [
    "companion-tests",
    /complete-source-unit:tests|^ci: test case|^validation: .*test case|test input assignment|fixture_execution|required[-_]test[-_]case|test_case_|no tests found|companion output coverage/i,
  ],
  ["source-completeness", /complete-source-unit|neither encoded nor precisely deferred|source_sub_paragraph|sub-paragraph coverage missing|deferred_outputs/i],
  [
    "source-evidence",
    /\bproof\b|source-evidence|proof_atoms|source scope mismatch|outside requested source|source claims|corpus citation path|noncanonical_corpus|source unresolved/i,
  ],
  ["reviewer", /\breview(er)?\b|verdict/i],
  [
    "apply-guard",
    /provenance changed|refusing to (overwrite|shrink)|cannot apply supplemental|ownership manifest|not an encoder apply manifest|supplemental changes|repair candidates? require|retired manifest inventory|generation input digest|failed current overlay validation/i,
  ],
  ["corpus-source", /no local corpus source text|active corpus source .* repealed|could not isolate|corpuslayouterror|corpus\/provisions directory not found/i],
  ["admission-pin", /admission|\bpin\b|fingerprint|waiver|signature/i],
  ["generation", /no rulespec content|empty (model )?response|model (call|response) failed/i],
  ["infra", /http \d{3}|timed? ?out|rate limit|connection (reset|refused)|no space left|unsafecorpuspath|could not safely open/i],
  ["ci-other", /^ci:|^validation:|failed ci validation/i],
];

/** STEP_GATES classifies a run that failed in a workflow step before or outside the encoder, by the step's name. */
export const STEP_GATES: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "admission-pin",
    /failed-attempt budget|immutable checkout identit|protected rulespec routing|existing signed import|generated provenance|trusted prior-run repair candidate|country routing|signature|rulespec-pinned|dependent cascade|retired source metadata|authenticated corpus transport/i,
  ],
  ["source-evidence", /atomic source inputs/i],
  [
    "infra",
    /set up|install|checkout|build|fetch|download|prefetch|provision|upload|corpus read credentials|push lane|commit reviewed|package exact|bind rules engine|checksums/i,
  ],
];

/** Every gate name, in table order, and "other" for text no table matches. */
export const GATE_NAMES: readonly string[] = Array.from(new Set([...FINDING_GATES.map(([g]) => g), ...STEP_GATES.map(([g]) => g), "other"]));

/** Workflow steps whose failure is a consequence of an earlier failure, never the cause. */
export const CASCADE_STEPS =
  /^(Apply prepared signature|Prepare apply signature|Complete signed encode checkpoints|Record completed model-capable generation|Summarize model spend|Post |Complete job|Finalize signed re-encode artifact|Upload signed re-encode artifact|Upload .*failure|Package .*failure)/i;
export const ENCODE_STEP = /^Encode, review, validate/i;

/** Gate of an encoder refusal, from "<stage>: <message>" (or the message alone). */
export function classifyGate(text: string | null | undefined): string {
  if (!text) return "other";
  for (const [gate, rx] of FINDING_GATES) if (rx.test(text)) return gate;
  return "other";
}

// The step table with hyphens read as spaces, so a kebab-cased step (an
// `infra:<step>` rule or check id) reads the same as the step's own name.
const STEP_GATES_SPACED = STEP_GATES.map(([g, rx]) => [g, new RegExp(rx.source.replace(/-/g, " "), "i")] as const);

/** Gate of a run that failed in a workflow step other than the encoder. */
export function classifyStep(step: string | null | undefined): string {
  if (!step) return "other";
  const spaced = stepName(step).replace(/[-_]+/g, " ");
  for (const [gate, rx] of STEP_GATES_SPACED) if (rx.test(spaced)) return gate;
  return "other";
}

/** "Queue protected ... / Verify immutable checkout identities" -> the step alone. */
function stepName(step: string): string {
  return step.includes(" / ") ? step.slice(step.lastIndexOf(" / ") + 3) : step;
}

const STAGE_RE = /^(?:[^:]+\.ya?ml: )?(\w[\w-]*): ([\s\S]*)$/;

/** `regulations/x.yaml: ci: [rule] Source ...` -> ["ci", "[rule] Source ..."]. */
export function splitFinding(text: string): [string | null, string] {
  const m = text.trim().match(STAGE_RE);
  return m ? [m[1], m[2].trim()] : [null, text.trim()];
}

/** Gate of a validator message: its file prefix dropped, then the finding table. */
export function gateForMessage(message: string | null | undefined): string {
  if (!message) return "other";
  const [stage, finding] = splitFinding(message);
  return classifyGate(stage ? `${stage}: ${finding}` : finding);
}

/**
 * Typed check ids (axiom-encode/validation-issue/v2 `check`, and the bracketed
 * rule of older messages) by family. A check id names its gate exactly, so it
 * wins over the message text; an id no family names returns null and the
 * caller falls back to the message.
 */
const CHECK_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^compile:/, "compile"],
  [/^complete-source-unit:tests(\/|$)/, "companion-tests"],
  [/^complete-source-unit:numeric-recall(\/|$)/, "numeric-recall"],
  [/^complete-source-unit(:|\/|$)/, "source-completeness"],
  [/^proof:/, "source-evidence"],
  [/^existing-target-oracle-contract(\/|:|$)/, "oracle"],
  [/^temporal-dependency-coverage(\/|:|$)/, "dependencies"],
  [/^pin:/, "admission-pin"],
];

/** Gate of a typed check id, or null when no family names it. */
export function gateForCheck(check: string | null | undefined): string | null {
  if (!check) return null;
  const id = check.trim().toLowerCase();
  if (id.startsWith("infra:")) {
    // A step the step table does not know (`infra:encode-review-validate-...`,
    // `infra:apply-blocked-validation`) names no gate: read the message.
    const gate = classifyStep(id.slice("infra:".length));
    return gate === "other" ? null : gate;
  }
  for (const [rx, gate] of CHECK_FAMILIES) if (rx.test(id)) return gate;
  return null;
}

/** Whether a rule id is a typed check (not a `text:` class from issueRuleId). */
function typedRule(rule: string | null | undefined): rule is string {
  return Boolean(rule && !rule.startsWith("text:") && !rule.startsWith("check:"));
}

function eventChecks(e: PairingEvent): string[] {
  const checks = e.attrs?.checks;
  return Array.isArray(checks) ? checks.filter((c): c is string => typeof c === "string") : [];
}

/**
 * Gate of one failed try: typed check ids first (`attrs.checks`, then a typed
 * `rule_id`), the message only when the try carries no typed id. Issue
 * events of the same try count as the try's own findings.
 */
export function tryGate(events: PairingEvent[]): string {
  for (const e of events) for (const c of eventChecks(e)) {
    const g = gateForCheck(c);
    if (g) return g;
  }
  for (const e of events) {
    if (typedRule(e.rule_id)) {
      const g = gateForCheck(e.rule_id);
      if (g) return g;
    }
  }
  for (const e of events) {
    if (e.message) {
      const g = gateForMessage(e.message);
      if (g !== "other") return g;
    }
  }
  return "other";
}

interface JobStep {
  name?: string | null;
  conclusion?: string | null;
}
interface Job {
  name?: string | null;
  conclusion?: string | null;
  steps?: JobStep[] | null;
}

/** [job, step] of the first failing step that is not a cascade step, from a run's jobs.json. */
export function firstFailingStep(jobs: { jobs?: Job[] | null } | null | undefined): [string | null, string | null] {
  if (!jobs) return [null, null];
  let fallback: [string | null, string | null] = [null, null];
  for (const job of jobs.jobs ?? []) {
    for (const step of job.steps ?? []) {
      if (step.conclusion !== "failure") continue;
      if (CASCADE_STEPS.test(step.name ?? "")) {
        if (!fallback[0]) fallback = [job.name ?? null, step.name ?? null];
        continue;
      }
      return [job.name ?? null, step.name ?? null];
    }
    if (job.conclusion === "failure" && !fallback[0]) fallback = [job.name ?? null, null];
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const PAIRING_STATES = [
  "generating",
  "refused-waiting-fix",
  "fix-PR-in-review",
  "waiting-rerun",
  "signed-waiting-rulespec-PR",
  "rulespec-PR-open",
  // An open rulespec PR whose checks fail because its candidate was signed by
  // an encoder version other than the repo's pin. Kept as its own state until
  // the pin-decoupling stack (axiom-encode #2091) lands; after that a pin no
  // longer gates the merge and this folds into rulespec-PR-open.
  "blocked-on-pin",
  "landed",
  "abandoned",
] as const;
export type PairingState = (typeof PAIRING_STATES)[number];

/** A target with no activity for this long is abandoned (it keeps what it waited on). */
export const ABANDON_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

export interface PairingTry {
  try: number;
  model: string | null;
  ok: boolean;
  /** Null for a try that passed. */
  gate: string | null;
  rule_id: string | null;
  checks: string[];
  message: string | null;
}

export interface PairingRun {
  id: string;
  kind: "signed" | "local";
  start: string;
  /** Null while the run is in progress. */
  end: string | null;
  outcome: "success" | "failure" | "cancelled" | null;
  encoder_version: string | null;
  url: string | null;
  tries: PairingTry[];
  /** Gate of a failed run: the encoder's final refusal, else its failing step. */
  gate: string | null;
  gate_basis: string;
  finding: string | null;
}

export interface FixPr {
  id: string;
  number: number | null;
  url: string | null;
  title: string | null;
  created: string;
  merged: string | null;
  closed: string | null;
  draft: boolean;
  changes_requested: boolean;
  /** declared (Fixes-Run lines) or inferred (backfill from PR text). */
  link: string;
  confidence: string;
  /** Only declared, high and medium links count and move the state. */
  counted: boolean;
  /** The runs it answered (case ids), none for `Fixes-Run: none`. */
  fixes_runs: string[];
  encoder_version: string | null;
}

export interface RulespecPr {
  id: string;
  case_id: string;
  repo: string | null;
  number: number | null;
  url: string | null;
  created: string;
  /** The PR merged (into its base). */
  merged: string | null;
  /** The change reached the default branch (directly, or through a side branch's PR). */
  landed: string | null;
  closed: string | null;
  side_branch: boolean;
  candidate_version: string | null;
  checks: "pending" | "failing" | "green" | null;
  failed_checks: string[];
  check_error: string | null;
  review: "changes_requested" | "awaiting_review" | null;
  reviewers: string | null;
  /** The repo's pin: what the collector recorded on the failing check ("check"), else the pin history today ("history"). */
  pin_version: string | null;
  pin_source: "check" | "history" | null;
  /** The collector marked the failing check as a pin mismatch (rule `pin:mismatch`). */
  pin_reported: boolean;
  pin_mismatch: boolean;
  /** Reasons an open PR has not merged, each read from an event. Empty unless open. */
  why_not_merged: string[];
}

export interface StateSegment {
  state: PairingState;
  start: string;
  end: string;
  hours: number;
  reason: string;
}

export interface TargetPairing {
  citation: string;
  jurisdiction: string | null;
  first_activity: string | null;
  latest_activity: string | null;
  runs: PairingRun[];
  run_counts: { count: number; failed: number; succeeded: number; cancelled: number; in_progress: number; signed: number; local: number };
  /** Counted fix PRs. */
  fix_prs: FixPr[];
  /** Low-confidence links: listed, never counted. */
  fix_prs_low: FixPr[];
  rulespec_prs: RulespecPr[];
  /** Rulespec PRs that landed. */
  landings: string[];
  state: PairingState | null;
  reason: string | null;
  /** What an abandoned target waited on; the state itself otherwise. */
  waiting_on: PairingState | null;
  state_since: string | null;
  hours_in_current_state: number | null;
  timeline: StateSegment[];
  hours_in_state: Partial<Record<PairingState, number>>;
}

/** Encoder version a repo pins, newest first or in any order: [{at, version}]. */
export type PinHistory = Record<string, Array<{ at: string; version: string }>>;

export interface PairingOptions {
  now: string | number | Date;
  /** Pin history per rulespec repo, for blocked-on-pin before the collector stores pin attrs. */
  pins?: PinHistory;
}

// --- the state machine, over plain times -----------------------------------

interface RunEv {
  id: string;
  kind: "signed" | "local";
  start: number;
  end: number | null;
  outcome: PairingRun["outcome"];
}

interface PrEv {
  id: string;
  created: number;
  merged: number | null;
  closed: number | null;
  /** Rulespec PRs only. */
  landed?: number | null;
  side_branch?: boolean;
  repo?: string | null;
  candidate_version?: string | null;
  checks_failing?: boolean;
  /** The collector's own pin evidence on the failing check event. */
  pin_version?: string | null;
  pin_mismatch?: boolean;
}

export interface Attempt {
  runs: RunEv[];
  fixPrs: PrEv[];
  rulespecPrs: PrEv[];
}

export interface Pin {
  at: number;
  version: string;
}

function pinAt(pins: Pin[] | undefined, t: number): string | null {
  let best: Pin | null = null;
  for (const p of pins ?? []) if (p.at <= t && (!best || p.at > best.at)) best = p;
  return best?.version ?? null;
}

function normalizePins(pins: PinHistory | undefined): Record<string, Pin[]> {
  const out: Record<string, Pin[]> = {};
  for (const [repo, list] of Object.entries(pins ?? {})) {
    out[repo] = list.map((p) => ({ at: Date.parse(p.at), version: p.version })).filter((p) => Number.isFinite(p.at));
  }
  return out;
}

function landedAt(p: PrEv): number | null {
  if (p.landed != null) return p.landed;
  return p.side_branch ? null : p.merged;
}

/** Every time something happened to the attempt, up to `now`, sorted. */
export function activityTimes(a: Attempt, now: number): number[] {
  const xs: number[] = [];
  for (const r of a.runs) {
    xs.push(r.start);
    if (r.end != null) xs.push(r.end);
  }
  for (const p of [...a.fixPrs, ...a.rulespecPrs]) {
    for (const x of [p.created, p.merged, p.closed, p.landed ?? null]) if (x != null) xs.push(x);
  }
  return xs.filter((x) => x <= now).sort((x, y) => x - y);
}

/**
 * [state, reason] of an attempt at time t, from the events at or before t.
 * A landing ends a cycle; a run that starts after it opens a new one (a
 * re-encode), and only that cycle's runs and PRs decide the state from then on.
 */
export function stateAt(a: Attempt, t: number, pins?: Record<string, Pin[]>): [PairingState | null, string] {
  const landings = a.rulespecPrs.map(landedAt).filter((x): x is number => x != null && x <= t);
  if (landings.length) {
    const at = Math.max(...landings);
    if (!a.runs.some((r) => at < r.start && r.start <= t)) return ["landed", "rulespec PR merged"];
    a = {
      runs: a.runs.filter((r) => r.start > at),
      fixPrs: a.fixPrs.filter((p) => p.created > at),
      rulespecPrs: a.rulespecPrs.filter((p) => p.created > at),
    };
  }
  const running = a.runs.filter((r) => r.start <= t && (r.end == null || r.end > t));
  if (running.length) {
    const r = running[running.length - 1];
    return ["generating", `${r.kind} run ${r.id} in progress`];
  }
  const acts = activityTimes(a, t);
  if (!acts.length) return [null, "no activity yet"];
  const [state, reason] = waitingState(a, t, pins);
  const last = acts[acts.length - 1];
  if (t - last >= ABANDON_AFTER_MS) return ["abandoned", `no activity since ${nyLabel(last)}; last state ${state}: ${reason}`];
  return [state, reason];
}

/** What the attempt waits on at t, given nothing runs and it has not landed. */
function waitingState(a: Attempt, t: number, pins?: Record<string, Pin[]>): [PairingState, string] {
  const openRs = a.rulespecPrs.filter((p) => {
    if (p.created > t || (p.closed != null && p.closed <= t)) return false;
    // Merged but not on main yet (a side branch): still waits for that branch's own PR.
    const landed = landedAt(p);
    return !(landed != null && landed <= t);
  });
  const fixesOpen = a.fixPrs.filter((p) => p.created <= t && !(p.merged != null && p.merged <= t) && !(p.closed != null && p.closed <= t));
  if (openRs.length) {
    for (const p of openRs) {
      if (!p.checks_failing) continue;
      const pin = p.pin_version ?? pinAt(p.repo ? pins?.[p.repo] : undefined, t);
      const mismatch = p.pin_mismatch || Boolean(p.candidate_version && pin && p.candidate_version !== pin);
      if (mismatch) {
        return ["blocked-on-pin", `${p.id}: candidate encoder ${p.candidate_version ?? "unknown"} vs pin ${pin ?? "unknown"}, checks failing`];
      }
    }
    const p = openRs[openRs.length - 1];
    return ["rulespec-PR-open", p.merged != null && p.merged <= t ? `${p.id} merged into a side branch, not yet on main` : `${p.id} open`];
  }
  const done = a.runs.filter((r) => r.end != null && r.end <= t);
  const last = done.length ? done.reduce((x, y) => ((y.end as number) >= (x.end as number) ? y : x)) : null;
  if (last && last.outcome === "success") {
    if (last.kind === "signed") return ["signed-waiting-rulespec-PR", `signed run ${last.id} succeeded`];
    return ["waiting-rerun", `local run ${last.id} succeeded; needs a signed run`];
  }
  const since = last ? (last.end as number) : -Infinity;
  if (fixesOpen.length) return ["fix-PR-in-review", `${fixesOpen[fixesOpen.length - 1].id} open`];
  const mergedSince = a.fixPrs.filter((p) => p.merged != null && since < p.merged && p.merged <= t);
  if (mergedSince.length) return ["waiting-rerun", `${mergedSince[mergedSince.length - 1].id} merged after the last run`];
  if (!last) return ["waiting-rerun", "fix merged before any run"];
  if (last.outcome === "cancelled") return ["waiting-rerun", `run ${last.id} cancelled`];
  return ["refused-waiting-fix", `${last.kind} run ${last.id} refused`];
}

/** Consecutive states from first activity to now, without gaps. */
export function timeline(a: Attempt, now: number, pins?: Record<string, Pin[]>): StateSegment[] {
  const acts = activityTimes(a, now);
  if (!acts.length) return [];
  const points = new Set<number>(acts);
  for (const x of acts) if (x + ABANDON_AFTER_MS < now) points.add(x + ABANDON_AFTER_MS);
  for (const p of a.rulespecPrs) {
    // A pin change can move an open PR in or out of blocked-on-pin.
    for (const pin of (p.repo && pins?.[p.repo]) || []) if (p.created < pin.at && pin.at < now) points.add(pin.at);
  }
  const sorted = [...points].filter((x) => x <= now).sort((x, y) => x - y);
  const out: Array<{ state: PairingState; start: number; end: number; reason: string }> = [];
  sorted.forEach((start, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1] : now;
    const [state, reason] = stateAt(a, start, pins);
    if (state == null) return;
    const prev = out[out.length - 1];
    if (prev && prev.state === state) prev.end = end;
    else out.push({ state, start, end, reason });
  });
  return out.map((s) => ({ state: s.state, start: iso(s.start), end: iso(s.end), hours: round((s.end - s.start) / HOUR_MS, 2), reason: s.reason }));
}

// ---------------------------------------------------------------------------
// From events to attempts
// ---------------------------------------------------------------------------

const RUN_STATIONS = new Set(["dispatch", "approval", "setup", "target_gate", "generate", "validate", "publish"]);
const PR_STATIONS = new Set(["pr_checks", "review", "merge"]);
export const FIX_STATION = "encoder_fix";

/** Run cases: dispatches and local runs. `dep:` modules ride another target's run and `pr:` rows have none. */
function isRunCase(caseId: string): boolean {
  return !caseId.startsWith("dep:") && !caseId.startsWith("pr:") && !caseId.startsWith("target:");
}

const STATION_RANK: Record<string, number> = { dispatch: 0, approval: 1, setup: 2, target_gate: 3, generate: 4, validate: 5, publish: 6, pr_checks: 7, review: 8, merge: 9 };
const KIND_RANK: Record<string, number> = { enter: 0, wait: 1, issue: 2, leave: 3, fail: 3, cancel: 3, change: 4 };

function ms(at: string): number {
  return Date.parse(at);
}

function byTime(a: PairingEvent, b: PairingEvent): number {
  return (
    ms(a.at) - ms(b.at) ||
    (STATION_RANK[a.station] ?? 99) - (STATION_RANK[b.station] ?? 99) ||
    (a.try_no ?? 0) - (b.try_no ?? 0) ||
    (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9)
  );
}

function buildRun(caseId: string, events: PairingEvent[]): PairingRun | null {
  const runEvents = events.filter((e) => RUN_STATIONS.has(e.station) && e.kind !== "change");
  const flow = runEvents.filter((e) => e.kind !== "issue");
  if (!flow.length) return null;
  const kind: PairingRun["kind"] = caseId.startsWith("local:") ? "local" : "signed";
  const start = Math.min(...flow.map((e) => ms(e.at)));
  const lastAt = Math.max(...flow.map((e) => ms(e.at)));

  // Tries: a generate enter per try, a validate leave or fail.
  // A run-level fail (the encode step failed with no try verdict) carries the
  // try count, not a try: it is the run's finding, never a try's.
  const perTry = runEvents.filter((e) => e.attrs?.run_level !== true);
  const tryNos = Array.from(new Set(perTry.filter((e) => (e.station === "generate" || e.station === "validate") && e.try_no != null).map((e) => e.try_no as number))).sort((x, y) => x - y);
  const tries: PairingTry[] = tryNos.map((n) => {
    const own = perTry.filter((e) => e.try_no === n);
    const gen = own.find((e) => e.station === "generate" && e.kind === "enter");
    const fail = own.find((e) => e.station === "validate" && e.kind === "fail");
    const pass = own.find((e) => e.station === "validate" && e.kind === "leave");
    const issues = own.filter((e) => e.station === "validate" && e.kind === "issue");
    const ok = Boolean(pass) && !fail;
    const failed = Boolean(fail) || (!pass && issues.length > 0);
    const findings = [...(fail ? [fail] : []), ...issues];
    return {
      try: n,
      model: gen?.actor ?? fail?.actor ?? null,
      ok,
      gate: failed ? tryGate(findings) : null,
      rule_id: fail?.rule_id ?? issues[0]?.rule_id ?? null,
      checks: Array.from(new Set(findings.flatMap(eventChecks))),
      message: fail?.message ?? issues[0]?.message ?? null,
    };
  });

  const find = (pred: (e: PairingEvent) => boolean) => flow.filter(pred).sort(byTime).at(-1);
  const cancel = find((e) => e.kind === "cancel");
  const publishDone = find((e) => e.station === "publish" && (e.kind === "leave" || (e.kind === "fail" && e.outcome === "no_pr") || (e.kind === "wait" && e.outcome === "host_run")));
  const stepFail = find((e) => e.kind === "fail" && e.station !== "validate" && !(e.station === "publish" && e.outcome === "no_pr"));
  const runLevelFail = find((e) => e.station === "validate" && e.kind === "fail" && e.attrs?.run_level === true);
  const publishOpen = flow.some((e) => e.station === "publish");
  const lastTry = tries.at(-1);

  let outcome: PairingRun["outcome"] = null;
  let end: number | null = null;
  let terminal: PairingEvent | undefined;
  if (cancel) {
    outcome = "cancelled";
    terminal = cancel;
  } else if (stepFail) {
    outcome = "failure";
    terminal = stepFail;
  } else if (runLevelFail) {
    outcome = "failure";
    terminal = runLevelFail;
  } else if (publishDone) {
    outcome = "success";
    terminal = publishDone;
  } else if (!publishOpen && lastTry?.gate) {
    // The last try refused and nothing was published: the run ended there.
    outcome = "failure";
  } else if (!publishOpen && kind === "local" && lastTry?.ok) {
    // A local run has no publish step: its last try passing is its success.
    outcome = "success";
  }
  if (outcome) end = Math.max(lastAt, terminal ? ms(terminal.at) : lastAt);

  const [gate, basis, finding] = runGate(outcome, terminal, tries);
  const url = flow.find((e) => e.station === "dispatch" && e.ref_url)?.ref_url ?? terminal?.ref_url ?? null;
  const version = flow.find((e) => e.encoder_version)?.encoder_version ?? null;
  return { id: caseId, kind, start: iso(start), end: end == null ? null : iso(end), outcome, encoder_version: version, url, tries, gate, gate_basis: basis, finding };
}

/** Infra rule ids carry the failing step kebab-cased: `infra:verify-immutable-checkout-identities`. */
function failedStepOf(e: PairingEvent): string | null {
  if (!e.rule_id?.startsWith("infra:")) return null;
  const step = e.rule_id.slice("infra:".length);
  // Placeholders, not steps: the collector knew no step.
  return step === "unknown" || step === "no-pr" ? null : step;
}

/** A step name kebab-cased the way infraRuleId writes it. */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const ENCODE_STEP_SPACED = /^encode,? review,? validate/i;

/** The encode step, or a step whose failure only follows an earlier one. */
function encodeOrCascade(step: string): boolean {
  const spaced = stepName(step).replace(/[-_]+/g, " ");
  return ENCODE_STEP.test(spaced) || ENCODE_STEP_SPACED.test(spaced) || CASCADE_STEPS.test(spaced);
}

/**
 * [gate, basis, finding] of a run: the encoder's last refusal when the run
 * failed in the encode loop (or in a cascade step after it), else its
 * failing step. Ported from the prototype's _run_gate.
 */
function runGate(outcome: PairingRun["outcome"], terminal: PairingEvent | undefined, tries: PairingTry[]): [string | null, string, string | null] {
  if (outcome !== "failure") return [null, "n/a", null];
  const refused = tries.filter((t) => t.gate);
  const lastRefusal = refused.at(-1);
  const step = terminal ? failedStepOf(terminal) : null;
  // As in the prototype: no known step, the encode step, or a cascade step
  // means the encoder failed; a cascade step is never the cause.
  const encodeFailed = !terminal || terminal.station === "validate" || step == null || encodeOrCascade(step);
  if (!encodeFailed && step) return [classifyStep(step), `workflow step: ${step}`, terminal?.message ?? step];
  if (lastRefusal) return [lastRefusal.gate, "encoder refusal (final try)", lastRefusal.message];
  // The step's own infra rule names the step, not the finding: read the
  // message, unless the message is only the step's name (no encoder error).
  if (terminal) {
    const stepOnly = step != null && terminal.message != null && slug(stepName(terminal.message)) === step;
    const gate = stepOnly ? "other" : tryGate([{ ...terminal, rule_id: step != null ? null : terminal.rule_id }]);
    return [gate, "encode step failed with no refusal line", terminal.message];
  }
  return ["other", "no finding recorded", null];
}

function prRepoNumber(url: string | null | undefined): [string | null, number | null] {
  const m = url?.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
  return m ? [m[1], Number(m[2])] : [null, null];
}

function str(x: unknown): string | null {
  return typeof x === "string" && x ? x : null;
}

function buildRulespecPr(caseId: string, events: PairingEvent[], now: number, pins: Record<string, Pin[]>): RulespecPr | null {
  const pr = events.filter((e) => PR_STATIONS.has(e.station));
  const opened = pr.find((e) => e.station === "pr_checks" && e.kind === "enter");
  if (!opened) return null;
  // A PR with pending checks has no PR event with a url yet: the publish leave carries it.
  const urlEvent = [...pr, ...events.filter((e) => e.station === "publish" && e.kind === "leave")].find((e) => e.ref_url && /\/pull\/\d+/.test(e.ref_url));
  const [urlRepo, number] = prRepoNumber(urlEvent?.ref_url);
  const mergeLeave = pr.find((e) => e.station === "merge" && e.kind === "leave");
  const repo = urlRepo ?? str(mergeLeave?.attrs?.repo);
  const reviewLeave = pr.find((e) => e.station === "review" && e.kind === "leave");
  const closedEv = pr.find((e) => (e.station === "review" && e.kind === "fail" && e.outcome === "closed") || (e.station === "pr_checks" && e.kind === "cancel"));
  const sideWait = pr.find((e) => e.station === "merge" && (e.kind === "wait" || e.kind === "fail") && e.rule_id === "merge:side-branch");
  // A side branch whose own PR closed: the change never reaches main.
  const offMain = sideWait?.kind === "fail" ? sideWait : undefined;
  const checkFail = pr.find((e) => e.station === "pr_checks" && (e.kind === "fail" || e.kind === "wait") && e.outcome === "fail");
  const checkLeave = pr.find((e) => e.station === "pr_checks" && e.kind === "leave");
  const changes = pr.find((e) => e.station === "review" && e.kind === "wait" && e.outcome === "changes_requested");
  const awaiting = pr.find((e) => e.station === "review" && e.kind === "wait" && e.outcome === "awaiting_review");
  const candidate = str(checkFail?.attrs?.candidate_version) ?? events.find((e) => e.encoder_version)?.encoder_version ?? null;
  const evidencePin = str(checkFail?.attrs?.pin_version);
  const merged = reviewLeave ? ms(reviewLeave.at) : null;
  const landed = mergeLeave ? ms(mergeLeave.at) : merged != null && !sideWait ? merged : null;
  const closed = offMain ? ms(offMain.at) : !merged && closedEv ? ms(closedEv.at) : null;
  const failingNow = Boolean(checkFail && checkFail.kind === "fail");
  const failedChecks = Array.isArray(checkFail?.attrs?.failed_checks)
    ? (checkFail?.attrs?.failed_checks as unknown[]).filter((c): c is string => typeof c === "string")
    : checkFail?.rule_id?.startsWith("check:")
      ? [checkFail.rule_id.slice("check:".length)]
      : [];
  const reported = failingNow && checkFail?.rule_id === "pin:mismatch";
  const historyPin = pinAt(repo ? pins[repo] : undefined, now);
  const pinNow = evidencePin ?? historyPin;
  const pinMismatch = reported || Boolean(failingNow && candidate && pinNow && candidate !== pinNow);
  const out: RulespecPr = {
    id: repo && number != null ? `${repo}#${number}` : `${caseId}/pr`,
    case_id: caseId,
    repo,
    number,
    url: urlEvent?.ref_url?.replace(/\/checks\?.*$/, "") ?? null,
    created: opened.at,
    merged: merged == null ? null : iso(merged),
    landed: landed == null ? null : iso(landed),
    closed: closed == null ? null : iso(closed),
    side_branch: Boolean(sideWait) || Boolean(mergeLeave && merged != null && ms(mergeLeave.at) > merged),
    candidate_version: candidate,
    // A check that failed but did not hold the merge (a `wait`) is not failing now.
    checks: failingNow ? "failing" : checkLeave ? "green" : "pending",
    failed_checks: failedChecks,
    check_error: checkFail?.message ?? null,
    review: changes ? "changes_requested" : awaiting ? "awaiting_review" : null,
    reviewers: awaiting?.actor ?? null,
    pin_version: pinNow,
    pin_source: evidencePin ? "check" : historyPin ? "history" : null,
    pin_reported: reported,
    pin_mismatch: pinMismatch,
    why_not_merged: [],
  };
  if (landed == null && closed == null) out.why_not_merged = whyNotMerged(out, now);
  return out;
}

/** Reasons an open rulespec PR has not merged, each read from an event. */
export function whyNotMerged(pr: RulespecPr, now: number): string[] {
  const days = Math.floor((now - ms(pr.created)) / (24 * HOUR_MS));
  const out = [`open since ${nyLabel(ms(pr.created))} (${days} days)`];
  if (pr.merged) out.push("merged into a side branch; waits for that branch's own PR");
  if (pr.pin_reported && !(pr.candidate_version && pr.pin_version && pr.candidate_version !== pr.pin_version)) {
    out.push("pin mismatch reported on the failing check");
  }
  if (pr.candidate_version && pr.pin_version && pr.candidate_version !== pr.pin_version) {
    out.push(`pin mismatch: candidate signed by encoder ${pr.candidate_version}, ${pr.repo ?? "the repo"} pins ${pr.pin_version}`);
  } else if (!pr.candidate_version) {
    out.push("candidate encoder version unknown");
  }
  if (pr.checks === "failing") out.push(`failing checks${pr.failed_checks.length ? `: ${pr.failed_checks.slice(0, 4).join("; ")}` : ""}`);
  else if (pr.checks === "pending") out.push("checks pending");
  else if (pr.checks === "green") out.push("checks green");
  if (pr.review === "changes_requested") out.push("changes requested");
  else if (pr.review === "awaiting_review") out.push(`waiting review${pr.reviewers ? ` (requested: ${pr.reviewers})` : ""}`);
  return out;
}

function fixKey(e: PairingEvent): string | null {
  const pr = e.attrs?.pr;
  if (typeof pr === "number" || (typeof pr === "string" && pr)) return `axiom-encode#${pr}`;
  const [repo, n] = prRepoNumber(e.ref_url);
  return repo && n != null ? `${repo}#${n}` : e.ref_url ?? null;
}

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Whether a fix-PR link counts: declared lines always, inferred links only at high or medium confidence. */
export function countedLink(link: string, confidence: string): boolean {
  return link === "declared" || confidence === "high" || confidence === "medium";
}

function buildFixPrs(events: PairingEvent[]): FixPr[] {
  const byPr = new Map<string, PairingEvent[]>();
  for (const e of events) {
    const key = fixKey(e);
    if (!key) continue;
    byPr.set(key, [...(byPr.get(key) ?? []), e]);
  }
  const out: FixPr[] = [];
  for (const [id, all] of byPr) {
    // A declared link (Fixes-Run lines) wins over an inferred one for the same PR.
    const declared = all.filter((e) => e.attrs?.link !== "inferred");
    const evs = (declared.length ? declared : all).sort(byTime);
    const enter = evs.find((e) => e.kind === "enter") ?? evs[0];
    const merged = evs.find((e) => e.kind === "leave");
    const closed = evs.find((e) => e.kind === "cancel");
    const waits = evs.filter((e) => e.kind === "wait");
    const link = declared.length ? "declared" : "inferred";
    const confidence = declared.length
      ? "high"
      : evs.map((e) => str(e.attrs?.confidence) ?? "low").sort((x, y) => (CONFIDENCE_RANK[x] ?? 9) - (CONFIDENCE_RANK[y] ?? 9))[0];
    const n = Number(enter.attrs?.pr ?? prRepoNumber(enter.ref_url)[1]);
    out.push({
      id,
      number: Number.isFinite(n) ? n : null,
      url: enter.ref_url ?? null,
      title: str(enter.attrs?.title),
      created: enter.at,
      merged: merged?.at ?? null,
      closed: !merged && closed ? closed.at : null,
      draft: !merged && !closed && waits.at(-1)?.outcome === "draft",
      changes_requested: !merged && !closed && waits.some((w) => w.outcome === "changes_requested"),
      link,
      confidence,
      counted: countedLink(link, confidence),
      fixes_runs: Array.from(new Set(evs.map((e) => e.case_id).filter((c) => !c.startsWith("target:")))),
      encoder_version: merged?.encoder_version ?? null,
    });
  }
  return out.sort((a, b) => ms(a.created) - ms(b.created));
}

function runCounts(runs: PairingRun[]): TargetPairing["run_counts"] {
  return {
    count: runs.length,
    failed: runs.filter((r) => r.outcome === "failure").length,
    succeeded: runs.filter((r) => r.outcome === "success").length,
    cancelled: runs.filter((r) => r.outcome === "cancelled").length,
    in_progress: runs.filter((r) => r.outcome == null).length,
    signed: runs.filter((r) => r.kind === "signed").length,
    local: runs.filter((r) => r.kind === "local").length,
  };
}

function toNumber(now: PairingOptions["now"]): number {
  return now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
}

/**
 * One TargetPairing per citation with at least one run, from its events.
 * Targets come only from runs (as in the prototype): a fix PR or a rulespec
 * PR alone does not make a target.
 */
export function pairTargets(events: PairingEvent[], options: PairingOptions): TargetPairing[] {
  const now = toNumber(options.now);
  const pins = normalizePins(options.pins);
  const byCitation = new Map<string, PairingEvent[]>();
  for (const e of events) {
    const t = ms(e.at);
    if (!Number.isFinite(t) || t > now) continue;
    byCitation.set(e.citation, [...(byCitation.get(e.citation) ?? []), e]);
  }
  const out: TargetPairing[] = [];
  for (const [citation, evs] of byCitation) {
    const byCase = new Map<string, PairingEvent[]>();
    const fixEvents: PairingEvent[] = [];
    for (const e of evs) {
      if (e.station === FIX_STATION) {
        fixEvents.push(e);
        continue;
      }
      if (!isRunCase(e.case_id)) continue;
      byCase.set(e.case_id, [...(byCase.get(e.case_id) ?? []), e]);
    }
    const runs: PairingRun[] = [];
    const rulespecPrs: RulespecPr[] = [];
    for (const [caseId, caseEvents] of byCase) {
      const run = buildRun(caseId, caseEvents);
      if (!run) continue;
      runs.push(run);
      const pr = buildRulespecPr(caseId, caseEvents, now, pins);
      if (pr) rulespecPrs.push(pr);
    }
    if (!runs.length) continue;
    runs.sort((a, b) => ms(a.start) - ms(b.start));
    rulespecPrs.sort((a, b) => ms(a.created) - ms(b.created));
    const allFixes = buildFixPrs(fixEvents);
    const fixes = allFixes.filter((f) => f.counted);
    const attempt: Attempt = {
      runs: runs.map((r) => ({ id: r.id, kind: r.kind, start: ms(r.start), end: r.end == null ? null : ms(r.end), outcome: r.outcome })),
      fixPrs: fixes.map((f) => ({ id: f.id, created: ms(f.created), merged: f.merged == null ? null : ms(f.merged), closed: f.closed == null ? null : ms(f.closed) })),
      rulespecPrs: rulespecPrs.map((p) => ({
        id: p.id,
        created: ms(p.created),
        merged: p.merged == null ? null : ms(p.merged),
        closed: p.closed == null ? null : ms(p.closed),
        landed: p.landed == null ? null : ms(p.landed),
        side_branch: p.side_branch,
        repo: p.repo,
        candidate_version: p.candidate_version,
        checks_failing: p.checks === "failing" && p.landed == null && p.closed == null,
        // The collector's own pin evidence holds at every time; otherwise the
        // state machine reads the pin history at each time, not today's pin.
        pin_version: p.pin_source === "check" ? p.pin_version : null,
        pin_mismatch: p.pin_reported || (p.pin_source === "check" && p.pin_mismatch),
      })),
    };
    const tl = timeline(attempt, now, pins);
    const acts = activityTimes(attempt, now);
    const hours: Partial<Record<PairingState, number>> = {};
    for (const s of tl) hours[s.state] = (hours[s.state] ?? 0) + s.hours;
    for (const s of Object.keys(hours) as PairingState[]) hours[s] = round(hours[s] as number, 1);
    const current = tl.at(-1) ?? null;
    out.push({
      citation,
      jurisdiction: evs.find((e) => e.jurisdiction)?.jurisdiction ?? citation.split("/")[0] ?? null,
      first_activity: acts.length ? iso(acts[0]) : null,
      latest_activity: acts.length ? iso(acts[acts.length - 1]) : null,
      runs,
      run_counts: runCounts(runs),
      fix_prs: fixes,
      fix_prs_low: allFixes.filter((f) => !f.counted),
      rulespec_prs: rulespecPrs,
      landings: rulespecPrs.filter((p) => p.landed).map((p) => p.id),
      state: current?.state ?? null,
      // The segment keeps the reason it started with; the current reason is today's.
      reason: current ? stateAt(attempt, now, pins)[1] : null,
      waiting_on: current ? (current.state === "abandoned" ? lastState(current.reason) : current.state) : null,
      state_since: current?.start ?? null,
      hours_in_current_state: current?.hours ?? null,
      timeline: tl,
      hours_in_state: hours,
    });
  }
  return out.sort(
    (a, b) => Number(a.state === "landed") - Number(b.state === "landed") || b.fix_prs.length - a.fix_prs.length || a.citation.localeCompare(b.citation)
  );
}

function lastState(reason: string): PairingState | null {
  const m = reason.match(/last state (\S+):/);
  return m && (PAIRING_STATES as readonly string[]).includes(m[1]) ? (m[1] as PairingState) : null;
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export interface PairingAggregates {
  targets: number;
  runs: number;
  landed: number;
  landed_now: number;
  state_counts: Partial<Record<PairingState, number>>;
  /** Refusals by gate: every refused try, the final try of failed runs, the tries before it, and failed runs. */
  refusals_by_gate: { all_tries: Record<string, number>; final_try: Record<string, number>; earlier_tries: Record<string, number>; failed_runs: Record<string, number> };
  fix_prs_per_landing: { landed: number; fix_prs_on_landed: number; mean: number | null; median: number | null; all_linked_per_landed: number | null };
  /** Per state: targets that spent time in it, their median and total hours. */
  hours_in_state: Partial<Record<PairingState, { targets: number; median_hours: number | null; total_hours: number }>>;
  /** Targets waiting longest in their current state (not landed, generating or abandoned). */
  top_stuck: Array<{ citation: string; state: PairingState; reason: string; since: string; hours: number; runs: number; fix_prs: number }>;
}

/** Keys in descending count order, as the prototype's Counter.most_common. */
function counter(): { add(k: string): void; out(): Record<string, number> } {
  const m = new Map<string, number>();
  return {
    add: (k) => m.set(k, (m.get(k) ?? 0) + 1),
    out: () => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1])),
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, 1);
}

const NOT_STUCK = new Set<PairingState>(["landed", "generating", "abandoned"]);

export function pairingAggregates(targets: TargetPairing[], options: { topStuck?: number } = {}): PairingAggregates {
  const all = counter();
  const final = counter();
  const earlier = counter();
  const runGates = counter();
  for (const t of targets) {
    for (const r of t.runs) {
      if (r.outcome === "failure" && r.gate) runGates.add(r.gate);
      const refused = r.tries.filter((x) => x.gate);
      refused.forEach((x, i) => {
        all.add(x.gate as string);
        if (r.outcome === "failure" && i === refused.length - 1) final.add(x.gate as string);
        else earlier.add(x.gate as string);
      });
    }
  }
  const landed = targets.filter((t) => t.landings.length);
  const fixOnLanded = landed.reduce((s, t) => s + t.fix_prs.length, 0);
  const allFixes = targets.reduce((s, t) => s + t.fix_prs.length, 0);
  const inState = new Map<PairingState, number[]>();
  for (const t of targets) {
    for (const [s, h] of Object.entries(t.hours_in_state) as Array<[PairingState, number]>) inState.set(s, [...(inState.get(s) ?? []), h]);
  }
  const hoursInState: PairingAggregates["hours_in_state"] = {};
  for (const s of PAIRING_STATES) {
    const v = inState.get(s);
    if (v) hoursInState[s] = { targets: v.length, median_hours: median(v), total_hours: round(v.reduce((a, b) => a + b, 0), 1) };
  }
  const stateCounts: Partial<Record<PairingState, number>> = {};
  for (const t of targets) if (t.state) stateCounts[t.state] = (stateCounts[t.state] ?? 0) + 1;
  const stuck = targets
    .filter((t) => t.state && !NOT_STUCK.has(t.state))
    .sort((a, b) => (b.hours_in_current_state ?? 0) - (a.hours_in_current_state ?? 0) || a.citation.localeCompare(b.citation))
    .slice(0, options.topStuck ?? 15)
    .map((t) => ({
      citation: t.citation,
      state: t.state as PairingState,
      reason: t.reason ?? "",
      since: t.state_since ?? "",
      hours: t.hours_in_current_state ?? 0,
      runs: t.run_counts.count,
      fix_prs: t.fix_prs.length,
    }));
  return {
    targets: targets.length,
    runs: targets.reduce((s, t) => s + t.run_counts.count, 0),
    landed: landed.length,
    landed_now: targets.filter((t) => t.state === "landed").length,
    state_counts: stateCounts,
    refusals_by_gate: { all_tries: all.out(), final_try: final.out(), earlier_tries: earlier.out(), failed_runs: runGates.out() },
    fix_prs_per_landing: {
      landed: landed.length,
      fix_prs_on_landed: fixOnLanded,
      mean: landed.length ? round(fixOnLanded / landed.length, 2) : null,
      median: median(landed.map((t) => t.fix_prs.length)),
      all_linked_per_landed: landed.length ? round(allFixes / landed.length, 1) : null,
    },
    hours_in_state: hoursInState,
    top_stuck: stuck,
  };
}

/** Targets and aggregates in one call: the JSON /ops/journey and agents read. */
export function buildPairing(events: PairingEvent[], options: PairingOptions & { topStuck?: number }): { targets: TargetPairing[]; aggregates: PairingAggregates } {
  const targets = pairTargets(events, options);
  return { targets, aggregates: pairingAggregates(targets, options) };
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function iso(t: number): string {
  return new Date(t).toISOString();
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

const NY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

/** A time in America/New_York with its zone label, e.g. "2026-11-08 18:39 EST". */
export function nyLabel(t: number | string): string {
  const parts = Object.fromEntries(NY_FORMAT.formatToParts(new Date(typeof t === "string" ? Date.parse(t) : t)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}
