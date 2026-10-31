"use client";

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./ops-pipeline.module.css";

/** A "?" beside a label that opens a short note on what the label means. */
export function Explain({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !note.current || !root.current) return;
    const width = note.current.getBoundingClientRect().width;
    setAlignRight(root.current.getBoundingClientRect().left + width > window.innerWidth - 16);
  }, [open]);
  return (
    <span ref={root} className={styles.explain}>
      <button
        type="button"
        className={styles.explainButton}
        aria-label={`What ${label} means`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open && (
        <span ref={note} id={id} role="note" className={styles.explainNote} data-align={alignRight ? "right" : undefined}>
          {children}
        </span>
      )}
    </span>
  );
}
