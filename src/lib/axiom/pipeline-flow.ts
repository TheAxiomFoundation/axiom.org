/**
 * Process mining over the pipeline event log (see pipeline-events.ts):
 * the station graph the /ops Line tab draws, the variants, the issue ladder across
 * tries, alerts, and the brief agents read before they dispatch.
 *
 * Nothing here knows the pipeline's shape. Stations are whatever the events
 * name; their order and edges come from the order cases visit them; yields,
 * times and rates are counted from events; targets come from
 * encodings.pipeline_station_targets. Only the display names below are copy.
 */

import { classifyFailure, FAILURE_CLASS_COPY, FAILURE_CLASSES, type FailureBasis, type FailureClassId } from "./failure-class";
import { encodeExitKnown, encodeExitLabel, encodeExitSentence, type EncodeExit } from "./encoding-pipeline";
import type { PipelineEvent } from "./pipeline-events";
import { isReleaseCase } from "./pipeline-ingest";

export const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Display names and one-line meanings. An unknown station shows its id. */
export const STATION_COPY: Record<string, { label: string; description: string }> = {
  corpus_ingest: { label: "Corpus ingest", description: "Source documents enter axiom-corpus: the PR a release is cut from, open to merge." },
  release_publish: { label: "Release publish", description: "axiom-corpus's publish run signs and uploads the release. One visit per run." },
  release_activate: { label: "Release activate", description: "A person activates the release: the site serves it." },
  release_pin: { label: "Release pin", description: "The jurisdiction's rulespec repo pins the release, or a later one, in .axiom/toolchain.toml: the pin lag." },
  target_gate: { label: "Target gate", description: "The encoder's pre-encode gate stops an empty or repealed target before a model call." },
  dispatch: { label: "Dispatch", description: "A targeted re-encode run is queued." },
  approval: { label: "Signing approval", description: "The production-signing environment waits for a person." },
  setup: { label: "Setup", description: "Checkouts, corpus fetch and identity checks before the encoder runs." },
  generate: { label: "Generate", description: "The model writes a candidate. One visit per try." },
  validate: { label: "Validate", description: "Checks judge the candidate. A failed try loops back to Generate." },
  publish: { label: "Sign & open PR", description: "Package, sign, and open the manifest PR." },
  pr_checks: { label: "PR checks", description: "CI on the signed manifest PR." },
  review: { label: "Review", description: "Review and the merge decision." },
  merge: { label: "Merge", description: "Into the default branch, directly or through a side branch's PR." },
  index: { label: "Index", description: "The rulespec_files sync picks the module up." },
  compile: { label: "Compile", description: "axiom-api's nightly compile sweep." },
  tests: { label: "Tests on main", description: "The jurisdiction's validation on the default branch." },
  oracle: { label: "Oracle", description: "The axiom-oracles comparison against a reference model." },
};

/**
 * The pipeline's phases, in line order, and the stations each holds.
 * `parallel` names stations that both follow the station before them and
 * do not wait for each other: a release is activated and pinned
 * independently, so the diagram draws them side by side.
 */
export const STATION_PHASES: Array<{ id: string; label: string; stations: string[]; parallel?: string[] }> = [
  { id: "ingest", label: "Ingest", stations: ["corpus_ingest", "release_publish", "release_activate", "release_pin"], parallel: ["release_activate", "release_pin"] },
  { id: "start", label: "Start", stations: ["dispatch", "approval", "setup", "target_gate"] },
  { id: "encode", label: "Encode", stations: ["generate", "validate", "publish"] },
  { id: "land", label: "Land", stations: ["pr_checks", "review", "merge"] },
  { id: "serve", label: "Serve", stations: ["index", "tests", "compile", "oracle"] },
];

/** Stations where a person acts: the time there is a person's, not a machine's. */
export const PERSON_STATIONS = new Set(["approval", "review", "merge", "release_activate", "release_pin"]);

export function stationPhase(id: string): string | null {
  return STATION_PHASES.find((p) => p.stations.includes(id))?.id ?? null;
}

export function stationLabel(id: string): string {
  return STATION_COPY[id]?.label ?? id.replace(/_/g, " ");
}

export type SinkId = "exit:landed" | "exit:failed" | "exit:cancelled";

export const SINK_LABELS: Record<SinkId, string> = {
  "exit:landed": "Landed",
  "exit:failed": "Failed",
  "exit:cancelled": "Cancelled",
};

export interface StationTarget {
  station: string;
  min_yield: number | null;
  max_p95_hours: number | null;
  max_wip: number | null;
  sla_hours: number | null;
  note?: string | null;
}

export interface RuleCount {
  rule_id: string;
  count: number;
  cases: number;
  example: string | null;
  last_at: string;
  /** The latest error text the rule came with. */
  message: string | null;
  /** The latest cases with the rule, newest first, one per citation. */
  examples: Array<{ citation: string; case_id: string }>;
}

export interface OpenItem {
  case_id: string;
  citation: string;
  since: string;
  /** Why it waits, when an event says (a failing check, a reviewer). */
  reason: string | null;
  ref_url: string | null;
}

/** Cases open at one station for one reason, now. */
export interface WaitingGroup {
  station: string;
  label: string;
  /** The reason id of the wait event, or `wait:<station>` when no event says why. */
  cause: string;
  /** What the wait event says beside its reason id (the oldest case's text). */
  detail: string | null;
  /** The cases failed here and their PR is still open (not counted as WIP). */
  failed?: boolean;
  cases: number;
  /** How many of them are dispatched runs (the rest merged without a run, or inside another run). */
  runs: number;
  over_sla: number;
  /** When the oldest of them reached the station. */
  since: string;
  /** The oldest three. */
  oldest: OpenItem[];
}

export interface StationStats {
  id: string;
  label: string;
  description: string;
  /** Cases in the window that reached the station. */
  cases: number;
  ok: number;
  failed: number;
  cancelled: number;
  /** Of ok: left under a waiver, not a pass. */
  waived: number;
  /** ok / (ok + failed + cancelled) over finished visits; null with none. */
  yield: number | null;
  /** For a station visited once per try: tries and tries that passed. */
  tries: { total: number; ok: number } | null;
  /** Open now, over all time (a case waits at a station until it leaves). */
  wip: number;
  p50_ms: number | null;
  p95_ms: number | null;
  /** Summed duration of the window's finished visits that carry one, and how many do. */
  total_ms: number;
  timed_visits: number;
  /** Per week (Monday, UTC) over the window: finished visits and how many left ok. */
  weekly: Array<{ week: string; finished: number; ok: number }>;
  /** The last 7 days against the 7 before: finished visits and how many left ok. */
  trend: { now: { finished: number; ok: number }; before: { finished: number; ok: number } };
  /** Whether the station's time is measured: enough finished visits carry a real duration. */
  timed: boolean;
  /** The share of finished visits whose duration the times come from. */
  timed_share: number;
  failures: RuleCount[];
  oldest: OpenItem[];
  /** Open items older than the station's SLA. */
  over_sla: number;
  target: StationTarget | null;
  /** Mean position in case paths. */
  position: number;
  /** Column in the flow: the longest path to it over forward edges. */
  rank: number;
  /** Where the window's cases came from and went at this station. */
  flow: StationFlow;
  /** A station of the line with no event yet: why it is not measured. */
  unmeasured?: string | null;
}

/**
 * Where a reason comes from: the system that wrote it. Read from the reason
 * id's prefix, which the event derivation sets (pipeline-events.ts).
 */
export type CauseOrigin =
  | "validator"
  | "encoder_text"
  | "workflow"
  | "ci_check"
  | "review"
  | "merge"
  | "tests_on_main"
  | "index"
  | "compile"
  | "oracle"
  | "corpus_release"
  | "target_gate"
  | "cancel"
  | "unknown";

export const CAUSE_ORIGINS: Record<CauseOrigin, { label: string; source: string }> = {
  validator: { label: "Validator check", source: "axiom-encode's checks on the generated RuleSpec. The rule id is the bracketed name in the encoder error of the run's last try." },
  encoder_text: { label: "Encoder message", source: "An encoder error that names no rule id, grouped by its first words." },
  workflow: { label: "Workflow step", source: "The step of the re-encode GitHub workflow that failed (failed_step on the run)." },
  ci_check: { label: "PR check", source: "The first failing GitHub check on the signed manifest PR." },
  review: { label: "Review", source: "The PR's review state on GitHub: changes requested, closed without a merge, or no reviewer yet." },
  merge: { label: "Merge", source: "How the PR reached the default branch (a side branch waits for its own PR)." },
  tests_on_main: { label: "Tests on main", source: "The RuleSpec repo's validation of the jurisdiction on the default branch after the merge (a waiver counts as a pass)." },
  index: { label: "Index", source: "The rulespec_files mirror: no indexed row matches the merge commit." },
  compile: { label: "Compile sweep", source: "axiom-api's nightly compile of the merged module." },
  oracle: { label: "Oracle report", source: "The axiom-oracles comparison against a reference model." },
  corpus_release: { label: "Corpus release", source: "axiom-corpus's publish runs, corpus.scope_activation_history and the rulespec repos' toolchain pins." },
  target_gate: { label: "Pre-encode gate", source: "The encoder record's status pre_encode_blocked: the gate stopped the target before a model call." },
  cancel: { label: "Cancelled", source: "A person or a newer run cancelled the run, or the PR was closed while its checks failed." },
  unknown: { label: "No reason recorded", source: "The record has no failed step, rule or error text." },
};

const ORIGIN_BY_PREFIX: Record<string, CauseOrigin> = {
  check: "ci_check",
  infra: "workflow",
  publish: "workflow",
  text: "encoder_text",
  review: "review",
  merge: "merge",
  tests: "tests_on_main",
  index: "index",
  compile: "compile",
  oracle: "oracle",
  release: "corpus_release",
  gate: "target_gate",
  cancel: "cancel",
  wait: "unknown",
};

export function causeOrigin(cause: string | null): CauseOrigin {
  if (!cause) return "unknown";
  const prefix = cause.split(":")[0];
  if (ORIGIN_BY_PREFIX[prefix]) return ORIGIN_BY_PREFIX[prefix];
  // Any other "family:check" id is a validator rule (complete-source-unit:tests).
  return cause.includes(":") ? "validator" : "unknown";
}

/** A wait's reason id: the wait event's rule (before its text), or `wait:<station>` when no event says why. */
export function waitCause(reason: string | null, station: string): string {
  return reason ? reason.split(": ")[0] : `wait:${station}`;
}

/**
 * A plain sentence for the reasons the derivation names itself (cancels,
 * waits without a reason, a run with no PR). Every other reason is the id
 * its system reported, shown as is with that system's error text.
 */
export function causeText(cause: string): string | null {
  const [prefix, rest] = [cause.split(":")[0], cause.slice(cause.indexOf(":") + 1)];
  if (prefix === "cancel") {
    return (
      {
        approval: "Cancelled while it waited for the signing approval",
        setup: "Cancelled before the encode job started",
        validate: "Cancelled during the encode",
        pr_checks: "PR closed while its checks failed",
      }[rest] ?? `Cancelled at ${stationLabel(rest)}`
    );
  }
  if (prefix === "wait" || cause === "unknown") return "No reason recorded";
  if (prefix === "release") {
    if (rest === "not-activated") return "Signed, not activated yet";
    if (rest === "not-pinned") return "Not pinned in its rulespec repo yet";
    if (rest.startsWith("publish-")) return `Publish run ${rest === "publish-failure" ? "failed" : rest.slice(8).replace(/_/g, " ")}`;
  }
  if (cause === "gate:pre-encode-blocked") return "Stopped by the pre-encode gate";
  if (cause === "infra:no-pr") return "The run passed but opened no PR";
  if (cause === "publish:artifact-only") return "Dispatched without a PR (open_pr false): ends at its signed artifact";
  if (cause === "check:pending") return "PR checks still run";
  if (cause === "check:failed-pr-open") return "Checks failed; the PR is still open";
  if (cause === "review:no-reviewer-requested") return "Checks pass; no reviewer requested and no approval";
  if (cause === "merge:behind-base") return "Behind the default branch: needs an update, which restarts CI";
  if (cause === "merge:conflict") return "Conflicts with the default branch";
  if (cause === "review:approval-not-on-head") return "Approved on an older commit than the head";
  if (cause === "review:approval-dismissed") return "The approval was dismissed";
  if (cause === "review:approved-not-merged") return "Approved, not merged yet";
  if (cause === "review:draft") return "Still a draft: nobody marked it ready or asked for a review";
  if (cause === "review:changes-requested") return "A reviewer asked for changes";
  if (cause === "review:closed-unmerged") return "PR closed without a merge";
  if (cause === "compile:no-verdict") return "The compile sweep has not reported on the module";
  if (cause === "tests:no-verdict") return "No validation run on main has reported on the module";
  if (cause === "tests:failed-at-merge") return "Failed the first validation run on main after the merge";
  if (cause === "tests:broke-after-merge") return "Passed at the merge, fails on main now";
  if (cause === "tests:fail-on-main") return "Fails validation on main (first run after the merge not read)";
  if (cause === "check:unknown") return "A check failed; the record does not name it";
  if (cause === "publish:in-host-run") return "Published inside another citation's run";
  if (cause === "review:awaiting-reviewer") return "No reviewer has looked at it yet";
  if (cause === "merge:side-branch") return "Merged into a side branch that is not on main yet";
  if (cause === "index:missing") return "Merged, but no indexed module matches the merge commit";
  return null;
}

