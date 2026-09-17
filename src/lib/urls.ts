export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://axiom.org";

export const AXIOM_APP_URL =
  process.env.NEXT_PUBLIC_AXIOM_APP_URL ?? "https://axiom.org";

export function axiomAppHref(path = ""): string {
  const suffix = path.replace(/^\/+/, "");
  return suffix ? `/axiom/${suffix}` : "/axiom";
}
