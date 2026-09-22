import { describe, expect, it } from "vitest";
import { COVERAGE_COPY, coverageStatusWord, displayStatus, linesSha256, partitionRateLines, rateLineClass, rateLineClassNote, type TariffLine } from "./tariff-coverage";

const line = (path: string, generalDisposition: string, column2Disposition: string): TariffLine => ({
  hts10: path.replace(/\D/g, "").padEnd(10, "0"), displayCode: path, description: "", generalRate: "", column2Rate: "",
  generalDisposition, column2Disposition, memberships: [], canada338Warning: false,
  citations: [{ field: "General rate", path: `/us/statute/hts/${path}`, excerpt: "" }],
});

describe("tariff coverage vocabulary", () => {
  it("maps every closure-ledger status to a page word and rejects unknown ones", () => {
    expect(["encoded", "partially-encoded", "pending", "excluded-with-reason"].map(coverageStatusWord)).toEqual(["encoded", "partially encoded", "pending", "excluded"]);
    expect(() => coverageStatusWord("certified")).toThrow(/unknown closure ledger status/);
    expect(displayStatus("partially encoded")).toBe("Partially encoded");
  });

  it("keeps every scope note short and counts only where the ledger gives one", () => {
    for (const [family, copy] of Object.entries(COVERAGE_COPY)) {
      expect(copy.note.length, family).toBeLessThanOrEqual(200);
      expect(copy.note.split("{count}").length, family).toBeLessThanOrEqual(2);
    }
  });
});

describe("rate line partition", () => {
  it("encodes lines whose columns are both ad valorem or Free, outside 9802", () => {
    expect(rateLineClass(line("0101.21.00", "free", "free"))).toBe("encoded");
    expect(rateLineClass(line("0101.29.00", "ad_valorem", "free"))).toBe("encoded");
  });

  it("treats any other disposition, and every 9802 line, as partially encoded", () => {
    expect(rateLineClass(line("2203.00.00", "free", "specific"))).toBe("partially encoded");
    expect(rateLineClass(line("0101.30.00.00", "empty", "ad_valorem"))).toBe("partially encoded");
    expect(rateLineClass(line("9802.00.20.00", "free", "free"))).toBe("partially encoded");
    expect(rateLineClass({ generalDisposition: "free", column2Disposition: "free", citations: [] })).toBe("encoded");
  });

  it("says which columns the chapter compositions carry", () => {
    expect(rateLineClassNote(line("0101.21.00", "free", "ad_valorem"))).toBe("Both columns are ad valorem or Free, and the chapter composition carries both rates.");
    expect(rateLineClassNote(line("2203.00.00", "free", "specific"))).toBe("The column 2 rate is specific, so it is not applied; the chapter composition carries the general rate.");
    expect(rateLineClassNote(line("0101.30.00.00", "empty", "ad_valorem"))).toBe("The general rate is empty, so it is not applied; the chapter composition carries the column 2 rate.");
    expect(rateLineClassNote(line("0201.10.05", "compound", "conditional"))).toBe("The general rate is compound and the column 2 rate is conditional, so they are not applied.");
    expect(rateLineClassNote(line("9802.00.20.00", "free", "free"))).toBe("9802 lines need a partial-value duty base, which is not applied.");
  });

  it("returns citation paths without the leading slash, digested like the ledger", () => {
    const lines = [line("9802.00.20.00", "free", "free"), line("0101.21.00", "free", "free")];
    expect(partitionRateLines(lines)).toEqual({ encoded: ["us/statute/hts/0101.21.00"], partial: ["us/statute/hts/9802.00.20.00"] });
    // sha256("a\nb\n"): sorted, newline-joined, trailing newline.
    expect(linesSha256(["b", "a"])).toBe("911169ddaaf146aff539f58c26c489af3b892dff0fe283c1c264c65ae5aa59a2");
  });
});
