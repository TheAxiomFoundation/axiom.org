/**
 * The encoding pipeline as an event log: one event per thing that happened
 * to one case at one station (encodings.pipeline_events).
 *
 * A case is one row of encodings.pipeline_attempts. attemptEvents derives a
 * case's events from that row, so the backfill and the collector write the
 * same events, and /ops can derive them in-process before the table
 * exists. issueEvents turns archived validator issues (failure bundles,
 * local A/B runs) into `issue` events on the same cases.
 *
 * Events come out in pipeline order, and the order is kept for events at the
 * same instant, so the flow mining never needs a hard-coded station order.
 */

import { attemptSource, carriedToMain, encodeExit, failedStepStation, mainMergedAt, type PipelineAttempt, type PipelineTry } from "./encoding-pipeline";
import { compareVersions } from "./encoding-pipeline-insights";

export type EventKind = "enter" | "leave" | "fail" | "cancel" | "wait" | "issue" | "change";

export type EventSource = "pipeline_attempts" | "failure_bundle" | "local_ab" | "encoder" | "waiver_ledger" | "encoder_change" | "corpus_release";

/** One row of encodings.pipeline_events. */
export interface PipelineEvent {
  id: string;
  case_id: string;
  citation: string;
  jurisdiction: string | null;
  station: string;
  kind: EventKind;
  at: string;
  duration_ms: number | null;
  outcome: string | null;
  try_no: number | null;
  rule_id: string | null;
  message: string | null;
  actor: string | null;
  cost_usd: number | null;
  encoder_version: string | null;
  source: EventSource;
  ref_url: string | null;
  attrs: Record<string, unknown>;
}

const MESSAGE_LIMIT = 500;

export { failedStepStation } from "./encoding-pipeline";

/** A short rule id for an infrastructure failure: infra:<step name, kebab-cased>. */
export function infraRuleId(step: string): string {
  const name = step.includes(" / ") ? step.slice(step.lastIndexOf(" / ") + 3) : step;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `infra:${slug || "unknown"}`;
}

/**
 * A failed try's typed checks as event attrs: `checks` the registry ids,
 * `check_detail` each id with its gate and number of findings, `checks_more`
 * how many the try's record leaves out. Empty when the try has none.
 */
function tryCheckAttrs(t: PipelineTry): Record<string, unknown> {
  if (!t.checks?.length) return {};
  return {
    checks: t.checks.map((check) => check.id),
    check_detail: t.checks,
    ...(t.checksMore ? { checks_more: t.checksMore } : {}),
  };
}

const RULE_RE = /\[([a-z][a-z0-9-]*(?::[a-z0-9-]+)+)\]/i;

/**
 * The validator rule an issue names (`[complete-source-unit:tests]`), or a
 * stable class for one that names none: its leading words with paths,
 * numbers and quoted values taken out, so the same message groups.
 */
