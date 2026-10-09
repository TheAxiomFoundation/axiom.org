import { Fragment } from "react";
import styles from "./run-timeline.module.css";
import { durationLabel } from "@/lib/axiom/encoding-pipeline";
import {
  shortDuration,
  type RunTimeline as Timeline,
  type TimelinePhase,
  type TimelineTool,
} from "@/lib/axiom/encoding-pipeline-runs";

/** A try's estimated cost: cents, or "<$0.01" below a cent. */
const cost = (usd: number | null) => (usd === null ? "" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);

/** The longest tools of a check phase, in a few words: "test cases 38m · compile 5m". */
const toolsText = (tools: TimelineTool[], most = 3) =>
  tools
    .filter((tool) => tool.name !== "other")
    .slice(0, most)
    .map((tool) => `${tool.label} ${shortDuration(tool.ms)}`)
    .join(" · ");

/** A phase's hover text: what it did, for how long, and a check phase's time by tool. */
const phaseTitle = (phase: TimelinePhase) =>
  [`${phase.label} · ${shortDuration(phase.ms)}`, ...phase.tools.map((tool) => `${tool.label} ${shortDuration(tool.ms)}`)].join("\n");

/** Axis steps, in minutes: the first that gives at most four ticks across the run. */
const TICK_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 720, 1440];

function ticks(scaleMs: number): number[] {
  const minutes = scaleMs / 60_000;
  const step = TICK_MINUTES.find((m) => minutes / m <= 4) ?? Math.ceil(minutes / 4);
  const out: number[] = [];
  for (let m = 0; m <= minutes; m += step) out.push(m * 60_000);
  return out;
}

/**
 * One run's timeline: the encode run as bars on one clock from the dispatch
 * (the wait for approval, setup, the encode loop, signing), what stopped it
 * if it stopped, and then the slower steps after the PR, each with the time
 * it took from the step before.
 */
