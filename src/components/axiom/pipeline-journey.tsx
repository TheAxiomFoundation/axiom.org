import { ArrowLeft } from "lucide-react";
import dashboard from "./ops-dashboard.module.css";
import styles from "./pipeline-journey.module.css";
import { RunTimeline } from "./run-timeline";
import {
  ageLabel,
  attemptSource,
  attemptStage,
  attemptTime,
  dependentHostId,
  journeySteps,
  STAGE_COPY,
  stageSince,
  statusAttempt,
  type PipelineAttempt,
} from "@/lib/axiom/encoding-pipeline";
import { bundleHref, bundleProgram, membershipDetail, tiersLabel, type BundleMembership } from "@/lib/axiom/program-bundles";
import {
  hostLabel,
  OUTSIDE_LABEL,
  ownRecord,
  runRow,
  runTimeline,
  type RunRow,
  type TimelineDetails,
  type TimelineStep,
} from "@/lib/axiom/encoding-pipeline-runs";

/**
 * One citation's every attempt, each as the row of stages it reached: its
 * dispatches, its modules merged outside the pipeline, and the times the
 * encoder wrote it inside another citation's run.
 */
export function PipelineJourney({
  citation,
  attempts,
  available,
  bundles = [],
  hosts = {},
  referenceMs,
}: {
  citation: string | null;
  attempts: PipelineAttempt[];
  available: boolean;
  /** The program bundles whose documents hold this citation. */
  bundles?: BundleMembership[];
  /** The citation of each run a dependent attempt was encoded in, by run id. */
  hosts?: Record<string, string>;
  referenceMs: number;
}) {
  // The citation's status, as the pipeline counts it: a dispatch cancelled
  // before its encode job does not hide what the run before it did.
  const latest = statusAttempt(attempts);
  const stage = latest ? attemptStage(latest) : null;
  const passedOver = latest !== null && latest.id !== attempts[0]?.id;
  const hostMap = new Map(Object.entries(hosts));
  const dispatchCount = attempts.filter((attempt) => attemptSource(attempt) === "dispatch").length;

  return (
    <div className={`${dashboard.dashboard} min-h-screen pt-28 pb-16`}>
      <div className="max-w-[1100px] mx-auto px-5 md:px-10">
        <a href="/ops" className={styles.back}>
          <ArrowLeft size={13} aria-hidden /> Operations
        </a>
        <header className={dashboard.header}>
          <p className={dashboard.eyebrow}>Axiom / Operations / Journey</p>
          <h1 className={styles.title}>{citation ?? "No citation"}</h1>
          {latest && stage ? (
            <p className={styles.summary}>
              <span className={styles.stage}>{STAGE_COPY[stage].label}</span>
              {` for ${ageLabel(stageSince(latest, stage), referenceMs) ?? "a moment"}. `}
              {passedOver && "The latest dispatch was cancelled before its encode job started. "}
              {attemptCounts(attempts)}, the first {formatTime(attemptTime(attempts.at(-1)!))}.{" "}
              <a href={`/${citation}`}>Read the law</a>
            </p>
          ) : (
            <p className={styles.summary}>
              {!citation
                ? "Pick a citation from the pipeline on the operations page."
                : available
                  ? "No encoding has been recorded for this citation: no dispatch, no merge outside the pipeline, and no other citation's run."
                  : "The pipeline index is not available yet."}
            </p>
          )}
          {bundles.length > 0 && (
            <p className={styles.bundles}>
              Part of
              {bundles.map((membership) => (
                <a key={membership.bundle_id} href={bundleHref(membership.bundle_id)} title={membershipDetail(membership)}>
                  {bundleProgram(membership)} · {tiersLabel(membership)}
                  <span>{membership.tiers[0].document}</span>
                </a>
              ))}
            </p>
          )}
        </header>

        <ol className={styles.attempts}>
          {attempts.map((dispatch, index) => {
            // Only what the run did itself: an encoder record matched to a run that never encoded is another run's.
            const attempt = ownRecord(dispatch);
            const row = runRow(attempt, hostMap);
            // Dispatches are numbered among themselves, oldest first.
            const number = attempts.slice(index).filter((a) => attemptSource(a) === "dispatch").length;
            return (
              <li key={attempt.id} className={styles.attempt}>
                <div className={styles.attemptHead}>
                  <h2>
                    {row.source === "outside"
                      ? OUTSIDE_LABEL
                      : row.source === "dependent"
                        ? hostLabel(row.host)
                        : number === dispatchCount
                          ? "Latest dispatch"
                          : `Dispatch ${number}`}
                  </h2>
                  <AttemptMeta attempt={attempt} row={row} />
                </div>
                <div className={styles.runTimeline}>
                  <RunTimeline timeline={runTimeline(row, referenceMs, journeyDetails(attempt))} />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** "3 dispatches, 1 merge outside the pipeline, 2 encodings in another citation's run". */
function attemptCounts(attempts: PipelineAttempt[]): string {
  const count = (source: ReturnType<typeof attemptSource>) => attempts.filter((a) => attemptSource(a) === source).length;
  const dispatches = count("dispatch");
  const outside = count("outside");
  const dependent = count("dependent");
  return [
    dispatches || (!outside && !dependent) ? `${dispatches} dispatch${dispatches === 1 ? "" : "es"}` : null,
    outside ? `${outside} ${outside === 1 ? "merge" : "merges"} outside the pipeline` : null,
    dependent ? `${dependent} ${dependent === 1 ? "encoding" : "encodings"} in another citation's run` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * When an attempt happened and where to look: its run, its PR and author, or
 * the run it was encoded in with how the module came out of it.
 */
function AttemptMeta({ attempt, row }: { attempt: PipelineAttempt; row: RunRow }) {
  const cost = attempt.cost_usd != null ? ` · $${Number(attempt.cost_usd).toFixed(2)}` : "";
  const source = attemptSource(attempt);
  const host = row.host;
  if (source === "outside") {
    return (
      <span>
        merged {formatTime(attemptTime(attempt))} ·{" "}
        <a href={attempt.pr_url ?? attempt.run_url} target="_blank" rel="noreferrer">
          {attempt.pr_repo && attempt.pr_number ? `${attempt.pr_repo}#${attempt.pr_number}` : "PR"}
        </a>
        {attempt.dispatched_by && ` · by ${attempt.dispatched_by}`}
      </span>
    );
  }
  if (source === "dependent") {
    return (
      <span>
        {formatTime(attempt.dispatched_at)} ·{" "}
        <a href={attempt.run_url} target="_blank" rel="noreferrer">
          run {host?.id ?? dependentHostId(attempt)}
        </a>
        {` · ${row.outcomeLabel}`}
        {cost}
      </span>
    );
  }
  return (
    <span>
      {formatTime(attempt.dispatched_at)} ·{" "}
      <a href={attempt.run_url} target="_blank" rel="noreferrer">
        {attempt.id.startsWith("pr:") ? "PR" : `run ${attempt.id}`}
      </a>
      {cost}
    </span>
  );
}

const STEP_STATE: Record<"done" | "active" | "failed" | "pending", TimelineStep["state"]> = {
  done: "done",
  active: "waiting",
  failed: "failed",
  pending: "waiting",
};

/**
 * What the journey knows beyond a run row, for its timeline: the full
 * failure text, the PR's checks and review and the branch it merged into,
 * the modules indexed, and, after the tests on main, the compile sweep and
 * the oracle comparison.
 */
function journeyDetails(attempt: PipelineAttempt): TimelineDetails {
  const steps = Object.fromEntries(journeySteps(attempt).map((step) => [step.key, step]));
  const review = [steps.pr.detail, steps.merged.detail].filter(Boolean).join(" · ");
  return {
    stopped: steps.encoded.state === "failed" ? steps.encoded.detail : null,
    review: review || null,
    index: steps.indexed.detail,
    extra: [steps.compiled, steps.oracle]
      .filter((step) => step.state !== "pending" || step.detail)
      .map((step) => ({
        key: step.key,
        label: step.label,
        ms: null,
        at: step.at,
        state: STEP_STATE[step.state],
        detail: step.detail,
        href: step.href,
      })),
  };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}
