"use client";

import { useEffect, useState } from "react";
import CodeBlock, { type CodeLanguage } from "@/components/code-block";

interface ExpandableCodeProps {
  code: string;
  language: CodeLanguage;
  /**
   * Filename or short label shown in the overlay header so the reader
   * knows what they're looking at. When omitted, the overlay falls
   * back to "Encoding".
   */
  label?: string;
}

// Inline previews keep ``whitespace-pre`` (no wrapping): RuleSpec YAML
// is indentation-heavy, and wrapping it inside the narrow rail turns
// every line into an unreadable stack. Long lines scroll horizontally
// instead, and the preview is height-capped — the overlay is the
// full-reading surface.
const INLINE_CODE_CLASS =
  "p-4 bg-[var(--color-code-bg)] border border-[var(--color-rule)] rounded-md overflow-auto max-h-80 text-xs text-[var(--color-code-text)] leading-relaxed whitespace-pre";

const OVERLAY_CODE_CLASS =
  "p-6 bg-[var(--color-code-bg)] overflow-auto text-sm text-[var(--color-code-text)] leading-relaxed whitespace-pre-wrap break-words h-full";

/**
 * Inline code block with an "Expand" control that opens the same code
 * in a near-full-viewport overlay — not a vertical unfolding. Long
 * RuleSpec / Catala encodings typically also have long lines, so giving
 * them a wider reading surface (plus extra vertical room) is more
 * useful than just revealing more rows inside the 380px rail.
 *
 * The overlay:
 *   - Shows the filename label + line count in the header.
 *   - Closes on Escape, on backdrop click, and on an explicit button.
 *   - Scroll-locks the page behind it while open.
 *   - Focuses the close button on open for keyboard users.
 */
export function ExpandableCode({
  code,
  language,
  label,
}: ExpandableCodeProps) {
  const [open, setOpen] = useState(false);
  const lineCount = code.split("\n").length;

  return (
    <div>
      <div className="relative">
        <CodeBlock
          code={code}
          language={language}
          className={INLINE_CODE_CLASS}
        />
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mt-2 w-full inline-flex items-center justify-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)] bg-[var(--color-paper-elevated)] border border-[var(--color-rule)] rounded-md hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 cursor-pointer"
      >
        <svg
          viewBox="0 0 20 20"
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 4h5M4 4v5M16 4h-5M16 4v5M4 16h5M4 16v-5M16 16h-5M16 16v-5" />
        </svg>
        <span>Expand · {lineCount} lines</span>
      </button>
      {open && (
        <CodeOverlay
          code={code}
          language={language}
          label={label}
          lineCount={lineCount}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function CodeOverlay({
  code,
  language,
  label,
  lineCount,
  onClose,
}: {
  code: string;
  language: CodeLanguage;
  label?: string;
  lineCount: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Encoding — expanded view"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
    >
      <div
        onClick={onClose}
        aria-hidden="true"
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-fade-in"
      />
      <div className="relative w-full max-w-[min(1200px,96vw)] h-[min(88vh,900px)] flex flex-col bg-[var(--color-paper-elevated)] border border-[var(--color-rule)] rounded-md shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-rule)] bg-[var(--color-paper)]">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="eyebrow">RuleSpec encoding</span>
            {label && (
              <code className="font-mono text-xs text-[var(--color-accent)] truncate">
                {label}
              </code>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)] shrink-0">
              {lineCount} lines
            </span>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close expanded view"
            className="inline-flex items-center justify-center w-8 h-8 rounded border border-[var(--color-rule)] text-[var(--color-ink-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
          >
            <svg
              viewBox="0 0 20 20"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </header>
        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodeBlock
            code={code}
            language={language}
            className={OVERLAY_CODE_CLASS}
          />
        </div>
        {/* Footer */}
        <footer className="flex items-center justify-end px-5 py-2 border-t border-[var(--color-rule)] bg-[var(--color-paper)]">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
            <kbd className="inline-flex items-center justify-center min-w-[1.5em] h-[1.5em] px-1 rounded border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] text-[var(--color-ink-secondary)] font-mono normal-case">
              esc
            </kbd>{" "}
            to close
          </span>
        </footer>
      </div>
    </div>
  );
}
