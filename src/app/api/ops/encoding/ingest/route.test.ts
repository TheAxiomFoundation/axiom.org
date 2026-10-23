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
      started_at: string;
      last_heartbeat_at: string;
      runner: Record<string, unknown>;
    };

    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    const TAG = /^[0-9a-f]{16}$/;
    /** The filters the route may send, each with the value grammar
     *  PostgREST would accept for it. */
    const FILTERS: Record<string, (value: string) => (row: Row) => boolean> = {
      id: eqOf(/^live-[a-z0-9]{8,32}$/, (row) => row.id),
      status: eqOf(/^(running|completed|failed)$/, (row) => row.status),
      "runner->>reported_via": eqOf(/^public_ingest$/, (row) => row.runner.reported_via),
      last_heartbeat_at: gteOf((row) => row.last_heartbeat_at),
      started_at: gteOf((row) => row.started_at),
      "runner->>ingest_client": (value) => {
        const list = /^in\.\(([^()]*)\)$/.exec(value);
        const tags = list?.[1].split(",");
        if (!tags || !tags.every((tag) => TAG.test(tag))) {
          throw new Error(`invalid in-list ${value}`);
        }
        return (row) => tags.includes(String(row.runner.ingest_client));
      },
    };
    function eqOf(grammar: RegExp, field: (row: Row) => unknown) {
      return (value: string) => {
        const match = /^eq\.(.*)$/.exec(value);
        if (!match || !grammar.test(match[1])) throw new Error(`invalid eq ${value}`);
        return (row: Row) => field(row) === match[1];
      };
    }
    function gteOf(field: (row: Row) => string) {
      return (value: string) => {
        const match = /^gte\.(.*)$/.exec(value);
        if (!match || !ISO.test(match[1])) throw new Error(`invalid gte ${value}`);
        return (row: Row) => field(row) >= match[1];
      };
    }

    /**
     * live_encoding_runs behind PostgREST, as far as the ingest uses it.
     * Every filter is parsed against its grammar before any row is read,
     * so a malformed query throws even on an empty table; HEAD counts need
     * the exact-count and schema headers. POST inserts; PATCH updates the
     * rows the filters select and returns them.
     */
    function stubTable(rows: Row[]) {
      const select = (query: URLSearchParams) => {
        const tests = [...query.entries()]
          .filter(([name]) => name !== "select")
          .map(([name, value]) => {
            const parse = FILTERS[name];
            if (!parse) throw new Error(`unexpected filter ${name}`);
            return parse(value);
          });
        return rows.filter((row) => tests.every((test) => test(row)));
      };
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const query = new URL(String(url)).searchParams;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (init?.method === "HEAD") {
          if (headers.Prefer !== "count=exact" || headers["Accept-Profile"] !== "encodings") {
            throw new Error("count without exact-count or schema headers");
          }
          return new Response(null, {
            status: 200,
            headers: { "content-range": `*/${select(query).length}` },
          });
        }
        if (init?.method === "POST") {
          rows.push(JSON.parse(String(init.body)) as Row);
          return new Response(null, { status: 201 });
        }
        if (init?.method === "PATCH") {
          if (headers["Content-Profile"] !== "encodings") throw new Error("update without schema header");
          const hit = select(query);
          for (const row of hit) Object.assign(row, JSON.parse(String(init.body)));
          return new Response(JSON.stringify(hit), { status: 200 });
        }
        throw new Error(`unexpected ${init?.method} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      return { rows, fetchMock };
    }

    const seeded = (n: number, overrides: Partial<Row> = {}): Row[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `live-seeded${String(i).padStart(4, "0")}`,
        status: "running",
        started_at: minutesAgo(60),
        last_heartbeat_at: minutesAgo(1),
        runner: { reported_via: "public_ingest", ingest_client: `${String(i).padStart(16, "0")}` },
        ...overrides,
      }));
    const runId = (n: number, ip: string) =>
      `live-${ip.replace(/\D/g, "")}x${String(n).padStart(4, "0")}`;
    const start = (n: number, ip: string) =>
      POST(post(startBody({ id: runId(n, ip) }), ip));
    const beat = (n: number, ip: string) =>
      POST(post({ op: "heartbeat", id: runId(n, ip) }, ip));

    beforeEach(() => {
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("the table stub rejects malformed queries, even on an empty table", async () => {
      const { fetchMock } = stubTable([]);
      const head = (query: string, headers: Record<string, string> = { Prefer: "count=exact", "Accept-Profile": "encodings" }) =>
        fetchMock(`${SUPABASE_URL}/rest/v1/live_encoding_runs?select=id&${query}`, { method: "HEAD", headers });
      const ok = "status=eq.running&runner->>reported_via=eq.public_ingest";
      await expect(head(`${ok}&last_heartbeat_at=gte.2026-10-23T11:50:00.000Z`)).resolves.toBeInstanceOf(Response);
      await expect(head(`${ok}&last_heartbeat_at=2026-10-23T11:50:00.000Z`)).rejects.toThrow();
      await expect(head(`${ok}&last_heartbeat_at=gte.2026-10-23T11:50:00.000Zjunk`)).rejects.toThrow();
      await expect(head(`${ok}&runner->>ingest_client=in.(0123456789abcdef,junk)`)).rejects.toThrow();
      await expect(head(`${ok}&runner->>ingest_client=in.(0123456789abcdef))`)).rejects.toThrow();
      await expect(head(`${ok}&started_at=lt.2026-10-23T11:50:00.000Z`)).rejects.toThrow();
      await expect(head(ok, { "Accept-Profile": "encodings" })).rejects.toThrow();
    });

    it("frees the slots of runs that stopped heartbeating (the reported board_full lockout)", async () => {
      // 200 registrations nobody finished, last heard from eight days ago.
      stubTable(seeded(200, { started_at: minutesAgo(8 * 24 * 60 + 5), last_heartbeat_at: minutesAgo(8 * 24 * 60) }));
      expect((await start(1, "192.0.2.10")).status).toBe(204);
    });

    it("still counts a run that heartbeat within the window", async () => {
      stubTable(seeded(200, { last_heartbeat_at: minutesAgo(9) }));
      const response = await start(1, "192.0.2.10");
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: "board_full" });
    });

    it("frees a slot a day after its start, however long it heartbeats", async () => {
      stubTable(seeded(200, { started_at: minutesAgo(24 * 60 + 1) }));
      expect((await start(1, "192.0.2.10")).status).toBe(204);
    });

    it("holds one client to its share while others can still start", async () => {
      const { rows } = stubTable([]);
      for (let n = 0; n < 20; n += 1) {
        expect((await start(n, "198.51.100.20")).status).toBe(204);
      }
      const over = await start(20, "198.51.100.20");
      expect(over.status).toBe(429);
      expect(await over.json()).toEqual({ error: "client_full" });
      expect((await start(0, "203.0.113.30")).status).toBe(204);
      expect(rows).toHaveLength(21);
    });

    it("admits only a client's share of concurrent starts", async () => {
      const { rows } = stubTable([]);
      const responses = await Promise.all(
        Array.from({ length: 60 }, (_, n) => start(n, "198.51.100.20"))
      );
      expect(responses.filter((r) => r.status === 204)).toHaveLength(20);
      expect(responses.filter((r) => r.status === 429)).toHaveLength(40);
      expect(rows).toHaveLength(20);
    });

    it("renews a slot only with time to spare", async () => {
      const { rows } = stubTable([]);
      await start(0, "198.51.100.20");
      advance(7.9);
      expect((await beat(0, "198.51.100.20")).status).toBe(204);
      expect(rows[0].last_heartbeat_at).toBe(new Date(Date.now()).toISOString());
      // Still counted for capacity until 10 minutes, but 8 minutes on a
      // renewal could land after the slot has been handed out again.
      advance(8.1);
      expect((await beat(0, "198.51.100.20")).status).toBe(404);
    });

    it("won't heartbeat a lapsed run back into a slot (start, lapse, restart, revive)", async () => {
      const { rows } = stubTable([]);
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
      const fresh = rows.filter((row) => row.last_heartbeat_at >= minutesAgo(10));
      expect(fresh).toHaveLength(20);
      expect((await start(40, ip)).status).toBe(429);
    });

    it("keeps a client's share across midnight for as long as its runs heartbeat", async () => {
      vi.setSystemTime(new Date("2026-10-23T23:59:30.000Z"));
      const { rows } = stubTable([]);
      const ip = "198.51.100.20";
      for (let n = 0; n < 20; n += 1) await start(n, ip);
      const beatAll = async () => {
        for (let n = 0; n < 20; n += 1) expect((await beat(n, ip)).status).toBe(204);
      };
      // Heartbeat through midnight and well past the first ten minutes.
      for (let step = 0; step < 4; step += 1) {
        advance(5);
        await beatAll();
      }
      const over = await start(20, ip);
      expect(over.status).toBe(429);
      expect(await over.json()).toEqual({ error: "client_full" });
      expect(rows).toHaveLength(20);
    });

    it("stamps rows with a keyed client tag, never the IP or a client-supplied tag", async () => {
      const { rows } = stubTable([]);
      await POST(
        post(
          startBody({ runner: { hostname: "box", ingest_client: "spoofed" } }),
          "198.51.100.20"
        )
      );
      const tag = rows[0].runner.ingest_client as string;
      expect(tag).toMatch(TAG);
      expect(JSON.stringify(rows[0])).not.toContain("198.51.100.20");

      // The tag changes with the UTC day, so it links a client's runs for a day at most.
      vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
      await POST(post(startBody({ id: "live-nextday000001" }), "198.51.100.20"));
      expect(rows[1].runner.ingest_client).toMatch(TAG);
      expect(rows[1].runner.ingest_client).not.toBe(tag);
    });
  });
});
