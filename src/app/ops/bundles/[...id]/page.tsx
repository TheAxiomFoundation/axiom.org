import { notFound, permanentRedirect } from "next/navigation";
import { opsPipelineVisible } from "@/lib/axiom/ops-pipeline-visibility";
import { bundleHref } from "@/lib/axiom/program-bundles";

export const dynamic = "force-dynamic";

/** A bundle opens in the /ops "Program bundles" tab; its old address leads there. */
export default async function OpsBundleRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Hidden with the /ops pipeline section until it is made public.
  if (!opsPipelineVisible()) notFound();
  const id = (await params).id.join("/");
  const count = (await searchParams)?.count === "provisions" ? "provisions" : undefined;
  permanentRedirect(bundleHref(id, count));
}