/**
 * An encoder or check message split into the file it names and what it
 * says: "statutes/7/1.yaml: ci: [rule] Source branch (a) is not tested."
 * becomes { file: "statutes/7/1.yaml", text: "Source branch (a) is not tested." }.
 */
export function splitMessage(message: string): { file: string | null; text: string } {
  const m = message.match(/^(\S+\.ya?ml):\s*(?:[a-z_-]+:\s*)?([\s\S]*)$/);
  const file = m ? m[1] : null;
  const rest = (m ? m[2] : message).replace(/^\[[^\]]+\]\s*/, "").trim();
  return { file, text: rest || message };
}

/** A rule id as words: "complete-source-unit:numeric-recall" → "Complete source unit: numeric recall". */
export function ruleWords(rule: string): string {
  const [family, ...rest] = rule.split(":");
  const words = (x: string) => x.replace(/[-_]+/g, " ").trim();
  const head = words(family);
  const tail = words(rest.join(":"));
  const text = tail ? `${head}: ${tail}` : head;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Why cases ended (or wait) at a station: one reason, how many, and an example. */
export interface StationCause {
  cause: string;
  origin: CauseOrigin;
  cases: number;
  /** The latest case with this reason, and its error text. */
  example_case: string;
  example_citation: string;
  message: string | null;
}

export interface StationFlow {
  /** Window cases whose first visit is here (a PR merged without a dispatch starts at its checks). */
  joined: number;
  /** Went on from here to a later station. */
  moved_on: number;
  failed_here: number;
  cancelled_here: number;
  /** The case's last station, and it cleared every station it reached. */
  landed_here: number;
  /** Window cases still open here. */
  waiting_here: number;
  /** Median time from the station before to this one (a queue before the station). */
  wait_before_ms: number | null;
  /** Why cases failed or were cancelled here, most first. */
  exit_causes: StationCause[];
  /** Why the open items here wait (all of them, not only the window's). */
  wait_causes: StationCause[];
}

const EMPTY_FLOW: StationFlow = { joined: 0, moved_on: 0, failed_here: 0, cancelled_here: 0, landed_here: 0, waiting_here: 0, wait_before_ms: null, exit_causes: [], wait_causes: [] };

export interface FlowEdge {
  from: string;
  to: string;
  cases: number;
  /** Median time from leaving `from` to entering `to`. */
  median_wait_ms: number | null;
  /** Most of its traffic goes back to a station the case visited before. */
  loop: boolean;
}

export interface Variant {
  path: string[];
  end: string;
  cases: number;
  share: number;
  median_lead_ms: number | null;
  /** Median visits of the most-repeated station (tries of the encode loop). */
  median_repeats: number;
  example_case: string;
  example_citation: string;
}

export interface RuleTrajectory {
  rule_id: string;
  /** Try sets the rule was in. */
  occurrences: number;
  cases: number;
  /** Of try sets with a next try: the rule was in the next try too. */
  persisted: number;
  /** ... the rule was gone in the next try. */
  fixed: number;
  /** Rules that first showed up in the try right after this one, most first. */
  followed_by: Array<{ rule_id: string; count: number }>;
  /** Cases that hit the rule and still passed on a later try. */
  recovered: number;
  /** persisted / (persisted + fixed): how often the next try fails it again. */
  stick_rate: number | null;
}

/** How validator rules behave across the tries of the encode loop. */
export interface IssueLadder {
  rules: RuleTrajectory[];
  /** The rules the encoder does not fix: most failures times stick rate. */
  stubborn: RuleTrajectory[];
  cases: number;
}

/** One try number of the loop: how many tries reached it, passed, and what they cost. */
export interface TryStep {
  try_no: number;
  label: string;
  tries: number;
  passed: number;
  cost_usd: number;
  /** Models that ran this try, most used first. */
  models: string[];
}

/**
 * The retry curve of the busiest loop (a judge station that sends cases back
 * to a work station, as validate sends them back to generate): pass rate and
 * cost by try number.
 */
export interface RetryCurve {
  judge: string;
  work: string;
  steps: TryStep[];
}

export interface CoOccurrence {
  a: string;
  b: string;
  count: number;
  lift: number;
}

export interface LoopingCitation {
  citation: string;
  cases: number;
  last_at: string;
  rules: string[];
  /** Failed visits over all its cases (tries that failed, setup failures, ...). */
  failed_visits: number;
  /** Recorded model cost over all its cases; null when no case recorded any. */
  cost_usd: number | null;
}

export type AlertSeverity = "critical" | "warning" | "info";

export interface FlowAlert {
  id: string;
  rule: string;
  severity: AlertSeverity;
  station: string | null;
  title: string;
  detail: string;
  href: string | null;
}

export interface FlowTotals {
  cases: number;
  landed: number;
  failed: number;
  cancelled: number;
  open: number;
  /** Targeted re-encode runs dispatched in the window (not outside merges or dependent modules). */
  dispatched: number;
  /** Of those: merged into the default branch, and landed (cleared every station). */
  dispatched_merged: number;
  dispatched_landed: number;
  /** Dispatch to merge into the default branch, median over merged dispatches. */
  dispatch_to_merge_p50_ms: number | null;
  /** Open now at any station, and how many of those are over their station's SLA. */
  waiting: number;
  waiting_over_sla: number;
}

/** How much of the window's data the page can see: where it is blind. */
export interface DataTrust {
  dispatched: number;
  /** Dispatches with the encoder's per-try record (model, time per try). */
  with_tries: number;
  /** ... with a recorded model cost. */
  with_cost: number;
  /** ... with a full issue list for some try (archived bundle or, later, the encoder). */
  with_issue_list: number;
  /** Stations whose time is not measured. */
  untimed: string[];
  /** Stations timed for under half their visits, with that share. */
  partly_timed: Array<{ station: string; share: number }>;
  /** The first day any try record exists. */
  tries_since: string | null;
  /** ... with a failed try that names its typed checks (rule id and gate per try). */
  with_typed_checks: number;
  /** Finished dispatches where no encode ran: the run ended before the encode step (failed, cancelled, or blocked). */
  no_encode: number;
  /** Dispatches whose encode step ran with no try record: the encoder synced no try, model, or cost. */
  no_try_record: number;
  /** ... of those, the ones whose end is on record (the encoder's live row for the run has an outcome status or a typed rule), and each recorded end with its count. */
  no_try_record_known: number;
  no_try_record_reasons: Array<{ reason: string; count: number }>;
  /** ... and the ones with a last phase alone (a live row that never finished, or one from before the encoder sent its outcome): not a recorded end. */
  no_try_record_phase_only: number;
  no_try_record_phases: Array<{ phase: string; count: number }>;
  /** Merged dispatches by oracle state. unknown: the merge event predates the oracle state. */
  oracle: { merged: number; compared: number; pending: number; none: number; unknown: number };
  /** Corpus releases in the window (the ingest stations' cases). */
  releases: number;
  /** Stations of the line with no event, and why. */
  unmeasured: Array<{ station: string; reason: string }>;
  /** Sources that could not be read this time. */
  source_errors: string[];
}

/** One typed check across the window's failed tries. */
export interface TypedCheckRow {
  id: string;
  gate: string | null;
  /** Failed tries that name the check, and the cases they belong to. */
  tries: number;
  cases: number;
}

/** One validator rule over time: does the encoder stop hitting it? */
export interface RuleTrend {
  rule_id: string;
  /** Per week (Monday, UTC) with enough cases: cases with try records, and cases whose tries hit the rule. */
  weekly: Array<{ week: string; cases: number; hit: number }>;
  /** Citations that hit the rule and were run again 7 days or more later: how many still hit it then. */
  rerun: { citations: number; still: number };
  /** Merged encoder PRs that name the rule. */
  changes: Array<{ at: string; number: number | null; title: string | null; ref_url: string | null }>;
}

/** After the encoder fixes one rule, another appears in the next try more often than usual. */
export interface FollowPair {
  fixed: string;
  next: string;
  count: number;
  /** Of tries where `fixed` was fixed: the next try hit `next` (new). */
  share: number;
  /** share over `next`'s usual rate of appearing new in a try. */
  lift: number;
}

export interface FlowModel {
  window: { from: string; to: string; days: number };
  population: Population;
  /** Window cases of each kind, for the population control. */
  populations: Record<Population, number>;
  jurisdiction: string | null;
  stations: StationStats[];
  /** Where cases wait now, over all time: per station and reason, most cases first. */
  waiting: WaitingGroup[];
  edges: FlowEdge[];
  sinks: Array<{ id: SinkId; label: string; cases: number }>;
  ladder: IssueLadder;
  /** The window's failed encode cases by failure class, most first. */
  failure_classes: FailureClassRow[];
  retry: RetryCurve | null;
  trends: RuleTrend[];
  follows: FollowPair[];
  trust: DataTrust;
  /** The typed checks that failed the most tries in the window, with the gate that ran each. */
  typed_checks: TypedCheckRow[];
  looping: LoopingCitation[];
  alerts: FlowAlert[];
  totals: FlowTotals;
  sources: Record<string, number>;
  events: number;
  generated_at: string;
}

export interface WorkflowSignal {
  label: string;
  grade: string;
  url: string;
  detail?: string | null;
}

/**
 * Which cases the line shows. The log holds three kinds, told apart by id:
 * a dispatched re-encode run (the GitHub run id), a module file a PR merged
 * with no run behind it (`pr:`), and a module the encoder wrote inside
 * another citation's run (`dep:`).
 */
export type Population = "all" | "runs" | "prs" | "modules";

export const POPULATION_LABELS: Record<Population, string> = {
  all: "All cases",
  runs: "Dispatched runs",
  prs: "PRs merged without a run",
  modules: "Modules inside another run",
};

export function casePopulation(caseId: string): Exclude<Population, "all"> {
  if (caseId.startsWith("pr:")) return "prs";
  if (caseId.startsWith("dep:")) return "modules";
  return "runs";
}

export interface FlowOptions {
  /** Which cases the line, sinks and totals count; the discovery views always use every case. */
  population?: Population;
  now: number;
  days: number;
  jurisdiction?: string | null;
  /** The jurisdiction alone, without those under it (us without us-ca). */
  only?: boolean;
  targets?: StationTarget[];
  workflows?: WorkflowSignal[];
  /** Dated items to watch (waiver expiry, ...): alert within 90 days. */
  deadlines?: Array<{ label: string; at: string; href: string | null }>;
  /**
   * Stations of the line to show although no event reached them, with why
   * they are not measured (a gate not live yet, a source not readable).
   */
  unmeasured?: Record<string, string>;
  /** Sources that could not be read this time (a GitHub read for the ingest stations). */
  sourceErrors?: string[];
}

/** A visit: one case at one station, from its first event to the one that ends it. */
interface Visit {
  station: string;
  start: number;
  end: number | null;
  outcome: "ok" | "fail" | "cancel" | "open";
  try_no: number | null;
  rule_id: string | null;
  reason: string | null;
  ref_url: string | null;
  duration_ms: number | null;
  /** Left ok under a waiver (tests on main). */
  waived: boolean;
  actor: string | null;
  cost_usd: number | null;
  message: string | null;
  /** The end is when the visit was read (a nightly sweep), not when it finished. */
  readTime: boolean;
  /** The failure class the encoder recorded on the ending event (attrs.failure_class). */
  recordedClass: { class?: unknown; subclass?: unknown } | null;
  /** Ended in a failure that leaves its PR open (attrs.pr_open): the case still holds a place in the line. */
  prOpen: boolean;
  /** A failed try's typed checks (attrs.check_detail, else attrs.checks), and how many more its record left out. */
  checks: VisitCheck[] | null;
  checksMore: number;
  /** A merge's oracle state (attrs.oracle): a verdict, "pending", or "none". Null on events that predate it. */
  oracle: string | null;
  /** How an encode step with no try record ended (attrs.encode_exit), when the encoder's live row says. */
  encodeExit: EncodeExit | null;
}

/** The recorded end of an encode an event carries, bounded; null when it carries none. */
function eventEncodeExit(attrs: Record<string, unknown> | null | undefined): EncodeExit | null {
  const exit = attrs?.encode_exit;
  if (!exit || typeof exit !== "object") return null;
  const text = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 160) : null);
  const { status, rule, phase } = exit as Record<string, unknown>;
  const read = { status: text(status), rule: text(rule), phase: text(phase) };
  return read.status || read.rule || read.phase ? read : null;
}

