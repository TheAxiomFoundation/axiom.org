import { runtimeProxyGet } from "./api";
type Result = Awaited<ReturnType<typeof runtimeProxyGet>>;
const cache = new Map<string, { result: Result; expires: number; bytes: number }>();
const pending = new Map<string, Promise<Result>>();
const MAX_BYTES = 24 * 1024 * 1024;
export function clearComposeCache() { cache.clear(); pending.clear(); }
export function cachedCompose(focus: string): Promise<Result> {
  const cached = cache.get(focus);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.result);
  cache.delete(focus);
  const existing = pending.get(focus);
  if (existing) return existing;
  const request = runtimeProxyGet(`/graph/compose?focus=${encodeURIComponent(focus)}`, { timeoutMs: 20000, fresh: true }).then(result => {
    if (result.status >= 200 && result.status < 300) {
      const bytes = JSON.stringify(result.body).length * 2;
      if (bytes <= MAX_BYTES) {
        let used = [...cache.values()].reduce((sum, item) => sum + item.bytes, 0);
        while (cache.size && (used + bytes > MAX_BYTES || cache.size >= 100)) {
          const first = cache.keys().next().value!;
          used -= cache.get(first)!.bytes;
          cache.delete(first);
        }
        cache.set(focus, { result, bytes, expires: Date.now() + 300000 });
      }
    }
    return result;
  }).finally(() => pending.delete(focus));
  pending.set(focus, request);
  return request;
}
