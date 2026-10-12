/**
 * The rules chatbot's answer for the Aspen "az-savings" household, recorded
 * from the live gallery chatbot (POST
 * https://finbot-snap-demo.vercel.app/gallery/chatbot/api/chat, finbot-snap-demo
 * main 87fa9db) on 2026-10-12: the compute tool call, its result (the `_ms`
 * timing dropped) and the prose. Tests replay it as the AI SDK data stream.
 */

export const AZ_SAVINGS_QUESTION =
  "I live in Phoenix, Arizona. I'm 80, I have a disability and I live alone. I get $1,978 a month from Social Security and $560 a month from a private pension. I have $58,700 in the bank. How much SNAP (food stamps) can I get each month?";

export const AZ_SAVINGS_CALL = {
  "toolCallId": "call_cZte3WGocFq5NgNEoCCHfMwm",
  "toolName": "compute",
  "args": {
    "program": "us-az-snap",
    "facts": {
      "household_size": 1,
      "budgetary_unit_has_participant_who_is_elderly_or_has_disability": true,
      "snap_total_monthly_unearned_income": 2538
    },
    "members": [
      {
        "facts": {
          "snap_member_is_elderly_or_disabled": true
        }
      }
    ],
    "extra_outputs": [
      "snap_net_income",
      "snap_maximum_allotment",
      "snap_gross_income",
      "snap_excess_shelter_deduction",
      "snap_standard_deduction",
      "snap_utility_allowance"
    ]
  }
} as const;

export const AZ_SAVINGS_RESULT = {
  "toolCallId": "call_cZte3WGocFq5NgNEoCCHfMwm",
  "result": {
    "program": "us-az-snap",
    "display_name": "Arizona SNAP",
    "period": "2026-10",
    "member_count": 1,
    "primary_output": "snap_benefit",
    "outputs": [
      {
        "name": "snap_benefit",
        "label": "Snap benefit",
        "value": 24,
        "unit": "USD",
        "semantics": "scalar",
        "entity": "Household",
        "published_output": true,
        "acknowledged_incomplete": false,
        "legal_id": "us:policies/usda/snap/state-plan-composition#snap_benefit"
      },
      {
        "name": "snap_eligible",
        "label": "Snap eligible",
        "value": "holds",
        "unit": null,
        "semantics": "judgment",
        "entity": "Household",
        "published_output": true,
        "acknowledged_incomplete": false,
        "legal_id": "us-az:policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation#snap_eligible"
      },
      {
        "name": "snap_net_income",
        "label": "Snap net income",
        "value": 2329,
        "unit": "USD",
        "semantics": "scalar",
        "entity": "Household",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us:statutes/7/2014/e/6/A#snap_net_income"
      },
      {
        "name": "snap_maximum_allotment",
        "label": "Snap maximum allotment",
        "value": 298,
        "unit": "USD",
        "semantics": "scalar",
        "entity": "Household",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us:policies/usda/snap/fy-2026-cola/maximum-allotments#snap_maximum_allotment"
      },
      {
        "name": "snap_excess_shelter_deduction",
        "label": "Snap excess shelter deduction",
        "value": 0,
        "unit": "USD",
        "semantics": "scalar",
        "entity": "Household",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us-az:policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation#snap_excess_shelter_deduction"
      },
      {
        "name": "snap_standard_deduction",
        "label": "Snap standard deduction",
        "value": 209,
        "unit": "USD",
        "semantics": "scalar",
        "entity": "Household",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us:policies/usda/snap/fy-2026-cola/deductions#snap_standard_deduction"
      }
    ],
    "member_checks": [
      {
        "name": "snap_member_citizenship_or_alien_status_eligible",
        "label": "Snap member citizenship or alien status eligible",
        "value": "holds",
        "unit": null,
        "semantics": "judgment",
        "entity": "Person",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us:regulations/7-cfr/273/4#snap_member_citizenship_or_alien_status_eligible"
      },
      {
        "name": "snap_member_eligible",
        "label": "Snap member eligible",
        "value": "holds",
        "unit": null,
        "semantics": "judgment",
        "entity": "Person",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us:policies/usda/snap/state-plan-composition#snap_member_eligible"
      },
      {
        "name": "snap_member_ssn_requirement_ineligible",
        "label": "Snap member ssn requirement ineligible",
        "value": "not_holds",
        "unit": null,
        "semantics": "judgment",
        "entity": "Person",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us:regulations/7-cfr/273/6#snap_member_ssn_requirement_ineligible",
        "requires": [
          {
            "slot": "member_refused_or_failed_to_provide_or_apply_for_ssn",
            "value": true
          }
        ],
        "requires_partial": true
      },
      {
        "name": "snap_member_student_ineligible",
        "label": "Snap member student ineligible",
        "value": "not_holds",
        "unit": null,
        "semantics": "judgment",
        "entity": "Person",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us:regulations/7-cfr/273/5#snap_member_student_ineligible",
        "requires": [
          {
            "slot": "enrolled_at_least_half_time",
            "value": true
          }
        ],
        "requires_partial": true
      },
      {
        "name": "snap_member_work_requirement_ineligible",
        "label": "Snap member work requirement ineligible",
        "value": "not_holds",
        "unit": null,
        "semantics": "judgment",
        "entity": "Person",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us:regulations/7-cfr/273/24#snap_member_work_requirement_ineligible"
      },
      {
        "name": "participant_receives_bce_qualifying_benefit_or_status",
        "label": "Participant receives bce qualifying benefit or status",
        "value": "not_holds",
        "unit": null,
        "semantics": "judgment",
        "entity": "Person",
        "published_output": false,
        "acknowledged_incomplete": false,
        "legal_id": "us-az:policies/des/faa5/na-categorical-eligibility/basic-categorical-eligibility#participant_receives_bce_qualifying_benefit_or_status"
      }
    ],
    "applied": {
      "period": "2026-10",
      "member_count": 1,
      "facts_applied": {
        "household_size": 1,
        "budgetary_unit_has_participant_who_is_elderly_or_has_disability": true,
        "snap_total_monthly_unearned_income": 2538
      },
      "defaulted_slots": 644,
      "defaulted_income_slots": [
        "snap_gross_monthly_earned_income"
      ],
      "notes": [],
      "disclosures": [
        "Axiom's Arizona SNAP encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".",
        "SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet."
      ]
    },
    "citations": [
      {
        "id": "us:policies/usda/snap/state-plan-composition",
        "url": "https://app.axiom-foundation.org/us/policy/usda/snap/state-plan-composition"
      },
      {
        "id": "us-az:policies/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation",
        "url": "https://app.axiom-foundation.org/us-az/policy/des/faa5/na-eligibility-and-benefit-determination/fy-2026-benefit-calculation"
      },
      {
        "id": "us:statutes/7/2014/e/6/A",
        "url": "https://app.axiom-foundation.org/us/statute/7/2014/e/6/A"
      },
      {
        "id": "us:policies/usda/snap/fy-2026-cola/maximum-allotments",
        "url": "https://app.axiom-foundation.org/us/policy/usda/snap/fy-2026-cola/maximum-allotments"
      },
      {
        "id": "us:policies/usda/snap/fy-2026-cola/deductions",
        "url": "https://app.axiom-foundation.org/us/policy/usda/snap/fy-2026-cola/deductions"
      }
    ],
    "incomplete_note": null,
    "extra_outputs_errors": [
      {
        "name": "snap_gross_income",
        "error": "unknown output \"snap_gross_income\" for us-az-snap; closest outputs: snap_total_gross_income, snap_gross_monthly_income, na_gross_income_for_income_test, snap_standard_gross_income_eligible, snap_net_income",
        "suggestions": [
          "snap_total_gross_income",
          "snap_gross_monthly_income",
          "na_gross_income_for_income_test",
          "snap_standard_gross_income_eligible",
          "snap_net_income"
        ]
      },
      {
        "name": "snap_utility_allowance",
        "error": "unknown output \"snap_utility_allowance\" for us-az-snap; closest outputs: snap_standard_utility_allowance, snap_limited_utility_allowance, snap_individual_utility_allowance, snap_telephone_utility_allowance_eligible, snap_standard_utility_allowance_state_option",
        "suggestions": [
          "snap_standard_utility_allowance",
          "snap_limited_utility_allowance",
          "snap_individual_utility_allowance",
          "snap_telephone_utility_allowance_eligible",
          "snap_standard_utility_allowance_state_option"
        ]
      }
    ],
    "extra_outputs_note": "Unknown extra_outputs names were SKIPPED (suggestions listed) \u2014 every other output above was computed normally. Re-request a skipped output (once, via a suggested name) only if it is essential to the user's question."
  }
};

