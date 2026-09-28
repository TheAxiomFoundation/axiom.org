import { describe, it, expect } from "vitest";
import { baseDirection } from "./text-direction";

describe("baseDirection", () => {
  it("reads the first strong character, skipping digits and punctuation", () => {
    expect(baseDirection("(1) על כל שקל חדש")).toBe("rtl");
    expect(baseDirection("(א) המס על הכנסתו")).toBe("rtl");
    expect(baseDirection("(a) Allowance of credit")).toBe("ltr");
    expect(baseDirection("31% – NIS על כל")).toBe("ltr");
    expect(baseDirection("§ 121 شروط")).toBe("rtl");
  });

  it("returns null when nothing decides it", () => {
    expect(baseDirection("")).toBeNull();
    expect(baseDirection("(1) 31% – 47.")).toBeNull();
  });
});
