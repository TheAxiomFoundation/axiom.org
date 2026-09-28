"use client";

import type { ReactNode } from "react";
import type { RuleEncodingData, RuleReference } from "@/lib/supabase";
import type { InlineReference } from "@/lib/axiom/inline-references";
import {
  refsForChunk,
  type EncodedRuleLink,
  type SectionPageData,
} from "@/lib/axiom/section-page";
import type { ProvisionProgramCoverage } from "@/lib/axiom/runtime/coverage";
import { RuleSpecTab } from "@/components/axiom/rulespec-tab";
import { RuleCardList, type RuleCardDetail } from "./rule-cards";
import { formatCitationLabel } from "@/components/axiom/references-panel";
import { trackAxiomEvent } from "@/lib/analytics";
import { isGitHubEncoding } from "@/lib/axiom-utils";
import { parseRuleSpec } from "@/lib/axiom/rulespec/doc";
import { useMemo } from "react";
import yaml from "js-yaml";
import { ReferencesPanel } from "@/components/axiom/references-panel";
import { useActiveAnchor } from "./use-active-anchor";
import { ruleSpecBlobUrl } from "@/lib/axiom/repo-map";

export interface RailChunk {
  anchor: string;
  designator: string;
  label: string;
  text: string;
}

import { programFamily } from "@/lib/axiom/runtime/families";

/** Short jurisdiction chip: "us-co" → "CO", "us" → "US", "uk" → "UK". */
function jurisdictionChip(jurisdiction: string): string {
  const parts = jurisdiction.split("-");
  return (parts[1] ?? parts[0]).toUpperCase();
}

/**
 * Collapsed-by-default disclosure. Native <details> so the rail
 * stays server-renderable and works without JS; the reading page is
 * calm and one click opens each drawer.
 */
