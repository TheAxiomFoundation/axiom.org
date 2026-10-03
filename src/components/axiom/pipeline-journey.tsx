import { ArrowLeft, Check, Circle, Dot, X } from "lucide-react";
import dashboard from "./ops-dashboard.module.css";
import styles from "./pipeline-journey.module.css";
import {
  ageLabel,
  attemptStage,
  journeySteps,
  STAGE_COPY,
  stageSince,
  type JourneyStep,
  type PipelineAttempt,
} from "@/lib/axiom/encoding-pipeline";

/** One citation's every dispatch, each as the row of stages it reached. */
export function PipelineJourney({
  citation,
  attempts,
  available,
  referenceMs,
}: {
  citation: string | null;
  attempts: PipelineAttempt[];
  available: boolean;
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
              <ol className={styles.steps}>
                {journeySteps(attempt).map((step) => (
                  <Step key={step.key} step={step} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const STATE_ICON = {
  done: Check,
  active: Dot,
  failed: X,
  pending: Circle,
} as const;

const STATE_TEXT = {
  done: "done",
  active: "in progress",
  failed: "stopped here",
  pending: "not reached",
} as const;

function Step({ step }: { step: JourneyStep }) {
  const Icon = STATE_ICON[step.state];
  return (
    <li className={styles.step} data-state={step.state}>
      <span className={styles.marker}>
        <Icon size={12} strokeWidth={2.5} aria-hidden />
        <span className="sr-only">{STATE_TEXT[step.state]}</span>
      </span>
      <div className={styles.stepBody}>
        <p className={styles.stepLabel}>
          {step.href ? (
            <a href={step.href} target="_blank" rel="noreferrer">
              {step.label}
            </a>
          ) : (
            step.label
          )}
        </p>
        {step.at && step.state !== "pending" && (
          <p className={styles.stepTime}>{formatTime(step.at)}</p>
        )}
        {step.detail && <p className={styles.stepDetail}>{step.detail}</p>}
      </div>
    </li>
  );
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
