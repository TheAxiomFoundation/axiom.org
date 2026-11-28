import type { NavigationNodeRow } from "@/lib/axiom/navigation-index/types";

/** What one PostgREST read resolves to, as postgrest-js hands it back. */
export interface FakeAnswer {
  data: unknown;
  count: number | null;
  error: unknown;
  status: number;
}

export interface FakeNavigationIndex {
  /** The answer to the child-page read (the one query with a range). */
  childPage: FakeAnswer;
  /** What a count-only (HEAD) read of the children finds. */
  total: number;
}

/** PostgREST's answer, under an exact count, to a range that starts past
 *  the last row (page 1 of a level with 15 children): 416, whose
 *  Content-Range carries only the total. postgrest-js reads the count only
 *  from a successful answer, so it returns this as an error with the
 *  status and no count. */
export const PAST_THE_END: FakeAnswer = {
  data: null,
  count: null,
  status: 416,
  error: {
    code: "PGRST103",
    details: "An offset of 100 was requested, but there are only 15 rows.",
    hint: null,
    message: "Requested range not satisfiable",
  },
};

/** A statement timeout, which PostgREST answers with a 500. */
export const STATEMENT_TIMEOUT: FakeAnswer = {
  data: null,
  count: null,
  status: 500,
  error: {
    code: "57014",
    details: null,
    hint: null,
    message: "canceling statement due to statement timeout",
  },
};

function navigationNode(path: string): NavigationNodeRow {
  const parts = path.split("/");
  return {
    id: `nav:${path}`,
    jurisdiction: parts[0],
    doc_type: parts[1],
    path,
    parent_path: parts.length > 2 ? parts.slice(0, -1).join("/") : null,
    segment: parts[parts.length - 1],
    label: parts[parts.length - 1],
    sort_key: parts[parts.length - 1],
    depth: parts.length - 1,
    provision_id: null,
    citation_path: path,
    has_children: true,
    child_count: 0,
    has_rulespec: false,
    encoded_descendant_count: 0,
    status: null,
  };
}

/**
 * A stand-in for supabaseCorpus covering the navigation reads a browse
 * level makes: any node looked up by path exists and has children, the
 * child page answers `childPage`, a count-only read finds `total`, and
 * everything else finds nothing.
 */
export function fakeNavigationCorpus(index: FakeNavigationIndex) {
  return {
    from(table: string) {
      const calls: Array<[string, unknown[]]> = [];
      const answer = (): FakeAnswer => {
        const select = calls.find(([method]) => method === "select")?.[1];
        if ((select?.[1] as { head?: boolean } | undefined)?.head) {
          return { data: null, count: index.total, error: null, status: 200 };
        }
        if (calls.some(([method]) => method === "range")) return index.childPage;
        const path = calls.find(
          ([method, args]) => method === "eq" && args[0] === "path"
        )?.[1][1];
        if (table === "current_navigation_nodes" && typeof path === "string") {
          return { data: [navigationNode(path)], count: null, error: null, status: 200 };
        }
        return { data: [], count: null, error: null, status: 200 };
      };
      const query: Record<string, unknown> = {
        then: (
          resolve: (value: FakeAnswer) => unknown,
          reject?: (reason: unknown) => unknown
        ) => Promise.resolve().then(answer).then(resolve, reject),
      };
      for (const method of [
        "select",
        "eq",
        "is",
        "or",
        "in",
        "gte",
        "lt",
        "order",
        "range",
        "limit",
        "maybeSingle",
      ]) {
        query[method] = (...args: unknown[]) => {
          calls.push([method, args]);
          return query;
        };
      }
      return query;
    },
  };
}
