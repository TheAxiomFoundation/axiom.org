/** The /ops tabs, as their `?tab=` values ("now" has none). */
export type OpsTabId = "now" | "line" | "output" | "programs";

/** The tabs before the four-tab layout, and the tab that took each over. */
export const LEGACY_OPS_TABS: Record<string, OpsTabId> = { ledger: "now", pipeline: "line", bundles: "programs" };

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
