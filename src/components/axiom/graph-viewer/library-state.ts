export type RecentView = "read" | "structure" | "map";
export type RecentRule = { target: string; selection: string; view: RecentView; title: string; visitedAt: number };
export type RunCapability = { available: boolean; checkedAt: number };
export const LIBRARY_EVENT = "axiom:library-updated";
const RECENT_KEY = "axiom-library-recent-v1";
const RUN_KEY = "axiom-library-runs-v1";
const validTarget = (value: unknown): value is string => typeof value === "string" && /^[a-z]{2}(?:-[a-z0-9]+)?:(statutes|regulations|policies|guidance|bills|manual)\//.test(value);

function read(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) ?? "null"); } catch { return null; }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new Event(LIBRARY_EVENT)); } catch { /* Browsing works without storage. */ }
}
export function readRecentRules(): RecentRule[] {
  const value = read(RECENT_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RecentRule => item && validTarget(item.target) && typeof item.selection === "string" && typeof item.title === "string" && item.title.length < 500 && Number.isFinite(item.visitedAt) && ["read", "structure", "map"].includes(item.view)).slice(0, 6);
}
export function rememberRule(item: Omit<RecentRule, "visitedAt">) {
  if (!validTarget(item.target)) return;
  write(RECENT_KEY, [{ ...item, visitedAt: Date.now() }, ...readRecentRules().filter((entry) => entry.target !== item.target)].slice(0, 6));
}
export function readRunCapabilities(): Record<string, RunCapability> {
  const value = read(RUN_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([target, item]) => validTarget(target) && item && typeof item.available === "boolean" && Number.isFinite(item.checkedAt) && item.checkedAt <= Date.now() && Date.now() - item.checkedAt < 86400000));
}
export function rememberRunCapability(target: string, available: boolean) {
  if (validTarget(target)) write(RUN_KEY, { ...readRunCapabilities(), [target]: { available, checkedAt: Date.now() } });
}
