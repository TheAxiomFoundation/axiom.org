import { describe, it, expect } from "vitest";
import {
  OFFICIAL_SOURCE_LABEL,
  sourceCreditForJurisdiction,
  sourceCreditForUrl,
  sourceLinkLabel,
} from "./source-attribution";

const WIKISOURCE_ITO =
  "https://he.wikisource.org/wiki/%D7%A4%D7%A7%D7%95%D7%93%D7%AA_%D7%9E%D7%A1_%D7%94%D7%9B%D7%A0%D7%A1%D7%94";

describe("sourceLinkLabel", () => {
  it("names the Open Law Book and never calls Wikisource official", () => {
    const label = sourceLinkLabel(WIKISOURCE_ITO);
    expect(label).toBe("Open Law Book (Hebrew Wikisource)");
    expect(label).not.toMatch(/official/i);
  });

  it("keeps the official label for government publishers", () => {
    for (const url of [
      "https://uscode.house.gov/32",
      "https://www.ecfr.gov/current/title-7/part-273",
      "https://www.legislation.gov.uk/ukpga/2012/5",
      "https://retsinformation.dk/eli/lta/2024/1",
      "https://www.canada.ca/en/revenue-agency.html",
    ]) {
      expect(sourceLinkLabel(url)).toBe(OFFICIAL_SOURCE_LABEL);
      expect(sourceCreditForUrl(url)).toBeNull();
    }
  });

  it("matches the host exactly, ignoring case", () => {
    expect(sourceLinkLabel("https://HE.WIKISOURCE.ORG/wiki/x")).toBe(
      "Open Law Book (Hebrew Wikisource)"
    );
    // A different Wikisource, or a lookalike host, is not the Open Law Book.
    expect(sourceLinkLabel("https://en.wikisource.org/wiki/x")).toBe(
      OFFICIAL_SOURCE_LABEL
    );
    expect(sourceLinkLabel("https://he.wikisource.org.example.com/x")).toBe(
      OFFICIAL_SOURCE_LABEL
    );
  });

  it("falls back on a missing or unparseable URL", () => {
    expect(sourceLinkLabel(null)).toBe(OFFICIAL_SOURCE_LABEL);
    expect(sourceLinkLabel(undefined)).toBe(OFFICIAL_SOURCE_LABEL);
    expect(sourceLinkLabel("not a url")).toBe(OFFICIAL_SOURCE_LABEL);
    expect(sourceCreditForUrl("")).toBeNull();
  });
});

describe("sourceCreditForJurisdiction", () => {
  it("credits the Open Law Book and Hasadna for Israel", () => {
    const credit = sourceCreditForJurisdiction("il");
    expect(credit).not.toBeNull();
    const links = credit!.credit.filter((part) => typeof part !== "string");
    expect(links).toEqual([
      {
        text: "Open Law Book",
        href: "https://he.wikisource.org/wiki/ספר_החוקים_הפתוח",
      },
      { text: "Hasadna", href: "https://www.hasadna.org.il/openlaw/" },
    ]);
    const sentence = credit!.credit
      .map((part) => (typeof part === "string" ? part : part.text))
      .join("");
    expect(sentence).toContain("ספר החוקים הפתוח");
    expect(sentence).toContain("Reshumot");
    // The consolidation is never described as the official text.
    expect(sentence).not.toMatch(/official (source|text|consolidation)/i);
    expect(sourceCreditForJurisdiction("IL")).toBe(credit);
  });

  it("returns null for jurisdictions ingested from official publishers", () => {
    for (const slug of ["us", "uk", "ca", "nz", "dk", "us-ca", "", null]) {
      expect(sourceCreditForJurisdiction(slug)).toBeNull();
    }
  });

  it("gives the reader link and the browse credit one shared record", () => {
    expect(sourceCreditForUrl(WIKISOURCE_ITO)).toBe(
      sourceCreditForJurisdiction("il")
    );
  });
});
