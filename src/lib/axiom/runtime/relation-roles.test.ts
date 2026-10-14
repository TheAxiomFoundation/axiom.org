import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  classifyRelations,
  defaultRoles,
  describeRelation,
  flattenRoles,
  instanceIdTemplate,
  instanceKindsOf,
  instancesConfirmed,
  kindStem,
  MAX_KIND_INSTANCES,
  membershipTuples,
  reconcileRoles,
  relationLabel,
  rolesForRun,
  scenarioInstances,
  upstreamAcceptsExplicitRoles,
  upstreamAllocatesInstances,
  upstreamRelationsMatch,
  UNIT_INSTANCE,
} from "./relation-roles";

const UNITS = ["TaxUnit", "Household", "TanfUnit"] as const;
const decl = (file: string, name: string, args: unknown[]) =>
  describeRelation({ name, kind: "data_relation", data_relation: { arity: args.length, arguments: args } }, file);

/** Distinct supported relations, each with the Person slot first or second. */
const relationsArb = fc
  .uniqueArray(
    fc.record({
      file: fc.constantFrom("us:statutes/26/32", "us:statutes/26/151", "us:statutes/26/7703", "us-co:regulations/x"),
      name: fc.stringMatching(/^[a-z][a-z_]{0,20}$/),
      unit: fc.constantFrom(...UNITS),
      personFirst: fc.boolean(),
    }),
    { selector: (item) => `${item.file}#${item.name}`, minLength: 1, maxLength: 6 },
  )
  .map((items) => items.map((item) => decl(item.file, item.name, item.personFirst ? ["Person", item.unit] : [item.unit, "Person"])));

/** A household (person_1 plus up to 11 others, any ids, any order) and a role answer per relation. */
const scenarioArb = relationsArb.chain((relations) =>
  fc
    .shuffledSubarray(["person_2", "person_3", "person_4", "person_5", "person_7", "person_9", "person_12"])
    .chain((extra) => {
      const order = ["person_1", ...extra];
      return fc
        .tuple(...relations.map(() => fc.subarray(order)))
        .map((picks) => ({ relations, order, membership: Object.fromEntries(relations.map((relation, index) => [relation.legalId, picks[index]!])) }));
    }),
);

