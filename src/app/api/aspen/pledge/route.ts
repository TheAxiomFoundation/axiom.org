import { isUsState } from "@/lib/aspen/content";
import { apiAccess, json, readBody } from "@/lib/aspen/http";
import { clientIp, isRateLimited } from "@/lib/aspen/limit";
import { notifyPledge } from "@/lib/aspen/notify";
import { getStore, readControl } from "@/lib/aspen/store";
import { cleanText, clipText, isEmail, isUuid } from "@/lib/aspen/validate";

export const dynamic = "force-dynamic";

/**
 * The pledge: a follow-up request to the Axiom Foundation. Saved to the
 * pledges table (the only table with emails, which no results view reads)
 * and, when ASPEN_PLEDGE_WEBHOOK_URL is set, posted to that webhook.
 */
export async function POST(request: Request) {
  const { denied } = await apiAccess("participant");
  if (denied) return denied;
  if (isRateLimited(`pledge:${clientIp(request)}`, 10, 10 * 60_000)) {
    return json({ error: "Too many pledges from here. Wait a few minutes." }, 429);
  }
  const body = await readBody(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isEmail(email)) return json({ error: "Add an email so we can follow up." }, 400);
  const accurateAi = body?.accurateAi === true;
  const stateSystems = body?.stateSystems === true;
  if (!accurateAi && !stateSystems) {
    return json({ error: "Pick at least one conversation." }, 400);
  }

  const store = getStore();
  const control = await readControl(store);
  const row = {
    run_id: control.runId,
    participant_id: isUuid(body?.participantId) ? body.participantId : null,
    name: cleanText(body?.name, 120),
    title: cleanText(body?.title, 160),
    state: isUsState(body?.state) ? body.state : null,
    email,
    accurate_ai: accurateAi,
    state_systems: stateSystems,
    show_state: body?.showState !== false,
    note: clipText(body?.note, 1000),
  };

  let saved = false;
  if (store) {
    try {
      await store.insertPledge(row);
      saved = true;
    } catch (error) {
      console.error("[aspen] pledge save failed:", error);
    }
  }
  const notified = await notifyPledge(row);
  if (!saved && !notified) {
    return json({ error: "Your pledge didn't save. Please tell the Axiom team in the room." }, 502);
  }
  return json({ ok: true });
}
