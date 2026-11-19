/**
 * Encodings in flight for the program bundle pages: the open RuleSpec PRs
 * that add a primary module, each module mapped to the provision it encodes
 * and given its state.
 *
 * The PRs come from one GitHub GraphQL query per collector pass
 * (OPEN_PRS_QUERY, paged, at most MAX_OPEN_PR_PAGES pages). A read that
 * fails or reaches the cap gives null: the pages then say the PRs were not
 * read, never that there are none.
 *
 * Collector-only: the page reads the stored rows (program-bundles.ts).
 */
import { derivedCitation, isModuleBucketPath, rulespecModulePaths } from "./encoding-pipeline-collect";
import { docTypeCrosswalk } from "./ops-citations";
import type { InFlightModule, InFlightState } from "./program-bundles";

/** The repo whose PRs are read. */
export const IN_FLIGHT_REPO = "rulespec-us";
export const IN_FLIGHT_OWNER = "TheAxiomFoundation";

/** PRs to a page. Each brings up to 100 changed files, so a page stays well under GitHub's per-query node limit. */
export const OPEN_PRS_PER_PAGE = 50;
/** The hard cap: past this many pages the read is incomplete, so it gives no data. */
export const MAX_OPEN_PR_PAGES = 10;

/**
 * Every open PR of a repo with its review decision and changed files, oldest
 * first (a stable order while paging). A PR with more than 100 changed files
 * is no candidate or train; its files' pageInfo says so, and it is skipped.
 */
export const OPEN_PRS_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    pullRequests(states: OPEN, first: ${OPEN_PRS_PER_PAGE}, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number url isDraft baseRefName headRefName reviewDecision changedFiles
        files(first: 100) { pageInfo { hasNextPage } nodes { path changeType } }
      }
    }
  }
}`;

/** One PR as OPEN_PRS_QUERY returns it. */
export interface OpenPrNode {
  number: number;
  url: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  reviewDecision: string | null;
  changedFiles?: number;
  files: { pageInfo?: { hasNextPage: boolean } | null; nodes: Array<{ path: string; changeType: string }> } | null;
}

/** OPEN_PRS_QUERY's `data`. */
export interface OpenPrsData {
  repository: {
    defaultBranchRef: { name: string } | null;
    pullRequests: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<OpenPrNode | null>;
    };
  } | null;
}

/** Every open PR, a page at a time; null when a page fails, comes back malformed, or the cap is reached. */
export async function readOpenPrs(
  fetchPage: (cursor: string | null) => Promise<OpenPrsData>,
  log: (line: string) => void = () => {}
): Promise<{ defaultBranch: string; prs: OpenPrNode[] } | null> {
  const prs: OpenPrNode[] = [];
  let cursor: string | null = null;
  let defaultBranch: string | null = null;
  for (let page = 0; page < MAX_OPEN_PR_PAGES; page++) {
    let data: OpenPrsData;
    try {
      data = await fetchPage(cursor);
    } catch (error) {
      log(`open PRs not read: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const connection = data?.repository?.pullRequests;
    defaultBranch ??= data?.repository?.defaultBranchRef?.name ?? null;
    if (!connection || !Array.isArray(connection.nodes) || !defaultBranch) {
      log("open PRs not read: the response holds no pull requests");
      return null;
    }
    prs.push(...connection.nodes.filter((n): n is OpenPrNode => Boolean(n?.number)));
    if (!connection.pageInfo?.hasNextPage) return { defaultBranch, prs };
    cursor = connection.pageInfo.endCursor;
  }
  log(`open PRs not read: more than ${MAX_OPEN_PR_PAGES * OPEN_PRS_PER_PAGE} open PRs (the cap)`);
  return null;
}

const MANIFEST_RE = /^\.axiom\/encoding-manifests\/(.+)\.json$/;

/** The primary modules a PR adds: new RuleSpec module files in a bucket folder (not tests, not .axiom/). */
export function addedModules(pr: Pick<OpenPrNode, "files">): string[] {
  const added = (pr.files?.nodes ?? []).filter((f) => f.changeType === "ADDED").map((f) => f.path);
  return rulespecModulePaths(added).filter(isModuleBucketPath);
}

