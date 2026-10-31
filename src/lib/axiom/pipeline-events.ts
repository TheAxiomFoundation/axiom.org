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

import { attemptSource, failedStepStation, mainMergedAt, type PipelineAttempt } from "./encoding-pipeline";

export type EventKind = "enter" | "leave" | "fail" | "cancel" | "wait" | "issue" | "change";

export type EventSource = "pipeline_attempts" | "failure_bundle" | "local_ab" | "encoder" | "waiver_ledger" | "encoder_change";

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
    ev({ station: "dispatch", kind: "leave", at: attempt.dispatched_at, outcome: "ok", actor: attempt.dispatched_by ?? null, ref_url: runUrl, duration_ms: 0 });

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
    if (setupMs != null || attempt.tries?.length || attempt.encode_seconds != null || attempt.pr_created_at) {
      ev({ station: "setup", kind: "leave", at: encodeFrom, outcome: "ok", duration_ms: setupMs, attrs: setupMs == null ? { untimed: true } : {} });
    } else if (!finished) {
      return events;
    }
  }

  // A module written inside another citation's run (dependent) has its own
  // encode loop; a module merged outside the pipeline starts at its PR.
  if (kindSource !== "outside") {
    // The encode loop: one generate and one validate per try.
    const tries = [...(attempt.tries ?? [])].sort((a, b) => a.attempt - b.attempt);
    let clock = encodeFrom;
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
            attrs: { phases: tools, ...untimed },
          });
        }
        clock = valEnd;
      }
    } else if (attempt.encode_seconds != null || failedAt === "validate" || attempt.pr_created_at) {
      // No per-try record (runs before the encoder synced its tries): the
      // encode step as one generate and one validate.
      const encodeMs = attempt.encode_seconds != null ? attempt.encode_seconds * 1000 : null;
      ev({ station: "generate", kind: "enter", at: encodeFrom, try_no: attempt.generation_attempts ?? null });
      ev({ station: "generate", kind: "leave", at: encodeFrom, outcome: "ok", try_no: attempt.generation_attempts ?? null, attrs: { untimed: true } });
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
      if (finished) {
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

  if (prAt) {
    // PR checks.
    ev({ station: "pr_checks", kind: "enter", at: prAt });
    const merged = attempt.pr_state === "merged";
    if (attempt.pr_checks === "failure") {
      const checks = attempt.pr_failed_checks ?? [];
      ev({
        station: "pr_checks",
        kind: merged ? "wait" : "fail",
        at: prAt,
        outcome: "fail",
        rule_id: checks.length ? `check:${checks[0]}` : "check:unknown",
        message: clip(attempt.pr_check_error),
        ref_url: attempt.pr_check_job_id && attempt.pr_repo ? `${prUrl}/checks?check_run_id=${attempt.pr_check_job_id}` : prUrl,
        attrs: checks.length > 1 ? { failed_checks: checks } : {},
      });
      if (!merged) return;
    }
    if (attempt.pr_checks === "pending" && !merged) return;
    if (attempt.pr_state === "closed" && attempt.pr_checks !== "success") {
      // Closed with checks not passing: the time to the close is not check time.
      ev({ station: "pr_checks", kind: "cancel", at: attempt.pr_closed_at ?? prAt, outcome: "closed", ref_url: prUrl, attrs: { untimed: true } });
      return;
    }
    // The rollup has no finish time: untimed.
    ev({ station: "pr_checks", kind: "leave", at: prAt, outcome: "ok", ref_url: prUrl, attrs: { untimed: true } });

    // Review and merge decision.
    ev({ station: "review", kind: "enter", at: prAt });
    if (attempt.pr_review === "changes_requested") {
      ev({ station: "review", kind: "wait", at: prAt, outcome: "changes_requested", rule_id: "review:changes-requested", ref_url: prUrl });
    }
    if (attempt.pr_state === "closed") {
      ev({ station: "review", kind: "fail", at: attempt.pr_closed_at ?? prAt, outcome: "closed", rule_id: "review:closed-unmerged", duration_ms: spanMs(prAt, attempt.pr_closed_at), ref_url: prUrl });
      return;
    }
    if (!merged) {
      if (attempt.pr_requested_reviewers?.length) {
        ev({ station: "review", kind: "wait", at: prAt, outcome: "awaiting_review", rule_id: "review:awaiting-reviewer", actor: attempt.pr_requested_reviewers.join(", "), ref_url: prUrl });
      }
      return;
    }
    ev({ station: "review", kind: "leave", at: attempt.pr_merged_at!, outcome: "ok", duration_ms: spanMs(prAt, attempt.pr_merged_at), ref_url: prUrl });
  }

  // Merge into the default branch (directly, or through a side branch's PR).
  const mergedAt = mainMergedAt(attempt);
  const mergeEnter = attempt.pr_merged_at ?? attempt.finished_at;
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
  // The merged module files: the accepted-module count keys on them.
  ev({
    station: "merge",
    kind: "leave",
    at: mergedAt,
    outcome: "ok",
    duration_ms: spanMs(mergeEnter, mergedAt),
    ref_url: attempt.pr_via_url ?? prUrl,
    attrs: { repo: attempt.pr_repo, modules: attempt.module_paths ?? [] },
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
      rule_id: ok ? null : "tests:fail-on-main",
      duration_ms: attempt.tests_first_at ? spanMs(mergedAt, testsAt) : null,
      ref_url: attempt.tests_run_url ?? attempt.tests_first_run_url ?? null,
      attrs: attempt.tests_first_at ? {} : { untimed: true, read_time: true },
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
