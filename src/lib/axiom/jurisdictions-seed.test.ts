import { describe, expect, it } from "vitest";

import {
  synthesiseJurisdiction,
  ukLocalAuthorityLabel,
} from "./jurisdictions-seed";

describe("synthesiseJurisdiction", () => {
  it("resolves UK billing authorities so their pages route to the reader", () => {
    for (const slug of [
      "uk-wigan",
      "uk-dudley",
      "uk-bath-and-north-east-somerset",
      "uk-bristol-city-of",
    ]) {
      expect(synthesiseJurisdiction(slug)).toMatchObject({
        slug,
        hasCitationPaths: true,
      });
    }
  });

  it("still resolves US states and rejects non-jurisdiction slugs", () => {
    expect(synthesiseJurisdiction("us-pr")).toMatchObject({ label: "PR" });
    expect(synthesiseJurisdiction("about")).toBeNull();
    expect(synthesiseJurisdiction("uk-")).toBeNull();
  });
});

describe("ukLocalAuthorityLabel", () => {
  it("titles authority names, keeping conjunctions lower case", () => {
    expect(ukLocalAuthorityLabel("uk-wigan")).toBe("Wigan");
    expect(ukLocalAuthorityLabel("uk-bath-and-north-east-somerset")).toBe(
      "Bath and North East Somerset"
    );
    expect(ukLocalAuthorityLabel("uk-newcastle-upon-tyne")).toBe(
      "Newcastle upon Tyne"
    );
    expect(ukLocalAuthorityLabel("uk-kingston-upon-thames")).toBe(
      "Kingston upon Thames"
    );
  });

  it("moves a trailing 'city of' into the conventional suffix", () => {
    expect(ukLocalAuthorityLabel("uk-bristol-city-of")).toBe(
      "Bristol, City of"
    );
  });
});
