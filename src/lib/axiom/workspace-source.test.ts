import { describe, expect, it } from "vitest";
import { sourceDisplayHeading } from "./workspace-source";

describe("sourceDisplayHeading", () => {
  it("does not promote clause opening text into a title", () => {
    expect(sourceDisplayHeading("Households receiving assistance;", "(a) Households receiving assistance;")).toBeNull();
    const sentence = "Categorically eligible households are exempted from the gross and net income limits.";
    expect(sourceDisplayHeading(sentence, `(i) ${sentence} Other requirements apply.`)).toBeNull();
    expect(sourceDisplayHeading(sentence, sentence + " Other requirements apply.")).toBeNull();
  });
  it("preserves genuine titles and handles missing text", () => {
    expect(sourceDisplayHeading("Eligibility", "(a) Households receiving assistance;")).toBe("Eligibility");
    expect(sourceDisplayHeading("Definitions", "Definitions\nThe following terms apply.")).toBe("Definitions");
    expect(sourceDisplayHeading(null, "(a) Untitled clause")).toBeNull();
    expect(sourceDisplayHeading("Resource limits", null)).toBe("Resource limits");
  });
});
