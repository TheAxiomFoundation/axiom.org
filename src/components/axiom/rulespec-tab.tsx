"use client";

import { useEffect, useMemo, useState } from "react";
import { isGitHubEncoding } from "@/lib/axiom-utils";
import type { EncodingRunScores, RuleEncodingData } from "@/lib/supabase";
import { getRuleSpecRepoForJurisdiction } from "@/lib/axiom/repo-map";
import {
  dumpRuleYaml,
  parseRuleSpec,
  parseRuleSpecTests,
  tokenizeFormula,
  type RuleSpecDoc,
  type RuleSpecRule,
  type RuleSpecTestCase,
  type RuleSpecVersion,
} from "@/lib/axiom/rulespec/doc";
import { cachedRawFetch } from "@/lib/axiom/rulespec/raw-cache";
import {
  findEncodedDescendants,
  type EncodedFile,
} from "@/lib/axiom/rulespec/repo-listing";
import { ExpandableCode } from "./expandable-code";

/**
 * Rich RuleSpec encoding view. Replaces the older "raw YAML in a
 * Prism block" treatment: parses the document into rules/versions/
 * tests and renders each as its own card with badges, an effective-
 * dated formula list, and (when available) a sibling test file
 * fetched from the repo.
 *
 * Identifier highlighting is best-effort and intentionally local:
 * tokens in a formula that match another rule's ``name`` in the same
 * file resolve to in-page anchors. Cross-file resolution belongs in a
 * future global identifier index, not here.
 */
