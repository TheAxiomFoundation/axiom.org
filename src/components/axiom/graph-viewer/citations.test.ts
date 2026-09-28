import { describe, it, expect } from "vitest";
import {
  axiomAppUrl,
  axiomAppUrlForCitation,
  humanizeCitation,
  humanizeRuleName,
  humanizeSource,
  isReadableLawFile,
  isReadableLawSource,
  citationTailSegments,
  readableLawTarget,
  readableSourceFileLegalId,
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

  it("drops the humanized jurisdiction suffix from citation tails", () => {
    // meta.citation for state rules is humanized with a proper-noun
    // suffix — "(Colorado)" must never become a URL segment.
    expect(
      axiomAppUrlForCitation(
        "us-co:regulations/10-ccr-2506-1/4.207.3",
        "10 CCR 2506-1 § 4.207.3 (Colorado)"
      )
    ).toBe("/us-co/regulation/10-ccr-2506-1/4.207.3");
    expect(
      axiomAppUrlForCitation(
        "us-co:regulations/10-ccr-2506-1/4.207",
        "10 CCR 2506-1 § 4.207(a) (Colorado)"
      )
    ).toBe("/us-co/regulation/10-ccr-2506-1/4.207/a");
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

describe("readable-law gate (#191)", () => {
  it("admits every bucket the reader can render", () => {
    for (const file of [
      "us:statutes/26/32",
      "us-co:regulations/10-ccr-2506-1/4.110",
      "us-nc:policies/dhhs/fns/appendix-3300-glossary/page-12",
      "us:guidance/ssa/cola/2026",
      "us:bills/hr-1234",
      "us-fl:manual/dcf/ess-program-policy-manual",
    ]) {
      expect(isReadableLawFile(file)).toBe(true);
    }
  });

  it("rejects non-law buckets and admits sources by the same set", () => {
    expect(isReadableLawFile("us:packages/snap/composed")).toBe(false);
    expect(isReadableLawSource("us:statutes/7/2014#a")).toBe(true);
    expect(isReadableLawSource("us-ak:policies/dpa/apa/standards/2026")).toBe(
      true
    );
    expect(isReadableLawSource("2026 APA Payment Standards, A1E")).toBe(false);
  });
});

describe("citationTailSegments (#190 tolerant matcher)", () => {
  const base = (path: string) => path.split("/").filter(Boolean);

  it("prefers the run attached to the file's own section", () => {
    // Trailing co-citation used to defeat the parser entirely.
    expect(
      citationTailSegments(
        base("/us/statute/26/152"),
        "26 USC 152(c)(1)(E), 6013"
      )
    ).toEqual(["c", "1", "E"]);
    // Multi-citation: the primary run wins, not the last one.
    expect(
      citationTailSegments(
        base("/us/statute/26/21"),
        "26 USC 21(a)(2)(A), 21(g)(3)"
      )
    ).toEqual(["a", "2", "A"]);
  });

  it("does not match a section number inside a longer designator", () => {
    expect(
      citationTailSegments(
        base("/us/statute/26/21"),
        "26 USC 121(a), 21(b)"
      )
    ).toEqual(["b"]);
    expect(
      citationTailSegments(
        base("/us/statute/26/21"),
        "Tax year 2021(a); 26 USC 21(c)"
      )
    ).toEqual(["c"]);
  });

  it("tolerates whitespace between groups and around designators", () => {
    expect(
      citationTailSegments(
        base("/us-ny/regulation/18-nycrr/387/14"),
        "18 NYCRR 387.14 (a) (5)"
      )
    ).toEqual(["a", "5"]);
  });

  it("falls back to a trailing run when no base segment is cited", () => {
    expect(
      citationTailSegments(base("/us/statute/7/2014"), "Section X(e)(6)")
    ).toEqual(["e", "6"]);
    expect(
      citationTailSegments(base("/us/statute/7/2014"), "no parens at all")
    ).toBeNull();
  });

  it("rejects URL-hostile runs", () => {
    expect(
      citationTailSegments(base("/us/statute/26/32"), "32(see note *)")
    ).toBeNull();
  });
});

describe("axiomAppUrlForCitation focus links (#190)", () => {
  it("keeps deep focus for co-cited and multi-cited sources", () => {
    expect(
      axiomAppUrlForCitation("us:statutes/26/152", "26 USC 152(c)(1)(E), 6013")
    ).toBe("/us/statute/26/152/c/1/E");
    expect(
      axiomAppUrlForCitation("us:statutes/26/21", "26 USC 21(a)(2)(A), 21(g)(3)")
    ).toBe("/us/statute/26/21/a/2/A");
  });

  it("focuses the bounded section when a longer section is cited first", () => {
    expect(
      axiomAppUrlForCitation(
        "us:statutes/26/21",
        "26 USC 121(a), 21(b)"
      )
    ).toBe("/us/statute/26/21/b");
  });

  it("still dedupes overlap with an already-deep file id", () => {
    expect(
      axiomAppUrlForCitation(
        "us-ny:regulations/18-nycrr/387/14/a/5",
        "18 NYCRR 387.14(a)(5)"
      )
    ).toBe("/us-ny/regulation/18-nycrr/387/14/a/5");
  });
});

describe("readableLawTarget (#190 question nodes)", () => {
  const consumers = [
    {
      legalId: "us:statutes/26/21#treated_as_not_married_under_section_21",
      source: "26 USC 21(e)(3)-(4)",
    },
  ];

  it("rules read their own home with their own citation", () => {
    expect(
      readableLawTarget({
        legalId: "us:statutes/26/21#cdcc_dollar_limit",
        ruleSource: "26 USC 21(c)",
        citation: "26 USC 21(c)",
        isQuestion: false,
        consumers,
      })
    ).toEqual({
      fileLegalId: "us:statutes/26/21",
      citation: "26 USC 21(c)",
      ruleName: "cdcc_dollar_limit",
    });
  });

  it("a question housed IN a law file still borrows its consumer (the age case)", () => {
    expect(
      readableLawTarget({
        legalId: "us:statutes/26/22#age",
        ruleSource: null,
        citation: "26 USC § 22",
        isQuestion: true,
        consumers: [
          {
            legalId: "us:statutes/26/22#section_22_aged_individual",
            source: "26 USC 22(b)(1)",
          },
        ],
      })
    ).toEqual({
      fileLegalId: "us:statutes/26/22",
      citation: "26 USC 22(b)(1)",
      ruleName: "section_22_aged_individual",
    });
  });

  it("a question with no qualifying consumer falls back to its readable home, unspotlighted", () => {
    expect(
      readableLawTarget({
        legalId: "us:statutes/26/22#age",
        ruleSource: null,
        citation: "26 USC § 22",
        isQuestion: true,
        consumers: [],
      })
    ).toEqual({
      fileLegalId: "us:statutes/26/22",
      citation: "26 USC § 22",
      ruleName: null,
    });
  });

  it("questions borrow the consumer's file, citation, AND name", () => {
    expect(
      readableLawTarget({
        legalId: "axiom:us-package#legally_separated_under_decree",
        ruleSource: null,
        citation: null,
        isQuestion: true,
        consumers,
      })
    ).toEqual({
      fileLegalId: "us:statutes/26/21",
      citation: "26 USC 21(e)(3)-(4)",
      ruleName: "treated_as_not_married_under_section_21",
    });
  });

  it("a rule with an unreadable home never borrows a consumer's law", () => {
    expect(
      readableLawTarget({
        legalId: "axiom:us-package#synthetic_rule",
        ruleSource: null,
        citation: null,
        isQuestion: false,
        consumers,
      })
    ).toBeNull();
  });

  it("covers null id, source homes, and unreadable consumers", () => {
    expect(
      readableLawTarget({
        legalId: null,
        ruleSource: null,
        citation: null,
        isQuestion: true,
        consumers,
      })
    ).toBeNull();
    // Synthesized package rule citing its statute via `source`.
    expect(
      readableLawTarget({
        legalId: "axiom:us-package#snap_allotment",
        ruleSource: "us:statutes/7/2017#a",
        citation: "7 USC 2017(a)",
        isQuestion: false,
        consumers,
      })
    ).toEqual({
      fileLegalId: "us:statutes/7/2017",
      citation: "7 USC 2017(a)",
      ruleName: "snap_allotment",
    });
    // Consumers in unreadable homes are skipped; none readable → null.
    expect(
      readableLawTarget({
        legalId: "axiom:us-package#some_question",
        ruleSource: null,
        citation: null,
        isQuestion: true,
        consumers: [
          { legalId: "axiom:us-package#composed_rule", source: null },
        ],
      })
    ).toBeNull();
  });

  it("borrowed citations produce a focused reader link", () => {
    const target = readableLawTarget({
      legalId: "axiom:us-package#legally_separated_under_decree",
      ruleSource: null,
      citation: null,
      isQuestion: true,
      consumers,
    })!;
    expect(axiomAppUrlForCitation(target.fileLegalId, target.citation)).toBe(
      "/us/statute/26/21/e/3"
    );
  });
});

describe("readableSourceFileLegalId (slash-form sources)", () => {
  it("normalizes slash-form citation paths to colon-form file ids", () => {
    expect(
      readableSourceFileLegalId("us-ny/regulation/18-nycrr/387/14/a/5(a)")
    ).toBe("us-ny:regulations/18-nycrr/387/14/a/5");
    expect(
      readableSourceFileLegalId("us-ny/regulation/18-nycrr/387/14/a/5(b)-(c)")
    ).toBe("us-ny:regulations/18-nycrr/387/14/a/5");
    expect(readableSourceFileLegalId("us/statute/7/2014")).toBe(
      "us:statutes/7/2014"
    );
  });

  it("passes colon-form through and rejects human text", () => {
    expect(readableSourceFileLegalId("us:statutes/7/2014#a")).toBe(
      "us:statutes/7/2014"
    );
    expect(readableSourceFileLegalId("26 USC 21(c)")).toBeNull();
    expect(readableSourceFileLegalId("us/unknown-bucket/x")).toBeNull();
  });

  it("gives package rules with slash-form sources a Read-the-law target", () => {
    expect(
      readableLawTarget({
        legalId: "axiom:us-ny-snap#categorically_eligible",
        ruleSource: "us-ny/regulation/18-nycrr/387/14/a/5(a)",
        citation: "us-ny/regulation/18-nycrr/387/14/a/5(a)",
        isQuestion: false,
        consumers: [],
      })
    ).toEqual({
      fileLegalId: "us-ny:regulations/18-nycrr/387/14/a/5",
      citation: "us-ny/regulation/18-nycrr/387/14/a/5(a)",
      ruleName: "categorically_eligible",
    });
  });
});

describe("curated question citations", () => {
  it("a curated meta.citation beats consumer inference", () => {
    expect(
      readableLawTarget({
        legalId: "us:statutes/26/22#age",
        ruleSource: null,
        citation: "26 USC § 22",
        curatedCitation: "26 USC 22(b)(1)",
        isQuestion: true,
        consumers: [
          {
            legalId: "us:statutes/26/22#some_other_rule",
            source: "26 USC 22(c)(2)",
          },
        ],
      })
    ).toEqual({
      fileLegalId: "us:statutes/26/22",
      citation: "26 USC 22(b)(1)",
      ruleName: null,
    });
  });
});
