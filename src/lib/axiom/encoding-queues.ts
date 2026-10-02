/**
 * Durable encoding queues, read from the public axiom-encode repo. Two kinds:
 *
 * - dispatcher queues (`queues/*.json` on the `encoding-queue-state` branch),
 *   which the hourly SNAP dispatch workflow sends to the targeted encode
 *   workflow and updates with each item's outcome;
 * - the earlier signed inventories (`data/encoding-queues/*.json` on main),
 *   which the dispatcher replaces.
 *
 * The queue files are large (the all-state SNAP inventory is ~5 MB), so
 * reads are cached for QUEUE_REVALIDATE_SECONDS and only a small aggregate
 * ever leaves the server.
 */

import { unstable_cache } from "next/cache";

const QUEUE_REVALIDATE_SECONDS = 300;
const DISPATCHER_DIR_URL =
  "https://api.github.com/repos/TheAxiomFoundation/axiom-encode/contents/queues?ref=encoding-queue-state";
const DISPATCHER_RAW_BASE =
  "https://raw.githubusercontent.com/TheAxiomFoundation/axiom-encode/encoding-queue-state/queues/";
const DISPATCHER_SCHEMA_PREFIX = "axiom-encode/snap-dispatch-queue/";
/** Fallback when the state branch listing is unavailable. */
const KNOWN_DISPATCHER_FILES = ["us-snap-or-ut-pilot.json"];
const QUEUE_DIR_URL =
  "https://api.github.com/repos/TheAxiomFoundation/axiom-encode/contents/data/encoding-queues";
const QUEUE_RAW_BASE =
  "https://raw.githubusercontent.com/TheAxiomFoundation/axiom-encode/main/data/encoding-queues/";
/** Fallback when the GitHub directory listing is unavailable (no token and
 *  the anonymous API rate limit is exhausted). Raw fetches are unmetered, so
 *  these queues always render; newly added queue files just need the listing
 *  (any configured GitHub token) to be discovered. */
const KNOWN_QUEUE_FILES = [
  "us-snap-all-states-2026-07.json",
  "us-snap-or-ut-2026-07.json",
];

interface QueueFile {
  schema?: string;
  queue_id?: string;
  description?: string;
  /** Dispatcher queues: "active" or "paused". */
  state?: string;
  pause_reason?: string | null;
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
  /** blocked: needs a person; dispatched: a run is open; retrying: pending after a failed run. */
  state: "blocked" | "dispatched" | "retrying";
  /** Why it is blocked, or how its last run ended. */
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
   *  earlier signed inventories they replace. */
  kind: "dispatcher" | "legacy";
  description: string | null;
  /** Null when the queue is active; the stated reason when paused. */
  pauseReason: string | null;
  total: number;
  /** Items still awaiting any encoder disposition. */
  pending: number;
  /** Non-pending item counts by status, e.g. { dispatched: 3, completed: 1 }. */
  dispositionCounts: Record<string, number>;
  jurisdictionCount: number;
  /** The most common note on blocked items, and how many carry it. */
  blockedNote: { note: string; count: number } | null;
  /** Dispatcher queues: blocked, dispatched, and retrying items. */
  attention: QueueItemView[];
  /** Dispatcher queues: pending items never dispatched, by jurisdiction. */
  notStarted: Record<string, number>;
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

function itemView(queueId: string, item: QueueFileItem, state: QueueItemView["state"]): QueueItemView {
  const attempts = item.attempts ?? [];
  const last = attempts.at(-1);
  const lastRun = last?.result ? lastRunText(last.result, last.note) : null;
  // "failed 2 times; last at <job>: <step>" names the step alone.
  const note = item.note?.trim().replace(/(last at )[^;:]*: /, "$1") || null;
  return {
    queueId,
    citation: item.citation ?? "",
    label: meaningfulLabel(item),
    state,
    why: state === "blocked" ? note || lastRun : state === "retrying" ? lastRun : null,
    attempts: attempts.length,
    lastAt: last?.dispatched_at ?? null,
    runUrl: last?.run_url ?? null,
    prUrl: item.pr?.url ?? null,
  };
}

export function summarizeQueue(file: QueueFile): EncodingQueueSummary | null {
  const items = Array.isArray(file.items) ? file.items : [];
  if (!file.queue_id || items.length === 0) return null;
  let pending = 0;
  const dispositionCounts: Record<string, number> = {};
  const jurisdictions = new Set<string>();
  const blockedNotes = new Map<string, number>();
  for (const item of items) {
    const status = item.status ?? "pending";
    if (status === "pending") pending += 1;
    else dispositionCounts[status] = (dispositionCounts[status] ?? 0) + 1;
    if (item.jurisdiction) jurisdictions.add(item.jurisdiction);
    const note = item.note?.trim();
    if (status === "blocked" && note) blockedNotes.set(note, (blockedNotes.get(note) ?? 0) + 1);
  }
  const [topNote] = [...blockedNotes.entries()].sort((a, b) => b[1] - a[1]);
  const dispatcher = file.schema?.startsWith(DISPATCHER_SCHEMA_PREFIX) ?? false;
  const attention: QueueItemView[] = [];
  const notStarted: Record<string, number> = {};
  if (dispatcher) {
    const listed = { blocked: 0, dispatched: 0, retrying: 0 };
    for (const item of items) {
      if (!item.citation) continue;
      const tried = (item.attempts?.length ?? 0) > 0;
      const state =
        item.status === "blocked" || item.status === "dispatched"
          ? item.status
          : (item.status ?? "pending") === "pending" && tried
            ? "retrying"
            : null;
      if (state) {
        if (listed[state] < ITEMS_PER_STATE) attention.push(itemView(file.queue_id, item, state));
        listed[state] += 1;
      } else if ((item.status ?? "pending") === "pending") {
        const jurisdiction = item.jurisdiction ?? "other";
        notStarted[jurisdiction] = (notStarted[jurisdiction] ?? 0) + 1;
      }
    }
  }
  return {
    queueId: file.queue_id,
    kind: dispatcher ? "dispatcher" : "legacy",
    description: file.description?.trim() || null,
    pauseReason:
      file.pause_reason?.trim() || (dispatcher && file.state === "paused" ? "Paused" : null),
    total: items.length,
    pending,
    dispositionCounts,
    jurisdictionCount: jurisdictions.size,
    blockedNote: topNote ? { note: topNote[0], count: topNote[1] } : null,
    attention,
    notStarted,
  };
}

/** Uncached fetch: the all-state queue file is ~5 MB — over Next's 2 MB
 *  data-cache item cap — so the raw payloads are never cached. Only the
 *  small summaries are (see the unstable_cache wrapper below). */
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

async function readQueueFiles(
  listingUrl: string,
  rawBase: string,
  fallback: string[]
): Promise<EncodingQueueSummary[]> {
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
        return summarizeQueue(await fetchJson<QueueFile>(`${rawBase}${name}`));
      } catch {
        return null;
      }
    })
  );
  return queues.filter((queue): queue is EncodingQueueSummary => queue != null);
}