export const AZ_SAVINGS_TEXT = "**Estimated Arizona SNAP: $24/month, if eligible.**\n\n**Assumptions:**\n- Evaluation period: October 2026.\n- Household size: 1; you are elderly/disabled.\n- Unearned income: $1,978 Social Security + $560 pension = **$2,538/month**.\n- Bank balance was not used in the displayed benefit calculation; Arizona SNAP eligibility is not fully tested in Axiom.\n- Defaults used: $0 earned income, no shelter-cost deduction entered. Axiom applied a **$209** standard deduction and computed **$2,329** net income.\n- Axiom\u2019s Arizona SNAP encoding does **not** test eligibility yet; every household shows as eligible, so read this as \u201cif eligible.\u201d SNAP figures use FY2026 standards, though FY2027 standards took effect October 1, 2026 and are not encoded yet.\n\n**What could change this:**\n- Rent, mortgage, utilities, or out-of-pocket medical costs could change the SNAP amount.\n- Final eligibility and benefit amount are decided by Arizona DES.\n\nIf you share rent, utilities, and monthly medical costs, I can recompute.";

/** The recorded answer as the AI SDK v4 data stream the chatbot sends. */
export function azSavingsStream(): string {
  // One text part per line, as the chatbot streams them.
  const text = AZ_SAVINGS_TEXT.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return [
    `f:${JSON.stringify({ messageId: "recorded" })}`,
    `9:${JSON.stringify(AZ_SAVINGS_CALL)}`,
    `a:${JSON.stringify(AZ_SAVINGS_RESULT)}`,
    ...text.map((part) => `0:${JSON.stringify(part)}`),
    "",
  ].join("\n");
}
