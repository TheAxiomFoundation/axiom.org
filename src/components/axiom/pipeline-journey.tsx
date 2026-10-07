import { ArrowLeft } from "lucide-react";
import dashboard from "./ops-dashboard.module.css";
import styles from "./pipeline-journey.module.css";
import { RunTimeline } from "./run-timeline";
import {
  ageLabel,
  attemptStage,
  journeySteps,
  STAGE_COPY,
  stageSince,
  type PipelineAttempt,
} from "@/lib/axiom/encoding-pipeline";
import { bundleProgram, membershipDetail, tiersLabel, type BundleMembership } from "@/lib/axiom/program-bundles";
import {
  runRow,
  runTimeline,
  type TimelineDetails,
  type TimelineStep,
} from "@/lib/axiom/encoding-pipeline-runs";

/** One citation's every dispatch, each as the row of stages it reached. */
export function PipelineJourney({
  citation,
  attempts,
  available,
  bundles = [],
  referenceMs,
}: {
  citation: string | null;
  attempts: PipelineAttempt[];
  available: boolean;
  /** The program bundles whose documents hold this citation. */
  bundles?: BundleMembership[];
  referenceMs: number;
}) {
  const latest = attempts[0] ?? null;
  const stage = latest ? attemptStage(latest) : null;

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
              {attempts.length} dispatch{attempts.length === 1 ? "" : "es"}, the first{" "}
              {formatTime(attempts.at(-1)!.dispatched_at)}.{" "}
              <a href={`/${citation}`}>Read the law</a>
            </p>
          ) : (
            <p className={styles.summary}>
              {!citation
                ? "Pick a citation from the pipeline on the operations page."
                : available
                  ? "No targeted re-encode dispatch has been recorded for this citation."
                  : "The pipeline index is not available yet."}
            </p>
          )}
          {bundles.length > 0 && (
            <p className={styles.bundles}>
              Part of
              {bundles.map((membership) => (
                <a key={membership.bundle_id} href={`/ops/bundles/${membership.bundle_id}`} title={membershipDetail(membership)}>
                  {bundleProgram(membership)} · {tiersLabel(membership)}
                  <span>{membership.tiers[0].document}</span>
                </a>
              ))}
            </p>
          )}
        </header>

        <ol className={styles.attempts}>
          {attempts.map((attempt, index) => (
            <li key={attempt.id} className={styles.attempt}>
              <div className={styles.attemptHead}>
                <h2>
                  {index === 0 ? "Latest dispatch" : `Dispatch ${attempts.length - index}`}
                </h2>
                <span>
                  {formatTime(attempt.dispatched_at)} ·{" "}
                  <a href={attempt.run_url} target="_blank" rel="noreferrer">
                    {attempt.id.startsWith("pr:") ? "PR" : `run ${attempt.id}`}
                  </a>
                  {attempt.cost_usd != null && ` · $${Number(attempt.cost_usd).toFixed(2)}`}
                </span>
              </div>
              <div className={styles.runTimeline}>
                <RunTimeline timeline={runTimeline(runRow(attempt), referenceMs, journeyDetails(attempt))} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
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
