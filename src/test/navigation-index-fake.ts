import type { NavigationNodeRow } from "@/lib/axiom/navigation-index/types";

/** What one PostgREST read resolves to, as postgrest-js hands it back. */
export interface FakeAnswer {
  data: unknown;
  count: number | null;
  error: unknown;
  status: number;
}

export interface FakeNavigationIndex {
  /** How many children a level has (a missing level has none). */
  total: number;
  /** When set, the answer to every child-page read (the one query with a
   *  range). Without it a page read answers with the children in range,
   *  and with PAST_THE_END when the range starts past the last child. */
  childPage?: FakeAnswer | null;
  /** Answers for the next child-page reads, one each, in order; once
   *  they run out, page reads answer as above. */
  childPages?: FakeAnswer[];
  /** Paths with no node of their own; every other path has a node with
   *  children. */
  missing?: string[];
  /** Children, numbered from 1, whose provision is gone, so the loader
   *  drops them as stale. */
  stale?: number[];
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

/** What postgrest-js hands back for an HTTP 404 with an empty body: a
 *  success-shaped 204 with no data, no count and no error. */
export const EMPTY_404: FakeAnswer = {
  data: null,
  count: null,
  status: 204,
  error: null,
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

function navigationNode(
  path: string,
  overrides: Partial<NavigationNodeRow> = {}
): NavigationNodeRow {
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
    ...overrides,
  };
}

type Call = [method: string, args: unknown[]];

const ok = (data: unknown, count: number | null = null): FakeAnswer => ({
  data,
  count,
  error: null,
  status: 200,
});

/** A query builder that takes any chain of methods and answers, when
 *  awaited, with `answer(table, calls)`. */
function fakeClient(answer: (table: string, calls: Call[]) => FakeAnswer) {
  return {
    from(table: string) {
      const calls: Call[] = [];
      const query: object = new Proxy(
        {},
        {
          get(_, method) {
            if (method === "then") {
              return (
                resolve: (value: FakeAnswer) => unknown,
                reject?: (reason: unknown) => unknown
              ) =>
                Promise.resolve()
                  .then(() => answer(table, calls))
                  .then(resolve, reject);
            }
            return (...args: unknown[]) => {
              calls.push([String(method), args]);
              return query;
            };
          },
        }
      );
      return query;
    },
  };
}

const argsOf = (calls: Call[], method: string) =>
  calls.find(([name]) => name === method)?.[1];

const eqValue = (calls: Call[], column: string) =>
  calls.find(([name, args]) => name === "eq" && args[0] === column)?.[1][1];

/**
 * A stand-in for supabaseCorpus covering the reads a browse level makes.
 * A node looked up by path exists, with children, unless `missing` names
 * it. A level has `total` children, numbered from 1, each a leaf whose
 * provision resolves unless `stale` names it. A count-only (HEAD) read
 * finds the total, a page read answers as PostgREST does, a provision read
 * finds no provision, and everything else finds nothing.
 */
export function fakeNavigationCorpus(index: FakeNavigationIndex) {
  const isMissing = (path: unknown) =>
    typeof path === "string" && (index.missing ?? []).includes(path);
  return fakeClient((table, calls) => {
    if (table === "current_provisions") {
      if (calls.some(([method]) => method === "maybeSingle")) return ok(null);
      // The loader's resolvability check: one citation_path.eq.<path> per
      // child it asks about.
      const filters = String(argsOf(calls, "or")?.[0] ?? "");
      const paths = Array.from(
        filters.matchAll(/citation_path\.eq\.([^,()]+)/g),
        (match) => match[1]
      ).filter((path) => {
        const child = Number(path.split("/").pop());
        return !isMissing(path) && !(index.stale ?? []).includes(child);
      });
      return ok(paths.map((path) => ({ citation_path: path })));
    }
    if (table !== "current_navigation_nodes") return ok([]);

    const path = eqValue(calls, "path");
    if (typeof path === "string") {
      return ok(isMissing(path) ? [] : [navigationNode(path)]);
    }
    // A children read names its parent, or asks for the roots.
    const parent = calls.some(
      ([name, args]) => name === "eq" && args[0] === "parent_path"
    )
      ? eqValue(calls, "parent_path")
      : calls.some(([name, args]) => name === "is" && args[0] === "parent_path")
        ? null
        : undefined;
    if (parent === undefined) return ok([]);
    const total = isMissing(parent) ? 0 : index.total;

    const head = (argsOf(calls, "select")?.[1] as { head?: boolean } | undefined)
      ?.head;
    if (head) return { data: null, count: total, error: null, status: 200 };

    const range = argsOf(calls, "range") as [number, number] | undefined;
    if (!range) return ok([]);
    const queued = index.childPages?.shift();
    if (queued) return queued;
    if (index.childPage) return index.childPage;
    const [from, to] = range;
    if (from > 0 && from >= total) return PAST_THE_END;
    const base =
      typeof parent === "string"
        ? parent
        : `${eqValue(calls, "jurisdiction")}/${eqValue(calls, "doc_type")}`;
    const rows: NavigationNodeRow[] = [];
    for (let child = from + 1; child <= Math.min(to + 1, total); child++) {
      rows.push(
        navigationNode(`${base}/${child}`, {
          has_children: false,
          sort_key: String(child).padStart(6, "0"),
        })
      );
    }
    return { data: rows, count: total, error: null, status: 206 };
  });
}

/** A stand-in for a client that finds nothing anywhere (the encodings
 *  mirror, for a browse page's coverage marks). */
export function fakeEmptyClient() {
  return fakeClient(() => ok([]));
}