function RailSection({
  summary,
  testId,
  defaultOpen = false,
  children,
}: {
  summary: string;
  testId?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      data-testid={testId}
      open={defaultOpen}
      className="group border-t border-[var(--color-rule)] pt-2"
    >
      <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/**
 * The v2 rail — the inspector for the node being read. Order of
 * importance, top down: where you are and what ran (always visible),
 * then Rules / Executable-in / Citations as collapsed drawers. The
 * reading column stays calm; this is where the machinery lives.
 *
 * Follow mode (default) scopes everything to the subsection under
 * the reading line; above the first subsection it covers the whole
 * section.
 */
export function EncodingRail({
  highlightRule = null,
  encoding,
  jurisdiction,
  citationPath,
  isRepealed,
  chunks,
  encodedRules,
  outgoing,
  incoming,
  programs = [],
  ruleFiles = {},
  citedByFiles = [],
  citedByOverflow = 0,
}: {
  /** Rule the visitor navigated from — its card is spotlighted. */
  highlightRule?: string | null;
  encoding: RuleEncodingData | null;
  jurisdiction: string;
  citationPath: string | null;
  isRepealed: boolean;
  chunks: RailChunk[];
  encodedRules: EncodedRuleLink[];
  outgoing: InlineReference[];
  incoming: RuleReference[];
  programs?: ProvisionProgramCoverage[];
  /** Rule name → repo file path; enables per-rule graph links. */
  ruleFiles?: Record<string, string>;
  /** Policy-rooted modules with rules grounded in this provision. */
  citedByFiles?: SectionPageData["citedByFiles"];
  /** Citing rules beyond the bounded lookup (not shown). */
  citedByOverflow?: number;
}) {
  const ruleDetails = useMemo(() => {
    const map = new Map<string, RuleCardDetail>();
    if (!encoding?.rulespec_content) return map;
    for (const rule of parseRuleSpec(encoding.rulespec_content).rules) {
      map.set(rule.name, {
        source: rule.source ?? null,
        yaml: yaml.dump(rule.raw, {
          indent: 2,
          lineWidth: 80,
          noRefs: true,
          sortKeys: false,
        }),
      });
    }
    return map;
  }, [encoding?.rulespec_content]);

  const active = useActiveAnchor(chunks.map((chunk) => chunk.anchor));
  const activeChunk = chunks.find((chunk) => chunk.anchor === active);
  const nodeMode = Boolean(activeChunk);

  // Scope everything to the active subsection in follow mode — but the
  // navigated-from rule must never be scoped away.
  const citedByRulesByRenderedName = new Map(
    citedByFiles.flatMap((file) =>
      file.rules.map((rule) => [rule.renderedName, rule] as const),
    ),
  );
  const matchesHighlight = (renderedName: string) => {
    if (renderedName === highlightRule) return true;
    const citation = citedByRulesByRenderedName.get(renderedName);
    return citation?.canonicalName === highlightRule;
  };
  const nodeRules = activeChunk
    ? encodedRules.filter(
        (rule) =>
          rule.anchors.includes(activeChunk.anchor) ||
          matchesHighlight(rule.name),
      )
    : encodedRules;
  const citedByRuleNames = new Set(
    citedByFiles.flatMap((file) =>
      file.rules.map((rule) => rule.renderedName),
    ),
  );
  const pathMatchedRules = nodeRules.filter(
    (rule) => !citedByRuleNames.has(rule.name),
  );
  const nodeRulesByName = new Map(nodeRules.map((rule) => [rule.name, rule]));
  const citedByGroups = citedByFiles
    .map((file) => ({
      ...file,
      visibleRules: file.rules.flatMap((citation) => {
        const rule = nodeRulesByName.get(citation.renderedName);
        return rule ? [{ citation, rule }] : [];
      }),
    }))
    .filter((file) => file.visibleRules.length > 0);
  const nodeOutgoing = activeChunk
    ? (refsForChunk(outgoing, activeChunk.text) as InlineReference[])
    : outgoing;
  const nodeIncoming = nodeMode ? [] : incoming;
  const nodePrograms = activeChunk
    ? programs.filter((program) => program.anchors.includes(activeChunk.anchor))
    : programs;
  const textAnchors = Object.fromEntries(
    nodeRules
      .filter((rule) => rule.anchors.length > 0)
      .map((rule) => [
        rule.name,
        activeChunk ? activeChunk.anchor : rule.anchors[0],
      ]),
  );

  const citesSummary =
    nodeOutgoing.length > 0 || nodeIncoming.length > 0
      ? `citations (${nodeOutgoing.length}${
          nodeIncoming.length > 0 ? ` · cited by ${nodeIncoming.length}` : ""
        })`
      : null;

  return (
    <div>
      {/* Scope header: one readable line naming what the rail is
          showing right now. Counts live on the drawer summaries — no
          duplicate stat line. */}
      <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        in view
      </p>
      <p
        data-testid="rail-header"
        className="mb-3 truncate text-sm text-[var(--color-ink)]"
        style={{ fontFamily: "var(--f-serif)" }}
        title={activeChunk?.label}
      >
        {activeChunk ? activeChunk.label : "Whole section"}
      </p>

      {nodeRules.length > 0 && (
        <section data-testid="rail-encodings" className="mt-4">
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
            Encodings · {nodeRules.length}
          </h3>
          {pathMatchedRules.length > 0 && (
            <RuleCardList
              rules={pathMatchedRules}
              highlightRule={highlightRule}
              citationLabel={
                citationPath ? formatCitationLabel(citationPath) : ""
              }
              detailFor={(ruleName) => ruleDetails.get(ruleName) ?? null}
              onExpand={() => {
                if (!citationPath) return;
                trackAxiomEvent("axiom_encoding_viewed", {
                  citation_path: citationPath,
                  source: isGitHubEncoding(encoding)
                    ? "github"
                    : "encoding_run",
                });
              }}
            />
          )}
          {(citedByGroups.length > 0 || citedByOverflow > 0) && (
            <div
              data-testid="rail-cited-by"
              className={
                pathMatchedRules.length > 0
                  ? "mt-4 border-t border-[var(--color-rule)] pt-3"
                  : ""
              }
            >
              <h4 className="text-xs font-medium text-[var(--color-ink-secondary)]">
                Encoded from this provision
              </h4>
              <div className="mt-3 space-y-4">
                {citedByGroups.map((file) => {
                  const gitHubUrl = ruleSpecBlobUrl(
                    jurisdiction,
                    file.filePath,
                  );
                  return (
                    <div key={`${file.citationPath}:${file.filePath}`}>
                      {gitHubUrl ? (
                        <a
                          href={gitHubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block break-all font-mono text-[11px] text-[var(--color-accent)] no-underline hover:underline focus-visible:underline"
                        >
                          {file.citationPath}
                        </a>
                      ) : (
                        <span className="block break-all font-mono text-[11px] text-[var(--color-ink-muted)]">
                          {file.citationPath}
                        </span>
                      )}
                      {file.visibleRules.some(
                        ({ citation }) =>
                          citation.renderedName !== citation.canonicalName,
                      ) && (
                        <div className="mt-2 space-y-1">
                          {file.visibleRules.flatMap(({ citation }) =>
                            citation.renderedName === citation.canonicalName
                              ? []
                              : [
                                  <p
                                    key={citation.renderedName}
                                    className="break-all text-[11px] text-[var(--color-ink-muted)]"
                                  >
                                    <span className="font-mono text-[var(--color-ink-secondary)]">
                                      {citation.canonicalName}
                                    </span>{" "}
                                    rendered as{" "}
                                    <span className="font-mono">
                                      {citation.renderedName}
                                    </span>
                                    .
                                  </p>,
                                ],
                          )}
                        </div>
                      )}
                      <div className="mt-2">
                        <RuleCardList
                          rules={file.visibleRules.map(({ rule }) => rule)}
                          highlightRule={
                            file.visibleRules.find(({ citation }) =>
                              matchesHighlight(citation.renderedName),
                            )?.citation.renderedName ?? null
                          }
                          citationLabel={
                            citationPath
                              ? formatCitationLabel(citationPath)
                              : ""
                          }
                          detailFor={(ruleName) =>
                            ruleDetails.get(ruleName) ?? null
                          }
                          onExpand={() => {
                            if (!citationPath) return;
                            trackAxiomEvent("axiom_encoding_viewed", {
                              citation_path: citationPath,
                              source: isGitHubEncoding(encoding)
                                ? "github"
                                : "encoding_run",
                            });
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {citedByOverflow > 0 && (
                <p
                  data-testid="rail-cited-by-overflow"
                  className="mt-3 text-xs text-[var(--color-ink-muted)]"
                >
                  {citedByOverflow} more rules in other modules are grounded in
                  this provision. This view shows the first 120 by rank and
                  module path.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="mt-3 space-y-2">
        {(encoding || nodeRules.length > 0) && (
          <RailSection summary="rulespec code" testId="rail-rules">
            <RuleSpecTab
              encoding={encoding}
              loading={false}
              jurisdiction={jurisdiction}
              citationPath={citationPath}
              isRepealed={isRepealed}
              showSummary={false}
              showHeader={!nodeMode}
              ruleGroups={
                activeChunk
                  ? [
                      {
                        // The rail header already names the node; an
                        // empty label suppresses the duplicate group
                        // heading.
                        label: "",
                        ruleNames: nodeRules.map((rule) => rule.name),
                      },
                    ]
                  : undefined
              }
              includeUngrouped={!activeChunk}
              textAnchors={textAnchors}
            />
          </RailSection>
        )}
        {citesSummary && (
          <RailSection summary={citesSummary} testId="rail-citations">
            <ReferencesPanel outgoing={nodeOutgoing} incoming={nodeIncoming} />
          </RailSection>
        )}
      </div>
    </div>
  );
}
