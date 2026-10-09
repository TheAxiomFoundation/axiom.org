import { SignInForm } from "@/components/aspen/sign-in-form";
import { participantPassword, safeNext } from "@/lib/aspen/auth";

export const dynamic = "force-dynamic";

export default async function AspenSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; as?: string }>;
}) {
  const params = await searchParams;
  return (
    <SignInForm
      open={participantPassword() !== null}
      next={safeNext(params.next)}
      presenter={params.as === "presenter"}
    />
  );
}
