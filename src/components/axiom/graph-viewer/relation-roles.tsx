"use client";

import { relationLabel, type RelationDecl, type RoleMembership } from "@/lib/axiom/runtime/relation-roles";
import { Fragment } from "react";
import { humanizeCitation, humanizeRuleName } from "./citations";

const memberName = (id: string) => (id === "person_1" ? "Person 1" : humanizeRuleName(id));

/**
 * Who belongs to each relationship the law in scope declares. One row per
 * declared Person–unit relation, one checkbox per scenario person. Nothing
 * is inferred from relation or input names: every role starts empty and is
 * stated here, and an empty relationship is sent as an answer.
 */
export function RelationRoles({ relations, members, roles, running, onChange, inUse, usedBy }: {
  relations: RelationDecl[];
  members: string[];
  roles: RoleMembership;
  running: boolean;
  onChange: (relation: string, members: string[]) => void;
  /** Relations the headline result's dependency closure reads; the rest
   *  are still answered (empty by default) but listed after a divider. */
  inUse?: Set<string>;
  usedBy?: string;
}) {
  if (!relations.length) return null;
  const ordered = inUse ? [...relations.filter((relation) => inUse.has(relation.legalId)), ...relations.filter((relation) => !inUse.has(relation.legalId))] : relations;
  const firstUnused = inUse ? ordered.findIndex((relation) => !inUse.has(relation.legalId)) : -1;
  const people = ["person_1", ...members];
  const empty = relations.filter((relation) => !people.some((person) => roles[relation.legalId]?.includes(person))).length;
  return <section className="relation-roles" aria-label="Relationship roles">
    <header>
      <h3>Relationships</h3>
      <p>The law in scope asks who belongs to each of these relationships. Tick every person who does; anyone left unticked is outside that relationship for this run.</p>
      {empty > 0 && <p className="run-hint" role="status">{empty} of {relations.length} relationships have no members yet.</p>}
    </header>
    <table>
      <thead><tr><th scope="col">Relationship</th>{people.map((person) => <th scope="col" key={person}>{memberName(person)}</th>)}<th scope="col"><span className="sr-only">Quick set</span></th></tr></thead>
      <tbody>{ordered.map((relation, index) => {
        const label = relationLabel(relation);
        const current = roles[relation.legalId] ?? [];
        const unit = relation.unitEntity ? humanizeRuleName(relation.unitEntity.replace(/([a-z])([A-Z])/g, "$1 $2")) : null;
        return <Fragment key={relation.legalId}>{index === firstUnused && <tr className="relation-roles-divider"><td colSpan={people.length + 2}>{firstUnused === 0 ? "None of these relationships is read by" : "Also declared in this scope, but not read by"} {usedBy ?? "the headline result"}:</td></tr>}<tr>
          <th scope="row">
            <span className="relation-roles-label">{label}</span>
            <small className="relation-roles-source">{humanizeCitation(relation.fileLegalId)}{relation.source ? ` · ${relation.source}` : ""}{unit ? ` · links a person to the ${unit.toLowerCase()}` : ""}</small>
            {relation.description && <small className="relation-roles-description">{relation.description}</small>}
          </th>
          {people.map((person) => <td key={person}>
            <input
              type="checkbox"
              disabled={running}
              aria-label={`${memberName(person)} in ${label}`}
              checked={current.includes(person)}
              onChange={(event) => onChange(relation.legalId, event.target.checked
                ? people.filter((id) => id === person || current.includes(id))
                : current.filter((id) => id !== person))}
            />
          </td>)}
          <td className="relation-roles-quick">
            <button type="button" disabled={running} aria-label={`Everyone in ${label}`} onClick={() => onChange(relation.legalId, [...people])}>All</button>
            <button type="button" disabled={running} aria-label={`No one in ${label}`} onClick={() => onChange(relation.legalId, [])}>None</button>
          </td>
        </tr></Fragment>;
      })}</tbody>
    </table>
  </section>;
}

/** The single-relation scope runs under the membership convention: say so. */
export function ConventionNote({ relation }: { relation: RelationDecl | undefined }) {
  if (!relation) return null;
  return <p className="run-hint relation-roles-convention" role="note">
    Everyone in this scenario counts as a member of “{relationLabel(relation)}” ({humanizeCitation(relation.fileLegalId)}).
  </p>;
}
