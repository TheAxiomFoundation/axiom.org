import styles from "./run-timeline.module.css";
import { durationLabel } from "@/lib/axiom/encoding-pipeline";
import { shortDuration, type RunTimeline as Timeline } from "@/lib/axiom/encoding-pipeline-runs";

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
export function RunTimeline({ timeline }: { timeline: Timeline }) {
  const scale = Math.max(timeline.totalMs, 60_000);
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
              <li key={bar.key} className={styles.row}>
                <span className={styles.label}>{bar.label}</span>
                <span className={styles.time}>{shortDuration(bar.ms)}</span>
                <span className={styles.track}>
                  <span
                    className={styles.bar}
                    data-key={bar.key}
                    data-state={bar.state}
                    style={{ left: pct(bar.startMs), width: pct(bar.ms) }}
                  />
                </span>
              </li>
            ))}
          </ol>
          {timeline.stopped && <p className={styles.stopped}>Stopped: {timeline.stopped}</p>}
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
