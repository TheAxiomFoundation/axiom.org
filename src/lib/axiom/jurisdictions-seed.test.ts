import { describe, expect, it } from "vitest";
import { jurisdictionLabel } from "./jurisdictions-seed";

describe("jurisdictionLabel", () => {
  it("prefers the curated seed name over the ISO country name", () => {
    expect(jurisdictionLabel("us")).toBe("US Federal");
    expect(jurisdictionLabel("us-co")).toBe("Colorado");
    expect(jurisdictionLabel("il")).toBe("Israel");
  });

  it("names unseeded countries from their ISO 3166 code", () => {
    expect(jurisdictionLabel("de")).toBe("Germany");
    expect(jurisdictionLabel("et")).toBe("Ethiopia");
    expect(jurisdictionLabel("ug")).toBe("Uganda");
    expect(jurisdictionLabel("tz")).toBe("Tanzania");
    expect(jurisdictionLabel("zm")).toBe("Zambia");
    expect(jurisdictionLabel("dk")).toBe("Denmark");
  });

  it("keeps the extra mirror labels", () => {
    expect(jurisdictionLabel("uk-kingston-upon-thames")).toBe(
      "Kingston upon Thames"
    );
  });

  it("qualifies unseeded subdivisions with their country", () => {
    expect(jurisdictionLabel("de-by")).toBe("Germany · BY");
    expect(jurisdictionLabel("ca-quebec")).toBe("Canada · Quebec");
  });

  it("humanizes slugs that are not country codes at all", () => {
    expect(jurisdictionLabel("xx")).toBe("XX");
    expect(jurisdictionLabel("some-thing")).toBe("Some Thing");
    expect(jurisdictionLabel("")).toBe("");
  });
});
