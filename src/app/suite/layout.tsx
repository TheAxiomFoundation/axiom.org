import type { Metadata } from "next";
import { SuiteChrome } from "@/components/suite/suite-chrome";

/** PROTOTYPE: the "all Axiom" naming mock. Never indexed, never linked. */
export const metadata: Metadata = {
  title: "Axiom — prototype suite (not public)",
  robots: { index: false, follow: false },
};

export default function SuiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SuiteChrome />
      {children}
    </>
  );
}
