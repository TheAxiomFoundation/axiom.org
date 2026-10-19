/**
 * Best-effort per-instance rate limits (Fluid Compute reuses instances).
 * The page is behind a password, so the goal is only to blunt a stuck
 * loop or a curious guest from running up the model bill.
 */

const buckets = new Map<string, number[]>();

export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  if (buckets.size > 4096) buckets.clear();
  if (bucket.length >= max) {
    buckets.set(key, bucket);
    return true;
  }
  bucket.push(now);
  buckets.set(key, bucket);
  return false;
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Test hook. */
export function _resetRateLimits() {
  buckets.clear();
}
