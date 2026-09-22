/** PROTOTYPE (suite-mock) display helpers. */
export function fmtNum(v: number | null | undefined, unit?: string | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  const s = abs >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs >= 100 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (!unit) return s;
  if (unit === "percent" || unit === "%" || unit === "percentage points") return `${s}${unit === "percentage points" ? " pp" : "%"}`;
  return `${s} ${unit}`;
}
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
