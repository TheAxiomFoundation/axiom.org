import type { Metadata } from "next";
import { SITE_URL } from "@/lib/urls";

export const metadata: Metadata = {
  title: "Colorado SNAP and the FY 2024 Quality Control data - Axiom Foundation",
  description:
    "Encoded SNAP rules run against all 856 Colorado cases in USDA's FY 2024 Quality Control file, and what the error cases show about where payment-error dollars come from.",
  alternates: {
    canonical: `${SITE_URL}/reports/colorado-snap-qc-fy2024`,
  },
};

function StatRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3 border-b border-[var(--color-rule)]">
      <div className="font-body text-sm text-[var(--color-ink-secondary)]">
        {label}
        {note ? (
          <span className="block text-xs text-[var(--color-ink-muted)]">
            {note}
          </span>
        ) : null}
      </div>
      <div className="font-mono text-base text-[var(--color-ink)] whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}

export default function ColoradoSnapQcReport() {
  return (
    <div className="relative z-1 py-32 px-8">
      <div className="max-w-[800px] mx-auto">
        <header className="mb-16">
          <p className="font-body text-xs tracking-[0.14em] uppercase text-[var(--color-ink-muted)] mb-4">
            Report · July 2026 · revised October 2026
          </p>
          <h1 className="heading-page mb-6">
            Colorado SNAP and the FY 2024 Quality Control data
          </h1>
          <p className="font-body text-xl text-[var(--color-ink-secondary)] leading-relaxed">
            We ran all 856 Colorado cases in USDA&apos;s FY 2024 SNAP Quality
            Control file through our encoded SNAP rules. For each case, the
            research firm Mathematica computes a benefit for USDA from the
            edited case record. Our rules matched that benefit, and five
            intermediate values, in all 856 cases at zero tolerance. The file
            keeps only eligible households, so the replay checks benefit
            arithmetic and leaves eligibility untested. We then used the
            reviewers&apos; error findings to break down where Colorado&apos;s
            payment-error dollars come from.
          </p>
        </header>

        <section className="mb-16">
          <h2 className="heading-sub mb-4">Why the error rate is now a budget line</h2>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-6">
            Under 7 U.S.C. 2013(a)(2), as amended in 2025, states begin paying
            a share of SNAP benefit costs in fiscal year 2028, set by their
            payment error rate: 0% below a 6% error rate, 5% from 6 to 8, 10%
            from 8 to 10, and 15% at or above 10. For fiscal year 2028, each
            state chooses whether its FY 2025 or FY 2026 error rate sets the
            share. USDA published FY 2025 rates in June 2026; FY 2026 ended on
            September 30, 2026.
          </p>
          <div className="card-edition p-6">
            <StatRow
              label="Colorado official FY 2024 payment error rate"
              note="7.91 over-payments + 2.06 under-payments (USDA)"
              value="9.97%"
            />
            <StatRow
              label="Colorado official FY 2025 payment error rate"
              note="8.52 over-payments + 1.57 under-payments (USDA, June 2026)"
              value="10.09%"
            />
            <StatRow
              label="FY 2024 distance to the 15% cost-share tier"
              value="0.03 points"
            />
            <StatRow
              label="Approximate value of one tier to Colorado"
              note="5% of ≈$1.27B FY 2024 issuance (QC-file weighted)"
              value="≈$63M / year"
            />
            <StatRow
              label="National official FY 2024 payment error rate"
              value="10.93%"
            />
          </div>
        </section>

        <section className="mb-16">
          <h2 className="heading-sub mb-4">
            First, the check: reproducing the file&apos;s benefit calculation
          </h2>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            The Quality Control file holds a monthly sample of active SNAP
            cases. State QC reviewers examine each sampled case, including a
            new interview with the household, and USDA&apos;s regional offices
            re-review a subsample. Mathematica then edits each record for
            consistency, computes a benefit from it, and reconciles that
            benefit to within $5 of the benefit the review recorded, adjusted
            for any payment error. The file&apos;s technical documentation
            states that it does not represent an official USDA determination.
          </p>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            We ran every Colorado FY 2024 case through our encoded rules and
            compared six values with the file: gross income, the standard
            deduction, the excess-shelter deduction, net income, the maximum
            allotment, and the benefit. The replay takes household income, the
            medical, dependent-care and child-support deductions, and the
            utility amount from the file, and it gives the eligibility tests
            passing values. A match therefore checks the arithmetic from those
            amounts to the benefit.
          </p>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
            The result: <strong className="text-[var(--color-ink)]">856 of
            856 cases matched on all six values at zero tolerance</strong>, in
            the September 2026 run against current rules. Two of the details
            exact agreement required show why checking against case records
            matters. The regulation&apos;s printed text still sets the
            homeless shelter deduction at $143; the 2018 Farm Bill indexed it
            to inflation, and USDA&apos;s FY 2024 cost-of-living tables put it
            at $179.66. And SNAP regulations round to whole dollars at set
            steps (7 CFR 273.10(e)), so a computation that carries cents can
            land a dollar off. Printed text and operative rules drift apart in
            these ways; catching that drift is what this infrastructure is
            for. The comparison code, its results, and the fixes to our rules
            are public. Rerunning the comparison takes the rules engine, a
            rulespec-us checkout, and USDA&apos;s file.
          </p>
        </section>

        <section className="mb-16">
          <h2 className="heading-sub mb-4">
            Where Colorado&apos;s error dollars come from
          </h2>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            Colorado has 305 sampled cases with a payment error, carrying
            $112.6M a year in weighted error dollars. Reviewers give each error
            finding a cause code, which separates information problems on the
            household&apos;s side from the agency&apos;s and, on the agency
            side, software causes from worker causes:
          </p>
          <div className="card-edition p-6 mb-2">
            <StatRow
              label="Household or third-party information"
              note="not reported, incomplete, incorrect or withheld, or wrong from a collateral contact or federal data match (codes 1–8)"
              value="$58.3M / yr (51.8%)"
            />
            <StatRow
              label="Agency process"
              note="reported information disregarded, follow-up or verification not done, or recertification steps missed (codes 12–16, 23–25)"
              value="$49.4M / yr (43.9%)"
            />
            <StatRow
              label="Data entry and keying"
              note="cause code 18"
              value="$18.4M / yr (16.4%)"
            />
            <StatRow
              label="System software"
              note="programming errors + computer-generated mass changes (codes 17, 19)"
              value="$7.0M / yr (6.2%)"
            />
            <StatRow
              label="Policy misapplied or amount mis-budgeted"
              note="codes 10, 22 — worker or system"
              value="$3.7M / yr (3.3%)"
            />
            <StatRow
              label="Worker computation"
              note="arithmetic and system-use errors (codes 20, 21)"
              value="$1.2M / yr (1.1%)"
            />
          </div>
          <p className="font-body text-xs text-[var(--color-ink-muted)] leading-relaxed mb-6">
            Case-attributed: an error case counts toward every class its
            findings carry, so shares overlap and exceed 100% in total. Not
            shown: code 26, a change the household did not have to report
            ($7.2M), and 21 error cases with no cause code ($2.3M).
          </p>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            The replay adds a test the cause codes alone cannot. Open-source
            code by Eric Giannella and Ben Molin estimates what the agency
            used before the reviewer&apos;s correction: it takes the input
            named in the first error finding and moves it, $3 at a time, until
            the computed benefit matches the benefit the agency issued. We
            adapted it to FY 2024, applied it to the 283 of 305 error cases
            that pass its consistency checks, and ran each reconstructed case
            through our rules. For 246 cases, our rules reproduce the issued
            benefit within $5, which is consistent with correct arithmetic on
            a wrong input. That includes 14 of the 16 cases coded as software
            errors: mass changes that budgeted the wrong Social Security
            amount, and programming errors that budgeted the wrong child
            support.
          </p>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            For the other 37, no single changed input reproduces the issued
            benefit. Ten of them carry a computation or policy cause code (10,
            17, 19, 20, 21 or 22). Four of those ten involve prorating the
            first month&apos;s benefit; others involve a utility allowance
            applied that should not have been, a child-support deduction left
            out, and a homeless shelter deduction left out. These ten are
            candidates for errors in the benefit computation itself; the
            reconstruction does not show which step went wrong.
          </p>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
            Cause codes 10, 17, 19, 20, 21 and 22 together carry 10.5% of
            Colorado&apos;s sampled error dollars. If that share held for the
            official 9.97% FY 2024 rate, it would be about one point: more
            than 30 times the 0.03-point margin to the 10% boundary, and about
            half the 1.97-point distance to the 8% boundary below.
          </p>
        </section>

        <section className="mb-16">
          <h2 className="heading-sub mb-4">What each class responds to</h2>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
            Each class points to a different fix. Computation and
            policy-application errors are the class that rules logic
            addresses directly: rules encoded once, checked against case
            records, and run the same way every time. Errors from automated
            inputs point to the data integrations that feed the system.
            Data-entry errors point to validation at the point of entry.
            Household and third-party information errors, 51.8% of
            Colorado&apos;s error dollars and 47.3% nationally, point to
            verification practice and reporting design. A state that knows
            each class&apos;s share can direct effort where a point of error
            rate is recoverable.
          </p>
        </section>

        <section className="mb-16">
          <h2 className="heading-sub mb-4">Method notes and caveats</h2>
          <ul className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed list-disc pl-5 space-y-2">
            <li>
              Data: USDA SNAP Quality Control public-use file, FY 2024 (44,891
              cases; 856 in Colorado), in the August 2026 posting that
              corrected the sample weights, with its technical documentation;
              official error rates from USDA&apos;s FY 2024 and FY 2025
              payment error rate tables. Dollar figures weight each case by
              its monthly sample weight and sum over the fiscal year. The
              cause-code table uses the file&apos;s STATUS, AMTERR, HWGT, and
              AGENCY1–AGENCY9 fields.
            </li>
            <li>
              Colorado contributes 856 cases, so its figures carry sampling
              error. The official state rate also draws on USDA&apos;s federal
              re-review of a subsample, so it differs from rates computed from
              the file alone.
            </li>
            <li>
              Cause codes are assigned by state reviewers and mix software and
              worker action in some categories; the reconstruction replay
              tests them a second way.
            </li>
            <li>
              The 856-case comparison rounds both benefits to whole dollars
              and compares the five intermediate values unrounded, all at zero
              tolerance. It checks the maximum allotment against the FY 2024
              table by household size. The earned-income, medical,
              dependent-care and child-support deductions are not compared on
              their own; a difference there would show up in net income. FY
              2024 parameters come from an overlay that swaps the FY 2024
              cost-of-living values into rules dated FY 2026.
            </li>
            <li>
              The error-case replay, run in July 2026, compares our benefit
              with the benefit the agency issued, within $5: the tolerance
              Mathematica uses to reconcile its computed benefit with the
              reviewed one.
            </li>
            <li>
              Scope: one state, one program, one fiscal year, benefit
              computation only. The encodings, the comparison harness, and its
              results are public:{" "}
              <a
                href="https://github.com/TheAxiomFoundation/rulespec-us"
                target="_blank"
                rel="noopener noreferrer"
              >
                rulespec-us
              </a>
              ,{" "}
              <a
                href="https://github.com/TheAxiomFoundation/axiom-oracles"
                target="_blank"
                rel="noopener noreferrer"
              >
                axiom-oracles
              </a>
              . The error-case reconstruction is in{" "}
              <a
                href="https://github.com/PolicyEngine/snap-qc-sim/tree/main/paper/snapshot/labs/amterr"
                target="_blank"
                rel="noopener noreferrer"
              >
                snap-qc-sim
              </a>
              , adapted from{" "}
              <a
                href="https://github.com/giannella/snap_qc"
                target="_blank"
                rel="noopener noreferrer"
              >
                giannella/snap_qc
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <div className="card-edition p-6">
            <p className="font-body text-[1rem] text-[var(--color-ink)] leading-relaxed mb-2">
              The rules and the comparison code behind this report are open
              source.
            </p>
            <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
              Questions, or interested in running this for your state or
              program:{" "}
              <a href="mailto:hello@axiom.org">
                hello@axiom.org
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
