import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RootInputSlot } from "./api";
import type { ScenarioValue } from "./input-meta";
import { answerFits, answerKind, catalogAnswerMeta, censusAnswerMeta, fittingAnswers } from "./input-meta";

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

  it("keeps inputs named like Object.prototype members", () => {
    const census = censusAnswerMeta([
      { name: "valueOf", sample: 2 },
      { name: "toString", sample: true },
    ]);
    expect(Object.entries(census.dtypes)).toEqual([["valueOf", "number"], ["toString", "bool"]]);
    const meta = catalogAnswerMeta(
      [
        { name: "constructor", dtype: "decimal", default: 1, entity: "Person" },
        { name: "toString", dtype: "text", default: "a", entity: "Person" },
        { name: "valueOf", dtype: "date", default: "2026-01-01", entity: "Person" },
        // A date slot the census never saw: a number field with no default.
        { name: "hasOwnProperty", dtype: "date", default: "2026-01-01", entity: "Person" },
        // Free text: Object.prototype.isPrototypeOf has a length, the slot no suggestions.
        { name: "isPrototypeOf", dtype: "text", default: "", entity: "Person" },
      ],
      census,
    );
    expect(Object.entries(meta.dtypes)).toEqual([
      ["constructor", "number"],
      ["toString", "text"],
      ["valueOf", "number"],
      ["hasOwnProperty", "number"],
      ["isPrototypeOf", "text"],
    ]);
    expect(Object.entries(meta.defaults)).toEqual([
      ["constructor", 1],
      ["toString", "a"],
      ["valueOf", 2],
      ["hasOwnProperty", undefined],
      ["isPrototypeOf", ""],
    ]);
    // No inherited member reads as a choice list or a set of suggestions.
    expect(answerKind(meta, "constructor")).toBe("number");
    expect(answerKind(meta, "toString")).toBe("text");
    expect(answerKind(meta, "isPrototypeOf")).toBe("text");
    expect(answerKind(meta, "propertyIsEnumerable")).toBe("number");
    expect(answerFits(meta, "toString", "b")).toBe(true);
    expect(answerFits(meta, "constructor", 3)).toBe(true);
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

describe("answer types", () => {
  const meta = catalogAnswerMeta(
    [...WELLINGTON_CATALOG, { name: "eligible", dtype: "bool", default: false, entity: "Person" }],
    censusAnswerMeta([]),
  );

  it("fits text to a text slot, a boolean to a bool and a number to anything else", () => {
    expect(answerFits(meta, "wcc_supermarket_zone", "MUZ")).toBe(true);
    expect(answerFits(meta, "wcc_supermarket_zone", 5)).toBe(false);
    expect(answerFits(meta, "eligible", true)).toBe(true);
    expect(answerFits(meta, "eligible", 1)).toBe(false);
    expect(answerFits(meta, "wcc_proposed_supermarket_gfa_m2", 2000)).toBe(true);
    expect(answerFits(meta, "wcc_proposed_supermarket_gfa_m2", "2000")).toBe(false);
  });

  it("drops a number typed into the census's zone field once the catalog makes the zone text", () => {
    const census = censusAnswerMeta(WELLINGTON_CENSUS);
    // Until the catalog arrives, the census shows every input as a number field.
    const typed: Record<string, ScenarioValue> = { wcc_supermarket_zone: 5, wcc_proposed_supermarket_gfa_m2: 2000, scope: 1 };
    expect(fittingAnswers(typed, Object.keys(census.dtypes), census)).toEqual(typed);
    const catalog = catalogAnswerMeta(WELLINGTON_CATALOG, census);
    expect(fittingAnswers(typed, Object.keys(catalog.dtypes), catalog)).toEqual({ wcc_proposed_supermarket_gfa_m2: 2000 });
    expect(fittingAnswers({ wcc_supermarket_zone: "MUZ" }, Object.keys(catalog.dtypes), catalog)).toEqual({
      wcc_supermarket_zone: "MUZ",
    });
  });
});

describe("catalogAnswerMeta invariants", () => {
  // Names Object.prototype also defines come up often enough to matter.
  const name = fc.oneof(
    { weight: 4, arbitrary: fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/) },
    { weight: 1, arbitrary: fc.constantFrom("constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf") },
  );
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
          // A select over fixed numbers only where the first slot by that
          // name declares its choices.
          const first = slots.find((item) => item.name === key)!;
          const declared = (first.dtype === "integer" || first.dtype === "decimal") && (first.choices?.length ?? 0) > 0;
          expect(kind === "choice").toBe(declared);
          const suggested = first.dtype === "text" && (first.values ?? []).some((item) => typeof item === "string" && item !== "");
          expect(kind === "text-choice").toBe(suggested);
        }
      }),
      { numRuns: 300, seed: 2026110311 },
    );
  });

  it("keeps exactly the answers that have a field and the type its control returns", () => {
    const value: fc.Arbitrary<ScenarioValue> = fc.oneof(fc.string({ maxLength: 3 }), fc.double(), fc.boolean());
    // The type each control hands back: a select of fixed numbers and a
    // number field both return numbers.
    const returns = { bool: "boolean", text: "string", "text-choice": "string", choice: "number", integer: "number", number: "number" };
    fc.assert(
      fc.property(
        fc.array(slot, { maxLength: 6 }),
        fc.array(censusInput, { maxLength: 6 }),
        fc.array(fc.tuple(name, value), { maxLength: 8 }),
        fc.array(name, { maxLength: 8 }),
        (slots, census, entries, fields) => {
          const meta = catalogAnswerMeta(slots, censusAnswerMeta(census));
          const answers: Record<string, ScenarioValue> = {};
          for (const [key, item] of entries) Object.defineProperty(answers, key, { value: item, enumerable: true, writable: true, configurable: true });
          const kept = fittingAnswers(answers, fields, meta);
          for (const [key, item] of Object.entries(kept)) {
            expect(fields).toContain(key);
            expect(Object.is(item, answers[key])).toBe(true);
          }
          for (const key of new Set(fields)) {
            const fits = Object.hasOwn(answers, key) && typeof answers[key] === returns[answerKind(meta, key)];
            expect(Object.hasOwn(kept, key)).toBe(fits);
          }
        },
      ),
      { numRuns: 300, seed: 2026110312 },
    );
  });
});
