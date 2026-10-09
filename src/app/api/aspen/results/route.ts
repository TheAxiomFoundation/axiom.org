import { apiAccess, json } from "@/lib/aspen/http";
import { EMPTY_SUMMARY, summarizeRun } from "@/lib/aspen/results";
import { getStore, readControl } from "@/lib/aspen/store";
import { isRunId } from "@/lib/aspen/validate";

export const dynamic = "force-dynamic";

/** The room's aggregated results for the active run (presenters may name another run). */
export async function GET(request: Request) {
  const { access, denied } = await apiAccess("participant");
  if (denied) return denied;
  const store = getStore();
  const control = await readControl(store);
  const asked = new URL(request.url).searchParams.get("run");
  const runId = access.presenter && isRunId(asked) ? asked : control.runId;
  if (!store) return json({ runId, live: false, summary: EMPTY_SUMMARY });
  try {
    return json({ runId, live: true, summary: summarizeRun(await store.loadRun(runId)) });
  } catch (error) {
    console.error("[aspen] results read failed:", error);
    return json({ runId, live: false, summary: EMPTY_SUMMARY });
  }
}
