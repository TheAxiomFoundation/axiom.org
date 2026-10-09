import type { PledgeRow } from "./types";

/** One plain line per pledge, for a Slack-style incoming webhook. */
export function pledgeMessage(row: Omit<PledgeRow, "id">): string {
  const who = [row.name, row.title, row.state].filter(Boolean).join(", ") || "Someone";
  const wants = [
    row.accurate_ai ? "accurate AI" : null,
    row.state_systems ? "state systems" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const note = row.note ? ` Note: "${row.note}"` : "";
  return `Aspen pledge (${row.run_id}): ${who} <${row.email}> wants to talk about ${wants}.${note}`;
}

/**
 * Posts the pledge to ASPEN_PLEDGE_WEBHOOK_URL when it is set. Returns
 * whether a webhook accepted it; a failure is logged, never thrown.
 */
export async function notifyPledge(
  row: Omit<PledgeRow, "id">,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = process.env.ASPEN_PLEDGE_WEBHOOK_URL?.trim();
  if (!url) return false;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pledgeMessage(row) }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch (error) {
    console.error("[aspen] pledge webhook failed:", error);
    return false;
  }
}
