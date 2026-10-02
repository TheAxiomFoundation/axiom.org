/**
 * Whether /ops shows the encoding pipeline section, and /ops/journey its
 * per-citation pages. Hidden on the public production site while the
 * section is made easier to read; shown in local development and on Vercel
 * preview deployments, or in production once OPS_PIPELINE_PUBLIC=1 is set.
 * The collector keeps running either way, so nothing is lost while hidden.
 */
export function opsPipelineVisible(env: Record<string, string | undefined> = process.env): boolean {
  if (env.OPS_PIPELINE_PUBLIC === "1") return true;
  return env.VERCEL_ENV !== "production";
}
