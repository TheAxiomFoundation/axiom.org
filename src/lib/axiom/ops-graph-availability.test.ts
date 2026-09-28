import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const proxy = vi.hoisted(() => vi.fn());
vi.mock("./runtime/api", () => ({ runtimeProxyGet: proxy }));

beforeEach(() => {
  vi.resetModules();
  proxy.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("availableGraphCitations", () => {
  it("only enables links for nonempty graphs confirmed by the serving API", async () => {
    proxy
      .mockResolvedValueOnce({
        status: 200,
        body: { status: "ok", data: { graph: { rules: [{}] } } },
      })
      .mockResolvedValueOnce({ status: 404, body: { status: "error" } })
      .mockResolvedValueOnce({
        status: 200,
        body: { status: "ok", data: { graph: { rules: [] } } },
      });
    const { availableGraphCitations } =
      await import("./ops-graph-availability");
    const citations = [
      "us:statutes/26/24",
      "de:statutes/bgb/126/absatz-1/inhalt",
      "us:statutes/26/32",
    ];
    const available = await availableGraphCitations(
      citations.map((citation) => ({ citation, has_issues: false })),
    );
    expect([...available]).toEqual([citations[0]]);
    expect(proxy).toHaveBeenCalledWith(
      "/graph/compose?focus=de%3Astatutes%2Fbgb%2F126%2Fabsatz-1%2Finhalt",
      { fresh: true },
    );
  });

  it("deduplicates checks and retries unavailable graphs after the next polling interval", async () => {
    proxy
      .mockResolvedValueOnce({ status: 404, body: {} })
      .mockResolvedValueOnce({
        status: 200,
        body: { status: "ok", data: { graph: { rules: [{}] } } },
      });
    const { availableGraphCitations } =
      await import("./ops-graph-availability");
    const run = { citation: "us:statutes/26/24", has_issues: false };
    expect((await availableGraphCitations([run, run])).size).toBe(0);
    expect((await availableGraphCitations([run])).size).toBe(0);
    expect(proxy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    expect((await availableGraphCitations([run])).has(run.citation)).toBe(true);
  });

  it("keeps telemetry usable when graph checks fail and skips failed runs", async () => {
    proxy.mockRejectedValue(new Error("offline"));
    const { availableGraphCitations } =
      await import("./ops-graph-availability");
    expect(
      (
        await availableGraphCitations([
          { citation: "us:statutes/26/24", has_issues: false },
          { citation: "us:statutes/26/32", has_issues: true },
          { citation: null, has_issues: false },
          { citation: "unparseable", has_issues: false },
        ])
      ).size,
    ).toBe(0);
    expect(proxy).toHaveBeenCalledTimes(1);
  });
});
