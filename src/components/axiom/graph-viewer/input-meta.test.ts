import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RootInputSlot } from "./api";
import { answerKind, catalogAnswerMeta, censusAnswerMeta } from "./input-meta";

// Wellington's supermarket rule as the API composed it before
// axiom-api#309: its formula scan read the words inside the text
// literals "Non-complying" and "Out of scope", so the census carried
// two inputs no formula reads, `complying` and `scope`.
const WELLINGTON_CENSUS = [
  { name: "wcc_supermarket_zone", sample: null },
  { name: "wcc_proposed_supermarket_gfa_m2", sample: null },
  { name: "complying", sample: null },
  { name: "scope", sample: null },
];
// GET /v1/runtime/root-inputs?root=nz:regulations/rma_district_plans/
// wellington_city/supermarket_zoning, 2026-11-03.
const WELLINGTON_CATALOG: RootInputSlot[] = [
  { name: "wcc_proposed_supermarket_gfa_m2", dtype: "decimal", default: 0, entity: "Person" },
  {
    name: "wcc_supermarket_zone",
    dtype: "text",
    default: "none",
    entity: "Person",
    values: ["CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ", "none"],
  },
];

describe("censusAnswerMeta", () => {
  it("types a boolean sample as bool and anything else as a number; the first sample wins", () => {
    expect(
      censusAnswerMeta([
        { name: "a", sample: true },
        { name: "b", sample: 3 },
        { name: "c" },
        { name: "a", sample: 7 },
      ]),
    ).toEqual({
      dtypes: { a: "bool", b: "number", c: "number" },
      defaults: { a: true, b: 3, c: undefined },
    });
  });
});

describe("catalogAnswerMeta: Wellington supermarket zoning", () => {
  const meta = catalogAnswerMeta(WELLINGTON_CATALOG, censusAnswerMeta(WELLINGTON_CENSUS));

  it("keeps exactly the catalog's inputs, so Complying and Scope never appear", () => {
    expect(Object.keys(meta.dtypes).sort()).toEqual([
      "wcc_proposed_supermarket_gfa_m2",
      "wcc_supermarket_zone",
    ]);
  });

  it("answers the zone from the plan's own codes and the area as a number", () => {
    expect(answerKind(meta, "wcc_supermarket_zone")).toBe("text-choice");
    expect(meta.defaults.wcc_supermarket_zone).toBe("none");
    expect(meta.textOptions?.wcc_supermarket_zone).toEqual([
      "CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ", "none",
    ]);
    expect(answerKind(meta, "wcc_proposed_supermarket_gfa_m2")).toBe("number");
    expect(meta.defaults.wcc_proposed_supermarket_gfa_m2).toBe(0);
  });
});

