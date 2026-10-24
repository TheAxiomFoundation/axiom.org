/**
 * A rules check as phones saved it until PR #350 took the check out of Try
 * it (merged October 16, 2026), for the readers that still show those runs
 * (results.ts, store.ts). The route that wrote these rows is gone.
 *
 * This is aspen_prompts.rules_outputs for the former "az-savings" household,
 * as /api/aspen/rules saved it from the gallery chatbot's answer recorded on
 * 2026-10-12 (summarizeRules in src/lib/aspen/rules.ts at master 874391ae).
 * The route saved the first computation's display name as rules_program and
 * its dollar primary as rules_amount: "Arizona SNAP" and 24.
 *
 * The rows production holds are older than this: their computations carry
 * only program, displayName, period, primary and outputs (checked
 * 2026-10-24). The route began saving disclosures, standardsYears and
 * eligibilityTested when PR #326 merged (October 23), after the check had
 * left Try it. productionShape keeps the first five keys.
 */
export const AZ_SAVED_CHECK = [
  {
    "program": "us-az-snap",
    "displayName": "Arizona SNAP",
    "period": "2026-10",
    "primary": {
      "name": "snap_benefit",
      "label": "Snap benefit",
      "value": 24,
      "unit": "USD",
      "incomplete": false,
      "legalId": "us:policies/usda/snap/state-plan-composition#snap_benefit",
      "semantics": "scalar"
    },
    "outputs": [
      {
        "name": "snap_benefit",
        "label": "Snap benefit",
        "value": 24,
        "unit": "USD",
        "incomplete": false,
        "legalId": "us:policies/usda/snap/state-plan-composition#snap_benefit",
        "semantics": "scalar"
      },
      {
        "name": "snap_eligible",
        "label": "Snap eligible",
        "value": "holds",
        "unit": null,
        "incomplete": false,
        "legalId": "us-az:policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation#snap_eligible",
        "semantics": "judgment"
      },
      {
        "name": "snap_net_income",
        "label": "Snap net income",
        "value": 2329,
        "unit": "USD",
        "incomplete": false,
        "legalId": "us:statutes/7/2014/e/6/A#snap_net_income",
        "semantics": "scalar"
      },
      {
        "name": "snap_maximum_allotment",
        "label": "Snap maximum allotment",
        "value": 298,
        "unit": "USD",
        "incomplete": false,
        "legalId": "us:policies/usda/snap/fy-2026-cola/maximum-allotments#snap_maximum_allotment",
        "semantics": "scalar"
      },
      {
        "name": "snap_excess_shelter_deduction",
        "label": "Snap excess shelter deduction",
        "value": 0,
        "unit": "USD",
        "incomplete": false,
        "legalId": "us-az:policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation#snap_excess_shelter_deduction",
        "semantics": "scalar"
      },
      {
        "name": "snap_standard_deduction",
        "label": "Snap standard deduction",
        "value": 209,
        "unit": "USD",
        "incomplete": false,
        "legalId": "us:policies/usda/snap/fy-2026-cola/deductions#snap_standard_deduction",
        "semantics": "scalar"
      }
    ],
    "disclosures": [
      "Axiom's Arizona SNAP encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".",
      "SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet."
    ],
    "standardsYears": [
      2026
    ],
    "eligibilityTested": false
  }
];

/** A saved computation as production's rows hold it: before disclosures, standardsYears and eligibilityTested. */
export function productionShape<T extends { program: string; displayName: string; period: string | null; primary: unknown; outputs: unknown }>(
  c: T,
) {
  const { program, displayName, period, primary, outputs } = c;
  return { program, displayName, period, primary, outputs };
}
