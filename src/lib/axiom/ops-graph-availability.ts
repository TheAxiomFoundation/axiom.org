import { corpusPathsForCitation } from "./ops-citations";
import { graphFocusForCitationPath } from "./runtime/graph-links";
import { runtimeProxyGet } from "./runtime/api";

// Whether a section composes into a graph changes when the serving API's
// rule index changes — a deploy or its six-hourly refresh — not between
// dashboard polls. A 30-second memo against a 30-second poll re-asked the
// API for every citation on almost every poll, one authenticated request
// per citation, from every open /ops tab. Definitive answers (a graph, or
// a 404) are kept for ten minutes, counted from when they arrive; failures
// are retried after a minute.
const DEFINITIVE_MS = 10 * 60_000;
const FAILURE_MS = 60_000;
const checks = new Map<string, { expires: number; result: Promise<boolean> }>();

type Check = { available: boolean; definitive: boolean };

function checkFocus(focus: string): Promise<boolean> {
  const entry = { expires: Number.POSITIVE_INFINITY, result: Promise.resolve(false) };
  entry.result = runtimeProxyGet(
    `/graph/compose?focus=${encodeURIComponent(focus)}`,
    { fresh: true },
  )
    .then(({ status, body }): Check => {
      const envelope = body as {
        status?: string;
        data?: { graph?: { rules?: unknown[] } };
      } | null;
      const available =
        status === 200 &&
        envelope?.status === "ok" &&
        Array.isArray(envelope.data?.graph?.rules) &&
        envelope.data.graph.rules.length > 0;
      return { available, definitive: status === 200 || status === 404 };
    })
    .catch((): Check => ({ available: false, definitive: false }))
    .then(({ available, definitive }) => {
      entry.expires = Date.now() + (definitive ? DEFINITIVE_MS : FAILURE_MS);
      return available;
    });
  if (checks.size >= 200) checks.delete(checks.keys().next().value!);
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
