"use client";

import { useState, type ReactNode } from "react";
import { humanizeRuleName } from "./citations";

type Field = { name: string; label: string; entity?: string | null; category?: string; order?: number };

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

/** Entity composition and answers share one workspace; adding a field is unnecessary. */
export function HouseholdComposer({ fields, members, canAddPeople, running, onAddPerson, onRemovePerson, renderControl }: {
  fields: Field[];
  members: string[];
  canAddPeople: boolean;
  running: boolean;
  onAddPerson: () => void;
  onRemovePerson: (id: string) => void;
  renderControl: (field: Field, member: string | null) => ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const groups = new Map<string, Field[]>();
  for (const field of fields) {
    const entity = field.entity || "Unspecified entity";
    groups.set(entity, [...(groups.get(entity) ?? []), field]);
  }
  const entities = [...groups].flatMap(([entity, inputs]) => entity === "Person"
    ? [null, ...members].map(member => ({ id: member ?? "person_1", label: member ? `Person ${member.split("_")[1]}` : "Person 1", entity, member, inputs }))
    : [{id: `entity:${entity}`, label: humanizeRuleName(entity.replace(/([a-z])([A-Z])/g, "$1 $2")), entity, member: null, inputs}]);
  const current = entities.find(item => item.id === selected) ?? entities[0];
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = tokens.length > 0;
  const visibleEntities = (searching ? entities : current ? [current] : []).map(item => ({
    ...item,
    inputs: item.inputs.filter(field => !searching || tokens.every(token =>
      `${item.label} ${item.entity} ${field.name} ${humanizeRuleName(field.label)} ${field.category ?? ""}`.toLowerCase().includes(token)
    )),
  })).filter(item => item.inputs.length > 0);
  const people = entities.filter(item => item.entity === "Person");
  const entityRow = (item: typeof entities[number]) => <div className="household-entity-row" key={item.id}>
    <button type="button" className="household-entity" aria-current={current?.id === item.id ? "true" : undefined} onClick={() => {setSelected(item.id); setQuery("");}}>
      <span>{item.label}</span>
    </button>
    {item.member && <button type="button" className="household-remove" disabled={running} aria-label={`Remove ${item.label}`} onClick={() => onRemovePerson(item.member!)}>×</button>}
  </div>;
  const peopleBranch = people.length > 0 && <section className="household-tree-branch" aria-label="People">
    <h4>People</h4>
    {people.map(entityRow)}
    {canAddPeople && <button type="button" className="household-add" disabled={running || members.length >= 11} onClick={onAddPerson}>＋ Add person</button>}
  </section>;
  return <div className="household-composer">
    <nav className="household-composition" aria-label="Household composition">
      <h3>Entities</h3>
      <div className="household-tree">
        {entities.filter(item => item.entity !== "Person").map(item => <section className="household-tree-branch" key={item.id} aria-label={item.label}>
          {entityRow(item)}
        </section>)}
        {peopleBranch}
      </div>
    </nav>
    <section className="household-entity-inputs" aria-label={searching ? "Input search results" : current ? `${current.label} inputs` : "Household inputs"}>
      <header><div><h3>{searching ? "Matching inputs" : current?.label ?? "Inputs"}</h3></div>
        <input type="search" aria-label="Find inputs across all entities" placeholder="Find inputs across all entities…" value={query} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" className="household-clear-search" onClick={() => setQuery("")}>Clear</button>}
      </header>
      {visibleEntities.map(item => <section className="household-input-section" key={item.id} aria-label={`${item.label} fields`}>
        {searching && <h4>{item.label}</h4>}
        <div className="household-input-topics">{groupHouseholdInputs(item.inputs).map(group => <fieldset key={group.title} disabled={running} className="household-fields">{group.title && <legend>{group.title}</legend>}{group.fields.map(field => <label key={`${item.id}:${field.name}`}><span>{humanizeRuleName(field.label)}</span>{renderControl(field, item.member)}</label>)}</fieldset>)}</div>
      </section>)}
      {!visibleEntities.length && <p className="run-hint">{searching ? "No matching inputs across the scenario." : "No inputs are available for this graph."}</p>}
    </section>
  </div>;
}
