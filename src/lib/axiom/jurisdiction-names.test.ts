import { describe, expect, it } from "vitest";
import { jurisdictionName, ownLevelName } from "./jurisdiction-names";

describe("jurisdiction names", () => {
  it("names a country with what is under it, and its own level alone", () => {
    expect(jurisdictionName("us")).toBe("United States");
    expect(ownLevelName("us")).toBe("US Federal");
    expect(jurisdictionName("us-al")).toBe("Alabama");
    expect(jurisdictionName("de")).toBe("Germany");
    expect(ownLevelName("de")).toBe("Germany");
    expect(jurisdictionName("dk")).toBe("Denmark");
  });

  it("reads an unknown code from its own segments", () => {
    expect(jurisdictionName("uk-wakefield")).toBe("Wakefield");
    expect(jurisdictionName("xx")).toBe("Xx");
  });
});
