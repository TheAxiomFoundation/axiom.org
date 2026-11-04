"use client";

import styles from "./flow.module.css";

export interface ScopeChoice {
  /** The choice's key in the dropdown. */
  value: string;
  label: string;
  /** The address the choice stands for, loaded when the caller cannot switch in place. */
  href: string;
}

/**
 * One dropdown of the jurisdiction switch. Choosing switches in place when
 * the caller can (`onSelect`), else loads the choice's address.
 */
export function ScopeSelect({
  label,
  current,
  choices,
  onSelect,
}: {
  label: string;
  current: string;
  choices: ScopeChoice[];
  onSelect?: (value: string) => void;
}) {
  return (
    <span className={styles.scopeSelectWrap}>
      <select
        className={styles.scopeSelect}
        aria-label={label}
        value={current}
        onChange={(event) => {
          const choice = choices.find((c) => c.value === event.target.value);
          if (!choice) return;
          if (onSelect) onSelect(choice.value);
          else window.location.assign(choice.href);
        }}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </span>
  );
}
