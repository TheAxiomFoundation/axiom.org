import { PresenterApp } from "@/components/aspen/presenter-app";
import { participantPassword } from "@/lib/aspen/auth";
import { requireAccess } from "@/lib/aspen/server";

export const dynamic = "force-dynamic";

export default async function AspenPresenterPage() {
  await requireAccess("presenter", "/aspen/present");
  // Shown on the big screen so the room can sign in; only presenters load this page.
  return <PresenterApp joinPassword={participantPassword()} />;
}
