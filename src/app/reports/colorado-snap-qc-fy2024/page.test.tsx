import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ColoradoSnapQcReport, { metadata } from "./page";

// Evidence for the claims this page makes (re-read before editing them):
// - FSBEN, the benefit the replay targets, is computed by Mathematica for
//   USDA from the edited case record and reconciled to within $5 of the
//   reported benefit adjusted for any payment error where adjusting a
//   deduction closes the gap (FY 2024 QC technical documentation, August
//   2026 posting, PDF p.36, Steps 12-13). In Colorado, FSBEN is within $5
//   of BENFIX (the error-adjusted reviewed benefit) in 797 of 856 cases.
//   State QC reviewers review cases; federal regional offices re-review a
//   subsample (p.19). It states the $179.66 homeless deduction on pp.23,
//   125 and 184.
// - The replay compares six values (axiom-oracles
//   axiom_oracles/bridges/snap_qc_compare.py `_LABELS`): gross income, the
//   standard and excess-shelter deductions, net income, the maximum
//   allotment (against a typed FY 2024 table, not BENMAX), and the benefit.
//   It takes income, the medical, dependent-care and child-support
//   deductions and UTIL from the file and feeds eligibility gates passing
//   values. comparisons/co-snap-qc.yaml sets stage_tolerance 0; the
//   2026-09-22 report has 856/856 on all six.
// - The error-case replay (PolicyEngine/snap-qc-sim
//   paper/snapshot/labs/amterr) compares the engine on reconstructed inputs
//   with RAWBEN within $5: 283 of 305 replayed, 246 reproduced, 37 not (14
//   of them solver no_change rows), 10 of those with cause codes
//   10/17/19/20/21/22, 7 of which concern the computation; 14 of the 16
//   replayed software-coded cases reproduced (18 error cases carry 17/19).
// - The cause-code table recomputes from the August 2026 posting of
//   qc_pub_fy2024.csv (STATE 8, STATUS 2/3, AMTERR * HWGT, AGENCY1-9).
function pageText() {
  const { container, unmount } = render(<ColoradoSnapQcReport />);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
  unmount();
  return parts.join(" ").replace(/\s+/g, " ");
}

