import { notFound } from "next/navigation";
import { LinePage } from "@/components/suite/line-page";
import { SUITE_LINES, suiteLine } from "@/components/suite/lines";

export function generateStaticParams() {
  return SUITE_LINES.map((line) => ({ line: line.slug }));
}

export default async function SuiteLinePage({
  params,
}: {
  params: Promise<{ line: string }>;
}) {
  const { line: slug } = await params;
  const line = suiteLine(slug);
  if (!line) notFound();
  return <LinePage line={line} />;
}