describe("membershipTuples (explicit relation roles → engine tuples)", () => {
  it("sends every declared relation once, with one tuple per member in declared slot order, and round-trips", () => {
    fc.assert(
      fc.property(scenarioArb, ({ relations, order, membership }) => {
        const result = membershipTuples(relations, membership, order);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // One entry per declared relation, empty ones included: an omitted
        // relation would fall back to the convention upstream.
        expect(result.entries.map((entry) => entry.name)).toEqual(relations.map((relation) => relation.relationId));
        const decoded = new Map<string, Set<string>>();
        for (const { name, tuples } of result.entries) {
          const relation = relations.find((item) => item.relationId === name)!;
          expect(tuples).toHaveLength(new Set(membership[relation.legalId]).size);
          for (const tuple of tuples) {
            // Exactly one person and the unit instance, each in its declared slot.
            expect(tuple[1 - relation.personSlot!]).toBe(UNIT_INSTANCE);
            const person = tuple[relation.personSlot!]!;
            expect(person).toMatch(/^person:1:\d+$/);
            // person:1:N is the member's position in household request order.
            const member = order[Number(person.split(":")[2]) - 1]!;
            decoded.set(relation.legalId, (decoded.get(relation.legalId) ?? new Set()).add(member));
          }
        }
        for (const relation of relations) {
          expect([...(decoded.get(relation.legalId) ?? [])].sort()).toEqual([...new Set(membership[relation.legalId])].sort());
        }
      }),
    );
  });

  it("refuses incomplete answers, unknown relations and absent members instead of dropping them", () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), ({ relations, order, membership }, pick) => {
        const missing = relations[pick % relations.length]!.legalId;
        const { [missing]: _omitted, ...incomplete } = membership;
        expect(membershipTuples(relations, incomplete, order)).toMatchObject({ ok: false, error: "relation_roles_required" });
        expect(membershipTuples(relations, { ...membership, "us:other#rel": [] }, order)).toMatchObject({ ok: false, error: "unknown_relation" });
        const absent = ["person_6", "person_8", "person_10", "person_11", "person_13", "person_0", "spouse"].find((id) => !order.includes(id))!;
        expect(membershipTuples(relations, { ...membership, [missing]: [absent] }, order)).toMatchObject({ ok: false, error: "unknown_member" });
      }),
    );
    expect(membershipTuples([], undefined, ["person_1"])).toMatchObject({ ok: false, error: "relation_roles_required" });
  });

  it("puts the 26 USC 32 qualifying child — not the filer — in the relation", () => {
    const relations = [decl("us:statutes/26/32", "qualifying_child_of_tax_unit", ["TaxUnit", "Person"]), decl("us:statutes/26/151", "exemption_individual_of_tax_unit", ["TaxUnit", "Person"])];
    const result = membershipTuples(relations, {
      "us:statutes/26/32#qualifying_child_of_tax_unit": ["person_2"],
      "us:statutes/26/151#exemption_individual_of_tax_unit": ["person_1", "person_2"],
    }, ["person_1", "person_2"]);
    expect(result).toEqual({ ok: true, entries: [
      { name: "us:statutes/26/32#relation.qualifying_child_of_tax_unit", tuples: [["household:1", "person:1:2"]] },
      { name: "us:statutes/26/151#relation.exemption_individual_of_tax_unit", tuples: [["household:1", "person:1:1"], ["household:1", "person:1:2"]] },
    ] });
  });

  it("sends an unticked relation as explicitly empty", () => {
    const relations = [decl("us:statutes/26/32", "qualifying_child_of_tax_unit", ["TaxUnit", "Person"]), decl("us:statutes/26/63/c/5", "exemption_individual_of_another_tax_unit", ["TaxUnit", "Person"])];
    const result = membershipTuples(relations, {
      "us:statutes/26/32#qualifying_child_of_tax_unit": ["person_2"],
      "us:statutes/26/63/c/5#exemption_individual_of_another_tax_unit": [],
    }, ["person_1", "person_2"]);
    expect(result).toMatchObject({ ok: true, entries: [
      { name: "us:statutes/26/32#relation.qualifying_child_of_tax_unit", tuples: [["household:1", "person:1:2"]] },
      { name: "us:statutes/26/63/c/5#relation.exemption_individual_of_another_tax_unit", tuples: [] },
    ] });
  });
});

describe("relation declarations", () => {
  it("supports one Person, or one per-request kind, beside one modelled unit, in either order", () => {
    const entities = fc.constantFrom("Person", "TaxUnit", "Household", "TanfUnit", "Payment", "SnapUnit", null);
    fc.assert(
      fc.property(fc.array(entities, { maxLength: 3 }), (args) => {
        const relation = decl("us:x", "r", args.map((entity) => (entity === null ? { name: "slot" } : entity)));
        const persons = args.filter((entity) => entity === "Person").length;
        const units = args.filter((entity) => entity !== null && (UNITS as readonly string[]).includes(entity)).length;
        const others = args.filter((entity) => entity === "Payment" || entity === "SnapUnit").length;
        const personUnit = args.length === 2 && persons === 1 && units === 1;
        const unitInstance = args.length === 2 && persons === 0 && units === 1 && others === 1;
        expect(relation.supported).toBe(personUnit || unitInstance);
        if (personUnit) {
          expect(args[relation.personSlot!]).toBe("Person");
          expect(relation.instanceEntity).toBeUndefined();
        }
        if (unitInstance) {
          expect(relation.personSlot).toBeUndefined();
          expect(args[relation.instanceSlot!]).toBe(relation.instanceEntity);
          expect(relation.unitEntity).toBe(args[1 - relation.instanceSlot!]);
        }
      }),
    );
  });

  it("classifies by shape: any unrepresentable relation refuses; two or more, or any unit–instance one, need roles", () => {
    fc.assert(
      fc.property(relationsArb, fc.constantFrom("none", "payment", "poison"), (relations, extra) => {
        const all =
          extra === "payment"
            ? [...relations, decl("us:statutes/26/22", "section_22_payment_of_tax_unit", ["TaxUnit", "Payment"])]
            : extra === "poison"
              ? [...relations, decl("us:x", "payee", ["Person", "Payment"])]
              : relations;
        expect(classifyRelations(all)).toBe(
          extra === "poison" ? "relationships_unsupported" : extra === "payment" || relations.length > 1 ? "roles_required" : "ready",
        );
      }),
    );
  });

  it("labels from the declaration, never from guesses", () => {
    expect(relationLabel({ name: "qualifying_child_of_tax_unit" })).toBe("Qualifying child of tax unit");
    expect(relationLabel({ name: "ctc_qualifying_child_of_tax_unit" })).toBe("CTC qualifying child of tax unit");
    expect(relationLabel({ name: "x", label: "Spouse on the return" })).toBe("Spouse on the return");
    expect(describeRelation({ name: "r", data_relation: { arity: 2, arguments: [{ name: "member", entity: "Person" }, { entity: "Household" }] } }, "us:x")).toMatchObject({ supported: true, personSlot: 0, unitEntity: "Household", relationId: "us:x#relation.r" });
  });
});

