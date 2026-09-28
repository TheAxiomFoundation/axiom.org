/**
 * Durable encoding queues, read from the public axiom-encode repo
 * (`data/encoding-queues/*.json`). Each queue is a signed inventory of
 * citations awaiting encoder dispositions; work is pulled from it in small
 * tranches by the trusted dispatch workflow.
 *
 * The queue files are large (the all-state SNAP inventory is ~5 MB), so
 * reads are cached for QUEUE_REVALIDATE_SECONDS and only a small aggregate
 * ever leaves the server.
 */

import { unstable_cache } from "next/cache";

const QUEUE_REVALIDATE_SECONDS = 300;
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
  queue_id?: string;
  description?: string;
  pause_reason?: string | null;
  items?: Array<{ status?: string; jurisdiction?: string }>;
}

export interface EncodingQueueSummary {
  queueId: string;
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
  return {
    queueId: file.queue_id,
    description: file.description?.trim() || null,
    pauseReason: file.pause_reason?.trim() || null,
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

/** Exported for tests; production callers use the cached getEncodingQueues. */
export async function readEncodingQueues(): Promise<EncodingQueueSummary[]> {
  let names: string[];
  try {
    const listing = await fetchJson<Array<{ name?: string }>>(QUEUE_DIR_URL);
    names = listing
      .map((entry) => entry.name ?? "")
      .filter((name) => name.endsWith(".json"));
  } catch {
    names = KNOWN_QUEUE_FILES;
  }

  const queues = await Promise.all(
    names.map(async (name) => {
      try {
        return summarizeQueue(
          await fetchJson<QueueFile>(`${QUEUE_RAW_BASE}${name}`)
        );
      } catch {
        return null;
      }
    })
  );
  return queues
    .filter((queue): queue is EncodingQueueSummary => queue != null)
    .sort((a, b) => b.total - a.total);
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
