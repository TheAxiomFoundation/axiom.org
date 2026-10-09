import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accessFromCookies, type Access } from "./auth";

/** The current request's access, from its cookies. */
export async function getAccess(): Promise<Access> {
  const jar = await cookies();
  return accessFromCookies((name) => jar.get(name)?.value);
}

/**
 * Gate for /aspen pages: sends a visitor without the right cookie to the
 * sign-in page, which returns them to `nextPath` afterwards.
 */
export async function requireAccess(kind: "participant" | "presenter", nextPath: string): Promise<Access> {
  const access = await getAccess();
  const allowed = kind === "presenter" ? access.presenter : access.participant;
  if (!allowed) {
    const params = new URLSearchParams({ next: nextPath });
    if (kind === "presenter") params.set("as", "presenter");
    redirect(`/aspen/sign-in?${params.toString()}`);
  }
  return access;
}