/** Exported for tests; production callers use the cached getEncodingQueues. */
export async function readEncodingQueues(): Promise<EncodingQueueSummary[]> {
  const [dispatcher, legacy] = await Promise.all([
    readQueueFiles(DISPATCHER_DIR_URL, DISPATCHER_RAW_BASE, KNOWN_DISPATCHER_FILES),
    readQueueFiles(QUEUE_DIR_URL, QUEUE_RAW_BASE, KNOWN_QUEUE_FILES),
  ]);
  // Live dispatcher queues first, then the inventories they replace.
  const bySize = (a: EncodingQueueSummary, b: EncodingQueueSummary) => b.total - a.total;
  return [...dispatcher.sort(bySize), ...legacy.sort(bySize)];
}

/**
 * All queues, largest first, with the aggregated summaries cached for
 * QUEUE_REVALIDATE_SECONDS so the multi-megabyte queue files are fetched at
 * most once per window, never per request. Best-effort throughout: if the
 * directory listing is unavailable the known queue files still load, and an
 * unreadable individual queue is skipped — the ops page renders a smaller
 * section rather than failing.
 */
export const getEncodingQueues = unstable_cache(
  readEncodingQueues,
  // Bump the key when the summary's shape changes, so a deploy never reads
  // summaries cached by the previous one.
  ["ops-encoding-queues-v3"],
  { revalidate: QUEUE_REVALIDATE_SECONDS }
);

/** The pipeline view's "Queued" stage. Once a dispatcher queue exists, only
 *  dispatcher queues count: the earlier inventories list the same citations. */
export interface QueuedSummary {
  pending: number;
  queues: number;
  /** Dispatched runs not yet resolved (queued, awaiting approval, running). */
  inFlight: number;
  /** Items that need a person (failed twice, budget used up, PR closed, ...). */
  blocked: number;
  /** The most common stated reason among blocked items, when they carry one. */
  blockedNote: { note: string; count: number } | null;
  /** Set only when every counted queue is paused: the first stated reason. */
  pausedReason: string | null;
  /** Blocked items first, then open runs, then retries; oldest dispatch first within each. */
  items: QueueItemView[];
  /** Pending items never dispatched, by jurisdiction, largest first. */
  notStarted: Array<{ jurisdiction: string; count: number }>;
}

const STATE_ORDER: Record<QueueItemView["state"], number> = { blocked: 0, dispatched: 1, retrying: 2 };

export function queuedSummary(queues: EncodingQueueSummary[]): QueuedSummary | null {
  const live = queues.filter((queue) => queue.kind === "dispatcher");
  const counted = live.length > 0 ? live : queues;
  if (counted.length === 0) return null;
  const allPaused = counted.every((queue) => queue.pauseReason !== null);
  const sum = (status: string) =>
    counted.reduce((total, queue) => total + (queue.dispositionCounts[status] ?? 0), 0);
  return {
    pending: counted.reduce((sum, queue) => sum + queue.pending, 0),
    queues: counted.length,
    inFlight: sum("dispatched"),
    blocked: sum("blocked"),
    blockedNote:
      counted
        .map((queue) => queue.blockedNote)
        .filter((note): note is NonNullable<typeof note> => note !== null)
        .sort((a, b) => b.count - a.count)[0] ?? null,
    pausedReason: allPaused ? counted[0].pauseReason : null,
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
