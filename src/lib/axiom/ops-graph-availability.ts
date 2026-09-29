import { corpusPathsForCitation } from "./ops-citations";
import { graphFocusForCitationPath } from "./runtime/graph-links";
import { runtimeProxyGet } from "./runtime/api";

// Whether a section composes into a graph changes when its module reaches
// the live rulespec_files mirror the API composes from — minutes after an
// encoding lands, not on every dashboard poll. A 30-second memo against a
// 30-second poll re-asked the API for every citation on almost every poll,
// one authenticated request per citation, from every open /ops tab.
// A graph that composes stays composable, so that answer is kept for ten
// minutes. "Not yet" is the answer /ops exists to see change, so it is kept
// for three. A failed check (5xx, 429, timeout) is retried after a minute.
// Each counts from when the answer arrives.
const AVAILABLE_MS = 10 * 60_000;
const UNAVAILABLE_MS = 3 * 60_000;
const FAILURE_MS = 60_000;
const MAX_CHECKS = 200;
const checks = new Map<string, { expires: number; result: Promise<boolean> }>();

type Check = { available: boolean; keepMs: number };

function classify(status: number, body: unknown): Check {
  const envelope = body as {
    status?: string;
    data?: { graph?: { rules?: unknown[] } };
  } | null;
  if (status === 200) {
    const available =
      envelope?.status === "ok" &&
      Array.isArray(envelope.data?.graph?.rules) &&
      envelope.data.graph.rules.length > 0;
    return { available, keepMs: available ? AVAILABLE_MS : UNAVAILABLE_MS };
  }
  // 404 (not composable yet) and other client errors are answers about this
  // focus; 429 and server errors say nothing about it.
  if (status >= 400 && status < 500 && status !== 429) {
    return { available: false, keepMs: UNAVAILABLE_MS };
  }
  return { available: false, keepMs: FAILURE_MS };
}

function checkFocus(focus: string): Promise<boolean> {
  const entry = { expires: Number.POSITIVE_INFINITY, result: Promise.resolve(false) };
  entry.result = runtimeProxyGet(
    `/graph/compose?focus=${encodeURIComponent(focus)}`,
    { fresh: true },
  )
    .then(({ status, body }) => classify(status, body))
    .catch((): Check => ({ available: false, keepMs: FAILURE_MS }))
    .then(({ available, keepMs }) => {
      entry.expires = Date.now() + keepMs;
      return available;
    });
  // Re-inserting moves a refreshed focus to the back of the eviction order,
  // and only a focus not already held can push another one out.
  checks.delete(focus);
  if (checks.size >= MAX_CHECKS) checks.delete(checks.keys().next().value!);
  checks.set(focus, entry);
  return entry.result;
}

/** Ask the serving API, rather than treating run completion as publication. */
export async function availableGraphCitations(
  runs: Array<{ citation: string | null; has_issues: boolean | null }>,
): Promise<Set<string>> {
  const citations = [
    ...new Set(
      runs
        .filter((run) => !run.has_issues && run.citation)
        .map((run) => run.citation!),
    ),
  ];
  const available = new Set<string>();
  await Promise.all(
    citations.map(async (citation) => {
      const { section, document } = corpusPathsForCitation(citation);
      const path = section ?? document;
      const focus = path ? graphFocusForCitationPath(path) : null;
      if (!focus) return;
      const check = checks.get(focus);
      const result =
        check && check.expires > Date.now() ? check.result : checkFocus(focus);
      if (await result) available.add(citation);
    }),
  );
  return available;
}
