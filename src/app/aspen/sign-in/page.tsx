import { redirect } from "next/navigation";
import { SignInForm } from "@/components/aspen/sign-in-form";
import { participantPassword, safeNext } from "@/lib/aspen/auth";
import { getAccess } from "@/lib/aspen/server";

export const dynamic = "force-dynamic";

export default async function AspenSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; as?: string }>;
}) {
  const params = await searchParams;
  const presenter = params.as === "presenter";
  const next = safeNext(params.next);
  // Someone already signed in (e.g. coming back with the Back button) goes straight on.
  const access = await getAccess();
  if (presenter ? access.presenter : access.participant) redirect(next);
  return <SignInForm open={participantPassword() !== null} next={next} presenter={presenter} />;
}
