import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPipelineAttempts } from "./encoding-pipeline-data";
import { pipelineAttempt } from "@/test/pipeline-attempt";

function jsonResponse(value: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => value } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubSupabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
}

describe("getPipelineAttempts", () => {
  it("reads a collector dry run in development", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
    const file = join(dir, "pipeline.json");
    writeFileSync(file, JSON.stringify([pipelineAttempt()]));
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AXIOM_OPS_PIPELINE_FILE", file);
    const result = await getPipelineAttempts();
    expect(result).toMatchObject({ available: true, error: null });
    expect(result.attempts).toHaveLength(1);

    vi.stubEnv("AXIOM_OPS_PIPELINE_FILE", join(dir, "missing.json"));
    const missing = await getPipelineAttempts();
    expect(missing.available).toBe(false);
    expect(missing.error).toMatch(/ENOENT/);
  });

  it("is unavailable without Supabase configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await getPipelineAttempts()).toEqual({ attempts: [], available: false, error: null });
  });

  it("pages through the table newest first", async () => {
    stubSupabase();
    const page = Array.from({ length: 1000 }, (_, i) => pipelineAttempt({ id: String(i) }));
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      jsonResponse(new URL(String(url)).searchParams.get("offset") === "0" ? page : [pipelineAttempt({ id: "last" })])
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await getPipelineAttempts();
    expect(result.attempts).toHaveLength(1001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    expect(first.pathname).toBe("/rest/v1/pipeline_attempts");
    expect(first.searchParams.get("order")).toBe("dispatched_at.desc,id.desc");
  });

  it("treats a missing table as not available yet and reports other failures", async () => {
    stubSupabase();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "not found" }, 404)));
    expect(await getPipelineAttempts()).toEqual({ attempts: [], available: false, error: null });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    const failed = await getPipelineAttempts();
    expect(failed.available).toBe(false);
    expect(failed.error).toMatch(/500/);

    vi.stubGlobal("fetch", vi.fn(async () => { throw "offline"; }));
    expect((await getPipelineAttempts()).error).toBe("offline");
  });
});
