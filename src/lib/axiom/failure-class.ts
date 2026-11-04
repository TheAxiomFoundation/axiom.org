/**
 * Failure classes: who owns the fix for a case that failed.
 *
 * The classes are axiom-encode's v1 failure classes
 * (docs/design/encode-failure-classes.md, axiom-encode #1997), plus
 * `rejected`: the validator rejected the model's output, which is an encoder
 * error or a validator false positive, and nothing recorded today tells the
 * two apart.
 *
 * A failure gets its class from the first of:
 *   encoder  the class the encoder recorded on the event (attrs.failure_class;
 *            encoders from #1997 on record one on every outcome)
 *   rule     a structured signal: the stage, the rule id, a harness tag
 *   text     a pattern in the error text, from the hand-checked 2026-10-23
 *            failure taxonomy (313 failed runs)
 * and is `unknown` when none applies. A class is advisory: it never changes
 * what failed.
 */

import { checkCluster, checkClusterById } from "./check-clusters";

export const FAILURE_CLASSES = [
  "encoder",
  "rejected",
  "validator_fp",
  "corpus",
  "dependency",
  "selection",
  "engine",
  "migration",
  "process",
  "infra",
  "unknown",
] as const;

export type FailureClassId = (typeof FAILURE_CLASSES)[number];

export type FailureBasis = "encoder" | "rule" | "text";

export const FAILURE_CLASS_COPY: Record<FailureClassId, { label: string; owner: string }> = {
  encoder: { label: "Encoder error", owner: "Encoder" },
  rejected: { label: "Validator rejected the output", owner: "Encoder or validator" },
  validator_fp: { label: "Validator false positive", owner: "Validator" },
  corpus: { label: "Corpus gap", owner: "Corpus" },
  dependency: { label: "Missing upstream dependency", owner: "Queue planning" },
  selection: { label: "Wrong target", owner: "Queue selection" },
  engine: { label: "Engine or RuleSpec limit", owner: "Engine" },
  migration: { label: "Migration debt", owner: "Engine and toolchain" },
  process: { label: "Policy or process block", owner: "Policy review" },
  infra: { label: "Infra or transient", owner: "Infra" },
  unknown: { label: "Not classified", owner: "–" },
};

export interface FailureClass {
  id: FailureClassId;
  subclass: string | null;
  basis: FailureBasis | null;
}

/** What the classifier reads from a failed visit. */
export interface FailureSignal {
  station: string;
  rule_id: string | null;
  message: string | null;
  /** The class the encoder recorded, if any (axiom-encode failure-class/v1). */
  recorded?: { class?: unknown; subclass?: unknown } | null;
}

interface Rule {
  id: FailureClassId;
  subclass?: string;
  basis: FailureBasis;
  stations?: string[];
  match: (s: FailureSignal, text: string) => boolean;
}

const re = (pattern: RegExp) => (_: FailureSignal, text: string) => pattern.test(text);

/** A validator rule id: `family:check` from a bracket tag, not a grouped error text or a workflow step. */
const VALIDATOR_RULE = /^(?!text:|infra:|check:|ci:|gate:|index:|compile:|review:|publish:|release:)[a-z][a-z0-9-]*:[a-z0-9-]+$/;

/** In order: the first rule that matches gives the class. */
const RULES: Rule[] = [
  // The pre-encode gate blocks a wrong target, or a row that lost its text.
  { id: "corpus", subclass: "content", basis: "rule", stations: ["target_gate"], match: re(/empty|punctuation only/i) },
  { id: "selection", basis: "rule", stations: ["target_gate"], match: () => true },
  // A person closed the PR without a merge.
  { id: "process", basis: "rule", stations: ["review"], match: (s) => s.rule_id === "review:closed-unmerged" },
  // The harness could not read or decode the file the model wrote.
  { id: "encoder", subclass: "harness", basis: "rule", match: re(/\[?generated-yaml:(?:io|decode)\b/i) },
  { id: "corpus", subclass: "content", basis: "text", match: re(/No local corpus source text found/i) },
  { id: "selection", basis: "text", match: re(/is repealed/i) },
  {
    id: "process",
    basis: "text",
    match: re(
      /exact pull request base branch tip|attempt-budget|approved reviewed head|refusing to provision|manifest-only refresh|Refusing to overwrite|Refusing to shrink|waiver ratchet|dependent review finding|repair replay is limited|canonical refresh manifest|waiver identity|source-add destination|excluded RuleSpec paths|supplemental changes|corpus_release does not match|source_sha256 does not match|must directly import|Manual RuleSpec changes are not allowed/i
    ),
  },
  {
    id: "encoder",
    subclass: "harness",
    basis: "text",
    match: re(/jq: error|CorpusLayoutError|repair replay target identity|repair artifact|dependent repair replay requires|issues\.json exceeds|Cannot recompute generation input digest|no changed signed apply manifest|ValueError: repair|Cannot enumerate/i),
  },
  { id: "migration", basis: "text", match: re(/removed plural|Plural corpus source paths|unknown field `values`|retired[_ ]source|retired manifest|\blegacy\b|plural-only/i) },
  // Last of the text rules: a failed fetch or a timeout is often the symptom, and a rule above names the cause.
  { id: "infra", basis: "text", match: re(/timed out|\btimeout\b|ContentStoreError|No RuleSpec content returned|HTTP 404|rate limit/i) },
  // The validator rejected a try: a named rule, or a check's own text.
  { id: "rejected", basis: "rule", stations: ["validate"], match: (s) => VALIDATOR_RULE.test(s.rule_id ?? "") },
  { id: "rejected", basis: "text", stations: ["validate"], match: re(/\b(?:ci|compile): |YAML parse failed|complete-source-unit|existing-target-oracle|temporal-dependency/i) },
];

const KNOWN = new Set<string>(FAILURE_CLASSES);

/** The class of one failure. */
export function classifyFailure(signal: FailureSignal): FailureClass {
  const recorded = signal.recorded?.class;
  // The encoder's `unknown` means it was not certain: the rules below may still know.
  if (typeof recorded === "string" && KNOWN.has(recorded) && recorded !== "rejected" && recorded !== "unknown") {
    const subclass = signal.recorded?.subclass;
    return { id: recorded as FailureClassId, subclass: typeof subclass === "string" ? subclass : null, basis: "encoder" };
  }
  // A PR checks failure the CI log names a cluster of: the cluster's class.
  const cluster =
    (signal.rule_id?.startsWith("ci:") ? checkClusterById(signal.rule_id.slice(3)) : null) ??
    (signal.station === "pr_checks" ? checkCluster(signal.message) : null);
  if (cluster && cluster.class !== "unknown") return { id: cluster.class, subclass: cluster.id, basis: "text" };
  const text = `${signal.rule_id ?? ""} ${signal.message ?? ""}`;
  for (const rule of RULES) {
    if (rule.stations && !rule.stations.includes(signal.station)) continue;
    if (rule.match(signal, text)) return { id: rule.id, subclass: rule.subclass ?? null, basis: rule.basis };
  }
  return { id: "unknown", subclass: null, basis: null };
}
