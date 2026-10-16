/**
 * Durable encoding queues, read from the public axiom-encode repo. Two kinds:
 *
 * - dispatcher queues (`queues/*.json` on the `encoding-queue-state` branch),
 *   which the hourly SNAP dispatch workflow sends to the targeted encode
 *   workflow and updates with each item's outcome;
 * - the earlier signed inventories (`data/encoding-queues/*.json` on main).
 *   Nothing dispatches from them any more and their files no longer change;
 *   the dispatcher lists only some of their items.
 *
 * The queue files are large (the all-state SNAP inventory is ~5 MB), so
 * reads are cached for QUEUE_REVALIDATE_SECONDS and only a small aggregate
 * ever leaves the server. Facts that change rarely (each inventory's last
 * commit, the dispatch workflow's state) are cached for
 * FACTS_REVALIDATE_SECONDS, to spend few GitHub API calls.
 */

import { unstable_cache } from "next/cache";

const QUEUE_REVALIDATE_SECONDS = 300;
const FACTS_REVALIDATE_SECONDS = 1800;
const ENCODE_REPO = "TheAxiomFoundation/axiom-encode";
const DISPATCHER_DIR_URL = `https://api.github.com/repos/${ENCODE_REPO}/contents/queues?ref=encoding-queue-state`;
const DISPATCHER_RAW_BASE = `https://raw.githubusercontent.com/${ENCODE_REPO}/encoding-queue-state/queues/`;
const DISPATCHER_SCHEMA_PREFIX = "axiom-encode/snap-dispatch-queue/";
/** Fallback when the state branch listing is unavailable. */
const KNOWN_DISPATCHER_FILES = ["us-snap-or-ut-pilot.json"];
const QUEUE_DIR = "data/encoding-queues";
const QUEUE_DIR_URL = `https://api.github.com/repos/${ENCODE_REPO}/contents/${QUEUE_DIR}`;
const QUEUE_RAW_BASE = `https://raw.githubusercontent.com/${ENCODE_REPO}/main/${QUEUE_DIR}/`;
/** Fallback when the GitHub directory listing is unavailable (no token and
 *  the anonymous API rate limit is exhausted). Raw fetches are unmetered, so
 *  these queues always render; newly added queue files just need the listing
 *  (any configured GitHub token) to be discovered. */
const KNOWN_QUEUE_FILES = [
  "us-snap-all-states-2026-07.json",
  "us-snap-or-ut-2026-07.json",
];
/** The hourly workflow that dispatches the dispatcher queues' items. */
const DISPATCH_WORKFLOW = "snap-dispatch-queue.yml";
const DISPATCH_WORKFLOW_API = `https://api.github.com/repos/${ENCODE_REPO}/actions/workflows/${DISPATCH_WORKFLOW}`;
const DISPATCH_WORKFLOW_URL = `https://github.com/${ENCODE_REPO}/actions/workflows/${DISPATCH_WORKFLOW}`;

interface QueueFile {
  schema?: string;
  queue_id?: string;
  description?: string;
  /** Dispatcher queues: "active" or "paused". */
  state?: string;
  pause_reason?: string | null;
  /** Dispatcher queues: when the dispatcher last wrote the file. */
  updated_at?: string;
  /** Inventories: the ids of the queues this one replaces. */
  supersedes?: string[];
  items?: QueueFileItem[];
}

interface QueueFileItem {
  citation?: string;
  label?: string | null;
  status?: string;
  jurisdiction?: string;
  note?: string | null;
  /** Dispatcher queues: every dispatch of the item, oldest first. */
  attempts?: Array<{
    dispatched_at?: string;
    run_url?: string;
    result?: string;
    note?: string | null;
  }>;
  pr?: { url?: string } | null;
}

/** A dispatcher queue item a person may need to look at. */
export interface QueueItemView {
  queueId: string;
  citation: string;
  label: string | null;
  /**
   * blocked: needs a person; skipped: set aside before any run, never
   * dispatched; dispatched: a run is open; retrying: pending after a failed run.
   */
  state: "blocked" | "skipped" | "dispatched" | "retrying";
  /** Why it is blocked or skipped, or how its last run ended. */
  why: string | null;
  attempts: number;
  /** The last dispatch. */
  lastAt: string | null;
  runUrl: string | null;
  prUrl: string | null;
}

/** Items listed per queue and state; the rest are only counted. */
const ITEMS_PER_STATE = 100;

