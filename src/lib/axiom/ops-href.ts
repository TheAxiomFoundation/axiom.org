/** The /ops tabs, as their `?tab=` values ("now" has none). */
export type OpsTabId = "now" | "line" | "programs";

/** Retired tabs, and the tab that took each over (Output's counts are in /api/ops/flow?accepted). */
export const LEGACY_OPS_TABS: Record<string, OpsTabId> = { ledger: "now", pipeline: "line", bundles: "programs", output: "now" };

/** An /ops address on `tab`, every other query parameter kept in order. */
export function opsHref(params: Record<string, string | string[] | undefined>, tab: OpsTabId): string {
  const q = new URLSearchParams();
  if (tab !== "now") q.set("tab", tab);
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || value == null) continue;
    for (const v of Array.isArray(value) ? value : [value]) q.append(key, v);
  }
  const s = q.toString();
  return s ? `/ops?${s}` : "/ops";
}

/** The query parameters every /ops tab shares: the jurisdiction scope and the line's window. */
export const SHARED_OPS_PARAMS = ["j", "only", "window"] as const;

/** The shared parameters of an address, for the tab links to carry. */
export function sharedOpsParams(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SHARED_OPS_PARAMS) {
    const value = params[key];
    const v = Array.isArray(value) ? value[0] : value;
    if (v) out[key] = v;
  }
  return out;
}

/** The busiest root jurisdictions (`us-co` → `us`), most first: the scope choices. */
export function busiestRoots(jurisdictions: Array<string | null>, limit = 6): string[] {
  const roots = new Map<string, number>();
  for (const j of jurisdictions) {
    if (!j) continue;
    const root = j.split("-")[0];
    roots.set(root, (roots.get(root) ?? 0) + 1);
  }
  return [...roots.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([j]) => j);
}
