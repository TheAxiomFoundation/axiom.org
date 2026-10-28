import { isStageId } from "@/lib/aspen/content";
import { apiAccess, json, readBody } from "@/lib/aspen/http";
import { getStore, readControl, writeControl } from "@/lib/aspen/store";
import { isRunId } from "@/lib/aspen/validate";

export const dynamic = "force-dynamic";

/** The live stage and run, polled by every phone in the room. */
export async function GET() {
  const { denied } = await apiAccess("participant");
  if (denied) return denied;
  return json(await readControl(getStore()));
}

/**
 * Presenters move the room to a stage, or start a new run (e.g. after a
 * rehearsal). `inRun`, the run the presenter made the move in, keeps a move
 * that arrives after a run switch out of the new run (store.ts setControl).
 */
export async function POST(request: Request) {
  const { denied } = await apiAccess("presenter");
  if (denied) return denied;
  const store = getStore();
  if (!store) return json({ error: "No store is configured, so the room can't sync." }, 503);
  const body = await readBody(request);
  const stage = isStageId(body?.stage) ? body.stage : undefined;
  const runId = isRunId(body?.runId) ? body.runId : undefined;
  const inRun = isRunId(body?.inRun) ? body.inRun : undefined;
  if (!stage && !runId) return json({ error: "Send a stage or a runId." }, 400);
  try {
    return json(await writeControl(store, { stage, runId, inRun }));
  } catch (error) {
    console.error("[aspen] control write failed:", error);
    return json({ error: "The stage did not save." }, 502);
  }
}
