"use client";

import { useEffect, useState } from "react";
import { TEXT_SIZE_KEY, readStored, writeStored } from "./client";

/** The text sizes a participant can pick; each one scales every rem on the page (globals.css). */
export const TEXT_SIZES = [
  { id: "standard", label: "Standard" },
  { id: "large", label: "Large" },
  { id: "larger", label: "Larger" },
] as const;
type TextSizeId = (typeof TEXT_SIZES)[number]["id"];

/**
 * One button that steps the page's text size up, then back to standard. The
 * choice stays on this phone, and leaves the presenter and the rest of the
 * site alone.
 */
export function TextSizeButton() {
  const [size, setSize] = useState<TextSizeId>("standard");
  useEffect(() => {
    const saved = readStored<TextSizeId>(TEXT_SIZE_KEY);
    if (saved && TEXT_SIZES.some((s) => s.id === saved)) setSize(saved);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (size === "standard") root.removeAttribute("data-aspen-text");
    else root.setAttribute("data-aspen-text", size);
    return () => root.removeAttribute("data-aspen-text");
  }, [size]);
  const at = TEXT_SIZES.findIndex((s) => s.id === size);
  const next = TEXT_SIZES[(at + 1) % TEXT_SIZES.length];
  return (
    <button
      type="button"
      onClick={() => {
        setSize(next.id);
        writeStored(TEXT_SIZE_KEY, next.id);
      }}
      aria-label={`Text size: ${TEXT_SIZES[at].label}. Change to ${next.label}.`}
      className="flex h-9 shrink-0 items-center gap-0.5 rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 font-body text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)]"
    >
      <span aria-hidden className="text-[0.8rem] leading-none">A</span>
      <span aria-hidden className="text-[1.15rem] font-medium leading-none">A</span>
    </button>
  );
}