describe("Colorado SNAP QC report", () => {
  it("describes FSBEN as Mathematica's computed benefit", () => {
    const text = pageText();

    expect(text).toMatch(
      /the research firm Mathematica computes a benefit for USDA from the edited case record/,
    );
    expect(text).toMatch(
      /Where that benefit is more than \$5 from the benefit the review recorded, adjusted for any payment error, Mathematica adjusts certain deductions to close the gap when it can; in Colorado, 797 of the 856 computed benefits end within \$5/,
    );
    expect(text).toMatch(/the reviewer.s finding is recorded separately/);
    expect(text).toMatch(/State QC reviewers examine each sampled case/);
    expect(text).toMatch(/regional offices re-review a subsample/);
    expect(text).toMatch(/leaves eligibility untested/);

    expect(text).not.toMatch(/own recomputation/i);
    expect(text).not.toMatch(/federal computation/i);
    expect(text).not.toMatch(/answer key/i);
    expect(text).not.toMatch(/federal reviewer verified/i);
    expect(text).not.toMatch(/reviewer-certified/i);
    expect(text).not.toMatch(/stratified sample/i);
  });

  it("names the six compared values and what comes from the file", () => {
    const text = pageText();

    expect(text).toMatch(
      /compared six values: gross income, the standard deduction, the excess-shelter deduction, net income, and the benefit with the file, and the maximum allotment with USDA.s FY 2024 table/,
    );
    expect(text).toMatch(
      /takes household income, the medical, dependent-care and child-support deductions, and the utility amount from the file/,
    );
    expect(text).toMatch(
      /856 of 856 cases matched on all six values at zero tolerance ?, in the run of September 22, 2026/,
    );
    expect(text).not.toMatch(/current rules/i);
    expect(text).toMatch(/checks the maximum allotment against the FY 2024 table/);
    expect(text).toMatch(/overlay that swaps the FY 2024 cost-of-living values/);

    expect(text).not.toMatch(/each deduction/i);
    expect(text).not.toMatch(/every stage/i);
    expect(text).not.toMatch(/stage by stage/i);
  });

  it("keeps the $5 tolerance on the error-case replay only", () => {
    const text = pageText();

    expect(text).toMatch(
      /error-case replay, run in July 2026, compares our benefit with the benefit the agency issued, within \$5/,
    );
    expect(text).not.toMatch(/consistency tolerance/i);
  });

  it("cites where $179.66 is published without claiming it appears only in one place", () => {
    const text = pageText();

    expect(text).toMatch(/printed text still sets the homeless shelter deduction at \$143/);
    expect(text).toMatch(/cost-of-living tables put it at \$179\.66/);
    expect(text).not.toMatch(/appears only in/i);
  });

  it("states the reconstruction counts without overclaiming what they show", () => {
    const text = pageText();

    expect(text).toMatch(/Eric Giannella and Ben Molin/);
    expect(text).toMatch(/283 of 305 error cases/);
    expect(text).toMatch(/For 246 cases, our rules reproduce the issued benefit within \$5/);
    expect(text).toMatch(/14 of the 16 replayed cases coded as software errors \(18 error cases carry a software code\)/);
    expect(text).toMatch(/For the other 37, moving the input the first finding names does not reproduce the issued benefit/);
    expect(text).toMatch(/Ten of the 37 carry a computation or policy cause code/);
    expect(text).toMatch(/In seven, that coded finding concerns the benefit computation/);
    expect(text).toMatch(/the reconstruction does not show which step went wrong/);

    expect(text).not.toMatch(/strictest class/i);
    expect(text).not.toMatch(/eliminat(es|ed) (outright|by)/i);
    expect(text).not.toMatch(/no single changed input/i);
    expect(text).not.toMatch(/the majority everywhere/i);
    expect(text).not.toMatch(/twice the margin/i);
    expect(text).not.toMatch(/independent check/i);
    expect(text).not.toMatch(/every (run|artifact)/i);
    expect(text).not.toMatch(/reproducible/i);
  });

  it("dates the cost-share framing to the published FY 2025 rate", () => {
    const text = pageText();

    expect(text).toMatch(/Colorado official FY 2025 payment error rate/);
    expect(text).toMatch(/10\.09%/);
    expect(text).toMatch(/is 0\.09 points above the 10% boundary/);
    expect(text).toMatch(/starts in fiscal year 2029 or 2030 instead/);
    expect(text).not.toMatch(/the period being measured now/i);
    expect(text).toMatch(/revised October 2026/);
  });

  it("keeps the cause-code table shares consistent with its dollar figures", () => {
    const text = pageText();
    const total = Number(text.match(/carrying \$([\d.]+)M a year/)?.[1]);
    expect(total).toBe(112.6);

    const rows = [...text.matchAll(/\$([\d.]+)M \/ yr \(([\d.]+)%\)/g)];
    expect(rows).toHaveLength(6);
    for (const [, dollars, share] of rows) {
      // Each cell is rounded to one decimal, so allow both roundings.
      expect(Math.abs((Number(dollars) / total) * 100 - Number(share))).toBeLessThan(0.15);
    }
  });

  it("keeps the one-point comparison arithmetic true", () => {
    const text = pageText();
    expect(text).toMatch(/together carry 10\.5% of Colorado/);
    expect(text).toMatch(/6\.2% under the software codes 17 and 19/);
    expect(text).toMatch(/4\.3% under codes 10, 20, 21 and 22/);
    expect(text).toMatch(/more than 30 times the 0\.03-point margin/);
    expect(text).toMatch(/about half the 1\.97-point distance/);

    const points = 0.105 * 9.97;
    expect(points / 0.03).toBeGreaterThan(30);
    expect(Math.abs(points / 1.97 - 0.5)).toBeLessThan(0.05);
    expect(10 - 9.97).toBeCloseTo(0.03, 10);
    expect(10.09 - 10).toBeCloseTo(0.09, 10);
    // The split sums to the whole, within one-decimal rounding.
    expect(Math.abs(6.2 + 4.3 - 10.5)).toBeLessThan(0.1);
    expect(9.97 - 8).toBeCloseTo(1.97, 10);
  });

  it("keeps the metadata description free of validation overclaims", () => {
    expect(metadata.description).toMatch(/run against all 856 Colorado cases/);
    expect(metadata.description).not.toMatch(/validated/i);
  });
});
