import { notFound } from "next/navigation";
import OpsPage from "@/app/ops/page";

export const metadata = {
  title: "Operations design preview",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Local design preview using the same real data as the operations page. */
export default function OpsPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <OpsPage />;
}
