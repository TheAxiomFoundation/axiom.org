import { describe, expect, it } from "vitest";
import { budgetedChunks, rowPayloadBytes } from "./budgeted-chunks.mjs";

const row = (yaml: string, name = "r") => ({
  rule_name: name,
  rule_yaml: yaml,
});

describe("rowPayloadBytes", () => {
  it("measures serialized UTF-8 bytes, not UTF-16 characters", () => {
    const ascii = row("x".repeat(10));
    const unicode = row("€".repeat(10));
    expect(rowPayloadBytes(unicode)).toBe(rowPayloadBytes(ascii) + 20);
  });

  it("counts JSON escaping", () => {
    expect(rowPayloadBytes(row('"'.repeat(4)))).toBe(
      rowPayloadBytes(row("x".repeat(4))) + 4,
    );
  });
});

describe("budgetedChunks", () => {
  it("bounds every chunk's serialized payload", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      row("€".repeat(40_000), `r${i}`),
    );
    const budget = 300_000;
    const chunks = budgetedChunks(rows, 200, budget);
    for (const chunk of chunks) {
      const payload = 2 + chunk.reduce((n, r) => n + rowPayloadBytes(r), 0);
      expect(payload).toBeLessThanOrEqual(budget);
    }
    expect(chunks.flat()).toEqual(rows);
  });

  it("splits exactly at the budget boundary", () => {
    const a = row("x".repeat(100), "a");
    const budget = 2 + rowPayloadBytes(a) * 2;
    const rows = [a, row("x".repeat(100), "b"), row("x".repeat(100), "c")];
    const chunks = budgetedChunks(rows, 200, budget);
    expect(chunks.map((c) => c.map((r) => r.rule_name))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("splits on the row bound for small rows and preserves order", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row("y", `r${i}`));
    const chunks = budgetedChunks(rows, 2, 700_000);
    expect(chunks.map((c) => c.map((r) => r.rule_name))).toEqual([
      ["r0", "r1"],
      ["r2", "r3"],
      ["r4"],
    ]);
  });

  it("ships a row over the whole budget alone, dropping nothing", () => {
    const rows = [
      row("s", "a"),
      row("z".repeat(2_000_000), "big"),
      row("s", "c"),
    ];
    const chunks = budgetedChunks(rows, 200, 700_000);
    expect(chunks.map((c) => c.map((r) => r.rule_name))).toEqual([
      ["a"],
      ["big"],
      ["c"],
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(budgetedChunks([], 200, 700_000)).toEqual([]);
  });
});
