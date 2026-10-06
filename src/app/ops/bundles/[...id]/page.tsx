import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgramBundle } from "@/components/axiom/program-bundle";
import { opsPipelineVisible } from "@/lib/axiom/ops-pipeline-visibility";
import { getProgramBundle } from "@/lib/axiom/program-bundles-data";
import { SITE_URL } from "@/lib/urls";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string[] }> }): Promise<Metadata> {
  const id = (await params).id.join("/");
  return {
    title: `${id} bundle - Axiom Foundation`,
    description: "A program bundle's delivery tiers: which documents each holds and how far each one has come.",
    alternates: { canonical: `${SITE_URL}/ops/bundles/${id}` },
    // Internal dashboard — never index.
    robots: { index: false, follow: false },
  };
}

export default async function OpsBundlePage({ params }: { params: Promise<{ id: string[] }> }) {
  // Hidden with the /ops pipeline section until it is made public.
  if (!opsPipelineVisible()) notFound();
  const id = (await params).id.join("/");
  const data = await getProgramBundle(id);
  return (
    <ProgramBundle bundle={data.bundle} documents={data.documents} available={data.available} referenceMs={Date.now()} />
  );
}