/** One typed check that failed a try: its registry id, the gate that ran it, its number of findings. */
export interface VisitCheck {
  id: string;
  gate: string | null;
  n: number | null;
}

/** The typed checks an event carries, bounded; null when it carries none. */
function eventChecks(attrs: Record<string, unknown> | null | undefined): VisitCheck[] | null {
  const detail = attrs?.check_detail;
  const ids = attrs?.checks;
  const checks: VisitCheck[] = [];
  if (Array.isArray(detail)) {
    for (const entry of detail) {
      if (!entry || typeof entry !== "object") continue;
      const { id, gate, n } = entry as Record<string, unknown>;
      if (typeof id !== "string" || !id) continue;
      checks.push({ id, gate: typeof gate === "string" && gate ? gate : null, n: typeof n === "number" && Number.isFinite(n) ? n : null });
    }
  } else if (Array.isArray(ids)) {
    for (const id of ids) if (typeof id === "string" && id) checks.push({ id, gate: null, n: null });
  }
  return checks.length ? checks.slice(0, 20) : null;
}

interface Case {
  id: string;
  citation: string;
  jurisdiction: string | null;
  source: string;
  start: number;
  visits: Visit[];
  /** Rule ids per try, from validate fails and issues. */
  tryRules: Map<number, Set<string>>;
  passedTry: number | null;
  /** Archived or recorded issue events: a full issue list exists for some try. */
  issueCount: number;
  end: SinkId | null;
  failedAt: string | null;
}

const TERMINAL = new Set(["leave", "fail", "cancel"]);
/** A station counts as timed with this many real durations. */
const TIMED_MIN = 10;
/** ... or this many, at a corpus release station: a few releases a week, not hundreds of runs. */
const TIMED_MIN_RELEASE = 3;

/** Whether a jurisdiction is the scope or under it (us covers us-ca), or with `only` the scope itself. */
export function inJurisdiction(value: string | null, scope: string | null | undefined, only = false): boolean {
  if (!scope) return true;
  if (!value) return false;
  return value === scope || (!only && value.startsWith(`${scope}-`));
}

/** Group events into cases, and each case's events into station visits. */
function buildCases(events: PipelineEvent[]): Map<string, Case> {
  const byCase = new Map<string, PipelineEvent[]>();
  for (const e of events) {
    const list = byCase.get(e.case_id);
    if (list) list.push(e);
    else byCase.set(e.case_id, [e]);
  }
  const cases = new Map<string, Case>();
  for (const [id, list] of byCase) {
    // Stable sort: events at the same instant keep their pipeline order.
    const sorted = list.map((e, i) => ({ e, i, t: Date.parse(e.at) })).sort((a, b) => a.t - b.t || a.i - b.i);
    const visits: Visit[] = [];
    const open = new Map<string, Visit>();
    const unentered = new Map<string, Visit>();
    const tryRules = new Map<number, Set<string>>();
    let passedTry: number | null = null;
    let source = "pipeline_attempts";
    let issueCount = 0;
    for (const { e, t } of sorted) {
      if (e.source !== "pipeline_attempts") source = e.source;
      if (e.kind === "issue") {
        issueCount++;
        if (e.rule_id) addRule(tryRules, e.try_no ?? 0, e.rule_id);
        continue;
      }
      let visit = open.get(e.station);
      if (e.kind === "enter" && !visit) {
        // An enter that comes after the visit already ended (a check that ran
        // before the step it follows) belongs to that visit.
        const early = unentered.get(e.station);
        if (early) {
          unentered.delete(e.station);
          continue;
        }
      }
      if (!visit) {
        visit = { station: e.station, start: t, end: null, outcome: "open", try_no: e.try_no, rule_id: null, reason: null, ref_url: e.ref_url, duration_ms: null, waived: false, actor: e.actor, cost_usd: null, message: null, readTime: false, recordedClass: null, prOpen: false, checks: null, checksMore: 0, oracle: null, encodeExit: null };
        visits.push(visit);
        open.set(e.station, visit);
        if (e.kind !== "enter" && TERMINAL.has(e.kind)) unentered.set(e.station, visit);
      } else if (e.kind === "enter") {
        unentered.delete(e.station);
      }
      if (e.kind === "wait") {
        visit.reason = e.rule_id ?? e.outcome;
        visit.ref_url = e.ref_url ?? visit.ref_url;
        if (e.message) visit.reason = `${visit.reason}: ${e.message}`;
      }
      if (TERMINAL.has(e.kind)) {
        visit.end = t;
        visit.outcome = e.kind === "leave" ? "ok" : e.kind === "fail" ? "fail" : "cancel";
        visit.rule_id = e.rule_id;
        visit.waived = e.outcome === "waived";
        visit.actor = e.actor ?? visit.actor;
        visit.cost_usd = e.cost_usd != null ? Number(e.cost_usd) : null;
        visit.message = e.message;
        visit.readTime = Boolean(e.attrs?.read_time);
        const recorded = e.attrs?.failure_class;
        visit.recordedClass = recorded && typeof recorded === "object" ? (recorded as Visit["recordedClass"]) : null;
        visit.prOpen = e.attrs?.pr_open === true;
        visit.checks = eventChecks(e.attrs);
        visit.checksMore = typeof e.attrs?.checks_more === "number" ? e.attrs.checks_more : 0;
        visit.oracle = e.station === "merge" && typeof e.attrs?.oracle === "string" ? e.attrs.oracle : null;
        visit.encodeExit = e.station === "generate" ? eventEncodeExit(e.attrs) : null;
        visit.duration_ms = e.duration_ms ?? (e.attrs?.untimed ? null : t - visit.start);
        visit.ref_url = e.ref_url ?? visit.ref_url;
        open.delete(e.station);
        if (e.kind === "fail" && e.rule_id && e.try_no != null && e.station === "validate") addRule(tryRules, e.try_no, e.rule_id);
        if (e.kind === "fail" && e.rule_id && e.try_no == null && e.station === "validate") addRule(tryRules, 0, e.rule_id);
        if (e.kind === "leave" && e.station === "validate" && e.try_no != null) passedTry = e.try_no;
      }
    }
    // Issues an archive could not place on a try (try 0) belong to the last try.
    const lastTry = Math.max(0, ...[...tryRules.keys()], ...visits.filter((v) => v.try_no != null).map((v) => v.try_no!));
    const unplaced = tryRules.get(0);
    if (unplaced && lastTry > 0) {
      for (const r of unplaced) addRule(tryRules, lastTry, r);
      tryRules.delete(0);
    }
    const first = sorted[0]?.e;
    if (!first) continue;
    const c: Case = {
      id,
      citation: first.citation,
      jurisdiction: first.jurisdiction,
      source,
      start: sorted[0].t,
      visits,
      tryRules,
      passedTry,
      issueCount,
      end: null,
      failedAt: null,
    };
    classifyEnd(c);
    cases.set(id, c);
  }
  return cases;
}

function addRule(map: Map<number, Set<string>>, tryNo: number, rule: string) {
  const set = map.get(tryNo);
  if (set) set.add(rule);
  else map.set(tryNo, new Set([rule]));
}

