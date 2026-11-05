/**
 * What an open signed manifest PR waits on, from GitHub's own records: the
 * PRs and issues linked to it, what kind each is, and where each stands.
 *
 * Every fact is structured GitHub data, never the meaning of a comment:
 *   links  a cross-reference event (another item linked this one), or a
 *          full reference in the PR's own body (owner/repo#n or its URL);
 *          a bare #n is not followed, since GitHub resolves it to the same repo
 *   kind   the repo and the changed files (see linkKind)
 *   state  open, draft, changes requested, merged or closed, from GitHub
 *   pin    for a merged encoder fix: the version at its merge commit, and
 *          whether the rulespec repo's encoder pin has reached it
 * Two steps out from the PR, and the second only from an item still open:
 * a merged fix is linked from many places, and those are not this PR's.
 */

export const LINK_ORG = "TheAxiomFoundation";

export type LinkKind = "encoder" | "corpus" | "pin" | "encoding" | "rulespec" | "issue" | "other";

export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  encoder: "Encoder fix",
  corpus: "Corpus",
  pin: "Pin bump",
  encoding: "Encoding PR",
  rulespec: "RuleSpec change",
  issue: "Issue",
  other: "Linked",
};

export interface PrLink {
  /** "rulespec-us#2023". */
  ref: string;
  url: string;
  title: string;
  kind: LinkKind;
  state: "open" | "draft" | "merged" | "closed";
  /** An open PR's review decision, and who decided it last. */
  review: "approved" | "changes_requested" | null;
  reviewer: string | null;
  mergedAt: string | null;
  /** A merged encoder fix: the encoder version at its merge commit. */
  version: string | null;
  /** 1: linked to the PR itself; 2: linked to an open item that is. */
  step: 1 | 2;
  /** For step 2: the step-1 item it was linked through. */
  via: string | null;
}

export interface PrLinks {
  /** The PR's own last review: who, and what they decided. */
  review: { by: string; state: string; at: string } | null;
  comments: { count: number; lastAt: string | null; lastBy: string | null };
  /** The PR's repo's encoder pin (.axiom/workflow-toolchain.toml on its default branch). */
  pin: string | null;
  links: PrLink[];
  readAt: string;
}

/** An item as the link query returns it (see scripts/collect-encoding-pipeline.mjs). */
export interface LinkNode {
  __typename: "PullRequest" | "Issue";
  number: number;
  url: string;
  title: string;
  body?: string | null;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  mergedAt?: string | null;
  reviewDecision?: string | null;
  repository: { name: string };
  mergeCommit?: { oid: string } | null;
  files?: { totalCount: number; nodes: Array<{ path: string }> } | null;
  latestReviews?: { nodes: Array<{ author: { login: string } | null; state: string; submittedAt: string | null }> } | null;
  comments?: { totalCount: number; nodes: Array<{ createdAt: string; author: { login: string } | null }> } | null;
  timelineItems?: {
    nodes: Array<{ source?: { __typename?: string; number?: number; repository?: { name: string } } | null } | null>;
  } | null;
}

const TOOLCHAIN_FILE = ".axiom/workflow-toolchain.toml";
const ENCODING_TITLE = /^Add signed encoding manifest for /;

/** What a linked item is, from its repo and, for a rulespec PR, its files and title. */
export function linkKind(node: Pick<LinkNode, "__typename" | "title" | "repository" | "files">): LinkKind {
  if (node.__typename === "Issue") return "issue";
  const repo = node.repository.name;
  if (repo === "axiom-encode") return "encoder";
  if (repo === "axiom-corpus") return "corpus";
  if (repo.startsWith("rulespec-")) {
    const paths = node.files?.nodes.map((file) => file.path) ?? [];
    if (paths.length && node.files?.totalCount === paths.length && paths.every((path) => path === TOOLCHAIN_FILE)) return "pin";
    if (ENCODING_TITLE.test(node.title)) return "encoding";
    return "rulespec";
  }
  return "other";
}

export const refOf = (repo: string, number: number) => `${repo}#${number}`;

const BODY_REF = new RegExp(
  String.raw`https://github\.com/${LINK_ORG}/([\w.-]+)/(?:pull|issues)/(\d+)|(?<![\w/.-])(?:${LINK_ORG}/)?((?:axiom|rulespec)-[\w.-]*)#(\d+)`,
  "g"
);

/**
 * The items an item links to or is linked from: its cross-reference events
 * (inside the org), and the full references in its body. Not itself.
 */
