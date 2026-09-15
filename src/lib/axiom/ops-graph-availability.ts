import { corpusPathsForCitation } from "./ops-citations";
import { graphFocusForCitationPath } from "./runtime/graph-links";
import { runtimeProxyGet } from "./runtime/api";

const CACHE_MS = 30_000;
const checks = new Map<string, { expires: number; result: Promise<boolean> }>();

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
      let check = checks.get(focus);
      if (!check || check.expires <= Date.now()) {
        const result = runtimeProxyGet(
          `/graph/compose?focus=${encodeURIComponent(focus)}`,
          { fresh: true },
        )
          .then(({ status, body }) => {
            const envelope = body as {
              status?: string;
              data?: { graph?: { rules?: unknown[] } };
            } | null;
            return (
              status === 200 &&
              envelope?.status === "ok" &&
              Array.isArray(envelope.data?.graph?.rules) &&
              envelope.data.graph.rules.length > 0
            );
          })
          .catch(() => false);
        check = { expires: Date.now() + CACHE_MS, result };
        if (checks.size >= 200) checks.delete(checks.keys().next().value!);
        checks.set(focus, check);
      }
      if (await check.result) available.add(citation);
    }),
  );
  return available;
}