export interface EncodingQueueSummary {
  queueId: string;
  /** "dispatcher" for the hourly SNAP dispatch queues, "legacy" for the
   *  earlier signed inventories. */
  kind: "dispatcher" | "legacy";
  /** The file in axiom-encode; null when not read from there. */
  path: string | null;
  description: string | null;
  paused: boolean;
  /** The reason the queue states, when paused; null when it states none. */
  pauseReason: string | null;
  /** Dispatcher queues: when the paused queue was last written, so paused at least since. */
  pausedSince: string | null;
  /** Dispatcher queues: the dispatch workflow's state on GitHub ("active", "disabled_manually"). */
  dispatchWorkflow: { state: string; url: string } | null;
  total: number;
  /** Items still awaiting any encoder disposition. */
  pending: number;
  /** Non-pending item counts by status, e.g. { dispatched: 3, blocked: 1, skipped: 19 }. */
  dispositionCounts: Record<string, number>;
  jurisdictionCount: number;
  /** The most common note on blocked items, and how many carry it. */
  blockedNote: { note: string; count: number } | null;
  /** Dispatcher queues: blocked, skipped, dispatched, and retrying items. */
  attention: QueueItemView[];
  /** Dispatcher queues: pending items never dispatched, by jurisdiction. */
  notStarted: Record<string, number>;
  /** The ids of the queues this one replaces. */
  supersedes: string[];
  /** Inventories: when their file last changed (its last commit). */
  frozenSince: string | null;
  /** Inventories: how many of their items a dispatcher queue lists. */
  inDispatcher: number | null;
}

/**
 * The dispatcher records where a run failed as "<job>: <step>"; the step is
 * what tells items apart.
 */
function stepOnly(where: string): string {
  return where.replace(/^[^;:]*: /, "");
}

