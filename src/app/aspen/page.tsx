import { AspenApp } from "@/components/aspen/aspen-app";
import { requireAccess } from "@/lib/aspen/server";

export const dynamic = "force-dynamic";

export default async function AspenPage() {
  await requireAccess("participant", "/aspen");
  return <AspenApp />;
}
