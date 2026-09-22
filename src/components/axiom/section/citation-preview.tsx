"use client";

import { useEffect, useRef, useState } from "react";
import { getProvisionByCitationPath } from "@/lib/axiom/navigation-index/read";

/**
 * Hover previews for cross-references: one event-delegating island
 * per page. Any anchor carrying ``data-cite`` (spliced inline
 * citations, references-panel rows) gets a floating card with the
 * cited provision's heading and opening text, so the reader can peek
 * § 152(c) without leaving § 32.
 */

const SHOW_DELAY_MS = 250;
const HIDE_GRACE_MS = 200;
const CARD_WIDTH = 380;
const SNIPPET_LEN = 300;

export interface CitationPreviewData {
  heading: string | null;
  snippet: string | null;
  effective: string | null;
}

interface CardState extends CitationPreviewData {
  path: string;
  top: number;
  left: number;
}

function snippetOf(body: string | null): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_LEN) return flat;
  const cut = flat.slice(0, SNIPPET_LEN);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}

function cardPosition(link: HTMLElement): { top: number; left: number } {
  const rect = link.getBoundingClientRect();
  const width = Math.min(CARD_WIDTH, window.innerWidth - 16);
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
  // Below the link unless it sits in the bottom third of the window.
  const below = rect.bottom + 8;
  const top =
    rect.bottom > window.innerHeight * 0.66 ? rect.top - 8 : below;
  return { top, left };
}

export function CitationPreviewLayer() {
  const [card, setCard] = useState<CardState | null>(null);
  const cache = useRef(new Map<string, CitationPreviewData | null>());
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (showTimer.current) window.clearTimeout(showTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      showTimer.current = null;
      hideTimer.current = null;
    };

    async function load(path: string): Promise<CitationPreviewData | null> {
      if (cache.current.has(path)) return cache.current.get(path) ?? null;
      try {
        const rule = await getProvisionByCitationPath(path);
        const data = rule
          ? {
              heading: rule.heading,
              snippet: snippetOf(rule.body),
              effective: rule.effective_date,
            }
          : null;
        cache.current.set(path, data);
        return data;
      } catch {
        cache.current.set(path, null);
        return null;
      }
    }

    function onOver(event: MouseEvent) {
      const link = (event.target as Element | null)?.closest?.(
        "a[data-cite]"
      ) as HTMLElement | null;
      if (!link) return;
      const path = link.getAttribute("data-cite");
      if (!path) return;
      clearTimers();
      showTimer.current = window.setTimeout(async () => {
        const data = await load(path);
        if (!data || (!data.heading && !data.snippet)) return;
        const { top, left } = cardPosition(link);
        setCard({ path, top, left, ...data });
      }, SHOW_DELAY_MS);
    }

    function onOut(event: MouseEvent) {
      const from = (event.target as Element | null)?.closest?.(
        "a[data-cite]"
      );
      const into = event.relatedTarget as Element | null;
      if (!from) return;
      if (into && cardRef.current?.contains(into)) return;
      clearTimers();
      hideTimer.current = window.setTimeout(() => setCard(null), HIDE_GRACE_MS);
    }

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      clearTimers();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);

  if (!card) return null;

  return (
    <div
      ref={cardRef}
      data-testid="citation-preview"
      role="tooltip"
      style={{
        position: "fixed",
        top: card.top,
        left: card.left,
        width: Math.min(CARD_WIDTH, typeof window !== "undefined" ? window.innerWidth - 16 : CARD_WIDTH),
        transform:
          typeof window !== "undefined" && card.top < window.innerHeight * 0.66
            ? undefined
            : "translateY(-100%)",
      }}
      className="z-50 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4 shadow-lg"
      onMouseEnter={() => {
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
      }}
      onMouseLeave={() => setCard(null)}
    >
      <p className="m-0 flex items-baseline justify-between gap-2">
        <a
          href={`/${card.path}`}
          className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] transition-colors"
        >
          {card.path}
        </a>
        <a
          href={`/${card.path}`}
          className="shrink-0 font-mono text-[11px] text-[var(--color-accent)] no-underline hover:underline"
        >
          Open →
        </a>
      </p>
      {card.heading && (
        <p
          dir="auto"
          className="mt-1 mb-0 text-sm font-semibold text-[var(--color-ink)]"
          style={{ fontFamily: "var(--f-serif)" }}
        >
          {card.heading}
        </p>
      )}
      {card.snippet && (
        <p
          dir="auto"
          className="mt-2 mb-0 text-[13px] leading-relaxed text-[var(--color-ink-secondary)]"
          style={{ fontFamily: "var(--f-serif)" }}
        >
          {card.snippet}
        </p>
      )}
      {card.effective && (
        <p className="mt-2 mb-0 font-mono text-[10px] text-[var(--color-ink-muted)]">
          Effective {card.effective}
        </p>
      )}
    </div>
  );
}
