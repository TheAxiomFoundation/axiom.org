import { afterEach, describe, expect, it, vi } from "vitest";
import { readEncodingQueues } from "./encoding-queues";

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
      total: 2,
      pending: 1,
      dispositionCounts: { completed: 1 },
      pauseReason: null,
    });
    // Only the .json entry was fetched from raw.
    const rawCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("raw.githubusercontent.com")
    );
    expect(rawCalls).toHaveLength(1);
  });

  it("sends the GitHub token only to the API listing", async () => {
    vi.stubEnv("AXIOM_GITHUB_TOKEN", "token-1");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (href.includes("encoding-queue-state")) return jsonResponse([]);
      if (href.includes("api.github.com")) {
        expect(auth).toBe("Bearer token-1");
        return jsonResponse([{ name: "us-snap-or-ut-2026-07.json" }]);
      }
      expect(auth).toBeUndefined();
      return jsonResponse(QUEUE_FILE);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queues = await readEncodingQueues();
    expect(queues).toHaveLength(1);
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
    expect(queues[0].queueId).toBe("us-snap-or-ut-2026-07");
  });

  it("lists live dispatcher queues first", async () => {
    const dispatcherFile = {
      schema: "axiom-encode/snap-dispatch-queue/v1",
      queue_id: "us-snap-or-ut-pilot",
      state: "active",
      items: [{ status: "pending" }, { status: "blocked" }],
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("api.github.com") && href.includes("encoding-queue-state")) {
        return jsonResponse([{ name: "us-snap-or-ut-pilot.json" }]);
      }
      if (href.includes("api.github.com")) {
        return jsonResponse([{ name: "us-snap-or-ut-2026-07.json" }]);
      }
      if (href.includes("encoding-queue-state/queues/us-snap-or-ut-pilot.json")) {
        return jsonResponse(dispatcherFile);
      }
      return jsonResponse(QUEUE_FILE);
    });
    vi.stubGlobal("fetch", fetchMock);

    const queues = await readEncodingQueues();
    expect(queues.map((queue) => [queue.queueId, queue.kind])).toEqual([
      ["us-snap-or-ut-pilot", "dispatcher"],
      ["us-snap-or-ut-2026-07", "legacy"],
    ]);
  });
});