/** How a dispatch ended, in a few words: "Failed at Encode, review, ...". */
function lastRunText(result: string, note: string | null | undefined): string {
  const detail = note?.trim() || null;
  if (result === "failure" || result === "timed_out") {
    return detail ? `Failed at ${stepOnly(detail)}` : "Failed";
  }
  const what = result.replaceAll(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
  return detail ? `${what}: ${detail}` : what;
}

/** An item's label, unless it only repeats its citation's last segment ("Page 26" for ".../page-26"). */
function meaningfulLabel(item: QueueFileItem): string | null {
  const label = item.label?.trim();
  if (!label) return null;
  const segment = item.citation?.split("/").pop() ?? "";
  return label.toLowerCase().replaceAll(/\s+/g, "-") === segment.toLowerCase() ? null : label;
}

/**
 * A dispatcher item set aside before it was ever dispatched: the dispatcher
 * files these as blocked with a "skipped ..." note and no attempts, but no
 * run failed and no person is needed until someone requeues them.
 */
function isSkipped(item: QueueFileItem): boolean {
  if (item.status === "skipped") return true;
  return (
    item.status === "blocked" &&
    (item.attempts?.length ?? 0) === 0 &&
    /^skipped\b/i.test(item.note?.trim() ?? "")
  );
}

/** An item's note; "failed 2 times; last at <job>: <step>" names the step alone. */
function itemNote(item: QueueFileItem): string | null {
  return item.note?.trim().replace(/(last at )[^;:]*: /, "$1") || null;
}

function itemView(queueId: string, item: QueueFileItem, state: QueueItemView["state"]): QueueItemView {
  const attempts = item.attempts ?? [];
  const last = attempts.at(-1);
  const lastRun = last?.result ? lastRunText(last.result, last.note) : null;
  const note = itemNote(item);
  return {
    queueId,
    citation: item.citation ?? "",
    label: meaningfulLabel(item),
    state,
    why:
      state === "blocked" ? note || lastRun : state === "skipped" ? note : state === "retrying" ? lastRun : null,
    attempts: attempts.length,
    lastAt: last?.dispatched_at ?? null,
    runUrl: last?.run_url ?? null,
    prUrl: item.pr?.url ?? null,
  };
}

export function summarizeQueue(file: QueueFile): EncodingQueueSummary | null {
  const items = Array.isArray(file.items) ? file.items : [];
  if (!file.queue_id || items.length === 0) return null;
  const dispatcher = file.schema?.startsWith(DISPATCHER_SCHEMA_PREFIX) ?? false;
  const statusOf = (item: QueueFileItem) => (dispatcher && isSkipped(item) ? "skipped" : (item.status ?? "pending"));
  let pending = 0;
  const dispositionCounts: Record<string, number> = {};
  const jurisdictions = new Set<string>();
  const blockedNotes = new Map<string, number>();
  for (const item of items) {
    const status = statusOf(item);
    if (status === "pending") pending += 1;
    else dispositionCounts[status] = (dispositionCounts[status] ?? 0) + 1;
    if (item.jurisdiction) jurisdictions.add(item.jurisdiction);
    const note = itemNote(item);
    if (status === "blocked" && note) blockedNotes.set(note, (blockedNotes.get(note) ?? 0) + 1);
  }
  const [topNote] = [...blockedNotes.entries()].sort((a, b) => b[1] - a[1]);
  const attention: QueueItemView[] = [];
  const notStarted: Record<string, number> = {};
  if (dispatcher) {
    const listed = { blocked: 0, skipped: 0, dispatched: 0, retrying: 0 };
    for (const item of items) {
      if (!item.citation) continue;
      const status = statusOf(item);
      const tried = (item.attempts?.length ?? 0) > 0;
      const state =
        status === "blocked" || status === "skipped" || status === "dispatched"
          ? status
          : status === "pending" && tried
            ? "retrying"
            : null;
      if (state) {
        if (listed[state] < ITEMS_PER_STATE) attention.push(itemView(file.queue_id, item, state));
        listed[state] += 1;
      } else if (status === "pending") {
        const jurisdiction = item.jurisdiction ?? "other";
        notStarted[jurisdiction] = (notStarted[jurisdiction] ?? 0) + 1;
      }
    }
  }
  const reason = file.pause_reason?.trim() || null;
  const paused = reason !== null || (dispatcher && file.state === "paused");
  return {
    queueId: file.queue_id,
    kind: dispatcher ? "dispatcher" : "legacy",
    path: null,
    description: file.description?.trim() || null,
    paused,
    pauseReason: reason,
    pausedSince: dispatcher && paused ? (file.updated_at ?? null) : null,
    dispatchWorkflow: null,
    total: items.length,
    pending,
    dispositionCounts,
    jurisdictionCount: jurisdictions.size,
    blockedNote: topNote ? { note: topNote[0], count: topNote[1] } : null,
    attention,
    notStarted,
    supersedes: Array.isArray(file.supersedes)
      ? file.supersedes.filter((id): id is string => typeof id === "string")
      : [],
    frozenSince: null,
    inDispatcher: null,
  };
}

/** Uncached fetch: the all-state queue file is ~5 MB — over Next's 2 MB
 *  data-cache item cap — so the raw payloads are never cached. Only the
 *  small summaries are (see the unstable_cache wrappers below). */
async function fetchJson<T>(url: string): Promise<T> {
  const token = (
    process.env.AXIOM_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN
  )?.trim();
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token && url.startsWith("https://api.github.com/")
        ? { Authorization: `Bearer ${token}` }
        : {}),
    },
    cache: "no-store",
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

/** Each readable queue file, with its summary and the citations it lists. */
async function readQueueFiles(
  listingUrl: string,
  rawBase: string,
  dir: string,
  fallback: string[]
): Promise<Array<{ summary: EncodingQueueSummary; citations: Set<string> }>> {
  let names: string[];
  try {
    const listing = await fetchJson<Array<{ name?: string }>>(listingUrl);
    names = listing
      .map((entry) => entry.name ?? "")
      .filter((name) => name.endsWith(".json"));
  } catch {
    names = fallback;
  }

  const queues = await Promise.all(
    names.map(async (name) => {
      try {
        const file = await fetchJson<QueueFile>(`${rawBase}${name}`);
        const summary = summarizeQueue(file);
        if (!summary) return null;
        const citations = new Set(
          (file.items ?? []).map((item) => item.citation).filter((c): c is string => !!c)
        );
        return { summary: { ...summary, path: `${dir}/${name}` }, citations };
      } catch {
        return null;
      }
    })
  );
  return queues.filter((queue) => queue != null);
}

/**
 * Every queue's summary, without the slow-changing GitHub facts. A queue
 * another queue says it supersedes is left out: its items are in the newer
 * one, and listing both counts them twice.
 */