describe("scenario roles", () => {
  it("send exactly the closure's relations, limited to present people, in household order", () => {
    fc.assert(
      fc.property(scenarioArb, fc.array(fc.constantFrom("person_6", "person_8"), { maxLength: 2 }), ({ relations, order, membership }, ghosts) => {
        const stale: Record<string, string[]> = { ...membership, "us:gone#old": ["person_1"] };
        for (const relation of relations) stale[relation.legalId] = [...ghosts, ...[...membership[relation.legalId]!].reverse()];
        const sent = rolesForRun(relations, stale, order);
        expect(Object.keys(sent).sort()).toEqual(relations.map((relation) => relation.legalId).sort());
        for (const relation of relations) {
          expect(sent[relation.legalId]).toEqual(order.filter((id) => membership[relation.legalId]!.includes(id)));
        }
        expect(membershipTuples(relations, sent, order).ok).toBe(true);
      }),
    );
  });

  it("start empty and mark any change of membership in the scenario key", () => {
    fc.assert(
      fc.property(scenarioArb, ({ relations, membership }) => {
        expect(Object.values(defaultRoles(relations)).every((members) => members.length === 0)).toBe(true);
        const changed = { ...membership, [relations[0]!.legalId]: membership[relations[0]!.legalId]!.length ? [] : ["person_1"] };
        expect(JSON.stringify(flattenRoles(changed))).not.toBe(JSON.stringify(flattenRoles(membership)));
      }),
    );
  });

  it("trusts only an upstream that advertises explicit membership", () => {
    expect(upstreamAcceptsExplicitRoles({ data: { relation_membership: ["convention", "explicit"] } })).toBe(true);
    for (const body of [null, {}, { data: {} }, { data: { relation_membership: "explicit" } }, { data: { relation_membership: ["convention"] } }, { data: { relation_membership_modes: ["explicit"] } }]) {
      expect(upstreamAcceptsExplicitRoles(body)).toBe(false);
    }
  });

  it("offers roles only when the runtime's relations are exactly the declared ones", () => {
    fc.assert(
      fc.property(relationsArb, fc.nat(), (relations, pick) => {
        const listed = relations.map((relation) => ({
          name: relation.relationId,
          slot_entities: relation.arguments,
          tuple: relation.personSlot === 0 ? ["person:1:{index}", "household:1"] : ["household:1", "person:1:{index}"],
          explicit: true,
        }));
        expect(upstreamRelationsMatch({ data: { relations: [...listed].reverse() } }, relations)).toBe(true);
        // A relation the runtime binds that the scenario would never name.
        expect(upstreamRelationsMatch({ data: { relations: [...listed, { name: "us:x#relation.extra" }] } }, relations)).toBe(false);
        // A declared relation the runtime does not bind.
        expect(upstreamRelationsMatch({ data: { relations: listed.filter((_, index) => index !== pick % listed.length) } }, relations)).toBe(false);
        // A relation the runtime only guesses (or does not mark) cannot take explicit roles.
        const at = pick % listed.length;
        expect(upstreamRelationsMatch({ data: { relations: listed.map((r, i) => (i === at ? { ...r, explicit: false } : r)) } }, relations)).toBe(false);
        expect(upstreamRelationsMatch({ data: { relations: listed.map((r, i) => (i === at ? { name: r.name, slot_entities: r.slot_entities, tuple: r.tuple } : r)) } }, relations)).toBe(false);
        // A runtime slot layout that disagrees with the declaration.
        expect(upstreamRelationsMatch({ data: { relations: listed.map((r, i) => (i === at ? { ...r, tuple: [...r.tuple].reverse() } : r)) } }, relations)).toBe(false);
      }),
    );
    for (const body of [null, {}, { data: {} }, { data: { relations: "x" } }, { data: { relations: [{}] } }]) {
      expect(upstreamRelationsMatch(body, [decl("us:x", "r", ["TaxUnit", "Person"])])).toBe(false);
    }
  });
});

