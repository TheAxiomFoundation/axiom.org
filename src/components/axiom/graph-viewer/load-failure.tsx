import { useEffect, useState } from "react";
import type { LoadFailure } from "./api";

/** Seconds to wait before retry number `attempt` (0 = the first retry). The
 *  first retry is immediate; repeated ones wait 2, 4, 8, 16, then 30 s, so a
 *  visitor who keeps pressing Retry does not add load to a service that is
 *  already down. */
export function retryDelaySeconds(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(30, 2 ** attempt);
}

const TITLES: Record<LoadFailure["kind"], string> = {
  unavailable: "Temporarily unavailable",
  not_found: "Not available",
  client: "This could not be loaded",
  unknown: "Something went wrong",
};

/**
 * A failed load, said calmly. The visitor reads a plain sentence and a
 * Retry button; the status, error code and request id stay in one small
 * reference line for support. A response body is never rendered.
 */
export function LoadFailureNotice({
  failure,
  attempt,
  onRetry,
}: {
  failure: LoadFailure;
  /** Retries already made for this failure. */
  attempt: number;
  onRetry: () => void;
}) {
  const [remaining, setRemaining] = useState(() => retryDelaySeconds(attempt));
  useEffect(() => {
    setRemaining(retryDelaySeconds(attempt));
  }, [attempt, failure]);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  const unavailable = failure.kind === "unavailable";
  return (
    <div
      className={`status ${unavailable ? "unavailable" : "error"}`}
      role={unavailable ? "status" : "alert"}
    >
      <strong className="status-title">{TITLES[failure.kind]}</strong>
      <span className="status-message">{failure.message}</span>
      <button
        type="button"
        className="status-retry"
        disabled={remaining > 0}
        onClick={onRetry}
      >
        {remaining > 0 ? `Retry in ${remaining} s` : "Retry"}
      </button>
      {failure.reference && (
        <small className="status-reference">Reference for support: {failure.reference}</small>
      )}
    </div>
  );
}
