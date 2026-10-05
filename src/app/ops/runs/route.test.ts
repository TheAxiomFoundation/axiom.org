import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineAttempt } from "@/test/pipeline-attempt";

const getPipelineAttempts = vi.fn();
vi.mock("@/lib/axiom/encoding-pipeline-data", () => ({ getPipelineAttempts: () => getPipelineAttempts() }));
const getCitationMetadata = vi.fn(async (citations: string[]) => ({
  labels: Object.fromEntries(citations.map((citation) => [citation, `Name of ${citation}`])),
  documentPaths: {},
}));
vi.mock("@/lib/corpus-status", () => ({ getCitationMetadata: (c: string[]) => getCitationMetadata(c) }));

const { GET } = await import("./route");

afterEach(() => {
  vi.unstubAllEnvs();
  getPipelineAttempts.mockReset();
});

describe("GET /ops/runs", () => {
  it("returns a scope's runs, newest first, with their citations' names", async () => {
    getPipelineAttempts.mockResolvedValue({
      available: true,
      error: null,
      attempts: [
        pipelineAttempt({ id: "1", citation: "us/a", jurisdiction: "us", dispatched_at: "2026-09-01T00:00:00Z" }),
        pipelineAttempt({ id: "2", citation: "us-la/b", jurisdiction: "us-la", dispatched_at: "2026-09-02T00:00:00Z" }),
        pipelineAttempt({ id: "3", citation: "dk/c", jurisdiction: "dk" }),
      ],
    });
    const all = await (await GET(new Request("http://x/ops/runs?j=us"))).json();
    expect(all.rows.map((r: { id: string }) => r.id)).toEqual(["2", "1"]);
    expect(all.labels).toEqual({ "us-la/b": "Name of us-la/b", "us/a": "Name of us/a" });
    expect(all.documentPaths).toEqual({});
    const federal = await GET(new Request("http://x/ops/runs?j=us&only=1"));
    expect(federal.headers.get("Cache-Control")).toBe("no-store");
    expect((await federal.json()).rows.map((r: { id: string }) => r.id)).toEqual(["1"]);
  });

  it("is hidden in production with the section, and says when the table is unreadable", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await GET(new Request("http://x/ops/runs"))).status).toBe(404);
    vi.unstubAllEnvs();
    getPipelineAttempts.mockResolvedValue({ available: false, error: "down", attempts: [] });
    const response = await GET(new Request("http://x/ops/runs"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "down" });
    getPipelineAttempts.mockResolvedValue({ available: false, error: null, attempts: [] });
    expect(await (await GET(new Request("http://x/ops/runs"))).json()).toEqual({ error: "pipeline unavailable" });
  });
});
