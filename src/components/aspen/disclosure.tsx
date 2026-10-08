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
    <div className="font-body text-[0.8rem] leading-relaxed text-[var(--color-ink-muted)]">
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
        <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-4">
          {DISCLOSURE.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
