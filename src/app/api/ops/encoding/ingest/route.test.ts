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
    expect(new URL(patch!.url).searchParams.get("status")).toBe("eq.running");
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
    // Older clients omit these fields and keep the last reported state.
    expect(data).not.toHaveProperty("phase");
    expect(data).not.toHaveProperty("attempt");
    expect(data).not.toHaveProperty("model");
  });

  it("finishes with the final phase, attempt, and model", async () => {
    const { calls } = stubSupabase();
    const response = await POST(
      post({
        op: "finish",
        id: "live-abc123def456",
        status: "completed",
        phase: " apply ",
        attempt: 3,
        model: " final-model ",
      })
    );
    expect(response.status).toBe(204);
    const data = JSON.parse(
      String(calls.find((c) => c.init.method === "PATCH")!.init.body)
    );
    expect(data).toMatchObject({ phase: "apply", attempt: 3, model: "final-model" });
  });

  it("finishes with how the run ended: outcome status and typed rule", async () => {
    const { calls } = stubSupabase();
    const response = await POST(
      post({
        op: "finish",
        id: "live-abc123def456",
        status: "failed",
        phase: "resolve",
        outcome_status: " exited ",
        error_rule: "exit:1",
      })
    );
    expect(response.status).toBe(204);
    const patches = calls.filter((c) => c.init.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0].init.body))).toMatchObject({
      status: "failed",
      phase: "resolve",
      outcome_status: "exited",
      error_rule: "exit:1",
    });
  });

  it("accepts outcome fields at their bounds and every allowed character", async () => {
    const { calls } = stubSupabase();
    const outcome = "apply_blocked_validation".padEnd(64, "x");
    const rule = `exception:Some.Error/a-b_c:${"x".repeat(160)}`.slice(0, 160);
    await POST(
      post({ op: "finish", id: "live-abc123def456", status: "failed", outcome_status: outcome, error_rule: rule })
    );
    const data = JSON.parse(String(calls.find((c) => c.init.method === "PATCH")!.init.body));
    expect(data.outcome_status).toBe(outcome);
    expect(data.error_rule).toBe(rule);
  });

  it.each([
    ["too long", "x".repeat(65), "x".repeat(161)],
    ["free text", "it broke", "Traceback (most recent call last)"],
    ["other characters", "exited;drop", "exit:1\nmore"],
    ["empty", "", "  "],
    ["not strings", 1, { rule: "exit:1" }],
  ])("drops invalid outcome fields and still finishes (%s)", async (_name, outcome_status, error_rule) => {
    const { calls } = stubSupabase();
    const response = await POST(
      post({ op: "finish", id: "live-abc123def456", status: "failed", outcome_status, error_rule })
    );
    expect(response.status).toBe(204);
    const data = JSON.parse(String(calls.find((c) => c.init.method === "PATCH")!.init.body));
    expect(data.status).toBe("failed");
    expect(data).not.toHaveProperty("outcome_status");
    expect(data).not.toHaveProperty("error_rule");
  });

  it("keeps a valid outcome field when the other is invalid", async () => {
    const { calls } = stubSupabase();
    await POST(
      post({ op: "finish", id: "live-abc123def456", status: "failed", outcome_status: "aborted", error_rule: "free text" })
    );
    const data = JSON.parse(String(calls.find((c) => c.init.method === "PATCH")!.init.body));
    expect(data.outcome_status).toBe("aborted");
    expect(data).not.toHaveProperty("error_rule");
  });

  it("takes outcome fields on finish only, never on start or heartbeat", async () => {
    const { calls } = stubSupabase();
    const outcome = { outcome_status: "aborted", error_rule: "exception:ValueError" };
    expect((await POST(post(startBody(outcome)))).status).toBe(204);
    expect((await POST(post({ op: "heartbeat", id: "live-abc123def456", ...outcome }))).status).toBe(204);
    for (const call of calls.filter((c) => c.init.body)) {
      const data = JSON.parse(String(call.init.body));
      expect(data).not.toHaveProperty("outcome_status");
      expect(data).not.toHaveProperty("error_rule");
    }
  });

  describe("before the outcome columns exist", () => {
    /** PostgREST refuses a write that names a column the table lacks. */
    function stubMissingColumns(status = 400) {
      const bodies: Array<Record<string, unknown>> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string | URL, init?: RequestInit) => {
          const data = JSON.parse(String(init?.body)) as Record<string, unknown>;
          bodies.push(data);
          if ("outcome_status" in data || "error_rule" in data) {
            return new Response(
              JSON.stringify({ code: "PGRST204", message: "Could not find the 'outcome_status' column of 'live_encoding_runs' in the schema cache" }),
              { status }
            );
          }
          return new Response(JSON.stringify([{}]), { status: 200 });
        })
      );
      return bodies;
    }
    const finish = { op: "finish", id: "live-abc123def456", status: "failed", phase: "resolve", run_id: "run-777" };

    it("writes the finish again without them, so it is not lost", async () => {
      const bodies = stubMissingColumns();
      const response = await POST(post({ ...finish, outcome_status: "exited", error_rule: "exit:1" }));
      expect(response.status).toBe(204);
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toMatchObject({ outcome_status: "exited", error_rule: "exit:1" });
      expect(bodies[1]).toMatchObject({ status: "failed", phase: "resolve", run_id: "run-777" });
      expect(bodies[1].finished_at).toBe(bodies[0].finished_at);
      expect(bodies[1]).not.toHaveProperty("outcome_status");
      expect(bodies[1]).not.toHaveProperty("error_rule");
    });

    it("writes once when the client sends neither field", async () => {
      const bodies = stubMissingColumns();
      expect((await POST(post(finish))).status).toBe(204);
      expect(bodies).toHaveLength(1);
    });

    it("does not write again after another kind of failure", async () => {
      const bodies = stubMissingColumns(500);
      const response = await POST(post({ ...finish, outcome_status: "exited" }));
      expect(response.status).toBe(502);
      expect(bodies).toHaveLength(1);
    });

    it("does not write again when a finish without the fields is refused", async () => {
      const fetchMock = vi.fn(async () => new Response("{}", { status: 400 }));
      vi.stubGlobal("fetch", fetchMock);
      expect((await POST(post(finish))).status).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it.each([0, 1001, 1.5, "2"])(
    "omits invalid finish state with attempt %s",
    async (attempt) => {
      const { calls } = stubSupabase();
      const response = await POST(
        post({
          op: "finish",
          id: "live-abc123def456",
          status: "completed",
          phase: "x".repeat(121),
          attempt,
          model: { name: "not-a-string" },
        })
      );
      expect(response.status).toBe(204);
      const data = JSON.parse(
        String(calls.find((c) => c.init.method === "PATCH")!.init.body)
      );
      expect(data).not.toHaveProperty("phase");
      expect(data).not.toHaveProperty("attempt");
      expect(data).not.toHaveProperty("model");
    }
  );

  it.each(["completed", "failed"])(
    "preserves %s state when a delayed heartbeat writes after finish",
    async (status) => {
      const row: Record<string, unknown> = {
        id: "live-abc123def456",
        status: "running",
        phase: "generate",
        attempt: 1,
        model: "initial-model",
        runner: { reported_via: "public_ingest" },
      };
      let announceHeartbeat!: () => void;
      let releaseHeartbeat!: () => void;
      const heartbeatArrived = new Promise<void>((resolve) => {
        announceHeartbeat = resolve;
      });
      const heartbeatReleased = new Promise<void>((resolve) => {
        releaseHeartbeat = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          expect(init?.method).toBe("PATCH");
          const data = JSON.parse(String(init?.body));
          if (!Object.hasOwn(data, "status")) {
            announceHeartbeat();
            await heartbeatReleased;
          }
          // Evaluate the REST predicates when the write reaches the row,
          // after any delay, just as an atomic conditional PATCH does.
          const matches = [...new URL(String(url)).searchParams].every(
            ([field, expected]) => {
              const actual =
                field === "runner->>reported_via"
                  ? (row.runner as Record<string, unknown>).reported_via
                  : row[field];
              return expected === `eq.${actual}`;
            }
          );
          if (matches) Object.assign(row, data);
          return new Response(JSON.stringify(matches ? [row] : []), {
            status: 200,
          });
        })
      );

      const heartbeat = POST(
        post({
          op: "heartbeat",
          id: row.id,
          phase: "validate",
          attempt: 2,
          model: "older-model",
        })
      );
      await heartbeatArrived;
      const finish = await POST(
        post({
          op: "finish",
          id: row.id,
          status,
          phase: "apply",
          attempt: 3,
          model: "final-model",
        })
      );
      expect(finish.status).toBe(204);
      const finishedRow = structuredClone(row);
      expect(row).toMatchObject({
        status,
        phase: "apply",
        attempt: 3,
        model: "final-model",
      });
      expect(row.finished_at).toBeTruthy();
      releaseHeartbeat();
      expect((await heartbeat).status).toBe(404);
      expect(row).toEqual(finishedRow);
    }
  );

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