async function readQueueSummaries(): Promise<EncodingQueueSummary[]> {
  const [dispatcher, legacy] = await Promise.all([
    readQueueFiles(DISPATCHER_DIR_URL, DISPATCHER_RAW_BASE, "queues", KNOWN_DISPATCHER_FILES),
    readQueueFiles(QUEUE_DIR_URL, QUEUE_RAW_BASE, QUEUE_DIR, KNOWN_QUEUE_FILES),
  ]);
  const dispatched = new Set(dispatcher.flatMap(({ citations }) => [...citations]));
  const all = [
    ...dispatcher.map(({ summary }) => summary),
    ...legacy.map(({ summary, citations }) => ({
      ...summary,
      inDispatcher: [...citations].filter((citation) => dispatched.has(citation)).length,
    })),
  ];
  const superseded = new Set(all.flatMap((queue) => queue.supersedes.filter((id) => id !== queue.queueId)));
  // Live dispatcher queues first, then the inventories; largest first within each.
  const bySize = (a: EncodingQueueSummary, b: EncodingQueueSummary) => b.total - a.total;
  const kept = all.filter((queue) => !superseded.has(queue.queueId));
  return [
    ...kept.filter((queue) => queue.kind === "dispatcher").sort(bySize),
    ...kept.filter((queue) => queue.kind === "legacy").sort(bySize),
  ];
}

interface QueueFacts {
  /** Each inventory's last commit, by path. */
  committedAt: Record<string, string>;
  dispatchWorkflow: { state: string; url: string } | null;
}

