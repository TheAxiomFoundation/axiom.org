import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { FormatComparison } from "@/components/format/format-comparison";
import { axiomAppHref } from "@/lib/urls";

export const metadata: Metadata = {
  title: "How RuleSpec compares — Axiom Foundation",
  description:
    "RuleSpec, DMN, OpenFisca, and Catala on the same statute — and what each one leaves out.",
};

export default function FormatPage() {
  return (
    <>
      <FormatComparison />
      <section className="relative z-1 pb-32 px-8">
        <div className="max-w-[720px] mx-auto text-center">
          <p className="font-body text-[0.95rem] text-[var(--color-ink-muted)] leading-relaxed mb-6">
            The encoded files are written for compilers, not for casual reading.
            The human-readable view of any encoded law lives in the app.
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <a
              href={axiomAppHref()}
              className="btn-primary"
            >
              Open Axiom
              <ArrowRightIcon className="w-5 h-5" />
            </a>
            <a
              href="https://github.com/TheAxiomFoundation/axiom-rules-engine/blob/main/docs/rulespec-format.md"
              className="btn-outline"
            >
              Spec on GitHub
            </a>
            <Link href="/" className="btn-outline">
              Back to overview
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
