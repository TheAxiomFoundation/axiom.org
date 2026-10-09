import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  classifyRelations,
  defaultRoles,
  describeRelation,
  flattenRoles,
  membershipTuples,
  reconcileRoles,
  relationLabel,
  rolesForRun,
  upstreamAcceptsExplicitRoles,
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
  it("supports exactly one Person slot beside one modelled unit, in either order", () => {
    const entities = fc.constantFrom("Person", "TaxUnit", "Household", "TanfUnit", "Payment", "SnapUnit", null);
    fc.assert(
      fc.property(fc.array(entities, { maxLength: 3 }), (args) => {
        const relation = decl("us:x", "r", args.map((entity) => (entity === null ? { name: "slot" } : entity)));
        const persons = args.filter((entity) => entity === "Person").length;
        const units = args.filter((entity) => entity !== null && (UNITS as readonly string[]).includes(entity)).length;
        expect(relation.supported).toBe(args.length === 2 && persons === 1 && units === 1);
        if (relation.supported) expect(args[relation.personSlot!]).toBe("Person");
      }),
    );
  });

  it("classifies by shape: any unrepresentable relation refuses, two or more need roles", () => {
    fc.assert(
      fc.property(relationsArb, fc.boolean(), (relations, poison) => {
        const all = poison ? [...relations, decl("us:statutes/26/22", "section_22_payment_of_tax_unit", ["TaxUnit", "Payment"])] : relations;
        expect(classifyRelations(all)).toBe(poison ? "relationships_unsupported" : relations.length === 1 ? "ready" : "roles_required");
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