/** A case ends failed at the first station whose fail no later visit there recovered. */
function classifyEnd(c: Case) {
  const lastOutcome = new Map<string, Visit>();
  for (const v of c.visits) lastOutcome.set(v.station, v);
  for (const v of c.visits) {
    if (v.outcome === "fail" && lastOutcome.get(v.station) === v) {
      c.end = "exit:failed";
      c.failedAt = v.station;
      return;
    }
  }
  if (c.visits.some((v) => v.outcome === "cancel")) {
    c.end = "exit:cancelled";
    c.failedAt = c.visits.find((v) => v.outcome === "cancel")!.station;
    return;
  }
  if (c.visits.some((v) => v.outcome === "open")) return;
  if (c.visits.length) c.end = "exit:landed";
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** A station of the line no event reached: shown, with why it is not measured. */
function placeholderStation(id: string, reason: string, rank: number, target: StationTarget | null): StationStats {
  return {
    id,
    label: stationLabel(id),
    description: STATION_COPY[id]?.description ?? "",
    cases: 0,
    ok: 0,
    failed: 0,
    cancelled: 0,
    waived: 0,
    yield: null,
    tries: null,
    wip: 0,
    p50_ms: null,
    p95_ms: null,
    total_ms: 0,
    timed_visits: 0,
    weekly: [],
    trend: { now: { finished: 0, ok: 0 }, before: { finished: 0, ok: 0 } },
    timed: false,
    timed_share: 0,
    failures: [],
    oldest: [],
    over_sla: 0,
    target,
    position: Number.MAX_SAFE_INTEGER,
    rank,
    flow: EMPTY_FLOW,
    unmeasured: reason,
  };
}

/** Mine the event log into everything the /ops Line tab and the agent brief show. */
export function mineFlow(events: PipelineEvent[], options: FlowOptions): FlowModel {
  const { now, days } = options;
  const from = now - days * DAY_MS;
  const scoped = events.filter((e) => e.kind !== "change" && inJurisdiction(e.jurisdiction, options.jurisdiction, options.only));
  // Encoder changes are not cases; they mark when a rule was worked on.
  const changes = events.filter((e) => e.kind === "change");
  const all = buildCases(scoped);
  const population = options.population ?? "all";
  const everyFactory = [...all.values()].filter((c) => c.source === "pipeline_attempts" || c.source === "failure_bundle" || c.source === "corpus_release");
  const populations: Record<Population, number> = { all: 0, runs: 0, prs: 0, modules: 0 };
  for (const c of everyFactory) {
    if (c.start < from || c.start > now || isReleaseCase(c.id)) continue;
    populations.all++;
    populations[casePopulation(c.id)]++;
  }
  // Corpus releases feed every path: the ingest stations count them whatever the population.
  const factory = population === "all" ? everyFactory : everyFactory.filter((c) => isReleaseCase(c.id) || casePopulation(c.id) === population);
  const windowCases = factory.filter((c) => c.start >= from && c.start <= now);
  // Encodes: what the totals, sinks and data trust count.
  const encodeCases = windowCases.filter((c) => !isReleaseCase(c.id));
  const targets = new Map((options.targets ?? []).map((t) => [t.station, t]));

  // Stations: every station any case visited, with counts over the window.
  const stationIds = new Set<string>();
  const releaseStations = new Set<string>();
  const encodeStations = new Set<string>();
  for (const c of factory) {
    for (const v of c.visits) {
      stationIds.add(v.station);
      (isReleaseCase(c.id) ? releaseStations : encodeStations).add(v.station);
    }
  }
  const stations: StationStats[] = [];
  const waiting: WaitingGroup[] = [];
  for (const id of stationIds) {
    const visitsIn: Array<{ c: Case; v: Visit }> = [];
    for (const c of windowCases) for (const v of c.visits) if (v.station === id) visitsIn.push({ c, v });
    const caseIds = new Set(visitsIn.map((x) => x.c.id));
    // A case's outcome at a station is its last visit there.
    const lastByCase = new Map<string, Visit>();
    for (const { c, v } of visitsIn) lastByCase.set(c.id, v);
    let ok = 0;
    let failed = 0;
    let cancelled = 0;
    let waived = 0;
    for (const v of lastByCase.values()) {
      if (v.waived) waived++;
      if (v.outcome === "ok") ok++;
      else if (v.outcome === "fail") failed++;
      else if (v.outcome === "cancel") cancelled++;
    }
    const perTry = visitsIn.filter((x) => x.v.try_no != null && x.v.outcome !== "open");
    const repeated = visitsIn.length > caseIds.size;
    const finishedVisits = visitsIn.filter((x) => x.v.outcome !== "open");
    const durations = finishedVisits.map((x) => x.v.duration_ms).filter((d): d is number => d != null && d > 0);
    // A station whose visits are points (dispatch) or carry only a read time
    // (a check rollup) has no time to show.
    const timed = durations.length >= (releaseStations.has(id) && !encodeStations.has(id) ? TIMED_MIN_RELEASE : TIMED_MIN);
    const timedShare = finishedVisits.length ? durations.length / finishedVisits.length : 0;
    const trend = { now: { finished: 0, ok: 0 }, before: { finished: 0, ok: 0 } };
    const weeks = new Map<string, { finished: number; ok: number }>();
    for (const { v } of finishedVisits) {
      if (v.end == null || v.readTime) continue;
      const key = weekOf(v.end);
      const w = weeks.get(key) ?? { finished: 0, ok: 0 };
      w.finished++;
      if (v.outcome === "ok") w.ok++;
      weeks.set(key, w);
    }
    for (const c of factory) {
      for (const v of c.visits) {
        if (v.station !== id || v.end == null || v.outcome === "open" || v.readTime) continue;
        const bucket = v.end > now - WEEK_MS ? trend.now : v.end > now - 2 * WEEK_MS ? trend.before : null;
        if (!bucket) continue;
        bucket.finished++;
        if (v.outcome === "ok") bucket.ok++;
      }
    }
    const failures = ruleCounts(visitsIn.filter((x) => x.v.outcome === "fail" || x.v.reason).map((x) => ({ c: x.c, v: x.v })));
    // WIP over all time: cases open at the station now.
    const openItems: OpenItem[] = [];
    for (const c of factory) {
      for (const v of c.visits) {
        if (v.station === id && v.outcome === "open") {
          openItems.push({ case_id: c.id, citation: c.citation, since: new Date(v.start).toISOString(), reason: v.reason, ref_url: v.ref_url });
        }
      }
    }
    openItems.sort((a, b) => a.since.localeCompare(b.since));
    const target = targets.get(id) ?? null;
    const slaMs = target?.sla_hours != null ? target.sla_hours * 3_600_000 : null;
    const overSla = slaMs == null ? 0 : openItems.filter((o) => now - Date.parse(o.since) > slaMs).length;
    // The same open cases by why they wait (oldest first within a reason).
    const byCause = new Map<string, OpenItem[]>();
    for (const item of openItems) {
      const cause = waitCause(item.reason, id);
      byCause.set(cause, [...(byCause.get(cause) ?? []), item]);
    }
    // Failed, and the PR is still open: nothing moves until someone fixes or
    // closes it. Not WIP (the visit ended), but it is where the case sits.
    const blocked: OpenItem[] = [];
    const blockedRules = new Map<string, number>();
    for (const c of factory) {
      const v = c.visits[c.visits.length - 1];
      if (v?.station !== id || v.outcome !== "fail" || !v.prOpen) continue;
      blocked.push({ case_id: c.id, citation: c.citation, since: new Date(v.start).toISOString(), reason: v.reason, ref_url: v.ref_url });
      const rule = v.rule_id ?? "check:unknown";
      blockedRules.set(rule, (blockedRules.get(rule) ?? 0) + 1);
    }
    if (blocked.length) {
      blocked.sort((a, b) => a.since.localeCompare(b.since));
      const top = [...blockedRules].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
      waiting.push({
        station: id,
        label: stationLabel(id),
        cause: `${id === "pr_checks" ? "check" : id}:failed-pr-open`,
        detail: top.map(([rule, count]) => `${count} × ${rule.replace(/^check:/, "")}`).join("; "),
        failed: true,
        cases: blocked.length,
        runs: blocked.filter((o) => !isReleaseCase(o.case_id) && casePopulation(o.case_id) === "runs").length,
        over_sla: slaMs == null ? 0 : blocked.filter((o) => now - Date.parse(o.since) > slaMs).length,
        since: blocked[0].since,
        oldest: blocked.slice(0, 3),
      });
    }
    for (const [cause, items] of byCause) {
      const text = items[0].reason?.startsWith(`${cause}: `) ? items[0].reason.slice(cause.length + 2) : null;
      waiting.push({
        station: id,
        label: stationLabel(id),
        cause,
        detail: text,
        cases: items.length,
        runs: items.filter((o) => !isReleaseCase(o.case_id) && casePopulation(o.case_id) === "runs").length,
        over_sla: slaMs == null ? 0 : items.filter((o) => now - Date.parse(o.since) > slaMs).length,
        since: items[0].since,
        oldest: items.slice(0, 3),
      });
    }
    const positions: number[] = [];
    for (const c of windowCases.length ? windowCases : factory) {
      const i = c.visits.findIndex((v) => v.station === id);
      if (i >= 0) positions.push(i / Math.max(1, c.visits.length - 1) + i);
    }
    const finished = ok + failed + cancelled;
    stations.push({
      id,
      label: stationLabel(id),
      description: STATION_COPY[id]?.description ?? "",
      cases: caseIds.size,
      ok,
      failed,
      cancelled,
      waived,
      yield: finished ? ok / finished : null,
      tries: repeated || perTry.length > caseIds.size ? { total: perTry.length, ok: perTry.filter((x) => x.v.outcome === "ok").length } : null,
      wip: openItems.length,
      p50_ms: timed ? quantile(durations, 0.5) : null,
      p95_ms: timed ? quantile(durations, 0.95) : null,
      total_ms: durations.reduce((sum, d) => sum + d, 0),
      timed_visits: durations.length,
      weekly: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, ...w })),
      trend,
      timed,
      timed_share: timedShare,
      failures,
      oldest: openItems.slice(0, 8),
      over_sla: overSla,
      target,
      position: positions.length ? positions.reduce((s, p) => s + p, 0) / positions.length : Number.MAX_SAFE_INTEGER,
      rank: 0,
      flow: EMPTY_FLOW,
    });
  }

  // Edges: directly-follows between consecutive visits, and each case's end.
  const edgeMap = new Map<string, { from: string; to: string; cases: number; waits: number[]; back: number }>();
  const bump = (fromId: string, to: string, wait: number | null, back: boolean) => {
    const key = `${fromId}→${to}`;
    const edge = edgeMap.get(key) ?? { from: fromId, to, cases: 0, waits: [], back: 0 };
    edge.cases++;
    if (wait != null && wait >= 0) edge.waits.push(wait);
    if (back) edge.back++;
    edgeMap.set(key, edge);
  };
  const sinkCounts: Record<SinkId, number> = { "exit:landed": 0, "exit:failed": 0, "exit:cancelled": 0 };
  for (const c of windowCases) {
    const seen = new Set<string>();
    for (let i = 0; i < c.visits.length; i++) {
      const v = c.visits[i];
      seen.add(v.station);
      const next = c.visits[i + 1];
      if (next) bump(v.station, next.station, v.end != null ? next.start - v.end : null, seen.has(next.station));
    }
    // A release's line ends where encodes start: no sink.
    if (c.end && !isReleaseCase(c.id)) {
      sinkCounts[c.end]++;
      const exitFrom = c.end === "exit:landed" ? c.visits.at(-1)!.station : c.failedAt!;
      bump(exitFrom, c.end, null, false);
    }
  }
  const edges: FlowEdge[] = [...edgeMap.values()].map((e) => ({
    from: e.from,
    to: e.to,
    cases: e.cases,
    median_wait_ms: quantile(e.waits, 0.5),
    loop: e.back > e.cases / 2,
  }));
  edges.sort((a, b) => b.cases - a.cases);
  // Releases and encodes share no case: rank each line on its own, the
  // corpus line first.
  const ingest = stations.filter((s) => releaseStations.has(s.id) && !encodeStations.has(s.id));
  const ingestIds = new Set(ingest.map((s) => s.id));
  const ingestRanks = rankStations(ingest, edges);
  const offset = ingest.length ? Math.max(...ingestRanks.values()) + 1 : 0;
  const encodeRanks = rankStations(
    stations.filter((s) => !ingestIds.has(s.id)),
    edges
  );
  for (const s of stations) s.rank = ingestIds.has(s.id) ? (ingestRanks.get(s.id) ?? 0) : (encodeRanks.get(s.id) ?? 0) + offset;
  // Stations of the line no event reached, shown with why they are not measured.
  for (const [id, reason] of Object.entries(options.unmeasured ?? {})) {
    if (stationIds.has(id) || !reason) continue;
    const at = LINE_STATIONS.indexOf(id);
    const before = stations.filter((s) => {
      const i = LINE_STATIONS.indexOf(s.id);
      return i >= 0 && i < at;
    });
    stations.push(placeholderStation(id, reason, before.length ? Math.max(...before.map((s) => s.rank)) : 0, targets.get(id) ?? null));
  }
  stations.sort((a, b) => a.rank - b.rank || a.position - b.position);
  const flows = stationFlows(windowCases, factory, stations, edges);
  for (const s of stations) s.flow = flows.get(s.id) ?? EMPTY_FLOW;

  const ladderCases = [...all.values()].filter((c) => c.start <= now && (c.source === "local_ab" || c.start >= from));
  const ladder = issueLadder(ladderCases);
  const failure_classes = failureClassRows(encodeCases);
  const follows = followPairs(ladderCases);
  const trends = ruleTrends(everyFactory, changes, ladder, now, from);
  const looping = loopingCitations(encodeCases);
  const retry = retryCurve(encodeCases, edges);

  const landed = encodeCases.filter((c) => c.end === "exit:landed");
  const dispatches = encodeCases.filter((c) => c.visits[0]?.station === "dispatch");
  const mergedAt = (c: Case) => c.visits.find((v) => v.station === "merge" && v.outcome === "ok")?.end ?? null;
  const merged = dispatches.filter((c) => mergedAt(c) != null);
  const totals: FlowTotals = {
    cases: encodeCases.length,
    landed: landed.length,
    failed: sinkCounts["exit:failed"],
    cancelled: sinkCounts["exit:cancelled"],
    open: encodeCases.filter((c) => c.end == null).length,
    dispatched: dispatches.length,
    dispatched_merged: merged.length,
    dispatched_landed: dispatches.filter((c) => c.end === "exit:landed").length,
    dispatch_to_merge_p50_ms: quantile(merged.map((c) => mergedAt(c)! - c.start), 0.5),
    waiting: stations.reduce((s, x) => s + x.wip, 0),
    waiting_over_sla: stations.reduce((s, x) => s + x.over_sla, 0),
  };
  const encodeRecords = dispatches.map((c) => encodeState(c.visits));
  const encodeStates = encodeRecords.map((record) => record.state);
  // A recorded end needs an outcome status or a typed rule; a last phase alone is counted apart.
  const noTryReasons = new Map<string, number>();
  const noTryPhases = new Map<string, number>();
  for (const record of encodeRecords) {
    if (record.state !== "no_try_record" || !record.exit) continue;
    const [counts, key] = encodeExitKnown(record.exit) ? [noTryReasons, encodeExitLabel(record.exit)] : [noTryPhases, record.exit.phase!];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const counted = <K extends string>(counts: Map<string, number>, name: K) =>
    [...counts.entries()]
      .map(([value, count]) => ({ [name]: value, count }) as Record<K, string> & { count: number })
      .sort((a, b) => b.count - a.count || a[name].localeCompare(b[name]));
  const total = (counts: Map<string, number>) => [...counts.values()].reduce((sum, count) => sum + count, 0);
  const oracleStates = merged.map((c) => caseOracle(c.visits)?.state ?? "unknown");
  const tryStart = Math.min(...factory.flatMap((c) => c.visits.filter((v) => v.try_no != null && v.actor).map((v) => v.start)));
  const trust: DataTrust = {
    dispatched: dispatches.length,
    with_tries: dispatches.filter((c) => c.visits.some((v) => v.try_no != null && v.actor)).length,
    with_cost: dispatches.filter((c) => c.visits.some((v) => v.cost_usd != null)).length,
    with_issue_list: dispatches.filter((c) => c.issueCount > 0).length,
    untimed: stations.filter((x) => !x.timed && !x.unmeasured && x.id !== "dispatch").map((x) => x.id),
    partly_timed: stations.filter((x) => x.timed && x.timed_share < 0.5).map((x) => ({ station: x.id, share: x.timed_share })),
    tries_since: Number.isFinite(tryStart) ? new Date(tryStart).toISOString() : null,
    with_typed_checks: dispatches.filter((c) => c.visits.some((v) => v.checks)).length,
    no_encode: encodeStates.filter((state) => state === "no_encode").length,
    no_try_record: encodeStates.filter((state) => state === "no_try_record").length,
    no_try_record_known: total(noTryReasons),
    no_try_record_reasons: counted(noTryReasons, "reason"),
    no_try_record_phase_only: total(noTryPhases),
    no_try_record_phases: counted(noTryPhases, "phase"),
    oracle: {
      merged: merged.length,
      compared: oracleStates.filter((state) => state === "compared").length,
      pending: oracleStates.filter((state) => state === "pending").length,
      none: oracleStates.filter((state) => state === "none").length,
      unknown: oracleStates.filter((state) => state === "unknown").length,
    },
    releases: windowCases.length - encodeCases.length,
    unmeasured: stations.filter((x) => x.unmeasured).map((x) => ({ station: x.id, reason: x.unmeasured! })),
    source_errors: options.sourceErrors ?? [],
  };

  const sources: Record<string, number> = {};
  for (const e of scoped) sources[e.source] = (sources[e.source] ?? 0) + 1;

  const model: FlowModel = {
    window: { from: new Date(from).toISOString(), to: new Date(now).toISOString(), days },
    population,
    populations,
    jurisdiction: options.jurisdiction ?? null,
    stations,
    waiting: waiting.sort((a, b) => b.cases - a.cases || a.since.localeCompare(b.since)),
    edges,
    sinks: (Object.keys(sinkCounts) as SinkId[]).filter((id) => sinkCounts[id] > 0).map((id) => ({ id, label: SINK_LABELS[id], cases: sinkCounts[id] })),
    ladder,
    failure_classes,
    retry,
    trends,
    follows,
    trust,
    typed_checks: typedCheckRows(encodeCases),
    looping,
    alerts: [],
    totals,
    sources,
    events: scoped.length,
    generated_at: new Date(now).toISOString(),
  };
  model.alerts = flowAlerts(model, factory, options);
  return model;
}