export function RunTimeline({
  timeline,
  showStopped = true,
}: {
  timeline: Timeline;
  /** Repeat what stopped the run under its bars; off where the run's own line already says it. */
  showStopped?: boolean;
}) {
  const scale = Math.max(timeline.totalMs, 60_000);
  // The tries nest under the encode loop's bar, or under the run's one bar before its parts are recorded.
  // The encoder times each try's model call only; the rest of the loop is its checks and review.
  // Once the encoder times each try's phases, the tries draw on the run's clock and the split says
  // where the loop's time went; before that, the rest of the loop is one "checks and review" row.
  const split = timeline.split;
  const checksMs =
    split === null && timeline.loopMs !== null && timeline.modelMs !== null && timeline.loopMs > timeline.modelMs
      ? timeline.loopMs - timeline.modelMs
      : null;
  const lastBranch = checksMs === null && (split?.outsideMs ?? null) === null;
  const checkTools = split?.kinds.find((kind) => kind.kind === "checks")?.tools ?? [];
  const loopKey =
    ["encode", "run"].find((key) => timeline.bars.some((bar) => bar.key === key)) ?? timeline.bars.at(-1)?.key;
  const pct = (ms: number) => `${(ms / scale) * 100}%`;
  return (
    <div className={styles.timeline}>
      {timeline.bars.length > 0 && (
        <section aria-label="Encode run">
          <p className={styles.head}>
            {timeline.title}
            <strong>{shortDuration(timeline.totalMs)}</strong>
          </p>
          <div className={styles.row} aria-hidden>
            <span />
            <span />
            <span className={styles.track}>
              {ticks(scale).map((tick) => (
                <span key={tick} className={styles.tick} style={{ left: pct(tick) }}>
                  {tick === 0 ? "0" : durationLabel(tick)}
                </span>
              ))}
            </span>
          </div>
          <ol className={styles.list}>
            {timeline.bars.map((bar) => (
              <Fragment key={bar.key}>
                <li className={styles.row}>
                  <span className={styles.label}>{bar.label}</span>{" "}
                  <span className={styles.time}>{shortDuration(bar.ms)}</span>{" "}
                  <span className={styles.track}>
                    <span
                      className={styles.bar}
                      data-key={bar.key}
                      data-state={bar.state}
                      style={{ left: pct(bar.startMs), width: pct(bar.ms) }}
                    />
                  </span>
                </li>
                {/* Where the loop's time went: its shares as one bar under the loop's bar, then a legend. */}
                {bar.key === loopKey && split && (
                  <li className={`${styles.row} ${styles.compose}`}>
                    <span className={styles.composeLabel}>Where the time went</span>{" "}
                    <span />
                    <span className={styles.composeBody}>
                      <span className={styles.lane} aria-hidden>
                        {(() => {
                          const total = split.shares.reduce((sum, share) => sum + share.ms, 0);
                          let at = bar.startMs;
                          return split.shares.map((share) => {
                            const ms = total ? (bar.ms * share.ms) / total : 0;
                            const left = at;
                            at += ms;
                            return (
                              <span
                                key={share.key}
                                className={styles.segment}
                                data-kind={share.kind}
                                data-part={share.part ?? undefined}
                                style={{ left: pct(left), width: pct(ms) }}
                                title={`${share.label} · ${shortDuration(share.ms)}`}
                              />
                            );
                          });
                        })()}
                      </span>
                      <span className={styles.legend}>
                        {split.shares.map((share, i) => (
                          <Fragment key={share.key}>
                            {i > 0 && <span className={styles.sep}> · </span>}
                            <span className={styles.legendItem}>
                              <span
                                className={styles.swatch}
                                data-kind={share.kind}
                                data-part={share.part ?? undefined}
                                aria-hidden
                              />
                              {share.label} <strong>{shortDuration(share.ms)}</strong>
                            </span>
                          </Fragment>
                        ))}
                      </span>
                      {checkTools.length > 0 && (
                        <span className={styles.legendNote}>Checks by tool: {toolsText(checkTools, 4)}</span>
                      )}
                    </span>
                  </li>
                )}
                {/* The encode loop's tries, as its children: each try's time under the bars' times. */}
                {bar.key === loopKey && timeline.tries.length > 0 && (
                  <li className={styles.tries}>
                    <ol className={styles.triesList} aria-label="Inside the encode loop">
                      {timeline.tries.map((attempt, index) => {
                        const last = index === timeline.tries.length - 1;
                        const branch = last && lastBranch ? "└" : "├";
                        const stoppedRun = last && !attempt.ok && timeline.stopped !== null;
                        const result = (
                          <span className={styles.tryWhat}>
                            <span className={styles.tryCost}>{cost(attempt.cost)}</span>{" "}
                            <span
                              className={styles.tryResult}
                              title={
                                attempt.ok
                                  ? "The loop accepted this candidate; later checks can still fail the run."
                                  : (attempt.error ?? undefined)
                              }
                            >
                              {attempt.ok ? "accepted" : (attempt.headline ?? "failed")}
                              {stoppedRun && <span className={styles.tryStopped}> · stopped the run</span>}
                            </span>
                          </span>
                        );
                        const phased = attempt.wallMs !== null && attempt.phases.length > 0;
                        return (
                          <li key={attempt.attempt} className={styles.row} data-ok={attempt.ok}>
                            <span className={styles.tryWho}>
                              <span className={styles.tryBranch} aria-hidden>
                                {branch}
                              </span>
                              <span className={styles.tryNumber}>Try {attempt.attempt}</span>{" "}
                              <span className={styles.tryModel}>{attempt.model ?? "—"}</span>
                            </span>{" "}
                            {phased ? (
                              <>
                                <span
                                  className={styles.time}
                                  title={`The whole try, with its checks; the model wrote for ${
                                    attempt.ms === null ? "an untimed span" : shortDuration(attempt.ms)
                                  }`}
                                >
                                  {shortDuration(attempt.wallMs!)}
                                </span>{" "}
                                <span className={styles.tryTrack}>
                                  <span className={styles.lane}>
                                    {attempt.phases.map((phase, i) => (
                                      <span
                                        key={i}
                                        className={styles.segment}
                                        data-kind={phase.kind}
                                        data-part={phase.part ?? undefined}
                                        style={{ left: pct(phase.startMs), width: pct(phase.ms) }}
                                        title={phaseTitle(phase)}
                                      />
                                    ))}
                                  </span>
                                  {result}
                                </span>
                              </>
                            ) : (
                              <>
                                <span
                                  className={styles.time}
                                  title="The model's time for this try; its checks are in the row below"
                                >
                                  {attempt.ms === null ? "—" : shortDuration(attempt.ms)}
                                </span>{" "}
                                {result}
                              </>
                            )}
                          </li>
                        );
                      })}
                      {split && split.outsideMs !== null && (
                        <li className={`${styles.row} ${styles.triesRest}`}>
                          <span className={styles.tryWho}>
                            <span className={styles.tryBranch} aria-hidden>
                              └
                            </span>
                            <span>Outside the tries</span>
                          </span>{" "}
                          <span className={styles.time}>{shortDuration(split.outsideMs)}</span>{" "}
                          <span className={styles.triesNote}>
                            {split.outside.length
                              ? split.outside.map((part) => `${part.label} ${shortDuration(part.ms)}`).join(" · ")
                              : "the encode step's time before, between, and after the tries"}
                          </span>
                        </li>
                      )}
                      {checksMs !== null && (
                        <li className={`${styles.row} ${styles.triesRest}`}>
                          <span className={styles.tryWho}>
                            <span className={styles.tryBranch} aria-hidden>
                              └
                            </span>
                            <span>Checks and review</span>
                          </span>{" "}
                          <span className={styles.time}>{shortDuration(checksMs)}</span>{" "}
                          <span className={styles.triesNote}>
                            between and after the tries, not timed per try; with the tries&apos; model time (
                            {shortDuration(timeline.modelMs!)}) the loop&apos;s {shortDuration(timeline.loopMs!)}
                          </span>
                        </li>
                      )}
                    </ol>
                  </li>
                )}
              </Fragment>
            ))}
          </ol>
          {showStopped && timeline.stopped && <p className={styles.stopped}>{timeline.stopped}</p>}
        </section>
      )}
      {timeline.after.length > 0 && (
        <section aria-label="After the PR">
          <p className={styles.head}>After the PR</p>
          <ol className={styles.list}>
            {timeline.after.map((step) => (
              <li key={step.key} className={styles.row} data-state={step.state}>
                <span className={styles.label}>{step.label}</span>
                <span className={styles.time}>{step.ms === null ? "—" : shortDuration(step.ms)}</span>
                <span className={styles.detail}>
                  {step.href ? (
                    <a href={step.href} target="_blank" rel="noreferrer">
                      {step.detail}
                    </a>
                  ) : (
                    step.detail
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
