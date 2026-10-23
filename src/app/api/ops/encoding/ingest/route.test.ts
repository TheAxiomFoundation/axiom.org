import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { _resetIngestRouteState } from "./limiter";

const SUPABASE_URL = "https://example.supabase.co";

function post(body: unknown, forwardedFor = "203.0.113.5"): Request {
  return new Request("http://localhost/api/ops/encoding/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwardedFor,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function startBody(overrides: Record<string, unknown> = {}) {
  return {
    op: "start",
    id: "live-abc123def456",
    citation: "us/statute/26/32",
    backend: "codex",
    model: "gpt-5.5",
    encoder_version: "0.2.1640",
    runner: { hostname: "third-party-box", username: "encoder", pid: 42 },
    ...overrides,
  };
}

/** Supabase REST stub: HEAD count + write calls, capturing requests. */
function stubSupabase({
  runningCount = 0,
  writeStatus = 201,
  matchedRows = 1,
}: {
  runningCount?: number;
  writeStatus?: number;
  matchedRows?: number;
} = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (init?.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-range": `0-0/${runningCount}` },
      });
    }
    if (init?.method === "PATCH") {
      return new Response(JSON.stringify(Array(matchedRows).fill({})), {
        status: 200,
      });
    }
    return new Response(writeStatus === 201 ? null : "{}", {
      status: writeStatus,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("POST /api/ops/encoding/ingest", () => {
  beforeEach(() => {
    _resetIngestRouteState();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv("AXIOM_OPS_SUPABASE_SERVICE_KEY", "service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 503 when the service key is not configured", async () => {
    vi.stubEnv("AXIOM_OPS_SUPABASE_SERVICE_KEY", "");
    const response = await POST(post(startBody()));
    expect(response.status).toBe(503);
  });

  it("inserts a start row with server timestamps and provenance stamp", async () => {
    const { calls } = stubSupabase();
    const response = await POST(post(startBody()));
    expect(response.status).toBe(204);

    const insert = calls.find((c) => c.init.method === "POST");
    expect(insert).toBeDefined();
    const row = JSON.parse(String(insert!.init.body));
    expect(row.id).toBe("live-abc123def456");
    expect(row.citation).toBe("us/statute/26/32");
    expect(row.status).toBe("running");
    expect(row.started_at).toBeTruthy();
    expect(row.runner.reported_via).toBe("public_ingest");
    expect(row.runner.hostname).toBe("third-party-box");
    expect(row.phase).toBeNull();
    const headers = insert!.init.headers as Record<string, string>;
    expect(headers.apikey).toBe("service-key");
    expect(headers["Content-Profile"]).toBe("encodings");
  });

  it("ignores client-supplied timestamps and unknown runner fields", async () => {
    const { calls } = stubSupabase();
    await POST(
      post(
        startBody({
          started_at: "1999-01-01T00:00:00Z",
          phase: "resolve",
          runner: {
            hostname: "box",
            reported_via: "trusted_direct",
            sneaky: "field",
            github_run_id: "123",
          },
        })
      )
    );
    const row = JSON.parse(
      String(calls.find((c) => c.init.method === "POST")!.init.body)
    );
    expect(row.started_at).not.toBe("1999-01-01T00:00:00Z");
    expect(row.runner.reported_via).toBe("public_ingest");
    expect(row.runner.sneaky).toBeUndefined();
    expect(row.runner.github_run_id).toBeUndefined();
    expect(row.phase).toBe("resolve");
  });

  it("rejects malformed ids, citations, and ops", async () => {
    stubSupabase();
    expect(
      (await POST(post(startBody({ id: "not-a-live-id!" })))).status
    ).toBe(400);
    expect((await POST(post(startBody({ citation: "" })))).status).toBe(400);
    expect(
      (
        await POST(
          post(startBody({ citation: "x".repeat(301) }))
        )
      ).status
    ).toBe(400);
    expect(
      (await POST(post({ op: "nuke", id: "live-abc123def456" }))).status
    ).toBe(400);
    expect((await POST(post("{not json"))).status).toBe(400);
  });

  it("refuses new rows when the public board is full", async () => {
    stubSupabase({ runningCount: 200 });
    const response = await POST(post(startBody()));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "board_full" });
  });

  it("returns 409 for duplicate run ids", async () => {
    stubSupabase({ writeStatus: 409 });
    const response = await POST(post(startBody()));
    expect(response.status).toBe(409);
  });

  it("heartbeats only ingest-stamped rows", async () => {
    const { calls } = stubSupabase();
    const response = await POST(
      post({ op: "heartbeat", id: "live-abc123def456", phase: "validating" })
    );
    expect(response.status).toBe(204);
    const patch = calls.find((c) => c.init.method === "PATCH");
    expect(patch!.url).toContain("reported_via=eq.public_ingest");
    const data = JSON.parse(String(patch!.init.body));
    expect(data.last_heartbeat_at).toBeTruthy();
    expect(data.phase).toBe("validating");
  });

  it("404s heartbeats for unknown or non-ingest rows", async () => {
    stubSupabase({ matchedRows: 0 });
    const response = await POST(
      post({ op: "heartbeat", id: "live-abc123def456" })
    );
    expect(response.status).toBe(404);
  });

  it("finishes a run with status and run link", async () => {
    const { calls } = stubSupabase();
    const response = await POST(
      post({
        op: "finish",
        id: "live-abc123def456",
        status: "completed",
        run_id: "run-777",
      })
    );
    expect(response.status).toBe(204);
    const data = JSON.parse(
      String(calls.find((c) => c.init.method === "PATCH")!.init.body)
    );
    expect(data.status).toBe("completed");
    expect(data.run_id).toBe("run-777");
    expect(data.finished_at).toBeTruthy();
  });

  it("rejects finish with an unknown status", async () => {
    stubSupabase();
    const response = await POST(
      post({ op: "finish", id: "live-abc123def456", status: "definitely-fine" })
    );
    expect(response.status).toBe(400);
  });

  it("rate limits per client", async () => {
    stubSupabase();
    let limited = false;
    for (let i = 0; i < 61; i += 1) {
      const response = await POST(
        post({ op: "heartbeat", id: "live-abc123def456" }, "198.51.100.7")
      );
      if (response.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it("maps Supabase failures to 502", async () => {
    stubSupabase({ writeStatus: 500 });
    const response = await POST(post(startBody()));
    expect(response.status).toBe(502);
  });

  describe("capacity", () => {
    const NOW = new Date("2026-10-23T12:00:00.000Z");
    const minutesAgo = (minutes: number) =>
      new Date(Date.now() - minutes * 60_000).toISOString();
    const advance = (minutes: number) =>
      vi.setSystemTime(new Date(Date.now() + minutes * 60_000));

    type Row = {
      id: string;
      status: string;
      last_heartbeat_at: string;
      runner: Record<string, unknown>;
    };

    /**
     * live_encoding_runs behind PostgREST, as far as the ingest uses it.
     * Filters must carry their operator (eq., gte., in.(…)) or the stub
     * throws, as PostgREST would reject them; HEAD counts need the exact
     * count and schema headers. POST inserts; PATCH updates the rows the
     * filters select and returns them.
     */
    function stubTable(rows: Row[]) {
      const fieldOf = (row: Row, name: string): unknown =>
        name.startsWith("runner->>")
          ? row.runner[name.slice("runner->>".length)]
          : (row as unknown as Record<string, unknown>)[name];
      const matches = (row: Row, query: URLSearchParams) =>
        [...query.entries()]
          .filter(([name]) => name !== "select")
          .every(([name, filter]) => {
            const value = fieldOf(row, name);
            const eq = /^eq\.(.*)$/.exec(filter);
            const gte = /^gte\.(.*)$/.exec(filter);
            const inList = /^in\.\((.*)\)$/.exec(filter);
            if (eq) return value === eq[1];
            if (gte) return typeof value === "string" && value >= gte[1];
            if (inList) return inList[1].split(",").includes(String(value));
            throw new Error(`invalid PostgREST filter ${name}=${filter}`);
          });
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const query = new URL(String(url)).searchParams;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (init?.method === "HEAD") {
          expect(headers.Prefer).toBe("count=exact");
          expect(headers["Accept-Profile"]).toBe("encodings");
          const count = rows.filter((row) => matches(row, query)).length;
          return new Response(null, {
            status: 200,
            headers: { "content-range": `*/${count}` },
          });
        }
        if (init?.method === "POST") {
          rows.push(JSON.parse(String(init.body)) as Row);
          return new Response(null, { status: 201 });
        }
        if (init?.method === "PATCH") {
          expect(headers["Content-Profile"]).toBe("encodings");
          const hit = rows.filter((row) => matches(row, query));
          for (const row of hit) Object.assign(row, JSON.parse(String(init.body)));
          return new Response(JSON.stringify(hit), { status: 200 });
        }
        throw new Error(`unexpected ${init?.method} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      return rows;
    }

    const runId = (n: number, ip: string) =>
      `live-${ip.replace(/\D/g, "")}x${String(n).padStart(4, "0")}`;
    const start = (n: number, ip: string) =>
      POST(post(startBody({ id: runId(n, ip) }), ip));
    const beat = (n: number, ip: string) =>
      POST(post({ op: "heartbeat", id: runId(n, ip) }, ip));
    const freshFor = (rows: Row[], tag: unknown) =>
      rows.filter(
        (row) =>
          row.runner.ingest_client === tag &&
          row.last_heartbeat_at >= minutesAgo(10)
      ).length;

    beforeEach(() => {
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("frees the slots of runs that stopped heartbeating (the reported board_full lockout)", async () => {
      // 200 registrations nobody finished, last heard from eight days ago.
      const abandoned = Array.from({ length: 200 }, (_, i) => ({
        id: `live-abandoned${String(i).padStart(4, "0")}`,
        status: "running",
        last_heartbeat_at: minutesAgo(8 * 24 * 60),
        runner: { reported_via: "public_ingest", ingest_client: `tag${i}` },
      }));
      stubTable(abandoned);
      expect((await start(1, "192.0.2.10")).status).toBe(204);
    });

    it("still counts a run that heartbeat within the window", async () => {
      const live = Array.from({ length: 200 }, (_, i) => ({
        id: `live-fresh${String(i).padStart(4, "0")}`,
        status: "running",
        last_heartbeat_at: minutesAgo(9),
        runner: { reported_via: "public_ingest", ingest_client: `tag${i}` },
      }));
      stubTable(live);
      const response = await start(1, "192.0.2.10");
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: "board_full" });
    });

    it("holds one client to its share while others can still start", async () => {
      const rows = stubTable([]);
      for (let n = 0; n < 20; n += 1) {
        expect((await start(n, "198.51.100.20")).status).toBe(204);
      }
      const over = await start(20, "198.51.100.20");
      expect(over.status).toBe(429);
      expect(await over.json()).toEqual({ error: "client_full" });
      expect((await start(0, "203.0.113.30")).status).toBe(204);
      expect(rows).toHaveLength(21);
    });

    it("keeps a live run alive with heartbeats", async () => {
      const rows = stubTable([]);
      await start(0, "198.51.100.20");
      advance(9);
      expect((await beat(0, "198.51.100.20")).status).toBe(204);
      advance(9);
      expect((await beat(0, "198.51.100.20")).status).toBe(204);
      expect(rows[0].last_heartbeat_at).toBe(new Date(Date.now()).toISOString());
    });

    it("won't heartbeat a lapsed run back into a slot (start, lapse, restart, revive)", async () => {
      const rows = stubTable([]);
      const ip = "198.51.100.20";
      for (let n = 0; n < 20; n += 1) await start(n, ip);
      advance(11);
      // The first batch has lapsed, so a second batch of 20 is admitted…
      for (let n = 20; n < 40; n += 1) {
        expect((await start(n, ip)).status).toBe(204);
      }
      // …but the first batch can't be beaten back to life on top of it.
      for (let n = 0; n < 20; n += 1) {
        expect((await beat(n, ip)).status).toBe(404);
      }
      expect(freshFor(rows, rows[20].runner.ingest_client)).toBe(20);
      expect((await start(40, ip)).status).toBe(429);
    });

    it("keeps a client's share across the midnight tag change", async () => {
      vi.setSystemTime(new Date("2026-10-23T23:59:30.000Z"));
      const rows = stubTable([]);
      const ip = "198.51.100.20";
      for (let n = 0; n < 20; n += 1) await start(n, ip);
      advance(1);
      const over = await start(20, ip);
      expect(over.status).toBe(429);
      expect(await over.json()).toEqual({ error: "client_full" });
      expect(rows).toHaveLength(20);
    });

    it("stamps rows with a keyed client tag, never the IP or a client-supplied tag", async () => {
      const rows = stubTable([]);
      await POST(
        post(
          startBody({ runner: { hostname: "box", ingest_client: "spoofed" } }),
          "198.51.100.20"
        )
      );
      const tag = rows[0].runner.ingest_client as string;
      expect(tag).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(rows[0])).not.toContain("198.51.100.20");

      // The tag changes with the UTC day, so it links a client's runs for a day at most.
      vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
      await POST(post(startBody({ id: "live-nextday000001" }), "198.51.100.20"));
      expect(rows[1].runner.ingest_client).toMatch(/^[0-9a-f]{16}$/);
      expect(rows[1].runner.ingest_client).not.toBe(tag);
    });
  });
});
