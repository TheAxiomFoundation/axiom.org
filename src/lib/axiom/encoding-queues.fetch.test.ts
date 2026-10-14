import { afterEach, describe, expect, it, vi } from "vitest";
import { getEncodingQueues, readEncodingQueues } from "./encoding-queues";

vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));

const QUEUE_FILE = {
  queue_id: "us-snap-or-ut-2026-07",
  description: "OR/UT pilot.",
  pause_reason: null,
  items: [
    { status: "pending", jurisdiction: "us-or" },
    { status: "completed", jurisdiction: "us-ut" },
  ],
};

function jsonResponse(value: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => value,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("readEncodingQueues", () => {
  it("lists the queue directory and summarizes each file", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("encoding-queue-state")) return jsonResponse([]);
      if (href.includes("/commits?")) return jsonResponse([{ commit: { committer: { date: "2026-07-24T14:37:05Z" } } }]);
      if (href.includes("api.github.com")) {
        return jsonResponse([
          { name: "us-snap-or-ut-2026-07.json" },
          { name: "README.md" },
        ]);
      }
      return jsonResponse(QUEUE_FILE);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queues = await readEncodingQueues();
    expect(queues).toHaveLength(1);
    expect(queues[0]).toMatchObject({
      queueId: "us-snap-or-ut-2026-07",
      path: "data/encoding-queues/us-snap-or-ut-2026-07.json",
      total: 2,
      pending: 1,
      dispositionCounts: { completed: 1 },
      paused: false,
      pauseReason: null,
      // The inventory's last commit; no dispatcher queue lists its items.
      frozenSince: "2026-07-24T14:37:05Z",
      inDispatcher: 0,
    });
    // Only the .json entry was fetched from raw.
    const rawCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("raw.githubusercontent.com")
    );
    expect(rawCalls).toHaveLength(1);
    // With no dispatcher queue, the dispatch workflow is not looked up.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/workflows/"))).toBe(false);
    expect(
      fetchMock.mock.calls.find(([url]) => String(url).includes("/commits?"))?.[0]
    ).toBe(
      "https://api.github.com/repos/TheAxiomFoundation/axiom-encode/commits?path=data%2Fencoding-queues%2Fus-snap-or-ut-2026-07.json&per_page=1"
    );
  });

  it("sends the GitHub token only to the API listing", async () => {
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "token-1");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (href.includes("api.github.com")) expect(auth).toBe("Bearer token-1");
      else expect(auth).toBeUndefined();
      if (href.includes("encoding-queue-state")) return jsonResponse([]);
      if (href.includes("api.github.com")) {
        return jsonResponse([{ name: "us-snap-or-ut-2026-07.json" }]);
      }
      return jsonResponse(QUEUE_FILE);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queues = await readEncodingQueues();
    expect(queues).toHaveLength(1);
    // A commit listing without a date leaves the date unknown.
    expect(queues[0].frozenSince).toBeNull();
  });

  it("falls back to known queue files when the listing is unavailable", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("api.github.com")) {
        return jsonResponse({ message: "rate limited" }, false);
      }
      // The known dispatcher queue is unreadable too.
      if (href.includes("encoding-queue-state")) return jsonResponse({}, false);
      if (href.includes("us-snap-or-ut")) return jsonResponse(QUEUE_FILE);
      // The other known file is unreadable and must be skipped.
      return jsonResponse({}, false);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queues = await readEncodingQueues();
    expect(queues).toHaveLength(1);
    expect(queues[0]).toMatchObject({ queueId: "us-snap-or-ut-2026-07", frozenSince: null });
  });

  it("lists live dispatcher queues first, hides superseded inventories, and reads the dispatch workflow", async () => {
    const dispatcherFile = {
      schema: "axiom-encode/snap-dispatch-queue/v1",
      queue_id: "us-snap-or-ut-pilot",
      state: "paused",
      updated_at: "2026-10-01T15:17:36Z",
      items: [
        { citation: "us-or/a", status: "pending" },
        { citation: "us-ut/b", status: "blocked", note: "failed twice", attempts: [{ result: "failure" }] },
      ],
    };
    const allStates = {
      queue_id: "us-snap-all-states-2026-07",
      supersedes: ["us-snap-or-ut-2026-07"],
      pause_reason: "Awaiting a green tip.",
      items: [
        { citation: "us-or/a", status: "pending", jurisdiction: "us-or" },
        { citation: "us-ut/b", status: "pending", jurisdiction: "us-ut" },
        { citation: "us-ak/c", status: "pending", jurisdiction: "us-ak" },
      ],
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("api.github.com") && href.includes("encoding-queue-state")) {
        return jsonResponse([{ name: "us-snap-or-ut-pilot.json" }]);
      }
      if (href.includes("/actions/workflows/snap-dispatch-queue.yml")) return jsonResponse({ state: "disabled_manually" });
      if (href.includes("/commits?") && href.includes("all-states")) {
        return jsonResponse([{ commit: { committer: { date: "2026-08-05T21:39:46Z" } } }]);
      }
      if (href.includes("/commits?")) return jsonResponse({}, false);
      if (href.includes("api.github.com")) {
        return jsonResponse([{ name: "us-snap-or-ut-2026-07.json" }, { name: "us-snap-all-states-2026-07.json" }]);
      }
      if (href.includes("encoding-queue-state/queues/us-snap-or-ut-pilot.json")) {
        return jsonResponse(dispatcherFile);
      }
      if (href.includes("us-snap-all-states-2026-07.json")) return jsonResponse(allStates);
      return jsonResponse(QUEUE_FILE);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queues = await readEncodingQueues();
    expect(queues.map((queue) => [queue.queueId, queue.kind])).toEqual([
      ["us-snap-or-ut-pilot", "dispatcher"],
      ["us-snap-all-states-2026-07", "legacy"],
    ]);
    expect(queues[0]).toMatchObject({
      paused: true,
      pausedSince: "2026-10-01T15:17:36Z",
      dispatchWorkflow: {
        state: "disabled_manually",
        url: "https://github.com/TheAxiomFoundation/axiom-encode/actions/workflows/snap-dispatch-queue.yml",
      },
      frozenSince: null,
      inDispatcher: null,
    });
    expect(queues[1]).toMatchObject({
      total: 3,
      frozenSince: "2026-08-05T21:39:46Z",
      inDispatcher: 2,
      dispatchWorkflow: null,
    });

    // The cached reader returns the same, and a workflow it cannot read is left unknown.
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/actions/workflows/")) return jsonResponse({}, false);
      if (href.includes("api.github.com") && href.includes("encoding-queue-state")) {
        return jsonResponse([{ name: "us-snap-or-ut-pilot.json" }]);
      }
      if (href.includes("api.github.com")) return jsonResponse([]);
      return jsonResponse(dispatcherFile);
    });
    expect(await getEncodingQueues()).toMatchObject([{ queueId: "us-snap-or-ut-pilot", dispatchWorkflow: null }]);
  });
});
