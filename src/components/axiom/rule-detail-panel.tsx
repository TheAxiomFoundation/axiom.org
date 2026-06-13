"use client";

import { useMemo, useState, useEffect } from "react";
import {
  getJurisdictionLabel,
  isGitHubEncoding,
  isEncodingRun,
  type ViewerDocument,
} from "@/lib/axiom-utils";
import type { Rule } from "@/lib/supabase";
import { useEncoding } from "@/hooks/use-encoding";
import { useRuleReferences } from "@/hooks/use-rule-references";
import { trackAxiomEvent } from "@/lib/analytics";
import { SourceTab } from "./source-tab";
import { RuleSpecTab } from "./rulespec-tab";
import { AgentLogsTab } from "./agent-logs-tab";
import { ReferencesPanel } from "./references-panel";
import type { RuleReference } from "@/lib/supabase";
import {
  buildInlineReferences,
  type InlineReference,
} from "@/lib/axiom/inline-references";

function humaniseSlug(citationPath: string): string {
  const last = citationPath.split("/").filter(Boolean).pop() ?? citationPath;
  const words = last.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function RuleDetailPanel({
  document,
  rule,
  onBack,
  heroSlot,
}: {
  document: ViewerDocument;
  rule: Rule;
  onBack?: () => void;
  /**
   * Optional override for the hero (source) column. When provided, it
   * renders in place of ``SourceTab`` — container-rule pages pass a
   * function that builds a ``RuleInlineSummary`` from the outgoing
   * refs we already fetched, so the body still renders via RuleBody
   * (and supports ``?mark=…`` highlighting + outgoing-ref splicing).
   * When omitted, the default reader renders via ``SourceTab``.
   */
  heroSlot?: (ctx: { outgoingRefs: InlineReference[] }) => React.ReactNode;
}) {
  const { encoding, sessionEvents, agentTranscripts, loading } = useEncoding(rule.id);
  const { outgoing, incoming } = useRuleReferences(rule.citation_path);
  const [logsOpen, setLogsOpen] = useState(false);
  const hasEncodingRunData = isEncodingRun(encoding);
  const outgoingWithInferred = useMemo(
    () =>
      buildInlineReferences(
        rule.body ?? document.body ?? null,
        rule.citation_path ?? document.citationPath,
        outgoing
      ),
    [document.body, document.citationPath, outgoing, rule.body, rule.citation_path]
  );

  /* v8 ignore start -- analytics side effect */
  useEffect(() => {
    if (encoding) {
      trackAxiomEvent("axiom_encoding_viewed", {
        citation_path: rule.citation_path || rule.id,
        source: isGitHubEncoding(encoding) ? "github" : "encoding_run",
      });
    }
  }, [encoding, rule.citation_path, rule.id]);
  /* v8 ignore stop */

  const docKind = rule.doc_type
    ? rule.doc_type.charAt(0).toUpperCase() + rule.doc_type.slice(1)
    : document.jurisdiction === "us" || document.jurisdiction.startsWith("us-")
      ? "Code"
      : "Statute";
  // Synthesised policy/guidance pages have a raw citation path (e.g.
  // "uk/policy/govuk/…") instead of a real citation. Humanise the last
  // slug for the headline and demote the path to a mono line under it.
  // Exact equality with the citation path avoids false positives on
  // formatted citations that contain slashes (e.g. "UKSI 2013/376").
  const citationIsPath =
    document.citation === (rule.citation_path ?? document.citationPath);
  const displayTitle = citationIsPath
    ? humaniseSlug(document.citation)
    : document.citation;
  // Hide the subtitle when it's just the opening of the source text
  // shown directly below (synthesised pages derive it that way).
  const sourceText = (rule.body ?? document.body ?? "").replace(/\s+/g, " ").trim();
  const subtitleIsRedundant =
    !!document.title &&
    sourceText.length > 0 &&
    sourceText.startsWith(
      document.title.replace(/…$/, "").replace(/\s+/g, " ").trim()
    );
  const subsectionStatus =
    document.isRepealed
      ? "Repealed provision"
      : document.subsections.length > 0
        ? `${document.subsections.length} subsection${
            document.subsections.length === 1 ? "" : "s"
          }`
        : "Source text";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="px-8 py-6 border-b border-[var(--color-rule)] bg-[var(--color-paper-elevated)]">
        <div className="max-w-[720px] mx-auto flex items-start gap-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to browser"
              className="mt-1 inline-flex items-center justify-center w-8 h-8 rounded border border-[var(--color-rule)] bg-transparent text-[var(--color-ink-muted)] cursor-pointer hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors shrink-0"
            >
              <svg
                viewBox="0 0 20 20"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 15l-5-5 5-5" />
              </svg>
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
              <span>{getJurisdictionLabel(document.jurisdiction)}</span>
              <span aria-hidden="true" className="text-[var(--color-ink-muted)]">
                ·
              </span>
              <span className="text-[var(--color-ink-muted)]">{docKind}</span>
              {document.hasRuleSpec && (
                <>
                  <span aria-hidden="true" className="text-[var(--color-ink-muted)]">
                    ·
                  </span>
                  <span>Encoded</span>
                </>
              )}
              {document.isRepealed && (
                <>
                  <span aria-hidden="true" className="text-[var(--color-ink-muted)]">
                    ·
                  </span>
                  <span>Repealed</span>
                </>
              )}
            </div>
            <h1 className="heading-section text-[var(--color-ink)] m-0 break-words">
              {displayTitle}
            </h1>
            {citationIsPath && (
              <code className="mt-2 block font-mono text-xs text-[var(--color-ink-muted)] break-all">
                {document.citation}
              </code>
            )}
            {!subtitleIsRedundant && (
              <p
                className="mt-3 text-[1.05rem] leading-snug text-[var(--color-ink-secondary)]"
                style={{ fontFamily: "var(--f-serif)" }}
              >
                {document.title}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Source, then encoding, then references — one reading column */}
      <main className="flex-1 overflow-y-auto">
        <article className="px-8 py-8">
          <div className="max-w-[720px] mx-auto">
            <div className="eyebrow mb-6">Source</div>
            {heroSlot ? (
              heroSlot({ outgoingRefs: outgoingWithInferred })
            ) : (
              <SourceTab
                document={document}
                outgoingRefs={outgoingWithInferred}
              />
            )}
          </div>
        </article>

        <section className="px-8 py-8 border-t border-[var(--color-rule)]">
          <div className="max-w-[720px] mx-auto">
            <div className="eyebrow mb-6">Encoding</div>
            <RuleSpecTab
              encoding={encoding}
              loading={loading}
              jurisdiction={document.jurisdiction}
              citationPath={rule.citation_path}
              isRepealed={document.isRepealed}
              sourceText={rule.body ?? document.body}
            />
          </div>
        </section>

        {(outgoingWithInferred.length > 0 || incoming.length > 0) && (
          <section className="px-8 py-8 border-t border-[var(--color-rule)]">
            <div className="max-w-[720px] mx-auto">
              <ReferencesPanel
                outgoing={outgoingWithInferred}
                incoming={incoming}
              />
            </div>
          </section>
        )}
      </main>

      {/* Agent logs drawer */}
      {(hasEncodingRunData || sessionEvents.length > 0 || loading) && (
        <div className="border-t border-[var(--color-rule)]">
          <button
            className="w-full px-6 py-3 flex items-center justify-between bg-transparent cursor-pointer hover:bg-[var(--color-code-bg)] transition-colors"
            onClick={() => setLogsOpen((prev) => !prev)}
          >
            <span className="font-mono text-xs text-[var(--color-ink-muted)] uppercase tracking-wider flex items-center gap-2">
              <span>{logsOpen ? "\u25BC" : "\u25B6"}</span>
              Agent logs
              {!loading && sessionEvents.length > 0 && (
                <span className="text-[var(--color-ink-muted)]">
                  ({sessionEvents.length} events)
                </span>
              )}
              {encoding?.encoder_version && (
                <span className="normal-case text-[var(--color-ink-muted)]">
                  encoder {encoding.encoder_version}
                </span>
              )}
            </span>
          </button>
          {logsOpen && (
            <div className="px-6 pb-6 max-h-[500px] overflow-y-auto">
              <AgentLogsTab
                sessionEvents={sessionEvents}
                agentTranscripts={agentTranscripts}
                encoding={encoding}
                loading={loading}
                /* v8 ignore next -- null coalescing branch */
                sessionId={encoding?.session_id ?? null}
              />
            </div>
          )}
        </div>
      )}

      {/* Status bar */}
      <footer className="flex items-center justify-between px-6 py-2 border-t border-[var(--color-rule)] bg-[var(--color-paper-elevated)]">
        <div className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          <span className="w-1.5 h-1.5 bg-[var(--color-success)] rounded-full" />
          <span>Connected to Axiom</span>
        </div>
        <span className="text-xs text-[var(--color-ink-muted)]">
          {subsectionStatus}
          {encoding && " | RuleSpec available"}
        </span>
      </footer>
    </div>
  );
}
