"use client";

import { useState, type ReactElement } from "react";
import { answerKind, ownEntry, type AnswerMeta, type ScenarioValue } from "./input-meta";

/** The select value behind "Other…"; no answer can hold a NUL. */
const OTHER = "\u0000other";

/**
 * The one control for answering a scenario input, typed by the input
 * registry: bools are a two-way select (default — X / its opposite) so
 * the registry default stays visible and an explicit answer is
 * distinguishable from "unanswered"; numeric choices are a select over
 * the statute's own values; a text slot with suggested values is a
 * select over them plus "Other…", which opens a text field; other text
 * is a text field; everything else is a number field.
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
  disabled,
}: {
  name: string;
  value: ScenarioValue | undefined;
  meta: AnswerMeta;
  onChange: (value: ScenarioValue | undefined) => void;
  selectClassName?: string;
  inputClassName?: string;
  placeholder?: string;
  plainDefaults?: boolean;
  disabled?: boolean;
}) {
  const kind = answerKind(meta, name);
  const fallback = ownEntry(meta.defaults, name);
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
        disabled={disabled}
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
    const label = (option: number) => ownEntry(meta.optionLabels, name)?.[option] ?? String(option);
    return (
      <select
        className={selectClassName}
        disabled={disabled}
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
        {ownEntry(meta.options, name)!
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
    // An empty default still needs a name in a select or placeholder.
    const presumedLabel = defaultLabel(presumed === "" ? "(blank)" : presumed);
    // Beside a select, the field needs its own name: a wrapping label
    // names only the select.
    const text = (otherLabel?: string) => (
      <input
        type="text"
        className={inputClassName}
        disabled={disabled}
        aria-label={otherLabel}
        placeholder={presumed ? presumedLabel : placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value)
        }
      />
    );
    if (kind === "text") return text();
    return (
      <TextChoice
        suggestions={ownEntry(meta.textOptions, name)!.filter((option) => option !== presumed)}
        presumed={presumed}
        presumedLabel={presumedLabel}
        value={value}
        onChange={onChange}
        selectClassName={selectClassName}
        disabled={disabled}
        other={text("Other value")}
      />
    );
  }
  return (
    <input
      type="number"
      className={inputClassName}
      disabled={disabled}
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

/**
 * A text slot's suggested values, plus "Other…": the runtime infers the
 * suggestions from the literals its formulas compare the slot with, which
 * is not a complete domain. Choosing "Other…" opens the text field, which
 * holds the answer until another option is picked; an answer outside the
 * suggestions opens it too.
 */
function TextChoice({
  suggestions,
  presumed,
  presumedLabel,
  value,
  onChange,
  selectClassName,
  disabled,
  other,
}: {
  suggestions: string[];
  presumed: string;
  presumedLabel: string;
  value: ScenarioValue | undefined;
  onChange: (value: ScenarioValue | undefined) => void;
  selectClassName?: string;
  disabled?: boolean;
  other: ReactElement;
}) {
  const answer = typeof value === "string" && value !== "" && value !== presumed ? value : null;
  const [writing, setWriting] = useState(false);
  const open = writing || (answer !== null && !suggestions.includes(answer));
  return (
    <span className="answer-text-choice">
      <select
        className={selectClassName}
        disabled={disabled}
        value={open ? OTHER : answer ?? ""}
        onChange={(event) => {
          const picked = event.target.value;
          setWriting(picked === OTHER);
          // "Other…" starts empty: the default holds until text is typed.
          onChange(picked === "" || picked === OTHER ? undefined : picked);
        }}
      >
        <option value="">{presumedLabel}</option>
        {suggestions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {open && <span className="answer-text-other">{other}</span>}
    </span>
  );
}