/** The modules a PR carries a signed manifest for: .axiom/encoding-manifests/<module path>.json, as the module's path. */
export function manifestModules(pr: Pick<OpenPrNode, "files">): string[] {
  return (pr.files?.nodes ?? [])
    .filter((f) => f.changeType !== "DELETED")
    .map((f) => f.path.match(MANIFEST_RE)?.[1])
    .filter((path): path is string => Boolean(path))
    .map((path) => `${path}.yaml`);
}

/**
 * A module's citation in each document class the corpus may file it under:
 * the index's citation from its path (derivedCitation: rulespec-us
 * us-az/policies/des/faa5/x/block-4.yaml is us-az/policy/des/faa5/x/block-4),
 * then the same path in the classes the reader treats as one
 * (docTypeCrosswalk: us-az/manual/des/faa5/x/block-4).
 */
export function moduleCitations(repo: string, module: string): string[] {
  const citation = derivedCitation(repo, module);
  const [jurisdiction, kind, ...rest] = citation.split("/");
  return [citation, ...docTypeCrosswalk(kind).map((sibling) => [jurisdiction, sibling, ...rest].join("/"))];
}

/**
 * The modules the open PRs add, each with its state:
 * - in-train: a PR into the default branch that adds several modules and
 *   carries a signed manifest for each;
 * - signed: a signed manifest for the module, in the PR itself or in an open
 *   manifest PR into the PR's branch (the signing run follows approval, so
 *   a later push that dismisses the approval does not undo it);
 * - changes-requested, candidate-reviewed (approved), or candidate, by the
 *   PR's review decision.
 * A module two open PRs add (a signed candidate and the train that carries
 * it) is listed once for each.
 */
export function inFlightModules(
  prs: OpenPrNode[],
  { repo = IN_FLIGHT_REPO, defaultBranch }: { repo?: string; defaultBranch: string },
  log: (line: string) => void = () => {}
): InFlightModule[] {
  const readable = prs.filter((pr) => {
    if (!pr.files?.pageInfo?.hasNextPage) return true;
    log(`#${pr.number}: more than 100 changed files, not read as a candidate or train`);
    return false;
  });
  // Manifest PRs into a side branch (a candidate's), by that branch.
  const manifestsInto = new Map<string, Array<{ pr: OpenPrNode; modules: string[] }>>();
  for (const pr of readable) {
    const modules = manifestModules(pr);
    if (!modules.length || pr.baseRefName === defaultBranch) continue;
    manifestsInto.set(pr.baseRefName, [...(manifestsInto.get(pr.baseRefName) ?? []), { pr, modules }]);
  }
  const out: InFlightModule[] = [];
  for (const pr of readable) {
    const modules = addedModules(pr);
    if (!modules.length) continue;
    const own = new Set(manifestModules(pr));
    const train = pr.baseRefName === defaultBranch && modules.length > 1 && modules.every((m) => own.has(m));
    const into = (manifestsInto.get(pr.headRefName) ?? []).filter((m) => m.pr.number !== pr.number);
    for (const module of modules) {
      const signer = into.find((m) => m.modules.includes(module))?.pr ?? null;
      const state: InFlightState = train
        ? "in-train"
        : own.has(module) || signer
          ? "signed"
          : pr.reviewDecision === "CHANGES_REQUESTED"
            ? "changes-requested"
            : pr.reviewDecision === "APPROVED"
              ? "candidate-reviewed"
              : "candidate";
      out.push({
        module,
        citations: moduleCitations(repo, module),
        pr: pr.number,
        url: pr.url,
        state,
        review_decision: pr.reviewDecision ?? null,
        draft: pr.isDraft,
        manifest_pr: signer ? { number: signer.number, url: signer.url } : null,
      });
    }
  }
  return out.sort((a, b) => a.module.localeCompare(b.module) || a.pr - b.pr);
}
