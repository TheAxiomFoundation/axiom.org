import { describe, it, expect } from "vitest";
import {
  axiomAppUrl,
  axiomAppUrlForCitation,
  humanizeCitation,
  humanizeRuleName,
  humanizeSource,
} from "./citations";

describe("axiomAppUrlForCitation", () => {
  it("appends the cited subsection as path segments", () => {
    expect(
      axiomAppUrlForCitation("us-ga:statutes/48/48-7A-3", "48-7A-3(c)"),
    ).toBe("/us-ga/statute/48/48-7A-3/c");
    expect(
      axiomAppUrlForCitation(
        "us:regulations/7-cfr/273/10",
        "7 CFR 273.10(e)(2)(ii)(A)",
      ),
    ).toBe("/us/regulation/7/273/10/e/2/ii/A");
  });

  it("links the file home when the citation names no subsection", () => {
    // The file id already carries the subsection — no doubling.
    expect(
      axiomAppUrlForCitation("us:statutes/7/2017/a", "7 USC 2017(a)"),
    ).toBe("/us/statute/7/2017/a");
    expect(
      axiomAppUrlForCitation("us-ia:statutes/422/12C", "Iowa Code section 422.12C"),
    ).toBe("/us-ia/statute/422/12C");
    expect(axiomAppUrlForCitation("us-ia:statutes/422/12C", null)).toBe(
      "/us-ia/statute/422/12C",
    );
  });

  it("ignores URL-hostile or interior parentheticals", () => {
    expect(
      axiomAppUrlForCitation("us:statutes/26/21", "26 USC 21 (as amended) text"),
    ).toBe("/us/statute/26/21");
    expect(
      axiomAppUrlForCitation("us:statutes/26/21", "26 USC 21(e/../../etc)"),
    ).toBe("/us/statute/26/21");
  });
});

describe("state and policy citations", () => {
  it("never cites state statutes as USC", () => {
    expect(humanizeCitation("us-ia:statutes/422/12C")).toBe(
      "Iowa Code § 422.12C",
    );
    expect(humanizeCitation("us-ia:statutes/422/12C/3")).toBe(
      "Iowa Code § 422.12C(3)",
    );
    expect(humanizeCitation("us-ga:statutes/48/48-7A-3")).toBe(
      "Georgia Code § 48-7A-3",
    );
    expect(humanizeCitation("us-mt:statutes/15-30-2318")).toBe(
      "Montana Code § 15-30-2318",
    );
    expect(humanizeCitation("us-ny:statutes/nyc/11-1701")).toBe(
      "NYC § 11-1701 (New York)",
    );
  });

  it("keeps the federal USC form", () => {
    expect(humanizeCitation("us:statutes/26/21")).toBe("26 USC § 21");
    expect(humanizeCitation("us:statutes/7/2017/a")).toBe("7 USC § 2017(a)");
  });

  it("humanizes policy documents instead of dumping raw paths", () => {
    expect(
      humanizeCitation(
        "us-ak:policies/dpa/apa/standards/2026/state-supplement-payment-standard",
      ),
    ).toBe("Alaska · DPA · State Supplement Payment Standard");
    expect(
      humanizeCitation(
        "us-ca:policies/dor/spotlight-on-social-security/2026-01/block-7",
      ),
    ).toBe("California · DOR · Spotlight On Social Security");
    expect(
      humanizeCitation("us:policies/usda/snap/fy-2026-cola/maximum-allotments"),
    ).toBe("Federal · USDA · Maximum Allotments");
  });
});

