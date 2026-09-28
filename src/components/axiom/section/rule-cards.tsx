"use client";

import { useEffect, useRef } from "react";
import type { EncodedRuleLink } from "@/lib/axiom/section-page";
import CodeBlock from "@/components/code-block";

export interface RuleCardDetail {
  /** The rule's source citation string ("26 USC 32(a)(1)"). */
  source: string | null;
  /** The rule's own YAML block, for the expanded view. */
  yaml: string | null;
}

/**
 * Expandable card list for encoded rules — the face of the rail's
 * encodings section. The summary row identifies the rule (kind
 * glyph, name, the subsection it implements); expanding reveals its
 * source citation and its RuleSpec YAML. Kind
 * glyphs: ƒ derived rule, □ parameter.
 */
export function RuleCardList({
  rules,
  detailFor,
  citationLabel = "",
  onExpand,
  highlightRule = null,
}: {
  rules: EncodedRuleLink[];
  detailFor?: (ruleName: string) => RuleCardDetail | null;
  /** Rule the visitor navigated from (graph → Read the law): its card
   *  opens, carries a "your rule" tag, and scrolls into view. */
  highlightRule?: string | null;
  /** Compact legal cite for the section ("7 USC § 2017") — grounds
   *  each card's second line without per-card glyph icons. */
  citationLabel?: string;
  /** Fired when a card opens (not on close) — the "encoding viewed"
   *  moment for analytics. Client parents only. */
  onExpand?: (ruleName: string) => void;
}) {
  const highlightRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    // Bring the navigated-from card into view once, after mount.
    highlightRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlightRule]);
  if (rules.length === 0) return null;
  return (
    <ol data-testid="rule-cards" className="grid grid-cols-1 gap-1.5">
      {rules.map((rule) => {
        const detail = detailFor?.(rule.name) ?? null;
        const highlighted = rule.name === highlightRule;
        const cite = citationLabel
          ? `${citationLabel}${
              rule.anchors.length > 0 ? ` (${rule.anchors.join(")(")})` : ""
            }`
          : rule.anchors.length > 0
            ? `(${rule.anchors.join(")(")})`
            : "";
        return (
          <li key={rule.name}>
            <details
              open={highlighted || undefined}
              ref={highlighted ? highlightRef : undefined}
              onToggle={(event) => {
                if (event.currentTarget.open) onExpand?.(rule.name);
              }}
              className={`group rounded-md border bg-[var(--color-paper-elevated)] transition-colors open:border-[var(--color-accent)]/40 hover:border-[var(--color-accent)] ${
                highlighted
                  ? "border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent)]"
                  : "border-[var(--color-rule)]"
              }`}
            >
              <summary className="block cursor-pointer list-none px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--color-ink)]">
                    {rule.name}
                  </span>
                  {highlighted && (
                    <span className="shrink-0 rounded-sm bg-[var(--color-accent-light)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--color-accent)]">
                      your rule
                    </span>
                  )}
                  <span
                    aria-hidden
                    className="shrink-0 text-[10px] text-[var(--color-ink-muted)] transition-transform group-open:rotate-90"
                  >
                    ▸
                  </span>
                </span>
                <span className="mt-1 block truncate text-[11px] text-[var(--color-ink-muted)]">
                  {cite}
                  {cite && rule.kind && " · "}
                  {rule.kind}
                </span>
              </summary>
              <div className="border-t border-[var(--color-rule)] px-3 py-2.5">
                {detail?.source && (
                  <p className="m-0 font-mono text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
                    {detail.source}
                  </p>
                )}
                {detail?.yaml && (
                  <div className="mt-2 max-h-64 overflow-auto rounded">
                    <CodeBlock
                      code={detail.yaml}
                      language="yaml"
                      className="!m-0 text-[11px] leading-relaxed"
                    />
                  </div>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