/**
 * Columns for the flow: a depth-first walk from the busiest entry station
 * marks back edges (loops), and each station's rank is its longest path
 * over the forward edges. Edges the walk finds going back are loops.
 */
export function rankStations(stations: Array<{ id: string; cases: number }>, edges: FlowEdge[]): Map<string, number> {
  const ids = new Set(stations.map((s) => s.id));
  const out = new Map<string, FlowEdge[]>();
  const indegree = new Map<string, number>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + e.cases);
  }
  for (const list of out.values()) list.sort((a, b) => b.cases - a.cases);
  const inflow = (id: string) => indegree.get(id) ?? 0;
  const outflow = (id: string) => (out.get(id) ?? []).reduce((s, e) => s + e.cases, 0);
  // Entry stations first: most net outflow.
  const roots = [...ids].sort((a, b) => outflow(b) - inflow(b) - (outflow(a) - inflow(a)));
  const state = new Map<string, 1 | 2>();
  const order: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to);
      if (s === 1) e.loop = true;
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
    order.push(id);
  };
  for (const r of roots) if (!state.get(r)) visit(r);
  const rank = new Map<string, number>();
  for (const id of order.reverse()) {
    if (!rank.has(id)) rank.set(id, 0);
    for (const e of out.get(id) ?? []) {
      if (e.loop) continue;
      rank.set(e.to, Math.max(rank.get(e.to) ?? 0, rank.get(id)! + 1));
    }
  }
  // A station no case reached from another one in the window (Oracle, with
  // no comparison yet) has no edge to place it: put it after every station
  // the line runs before it, so it keeps its place at the end.
  const lineIndex = new Map(LINE_STATIONS.map((id, i) => [id, i]));
  for (const id of ids) {
    const at = lineIndex.get(id);
    if (at == null || at === 0 || inflow(id) > 0) continue;
    let after = -1;
    for (const other of ids) {
      const i = lineIndex.get(other);
      if (other !== id && i != null && i < at) after = Math.max(after, rank.get(other) ?? 0);
    }
    if (after >= 0) rank.set(id, Math.max(rank.get(id) ?? 0, after + 1));
  }
  for (const e of edges) if (e.from === e.to) e.loop = true;
  return rank;
}

/** A cancelled visit names no rule; its station says what was cancelled. */
function cancelCause(station: string): string {
  return `cancel:${station}`;
}

function causeList(items: Array<{ cause: string; c: Case; v: Visit }>, limit = 6): StationCause[] {
  const map = new Map<string, StationCause & { at: number; ids: Set<string> }>();
  for (const { cause, c, v } of items) {
    const at = v.end ?? v.start;
    const entry = map.get(cause) ?? { cause, origin: causeOrigin(cause), cases: 0, example_case: c.id, example_citation: c.citation, message: null, at: -Infinity, ids: new Set<string>() };
    entry.ids.add(c.id);
    if (at > entry.at) {
      entry.at = at;
      entry.example_case = c.id;
      entry.example_citation = c.citation;
      entry.message = v.message ?? (v.reason && v.reason !== cause ? v.reason : entry.message);
    }
    map.set(cause, entry);
  }
  return [...map.values()]
    .map(({ at: _at, ids, ...rest }) => ({ ...rest, cases: ids.size }))
    .sort((a, b) => b.cases - a.cases || a.cause.localeCompare(b.cause))
    .slice(0, limit);
}

export interface FailureClassRow {
  id: FailureClassId;
  label: string;
  owner: string;
  cases: number;
  /** How many cases got the class from each basis. */
  basis: Record<FailureBasis, number>;
  /** The stage and reason of the class's cases, most first. */
  causes: Array<{ station: string; cause: string; cases: number }>;
}

const CLASS_CAUSES = 3;

/** The failed cases by failure class, from the visit each one failed at. */
export function failureClassRows(cases: Case[]): FailureClassRow[] {
  const rows = new Map<FailureClassId, FailureClassRow & { byCause: Map<string, { station: string; cause: string; cases: number }> }>();
  for (const c of cases) {
    if (c.end !== "exit:failed" || !c.failedAt) continue;
    const v = [...c.visits].reverse().find((x) => x.station === c.failedAt && x.outcome === "fail");
    if (!v) continue;
    const fc = classifyFailure({ station: v.station, rule_id: v.rule_id, message: v.message, recorded: v.recordedClass });
    let row = rows.get(fc.id);
    if (!row) {
      row = { id: fc.id, ...FAILURE_CLASS_COPY[fc.id], cases: 0, basis: { encoder: 0, rule: 0, text: 0 }, causes: [], byCause: new Map() };
      rows.set(fc.id, row);
    }
    row.cases++;
    if (fc.basis) row.basis[fc.basis]++;
    const cause = v.rule_id ?? "unknown";
    const key = `${v.station}\u0000${cause}`;
    const entry = row.byCause.get(key) ?? { station: v.station, cause, cases: 0 };
    entry.cases++;
    row.byCause.set(key, entry);
  }
  const order = new Map(FAILURE_CLASSES.map((id, i) => [id, i]));
  return [...rows.values()]
    .map(({ byCause, ...row }) => ({
      ...row,
      causes: [...byCause.values()].sort((a, b) => b.cases - a.cases || a.cause.localeCompare(b.cause)).slice(0, CLASS_CAUSES),
    }))
    // Not classified last; the rest by size.
    .sort((a, b) => Number(a.id === "unknown") - Number(b.id === "unknown") || b.cases - a.cases || order.get(a.id)! - order.get(b.id)!);
}

/**
 * Each station's share of the window's flow: cases that joined there, went
 * on, ended there (failed, cancelled, landed) or wait there, and why. A case
 * ends at one station only, so the stations' exits add up to the sinks.
 */
export function stationFlows(windowCases: Case[], allCases: Case[], stations: StationStats[], edges: FlowEdge[]): Map<string, StationFlow> {
  const rank = new Map(stations.map((s) => [s.id, s.rank]));
  const flows = new Map<string, StationFlow>();
  const exits = new Map<string, Array<{ cause: string; c: Case; v: Visit }>>();
  const waits = new Map<string, Array<{ cause: string; c: Case; v: Visit }>>();
  for (const s of stations) flows.set(s.id, { ...EMPTY_FLOW, exit_causes: [], wait_causes: [] });
  const push = (map: typeof exits, id: string, item: { cause: string; c: Case; v: Visit }) => {
    const list = map.get(id);
    if (list) list.push(item);
    else map.set(id, [item]);
  };
  for (const c of windowCases) {
    const first = c.visits[0];
    if (first) flows.get(first.station)!.joined++;
    const seen = new Set<string>();
    for (let i = 0; i < c.visits.length; i++) {
      const v = c.visits[i];
      if (seen.has(v.station)) continue;
      seen.add(v.station);
      const r = rank.get(v.station) ?? 0;
      if (c.visits.slice(i + 1).some((w) => (rank.get(w.station) ?? 0) > r)) flows.get(v.station)!.moved_on++;
    }
    if (c.end === "exit:landed") flows.get(c.visits.at(-1)!.station)!.landed_here++;
    if ((c.end === "exit:failed" || c.end === "exit:cancelled") && c.failedAt) {
      const flow = flows.get(c.failedAt)!;
      const lastThere = [...c.visits].reverse().find((v) => v.station === c.failedAt)!;
      if (c.end === "exit:failed") {
        flow.failed_here++;
        push(exits, c.failedAt, { cause: lastThere.rule_id ?? "unknown", c, v: lastThere });
      } else {
        flow.cancelled_here++;
        push(exits, c.failedAt, { cause: lastThere.rule_id ?? cancelCause(c.failedAt), c, v: lastThere });
      }
    }
    if (c.end == null) for (const v of c.visits) if (v.outcome === "open") flows.get(v.station)!.waiting_here++;
  }
  // Open items over all time, like a station's WIP.
  for (const c of allCases) {
    for (const v of c.visits) {
      if (v.outcome !== "open") continue;
      const cause = waitCause(v.reason, v.station);
      push(waits, v.station, { cause, c, v });
    }
  }
  for (const [id, flow] of flows) {
    flow.exit_causes = causeList(exits.get(id) ?? []);
    flow.wait_causes = causeList(waits.get(id) ?? [], 4);
    // The queue before the station: the median wait on its busiest forward edge in.
    const into = edges.filter((e) => e.to === id && !e.loop && e.from !== id && e.median_wait_ms != null).sort((a, b) => b.cases - a.cases)[0];
    flow.wait_before_ms = into?.median_wait_ms ?? null;
  }
  return flows;
}

