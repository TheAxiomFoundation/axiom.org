"use client";

import { useState } from "react";
import { DISCLOSURE } from "@/lib/aspen/content";

/** What we save, in one line, with the details a tap away. */
export function Disclosure({
  lead,
  text = DISCLOSURE.short,
  onOpen,
}: {
  lead?: string;
  /** The one-line summary; the details stay the same everywhere. */
  text?: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="font-body text-[0.95rem] leading-relaxed text-[var(--color-ink-muted)]">
      <p className="m-0">
        {lead ? `${lead} ` : ""}
        {text}{" "}
        <button
          type="button"
          className="aspen-link"
          aria-expanded={open}
          onClick={() => {
            if (!open) onOpen?.();
            setOpen((v) => !v);
          }}
        >
          {open ? "Less" : "What we keep"}
        </button>
      </p>
      {open && (
        <ul className="m-0 mt-4 flex list-none flex-col gap-3.5 p-0 text-left text-[1rem] leading-snug">
          {DISCLOSURE.details.map((d) => (
            <li key={d.title}>
              <strong className="block font-semibold text-[var(--color-ink)]">{d.title}</strong>
              {d.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