/** The inventories' last commits and the dispatch workflow's state; best-effort. */
async function readQueueFacts(inventoryPaths: string[], hasDispatcher: boolean): Promise<QueueFacts> {
  const [commits, workflow] = await Promise.all([
    Promise.all(
      inventoryPaths.map(async (path) => {
        try {
          const list = await fetchJson<Array<{ commit?: { committer?: { date?: string } } }>>(
            `https://api.github.com/repos/${ENCODE_REPO}/commits?path=${encodeURIComponent(path)}&per_page=1`
          );
          const date = list[0]?.commit?.committer?.date;
          return date ? ([path, date] as const) : null;
        } catch {
          return null;
        }
      })
    ),
    hasDispatcher
      ? fetchJson<{ state?: string }>(DISPATCH_WORKFLOW_API)
          .then((result) => (result.state ? { state: result.state, url: DISPATCH_WORKFLOW_URL } : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    committedAt: Object.fromEntries(commits.filter((entry) => entry !== null)),
    dispatchWorkflow: workflow,
  };
}

function withFacts(queues: EncodingQueueSummary[], facts: QueueFacts): EncodingQueueSummary[] {
  return queues.map((queue) =>
    queue.kind === "legacy"
      ? { ...queue, frozenSince: (queue.path && facts.committedAt[queue.path]) || null }
      : { ...queue, dispatchWorkflow: facts.dispatchWorkflow }
  );
}

const inventoryPaths = (queues: EncodingQueueSummary[]) =>
  queues.filter((queue) => queue.kind === "legacy" && queue.path).map((queue) => queue.path!);
const hasDispatcher = (queues: EncodingQueueSummary[]) => queues.some((queue) => queue.kind === "dispatcher");

/** Exported for tests; production callers use the cached getEncodingQueues. */
export async function readEncodingQueues(): Promise<EncodingQueueSummary[]> {
  const queues = await readQueueSummaries();
  return withFacts(queues, await readQueueFacts(inventoryPaths(queues), hasDispatcher(queues)));
}

// Bump the keys when the summary's shape changes, so a deploy never reads
// summaries cached by the previous one.
const cachedSummaries = unstable_cache(readQueueSummaries, ["ops-encoding-queues-v4"], {
  revalidate: QUEUE_REVALIDATE_SECONDS,
});
const cachedFacts = unstable_cache(readQueueFacts, ["ops-encoding-queue-facts-v1"], {
  revalidate: FACTS_REVALIDATE_SECONDS,
});

/**
 * All queues, live dispatcher queues first, with the aggregated summaries
 * cached for QUEUE_REVALIDATE_SECONDS so the multi-megabyte queue files are
 * fetched at most once per window, never per request. Best-effort
 * throughout: if the directory listing is unavailable the known queue files
 * still load, and an unreadable individual queue is skipped — the ops page
 * renders a smaller section rather than failing.
 */
export async function getEncodingQueues(): Promise<EncodingQueueSummary[]> {
  const queues = await cachedSummaries();
  return withFacts(queues, await cachedFacts(inventoryPaths(queues), hasDispatcher(queues)));
}

/**
 * The pipeline view's "Queued" stage. Only the dispatcher's queues are live,
 * so once one exists only they count. The earlier inventories are no live
 * queue's backlog: most of their items are in no dispatcher queue at all
 * (the Queued work card says how many), so they are not counted here.
 */
export interface QueuedSummary {
  pending: number;
  queues: number;
  /** Dispatched runs not yet resolved (queued, awaiting approval, running). */
  inFlight: number;
  /** Items that need a person (failed twice, budget used up, PR closed, ...). */
  blocked: number;
  /** Items set aside before any run; not blocked, and never dispatched. */
  skipped: number;
  /** The most common stated reason among blocked items, when they carry one. */
  blockedNote: { note: string; count: number } | null;
  /** Every counted queue is paused. */
  paused: boolean;
  /** Set only when paused: the first stated reason, if any queue states one. */
  pausedReason: string | null;
  /** Set only when paused: the queues were paused at least since this time. */
  pausedSince: string | null;
  /** The workflow that dispatches the queues is disabled on GitHub. */
  dispatchDisabled: boolean;
  /** Blocked items first, then open runs, then retries, then skips; oldest dispatch first within each. */
  items: QueueItemView[];
  /** Pending items never dispatched, by jurisdiction, largest first. */
  notStarted: Array<{ jurisdiction: string; count: number }>;
}

const STATE_ORDER: Record<QueueItemView["state"], number> = { blocked: 0, dispatched: 1, retrying: 2, skipped: 3 };

export function queuedSummary(queues: EncodingQueueSummary[]): QueuedSummary | null {
  const live = queues.filter((queue) => queue.kind === "dispatcher");
  const counted = live.length > 0 ? live : queues;
  if (counted.length === 0) return null;
  const paused = counted.every((queue) => queue.paused);
  const sum = (status: string) =>
    counted.reduce((total, queue) => total + (queue.dispositionCounts[status] ?? 0), 0);
  return {
    pending: counted.reduce((sum, queue) => sum + queue.pending, 0),
    queues: counted.length,
    inFlight: sum("dispatched"),
    blocked: sum("blocked"),
    skipped: sum("skipped"),
    blockedNote:
      counted
        .map((queue) => queue.blockedNote)
        .filter((note): note is NonNullable<typeof note> => note !== null)
        .sort((a, b) => b.count - a.count)[0] ?? null,
    paused,
    pausedReason: paused ? (counted.find((queue) => queue.pauseReason)?.pauseReason ?? null) : null,
    pausedSince: paused
      ? (counted
          .map((queue) => queue.pausedSince)
          .filter((at): at is string => !!at)
          .sort()
          .at(-1) ?? null)
      : null,
    dispatchDisabled: counted.some((queue) => queue.dispatchWorkflow?.state.startsWith("disabled") ?? false),
    items: counted
      .flatMap((queue) => queue.attention)
      .sort(
        (a, b) =>
          STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
          (a.lastAt ?? "").localeCompare(b.lastAt ?? "")
      ),
    notStarted: Object.entries(
      counted.reduce<Record<string, number>>((all, queue) => {
        for (const [jurisdiction, count] of Object.entries(queue.notStarted)) {
          all[jurisdiction] = (all[jurisdiction] ?? 0) + count;
        }
        return all;
      }, {})
    )
      .map(([jurisdiction, count]) => ({ jurisdiction, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * The queue summary for the items one jurisdiction filter keeps. Counts come
 * from the listed items, so a state with more than ITEMS_PER_STATE items in
 * one queue counts only those listed.
 */
export function scopeQueued(
  queued: QueuedSummary | null,
  keep: (jurisdiction: string) => boolean
): QueuedSummary | null {
  if (!queued) return null;
  const items = queued.items.filter((item) => keep(item.citation.split("/")[0]));
  const notStarted = queued.notStarted.filter((entry) => keep(entry.jurisdiction));
  const blocked = items.filter((item) => item.state === "blocked");
  const notes = new Map<string, number>();
  for (const item of blocked) if (item.why) notes.set(item.why, (notes.get(item.why) ?? 0) + 1);
  const [top] = [...notes].sort((a, b) => b[1] - a[1]);
  return {
    ...queued,
    pending:
      notStarted.reduce((total, entry) => total + entry.count, 0) +
      items.filter((item) => item.state === "retrying").length,
    inFlight: items.filter((item) => item.state === "dispatched").length,
    blocked: blocked.length,
    skipped: items.filter((item) => item.state === "skipped").length,
    blockedNote: top ? { note: top[0], count: top[1] } : null,
    items,
    notStarted,
  };
}