function ruleCounts(items: Array<{ c: Case; v: Visit }>): RuleCount[] {
  const map = new Map<string, RuleCount & { caseSet: Set<string>; seen: Array<{ at: number; citation: string; case_id: string }> }>();
  for (const { c, v } of items) {
    const rule = v.rule_id ?? (v.reason ? v.reason.split(":")[0] : "unknown");
    const entry = map.get(rule) ?? { rule_id: rule, count: 0, cases: 0, example: null, last_at: "", message: null, examples: [], caseSet: new Set<string>(), seen: [] };
    entry.count++;
    entry.caseSet.add(c.id);
    const t = v.end ?? v.start;
    const at = new Date(t).toISOString();
    entry.seen.push({ at: t, citation: c.citation, case_id: c.id });
    if (at > entry.last_at) {
      entry.last_at = at;
      entry.example = c.citation;
      entry.message = v.message ?? (v.reason && v.reason !== rule ? v.reason : entry.message);
    }
    map.set(rule, entry);
  }
  return [...map.values()]
    .map(({ caseSet, seen, ...rest }) => {
      const examples: RuleCount["examples"] = [];
      for (const x of seen.sort((a, b) => b.at - a.at)) {
        if (examples.length >= 3) break;
        if (!examples.some((e) => e.citation === x.citation)) examples.push({ citation: x.citation, case_id: x.case_id });
      }
      return { ...rest, cases: caseSet.size, examples };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

const STUBBORN_MIN = 10;

/**
 * Rules across tries: for cases whose tries carry rule ids, which rules each
 * try hit and what the next try hit instead. A rule that stays from one try
 * to the next was not fixed; a new one after a fix is the whack-a-mole loop.
 */
export function issueLadder(cases: Case[]): IssueLadder {
  const usable = cases.filter((c) => c.tryRules.size > 0);
  const traj = new Map<string, { occurrences: number; cases: Set<string>; persisted: number; fixed: number; followed: Map<string, number>; recovered: Set<string> }>();
  const trajOf = (r: string) => {
    const t = traj.get(r) ?? { occurrences: 0, cases: new Set<string>(), persisted: 0, fixed: 0, followed: new Map<string, number>(), recovered: new Set<string>() };
    traj.set(r, t);
    return t;
  };
  for (const c of usable) {
    const tries = [...c.tryRules.keys()].filter((n) => n > 0).sort((a, b) => a - b);
    for (let i = 0; i < tries.length; i++) {
      const rules = c.tryRules.get(tries[i])!;
      for (const r of rules) {
        const t = trajOf(r);
        t.occurrences++;
        t.cases.add(c.id);
        if (c.passedTry != null && c.passedTry > tries[i]) t.recovered.add(c.id);
      }
      const nextN = tries[i + 1];
      if (nextN == null) continue;
      const next = c.tryRules.get(nextN)!;
      for (const r of rules) {
        const t = trajOf(r);
        if (next.has(r)) t.persisted++;
        else {
          t.fixed++;
          for (const q of next) if (!rules.has(q)) t.followed.set(q, (t.followed.get(q) ?? 0) + 1);
        }
      }
    }
  }
  const all: RuleTrajectory[] = [...traj.entries()].map(([rule_id, t]) => ({
    rule_id,
    occurrences: t.occurrences,
    cases: t.cases.size,
    persisted: t.persisted,
    fixed: t.fixed,
    followed_by: [...t.followed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, count]) => ({ rule_id: r, count })),
    recovered: t.recovered.size,
    stick_rate: t.persisted + t.fixed ? t.persisted / (t.persisted + t.fixed) : null,
  }));
  const rules = [...all].sort((a, b) => b.occurrences - a.occurrences).slice(0, 25);
  const stubborn = all
    .filter((r) => r.occurrences >= STUBBORN_MIN && r.stick_rate != null)
    .sort((a, b) => b.occurrences * b.stick_rate! - a.occurrences * a.stick_rate!)
    .slice(0, 10);
  return { rules, stubborn, cases: usable.length };
}

const FOLLOW_MIN = 10;
const FOLLOW_MIN_LIFT = 2;

/**
 * Pairs of rules where fixing the first makes the second appear in the next
 * try more often than it usually appears new: the whack-a-mole loop.
 */
export function followPairs(cases: Case[]): FollowPair[] {
  const fixed = new Map<string, number>();
  const pairs = new Map<string, number>();
  const appearedNew = new Map<string, number>();
  let steps = 0;
  for (const c of cases) {
    const tries = [...c.tryRules.keys()].filter((n) => n > 0).sort((a, b) => a - b);
    for (let i = 0; i + 1 < tries.length; i++) {
      const a = c.tryRules.get(tries[i])!;
      const b = c.tryRules.get(tries[i + 1])!;
      steps++;
      const fresh = [...b].filter((r) => !a.has(r));
      for (const y of fresh) appearedNew.set(y, (appearedNew.get(y) ?? 0) + 1);
      for (const x of a) {
        if (b.has(x)) continue;
        fixed.set(x, (fixed.get(x) ?? 0) + 1);
        for (const y of fresh) pairs.set(`${x}|${y}`, (pairs.get(`${x}|${y}`) ?? 0) + 1);
      }
    }
  }
  const out: FollowPair[] = [];
  for (const [key, count] of pairs) {
    if (count < FOLLOW_MIN) continue;
    const [x, y] = key.split("|");
    const share = count / fixed.get(x)!;
    const lift = share / (appearedNew.get(y)! / steps);
    if (lift < FOLLOW_MIN_LIFT) continue;
    out.push({ fixed: x, next: y, count, share, lift: Math.round(lift * 10) / 10 });
  }
  return out.sort((a, b) => b.count * Math.log2(b.lift) - a.count * Math.log2(a.lift)).slice(0, 10);
}

const TREND_RULES = 6;
const TREND_MIN_WEEK = 15;
const RERUN_GAP_MS = 7 * DAY_MS;

/** The Monday (UTC) of a time's week, as YYYY-MM-DD. */
export function weekOf(ms: number): string {
  const d = new Date(ms);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

/**
 * For the rules the encoder does not fix: their weekly rate over runs with
 * try records, whether the same citation still hits them when run again a
 * week or more later, and the merged encoder PRs that name them.
 */
export function ruleTrends(cases: Case[], changes: PipelineEvent[], ladder: IssueLadder, now: number, from: number): RuleTrend[] {
  // One population for every week: runs with the encoder's own per-try
  // record (model and time per try). Archived bundles alone are failed runs
  // only, so mixing them in would bias the early weeks.
  const withTries = cases.filter((c) => c.start >= from && c.start <= now && c.visits.some((v) => v.try_no != null && v.actor));
  const hits = (c: Case, rule: string) => [...c.tryRules.values()].some((set) => set.has(rule));
  const seen = new Set(withTries.flatMap((c) => [...c.tryRules.values()].flatMap((set) => [...set])));
  const rules = (ladder.stubborn.length ? ladder.stubborn : ladder.rules)
    .filter((r) => seen.has(r.rule_id))
    .slice(0, TREND_RULES)
    .map((r) => r.rule_id);
  const byCitation = new Map<string, Case[]>();
  for (const c of withTries) byCitation.set(c.citation, [...(byCitation.get(c.citation) ?? []), c]);
  return rules.map((rule) => {
    const weeks = new Map<string, { cases: number; hit: number }>();
    for (const c of withTries) {
      const w = weekOf(c.start);
      const entry = weeks.get(w) ?? { cases: 0, hit: 0 };
      entry.cases++;
      if (hits(c, rule)) entry.hit++;
      weeks.set(w, entry);
    }
    let citations = 0;
    let still = 0;
    for (const list of byCitation.values()) {
      const sorted = [...list].sort((a, b) => a.start - b.start);
      const first = sorted.find((c) => hits(c, rule));
      if (!first) continue;
      const later = sorted.find((c) => c.start - first.start >= RERUN_GAP_MS);
      if (!later) continue;
      citations++;
      if (hits(later, rule)) still++;
    }
    return {
      rule_id: rule,
      weekly: [...weeks.entries()]
        .filter(([, v]) => v.cases >= TREND_MIN_WEEK)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, v]) => ({ week, ...v })),
      rerun: { citations, still },
      changes: changes
        .filter((e) => e.rule_id === rule && Date.parse(e.at) >= from)
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((e) => ({ at: e.at, number: typeof e.attrs?.number === "number" ? e.attrs.number : null, title: e.message, ref_url: e.ref_url })),
    };
  });
}

const TRY_CAP = 6;

/** Pass rate and cost by try number for the busiest loop in the flow. */
export function retryCurve(cases: Case[], edges: FlowEdge[]): RetryCurve | null {
  const loop = edges.filter((e) => e.loop && e.from !== e.to && !e.to.startsWith("exit:")).sort((a, b) => b.cases - a.cases)[0];
  if (!loop) return null;
  // Both edges of a two-station loop can read as going back; the judge is
  // the station whose visits fail (validate), the work the one it loops to.
  const fails = (station: string) => {
    let n = 0;
    for (const c of cases) for (const v of c.visits) if (v.station === station && v.outcome === "fail") n++;
    return n;
  };
  const [judge, work] = fails(loop.to) > fails(loop.from) ? [loop.to, loop.from] : [loop.from, loop.to];
  const steps = new Map<number, { tries: number; passed: number; cost: number; models: Map<string, number> }>();
  const stepOf = (n: number) => {
    const k = Math.min(n, TRY_CAP);
    const st = steps.get(k) ?? { tries: 0, passed: 0, cost: 0, models: new Map<string, number>() };
    steps.set(k, st);
    return st;
  };
  for (const c of cases) {
    for (const v of c.visits) {
      if (v.try_no == null || v.try_no < 1) continue;
      if (v.station === judge && (v.outcome === "ok" || v.outcome === "fail")) {
        const st = stepOf(v.try_no);
        st.tries++;
        if (v.outcome === "ok") st.passed++;
      } else if (v.station === work && v.outcome === "ok") {
        const st = stepOf(v.try_no);
        st.cost += v.cost_usd ?? 0;
        if (v.actor) st.models.set(v.actor, (st.models.get(v.actor) ?? 0) + 1);
      }
    }
  }
  if (!steps.size) return null;
  return {
    judge,
    work,
    steps: [...steps.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, st]) => st.tries > 0)
      .map(([n, st]) => ({
        try_no: n,
        label: n === TRY_CAP ? `${n}+` : String(n),
        tries: st.tries,
        passed: st.passed,
        cost_usd: Math.round(st.cost * 100) / 100,
        models: [...st.models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
      })),
  };
}

const LOOPING_MIN_CASES = 4;

function loopingCitations(cases: Case[]): LoopingCitation[] {
  const byCitation = new Map<string, Case[]>();
  for (const c of cases) {
    if (!c.visits.some((v) => v.station === "dispatch")) continue;
    const list = byCitation.get(c.citation) ?? [];
    list.push(c);
    byCitation.set(c.citation, list);
  }
  const out: LoopingCitation[] = [];
  for (const [citation, list] of byCitation) {
    if (list.length < LOOPING_MIN_CASES) continue;
    if (list.some((c) => c.visits.some((v) => v.station === "merge" && v.outcome === "ok"))) continue;
    const rules = new Map<string, number>();
    for (const c of list) for (const v of c.visits) if (v.outcome === "fail" && v.rule_id) rules.set(v.rule_id, (rules.get(v.rule_id) ?? 0) + 1);
    let failedVisits = 0;
    let cost: number | null = null;
    for (const c of list) {
      for (const v of c.visits) {
        if (v.outcome === "fail") failedVisits++;
        if (v.cost_usd != null) cost = (cost ?? 0) + v.cost_usd;
      }
    }
    out.push({
      citation,
      cases: list.length,
      last_at: new Date(Math.max(...list.map((c) => c.start))).toISOString(),
      rules: [...rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r),
      failed_visits: failedVisits,
      cost_usd: cost == null ? null : Math.round(cost * 100) / 100,
    });
  }
  return out.sort((a, b) => b.cases - a.cases).slice(0, 15);
}

const HOUR_MS = 3_600_000;
const DEADLINE_WINDOW_MS = 90 * DAY_MS;
const SPIKE_DAYS = 7;
/** A try number needs this many tries before its pass rate raises an alert. */
const RETRY_MIN_TRIES = 30;
/** Below this pass rate a later try is not worth its cost. */
const RETRY_MIN_PASS = 0.05;