describe("catalogAnswerMeta", () => {
  it("types each dtype, and leaves dates on their census control", () => {
    const census = censusAnswerMeta([{ name: "start", sample: 5 }]);
    const meta = catalogAnswerMeta(
      [
        {
          name: "status",
          dtype: "integer",
          default: 2,
          entity: "TaxUnit",
          label: "Filing status",
          category: "Tax",
          order: 1,
          choices: [
            { value: 1, label: "Single" },
            { value: 2, label: "Joint" },
          ],
        },
        { name: "size", dtype: "integer", default: 1, entity: "Household" },
        { name: "amount", dtype: "decimal", default: "abc", entity: "Person" },
        { name: "eligible", dtype: "bool", default: "yes", entity: "Person" },
        // A non-string default and only empty literals: free text, default "".
        { name: "note", dtype: "text", default: 7, entity: "Person", values: ["", ""] },
        { name: "frequency", dtype: "text", default: "monthly", entity: "Person", values: [3, "weekly", "weekly"] },
        { name: "start", dtype: "date", default: "2026-01-01", entity: "Person" },
        { name: "end", dtype: "date", default: "2026-12-31", entity: "Person" },
      ],
      census,
    );
    expect(answerKind(meta, "status")).toBe("choice");
    expect(meta.options?.status).toEqual([1, 2]);
    expect(meta.optionLabels?.status).toEqual({ 1: "Single", 2: "Joint" });
    expect(meta.presentation?.status).toEqual({ label: "Filing status", category: "Tax", order: 1 });
    expect(answerKind(meta, "size")).toBe("integer");
    expect(answerKind(meta, "amount")).toBe("number");
    expect(meta.defaults.amount).toBe(0);
    expect(answerKind(meta, "eligible")).toBe("bool");
    expect(meta.defaults.eligible).toBe(true);
    expect(answerKind(meta, "note")).toBe("text");
    expect(meta.defaults.note).toBe("");
    expect(meta.textOptions?.note).toBeUndefined();
    expect(answerKind(meta, "frequency")).toBe("text-choice");
    expect(meta.textOptions?.frequency).toEqual(["weekly"]);
    expect(meta.dtypes.start).toBe("number");
    expect(meta.defaults.start).toBe(5);
    expect(meta.dtypes.end).toBe("number");
    expect(meta.defaults.end).toBeUndefined();
  });

  it("treats an empty catalog as authoritative: the root ingests nothing", () => {
    const meta = catalogAnswerMeta([], censusAnswerMeta(WELLINGTON_CENSUS));
    expect(meta.dtypes).toEqual({});
  });

  it("keeps the first slot when the catalog repeats a name", () => {
    const meta = catalogAnswerMeta(
      [
        { name: "zone", dtype: "text", default: "none", entity: "Person", values: ["A"] },
        { name: "zone", dtype: "bool", default: false, entity: "Person" },
      ],
      censusAnswerMeta([]),
    );
    expect(answerKind(meta, "zone")).toBe("text-choice");
    expect(meta.textOptions?.zone).toEqual(["A"]);
  });
});

describe("catalogAnswerMeta invariants", () => {
  const name = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);
  const slot: fc.Arbitrary<RootInputSlot> = fc.record(
    {
      name,
      dtype: fc.constantFrom("bool", "integer", "decimal", "text", "date", "money"),
      default: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      entity: fc.constant("Person"),
      values: fc.array(fc.oneof(fc.string({ maxLength: 4 }), fc.integer()), { maxLength: 5 }),
      choices: fc.array(fc.record({ value: fc.integer(), label: fc.string() }), { maxLength: 3 }),
    },
    { requiredKeys: ["name", "dtype", "default", "entity"] },
  );
  const censusInput = fc.record(
    { name, sample: fc.oneof(fc.boolean(), fc.integer(), fc.string(), fc.constant(null)) },
    { requiredKeys: ["name"] },
  );

  it("the catalog alone decides which inputs exist, and each gets a control of its type", () => {
    fc.assert(
      fc.property(fc.array(slot, { maxLength: 8 }), fc.array(censusInput, { maxLength: 8 }), (slots, census) => {
        const meta = catalogAnswerMeta(slots, censusAnswerMeta(census));
        const names = new Set(slots.map((item) => item.name));
        // A census name the catalog lacks never survives.
        expect(new Set(Object.keys(meta.dtypes))).toEqual(names);
        for (const [key, options] of Object.entries(meta.textOptions ?? {})) {
          expect(meta.dtypes[key]).toBe("text");
          expect(options.length).toBeGreaterThan(0);
          expect(options.every((option) => typeof option === "string" && option !== "")).toBe(true);
          expect(new Set(options).size).toBe(options.length);
        }
        for (const key of names) {
          const kind = answerKind(meta, key);
          const text = meta.dtypes[key] === "text";
          expect(kind === "text" || kind === "text-choice").toBe(text);
          if (text) expect(typeof meta.defaults[key]).toBe("string");
          if (kind === "choice") expect(meta.options?.[key]?.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300, seed: 2026110311 },
    );
  });
});
