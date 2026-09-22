import { notFound } from "next/navigation";
import { ForecastDetail, forecastBySlug } from "@/components/suite/forecast-detail";
import { FORECASTS } from "@/components/suite/forecasts-log";
export function generateStaticParams() { return FORECASTS.map((f) => ({ slug: f.forecastSlug })); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = forecastBySlug(slug);
  if (!f) notFound();
  return <ForecastDetail f={f} />;
}