/** Alerts from stations against their targets, workflows, deadlines and rule trends. */
function flowAlerts(model: FlowModel, factory: Case[], options: FlowOptions): FlowAlert[] {
  const alerts: FlowAlert[] = [];
  const scope = options.jurisdiction ? `&j=${encodeURIComponent(options.jurisdiction)}${options.only ? "&only=1" : ""}` : "";
  for (const s of model.stations) {
    const t = s.target;
    const href = `/ops?tab=line&station=${encodeURIComponent(s.id)}${scope}`;
    if (!t) continue;
    if (t.min_yield != null && s.yield != null && s.ok + s.failed + s.cancelled >= 10 && s.yield < t.min_yield) {
      alerts.push({
        id: `yield:${s.id}`,
        rule: "yield_below_target",
        severity: s.yield < t.min_yield * 0.75 ? "critical" : "warning",
        station: s.id,
        title: `${s.label}: yield ${pct(s.yield)} (target ${pct(t.min_yield)})`,
        detail: `${s.failed} failed and ${s.cancelled} cancelled of ${s.ok + s.failed + s.cancelled} finished in ${model.window.days} days.${s.failures[0] ? ` Top cause: ${s.failures[0].rule_id} (${s.failures[0].count}).` : ""}`,
        href,
      });
    }
    if (t.max_p95_hours != null && s.p95_ms != null && s.p95_ms > t.max_p95_hours * HOUR_MS) {
      alerts.push({
        id: `p95:${s.id}`,
        rule: "p95_over_target",
        severity: "warning",
        station: s.id,
        title: `${s.label}: p95 ${formatDuration(s.p95_ms)} (target ${formatDuration(t.max_p95_hours * HOUR_MS)})`,
        detail: `Median ${formatDuration(s.p50_ms)}.`,
        href,
      });
    }
    if (t.max_wip != null && s.wip > t.max_wip) {
      alerts.push({
        id: `wip:${s.id}`,
        rule: "wip_over_target",
        severity: s.wip > t.max_wip * 2 ? "critical" : "warning",
        station: s.id,
        title: `${s.label}: ${s.wip} open (limit ${t.max_wip})`,
        detail: `Oldest since ${s.oldest[0]?.since.slice(0, 10) ?? "?"} (${s.oldest[0]?.citation ?? ""}).`,
        href,
      });
    }
    if (s.over_sla > 0 && t.sla_hours != null) {
      alerts.push({
        id: `sla:${s.id}`,
        rule: "case_over_sla",
        severity: s.over_sla >= 10 ? "warning" : "info",
        station: s.id,
        title: `${s.label}: ${s.over_sla} over ${formatDuration(t.sla_hours * HOUR_MS)}`,
        detail: s.oldest
          .slice(0, 3)
          .map((o) => `${o.citation} since ${o.since.slice(0, 10)}`)
          .join("; "),
        href,
      });
    }
  }
  for (const w of options.workflows ?? []) {
    if (w.grade !== "failing") continue;
    alerts.push({
      id: `workflow:${w.label}`,
      rule: "workflow_red",
      severity: "critical",
      station: null,
      title: `${w.label} is failing`,
      detail: w.detail ?? "The latest runs failed.",
      href: w.url,
    });
  }
  for (const d of options.deadlines ?? []) {
    const left = Date.parse(d.at) - options.now;
    if (left < 0 || left > DEADLINE_WINDOW_MS) continue;
    alerts.push({
      id: `deadline:${d.label}`,
      rule: "deadline_near",
      severity: left < 14 * DAY_MS ? "critical" : "warning",
      station: null,
      title: `${d.label} in ${Math.ceil(left / DAY_MS)} days`,
      detail: `On ${d.at.slice(0, 10)}.`,
      href: d.href,
    });
  }
  // Rule spikes: a rule's share of validate failures in the last week vs before.
  const recentFrom = options.now - SPIKE_DAYS * DAY_MS;
  const windowFrom = options.now - options.days * DAY_MS;
  const recent = new Map<string, number>();
  const before = new Map<string, number>();
  let recentTotal = 0;
  let beforeTotal = 0;
  for (const c of factory) {
    for (const v of c.visits) {
      if (v.outcome !== "fail" || !v.rule_id || v.end == null || v.end < windowFrom) continue;
      if (v.end >= recentFrom) {
        recent.set(v.rule_id, (recent.get(v.rule_id) ?? 0) + 1);
        recentTotal++;
      } else {
        before.set(v.rule_id, (before.get(v.rule_id) ?? 0) + 1);
        beforeTotal++;
      }
    }
  }
  if (recentTotal >= 10 && beforeTotal >= 10) {
    for (const [rule, n] of recent) {
      const share = n / recentTotal;
      const prior = (before.get(rule) ?? 0) / beforeTotal;
      if (n >= 5 && share >= 2 * prior && share >= 0.1) {
        alerts.push({
          id: `spike:${rule}`,
          rule: "rule_spike",
          severity: "warning",
          station: null,
          title: `${rule}: ${pct(share)} of failures this week (${pct(prior)} before)`,
          detail: `${n} failures in the last ${SPIKE_DAYS} days.`,
          href: null,
        });
      }
    }
  }
  // A late try that almost never passes: the loop spends without return.
  const retry = model.retry;
  if (retry) {
    for (const st of retry.steps) {
      if (st.try_no < 2 || st.tries < RETRY_MIN_TRIES) continue;
      const rate = st.passed / st.tries;
      if (rate >= RETRY_MIN_PASS) continue;
      alerts.push({
        id: `retry:${retry.judge}:${st.label}`,
        rule: "retry_low_yield",
        severity: "warning",
        station: retry.judge,
        title: `${stationLabel(retry.judge)} try ${st.label} passes ${pct(rate)} (${st.passed} of ${st.tries})`,
        detail: `$${st.cost_usd.toFixed(2)} of model cost on try ${st.label} in ${model.window.days} days. Cap the loop before it, or change what the encoder gets.`,
        href: `/ops?tab=line&view=discovery${scope}`,
      });
    }
  }
  for (const l of model.looping.slice(0, 5)) {
    alerts.push({
      id: `looping:${l.citation}`,
      rule: "looping_citation",
      severity: l.cases >= 8 ? "warning" : "info",
      station: null,
      title: `${l.citation}: ${l.cases} runs, none merged`,
      detail: l.rules.length ? `Fails on ${l.rules.join(", ")}.` : "",
      href: `/ops/journey?citation=${encodeURIComponent(l.citation)}`,
    });
  }
  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function pct(value: number | null): string {
  if (value == null) return "–";
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "–";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR_MS) return `${Math.round(ms / 60_000)}m`;
  if (ms < 2 * DAY_MS) return `${(ms / HOUR_MS).toFixed(ms < 10 * HOUR_MS ? 1 : 0)}h`;
  return `${(ms / DAY_MS).toFixed(ms < 10 * DAY_MS ? 1 : 0)}d`;
}

