/**
 * Best-effort abuse protection for the public telemetry ingest endpoint.
 * Per-instance state (Fluid Compute reuses instances), not a distributed
 * limiter — the goal is blunting accidental loops and casual abuse. A
 * machine legitimately runs a handful of encodes at once (one start +
 * two heartbeats per run per minute), so the ceiling is generous.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const rateBuckets = new Map<string, number[]>();

/** Test hook: module-level state must reset between tests. */
export function _resetIngestRouteState() {
  rateBuckets.clear();
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(key) ?? []).filter(
    (at) => now - at < RATE_LIMIT_WINDOW_MS
  );
  if (rateBuckets.size > 1024) rateBuckets.clear();
  if (bucket.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateBuckets.set(key, bucket);
    return true;
  }
  bucket.push(now);
  rateBuckets.set(key, bucket);
  return false;
}
