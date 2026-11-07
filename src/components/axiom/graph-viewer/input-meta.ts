import type { ScenarioValue } from "@/lib/axiom/runtime/relation-roles";
import type { RootInputSlot } from "./api";

export type { ScenarioValue };

/**
 * The answer controls' registry: every settable input with its dtype and
 * default. Numeric enums carry their explicit `choices`. A text slot
 * carries its `values`: the literals the runtime saw its formulas compare
 * it with, plus the screening default. They are suggestions, not a
 * complete domain (a formula that writes the literal first, or tests only
 * `!=`, names fewer), so a text control also takes any other value.
 */
export interface AnswerMeta {
  dtypes: Record<string, string>;
  defaults: Record<string, unknown>;
  options?: Record<string, number[]>;
  optionLabels?: Record<string, Record<number, string>>;
  textOptions?: Record<string, string[]>;
  presentation?: Record<string, { category?: string; order?: number; label?: string }>;
}

/** A registry's entry for an input, never a member Object.prototype lends
 *  it: an input may be named `constructor`. */
export function ownEntry<T>(record: Readonly<Record<string, T>> | undefined, name: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, name) ? record[name] : undefined;
}

/** Placeholder registry from a composed graph's input census, used only
 *  until the runtime catalog arrives: a sample's actual type is the only
 *  evidence, so everything that is not a boolean starts as a number. */
export function censusAnswerMeta(
  inputs: ReadonlyArray<{ name: string; sample?: unknown }>,
): AnswerMeta {
  const dtypes: Record<string, string> = {};
  const defaults: Record<string, unknown> = {};
  for (const input of inputs) {
    if (Object.hasOwn(dtypes, input.name)) continue;
    dtypes[input.name] = typeof input.sample === "boolean" ? "bool" : "number";
    defaults[input.name] = input.sample;
  }
  return { dtypes, defaults };
}

/**
 * The registry for a composed root once the runtime's input catalog
 * arrives. The catalog lists exactly the slots the compiled subtree
 * ingests, so it decides WHICH inputs exist: a census name it lacks is
 * dropped, not kept beside it. (The graph census once read words out of
 * text literals — "Out of scope" became an input named `scope`.) Date
 * slots, and any dtype the panel cannot type yet, keep their census
 * control.
 */
export function catalogAnswerMeta(
  slots: readonly RootInputSlot[],
  census: AnswerMeta,
): AnswerMeta {
  const meta: Required<AnswerMeta> = {
    dtypes: {},
    defaults: {},
    options: {},
    optionLabels: {},
    textOptions: {},
    presentation: {},
  };
  for (const slot of slots) {
    const name = slot.name;
    // One slot per name, the first listed (as in the census): a repeat
    // could otherwise leave a select's options on a field it retyped.
    if (Object.hasOwn(meta.dtypes, name)) continue;
    meta.presentation[name] = { label: slot.label, category: slot.category, order: slot.order };
    if (slot.dtype === "bool") {
      meta.dtypes[name] = "bool";
      meta.defaults[name] = Boolean(slot.default);
    } else if (slot.dtype === "integer" || slot.dtype === "decimal") {
      meta.dtypes[name] = slot.dtype === "integer" ? "integer" : "number";
      meta.defaults[name] = Number(slot.default) || 0;
      // Only explicit metadata defines the full set of numeric choices.
      if (slot.choices?.length) {
        meta.options[name] = slot.choices.map((choice) => choice.value);
        meta.optionLabels[name] = Object.fromEntries(
          slot.choices.map((choice) => [choice.value, choice.label]),
        );
      }
    } else if (slot.dtype === "text") {
      meta.dtypes[name] = "text";
      meta.defaults[name] = typeof slot.default === "string" ? slot.default : "";
      // An empty literal could not be told apart from "unanswered" in a
      // select, so it is never offered as a suggestion.
      const values = [...new Set((slot.values ?? []).filter(
        (value): value is string => typeof value === "string" && value !== "",
      ))];
      if (values.length > 0) meta.textOptions[name] = values;
    } else {
      meta.dtypes[name] = ownEntry(census.dtypes, name) ?? "number";
      meta.defaults[name] = ownEntry(census.defaults, name);
    }
  }
  return meta;
}

export type AnswerKind = "bool" | "choice" | "text-choice" | "text" | "integer" | "number";

/** Which control answers an input: the registry's dtype decides. A
 *  numeric enum is a closed select; a text slot with suggested values is
 *  a select that also takes any other text. */
export function answerKind(meta: AnswerMeta, name: string): AnswerKind {
  const dtype = ownEntry(meta.dtypes, name);
  if (dtype === "bool") return "bool";
  if (dtype === "text") return ownEntry(meta.textOptions, name)?.length ? "text-choice" : "text";
  if (ownEntry(meta.options, name)) return "choice";
  return dtype === "integer" ? "integer" : "number";
}

/** Whether an answer has the type its field takes now: text for a text
 *  slot, a boolean for a bool, a number otherwise. A number typed while
 *  the census still showed a number field fails once the catalog makes
 *  the field text, and the run must not send it. */
export function answerFits(meta: AnswerMeta, name: string, value: ScenarioValue): boolean {
  const dtype = ownEntry(meta.dtypes, name);
  if (dtype === "text") return typeof value === "string";
  if (dtype === "bool") return typeof value === "boolean";
  return typeof value === "number";
}

/** The answers that still have a field to fill and fit its type. */
export function fittingAnswers(
  answers: Record<string, ScenarioValue>,
  fields: Iterable<string>,
  meta: AnswerMeta,
): Record<string, ScenarioValue> {
  const kept: Record<string, ScenarioValue> = {};
  for (const name of fields) {
    if (!Object.hasOwn(answers, name)) continue;
    const value = answers[name]!;
    if (answerFits(meta, name, value)) kept[name] = value;
  }
  return kept;
}