export function issueRuleId(message: string): string {
  const match = message.match(RULE_RE);
  if (match) return match[1].toLowerCase();
  const body = message
    // "statutes/42/1437c-1.yaml: ci: ..." — drop the file and gate prefix.
    .replace(/^[^\s:]+\.(?:ya?ml|json|txt):\s*/i, "")
    .replace(/^(?:ci|review|compile|apply):\s*/i, "")
    .replace(/`[^`]*`|'[^']*'|"[^"]*"/g, " ")
    .replace(/\S*[/\\]\S*/g, " ")
    .replace(/\d+(?:\.\d+)?/g, " ");
  const words = body
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.length ? `text:${words.join("-").slice(0, 48).replace(/-$/, "")}` : "text:unknown";
}

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text;
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function spanMs(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

const MODEL_PHASES = new Set(["model_call"]);

/** The encoder status of a run its pre-encode gate stopped before any model call (axiom-encode #1997). */
export const GATE_BLOCKED_STATUS = "pre_encode_blocked";

/**
 * The first axiom-encode version that runs the pre-encode gate on every
 * encode, so a run of it that reached a model call passed the gate. Null
 * until the gate ships on main (axiom-encode #1997): until then only a
 * blocked run, if any, records a gate verdict.
 */
export const PRE_ENCODE_GATE_SINCE: string | null = null;

/** Whether an encoder version runs the pre-encode gate. */
export function runsPreEncodeGate(version: string | null | undefined, since: string | null = PRE_ENCODE_GATE_SINCE): boolean {
  return Boolean(since && version && compareVersions(version, since) >= 0);
}

interface Builder {
  push(event: Omit<PipelineEvent, "id" | "case_id" | "citation" | "jurisdiction" | "source" | "encoder_version" | "attrs"> & {
    attrs?: Record<string, unknown>;
  }): void;
}

/**
 * Every event one pipeline_attempts row implies, in pipeline order.
 * A station the case has not reached has no event; a station it waits at
 * has an `enter` (or `wait`) and no `leave`, which is what WIP counts.
 */
export function attemptEvents(attempt: PipelineAttempt): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  const seq = new Map<string, number>();
  const kindSource = attemptSource(attempt);
  const builder: Builder = {
    push(event) {
      const key = `${event.station}/${event.kind}`;
      const n = seq.get(key) ?? 0;
      seq.set(key, n + 1);
      events.push({
        id: `${attempt.id}/${key}/${event.try_no ?? n}`,
        case_id: attempt.id,
        citation: attempt.citation,
        jurisdiction: attempt.jurisdiction,
        source: "pipeline_attempts",
        encoder_version: attempt.encoder_version ?? null,
        ...event,
        attrs: { case_source: kindSource, ...(event.attrs ?? {}) },
      });
    },
  };
  const ev = (partial: Partial<PipelineEvent> & Pick<PipelineEvent, "station" | "kind" | "at">) =>
    builder.push({
      duration_ms: null,
      outcome: null,
      try_no: null,
      rule_id: null,
      message: null,
      actor: null,
      cost_usd: null,
      ref_url: null,
      ...partial,
    });

  const runUrl = attempt.run_url || null;
  const finished = attempt.run_status === "completed";
  // A failed run with no failed step but an encoder verdict failed in the
  // encode loop (the encoder record names it; the bundle was not read).
  const encoderFailed = !attempt.failed_step && attempt.run_conclusion === "failure" && Boolean(attempt.encoder_error || attempt.encoder_status);
  const failedAt = attempt.failed_step ? failedStepStation(attempt.failed_step) : encoderFailed ? "validate" : null;
  const failRule = failedAt
    ? attempt.encoder_error_rule ??
      (failedAt === "validate" && attempt.encoder_error
        ? issueRuleId(attempt.encoder_error)
        : infraRuleId(attempt.failed_step ?? attempt.encoder_status ?? "unknown"))
    : null;
  const cancelled = attempt.run_conclusion === "cancelled";

  let encodeFrom = attempt.tries?.[0]?.startedAt ?? attempt.encode_loop?.startedAt ?? attempt.dispatched_at;
  if (kindSource === "dispatch") {
    // Dispatch: a point event.
    // trigger: what the dispatch asked for, on runs that carry a dispatch record.
    const record = attempt.dispatch_record;
    ev({
      station: "dispatch",
      kind: "leave",
      at: attempt.dispatched_at,
      outcome: "ok",
      actor: attempt.dispatched_by ?? null,
      ref_url: runUrl,
      duration_ms: 0,
      ...(record ? { attrs: { trigger: record.kind, open_pr: record.open_pr, pr_base_branch: record.pr_base_branch, repair_run_id: record.repair_run_id } } : {}),
    });

    // Approval: from the run's start to the encode job's first step.
    const approvalFrom = attempt.started_at ?? attempt.dispatched_at;
    if (cancelled && attempt.cancel_stage === "approval") {
      ev({ station: "approval", kind: "enter", at: approvalFrom });
      ev({ station: "approval", kind: "cancel", at: attempt.finished_at ?? approvalFrom, outcome: "cancelled", duration_ms: spanMs(approvalFrom, attempt.finished_at), ref_url: runUrl });
      return events;
    }
    if (attempt.encode_started_at) {
      ev({ station: "approval", kind: "enter", at: approvalFrom });
      ev({ station: "approval", kind: "leave", at: attempt.encode_started_at, outcome: "ok", duration_ms: spanMs(approvalFrom, attempt.encode_started_at), ref_url: runUrl });
    } else if (!finished) {
      // Still queued or waiting for the signing approval.
      ev({ station: "approval", kind: "enter", at: approvalFrom });
      return events;
    }

    // Setup: checkouts and builds before the encode step.
    const setupFrom = attempt.encode_started_at ?? approvalFrom;
    const setupMs = attempt.setup_seconds != null ? attempt.setup_seconds * 1000 : null;
    ev({ station: "setup", kind: "enter", at: setupFrom });
    if (failedAt === "setup") {
      ev({ station: "setup", kind: "fail", at: attempt.finished_at ?? setupFrom, outcome: "fail", rule_id: failRule, message: clip(attempt.encoder_error ?? attempt.failed_step), duration_ms: spanMs(setupFrom, attempt.finished_at), ref_url: runUrl });
      return events;
    }
    if (cancelled && attempt.cancel_stage === "before_job") {
      ev({ station: "setup", kind: "cancel", at: attempt.finished_at ?? setupFrom, outcome: "cancelled", ref_url: runUrl });
      return events;
    }
    encodeFrom = setupMs != null ? addMs(setupFrom, setupMs) : setupFrom;
    const gateBlocked = attempt.encoder_status === GATE_BLOCKED_STATUS;
    if (setupMs != null || attempt.tries?.length || attempt.encode_seconds != null || attempt.pr_created_at || gateBlocked) {
      ev({ station: "setup", kind: "leave", at: encodeFrom, outcome: "ok", duration_ms: setupMs, attrs: setupMs == null ? { untimed: true } : {} });
    } else if (!finished) {
      return events;
    }

    // Target gate: the encoder's pre-encode gate, before any model call. Its
    // own time is not recorded: a point.
    if (gateBlocked) {
      ev({ station: "target_gate", kind: "enter", at: encodeFrom });
      ev({
        station: "target_gate",
        kind: "fail",
        at: encodeFrom,
        outcome: "blocked",
        rule_id: "gate:pre-encode-blocked",
        message: clip(attempt.encoder_error),
        ref_url: runUrl,
        attrs: { untimed: true },
      });
      return events;
    }
    if (runsPreEncodeGate(attempt.encoder_version) && (attempt.tries?.length || attempt.encode_seconds != null || attempt.pr_created_at)) {
      ev({ station: "target_gate", kind: "enter", at: encodeFrom });
      ev({ station: "target_gate", kind: "leave", at: encodeFrom, outcome: "ok", attrs: { untimed: true } });
    }
  }

  // A module written inside another citation's run (dependent) has its own
  // encode loop; a module merged outside the pipeline starts at its PR.
  if (kindSource !== "outside") {
    // The encode loop: one generate and one validate per try.
    const tries = [...(attempt.tries ?? [])].sort((a, b) => a.attempt - b.attempt);
    let clock = encodeFrom;
    const exit = tries.length ? null : encodeExit(attempt);
    if (tries.length) {
      for (const t of tries) {
        const start = t.startedAt ?? clock;
        const phases = t.phases ?? [];
        const modelMs = phases.length ? phases.filter((p) => MODEL_PHASES.has(p.name)).reduce((s, p) => s + p.ms, 0) : (t.ms ?? null);
        const wall = t.wallMs ?? (phases.length ? phases.reduce((s, p) => s + p.ms, 0) : t.ms ?? null);
        // Without the try's own clock (before encoder 0.2.2157) the checks are untimed.
        const checkMs = t.wallMs != null && modelMs != null ? Math.max(0, wall! - modelMs) : null;
        const untimed = checkMs == null ? { untimed: true } : {};
        const tools: Record<string, number> = {};
        for (const p of phases) {
          if (MODEL_PHASES.has(p.name)) continue;
          tools[p.name] = (tools[p.name] ?? 0) + p.ms;
        }
        ev({ station: "generate", kind: "enter", at: start, try_no: t.attempt, actor: t.model });
        const genEnd = modelMs != null ? addMs(start, modelMs) : start;
        ev({ station: "generate", kind: "leave", at: genEnd, try_no: t.attempt, outcome: "ok", duration_ms: modelMs, actor: t.model, cost_usd: t.cost, attrs: modelMs == null ? { untimed: true } : {} });
        ev({ station: "validate", kind: "enter", at: genEnd, try_no: t.attempt });
        const valEnd = checkMs != null ? addMs(genEnd, checkMs) : genEnd;
        if (t.ok) {
          ev({ station: "validate", kind: "leave", at: valEnd, try_no: t.attempt, outcome: "ok", duration_ms: checkMs, attrs: { phases: tools, ...untimed } });
        } else {
          ev({
            station: "validate",
            kind: "fail",
            at: valEnd,
            try_no: t.attempt,
            outcome: "fail",
            duration_ms: checkMs,
            rule_id: t.error ? issueRuleId(t.error) : failRule,
            message: clip(t.error),
            actor: t.model,
            attrs: { phases: tools, ...untimed, ...tryCheckAttrs(t) },
          });
        }
        clock = valEnd;
      }
    } else if (attempt.encode_seconds != null || failedAt === "validate" || attempt.pr_created_at || exit) {
      // No per-try record (runs before the encoder synced its tries): the
      // encode step as one generate and one validate. encode_exit: how the
      // encoder's live row for the run says the encode ended, when one does.
      const encodeMs = attempt.encode_seconds != null ? attempt.encode_seconds * 1000 : null;
      ev({ station: "generate", kind: "enter", at: encodeFrom, try_no: attempt.generation_attempts ?? null });
      ev({ station: "generate", kind: "leave", at: encodeFrom, outcome: "ok", try_no: attempt.generation_attempts ?? null, attrs: { untimed: true, ...(exit ? { encode_exit: exit } : {}) } });
      ev({ station: "validate", kind: "enter", at: encodeFrom, try_no: attempt.generation_attempts ?? null });
      clock = encodeMs != null ? addMs(encodeFrom, encodeMs) : (attempt.finished_at ?? encodeFrom);
      if (failedAt !== "validate") {
        ev({ station: "validate", kind: "leave", at: clock, outcome: "ok", duration_ms: encodeMs, try_no: attempt.generation_attempts ?? null, attrs: encodeMs == null ? { untimed: true } : {} });
      }
    } else if (!finished) {
      return events;
    }

    if (failedAt === "validate") {
      // The run failed in the encode step: the last try's verdict, or the
      // step's own failure when no try recorded one.
      const lastTry = tries.at(-1);
      if (!lastTry || lastTry.ok) {
        ev({
          station: "validate",
          kind: "fail",
          at: attempt.finished_at ?? clock,
          outcome: "fail",
          try_no: attempt.generation_attempts ?? lastTry?.attempt ?? null,
          rule_id: failRule,
          message: clip(attempt.encoder_error ?? attempt.failed_step),
          cost_usd: attempt.cost_usd,
          ref_url: runUrl,
          attrs: { run_level: true, untimed: true },
        });
      }
      return events;
    }
    if (cancelled) {
      ev({ station: "validate", kind: "cancel", at: attempt.finished_at ?? clock, outcome: "cancelled", ref_url: runUrl });
      return events;
    }

    // Publish: package, sign, open the PR. A dependent module rides in its
    // host run's PR; without that PR on the row it waits there.
    ev({ station: "publish", kind: "enter", at: clock });
    if (kindSource === "dependent" && !attempt.pr_created_at) {
      ev({ station: "publish", kind: "wait", at: clock, outcome: "host_run", rule_id: "publish:in-host-run", ref_url: runUrl });
      return events;
    }
    if (failedAt === "publish") {
      ev({ station: "publish", kind: "fail", at: attempt.finished_at ?? clock, outcome: "fail", rule_id: failRule, message: clip(attempt.encoder_error ?? attempt.failed_step), ref_url: runUrl });
      return events;
    }
    if (!attempt.pr_created_at) {
      if (finished && attempt.run_conclusion === "success" && attempt.pr_requested === false) {
        // The dispatch asked for no PR (open_pr false): the run ends at its
        // signed artifact by design. Not a failure, and not a landing.
        ev({
          station: "publish",
          kind: "cancel",
          at: attempt.finished_at ?? clock,
          outcome: "artifact_only",
          rule_id: "publish:artifact-only",
          message: "The dispatch asked for no pull request (open_pr false)",
          ref_url: runUrl,
          attrs: { untimed: true },
        });
      } else if (finished) {
        ev({
          station: "publish",
          kind: "fail",
          at: attempt.finished_at ?? clock,
          outcome: attempt.run_conclusion === "success" ? "no_pr" : "fail",
          rule_id: attempt.run_conclusion === "success" ? "infra:no-pr" : failRule ?? "infra:unknown",
          message: clip(attempt.encoder_error),
          ref_url: runUrl,
        });
      }
      return events;
    }
    // The encoder's own loop clock ends the encode part. Job step times
    // read before the lane steps were counted as encode time (0.2.2218 to
    // the collector fix) put the whole loop in publish_seconds.
    const loop = attempt.encode_loop;
    const loopEnd = loop?.startedAt ? addMs(loop.startedAt, loop.wallMs) : null;
    const publishMs = loopEnd
      ? spanMs(loopEnd, attempt.pr_created_at)
      : attempt.publish_seconds != null
        ? attempt.publish_seconds * 1000
        : spanMs(clock, attempt.pr_created_at);
    ev({ station: "publish", kind: "leave", at: attempt.pr_created_at, outcome: "ok", duration_ms: publishMs, ref_url: attempt.pr_url });
  }

  prEvents(attempt, ev, kindSource);
  return events;
}

/** The PR and everything after it, for every kind of case. */
function prEvents(
  attempt: PipelineAttempt,
  ev: (partial: Partial<PipelineEvent> & Pick<PipelineEvent, "station" | "kind" | "at">) => void,
  kindSource: ReturnType<typeof attemptSource>
): void {
  const prAt = attempt.pr_created_at;
  if (!prAt && kindSource !== "outside") return;
  const prUrl = attempt.pr_url;

  const carried = carriedToMain(attempt);
  if (prAt) {
    // PR checks.
    ev({ station: "pr_checks", kind: "enter", at: prAt });
    const merged = attempt.pr_state === "merged";
    // When the head commit's last check finished: the end of the CI that
    // counts. Each branch update restarts CI, so the time from the PR's
    // creation to here holds every restart.
    const prEnd = attempt.pr_merged_at ?? attempt.pr_closed_at ?? null;
    const checksEnd = within(attempt.pr_checks_finished_at, prAt, null);
    const checkAttrs = gateAttrs(attempt);
    if (attempt.pr_checks === "failure") {
      const checks = attempt.pr_failed_checks ?? [];
      ev({
        station: "pr_checks",
        kind: merged || carried ? "wait" : "fail",
        at: checksEnd ?? prAt,
        outcome: "fail",
        rule_id: checks.length ? `check:${checks[0]}` : "check:unknown",
        message: clip(attempt.pr_check_error),
        ref_url: attempt.pr_check_job_id && attempt.pr_repo ? `${prUrl}/checks?check_run_id=${attempt.pr_check_job_id}` : prUrl,
        duration_ms: checksEnd && !merged && !carried ? spanMs(prAt, checksEnd) : null,
        attrs: {
          ...checkAttrs,
          ...(checks.length > 1 ? { failed_checks: checks } : {}),
          // The PR is still open: the case sits here until someone fixes or closes it.
          ...(attempt.pr_state === "open" || attempt.pr_state === "draft" ? { pr_open: true } : {}),
        },
      });
      if (!merged && !carried) return;
    }
    if (attempt.pr_checks === "pending" && (attempt.pr_state === "open" || attempt.pr_state === "draft")) {
      const updates = branchUpdates(attempt);
      ev({
        station: "pr_checks",
        kind: "wait",
        at: within(attempt.pr_checks_started_at, prAt, null) ?? prAt,
        outcome: "pending",
        rule_id: "check:pending",
        message: updates ? `CI is running again after ${plural(updates, "branch update")}` : null,
        ref_url: prUrl,
        attrs: checkAttrs,
      });
      return;
    }
    if (attempt.pr_checks === "pending" && !merged && !carried) return;
    if (attempt.pr_state === "closed" && attempt.pr_checks !== "success" && !carried) {
      // Closed with checks not passing: the time to the close is not check time.
      ev({ station: "pr_checks", kind: "cancel", at: attempt.pr_closed_at ?? prAt, outcome: "closed", ref_url: prUrl, attrs: { untimed: true } });
      return;
    }
    // Timed to the head commit's last check when the collector read it
    // (pr_checks_finished_at); the rollup alone has no finish time.
    const passedAt = attempt.pr_checks === "success" ? within(checksEnd, prAt, prEnd) : null;
    ev({
      station: "pr_checks",
      kind: "leave",
      at: passedAt ?? prAt,
      outcome: carried && attempt.pr_checks !== "success" ? "carried" : "ok",
      duration_ms: passedAt ? spanMs(prAt, passedAt) : null,
      ref_url: prUrl,
      attrs: passedAt ? checkAttrs : { untimed: true },
    });

    // Review and merge decision: from the checks' finish when it is known.
    const reviewAt = passedAt ?? prAt;
    ev({ station: "review", kind: "enter", at: reviewAt });
    if (attempt.pr_review === "changes_requested") {
      ev({ station: "review", kind: "wait", at: reviewAt, outcome: "changes_requested", rule_id: "review:changes-requested", ref_url: prUrl });
    }
    if (carried) {
      // Closed, and another PR (a merge train) carried the module to the
      // default branch: the review ended when the first of the two happened.
      const handedAt = carriedAt(attempt) ?? reviewAt;
      ev({
        station: "review",
        kind: "leave",
        at: handedAt,
        outcome: "carried",
        duration_ms: spanMs(reviewAt, handedAt),
        ref_url: attempt.pr_via_url ?? prUrl,
        attrs: { carried_by: attempt.pr_via_number ?? null },
      });
    } else if (attempt.pr_state === "closed") {
      ev({ station: "review", kind: "fail", at: attempt.pr_closed_at ?? prAt, outcome: "closed", rule_id: "review:closed-unmerged", duration_ms: spanMs(reviewAt, attempt.pr_closed_at), ref_url: prUrl });
      return;
    } else if (!merged) {
      const wait = attempt.pr_review === "changes_requested" ? null : openPrWait(attempt);
      if (wait) ev({ station: "review", kind: "wait", at: reviewAt, ref_url: prUrl, ...wait, attrs: { ...checkAttrs, ...approvalAttrs(attempt) } });
      return;
    } else {
      ev({ station: "review", kind: "leave", at: attempt.pr_merged_at!, outcome: "ok", duration_ms: spanMs(reviewAt, attempt.pr_merged_at), ref_url: prUrl, attrs: approvalAttrs(attempt) });
    }
  }

  // Merge into the default branch (directly, through a side branch's PR, or
  // inside a merge train that replaced the PR).
  const mergedAt = mainMergedAt(attempt);
  const mergeEnter = carried ? carriedAt(attempt) : attempt.pr_merged_at ?? attempt.finished_at;
  if (!mergeEnter) return;
  ev({ station: "merge", kind: "enter", at: mergeEnter });
  if (!mergedAt) {
    if (attempt.pr_targets_default === false) {
      const open = attempt.pr_via_state === "open" || attempt.pr_via_state === "draft";
      ev({
        station: "merge",
        kind: open ? "wait" : "fail",
        at: mergeEnter,
        outcome: open ? "side_branch" : "off_main",
        rule_id: "merge:side-branch",
        ref_url: attempt.pr_via_url ?? prUrl,
      });
    }
    return;
  }
  const mergeOracle = attempt.oracle_status ?? (attempt.index_status === "indexed" ? "none" : null);
  // The merged module files: the accepted-module count keys on them.
  ev({
    station: "merge",
    kind: "leave",
    at: mergedAt,
    outcome: "ok",
    duration_ms: spanMs(mergeEnter, mergedAt),
    ref_url: attempt.pr_via_url ?? prUrl,
    // oracle: the comparison state of the merged module; "none" when it is indexed, no report compares it and
    // no ledger lists it. Before the index the state is not computed: no attr.
    attrs: { repo: attempt.pr_repo, modules: attempt.module_paths ?? [], ...(mergeOracle ? { oracle: mergeOracle } : {}), ...(carried ? { carried_by: attempt.pr_via_number ?? null } : {}) },
  });

  // Index (the rulespec_files sync) and tests on main both start at the
  // merge: the jurisdiction's validation runs on the merge commit, often
  // before the sync.
  ev({ station: "index", kind: "enter", at: mergedAt });
  // A verdict without a time (a waiver read from the gaps file) is placed at
  // the merge, untimed.
  const testsAt = attempt.tests_first_at ?? attempt.tests_checked_at ?? mergedAt;
  ev({ station: "tests", kind: "enter", at: mergedAt });
  if (attempt.tests_status) {
    const ok = attempt.tests_status !== "fail";
    ev({
      station: "tests",
      kind: ok ? "leave" : "fail",
      at: testsAt,
      outcome: attempt.tests_status === "pass" ? "ok" : attempt.tests_status,
      rule_id: ok ? null : testsFailRule(attempt),
      message: ok ? null : testsFailMessage(attempt),
      duration_ms: attempt.tests_first_at ? spanMs(mergedAt, testsAt) : null,
      ref_url: attempt.tests_run_url ?? attempt.tests_first_run_url ?? null,
      attrs: attempt.tests_first_at ? {} : { untimed: true, read_time: true },
    });
  } else {
    // Merged, and no validation run on the default branch has reported on
    // this module: the collector found no push run that covers it.
    ev({
      station: "tests",
      kind: "wait",
      at: mergedAt,
      outcome: "no_verdict",
      rule_id: "tests:no-verdict",
      message: "No validation run on the default branch has reported on this module since the merge",
      ref_url: attempt.pr_via_url ?? prUrl,
    });
  }
  if (attempt.index_status === "missing") {
    ev({ station: "index", kind: "fail", at: attempt.synced_at ?? mergedAt, outcome: "missing", rule_id: "index:missing", duration_ms: spanMs(mergedAt, attempt.synced_at) });
    return;
  }
  const indexedAt = attempt.indexed_at ?? attempt.synced_at;
  if (!indexedAt) return;
  ev({ station: "index", kind: "leave", at: indexedAt, outcome: "ok", duration_ms: spanMs(mergedAt, indexedAt) });

  // Compile (axiom-api's nightly sweep) and tests on main run side by side
  // after the index; each is its own station.
  ev({ station: "compile", kind: "enter", at: indexedAt });
  if (attempt.compile_status && attempt.compile_checked_at) {
    const ok = attempt.compile_status === "ok" || attempt.compile_status === "skipped";
    ev({
      station: "compile",
      kind: ok ? "leave" : "fail",
      at: attempt.compile_checked_at,
      outcome: attempt.compile_status,
      rule_id: ok ? null : `compile:${attempt.compile_status}`,
      message: clip(attempt.compile_error),
      // compile_checked_at is the latest nightly sweep, not the first: untimed,
      // and its time is when it was read, not when the station finished.
      attrs: { untimed: true, read_time: true },
    });
  } else {
    // Indexed, and axiom-api's compile sweep has no verdict on this module.
    ev({
      station: "compile",
      kind: "wait",
      at: indexedAt,
      outcome: "no_verdict",
      rule_id: "compile:no-verdict",
      message: "The compile sweep has not reported on this module",
    });
  }

  if (!attempt.tests_status || attempt.tests_status === "fail") return;

  // Oracle comparison, once one exists.
  if (attempt.oracle_status && attempt.oracle_checked_at) {
    ev({ station: "oracle", kind: "enter", at: attempt.compile_checked_at && attempt.compile_checked_at > testsAt ? attempt.compile_checked_at : testsAt });
    const ok = attempt.oracle_status === "match" || attempt.oracle_status === "explained";
    ev({
      station: "oracle",
      kind: ok ? "leave" : attempt.oracle_status === "stale" ? "wait" : "fail",
      at: attempt.oracle_checked_at,
      outcome: attempt.oracle_status,
      rule_id: ok ? null : `oracle:${attempt.oracle_status}`,
      actor: attempt.oracle_engine ?? null,
      ref_url: attempt.oracle_report ?? null,
    });
  }
}

/** `at` when it lies in [from, to]; else null. A head check can finish after the PR closed. */
function within(at: string | null | undefined, from: string, to: string | null): string | null {
  if (!at || at < from) return null;
  return to && at > to ? null : at;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Commits pushed to the PR after the bot's first one: each is a branch update, and each restarts CI. */
export function branchUpdates(attempt: Pick<PipelineAttempt, "pr_commit_count">): number {
  return Math.max(0, (attempt.pr_commit_count ?? 1) - 1);
}

/** When a merge train took over a closed PR: the earlier of the close and the train's merge. */
function carriedAt(attempt: PipelineAttempt): string | null {
  const times = [attempt.pr_closed_at, attempt.pr_via_merged_at].filter((t): t is string => Boolean(t)).sort();
  return times[0] ?? null;
}

/** What the collector read about the PR's head commit and its CI, for an event's attrs. */
function gateAttrs(attempt: PipelineAttempt): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const updates = branchUpdates(attempt);
  if (attempt.pr_commit_count != null) attrs.branch_updates = updates;
  const last = spanMs(attempt.pr_checks_started_at ?? null, attempt.pr_checks_finished_at ?? null);
  if (last != null) attrs.last_ci_ms = last;
  if (attempt.pr_merge_state) attrs.merge_state = attempt.pr_merge_state;
  return attrs;
}

function approvalAttrs(attempt: PipelineAttempt): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (attempt.pr_approved_at) attrs.approved_at = attempt.pr_approved_at;
  if (attempt.pr_approval_on_head != null) attrs.approval_on_head = attempt.pr_approval_on_head;
  if (attempt.pr_approvals_dismissed) attrs.approvals_dismissed = attempt.pr_approvals_dismissed;
  return attrs;
}

/**
 * Why an open PR with passing checks is not merged: one reason, the first
 * that holds. The base moving on comes first, because the update it needs
 * restarts CI and leaves the approval on an older commit.
 */
function openPrWait(
  attempt: PipelineAttempt
): { outcome: string; rule_id: string; message?: string | null; actor?: string | null } | null {
  const updates = branchUpdates(attempt);
  const after = updates ? ` (${plural(updates, "branch update")} so far)` : "";
  if (attempt.pr_merge_state === "BEHIND") {
    return {
      outcome: "behind_base",
      rule_id: "merge:behind-base",
      message: `The default branch moved on. The branch needs an update, and the update restarts CI${after}`,
    };
  }
  if (attempt.pr_approved_at && attempt.pr_approval_on_head === false) {
    return {
      outcome: "approval_stale",
      rule_id: "review:approval-not-on-head",
      message: `The approval is on an older commit than the head${after}`,
    };
  }
  if (attempt.pr_approvals_dismissed && attempt.pr_review !== "approved") {
    return {
      outcome: "approval_dismissed",
      rule_id: "review:approval-dismissed",
      message: `${plural(attempt.pr_approvals_dismissed, "approval")} dismissed${after}`,
    };
  }
  if (attempt.pr_merge_state === "DIRTY") {
    return { outcome: "conflict", rule_id: "merge:conflict", message: "The branch conflicts with the default branch" };
  }
  if (attempt.pr_review === "approved") {
    return {
      outcome: "approved",
      rule_id: "review:approved-not-merged",
      message: attempt.pr_merge_state ? `Approved; GitHub merge state ${attempt.pr_merge_state.toLowerCase()}` : null,
    };
  }
  if (attempt.pr_requested_reviewers?.length) {
    return { outcome: "awaiting_review", rule_id: "review:awaiting-reviewer", actor: attempt.pr_requested_reviewers.join(", ") };
  }
  if (attempt.pr_state === "draft") return { outcome: "draft", rule_id: "review:draft" };
  // Read, and empty: nobody was asked. (Undefined: the collector did not read reviewers.)
  if (Array.isArray(attempt.pr_requested_reviewers)) {
    return {
      outcome: "no_reviewer",
      rule_id: "review:no-reviewer-requested",
      message: attempt.pr_merge_state ? `GitHub merge state ${attempt.pr_merge_state.toLowerCase()}${after}` : null,
    };
  }
  return null;
}

/** Whether the module failed on the merge's own run, or passed then and broke later. */
function testsFailRule(attempt: PipelineAttempt): string {
  if (attempt.tests_first_status === "fail") return "tests:failed-at-merge";
  if (attempt.tests_first_status === "pass") return "tests:broke-after-merge";
  return "tests:fail-on-main";
}

function testsFailMessage(attempt: PipelineAttempt): string {
  if (attempt.tests_first_status === "fail") return "The first validation run on the default branch after the merge failed for this jurisdiction";
  if (attempt.tests_first_status === "pass") return "The first validation run after the merge passed; a later run on the default branch fails";
  return "The latest validation run on the default branch fails for this jurisdiction; the first run after the merge was not read";
}

/** One archived validator issue (handbook obs.jsonl: failure bundles and local A/B runs). */
export interface IssueObservation {
  src: string;
  run: string;
  citation: string;
  /** The encode-loop try, when the archive names it. */
  attempt?: number | null;
  /** Whether it is the final rejected candidate's issue. */
  final?: boolean;
  msg: string;
  lane?: string | null;
}

/**
 * Issue events from archived validator issues. Bundle issues land on their
 * dispatch (`case_id` = the GitHub run id); local A/B runs get their own
 * cases (`local:<run>`). `at` comes from the case's validate events when the
 * case is known, else from `fallbackAt` (the archive's own date).
 */
export function issueEvents(
  observations: IssueObservation[],
  cases: Map<string, { at: string; jurisdiction: string | null; lastTry: number | null; runUrl: string | null }>,
  fallbackAt: string
): PipelineEvent[] {
  const out: PipelineEvent[] = [];
  const seq = new Map<string, number>();
  for (const o of observations) {
    if (!o.msg) continue;
    const local = o.src.startsWith("ab");
    const caseId = local ? `local:${o.run}` : o.run;
    const known = cases.get(caseId);
    const tryNo = o.attempt ?? (o.final ? known?.lastTry ?? null : null);
    const key = `${caseId}/validate/issue/${tryNo ?? "f"}`;
    const n = seq.get(key) ?? 0;
    seq.set(key, n + 1);
    out.push({
      id: `${key}/${n}`,
      case_id: caseId,
      citation: o.citation,
      jurisdiction: known?.jurisdiction ?? o.citation.split("/")[0] ?? null,
      station: "validate",
      kind: "issue",
      at: known?.at ?? fallbackAt,
      duration_ms: null,
      outcome: "fail",
      try_no: tryNo,
      rule_id: issueRuleId(o.msg),
      message: clip(o.msg),
      actor: null,
      cost_usd: null,
      encoder_version: null,
      source: local ? "local_ab" : "failure_bundle",
      ref_url: local ? null : known?.runUrl ?? null,
      attrs: { final: Boolean(o.final), ...(o.lane ? { lane: o.lane } : {}), archive: o.src },
    });
  }
  return out;
}

/** Index cases by id for issueEvents: their first validate time, jurisdiction, last try and run page. */
export function caseIndex(events: PipelineEvent[]): Map<string, { at: string; jurisdiction: string | null; lastTry: number | null; runUrl: string | null }> {
  const index = new Map<string, { at: string; jurisdiction: string | null; lastTry: number | null; runUrl: string | null }>();
  for (const e of events) {
    const entry = index.get(e.case_id) ?? { at: e.at, jurisdiction: e.jurisdiction, lastTry: null, runUrl: null };
    if (e.station === "validate" && (e.kind === "fail" || e.kind === "leave")) {
      entry.at = e.at;
      if (e.try_no != null) entry.lastTry = Math.max(entry.lastTry ?? 0, e.try_no);
    }
    if (e.station === "dispatch" && e.ref_url) entry.runUrl = e.ref_url;
    index.set(e.case_id, entry);
  }
  return index;
}
