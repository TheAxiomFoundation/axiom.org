/**
 * Explicit Person↔unit relationship roles for run-by-root scenarios.
 *
 * Pure (no I/O, no React): the calculate route uses it to validate a
 * scenario's roles and build the engine tuples, and the Plane client uses
 * it for labels, defaults and stale-detection keys.
 *
 * Instance ids follow axiom-api's derived-package conventions: every
 * unit kind (TaxUnit, Household, TanfUnit) is the query instance
 * `household:1`, and Person N is `person:1:N`, counted in the request
 * order of `household.people`. A per-request instance kind (Payment in a
 * (TaxUnit, Payment) relation, axiom-api#268) has its own instances, which
 * the scenario allocates by key (`payment_1`, …) in `household.instances`;
 * its relation tuples name those keys and the runtime resolves them.
 */

import { DISPLAY_ACRONYMS } from "@/lib/display-acronyms";

/** Unit kinds whose single shared instance the scenario editor models. */
export const SUPPORTED_PERSON_UNITS = new Set(["TaxUnit", "Household", "TanfUnit"]);
export const UNIT_INSTANCE = "household:1";
/** Scenario member ids: person_1 (the flat facts) through person_12. */
export const MEMBER_ID_RE = /^person_(?:[1-9]|1[0-2])$/;
/** The most people a scenario holds (person_1 … person_12). */
export const MAX_ROLE_MEMBERS = 12;
/** The most instances of one per-request kind a scenario holds. */
export const MAX_KIND_INSTANCES = 12;
const ENTITY_KIND_RE = /^[A-Z][A-Za-z0-9]{0,63}$/;

/** `Payment` → `payment`, `RetirementAccount` → `retirement_account`: the
 *  stem of a kind's scenario keys (`payment_1`) and, in axiom-api, of its
 *  instance ids (`payment:1:{index}`). */
