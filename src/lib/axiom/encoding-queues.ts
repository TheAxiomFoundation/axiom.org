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
  items?: Array<{ status?: string; jurisdiction?: string }>;
}

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
}

export function summarizeQueue(file: QueueFile): EncodingQueueSummary | null {
  const items = Array.isArray(file.items) ? file.items : [];
  if (!file.queue_id || items.length === 0) return null;
  let pending = 0;
  const dispositionCounts: Record<string, number> = {};
  const jurisdictions = new Set<string>();
  for (const item of items) {
    const status = item.status ?? "pending";
    if (status === "pending") pending += 1;
    else dispositionCounts[status] = (dispositionCounts[status] ?? 0) + 1;
    if (item.jurisdiction) jurisdictions.add(item.jurisdiction);
  }
  const dispatcher = file.schema?.startsWith(DISPATCHER_SCHEMA_PREFIX) ?? false;
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
  ["ops-encoding-queues"],
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
  /** Set only when every counted queue is paused: the first stated reason. */
  pausedReason: string | null;
}

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
    pausedReason: allPaused ? counted[0].pauseReason : null,
  };
}