describe("manual-bucket citations", () => {
  const moBlock =
    "us-mo:manual/dss/snap/1115-000-00/1115-035-00/1115-035-25/block-1";

  it("links a manual home to its deepest real section (block leaves drop)", () => {
    expect(axiomAppUrl(moBlock)).toBe(
      "/us-mo/manual/dss/snap/1115-000-00/1115-035-00/1115-035-25",
    );
  });

  it("humanizes a manual citation", () => {
    expect(humanizeCitation(moBlock)).toBe("MO DSS SNAP Manual 1115.035.25");
  });

  it("recognizes slash-form manual sources", () => {
    expect(
      humanizeSource("us-mo/manual/dss/snap/1115-000-00/1115-035-00/1115-035-25"),
    ).toBe("MO DSS SNAP Manual 1115.035.25");
  });

  it("leaves statute and regulation links untouched", () => {
    expect(axiomAppUrl("us:regulations/7-cfr/273/10")).toBe(
      "/us/regulation/7/273/10",
    );
    expect(axiomAppUrl("us:statutes/7/2017/a")).toBe("/us/statute/7/2017/a");
  });
});

describe("humanizeRuleName", () => {
  it("title-cases snake_case rule names", () => {
    expect(humanizeRuleName("elderly_disabled_credit")).toBe(
      "Elderly Disabled Credit",
    );
    expect(humanizeRuleName("snap_monthly_allotment")).toBe(
      "SNAP Monthly Allotment",
    );
    expect(humanizeRuleName("taxable_year_is_full_12_months")).toBe(
      "Taxable Year Is Full 12 Months",
    );
  });

  it("keeps acronyms upper-case", () => {
    expect(humanizeRuleName("cdcc")).toBe("CDCC");
    expect(humanizeRuleName("snap_agi_limit")).toBe("SNAP AGI Limit");
    expect(humanizeRuleName("eitc_child_count")).toBe("EITC Child Count");
    expect(humanizeRuleName("ssn_verification_required")).toBe(
      "SSN Verification Required",
    );
    expect(humanizeRuleName("itin_user")).toBe("ITIN User");
    expect(humanizeRuleName("amt_exemption_base_amount")).toBe(
      "AMT Exemption Base Amount",
    );
    expect(humanizeRuleName("earnings_with_fica_withheld")).toBe(
      "Earnings With FICA Withheld",
    );
    expect(humanizeRuleName("person_described_in_42_cfr_435_4")).toBe(
      "Person Described In 42 CFR 435 4",
    );
    expect(humanizeRuleName("lcwra_element_amount")).toBe(
      "LCWRA Element Amount",
    );
    // Tokens the shared DISPLAY_ACRONYMS registry folded in from the other
    // humanizers' retired sets now render here too.
    expect(humanizeRuleName("us_citizen_status")).toBe("US Citizen Status");
    expect(humanizeRuleName("aca_premium_credit")).toBe("ACA Premium Credit");
    expect(humanizeRuleName("snap_standard_deduction_48_states_dc")).toBe(
      "SNAP Standard Deduction 48 States DC",
    );
    expect(
      humanizeRuleName(
        "household_received_leap_or_e_ebt_payment_within_previous_12_months",
      ),
    ).toBe("Household Received LEAP Or E EBT Payment Within Previous 12 Months");
    expect(humanizeRuleName("snap_state_sme_flat_amount")).toBe(
      "SNAP State SME Flat Amount",
    );
    expect(
      humanizeRuleName("actual_excess_applies_when_excess_exceeds_smed"),
    ).toBe("Actual Excess Applies When Excess Exceeds SMED");
    expect(humanizeRuleName("ak_ssp_payment_standard")).toBe(
      "Ak SSP Payment Standard",
    );
  });

  it("does not touch words that merely contain acronym substrings", () => {
    expect(humanizeRuleName("debtor_has_ssn")).toBe("Debtor Has SSN");
    expect(humanizeRuleName("countable_debt_amount")).toBe(
      "Countable Debt Amount",
    );
  });

  it("is stable when re-humanizing output", () => {
    const label = humanizeRuleName("eitc_child_count");
    expect(humanizeRuleName(label)).toBe(label);
  });

  it("leaves already-humanized plain words unchanged", () => {
    expect(humanizeRuleName("Taxable Year")).toBe("Taxable Year");
  });

  it("survives odd input", () => {
    expect(humanizeRuleName("")).toBe("");
    expect(humanizeRuleName("__x__")).toBe("X");
  });
});
