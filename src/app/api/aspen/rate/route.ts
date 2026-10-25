import { POST_CHECK, RESIDENT_ACTIONS, VERDICTS, WENT_WELL, WENT_WRONG, WOULD_ACT } from "@/lib/aspen/content";
import { apiAccess, json, readBody } from "@/lib/aspen/http";
import { isRateLimited } from "@/lib/aspen/limit";
import { getStore } from "@/lib/aspen/store";
import { cleanChoice, cleanChoices, cleanRev, clipText, isUuid } from "@/lib/aspen/validate";

export const dynamic = "force-dynamic";

const ids = <T extends { id: string }>(options: readonly T[]) => options.map((o) => o.id);

/**
 * A participant's rating of one answer, or (with postCheck) their verdict
 * after seeing what the rules said. Only the participant who asked can rate.
 */
export async function POST(request: Request) {
  const { denied } = await apiAccess("participant");
  if (denied) return denied;
  const body = await readBody(request);
  const participantId = body?.participantId;
  const promptId = body?.promptId;
  if (!isUuid(participantId) || !isUuid(promptId)) return json({ error: "Missing answer." }, 400);
  if (isRateLimited(`rate:${participantId}`, 60, 10 * 60_000)) {
    return json({ error: "Too many ratings. Wait a moment." }, 429);
  }

  const postCheck = cleanChoice(body?.postCheck, ids(POST_CHECK));
  // The page stamps each rating at the tap; a stamped rating saves only over an older one. A page
  // too old to stamp saves on arrival at the server's time, as before. It reads only the HTTP
  // status: a refusal in the body would look saved to it, and one by status could only show its
  // general error, never ask for a reload. Its stamp then holds off a phone tap stamped before
  // it, which the phone shows as not saved, until the phone's clock passes it.
  const rev = cleanRev(body?.rev);
  const ratedAt = new Date(rev ?? Date.now()).toISOString();
  const patch = postCheck
    ? { post_check_verdict: postCheck }
    : {
        rated_at: ratedAt,
        verdict: cleanChoice(body?.verdict, ids(VERDICTS)),
        would_act: cleanChoice(body?.wouldAct, ids(WOULD_ACT)),
        resident_action: cleanChoice(body?.residentAction, ids(RESIDENT_ACTIONS)),
        went_well: cleanChoices(body?.wentWell, WENT_WELL),
        went_wrong: cleanChoices(body?.wentWrong, WENT_WRONG),
        rating_note: clipText(body?.note, 1000),
      };
  if (!postCheck && !patch.verdict && !patch.would_act) {
    return json({ error: "Pick at least one answer." }, 400);
  }

  const store = getStore();
  if (!store) return json({ ok: true, saved: false });
  try {
    const saved = await store.updatePrompt(promptId, participantId, patch, !postCheck && rev ? ratedAt : undefined);
    return json({ ok: true, saved });
  } catch (error) {
    console.error("[aspen] rating save failed:", error);
    return json({ ok: true, saved: false });
  }
}