describe("reconcileRoles (re-reading the same scope's catalog)", () => {
  it("keeps every answer whose relation is still declared, drops departed ones, and leaves new ones unanswered", () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), fc.boolean(), ({ relations, membership }, pick, addNew) => {
        const departed = relations[pick % relations.length]!;
        const added = decl("us:statutes/26/99", "newly_declared", ["TaxUnit", "Person"]);
        const next = [...relations.filter((relation) => relation !== departed), ...(addNew ? [added] : [])];
        const kept = reconcileRoles(membership, next);
        for (const relation of next) {
          if (relation === added) expect(kept[relation.legalId]).toBeUndefined();
          else expect(kept[relation.legalId]).toEqual(membership[relation.legalId]);
        }
        expect(kept[departed.legalId]).toBeUndefined();
        // A new relation stays unanswered here. membershipTuples refuses an
        // unanswered relation; the client's rolesForRun sends it as empty,
        // the same starting state every relation has in a fresh scope.
        if (addNew) {
          expect(membershipTuples(next, kept, ["person_1"])).toMatchObject({ ok: false, error: "relation_roles_required" });
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Unit–instance relations (26 USC 22's section_22_payment_of_tax_unit):
// the scenario allocates per-request instances (payments) and links them.
//
// Invariants (fast-check):
//   P1 Every declared relation is sent once; an instance relation carries one
//      tuple per distinct linked key, the unit and the key in declared slots,
//      and decoding the tuples returns exactly the linked keys (round trip).
//   P2 Links name only instances the scenario holds, of the relation's kind;
//      anything else is refused (unknown_instance), never dropped.
//   P3 A run sends exactly the closure's relations, links limited to the
//      present instances of each relation's kind, in scenario order.
//   P4 Every kind the scope allocates travels (an empty object for none);
//      kinds the scope does not allocate and malformed keys are refused.
//   P5 Roles are offered only when the runtime allocates each kind with the
//      declared template and lists every relation in its declared layout.
//   P6 A result is shown only when the echo names every instance sent.
// ---------------------------------------------------------------------------

const PAY = decl("us:statutes/26/22", "section_22_payment_of_tax_unit", ["TaxUnit", "Payment"]);
const FILER = decl("us:statutes/26/22", "taxpayer_or_spouse_of_tax_unit", ["TaxUnit", "Person"]);
const sanitizeAll = (values: unknown) => ({
  sanitized: Object.fromEntries(Object.entries(values as Record<string, unknown>).filter(([, value]) => typeof value === "number" || typeof value === "boolean")) as Record<string, number | boolean>,
  rejected: Object.entries(values as Record<string, unknown>).filter(([, value]) => typeof value !== "number" && typeof value !== "boolean").map(([name]) => name),
});

/** A scenario with 0..12 payments (any keys of the kind's pattern, any
 *  order) and a link answer per instance relation, in either slot order. */
const instanceScenarioArb = fc
  .tuple(
    fc.shuffledSubarray(Array.from({ length: MAX_KIND_INSTANCES }, (_, index) => `payment_${index + 1}`)),
    fc.boolean(),
    fc.boolean(),
  )
  .chain(([keys, paymentFirst, withPeople]) => {
    const pay = decl("us:statutes/26/22", "payment_link", paymentFirst ? ["Payment", "TaxUnit"] : ["TaxUnit", "Payment"]);
    const relations = withPeople ? [FILER, pay] : [pay];
    return fc.tuple(fc.subarray(keys), fc.subarray(["person_1"])).map(([linked, filers]) => ({
      relations,
      pay,
      keys,
      membership: Object.fromEntries(relations.map((relation) => [relation.legalId, relation === pay ? linked : filers])),
    }));
  });

describe("unit–instance relations (payments of the tax unit)", () => {
  it("describes 26 USC 22's payment relation as a per-request Payment linked to the tax unit", () => {
    expect(PAY).toMatchObject({ supported: true, instanceEntity: "Payment", instanceSlot: 1, unitEntity: "TaxUnit" });
    expect(instanceKindsOf([FILER, PAY, PAY])).toEqual(["Payment"]);
    expect(kindStem("RetirementAccount")).toBe("retirement_account");
    expect(instanceIdTemplate("Payment")).toBe("payment:1:{index}");
  });

  it("P1: one entry per relation, one tuple per linked key in declared slots, round-tripping", () => {
    fc.assert(
      fc.property(instanceScenarioArb, ({ relations, pay, keys, membership }) => {
        const result = membershipTuples(relations, membership, ["person_1"], { Payment: keys });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.entries.map((entry) => entry.name)).toEqual(relations.map((relation) => relation.relationId));
        const entry = result.entries.find((item) => item.name === pay.relationId)!;
        expect(entry.tuples).toHaveLength(new Set(membership[pay.legalId]).size);
        for (const tuple of entry.tuples) {
          expect(tuple[1 - pay.instanceSlot!]).toBe(UNIT_INSTANCE);
          expect(keys).toContain(tuple[pay.instanceSlot!]);
        }
        expect(entry.tuples.map((tuple) => tuple[pay.instanceSlot!]).sort()).toEqual([...new Set(membership[pay.legalId])].sort());
      }),
    );
  });

  it("P2: refuses a link to an instance the scenario does not hold, or of another kind", () => {
    fc.assert(
      fc.property(instanceScenarioArb, fc.constantFrom("payment_13", "payment_0", "person_1", "asset_1", "pay_1", "household:1"), ({ relations, pay, keys, membership }, ghost) => {
        const absent = keys.length < MAX_KIND_INSTANCES ? Array.from({ length: MAX_KIND_INSTANCES }, (_, index) => `payment_${index + 1}`).find((key) => !keys.includes(key))! : ghost;
        for (const bad of [absent, ghost]) {
          if (keys.includes(bad)) continue;
          expect(membershipTuples(relations, { ...membership, [pay.legalId]: [bad] }, ["person_1"], { Payment: keys })).toMatchObject({ ok: false, error: "unknown_instance" });
        }
      }),
    );
  });

  it("P3: a run sends every relation, links limited to the payments present, in scenario order", () => {
    fc.assert(
      fc.property(instanceScenarioArb, fc.array(fc.constantFrom("payment_99", "person_1"), { maxLength: 2 }), ({ relations, pay, keys, membership }, ghosts) => {
        const stale = { ...membership, [pay.legalId]: [...ghosts, ...[...membership[pay.legalId]!].reverse()] };
        const sent = rolesForRun(relations, stale, ["person_1"], { Payment: keys });
        expect(Object.keys(sent).sort()).toEqual(relations.map((relation) => relation.legalId).sort());
        expect(sent[pay.legalId]).toEqual(keys.filter((key) => membership[pay.legalId]!.includes(key)));
        expect(membershipTuples(relations, sent, ["person_1"], { Payment: keys }).ok).toBe(true);
      }),
    );
  });

  it("P4: every allocated kind travels; foreign kinds, bad keys and too many instances are refused", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(Array.from({ length: MAX_KIND_INSTANCES }, (_, index) => `payment_${index + 1}`)), (keys) => {
        const raw = { Payment: Object.fromEntries(keys.map((key, index) => [key, { payment_amount: index * 100, flag: index % 2 === 0, note: "x" }])) };
        const result = scenarioInstances([FILER, PAY], raw, sanitizeAll);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.keys).toEqual({ Payment: keys });
        for (const key of keys) expect(result.instances.Payment![key]).not.toHaveProperty("note");
        expect(result.dropped).toEqual(keys.map((key) => `${key}:note`));
      }),
    );
    // No answers at all: the kind still travels, empty.
    expect(scenarioInstances([PAY], undefined, sanitizeAll)).toMatchObject({ ok: true, instances: { Payment: {} }, keys: { Payment: [] } });
    // A scope without unit–instance relations allocates nothing.
    expect(scenarioInstances([FILER], undefined, sanitizeAll)).toMatchObject({ ok: true, instances: {}, keys: {} });
    expect(scenarioInstances([PAY], { Asset: {} }, sanitizeAll)).toMatchObject({ ok: false, error: "unknown_instance_kind" });
    for (const key of ["person_2", "payment_13", "payment_x", "Payment_1", "__proto__"]) {
      expect(scenarioInstances([PAY], { Payment: JSON.parse(`{"${key}": {}}`) }, sanitizeAll)).toMatchObject({ ok: false, error: "unknown_instance" });
    }
    expect(scenarioInstances([PAY], { Payment: { payment_1: 5 } }, sanitizeAll)).toMatchObject({ ok: false, error: "unknown_instance" });
  });

  it("P5: offers roles only when the runtime allocates the kind and lists the relation in its declared layout", () => {
    fc.assert(
      fc.property(fc.boolean(), (paymentFirst) => {
        const pay = decl("us:statutes/26/22", "payment_link", paymentFirst ? ["Payment", "TaxUnit"] : ["TaxUnit", "Payment"]);
        const relations = [FILER, pay];
        const tuple = paymentFirst ? ["payment:1:{index}", "household:1"] : ["household:1", "payment:1:{index}"];
        const listed = [
          { name: FILER.relationId, tuple: ["household:1", "person:1:{index}"], explicit: true },
          { name: pay.relationId, tuple, explicit: true },
        ];
        const kinds = [{ entity: "Payment", id_template: "payment:1:{index}" }];
        expect(upstreamRelationsMatch({ data: { relations: listed, instance_kinds: kinds } }, relations)).toBe(true);
        expect(upstreamAllocatesInstances({ data: { instance_kinds: kinds } }, relations)).toBe(true);
        // A runtime that predates per-request instances.
        expect(upstreamRelationsMatch({ data: { relations: listed } }, relations)).toBe(false);
        expect(upstreamAllocatesInstances({ data: {} }, relations)).toBe(false);
        expect(upstreamAllocatesInstances({ data: { instance_kinds: [] } }, relations)).toBe(false);
        // A guessed or swapped Payment relation, or a different template.
        expect(upstreamRelationsMatch({ data: { relations: [listed[0], { ...listed[1], explicit: false }], instance_kinds: kinds } }, relations)).toBe(false);
        expect(upstreamRelationsMatch({ data: { relations: [listed[0], { ...listed[1], tuple: [...tuple].reverse() }], instance_kinds: kinds } }, relations)).toBe(false);
        expect(upstreamRelationsMatch({ data: { relations: listed, instance_kinds: [{ entity: "Payment", id_template: "payment:{index}" }] } }, relations)).toBe(false);
        expect(upstreamRelationsMatch({ data: { relations: [listed[0], { ...listed[1], tuple: tuple.map((part) => part.replace("payment", "pmt")) }], instance_kinds: [{ entity: "Payment", id_template: "pmt:1:{index}" }] } }, relations)).toBe(false);
      }),
    );
    // Scopes without unit–instance relations need no instance support.
    expect(upstreamAllocatesInstances({ data: {} }, [FILER])).toBe(true);
  });

  it("P6: a result counts only when the echo names every instance sent", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(["payment_1", "payment_2", "payment_3"]), fc.nat(), (keys, drop) => {
        const echo = { Payment: Object.fromEntries(keys.map((key, index) => [key, `payment:1:${index + 1}`])) };
        expect(instancesConfirmed(echo, { Payment: keys })).toBe(true);
        if (keys.length > 0) {
          const missing = keys[drop % keys.length]!;
          const { [missing]: _gone, ...rest } = echo.Payment;
          expect(instancesConfirmed({ Payment: rest }, { Payment: keys })).toBe(false);
        }
        expect(instancesConfirmed(null, { Payment: keys })).toBe(false);
        expect(instancesConfirmed({}, { Payment: keys })).toBe(false);
      }),
    );
    expect(instancesConfirmed(undefined, {})).toBe(true);
  });
});