export function RuleSpecTab({
  encoding,
  loading,
  jurisdiction,
  citationPath,
  isRepealed,
  sourceText,
}: {
  encoding: RuleEncodingData | null;
  loading: boolean;
  jurisdiction: string;
  /** Citation path for the rule being viewed. When ``encoding`` is
   *  null, used to look up related RuleSpec files below this citation
   *  path in the rules repo. These files are encodings, not proof that
   *  the source corpus has materialized child provisions. */
  citationPath?: string | null;
  isRepealed?: boolean;
  /** Body text already shown in the Source section above. When the
   *  module summary is the same prose (common for synthesised policy
   *  pages), the encoding section skips it instead of repeating it. */
  sourceText?: string | null;
}) {
  const tests = useRuleSpecTests(encoding, jurisdiction);
  const descendants = useEncodedDescendants(
    encoding ? null : citationPath ?? null
  );
  const doc = useMemo(
    () => (encoding?.rulespec_content ? parseRuleSpec(encoding.rulespec_content) : null),
    [encoding?.rulespec_content]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-ink-muted)]">
        Loading encoding data...
      </div>
    );
  }

  if (!encoding) {
    return (
      <div className="py-10 text-center">
        <div
          className="text-base text-[var(--color-ink-secondary)] mb-2"
          style={{ fontFamily: "var(--f-serif)" }}
        >
          {descendants.length > 0
            ? "Available RuleSpec encodings"
            : isRepealed
              ? "Repealed provision"
              : "Not yet encoded"}
        </div>
        <p className="text-sm text-[var(--color-ink-muted)] leading-relaxed">
          {descendants.length > 0
            ? `This source provision is partially encoded. No RuleSpec file exists for the exact provision, but ${descendants.length} related RuleSpec ${descendants.length === 1 ? "file is" : "files are"} available.`
            : isRepealed
              ? "No active RuleSpec encoding is shown for this repealed provision."
            : "This rule has not been encoded into RuleSpec format yet."}
        </p>
        {descendants.length > 0 && (
          <RelatedEncodingList descendants={descendants} />
        )}
      </div>
    );
  }

  const isGitHub = isGitHubEncoding(encoding);
  const repo = getRuleSpecRepoForJurisdiction(jurisdiction);
  const gitHubUrl = repo
    ? `https://github.com/TheAxiomFoundation/${repo}/blob/main/${encoding.file_path}`
    : null;
  const sourceDescription = isGitHub
    ? "Displaying the canonical repository encoding."
    : "Displaying the latest stored encoding run. It may differ from the repository file.";
  const scores = encoding.final_scores;

  const localNames = new Set(
    doc?.rules.filter(isExecutableRule).map((r) => r.name) ?? []
  );
  const testsByRule = groupTestsByRule(tests, localNames);

  const docHasContent =
    !!doc && (doc.rules.length > 0 || !!doc.module.summary);
  const summaryRepeatsSource =
    !!doc?.module.summary &&
    !!sourceText &&
    softUnwrap(doc.module.summary).trim() === softUnwrap(sourceText).trim();

  return (
    <div className="space-y-8">
      {scores && !isGitHub && <ScoresBlock scores={scores} />}

      {docHasContent ? (
        <>
          {doc!.module.summary && !summaryRepeatsSource && (
            <Summary text={doc!.module.summary} />
          )}
          {doc!.rules.length > 0 && (
            <div>
              {doc!.rules.map((rule) => (
                <RuleBlock
                  key={rule.name}
                  rule={rule}
                  tests={testsByRule.get(rule.name) ?? []}
                  localNames={localNames}
                />
              ))}
            </div>
          )}
          {doc!.parseErrors.length > 0 && (
            <ParseErrorsBlock errors={doc!.parseErrors} />
          )}
          <ProvenanceFooter
            filePath={encoding.file_path}
            description={isGitHub ? null : sourceDescription}
            gitHubUrl={gitHubUrl}
            isGitHub={isGitHub}
          />
        </>
      ) : (
        // Couldn't parse it as RuleSpec — show the raw YAML so a
        // reviewer can still inspect what's in the repo.
        encoding.rulespec_content && (
          <div>
            <div className="eyebrow mb-3">RuleSpec encoding</div>
            <ExpandableCode
              code={encoding.rulespec_content}
              language="yaml"
              label={encoding.file_path}
            />
            {doc?.parseErrors.length ? (
              <ParseErrorsBlock errors={doc.parseErrors} />
            ) : null}
            <ProvenanceFooter
              filePath={encoding.file_path}
              description={isGitHub ? null : sourceDescription}
              gitHubUrl={gitHubUrl}
              isGitHub={isGitHub}
            />
          </div>
        )
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function ProvenanceFooter({
  filePath,
  description,
  gitHubUrl,
  isGitHub,
}: {
  filePath: string;
  /** Extra caveat line, e.g. for stored encoder runs that may differ
   *  from the repository file. Null when no caveat is needed. */
  description: string | null;
  gitHubUrl: string | null;
  isGitHub: boolean;
}) {
  return (
    <div className="pt-4 border-t border-[var(--color-rule-subtle)]">
      <p className="m-0 font-mono text-[11px] text-[var(--color-ink-muted)] break-all">
        Encoded in <code className="text-[var(--color-ink-secondary)]">{filePath}</code>
        {gitHubUrl && (
          <>
            {" · "}
            <a
              href={gitHubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-baseline gap-1 text-[var(--color-accent)] no-underline hover:underline focus-visible:underline"
            >
              <GitHubMark />
              {isGitHub ? "view on GitHub" : "view canonical repo file"}
            </a>
          </>
        )}
      </p>
      {description && (
        <p className="mt-1 m-0 text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

function ScoresBlock({ scores }: { scores: EncodingRunScores }) {
  return (
    <div>
      <div className="eyebrow mb-3">Scores</div>
      <ul className="space-y-2">
        {(Object.entries(scores) as [string, number][]).map(([key, value]) => (
          <li key={key} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 font-mono uppercase tracking-wider text-[var(--color-ink-muted)]">
              {key}
            </span>
            <span
              role="progressbar"
              aria-label={`${key} score`}
              aria-valuenow={value}
              aria-valuemin={0}
              aria-valuemax={100}
              className="flex-1 h-1.5 bg-[var(--color-rule-subtle)] rounded overflow-hidden"
            >
              <span
                className="block h-full bg-[var(--color-accent)]"
                style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
              />
            </span>
            <span className="w-8 text-right font-mono tabular-nums text-[var(--color-ink)]">
              {value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ text }: { text: string }) {
  return (
    <section>
      <div className="eyebrow mb-3">Summary</div>
      <p
        className="text-sm leading-relaxed text-[var(--color-ink-secondary)] whitespace-pre-line"
        style={{ fontFamily: "var(--f-serif)" }}
      >
        {softUnwrap(text)}
      </p>
    </section>
  );
}

/**
 * Literal-block (``|-``) YAML summaries carry hard wraps at the source
 * line width. Join single newlines into spaces so the prose reflows,
 * but keep blank lines as paragraph breaks.
 */
export function softUnwrap(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.replace(/\s*\n\s*/g, " ").trim())
    .join("\n\n");
}

/**
 * A rule as one always-visible "worksheet" entry: name, kind,
 * effective-dated formulas rendered as readable conditionals with
 * cross-linked identifiers, then provenance and small footnote
 * toggles for the raw YAML and tests. No disclosure — the encoding
 * is the content of the page, not an appendix.
 */
function RuleBlock({
  rule,
  tests,
  localNames,
}: {
  rule: RuleSpecRule;
  tests: RuleSpecTestCase[];
  localNames: Set<string>;
}) {
  const anchor = `rule-${rule.name}`;
  const meta = ruleMeta(rule);
  const versions = rule.versions.filter((v) => v.formula);
  return (
    <article
      id={anchor}
      className="py-6 border-t border-[var(--color-rule-subtle)] first:border-t-0 first:pt-0 last:pb-0 scroll-mt-8"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="m-0 font-mono text-sm font-semibold break-all">
          <a
            href={`#${anchor}`}
            className="text-[var(--color-ink)] hover:text-[var(--color-accent)] transition-colors"
            // Inline because the global ``a`` underline is unlayered
            // and outranks the ``no-underline`` utility.
            style={{ textDecoration: "none" }}
          >
            {ruleTitle(rule)}
          </a>
        </h3>
        {rule.kind && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
            {humanizeKind(rule.kind)}
          </span>
        )}
      </div>
      {versions.length > 0 && (
        <div className="mt-3 space-y-3">
          {versions.map((v, i) => (
            <div key={i}>
              {versionDateLabel(v, versions.length) && (
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                  {versionDateLabel(v, versions.length)}
                </div>
              )}
              <FormulaView
                formula={v.formula!}
                localNames={localNames}
                selfName={rule.name}
              />
            </div>
          ))}
        </div>
      )}
      {meta.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-1 text-[11px]">
          {meta.map(({ label, value, href }) => (
            <div key={label} className="flex gap-2 min-w-0">
              <dt className="w-20 shrink-0 font-mono uppercase tracking-wider text-[var(--color-ink-muted)]">
                {label}
              </dt>
              <dd className="m-0 min-w-0 font-mono text-[var(--color-ink-secondary)] break-all">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-accent)] no-underline hover:underline"
                  >
                    {value}
                  </a>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {tests.length > 0 && <TestsBlock tests={tests} />}
        <YamlBlock rule={rule} />
      </div>
    </article>
  );
}

/**
 * Display-only pretty-print: insert a line break before each ``else``
 * in long single-line conditionals so they read as branch-per-line.
 * Pure whitespace insertion — token text is never altered.
 */
export function formatFormulaForDisplay(formula: string): string {
  const trimmed = formula.trim();
  if (trimmed.includes("\n") || trimmed.length <= 60) return trimmed;
  return trimmed.replace(/\s+else\b/g, "\nelse");
}

function versionDateLabel(
  v: RuleSpecVersion,
  count: number
): string | null {
  if (v.effective_from && v.effective_to) {
    return `${v.effective_from} → ${v.effective_to}`;
  }
  // A lone sentinel start date ("0001-01-01") on a single version
  // just means "always" — no label needed.
  if (v.effective_from && (count > 1 || v.effective_from > "1900-01-01")) {
    return `from ${v.effective_from}`;
  }
  return count > 1 ? "all dates" : null;
}

const FORMULA_KEYWORDS = new Set([
  "if",
  "else",
  "and",
  "or",
  "not",
  "in",
  "is",
]);

function FormulaView({
  formula,
  localNames,
  selfName,
}: {
  formula: string;
  localNames: Set<string>;
  selfName: string;
}) {
  const segments = tokenizeFormula(formatFormulaForDisplay(formula));
  return (
    <pre
      className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words"
      // Inline styles because the global ``pre`` rule in tokens.css is
      // unlayered and outranks Tailwind utility classes.
      style={{
        margin: 0,
        padding: "0.125rem 0 0.125rem 1rem",
        background: "transparent",
        border: "none",
        borderLeft: "2px solid var(--color-rule)",
        borderRadius: 0,
        overflow: "visible",
        color: "var(--color-ink-secondary)",
      }}
    >
      <code>
        {segments.map((seg, i) => {
          if (
            seg.isIdentifier &&
            seg.text !== selfName &&
            localNames.has(seg.text)
          ) {
            return (
              <a
                key={i}
                href={`#rule-${seg.text}`}
                className="text-[var(--color-accent)] no-underline hover:underline"
              >
                {seg.text}
              </a>
            );
          }
          if (!seg.isIdentifier && FORMULA_KEYWORDS.has(seg.text)) {
            return (
              <span key={i} className="font-semibold text-[var(--color-ink)]">
                {seg.text}
              </span>
            );
          }
          return <span key={i}>{seg.text}</span>;
        })}
      </code>
    </pre>
  );
}

function YamlBlock({ rule }: { rule: RuleSpecRule }) {
  const [open, setOpen] = useState(false);
  const yamlBlock = useMemo(() => dumpRuleYaml(rule), [rule]);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[var(--color-ink-muted)] cursor-pointer bg-transparent p-0 border-0 hover:text-[var(--color-accent)]"
        aria-expanded={open}
      >
        <span aria-hidden="true">{open ? "▼" : "▶"}</span>
        YAML
      </button>
      {open && (
        <div className="mt-3">
          <ExpandableCode code={yamlBlock} language="yaml" label={rule.name} />
        </div>
      )}
    </div>
  );
}

function TestsBlock({ tests }: { tests: RuleSpecTestCase[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[var(--color-ink-muted)] cursor-pointer bg-transparent p-0 border-0 hover:text-[var(--color-accent)]"
        aria-expanded={open}
      >
        <span aria-hidden="true">{open ? "▼" : "▶"}</span>
        Tests
        <span className="text-[var(--color-ink-muted)] normal-case tracking-normal">
          ({tests.length})
        </span>
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          {tests.map((t) => (
            <TestCase key={t.name} test={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TestCase({ test }: { test: RuleSpecTestCase }) {
  return (
    <li className="border border-[var(--color-rule)] rounded p-3 bg-[var(--color-paper)]">
      <div className="font-mono text-xs text-[var(--color-ink)] mb-2">
        {test.name}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
        <KeyValueTable label="input" data={test.input} />
        <KeyValueTable label="output" data={test.output} />
      </div>
    </li>
  );
}

function KeyValueTable({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown>;
}) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return (
      <div>
        <div className="eyebrow mb-1.5">{label}</div>
        <p className="text-[var(--color-ink-muted)] italic">∅</p>
      </div>
    );
  }
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <dl className="space-y-1 m-0">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-2 font-mono">
            <dt className="text-[var(--color-ink-muted)]">{k}</dt>
            <dd className="m-0 text-[var(--color-ink)] break-all">
              {formatScalar(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ParseErrorsBlock({ errors }: { errors: string[] }) {
  return (
    <section
      role="alert"
      className="border border-[var(--color-rule)] rounded p-3 bg-[var(--color-paper-elevated)]"
    >
      <div className="eyebrow mb-2">Parse warnings</div>
      <ul className="m-0 pl-5 list-disc text-xs text-[var(--color-ink-secondary)] space-y-1">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </section>
  );
}

function GitHubMark() {
  return (
    <svg
      className="w-3.5 h-3.5"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

export function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function ownerRuleFor(
  test: RuleSpecTestCase,
  localNames: Set<string>
): string | null {
  for (const key of Object.keys(test.output)) {
    if (localNames.has(key)) return key;
  }
  return null;
}

export function groupTestsByRule(
  tests: RuleSpecTestCase[],
  localNames: Set<string>
): Map<string, RuleSpecTestCase[]> {
  const out = new Map<string, RuleSpecTestCase[]>();
  for (const t of tests) {
    const owner = ownerRuleFor(t, localNames);
    if (!owner) continue;
    const list = out.get(owner) ?? [];
    list.push(t);
    out.set(owner, list);
  }
  return out;
}

function isExecutableRule(rule: RuleSpecRule): boolean {
  return rule.kind !== "source_relation" && rule.kind !== "data_relation";
}

function ruleTitle(rule: RuleSpecRule): string {
  if (rule.kind === "source_relation" && rule.source_relation) {
    const type = humanizeKind(rule.source_relation.type ?? "source_relation");
    const target = compactRulePath(rule.source_relation.target);
    return target ? `${type} ${target}` : type;
  }
  if (rule.kind === "data_relation") {
    const predicate = compactRulePath(rule.data_relation?.predicate);
    return predicate ? `Data relation ${predicate}` : `Data relation ${rule.name}`;
  }
  return rule.name;
}

function humanizeKind(kind: string): string {
  return kind
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function compactRulePath(path: string | null | undefined): string | null {
  if (!path) return null;
  const hash = path.split("#").pop();
  if (hash && hash !== path) return hash;
  return path.split("/").filter(Boolean).pop() ?? path;
}

function ruleMeta(
  rule: RuleSpecRule
): Array<{ label: string; value: string; href?: string }> {
  const meta: Array<{ label: string; value: string; href?: string }> = [];
  if (rule.source) {
    meta.push({
      label: "source",
      value: rule.source,
      href: rule.source_url ?? undefined,
    });
  }
  if (rule.source_span && rule.source_span !== rule.source) {
    meta.push({ label: "span", value: rule.source_span });
  }
  if (rule.kind === "source_relation" && rule.source_relation) {
    if (rule.source_relation.target) {
      meta.push({ label: "target", value: rule.source_relation.target });
    }
    if (rule.source_relation.value) {
      meta.push({ label: "value", value: rule.source_relation.value });
    }
    if (rule.source_relation.authority) {
      meta.push({ label: "authority", value: rule.source_relation.authority });
    }
  }
  if (rule.kind === "data_relation" && rule.data_relation) {
    if (rule.data_relation.predicate) {
      meta.push({ label: "predicate", value: rule.data_relation.predicate });
    }
    if (rule.data_relation.arity != null) {
      meta.push({ label: "arity", value: String(rule.data_relation.arity) });
    }
  }
  return meta;
}

// ----------------------------------------------------------------------------
// Test fetching
// ----------------------------------------------------------------------------

/**
 * Fetch the sibling ``*.test.yaml`` from the same path in the
 * jurisdiction's ``rulespec-*`` repo. We only attempt this when the
 * encoding came from GitHub (canonical repo state); for stored
 * Encoder-run encodings the file path may not correspond to anything
 * checked in yet, so we'd be probing for something that isn't there.
 */
function useRuleSpecTests(
  encoding: RuleEncodingData | null,
  jurisdiction: string
): RuleSpecTestCase[] {
  const [tests, setTests] = useState<RuleSpecTestCase[]>([]);

  useEffect(() => {
    setTests([]);
    if (!encoding || !isGitHubEncoding(encoding)) return;
    const repo = getRuleSpecRepoForJurisdiction(jurisdiction);
    if (!repo) return;
    const testPath = encoding.file_path.replace(/\.yaml$/, ".test.yaml");
    if (testPath === encoding.file_path) return;
    const url = `https://raw.githubusercontent.com/TheAxiomFoundation/${repo}/main/${testPath}`;
    let cancelled = false;
    /* v8 ignore start -- network fetch */
    cachedRawFetch(url)
      .then((res) => (res.ok ? res.body : null))
      .then((body) => {
        if (cancelled || !body) return;
        setTests(parseRuleSpecTests(body));
      })
      .catch(() => {});
    /* v8 ignore stop */
    return () => {
      cancelled = true;
    };
  }, [encoding, jurisdiction]);

  return tests;
}

/**
 * Look up RuleSpec files below ``citationPath`` in the rulespec-* repo.
 * Skipped when the rule itself has an encoding. These are related
 * repository files, not necessarily materialized source-tree children.
 */
function useEncodedDescendants(citationPath: string | null): EncodedFile[] {
  const [descendants, setDescendants] = useState<EncodedFile[]>([]);
  useEffect(() => {
    setDescendants([]);
    if (!citationPath) return;
    let cancelled = false;
    /* v8 ignore start -- network fetch */
    findEncodedDescendants(citationPath)
      .then((found) => {
        if (cancelled) return;
        setDescendants(found);
      })
      .catch(() => {});
    /* v8 ignore stop */
    return () => {
      cancelled = true;
    };
  }, [citationPath]);
  return descendants;
}

function RelatedEncodingList({
  descendants,
}: {
  descendants: EncodedFile[];
}) {
  return (
    <ul className="mt-5 m-0 p-0 list-none text-left max-w-[320px] mx-auto space-y-1">
      {descendants.map((d) => (
        <li key={d.citationPath}>
          <a
            href={`/${d.citationPath}`}
            className="block px-3 py-2 rounded no-underline hover:bg-[var(--color-paper-elevated)] focus-visible:bg-[var(--color-paper-elevated)]"
          >
            <span className="block font-mono text-xs text-[var(--color-accent)] break-all">
              {d.citationPath}
            </span>
            <span className="mt-1 block font-mono text-[10px] text-[var(--color-ink-muted)] break-all">
              {d.filePath}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
