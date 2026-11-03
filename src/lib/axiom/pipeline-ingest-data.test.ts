import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineEvent } from "./pipeline-events";
import { getIngestEvents, readIngest, readRepoPins, withIngest } from "./pipeline-ingest-data";

vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock("./corpus-releases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./corpus-releases")>()),
  getCorpusView: vi.fn(async () => ({ jurisdictions: [{ jurisdiction: "us", next: { release: "us-rulespec-b" } }] })),
  readRulespecRepos: vi.fn(async () => ["us"]),
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const toml = (release: string) => `[toolchain]\naxiom_corpus_release = "${release}"\n`;

/** Supabase, the publish runs and GitHub's GraphQL API, as of a small slice of the live data. */
function stubFetch(overrides: Record<string, Response | Error> = {}) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [fragment, response] of Object.entries(overrides)) {
      if (url.includes(fragment) || String(init?.body ?? "").includes(fragment)) {
        if (response instanceof Error) throw response;
        return response.clone();
      }
    }
    if (url.includes("/release_objects")) {
      return json([
        { release_name: "us-rulespec-a", created_at: "2026-10-13T17:32:23+00:00" },
        { release_name: "us-rulespec-b", created_at: "2026-10-25T15:37:34+00:00" },
      ]);
    }
    if (url.includes("/scope_activation_history")) return json([{ release_name: "us-rulespec-a", activated_at: "2026-10-13T20:00:00+00:00" }]);
    if (url.includes("/publish.yml/runs")) {
      return json({
        total_count: 1,
        workflow_runs: [
          {
            id: 7,
            html_url: "https://github.com/run/7",
            head_sha: "abc",
            created_at: "2026-10-25T16:19:51Z",
            updated_at: "2026-10-25T16:34:57Z",
            conclusion: "success",
            status: "completed",
            head_commit: { timestamp: "2026-10-25T15:37:34Z", message: "Merge pull request #933 from x/y\n\nbody" },
          },
        ],
      });
    }
    if (url.endsWith("/graphql")) {
      const query = JSON.parse(String(init?.body)).query as string;
      if (query.includes("pullRequest(number:")) {
        return json({ data: { repository: { p933: { number: 933, url: "https://github.com/pr/933", createdAt: "2026-10-25T11:45:00Z", mergedAt: "2026-10-25T15:37:34Z" } } } });
      }
      if (query.includes("history(")) {
        return json({
          data: {
            repository: {
              defaultBranchRef: {
                name: "main",
                target: {
                  history: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                      { oid: "c3", committedDate: "2026-10-26T10:00:00Z", file: { object: { text: toml("us-rulespec-b") } } },
                      { oid: "c2", committedDate: "2026-10-14T10:00:00Z", file: { object: { text: toml("us-rulespec-a") } } },
                      { oid: "c1", committedDate: "2026-10-01T10:00:00Z", file: { object: { text: "[toolchain]\n" } } },
                    ],
                  },
                },
              },
            },
          },
        });
      }
      if (query.includes("object(oid:")) {
        return json({
          data: {
            repository: {
              c0: { oid: "c3", associatedPullRequests: { nodes: [{ number: 1914, url: "https://github.com/pr/1914", mergedAt: "2026-10-26T19:26:56Z", baseRefName: "main" }] } },
              c1: { oid: "c2", associatedPullRequests: { nodes: [{ number: 5, url: "https://github.com/pr/5", mergedAt: "2026-10-14T09:00:00Z", baseRefName: "side" }] } },
            },
          },
        });
      }
    }
    return json({ message: "not stubbed" }, 404);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function supabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
}

const leave = (events: PipelineEvent[], release: string, station: string) =>
  events.find((e) => e.case_id === `release:${release}` && e.station === station && (e.kind === "leave" || e.kind === "wait"));

describe("readRepoPins", () => {
  it("takes each release's first commit, landed at its PR's merge into the default branch, else at the commit", async () => {
    stubFetch();
    expect(await readRepoPins("rulespec-us", "token")).toEqual([
      { repo: "rulespec-us", release: "us-rulespec-b", at: "2026-10-26T19:26:56Z", ref_url: "https://github.com/pr/1914" },
      // Its only PR went into a side branch: the commit's own time.
      { repo: "rulespec-us", release: "us-rulespec-a", at: "2026-10-14T10:00:00Z", ref_url: "https://github.com/TheAxiomFoundation/rulespec-us/commit/c2" },
    ]);
  });
});