export function linkedRefs(node: LinkNode): string[] {
  const self = refOf(node.repository.name, node.number);
  const refs = new Set<string>();
  for (const event of node.timelineItems?.nodes ?? []) {
    const source = event?.source;
    if (source?.number && source.repository?.name) refs.add(refOf(source.repository.name, source.number));
  }
  for (const match of (node.body ?? "").matchAll(BODY_REF)) {
    refs.add(match[1] ? refOf(match[1], Number(match[2])) : refOf(match[3], Number(match[4])));
  }
  refs.delete(self);
  return [...refs];
}

function stateOf(node: LinkNode): PrLink["state"] {
  if (node.state === "MERGED" || node.mergedAt) return "merged";
  if (node.state === "CLOSED") return "closed";
  return node.isDraft ? "draft" : "open";
}

function lastReview(node: LinkNode): { by: string; state: string; at: string } | null {
  const decided = (node.latestReviews?.nodes ?? [])
    .filter((review) => review.author && review.submittedAt && review.state !== "COMMENTED")
    .sort((a, b) => b.submittedAt!.localeCompare(a.submittedAt!));
  const last = decided[0];
  return last ? { by: last.author!.login, state: last.state.toLowerCase(), at: last.submittedAt! } : null;
}

/** "0.2.2308" ≥ "0.2.2248": dotted numeric versions, compared part by part. */
export function versionAtLeast(version: string, floor: string): boolean {
  const a = version.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff > 0;
  }
  return true;
}

function link(node: LinkNode, step: 1 | 2, via: string | null, versions: Map<string, string>): PrLink {
  const state = stateOf(node);
  const review = lastReview(node);
  const decision = node.reviewDecision === "APPROVED" ? "approved" : node.reviewDecision === "CHANGES_REQUESTED" ? "changes_requested" : null;
  return {
    ref: refOf(node.repository.name, node.number),
    url: node.url,
    title: node.title,
    kind: linkKind(node),
    state,
    review: state === "open" || state === "draft" ? decision : null,
    reviewer: decision ? (review?.by ?? null) : null,
    mergedAt: node.mergedAt ?? null,
    version: state === "merged" && node.mergeCommit ? (versions.get(node.mergeCommit.oid) ?? null) : null,
    step,
    via,
  };
}

const isOpen = (node: LinkNode) => node.state === "OPEN";

/**
 * A PR's links, two steps out: every item linked to it, and every item
 * linked to one of those that is still open. `nodes` holds every item read,
 * by ref; `versions` the encoder version at each merge commit read.
 */
export function prLinks(
  pr: LinkNode,
  nodes: Map<string, LinkNode>,
  pin: string | null,
  versions: Map<string, string>,
  readAt: string
): PrLinks {
  const self = refOf(pr.repository.name, pr.number);
  const links: PrLink[] = [];
  const seen = new Set([self]);
  const first = linkedRefs(pr).filter((ref) => nodes.has(ref));
  for (const ref of first) seen.add(ref);
  for (const ref of first) links.push(link(nodes.get(ref)!, 1, null, versions));
  for (const ref of first) {
    const node = nodes.get(ref)!;
    if (!isOpen(node)) continue;
    for (const next of linkedRefs(node)) {
      if (seen.has(next) || !nodes.has(next)) continue;
      seen.add(next);
      links.push(link(nodes.get(next)!, 2, ref, versions));
    }
  }
  return {
    review: lastReview(pr),
    comments: {
      count: pr.comments?.totalCount ?? 0,
      lastAt: pr.comments?.nodes.at(-1)?.createdAt ?? null,
      lastBy: pr.comments?.nodes.at(-1)?.author?.login ?? null,
    },
    pin,
    links,
    readAt,
  };
}

/** The refs to read next: those linked from the items read that the walk still needs. */
export function refsToRead(pr: LinkNode, nodes: Map<string, LinkNode>): string[] {
  const want = new Set(linkedRefs(pr));
  for (const ref of linkedRefs(pr)) {
    const node = nodes.get(ref);
    if (node && isOpen(node)) for (const next of linkedRefs(node)) want.add(next);
  }
  want.delete(refOf(pr.repository.name, pr.number));
  return [...want].filter((ref) => !nodes.has(ref));
}

/** Whether a merged encoder fix is in the pin: null when either version is not known. */
export function inPin(link: PrLink, pin: string | null): boolean | null {
  if (link.kind !== "encoder" || link.state !== "merged" || !link.version || !pin) return null;
  return versionAtLeast(pin, link.version);
}
