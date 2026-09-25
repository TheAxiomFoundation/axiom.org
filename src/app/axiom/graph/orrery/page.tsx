import type { Metadata } from "next";
import { OrreryClient } from "./orrery-client";

export const metadata: Metadata = {
  title: "Orrery dependency preview · Axiom",
  description: "Inspect native Axiom program dependencies with Orrery. Read-only preview; calculations remain in Axiom.",
  robots: { index: false, follow: true },
};

export default function OrreryPage() {
  return <OrreryClient />;
}
