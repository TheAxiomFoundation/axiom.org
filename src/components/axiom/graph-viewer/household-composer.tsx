"use client";

import { useState, type ReactNode } from "react";
import { humanizeRuleName } from "./citations";

type Field = { name: string; label: string; entity?: string | null; category?: string; order?: number };
const RELATIONSHIPS_ID = "relationships";

/** A per-request instance kind the scenario allocates instance by instance
 *  (Payment in a (TaxUnit, Payment) relation): its instances, in order,
 *  and how to add or remove one. */
export interface InstanceCollection {
  entity: string;
  /** Scenario keys (`payment_1`, …) in request order. */
  items: string[];
  max: number;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function groupHouseholdInputs(fields: Field[]) {
  const buckets = new Map<string, Field[]>();
  for (const field of fields) {
    const category = field.category?.trim() || "";
    buckets.set(category, [...(buckets.get(category) ?? []), field]);
  }
  return [...buckets].sort(([a], [b]) => a ? b ? a.localeCompare(b) : -1 : 1)
    .map(([title, inputs]) => ({ title, fields: inputs.sort((a, b) =>
      (a.order ?? Infinity) - (b.order ?? Infinity) || humanizeRuleName(a.label).localeCompare(humanizeRuleName(b.label)) || a.name.localeCompare(b.name)
    ) }));
}

/** `TaxUnit` → "Tax unit". */
export function entityLabel(entity: string): string {
  return humanizeRuleName(entity.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

/** "Payment" → "Payments", "Family" → "Families". */
export function pluralLabel(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`;
  return `${label}s`;
}

/** Entity composition and answers share one workspace; adding a field is unnecessary. */
export function HouseholdComposer({ fields, members, canAddPeople, running, onAddPerson, onRemovePerson, renderControl, relationships, collections = [] }: {
  fields: Field[];
  members: string[];
  canAddPeople: boolean;
  running: boolean;
  onAddPerson: () => void;
  onRemovePerson: (id: string) => void;
  renderControl: (field: Field, member: string | null) => ReactNode;
  /** Who belongs to each declared relation — its own composition entry. */
  relationships?: ReactNode;
  /** Per-request instance kinds (payments), each its own branch of
   *  instances with their own answers. */
  collections?: InstanceCollection[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const groups = new Map<string, Field[]>();
  for (const field of fields) {
    const entity = field.entity || "Unspecified entity";
    groups.set(entity, [...(groups.get(entity) ?? []), field]);
  }
  const byKind = new Map(collections.map(collection => [collection.entity, collection]));
  for (const collection of collections) if (!groups.has(collection.entity)) groups.set(collection.entity, []);
  type Entry = { id: string; label: string; entity: string; member: string | null; inputs: Field[]; onRemove?: () => void };
  const entities: Entry[] = [...groups].flatMap(([entity, inputs]): Entry[] => {
    if (entity === "Person") {
      return [null, ...members].map(member => ({ id: member ?? "person_1", label: member ? `Person ${member.split("_")[1]}` : "Person 1", entity, member, inputs, ...(member ? { onRemove: () => onRemovePerson(member) } : {}) }));
    }
    const collection = byKind.get(entity);
    if (collection) {
      return collection.items.map(item => ({ id: item, label: `${entityLabel(entity)} ${item.split("_").at(-1)}`, entity, member: item, inputs, onRemove: () => collection.onRemove(item) }));
    }
    return [{id: `entity:${entity}`, label: entityLabel(entity), entity, member: null, inputs}];
  });
  const showingRelationships = Boolean(relationships) && selected === RELATIONSHIPS_ID;
  const current = entities.find(item => item.id === selected) ?? entities[0];
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = tokens.length > 0;
  const visibleEntities = (searching ? entities : showingRelationships ? [] : current ? [current] : []).map(item => ({
    ...item,
    inputs: item.inputs.filter(field => !searching || tokens.every(token =>
      `${item.label} ${item.entity} ${field.name} ${humanizeRuleName(field.label)} ${field.category ?? ""}`.toLowerCase().includes(token)
    )),
  })).filter(item => item.inputs.length > 0);
  const people = entities.filter(item => item.entity === "Person");
  const entityRow = (item: Entry) => <div className="household-entity-row" key={item.id}>
    <button type="button" className="household-entity" aria-current={!showingRelationships && current?.id === item.id ? "true" : undefined} onClick={() => {setSelected(item.id); setQuery("");}}>
      <span>{item.label}</span>
    </button>
    {item.onRemove && <button type="button" className="household-remove" disabled={running} aria-label={`Remove ${item.label}`} onClick={item.onRemove}>×</button>}
  </div>;
  const peopleBranch = people.length > 0 && <section className="household-tree-branch" aria-label="People">
    <h4>People</h4>
    {people.map(entityRow)}
    {canAddPeople && <button type="button" className="household-add" disabled={running || members.length >= 11} onClick={onAddPerson}>＋ Add person</button>}
  </section>;
  const collectionBranches = collections.map(collection => {
    const label = entityLabel(collection.entity);
    const plural = pluralLabel(label);
    return <section className="household-tree-branch" key={`kind:${collection.entity}`} aria-label={plural}>
      <h4>{plural}</h4>
      {entities.filter(item => item.entity === collection.entity).map(entityRow)}
      {collection.items.length === 0 && <p className="household-empty">No {plural.toLowerCase()} in this scenario.</p>}
      <button type="button" className="household-add" disabled={running || collection.items.length >= collection.max} onClick={collection.onAdd}>＋ Add {label.toLowerCase()}</button>
    </section>;
  });
  return <div className="household-composer">
    <nav className="household-composition" aria-label="Household composition">
      <h3>Entities</h3>
      <div className="household-tree">
        {entities.filter(item => item.entity !== "Person" && !byKind.has(item.entity)).map(item => <section className="household-tree-branch" key={item.id} aria-label={item.label}>
          {entityRow(item)}
        </section>)}
        {peopleBranch}
        {collectionBranches}
        {relationships && <section className="household-tree-branch" aria-label="Relationships">
          <div className="household-entity-row"><button type="button" className="household-entity" aria-current={showingRelationships ? "true" : undefined} onClick={() => {setSelected(RELATIONSHIPS_ID); setQuery("");}}><span>Relationships</span></button></div>
        </section>}
      </div>
    </nav>
    <section className="household-entity-inputs" aria-label={searching ? "Input search results" : showingRelationships ? "Relationship roles panel" : current ? `${current.label} inputs` : "Household inputs"}>
      <header><div><h3>{searching ? "Matching inputs" : showingRelationships ? "Relationships" : current?.label ?? "Inputs"}</h3></div>
        <input type="search" aria-label="Find inputs across all entities" placeholder="Find inputs across all entities…" value={query} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" className="household-clear-search" onClick={() => setQuery("")}>Clear</button>}
      </header>
      {visibleEntities.map(item => <section className="household-input-section" key={item.id} aria-label={`${item.label} fields`}>
        {searching && <h4>{item.label}</h4>}
        <div className="household-input-topics">{groupHouseholdInputs(item.inputs).map(group => <fieldset key={group.title} disabled={running} className="household-fields">{group.title && <legend>{group.title}</legend>}{group.fields.map(field => <label key={`${item.id}:${field.name}`}><span>{humanizeRuleName(field.label)}</span>{renderControl(field, item.member)}</label>)}</fieldset>)}</div>
      </section>)}
      {showingRelationships && !searching && relationships}
      {!visibleEntities.length && !(showingRelationships && !searching) && <p className="run-hint">{searching ? "No matching inputs across the scenario." : "No inputs are available for this graph."}</p>}
    </section>
  </div>;
}
