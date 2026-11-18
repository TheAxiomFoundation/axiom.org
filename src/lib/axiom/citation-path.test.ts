import { describe, expect, it } from "vitest";
import { enDashCitationSegments } from "./citation-path";

const EN = String.fromCharCode(0x2013);

describe("enDashCitationSegments", () => {
  it("swaps every hyphen in the segments after the document type", () => {
    expect(
      enDashCitationSegments(["us", "statute", "42", "1395w-113", "a-1-b"])
    ).toEqual(["us", "statute", "42", `1395w${EN}113`, `a${EN}1${EN}b`]);
  });

  it("keeps the jurisdiction slug and the document type as given", () => {
    expect(enDashCitationSegments(["us-mt", "doc-type", "15-1-1"])).toEqual([
      "us-mt",
      "doc-type",
      `15${EN}1${EN}1`,
    ]);
  });

  it("returns the same segments when there is no hyphen to swap", () => {
    expect(enDashCitationSegments(["us", "statute", "26", "32"])).toEqual([
      "us",
      "statute",
      "26",
      "32",
    ]);
    expect(enDashCitationSegments(["us-mt"])).toEqual(["us-mt"]);
    expect(enDashCitationSegments([])).toEqual([]);
  });
});
