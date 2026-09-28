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
          runner: {
            hostname: "box",
            reported_via: "trusted_direct",
            sneaky: "field",
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
});
