"use client";

import { useState, type ReactNode } from "react";
import { humanizeRuleName } from "./citations";

type Field = { name: string; label: string; entity?: string | null };

// Presentation categories only: all fields remain editable and retain their legal names.
const inputTopics: Array<[string, RegExp]> = [
  ["Personal details", /(^|_)(age|birth|citizenship|disability|disabled|incapable)(_|$)/],
  ["Family & filing", /filing_status|married|separated|noncustodial|is_spouse|is_.*dependent/],
  ["Home & residency", /abode|residen|household|relationship_violates/],
  ["Income & resources", /income|wage|earnings|asset|resource|savings/],
  ["Care & expenses", /expense|care_assistance|paid_to|shelter|rent|deduction/],
  ["Claim requirements", /tin_included|identifying_information|requirement|application|verification|requested|recertif/],
  ["Tax & credit rules", /tax_imposed|credit|expansion/],
];
export function groupHouseholdInputs(fields: Field[]) {
  const buckets = new Map<string, Field[]>();
  for (const field of fields) {
    const topic = inputTopics.find(([, match]) => match.test(field.name))?.[0] ?? "Other details";
    buckets.set(topic, [...(buckets.get(topic) ?? []), field]);
  }
  return [...inputTopics.map(([title]) => title), "Other details"].flatMap(title => {
    const inputs = buckets.get(title);
    return inputs ? [{title, fields: inputs.sort((a, b) => humanizeRuleName(a.label).localeCompare(humanizeRuleName(b.label)))}] : [];
  });
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
    const entity = field.entity || "Household";
    groups.set(entity, [...(groups.get(entity) ?? []), field]);
  }
  const entities = [...groups].flatMap(([entity, inputs]) => entity === "Person"
    ? [null, ...members].map(member => ({ id: member ?? "person_1", label: member ? `Person ${member.split("_")[1]}` : "Person 1", entity, member, inputs }))
    : [{id: `entity:${entity}`, label: humanizeRuleName(entity.replace(/([a-z])([A-Z])/g, "$1 $2")), entity, member: null, inputs}]);
  const current = entities.find(item => item.id === selected) ?? entities[0];
  const visible = current?.inputs.filter(field => humanizeRuleName(field.label).toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return <div className="household-composer">
    <nav className="household-composition" aria-label="Household composition">
      <h3>Household</h3>
      <div className="household-tree">
        {[{title: "Shared units", items: entities.filter(item => item.entity !== "Person")}, {title: "People", items: entities.filter(item => item.entity === "Person")}].filter(branch => branch.items.length).map(branch => <section className="household-tree-branch" key={branch.title} aria-label={branch.title}>
          <h4>{branch.title}</h4>
          {branch.items.map(item => <div className="household-entity-row" key={item.id}>
            <button type="button" className="household-entity" aria-current={current?.id === item.id ? "true" : undefined} onClick={() => {setSelected(item.id); setQuery("");}}>
              <span>{item.label}</span>
            </button>
            {item.member && <button type="button" className="household-remove" disabled={running} aria-label={`Remove ${item.label}`} onClick={() => onRemovePerson(item.member!)}>×</button>}
          </div>)}
          {branch.title === "People" && canAddPeople && <button type="button" className="household-add" disabled={running || members.length >= 11} onClick={onAddPerson}>＋ Add person</button>}
        </section>)}
      </div>
    </nav>
    <section className="household-entity-inputs" aria-label={current ? `${current.label} inputs` : "Household inputs"}>
      {current && <><header><div><h3>{current.label}</h3><p>{current.entity === "Person" ? "Personal inputs" : "Shared inputs"}</p></div>
        <input type="search" aria-label={`Search ${current.label} inputs`} placeholder="Find an input…" value={query} onChange={event => setQuery(event.target.value)} /></header>
        <div className="household-input-topics">{groupHouseholdInputs(visible).map(group => <fieldset key={group.title} disabled={running} className="household-fields"><legend>{group.title}</legend>{group.fields.map(field => <label key={`${current.id}:${field.name}`}><span>{humanizeRuleName(field.label)}</span>{renderControl(field, current.member)}</label>)}</fieldset>)}</div>
        {!visible.length && <p className="run-hint">No matching inputs.</p>}
      </>}
      {!current && <p className="run-hint">No inputs are available for this graph.</p>}
    </section>
  </div>;
}