/** The typed checks that failed the most tries, most tries first. */
function typedCheckRows(cases: Case[], limit = 10): TypedCheckRow[] {
  const rows = new Map<string, TypedCheckRow & { seen: Set<string> }>();
  for (const c of cases) {
    for (const v of c.visits) {
      for (const check of v.checks ?? []) {
        const row = rows.get(check.id) ?? { id: check.id, gate: check.gate, tries: 0, cases: 0, seen: new Set<string>() };
        row.tries += 1;
        row.gate ??= check.gate;
        row.seen.add(c.id);
        rows.set(check.id, row);
      }
    }
  }
  return [...rows.values()]
    .map(({ seen, ...row }) => ({ ...row, cases: seen.size }))
    .sort((a, b) => b.tries - a.tries || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** One citation: each case's visits, for the lanes view. */
export interface CitationLane {
  case_id: string;
  start: string;
  source: string;
  end: string;
  visits: LaneVisit[];
}

export interface LaneVisit {
  station: string;
  start: string;
  end: string | null;
  outcome: Visit["outcome"];
  rule_id: string | null;
  try_no: number | null;
  duration_ms: number | null;
  actor: string | null;
  cost_usd: number | null;
  message: string | null;
  reason: string | null;
  ref_url: string | null;
  waived: boolean;
  /** A failed try's typed checks, and how many more its record left out. */
  checks?: VisitCheck[];
  checks_more?: number;
}

/** What a case's encode step left on record. */
export interface EncodeState {
  /** tries: the encoder recorded each try. no_try_record: the encode step ran, with no try, model, or cost synced.
   *  no_encode: the run ended before the encode step. not_yet: the run has not reached it. outside: not a dispatch. */
  state: "tries" | "no_try_record" | "no_encode" | "not_yet" | "outside";
  /** The state in words, with the station that stopped the run when known. */
  label: string;
  /** How an encode step with no try record ended, when the encoder's live row for the run says. */
  exit?: EncodeExit;
}

type StateVisit = Pick<Visit, "station" | "outcome" | "actor" | "rule_id"> & { encodeExit?: EncodeExit | null };

/** A no-try-record state with the encode's recorded end, when a visit carries one. */
function noTryRecord(visits: StateVisit[], label: string): EncodeState {
  const exit = visits.find((v) => v.encodeExit)?.encodeExit;
  if (!exit) return { state: "no_try_record", label: `${label}. Why it stopped is not on record` };
  return { state: "no_try_record", label: `${label}. ${encodeExitSentence(exit)}`, exit };
}

/**
 * How many no-try-record runs say how their encode ended, in words:
 * "(3 with a recorded end: exited · exit:1 (2), ...; 2 with the last phase
 * alone: generate (2); 14 not on record)". A last phase alone is not a
 * recorded end.
 */
export function noTryRecordSentence(
  trust: Pick<DataTrust, "no_try_record" | "no_try_record_known" | "no_try_record_reasons" | "no_try_record_phase_only" | "no_try_record_phases">
): string {
  if (!trust.no_try_record) return "";
  const known = trust.no_try_record_known ?? 0;
  const phaseOnly = trust.no_try_record_phase_only ?? 0;
  const unknown = trust.no_try_record - known - phaseOnly;
  if (!known && !phaseOnly) return ` (why they stopped is not on record)`;
  const parts: string[] = [];
  if (known) parts.push(`${known} with a recorded end: ${(trust.no_try_record_reasons ?? []).map((r) => `${r.reason} (${r.count})`).join(", ")}`);
  if (phaseOnly) parts.push(`${phaseOnly} with the last phase alone: ${(trust.no_try_record_phases ?? []).map((p) => `${p.phase} (${p.count})`).join(", ")}`);
  parts.push(`${unknown} not on record`);
  return ` (${parts.join("; ")})`;
}

/** The stations a run passes before its encode step. */
const BEFORE_ENCODE = new Set(["dispatch", "approval", "setup", "target_gate"]);

/**
 * Whether a case's encode step ran, and what it recorded. A run with no
 * tries and no cost is one of three things: the encoder kept no try record
 * (older runs, or a step that made no model call), the run ended before the
 * encode step, or it has not reached it yet.
 */
export function encodeState(visits: StateVisit[]): EncodeState {
  const generate = visits.filter((v) => v.station === "generate");
  if (generate.some((v) => v.actor)) return { state: "tries", label: "Tries recorded" };
  if (generate.length) {
    return noTryRecord(visits, "No try recorded: the encode step ran, and the encoder synced no try, model, or cost");
  }
  if (visits[0]?.station !== "dispatch") return { state: "outside", label: "Not encoded by this run" };
  const stop = visits.find((v) => v.outcome === "fail" || v.outcome === "cancel");
  if (stop) {
    const how = stop.outcome === "cancel" ? "cancelled" : "failed";
    const where = `${how} at ${stationLabel(stop.station)}${stop.rule_id ? ` (${stop.rule_id})` : ""}`;
    // Only a stop before the encode step shows that no encode ran; a later stop has no try record to say.
    return BEFORE_ENCODE.has(stop.station)
      ? { state: "no_encode", label: `No encode ran: ${where}` }
      : noTryRecord(visits, `No try recorded: the run ${where}, and the encoder synced no try, model, or cost`);
  }
  if (visits.some((v) => v.outcome === "open")) return { state: "not_yet", label: "Not at the encode step yet" };
  return { state: "no_encode", label: "No encode ran: the run recorded no encode step" };
}

/** A merged case's oracle state. */
export interface CaseOracle {
  state: "compared" | "pending" | "none";
  label: string;
}

/** The oracle state of a merged case: a comparison, pending in the repo's ledger, or none. Null before a merge, or when the merge event predates the state. */
export function caseOracle(visits: Array<Pick<Visit, "station" | "outcome"> & { oracle?: string | null }>): CaseOracle | null {
  const merge = visits.find((v) => v.station === "merge" && v.outcome === "ok");
  if (!merge) return null;
  const oracle = visits.find((v) => v.station === "oracle");
  if (oracle) {
    return oracle.outcome === "open"
      ? { state: "compared", label: "An oracle report covers it, and the report is older than the module (stale)" }
      : { state: "compared", label: "Compared by an oracle (see the oracle station)" };
  }
  if (merge.oracle === "pending") {
    return { state: "pending", label: "Pending: no oracle compares it yet (listed in oracle-coverage-pending.yaml)" };
  }
  if (merge.oracle === "none") return { state: "none", label: "No oracle compares this module" };
  // A verdict on the merge with no oracle visit: the tests on main have not cleared, so the comparison is not shown yet.
  if (merge.oracle) return { state: "compared", label: `An oracle report covers it (${merge.oracle}); the oracle station shows it once the tests on main pass` };
  return null;
}

function laneVisit(v: Visit): LaneVisit {
  return {
    station: v.station,
    start: new Date(v.start).toISOString(),
    end: v.end != null ? new Date(v.end).toISOString() : null,
    outcome: v.outcome,
    rule_id: v.rule_id,
    try_no: v.try_no,
    duration_ms: v.duration_ms,
    actor: v.actor,
    cost_usd: v.cost_usd,
    message: v.message,
    reason: v.reason,
    ref_url: v.ref_url,
    waived: v.waived,
    ...(v.checks ? { checks: v.checks, ...(v.checksMore ? { checks_more: v.checksMore } : {}) } : {}),
  };
}

export function citationLanes(events: PipelineEvent[], citation: string): CitationLane[] {
  const cases = buildCases(events.filter((e) => e.citation === citation));
  // The line's own cases first, newest first; experiment runs (local A/B,
  // failure bundles with no case of their own) after them.
  const own = (c: { source: string }) => (c.source === "pipeline_attempts" ? 0 : 1);
  return [...cases.values()]
    .sort((a, b) => own(a) - own(b) || b.start - a.start)
    .map((c) => ({
      case_id: c.id,
      start: new Date(c.start).toISOString(),
      source: c.source,
      end: c.end === "exit:landed" ? "landed" : c.end ? `${SINK_LABELS[c.end].toLowerCase()} at ${stationLabel(c.failedAt!)}` : "open",
      visits: c.visits.map(laneVisit),
    }));
}

/** One case in full: its visits, every issue by try, and its pages. */
export interface CaseDetail extends CitationLane {
  citation: string;
  jurisdiction: string | null;
  issues: Array<{ try_no: number | null; rule_id: string | null; message: string | null; source: string; final: boolean }>;
  encoder_version: string | null;
  /** Whether the encode step ran and what it recorded. */
  encode: EncodeState;
  /** The merged module's oracle state; null before a merge. */
  oracle: CaseOracle | null;
}

export function caseDetail(events: PipelineEvent[], caseId: string): CaseDetail | null {
  const own = events.filter((e) => e.case_id === caseId);
  const c = buildCases(own).get(caseId);
  if (!c) return null;
  const lane = citationLanes(own, c.citation)[0];
  return {
    ...lane,
    citation: c.citation,
    jurisdiction: c.jurisdiction,
    encoder_version: own.find((e) => e.encoder_version)?.encoder_version ?? null,
    encode: encodeState(c.visits),
    oracle: caseOracle(c.visits),
    issues: own
      .filter((e) => e.kind === "issue")
      .map((e) => ({ try_no: e.try_no, rule_id: e.rule_id, message: e.message, source: e.source, final: Boolean(e.attrs?.final) })),
  };
}

/** A rule's rate in the first and last weeks of its trend, as shares. */
export function trendEnds(t: RuleTrend): { first: number; last: number; firstWeek: string; lastWeek: string } | null {
  if (t.weekly.length < 2) return null;
  const a = t.weekly[0];
  const b = t.weekly[t.weekly.length - 1];
  return { first: a.hit / a.cases, last: b.hit / b.cases, firstWeek: a.week, lastWeek: b.week };
}

/** The first try from which every later try passes under `floor`; null when every try earns its keep. */
export function retryCutoff(steps: TryStep[], floor = 0.05): { from: TryStep; tries: number; passed: number; cost: number } | null {
  for (let i = 1; i < steps.length; i++) {
    const rest = steps.slice(i);
    const tries = rest.reduce((s, x) => s + x.tries, 0);
    const passed = rest.reduce((s, x) => s + x.passed, 0);
    if (tries && passed / tries < floor) return { from: steps[i], tries, passed, cost: rest.reduce((s, x) => s + x.cost_usd, 0) };
  }
  return null;
}

/** "▲ 12 more finished, yield 30% → 26%": a station this week against last week. */
export function trendSentence(t: StationStats["trend"]): string {
  const { now, before } = t;
  if (!now.finished && !before.finished) return "No dated finishes in the last two weeks.";
  const delta = now.finished - before.finished;
  const volume = delta === 0 ? "Same volume as the week before" : `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"} finished than the week before`;
  const y = (b: { finished: number; ok: number }) => (b.finished ? b.ok / b.finished : null);
  const yNow = y(now);
  const yBefore = y(before);
  if (yNow == null || yBefore == null) return `${volume}.`;
  const change = Math.round((yNow - yBefore) * 100);
  const yieldText = Math.abs(change) < 3 ? `yield steady at ${pct(yNow)}` : `yield ${change > 0 ? "up" : "down"} from ${pct(yBefore)} to ${pct(yNow)}`;
  return `${volume}; ${yieldText}.`;
}

/** Markdown brief of the pipeline, for an agent to read before it dispatches. */
export function agentBrief(model: FlowModel, siteUrl: string): string {
  const lines: string[] = [];
  const t = model.totals;
  const scope = model.jurisdiction ? ` (${model.jurisdiction})` : "";
  lines.push(`# Encoding pipeline brief${scope}`);
  lines.push("");
  lines.push(
    `Last ${model.window.days} days to ${model.window.to.slice(0, 16)}Z: ${t.dispatched} runs dispatched, ${t.dispatched_merged} merged (${pct(t.dispatched ? t.dispatched_merged / t.dispatched : null)}), ${t.dispatched_landed} cleared every station. Dispatch to merge, median ${formatDuration(t.dispatch_to_merge_p50_ms)}. ${t.waiting} items wait at a station now, ${t.waiting_over_sla} over their SLA.`
  );
  lines.push("");
  const leaving = model.stations.filter((st) => st.flow.failed_here + st.flow.cancelled_here > 0).sort((a, b) => b.flow.failed_here + b.flow.cancelled_here - (a.flow.failed_here + a.flow.cancelled_here));
  if (leaving.length) {
    const out = leaving.reduce((n, st) => n + st.flow.failed_here + st.flow.cancelled_here, 0);
    lines.push(`## Where cases leave the line, and why (${POPULATION_LABELS[model.population].toLowerCase()})`);
    lines.push(`${out} of ${t.cases} cases left without landing. Each reason names the system that reported it.`);
    lines.push("");
    for (const st of leaving) {
      const f = st.flow;
      lines.push(`- **${st.label}**: ${f.failed_here} failed, ${f.cancelled_here} cancelled (${pct((f.failed_here + f.cancelled_here) / out)} of all exits).`);
      for (const c of f.exit_causes.slice(0, 4)) {
        lines.push(`  - ${c.cases} \`${c.cause}\` (${CAUSE_ORIGINS[c.origin].label})${c.message ? `: ${c.message.slice(0, 140)}` : ""}`);
      }
    }
    lines.push("");
  }
  if (model.trends.length) {
    lines.push("## Did our fixes work?");
    lines.push("For each rule the encoder does not fix: its share of runs, first and last week; whether the same citation still hits it when run again a week or more later; encoder PRs that name it.");
    lines.push("");
    for (const r of model.trends) {
      const ends = trendEnds(r);
      const rate = ends ? `${pct(ends.first)} of runs in the week of ${ends.firstWeek}, ${pct(ends.last)} in the week of ${ends.lastWeek}` : "too few runs per week";
      const rerun = r.rerun.citations ? `; re-run a week later, ${r.rerun.still} of ${r.rerun.citations} citations still hit it` : "";
      const prs = r.changes.length ? `; PRs: ${r.changes.map((c) => `#${c.number}`).join(", ")}` : "; no PR names it";
      lines.push(`- \`${r.rule_id}\`: ${rate}${rerun}${prs}.`);
    }
    lines.push("");
  }
  if (model.follows.length) {
    lines.push("## What follows a fix?");
    for (const f of model.follows) lines.push(`- When \`${f.fixed}\` is fixed, \`${f.next}\` appears in the next try ${pct(f.share)} of the time (${f.lift}× its usual rate, ${f.count} tries).`);
    lines.push("");
  }
  if (model.ladder.stubborn.length) {
    lines.push("## Rules the encoder does not fix");
    const cut = model.retry ? retryCutoff(model.retry.steps) : null;
    if (cut) lines.push(`Retries: from try ${cut.from.label} on, ${cut.passed} of ${cut.tries} tries pass (${pct(cut.passed / cut.tries)}) for $${cut.cost.toFixed(2)}.`);
    for (const r of model.ladder.stubborn.slice(0, 8)) {
      lines.push(`- \`${r.rule_id}\`: ${r.occurrences} failed tries in ${r.cases} cases; the next try fails it again ${pct(r.stick_rate)}; ${r.recovered} cases recovered.`);
    }
    lines.push("");
  }
  if (model.looping.length) {
    lines.push("## Do not re-dispatch without a change");
    for (const l of model.looping.slice(0, 10)) lines.push(`- ${l.citation}: ${l.cases} runs, none merged, ${l.failed_visits} failures, ${l.cost_usd == null ? "cost not recorded" : `$${l.cost_usd.toFixed(2)} model cost`}; ${l.rules.join(", ") || "no rule"} (${link(`/ops/journey?citation=${encodeURIComponent(l.citation)}`, siteUrl)})`);
    lines.push("");
  }
  if (model.waiting.length) {
    lines.push("## Where cases wait now");
    lines.push("| station | why | cases (runs) | over SLA | oldest since | oldest case |");
    lines.push("|---|---|---|---|---|---|");
    for (const w of model.waiting.slice(0, 15)) {
      const first = w.oldest[0];
      lines.push(
        `| ${w.label} | \`${w.cause}\`${w.detail ? ` ${w.detail.replace(/\|/g, "/")}` : ""} | ${w.cases} (${w.runs}) | ${w.over_sla} | ${w.since.slice(0, 10)} | ${first ? `${first.citation} (${link(`/ops/journey?citation=${encodeURIComponent(first.citation)}`, siteUrl)})` : ""} |`
      );
    }
    lines.push("");
  }
  if (model.typed_checks.length) {
    lines.push("## Typed checks that failed tries");
    lines.push("From the encoder's issue document per try (registry check id and gate). Only tries that carry one are counted.");
    for (const row of model.typed_checks) {
      lines.push(`- \`${row.id}\` (gate ${row.gate ?? "not recorded"}): ${row.tries} tries in ${row.cases} cases`);
    }
    lines.push("");
  }
  lines.push("## Alerts");
  if (!model.alerts.length) lines.push("- None.");
  for (const a of model.alerts.slice(0, 15)) lines.push(`- **${a.severity}** ${a.title}. ${a.detail}${a.href ? ` (${link(a.href, siteUrl)})` : ""}`);
  lines.push("");
  lines.push("## Stations");
  lines.push("| station | cases | yield | waiting (over SLA) | p50 | p95 | this week | top cause |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const s of model.stations) {
    const top = s.failures[0] ? `${s.failures[0].rule_id} (${s.failures[0].count})` : "";
    const time = (ms: number | null) => (s.timed ? formatDuration(ms) : s.unmeasured ? `not measured: ${s.unmeasured}` : "not timed");
    lines.push(`| ${s.label} | ${s.cases} | ${pct(s.yield)} | ${s.wip} (${s.over_sla}) | ${time(s.p50_ms)} | ${time(s.p95_ms)} | ${trendSentence(s.trend)} | ${top} |`);
  }
  lines.push("");
  const tr = model.trust;
  lines.push("## How much these numbers can see");
  lines.push(
    `Of ${tr.dispatched} dispatched runs: ${tr.with_tries} have per-try records (since ${tr.tries_since?.slice(0, 10) ?? "never"}), ${tr.with_cost} a recorded cost, ${tr.with_issue_list} a full issue list, ${tr.with_typed_checks} typed checks (rule id and gate) on a failed try. ${tr.no_encode} ran no encode (the run ended before the encode step); ${tr.no_try_record} ran the encode step with no try record${noTryRecordSentence(tr)}. Of ${tr.oracle.merged} merged: ${tr.oracle.compared} compared by an oracle, ${tr.oracle.pending} pending (listed in oracle-coverage-pending.yaml), ${tr.oracle.none} with no oracle${tr.oracle.unknown ? `, ${tr.oracle.unknown} not recorded` : ""}. Not timed: ${tr.untimed.map(stationLabel).join(", ") || "none"}.${tr.partly_timed.length ? ` Timed for part of their visits: ${tr.partly_timed.map((x) => `${stationLabel(x.station)} (${pct(x.share)})`).join(", ")}.` : ""}${tr.unmeasured.length ? ` Not measured: ${tr.unmeasured.map((x) => `${stationLabel(x.station)} (${x.reason})`).join(", ")}.` : ""} ${tr.releases} corpus releases in the window.`
  );
  lines.push("");
  lines.push(`Data: ${model.events} events (${Object.entries(model.sources).map(([s, n]) => `${s} ${n}`).join(", ")}). JSON: ${link("/api/ops/flow", siteUrl)}.`);
  return lines.join("\n");
}

function link(path: string, siteUrl: string): string {
  return path.startsWith("http") ? path : `${siteUrl}${path}`;
}

/** The stations the line emits today, in line order (see docs/operations/pipeline-flow.md, "Stations"). */
export const LINE_STATIONS = [
  "corpus_ingest",
  "release_publish",
  "release_activate",
  "release_pin",
  "dispatch",
  "approval",
  "setup",
  "target_gate",
  "generate",
  "validate",
  "publish",
  "pr_checks",
  "review",
  "merge",
  "index",
  "tests",
  "compile",
  "oracle",
];

/**
 * The stations for drawing a few cases' lanes: the line's own order, then
 * any other station the events name, in the order they first appear.
 */
export function stationOrderOf(events: PipelineEvent[]): string[] {
  const order = [...LINE_STATIONS];
  for (const e of events) if (!order.includes(e.station)) order.push(e.station);
  return order;
}
