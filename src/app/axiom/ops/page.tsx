import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The ops dashboard's old /axiom mount: the dashboard is /ops (the proxy redirects there too on axiom.org). */
export default async function AxiomOpsRedirect({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries((await searchParams) ?? {})) {
    for (const v of Array.isArray(value) ? value : value == null ? [] : [value]) q.append(key, v);
  }
  const s = q.toString();
  permanentRedirect(s ? `/ops?${s}` : "/ops");
}
