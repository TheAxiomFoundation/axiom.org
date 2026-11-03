"use client";

import { answerKind, type AnswerMeta, type ScenarioValue } from "./input-meta";

/**
 * The one control for answering a scenario input, typed by the input
 * registry: bools are a two-way select (default — X / its opposite) so
 * the registry default stays visible and an explicit answer is
 * distinguishable from "unanswered"; closed domains — numeric choices
 * and a text slot's values — are selects over the statute's own values;
 * other text is a text field; everything else is a number field.
 * `undefined` from onChange means "back to the default" — the caller
 * removes the entry from the scenario.
 */
export function AnswerControl({
  name,
  value,
  meta,
  onChange,
  selectClassName,
  inputClassName,
  placeholder,
  plainDefaults = false,
}: {
  name: string;
  value: ScenarioValue | undefined;
  meta: AnswerMeta;
  onChange: (value: ScenarioValue | undefined) => void;
  selectClassName?: string;
  inputClassName?: string;
  placeholder?: string;
  plainDefaults?: boolean;
}) {
  const kind = answerKind(meta, name);
  const fallback = meta.defaults[name];
  const defaultLabel = (label: string) => (plainDefaults ? label : `default — ${label}`);
  if (kind === "bool") {
    // Two options only: the default (named) and its opposite — a
    // separate "false" when the default IS false would be the same
    // answer twice. Explicitly picking the default value collapses
    // into "default".
    const presumed = Boolean(fallback);
    return (
      <select
        className={selectClassName}
        value={value === undefined || value === presumed ? "" : String(value)}
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? undefined
              : event.target.value === "true",
          )
        }
      >
        <option value="">{defaultLabel(String(presumed))}</option>
        <option value={String(!presumed)}>{String(!presumed)}</option>
      </select>
    );
  }
  if (kind === "choice") {
    // Same rule for closed domains: the default's own entry folds into
    // the "default" option instead of appearing twice.
    const presumed = Number(fallback) || 0;
    const label = (option: number) => meta.optionLabels?.[name]?.[option] ?? String(option);
    return (
      <select
        className={selectClassName}
        value={
          value === undefined || value === presumed ? "" : String(value)
        }
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? undefined
              : Number(event.target.value),
          )
        }
      >
        <option value="">{defaultLabel(label(presumed))}</option>
        {meta.options![name]!
          .filter((option) => option !== presumed)
          .map((option) => (
            <option key={option} value={String(option)}>
              {label(option)}
            </option>
          ))}
      </select>
    );
  }
  if (kind === "text-choice" || kind === "text") {
    const presumed = typeof fallback === "string" ? fallback : "";
    if (kind === "text-choice") {
      return (
        <select
          className={selectClassName}
          value={value === undefined || value === presumed ? "" : String(value)}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : event.target.value)
          }
        >
          <option value="">{defaultLabel(presumed)}</option>
          {meta.textOptions![name]!
            .filter((option) => option !== presumed)
            .map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
        </select>
      );
    }
    return (
      <input
        type="text"
        className={inputClassName}
        placeholder={presumed ? defaultLabel(presumed) : placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value)
        }
      />
    );
  }
  return (
    <input
      type="number"
      className={inputClassName}
      step={kind === "integer" ? 1 : "any"}
      placeholder={placeholder}
      value={typeof value === "number" ? String(value) : plainDefaults && typeof fallback === "number" ? String(fallback) : ""}
      onChange={(event) =>
        onChange(
          event.target.value === ""
            ? undefined
            : Number(event.target.value),
        )
      }
    />
  );
}
