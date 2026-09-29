import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { corpusLookupPathsForCitation } from "@/lib/axiom/ops-citations";

// Graph availability asks the serving API; here it is an input the test sets.
const graph = vi.hoisted(() => ({ citations: new Set<string>() }));
vi.mock("@/lib/axiom/ops-graph-availability", () => ({
  availableGraphCitations: vi.fn(async () => new Set(graph.citations)),
}));

import {
  getEncodingStatus,
  type EncodingStatusRun,
  type LiveEncodingRun,
} from "./corpus-status";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  graph.citations = new Set();
});

// Small alphabets so generated citations share prefixes and near-miss
// siblings ("a" vs "ab"), which is where document-root matching can go wrong.
const segment = fc.constantFrom("a", "b", "ab");
const parsedCitation = fc
  .tuple(fc.constantFrom("us", "uk"), fc.array(segment, { minLength: 2, maxLength: 5 }))
  .map(([scope, segments]) => `${scope}:${segments.join("/")}`);
const citation = fc.oneof(
  { weight: 6, arbitrary: parsedCitation },
  { weight: 1, arbitrary: fc.constant("not a citation") }
);
const text = fc.constantFrom(null, "", "   ", "Label A", " Label B ", "Heading C");

const runRow = fc.record({
  citation: fc.option(citation, { nil: null }),
  has_issues: fc.option(fc.boolean(), { nil: null }),
  data_source: fc.option(fc.constantFrom("reviewer_agent", "ci"), { nil: null }),
});
const liveRow = fc.record({
  citation,
  status: fc.constantFrom("running", "completed", "failed"),
});

/** Supabase rows as they would come back for any path; the mock applies the
 *  request's `in.(...)` filter, as PostgREST does. */
const scenario = fc
  .record({
    runs: fc.array(runRow, { maxLength: 10 }),
    live: fc.array(liveRow, { maxLength: 5 }),
    liveFails: fc.boolean(),
    navFails: fc.boolean(),
    provisionsFails: fc.boolean(),
  })
  .chain((base) => {
    const citations = [
      ...base.runs.map((run) => run.citation),
      ...base.live.map((run) => run.citation),
    ].filter((value): value is string => value != null);
    // Every path a lookup could ask for, plus near-miss siblings.
    const pool = [
      ...new Set(
        citations.flatMap((value) =>
          prefixes(corpusLookupPathsForCitation(value).at(-1)).flatMap((path) => [
            path,
            `${path}b`,
          ])
        )
      ),
    ];
    const poolPath = pool.length > 0 ? fc.constantFrom(...pool) : fc.constant("us/a/a");
    return fc.record({
      base: fc.constant(base),
      nav: fc.array(fc.record({ path: poolPath, label: text }), { maxLength: 12 }),
      provisions: fc.array(
        fc.record({
          citation_path: fc.option(poolPath, { nil: null }),
          heading: text,
          parent_id: fc.constantFrom(null, "parent"),
        }),
        { maxLength: 12 }
      ),
      graph: fc.subarray([...new Set(citations)]),
    });
  });

type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

