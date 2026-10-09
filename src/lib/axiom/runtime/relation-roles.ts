/**
 * Explicit Person↔unit relationship roles for run-by-root scenarios.
 *
 * Pure (no I/O, no React): the calculate route uses it to validate a
 * scenario's roles and build the engine tuples, and the Plane client uses
 * it for labels, defaults and stale-detection keys.
 *
 * Instance ids follow axiom-api's derived-package conventions: every
 * non-Person kind (TaxUnit, Household, TanfUnit) is the query instance
 * `household:1`, and Person N is `person:1:N`, counted in the request
 * order of `household.people`.
 */

import { DISPLAY_ACRONYMS } from "@/lib/display-acronyms";

/** Unit kinds whose single shared instance the scenario editor models. */
export const SUPPORTED_PERSON_UNITS = new Set(["TaxUnit", "Household", "TanfUnit"]);
export const UNIT_INSTANCE = "household:1";
/** Scenario member ids: person_1 (the flat facts) through person_12. */
export const MEMBER_ID_RE = /^person_(?:[1-9]|1[0-2])$/;
/** The most people a scenario holds (person_1 … person_12). */
export const MAX_ROLE_MEMBERS = 12;

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
  /** A binary relation between exactly one Person slot and one supported unit slot. */
  supported: boolean;
  personSlot?: 0 | 1;
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
  const supported = Boolean(
    name && arity === 2 && args.length === 2 && personSlots.length === 1 && unitSlots.length === 1,
  );
  const decl: RelationDecl = {
    legalId: `${fileLegalId}#${name}`,
    relationId: `${fileLegalId}#relation.${name}`,
    fileLegalId,
    name,
    arity,
    arguments: args,
    supported,
  };
  if (supported) {
    decl.personSlot = personSlots[0] as 0 | 1;
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
 * "ready": no relation, or one supported relation (the membership
 * convention binds every person to it, which the person-unit runtime
 * checks verify). "roles_required": several supported relations; the
 * convention would bind every person to every one, so a run needs each
 * person's roles stated. "relationships_unsupported": any relation the
 * scenario cannot represent (untyped, non-binary, Person–Person,
 * unit–Payment, an unmodelled unit kind).
 */
export function classifyRelations(
  relations: RelationDecl[],
): "ready" | "roles_required" | "relationships_unsupported" {
  if (relations.some((relation) => !relation.supported)) return "relationships_unsupported";
  const distinct = new Set(relations.map((relation) => relation.legalId));
  if (distinct.size !== relations.length) return "relationships_unsupported";
  return relations.length <= 1 ? "ready" : "roles_required";
}

/** One explicit relation, as axiom-api's `household.relations` takes it:
 *  the compiled relation id and its complete membership (`[]` = empty). */
export interface RelationEntry { name: string; tuples: string[][] }

export type MembershipResult =
  | { ok: true; entries: RelationEntry[] }
  | { ok: false; error: "relation_roles_required" | "unknown_relation" | "unknown_member"; detail: string };

/**
 * Validate a scenario's roles against the closure's declared relations and
 * build one `household.relations` entry per declared relation, its tuples
 * in the relation's declared slot order. Every declared relation must be
 * answered and every one is sent, empty ones included: axiom-api replaces
 * the membership convention only for relations an entry names, so an
 * omitted relation would silently bind every person again. Unknown
 * relations and members are refused, never dropped.
 */
export function membershipTuples(
  relations: RelationDecl[],
  membership: unknown,
  order: string[],
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
 *  to the people present, in household order. */
export function rolesForRun(
  relations: RelationDecl[],
  roles: RoleMembership,
  members: string[],
): RoleMembership {
  return Object.fromEntries(
    relations.map((relation) => [
      relation.legalId,
      members.filter((member) => roles[relation.legalId]?.includes(member)),
    ]),
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
  const listed = (body as {data?: {relations?: unknown}} | null)?.data?.relations;
  if (!Array.isArray(listed)) return false;
  const declared = new Map(relations.map((relation) => [relation.relationId, relation]));
  const upstream = new Set<string>();
  for (const entry of listed) {
    const relation = entry as {name?: unknown; explicit?: unknown; tuple?: unknown} | null;
    const name = relation?.name;
    if (typeof name !== "string") return false;
    // Only a relation the runtime marks able to take explicit membership
    // (axiom-api#267 `explicit: true`); a guessed shape would be refused.
    if (relation?.explicit !== true) return false;
    // The runtime's slot layout must be the declared one: the person in the
    // declared Person slot, the unit instance in the other.
    const decl = declared.get(name);
    const tuple = relation?.tuple;
    if (decl && decl.personSlot !== undefined) {
      if (
        !Array.isArray(tuple) ||
        tuple.length !== 2 ||
        tuple[decl.personSlot] !== "person:1:{index}" ||
        tuple[1 - decl.personSlot] !== UNIT_INSTANCE
      ) {
        return false;
      }
    }
    upstream.add(name);
  }
  return upstream.size === declared.size && [...declared.keys()].every((name) => upstream.has(name));
}
