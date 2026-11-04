/**
 * Why a PR's checks fail, as a cluster: one cause that many PRs share.
 *
 * A cluster comes only from what the CI job printed (its log, read by the
 * collector into pr_check_error), never from a review comment. The rules
 * are in order of the fix: the first that matches anywhere in the text gives
 * the cluster, so a PR that fails a stale pin and a test the pin breaks is
 * the stale pin. A text that matches no rule has no cluster.
 */

import type { FailureClassId } from "./failure-class";

export interface CheckCluster {
  id: string;
  label: string;
  /** The failure class the cluster belongs to (failure-class.ts). */
  class: FailureClassId;
  match: RegExp;
}

export const CHECK_CLUSTERS: CheckCluster[] = [
  { id: "stale-encoder-pin", label: "Made by an older encoder than the pin", class: "migration", match: /does not match the running pinned encoder/i },
  { id: "legacy-manifest", label: "Legacy manifest", class: "migration", match: /legacy (?:replacement|applied) manifest/i },
  { id: "waiver", label: "Waiver guard", class: "process", match: /waiver (?:ratchet|identity|fingerprint)/i },
  { id: "manual-change", label: "Manual RuleSpec change", class: "process", match: /Manual RuleSpec changes are not allowed/i },
  { id: "oracle-coverage", label: "Oracle coverage gate", class: "process", match: /oracle[- ]coverage/i },
  { id: "proof-evidence", label: "Proof excerpt not in the source", class: "rejected", match: /Proof source evidence not found/i },
  { id: "validator", label: "Validator rejected a module", class: "rejected", match: /\b(?:ci|compile): /i },
  { id: "tests", label: "Repository tests fail", class: "unknown", match: /\b\d+ failed: /i },
  { id: "cancelled", label: "Cancelled before it finished", class: "infra", match: /^Cancelled before it finished/i },
  { id: "log-expired", label: "Log no longer available", class: "unknown", match: /log is no longer available/i },
];

const BY_ID = new Map(CHECK_CLUSTERS.map((cluster) => [cluster.id, cluster]));

/** The cluster of a failing check's printed cause; null when no rule matches. */
export function checkCluster(text: string | null | undefined): CheckCluster | null {
  if (!text) return null;
  return CHECK_CLUSTERS.find((cluster) => cluster.match.test(text)) ?? null;
}

/** A cluster by its id: the `ci:<id>` rule id of a PR checks failure. */
export function checkClusterById(id: string): CheckCluster | null {
  return BY_ID.get(id) ?? null;
}