describe("getEncodingStatus properties", () => {
  it("returns what /ops reads, resolved from only the rows it asked for", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { fetchMock, requested } = stubSupabase(s);
        graph.citations = new Set(s.graph);

        const status = await getEncodingStatus();

        const runs = runRows(s);
        // A failed live read contributes no rows, so no citations either.
        const live = s.base.liveFails ? [] : liveRows(s);
        const citations = [...runs.map((r) => r.citation), ...live.map((r) => r.citation)];
        const expectedLookups = new Set(
          citations.flatMap((value) =>
            value ? prefixes(corpusLookupPathsForCitation(value).at(-1)) : []
          )
        );
        // The generator stays under the 200-path lookup cap, so no path is dropped.
        expect(expectedLookups.size).toBeLessThanOrEqual(200);

        expect(status.error).toBeNull();
        expect(status.source).toBe("supabase");
        const value = status.value!;
        expect(Object.keys(value).sort()).toEqual([
          "citation_document_paths",
          "citation_labels",
          "latest_runs",
          "live_runs",
          "refreshed_at",
        ]);

        // Runs pass through in order; graph_available is exactly membership.
        expect(value.latest_runs).toEqual(
          runs.map((run) => ({
            ...run,
            graph_available: run.citation != null && graph.citations.has(run.citation),
          }))
        );
        // Live rows pass through, and a failed live read is an empty list.
        expect(value.live_runs).toEqual(live);

        // One read per table; label reads only when a citation parses.
        const tables = fetchMock.mock.calls.map(([input]) =>
          new URL(String(input)).pathname.replace("/rest/v1/", "")
        );
        const lookups = expectedLookups.size > 0 ? ["current_provisions", "navigation_nodes"] : [];
        expect(tables.sort()).toEqual(
          ["encoding_runs", "live_encoding_runs", ...lookups].sort()
        );
        if (expectedLookups.size > 0) {
          expect(requested.navigation_nodes).toEqual(expectedLookups);
          expect(requested.current_provisions).toEqual(expectedLookups);
        }

        // Labels: a provision's first non-blank heading, else the last
        // non-blank navigation label, trimmed; nothing for other paths.
        const nav = s.base.navFails ? [] : s.nav.filter((row) => expectedLookups.has(row.path));
        const provisions = s.base.provisionsFails
          ? []
          : s.provisions.filter(
              (row) => row.citation_path != null && expectedLookups.has(row.citation_path)
            );
        const expectedLabels: Record<string, string> = {};
        for (const row of nav) {
          const label = row.label?.trim();
          if (label) expectedLabels[row.path] = label;
        }
        const headed = new Set<string>();
        for (const row of provisions) {
          const heading = row.heading?.trim();
          if (heading && !headed.has(row.citation_path!)) {
            expectedLabels[row.citation_path!] = heading;
            headed.add(row.citation_path!);
          }
        }
        expect(value.citation_labels).toEqual(expectedLabels);

        // Document root: the longest parentless provision that is the
        // citation's leaf or an ancestor of it on a "/" boundary.
        const roots = provisions
          .filter((row) => row.parent_id === null)
          .map((row) => row.citation_path!);
        const expectedRoots: Record<string, string> = {};
        for (const value of citations) {
          if (!value) continue;
          const leaf = corpusLookupPathsForCitation(value).at(-1);
          if (!leaf) continue;
          const matches = roots.filter((root) => leaf === root || leaf.startsWith(`${root}/`));
          if (matches.length === 0) continue;
          expectedRoots[value] = matches.reduce((a, b) => (b.length > a.length ? b : a));
        }
        expect(value.citation_document_paths).toEqual(expectedRoots);
      })
    );
  });

  it("fails the status only when the encoding runs read fails", async () => {
    await fc.assert(
      fc.asyncProperty(
        scenario,
        fc.constantFrom<500 | 503 | "non-array">(500, 503, "non-array"),
        async (s, failure) => {
          stubSupabase(s, failure);

          const status = await getEncodingStatus();

          expect(status.value).toBeNull();
          expect(status.source).toBeNull();
          expect(status.error).toMatch(
            failure === "non-array"
              ? /non-array payload for encodings\.encoding_runs/
              : new RegExp(`Supabase returned ${failure} for encodings\\.encoding_runs`)
          );
        }
      )
    );
  });
});

function prefixes(path: string | undefined): string[] {
  if (!path) return [];
  const segments = path.split("/");
  const out: string[] = [];
  for (let depth = 3; depth <= segments.length; depth++) {
    out.push(segments.slice(0, depth).join("/"));
  }
  return out;
}

function runRows(s: Scenario): EncodingStatusRun[] {
  return s.base.runs.map((run, i) => ({
    id: `run-${i}`,
    timestamp: `2026-09-29T00:00:${String(59 - i).padStart(2, "0")}.000Z`,
    citation: run.citation,
    total_duration_ms: 1000 + i,
    agent_type: "encoder",
    agent_model: "model",
    data_source: run.data_source,
    has_issues: run.has_issues,
    session_id: null,
    encoder_version: "0.0.1",
  }));
}

function liveRows(s: Scenario): LiveEncodingRun[] {
  return s.base.live.map((run, i) => ({
    id: `live-${i}`,
    citation: run.citation,
    status: run.status,
    started_at: "2026-09-29T00:00:00.000Z",
    last_heartbeat_at: "2026-09-29T00:01:00.000Z",
    finished_at: null,
    phase: null,
    attempt: 1,
    backend: "codex",
    model: "model",
    encoder_version: "0.0.1",
    run_id: null,
    runner: { hostname: `host-${i}` },
  }));
}

function stubSupabase(s: Scenario, runsFailure?: 500 | 503 | "non-array") {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  const requested: Record<string, Set<string>> = {};
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const table = url.pathname.replace("/rest/v1/", "");
    const filter = url.searchParams.get(table === "navigation_nodes" ? "path" : "citation_path");
    const inList = new Set([...(filter ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1]));
    if (filter) requested[table] = inList;

    if (table === "encoding_runs") {
      if (runsFailure === "non-array") return json({ rows: [] });
      if (runsFailure) return json({ message: "down" }, runsFailure);
      return json(runRows(s));
    }
    if (table === "live_encoding_runs") {
      return s.base.liveFails ? json({ message: "down" }, 503) : json(liveRows(s));
    }
    if (table === "navigation_nodes") {
      return s.base.navFails
        ? json({ message: "down" }, 503)
        : json(s.nav.filter((row) => inList.has(row.path)));
    }
    if (table === "current_provisions") {
      return s.base.provisionsFails
        ? json({ message: "down" }, 503)
        : json(
            s.provisions.filter(
              (row) => row.citation_path != null && inList.has(row.citation_path)
            )
          );
    }
    return json({ message: `unexpected read of ${table}` }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requested };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