describe("readIngest", () => {
  it("derives the ingest events from the corpus tables, the publish runs, the corpus PRs and the pins", async () => {
    supabase();
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "token");
    const fetchMock = stubFetch();
    const result = await readIngest(Date.parse("2026-11-02T00:00:00Z"));
    expect(result.unmeasured).toEqual({});
    expect(result.error).toBeNull();
    expect(leave(result.events, "us-rulespec-b", "corpus_ingest")).toMatchObject({ duration_ms: 13_954_000, ref_url: "https://github.com/pr/933" });
    expect(leave(result.events, "us-rulespec-b", "release_publish")).toMatchObject({ at: "2026-10-25T16:34:57Z", duration_ms: 906_000 });
    expect(leave(result.events, "us-rulespec-b", "release_activate")).toMatchObject({ kind: "wait", rule_id: "release:not-activated" });
    expect(leave(result.events, "us-rulespec-b", "release_pin")).toMatchObject({ kind: "leave", at: "2026-10-26T19:26:56Z", outcome: "ok" });
    expect(leave(result.events, "us-rulespec-a", "release_pin")).toMatchObject({ kind: "leave", at: "2026-10-14T10:00:00Z" });
    const runs = fetchMock.mock.calls.map(([url]) => String(url)).find((url) => url.includes("publish.yml"))!;
    expect(new URL(runs).searchParams.get("created")).toBe(">=2026-07-05");
    expect(fetchMock.mock.calls.find(([url]) => String(url).includes("publish.yml"))?.[1]?.headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("without a GitHub token reads no pins or PRs: Release pin is not measured, Corpus ingest has no times", async () => {
    supabase();
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    const fetchMock = stubFetch();
    const result = await readIngest();
    expect(result.unmeasured).toEqual({ release_pin: "needs a GitHub token to read the pin history" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/graphql"))).toBe(false);
    expect(result.events.some((e) => e.station === "release_pin")).toBe(false);
    expect(leave(result.events, "us-rulespec-b", "corpus_ingest")).toMatchObject({ duration_ms: null, attrs: { untimed: true } });
  });

  it("names the GitHub reads it could not make, and keeps the rest", async () => {
    supabase();
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "token");
    stubFetch({ "publish.yml": json({}, 502), "history(": json({ errors: [{ message: "timeout" }] }) });
    const result = await readIngest();
    expect(result.error).toContain("publish runs: GitHub returned 502");
    expect(result.error).toContain("rulespec-us pins: GitHub GraphQL: timeout");
    expect(result.unmeasured).toEqual({ release_pin: "pin history not readable" });
    expect(leave(result.events, "us-rulespec-a", "release_activate")).toMatchObject({ kind: "leave" });
  });
});

describe("getIngestEvents", () => {
  it("leaves every ingest station unmeasured when the release tables cannot be read", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const result = await getIngestEvents();
    expect(result.events).toEqual([]);
    expect(Object.keys(result.unmeasured)).toEqual(["corpus_ingest", "release_publish", "release_activate", "release_pin"]);
    expect(result.error).toMatch(/not configured/);
  });

  it("shows the ingest stations as not measured when the read takes too long", async () => {
    supabase();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const result = await getIngestEvents(5);
    expect(result).toMatchObject({ events: [], error: "corpus releases: no answer in 0s" });
    expect(result.unmeasured.release_pin).toBe("release data not readable");
  });

  it("returns the derived events", async () => {
    supabase();
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "token");
    stubFetch();
    expect((await getIngestEvents()).events.length).toBeGreaterThan(0);
  });
});

describe("withIngest", () => {
  const event = (source: PipelineEvent["source"]) => ({ id: source, source }) as PipelineEvent;
  it("adds the derived release events unless the log already has some", () => {
    expect(withIngest([event("pipeline_attempts")], [event("corpus_release")]).map((e) => e.id)).toEqual(["pipeline_attempts", "corpus_release"]);
    const logged = [event("pipeline_attempts"), event("corpus_release")];
    expect(withIngest(logged, [event("corpus_release")])).toBe(logged);
  });
});
