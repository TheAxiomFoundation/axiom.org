// Short-lived, bounded page-session cache. Share in-flight requests as well as
// successful responses; errors remain retryable and nothing persists to disk.
const cache = new Map<string, { expires: number; value?: unknown; pending?: Promise<unknown> }>();
const TTL = 5 * 60_000;
export function peekReader(url: string): unknown {
  const entry = cache.get(url);
  return entry && entry.expires > Date.now() ? entry.value : undefined;
}
export function readReader(url: string): Promise<unknown> {
  const entry = cache.get(url);
  if (entry && entry.expires > Date.now()) {
    if (entry.pending) return entry.pending;
    return Promise.resolve(entry.value);
  }
  const next: { expires: number; value?: unknown; pending?: Promise<unknown> } = { expires: Date.now() + TTL };
  next.pending = fetch(url, { signal: AbortSignal.timeout(20_000) }).then(async response => {
    if (!response.ok) throw new Error("Content unavailable");
    const value: unknown = await response.json();
    next.value = value;
    next.pending = undefined;
    next.expires = Date.now() + TTL;
    return value;
  }).catch(error => { if (cache.get(url) === next) cache.delete(url); throw error; });
  cache.delete(url);
  cache.set(url, next);
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  return next.pending;
}
export function clearReaderCache() { cache.clear(); }
