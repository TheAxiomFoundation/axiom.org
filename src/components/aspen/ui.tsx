import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small shared pieces for the /aspen pages. */

export function Chip({
  selected,
  onClick,
  children,
  className,
  disabled,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected ?? false}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-left font-body text-[0.9rem] leading-snug transition-colors disabled:opacity-50",
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
          : "border-[var(--color-rule)] bg-[var(--color-paper-elevated)] text-[var(--color-ink)] hover:border-[var(--color-accent)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "block font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StageHeading({
  eyebrow,
  title,
  summary,
}: {
  eyebrow?: string;
  title: string;
  summary?: string;
}) {
  return (
    <header className="mb-8">
      {eyebrow && (
        <span className="kicker mb-4 inline-flex">
          <span className="kicker-mark">&sect;</span>
          {eyebrow}
        </span>
      )}
      <h1 className="heading-section m-0">{title}</h1>
      {summary && (
        <p className="m-0 mt-3 max-w-[600px] font-body text-[1.05rem] leading-relaxed text-[var(--color-ink-secondary)] text-pretty">
          {summary}
        </p>
      )}
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 sm:p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One labelled horizontal bar, its width relative to `max`. */
export function BarRow({
  label,
  count,
  max,
  tone = "accent",
}: {
  label: string;
  count: number;
  max: number;
  tone?: "accent" | "ink" | "good" | "bad";
}) {
  const width = max > 0 ? Math.max(count > 0 ? 4 : 0, Math.round((100 * count) / max)) : 0;
  const color = {
    accent: "var(--color-accent)",
    ink: "var(--color-ink-secondary)",
    good: "var(--color-success)",
    bad: "var(--color-error)",
  }[tone];
  return (
    <div className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.25rem] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_2.5rem]">
      <span className="truncate font-body text-[0.88rem] text-[var(--color-ink)]" title={label}>
        {label}
      </span>
      <span className="h-2.5 overflow-hidden rounded-full bg-[var(--color-rule-subtle)]">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${width}%`, background: color }}
        />
      </span>
      <span className="text-right font-mono text-[0.8rem] tabular-nums text-[var(--color-ink-secondary)]">
        {count}
      </span>
    </div>
  );
}

export function Bars({
  items,
  tone,
  limit,
  empty = "Nothing yet.",
}: {
  items: { id: string; label: string; count: number }[];
  tone?: "accent" | "ink" | "good" | "bad";
  limit?: number;
  empty?: string;
}) {
  const shown = (limit ? items.slice(0, limit) : items).filter((i) => limit === undefined || i.count > 0);
  const max = Math.max(0, ...items.map((i) => i.count));
  if (max === 0) {
    return <p className="m-0 font-body text-[0.88rem] text-[var(--color-ink-muted)]">{empty}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {shown.map((item) => (
        <BarRow key={item.id} label={item.label} count={item.count} max={max} tone={tone} />
      ))}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <span className="block font-display text-[2rem] font-light leading-none tabular-nums text-[var(--color-ink)]">
        {value}
      </span>
      <span className="mt-1 block font-body text-[0.82rem] text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

export const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-ink)] px-4 py-2.5 font-body text-[0.95rem] font-medium text-white transition-colors hover:bg-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_QUIET =
  "inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3.5 py-2 font-body text-[0.9rem] text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50";

export const FIELD =
  "w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3.5 py-2.5 font-body text-[0.98rem] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-accent)] focus:outline-none";
