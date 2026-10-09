"use client";

import { relationLabel, type RelationDecl, type RoleMembership } from "@/lib/axiom/runtime/relation-roles";
import { humanizeCitation } from "./citations";
import { pluralLabel } from "./household-composer";

/** `TaxUnit` → "Tax unit" (sentence case). */
function entityName(entity: string): string {
  const words = entity.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return [words[0], ...words.slice(1).map((word) => word.toLowerCase())].join(" ");
}

/**
 * The tuples of each unit–instance relation the law in scope declares
 * (`section_22_payment_of_tax_unit(TaxUnit, Payment)`): one row per tuple,
 * one cell per declared slot in declared order. The unit slot holds the
 * scenario's one unit; the instance slot picks one of the scenario's
 * instances of that kind. Nothing is inferred: a relation starts with no
 * tuples, an empty relation is sent as an answer, and an instance left out
 * of every tuple is outside the relation for the run.
 *
 * State is the relation's linked instance keys (`relationRoles`), each key
 * one tuple: with a single unit instance, the instance determines the
 * tuple.
 */
export function RelationTuples({ relations, instances, roles, running, onChange }: {
  relations: RelationDecl[];
  /** Per-request kind → its scenario keys in order (`{ Payment: ["payment_1"] }`). */
  instances: Record<string, string[]>;
  roles: RoleMembership;
  running: boolean;
  onChange: (relation: string, keys: string[]) => void;
}) {
  const tupleRelations = relations.filter((relation) => relation.instanceEntity && relation.instanceSlot !== undefined);
  if (!tupleRelations.length) return null;
  return <section className="relation-tuples" aria-label="Relationship tuples">
    <header>
      <h3>Linked instances</h3>
      <p>Each row is one tuple of the relationship, its slots in the order the law declares them. Add a row for every instance that belongs; an instance with no row is outside that relationship for this run.</p>
    </header>
    {tupleRelations.map((relation) => {
      const kind = relation.instanceEntity!;
      const kindLabel = entityName(kind);
      const unitLabel = entityName(relation.unitEntity ?? "Unit");
      const keys = instances[kind] ?? [];
      const linked = (roles[relation.legalId] ?? []).filter((key) => keys.includes(key));
      const unlinked = keys.filter((key) => !linked.includes(key));
      const label = relationLabel(relation);
      const slots = relation.instanceSlot === 0 ? ["instance", "unit"] as const : ["unit", "instance"] as const;
      const nameOf = (key: string) => `${kindLabel} ${key.split("_").at(-1)}`;
      const replace = (position: number, key: string) =>
        onChange(relation.legalId, linked.map((current, index) => (index === position ? key : current)));
      return <section className="relation-tuples-relation" key={relation.legalId} aria-label={label}>
        <h4>{label}</h4>
        <small className="relation-roles-source">{humanizeCitation(relation.fileLegalId)}{relation.source ? ` · ${relation.source}` : ""} · links a {kindLabel.toLowerCase()} to the {unitLabel.toLowerCase()}</small>
        {relation.description && <small className="relation-roles-description">{relation.description}</small>}
        {keys.length === 0
          ? <p className="run-hint" role="status">No {pluralLabel(kindLabel).toLowerCase()} in this scenario yet. Add one under Entities; until then this relationship is empty.</p>
          : <table>
            <thead><tr>
              {slots.map((slot, index) => <th scope="col" key={slot}>{slot === "unit" ? unitLabel : kindLabel} <span className="relation-tuples-slot">slot {index + 1}</span></th>)}
              <th scope="col"><span className="sr-only">Remove</span></th>
            </tr></thead>
            <tbody>
              {linked.length === 0 && <tr><td colSpan={3} className="relation-tuples-empty">No tuples: no {kindLabel.toLowerCase()} belongs to this relationship.</td></tr>}
              {linked.map((key, position) => <tr key={key}>
                {slots.map((slot) => <td key={slot}>
                  {slot === "unit"
                    ? <select disabled aria-label={`${unitLabel} in tuple ${position + 1} of ${label}`} value="household:1"><option value="household:1">{unitLabel} 1</option></select>
                    : <select disabled={running} aria-label={`${kindLabel} in tuple ${position + 1} of ${label}`} value={key} onChange={(event) => replace(position, event.target.value)}>
                        {[key, ...unlinked].map((option) => <option key={option} value={option}>{nameOf(option)}</option>)}
                      </select>}
                </td>)}
                <td className="relation-roles-quick">
                  <button type="button" disabled={running} aria-label={`Remove tuple ${position + 1} of ${label}`} onClick={() => onChange(relation.legalId, linked.filter((_, index) => index !== position))}>Remove</button>
                </td>
              </tr>)}
            </tbody>
          </table>}
        {keys.length > 0 && <div className="relation-roles-quick relation-tuples-actions">
          <button type="button" disabled={running || unlinked.length === 0} onClick={() => onChange(relation.legalId, [...linked, unlinked[0]!])}>＋ Add tuple</button>
          <button type="button" disabled={running || unlinked.length === 0} aria-label={`Link every ${kindLabel.toLowerCase()} in ${label}`} onClick={() => onChange(relation.legalId, [...keys])}>All</button>
          <button type="button" disabled={running || linked.length === 0} aria-label={`Link no ${kindLabel.toLowerCase()} in ${label}`} onClick={() => onChange(relation.legalId, [])}>None</button>
        </div>}
      </section>;
    })}
  </section>;
}