export function kindStem(entity: string): string {
  return entity.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Scenario keys for instances of `entity`: `payment_1` … `payment_12`. */
export function instanceKeyPattern(entity: string): RegExp {
  return new RegExp(`^${kindStem(entity)}_(?:[1-9]|1[0-2])$`);
}

/** The instance id template axiom-api allocates for `entity`. */
export function instanceIdTemplate(entity: string): string {
  return `${kindStem(entity)}:1:{index}`;
}

export interface RelationDecl {
  /** The declaring rule: `us:statutes/26/32#qualifying_child_of_tax_unit`. */
  legalId: string;
  /** The compiled relation id: `us:statutes/26/32#relation.qualifying_child_of_tax_unit`. */
  relationId: string;
  fileLegalId: string;
  name: string;
  arity: number | null;
  /** Declared slot entity per argument, in order; null when a slot is untyped. */
  arguments: Array<string | null>;
  /** A binary relation between exactly one Person slot and one supported
   *  unit slot, or between one supported unit slot and one per-request
   *  instance kind (any other entity kind). */
  supported: boolean;
  personSlot?: 0 | 1;
  /** Set on a unit–instance relation: the slot of the per-request kind. */
  instanceSlot?: 0 | 1;
  /** The per-request kind of a unit–instance relation (`Payment`). */
  instanceEntity?: string;
  unitEntity?: string;
  label?: string;
  description?: string;
  source?: string;
}

/** Relation legal id → the member ids in that relation. */
export type RoleMembership = Record<string, string[]>;

type RawRule = {
  name?: unknown;
  kind?: unknown;
  label?: unknown;
  description?: unknown;
  source?: unknown;
  data_relation?: { arity?: unknown; arguments?: unknown } | null;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** One declared data relation, typed from its source declaration only. */
export function describeRelation(rule: RawRule, fileLegalId: string): RelationDecl {
  const name = typeof rule.name === "string" ? rule.name : "";
  const relation = rule.data_relation ?? undefined;
  const arity = typeof relation?.arity === "number" ? relation.arity : null;
  const args = Array.isArray(relation?.arguments)
    ? relation.arguments.map((argument: unknown) =>
        typeof argument === "string"
          ? argument
          : argument && typeof argument === "object" && "entity" in argument &&
              typeof (argument as { entity: unknown }).entity === "string"
            ? (argument as { entity: string }).entity
            : null,
      )
    : [];
  const personSlots = args.flatMap((entity, index) => (entity === "Person" ? [index] : []));
  const unitSlots = args.flatMap((entity, index) =>
    entity && SUPPORTED_PERSON_UNITS.has(entity) ? [index] : [],
  );
  const binary = Boolean(name && arity === 2 && args.length === 2);
  const personUnit = binary && personSlots.length === 1 && unitSlots.length === 1;
  // A unit and one other non-Person kind: the other side is allocated per
  // request. Whether the runtime agrees is checked against its catalog
  // (upstreamRelationsMatch), never assumed.
  const otherSlot = unitSlots.length === 1 ? 1 - unitSlots[0]! : -1;
  const other = otherSlot >= 0 ? args[otherSlot] : null;
  const unitInstance =
    binary &&
    personSlots.length === 0 &&
    unitSlots.length === 1 &&
    typeof other === "string" &&
    ENTITY_KIND_RE.test(other) &&
    other !== "Household";
  const supported = personUnit || unitInstance;
  const decl: RelationDecl = {
    legalId: `${fileLegalId}#${name}`,
    relationId: `${fileLegalId}#relation.${name}`,
    fileLegalId,
    name,
    arity,
    arguments: args,
    supported,
  };
  if (personUnit) {
    decl.personSlot = personSlots[0] as 0 | 1;
    decl.unitEntity = args[unitSlots[0]!]!;
  } else if (unitInstance) {
    decl.instanceSlot = otherSlot as 0 | 1;
    decl.instanceEntity = other!;
    decl.unitEntity = args[unitSlots[0]!]!;
  }
  const label = text(rule.label), description = text(rule.description), source = text(rule.source);
  if (label) decl.label = label;
  if (description) decl.description = description;
  if (source) decl.source = source;
  return decl;
}

/** Human label: the declaration's own label, else its name in sentence
 *  case with the site's display acronyms ("CTC qualifying child of tax unit"). */
export function relationLabel(decl: Pick<RelationDecl, "name" | "label">): string {
  if (decl.label) return decl.label;
  const words = decl.name.split(/[-_\s]+/).filter(Boolean)
    .map((word) => (DISPLAY_ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word));
  if (!words.length) return decl.name;
  return [words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1), ...words.slice(1)].join(" ");
}

/**
 * "ready": no relation, or one supported Person relation (the membership
 * convention binds every person to it, which the person-unit runtime
 * checks verify). "roles_required": several supported relations, or any
 * unit–instance relation; the convention would bind every person to
 * every relation, and per-request instances (payments) exist only as the
 * scenario allocates and links them, so a run states every relation.
 * "relationships_unsupported": any relation the scenario cannot represent
 * (untyped, non-binary, Person–Person, Person–Payment, an unmodelled unit
 * kind).
 */
export function classifyRelations(
  relations: RelationDecl[],
): "ready" | "roles_required" | "relationships_unsupported" {
  if (relations.some((relation) => !relation.supported)) return "relationships_unsupported";
  const distinct = new Set(relations.map((relation) => relation.legalId));
  if (distinct.size !== relations.length) return "relationships_unsupported";
  if (relations.some((relation) => relation.instanceEntity)) return "roles_required";
  return relations.length <= 1 ? "ready" : "roles_required";
}

/** The per-request kinds a scope's relations allocate (`Payment`), in
 *  first-declared order. */
export function instanceKindsOf(relations: RelationDecl[]): string[] {
  return [...new Set(relations.flatMap((relation) => (relation.instanceEntity ? [relation.instanceEntity] : [])))];
}

/** Per-kind instance keys in scenario order: `{ Payment: ["payment_1"] }`. */
export type InstanceKeys = Record<string, string[]>;

/** One explicit relation, as axiom-api's `household.relations` takes it:
 *  the compiled relation id and its complete membership (`[]` = empty). */
export interface RelationEntry { name: string; tuples: string[][] }

export type MembershipResult =
  | { ok: true; entries: RelationEntry[] }
  | { ok: false; error: "relation_roles_required" | "unknown_relation" | "unknown_member" | "unknown_instance"; detail: string };

/**
 * Validate a scenario's roles against the closure's declared relations and
 * build one `household.relations` entry per declared relation, its tuples
 * in the relation's declared slot order. Every declared relation must be
 * answered and every one is sent, empty ones included: axiom-api replaces
 * the membership convention only for relations an entry names, so an
 * omitted relation would silently bind every person again. Unknown
 * relations and members are refused, never dropped.
 *
 * A unit–instance relation's answer is the instance keys linked to the
 * unit (`["payment_2"]`); each must be one the scenario allocates in
 * `instances`. Its tuples carry the key itself, which the runtime resolves
 * to the instance that entry's facts route to (and confirms by echoing
 * `allocated_instances`).
 */
export function membershipTuples(
  relations: RelationDecl[],
  membership: unknown,
  order: string[],
  instances: InstanceKeys = {},
): MembershipResult {
  if (!membership || typeof membership !== "object" || Array.isArray(membership)) {
    return { ok: false, error: "relation_roles_required", detail: "Relationship roles are required for this scope." };
  }
  const byId = new Map(relations.map((relation) => [relation.legalId, relation]));
  const answers = membership as Record<string, unknown>;
  for (const key of Object.keys(answers)) {
    if (!byId.has(key)) {
      // Echo only something shaped like a relation id, never arbitrary input.
      const detail = /^[\w:./#-]{1,256}$/.test(key) ? key : "an unrecognized relationship";
      return { ok: false, error: "unknown_relation", detail };
    }
  }
  const unanswered = relations.find((relation) => !Array.isArray(answers[relation.legalId]));
  if (unanswered) return { ok: false, error: "relation_roles_required", detail: unanswered.legalId };
  const entries: RelationEntry[] = [];
  for (const relation of relations) {
    const answer = answers[relation.legalId] as unknown[];
    // A scenario has at most 12 people; a longer answer cannot be honest.
    if (answer.length > MAX_ROLE_MEMBERS) {
      return { ok: false, error: "unknown_member", detail: `more than ${MAX_ROLE_MEMBERS} members` };
    }
    const tuples: string[][] = [];
    if (relation.instanceEntity && relation.instanceSlot !== undefined) {
      const keys = instances[relation.instanceEntity] ?? [];
      const pattern = instanceKeyPattern(relation.instanceEntity);
      for (const member of new Set(answer)) {
        if (typeof member !== "string" || !pattern.test(member) || !keys.includes(member)) {
          const detail = typeof member === "string" && /^[\w-]{1,32}$/.test(member) ? member : "an unrecognized instance id";
          return { ok: false, error: "unknown_instance", detail };
        }
        tuples.push(relation.instanceSlot === 0 ? [member, UNIT_INSTANCE] : [UNIT_INSTANCE, member]);
      }
      entries.push({ name: relation.relationId, tuples });
      continue;
    }
    for (const member of new Set(answer)) {
      const index = typeof member === "string" && MEMBER_ID_RE.test(member) ? order.indexOf(member) : -1;
      if (index < 0) {
        // Echo only something shaped like a member id, never arbitrary input.
        const detail = typeof member === "string" && /^[\w-]{1,32}$/.test(member) ? member : "an unrecognized member id";
        return { ok: false, error: "unknown_member", detail };
      }
      const person = `person:1:${index + 1}`;
      tuples.push(relation.personSlot === 0 ? [person, UNIT_INSTANCE] : [UNIT_INSTANCE, person]);
    }
    entries.push({ name: relation.relationId, tuples });
  }
  return { ok: true, entries };
}

/** Starting roles: nobody is in a relation until the scenario says so. */
export function defaultRoles(relations: RelationDecl[]): RoleMembership {
  return Object.fromEntries(relations.map((relation) => [relation.legalId, []]));
}

/** The roles a run sends: exactly the closure's relations, members limited
 *  to the people present (or, for a unit–instance relation, the instances
 *  of its kind present), in scenario order. */
export function rolesForRun(
  relations: RelationDecl[],
  roles: RoleMembership,
  members: string[],
  instances: InstanceKeys = {},
): RoleMembership {
  return Object.fromEntries(
    relations.map((relation) => [
      relation.legalId,
      (relation.instanceEntity ? instances[relation.instanceEntity] ?? [] : members).filter((member) =>
        roles[relation.legalId]?.includes(member),
      ),
    ]),
  );
}

/** Roles carried across a re-read of the same scope's catalog (a retry, or
 *  the relation set moving on the server): every answer whose relation is
 *  still declared is kept exactly, answers for relations that left are
 *  dropped, and a newly declared relation starts unanswered. */
export function reconcileRoles(roles: RoleMembership, relations: RelationDecl[]): RoleMembership {
  return Object.fromEntries(
    relations
      .filter((relation) => Array.isArray(roles[relation.legalId]))
      .map((relation) => [relation.legalId, [...roles[relation.legalId]!]]),
  );
}

/** Roles folded into scenario-identity keys, so a role edit marks results stale. */
export function flattenRoles(roles: RoleMembership): Record<string, boolean> {
  const flat: Record<string, boolean> = {};
  for (const [relation, members] of Object.entries(roles)) {
    for (const member of members) flat[`role:${relation}:${member}`] = true;
  }
  return flat;
}

/** Whether the upstream runtime honors explicit relation membership: its
 *  root-inputs payload lists "explicit" in `relation_membership`
 *  (axiom-api#267). A runtime without it only appends tuples to the
 *  membership convention, so absence means a roles_required scope cannot
 *  run. */
export function upstreamAcceptsExplicitRoles(body: unknown): boolean {
  const modes = (body as {data?: {relation_membership?: unknown}} | null)?.data?.relation_membership;
  return Array.isArray(modes) && modes.includes("explicit");
}

/** Whether the relations the runtime compiled for this root are exactly
 *  the ones the source declarations name, each one able to take explicit
 *  membership. The scenario sends one entry per
 *  declared relation; a relation the runtime binds but the scenario never
 *  names would keep the convention, and one the runtime lacks would be
 *  refused, so the two sets must agree before roles are offered. */
export function upstreamRelationsMatch(body: unknown, relations: RelationDecl[]): boolean {
  const data = (body as {data?: {relations?: unknown; instance_kinds?: unknown}} | null)?.data;
  const listed = data?.relations;
  if (!Array.isArray(listed)) return false;
  const declared = new Map(relations.map((relation) => [relation.relationId, relation]));
  // Per-request kinds the runtime allocates (axiom-api#268), by entity.
  const allocated = new Map<string, string>();
  if (Array.isArray(data?.instance_kinds)) {
    for (const item of data.instance_kinds) {
      const kind = item as {entity?: unknown; id_template?: unknown} | null;
      if (typeof kind?.entity === "string" && typeof kind.id_template === "string") {
        allocated.set(kind.entity, kind.id_template);
      }
    }
  }
  const upstream = new Set<string>();
  for (const entry of listed) {
    const relation = entry as {name?: unknown; explicit?: unknown; tuple?: unknown} | null;
    const name = relation?.name;
    if (typeof name !== "string") return false;
    // Only a relation the runtime marks able to take explicit membership
    // (axiom-api#267 `explicit: true`); a guessed shape would be refused.
    if (relation?.explicit !== true) return false;
    // The runtime's slot layout must be the declared one: the person (or
    // the per-request instance) in its declared slot, the unit instance in
    // the other.
    const decl = declared.get(name);
    const tuple = relation?.tuple;
    const memberSlot = decl?.personSlot ?? decl?.instanceSlot;
    if (decl && memberSlot !== undefined) {
      const memberTemplate = decl.instanceEntity
        ? allocated.get(decl.instanceEntity)
        : "person:1:{index}";
      if (
        !memberTemplate ||
        (decl.instanceEntity && memberTemplate !== instanceIdTemplate(decl.instanceEntity)) ||
        !Array.isArray(tuple) ||
        tuple.length !== 2 ||
        tuple[memberSlot] !== memberTemplate ||
        tuple[1 - memberSlot] !== UNIT_INSTANCE
      ) {
        return false;
      }
    }
    upstream.add(name);
  }
  return upstream.size === declared.size && [...declared.keys()].every((name) => upstream.has(name));
}

/** Whether the runtime allocates every per-request kind the scope's
 *  relations need (root-inputs `instance_kinds`, axiom-api#268). A runtime
 *  without the field predates `household.instances`. */
export function upstreamAllocatesInstances(body: unknown, relations: RelationDecl[]): boolean {
  const kinds = instanceKindsOf(relations);
  if (kinds.length === 0) return true;
  const listed = (body as {data?: {instance_kinds?: unknown}} | null)?.data?.instance_kinds;
  if (!Array.isArray(listed)) return false;
  const entities = new Set(listed.map((item) => (item as {entity?: unknown} | null)?.entity));
  return kinds.every((kind) => entities.has(kind));
}

/** A scenario's per-request instances, as the calculate route takes them
 *  from the client: kind → key → answers. Every kind the scope's
 *  relations need is present (an empty object allocates none), keys follow
 *  the kind's pattern, at most MAX_KIND_INSTANCES per kind; anything else
 *  is refused, never dropped. Answers are passed through `sanitize`. */
export type InstanceAnswers = Record<string, Record<string, Record<string, number | boolean>>>;
export type InstancesResult =
  | { ok: true; instances: InstanceAnswers; keys: InstanceKeys; dropped: string[] }
  | { ok: false; error: "unknown_instance_kind" | "unknown_instance"; detail: string };

export function scenarioInstances(
  relations: RelationDecl[],
  raw: unknown,
  sanitize: (values: unknown) => { sanitized: Record<string, number | boolean>; rejected: string[] },
): InstancesResult {
  const kinds = instanceKindsOf(relations);
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const kind of Object.keys(given)) {
    if (!kinds.includes(kind)) {
      const detail = /^[\w-]{1,64}$/.test(kind) ? kind : "an unrecognized entity kind";
      return { ok: false, error: "unknown_instance_kind", detail };
    }
  }
  const instances: InstanceAnswers = {};
  const keys: InstanceKeys = {};
  const dropped: string[] = [];
  for (const kind of kinds) {
    const pattern = instanceKeyPattern(kind);
    const entries = given[kind] && typeof given[kind] === "object" && !Array.isArray(given[kind])
      ? Object.entries(given[kind] as Record<string, unknown>)
      : [];
    if (entries.length > MAX_KIND_INSTANCES) {
      return { ok: false, error: "unknown_instance", detail: `more than ${MAX_KIND_INSTANCES} ${kind} entries` };
    }
    instances[kind] = {};
    keys[kind] = [];
    for (const [key, values] of entries) {
      if (!pattern.test(key) || !values || typeof values !== "object" || Array.isArray(values)) {
        const detail = /^[\w-]{1,32}$/.test(key) ? key : "an unrecognized instance id";
        return { ok: false, error: "unknown_instance", detail };
      }
      const { sanitized, rejected } = sanitize(values);
      instances[kind]![key] = sanitized;
      keys[kind]!.push(key);
      dropped.push(...rejected.map((name) => `${key}:${name}`));
    }
  }
  return { ok: true, instances, keys, dropped };
}

/** Whether the runtime's `allocated_instances` echo names every instance
 *  the run sent, each under its kind: anything less means a deployment
 *  that ignored `household.instances` and answered another household. */
export function instancesConfirmed(echo: unknown, keys: InstanceKeys): boolean {
  const kinds = Object.keys(keys);
  if (kinds.length === 0) return true;
  if (!echo || typeof echo !== "object" || Array.isArray(echo)) return false;
  const byKind = echo as Record<string, unknown>;
  return kinds.every((kind) => {
    const listed = byKind[kind];
    if (!listed || typeof listed !== "object" || Array.isArray(listed)) return false;
    return keys[kind]!.every((key) => typeof (listed as Record<string, unknown>)[key] === "string");
  });
}
