import { permanentRedirect } from "next/navigation";
import { LEGACY_OPS_TABS, opsHref, type OpsTabId } from "@/lib/axiom/ops-href";

export const dynamic = "force-dynamic";

const TABS: OpsTabId[] = ["now", "line", "output", "programs"];

/**
 * The ops dashboard's old /axiom mount: the dashboard is /ops (the proxy
 * redirects there too on axiom.org). Its tab, old names included, lands in
 * one hop.
 */
export default async function AxiomOpsRedirect({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const asked = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = asked ? (LEGACY_OPS_TABS[asked] ?? (TABS.includes(asked as OpsTabId) ? (asked as OpsTabId) : "now")) : "now";
  permanentRedirect(opsHref(params, tab));
}
