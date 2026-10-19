import { notFound } from "next/navigation";
import { StyleFrame, type Direction } from "@/components/landing/style-frames/style-frame";

// Internal: the journey's style frames, one still per beat
// (/preview/style/lamplight/0 … /7, and /9 for the end state). ?t=0..1
// renders a beat part way through its own motion.
export default async function StyleFramePage({
  params,
  searchParams,
}: {
  params: Promise<{ dir: string; beat: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { dir, beat } = await params;
  const { t } = await searchParams;
  if (dir !== "lamplight") notFound();
  const tt = t === undefined ? 1 : Math.min(1, Math.max(0, Number(t)));
  return <StyleFrame dir={dir as Direction} beat={beat} t={Number.isFinite(tt) ? tt : 1} />;
}
