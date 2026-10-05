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

  const composed = { status: 200, body: { status: "ok", data: { graph: { rules: [{}] } } } };
  const run = { citation: "us:statutes/26/24", has_issues: false };

  it("keeps an available graph for ten minutes of polls", async () => {
    proxy.mockResolvedValue(composed);
    const { availableGraphCitations } = await import("./ops-graph-availability");
    expect((await availableGraphCitations([run])).has(run.citation)).toBe(true);
    // Nineteen more polls at the dashboard's 30-second interval.
    for (let poll = 0; poll < 19; poll += 1) {
      vi.advanceTimersByTime(30_000);
      expect((await availableGraphCitations([run])).has(run.citation)).toBe(true);
    }
    expect(proxy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await availableGraphCitations([run]);
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("re-asks about a not-yet-composable graph after three minutes, so a newly synced one shows soon", async () => {
    proxy.mockResolvedValueOnce({ status: 404, body: {} }).mockResolvedValueOnce(composed);
    const { availableGraphCitations } = await import("./ops-graph-availability");
    expect((await availableGraphCitations([run, run])).size).toBe(0);
    for (let poll = 0; poll < 5; poll += 1) {
      vi.advanceTimersByTime(30_000);
      expect((await availableGraphCitations([run])).size).toBe(0);
    }
    expect(proxy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    expect((await availableGraphCitations([run])).has(run.citation)).toBe(true);
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("keeps a composed-but-empty graph as not yet composable (three minutes)", async () => {
    proxy
      .mockResolvedValueOnce({ status: 200, body: { status: "ok", data: { graph: { rules: [] } } } })
      .mockResolvedValueOnce(composed);
    const { availableGraphCitations } = await import("./ops-graph-availability");
    expect((await availableGraphCitations([run])).size).toBe(0);
    vi.advanceTimersByTime(3 * 60_000 - 1);
    await availableGraphCitations([run]);
    expect(proxy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    expect((await availableGraphCitations([run])).has(run.citation)).toBe(true);
  });

  it.each([
    [400, 3 * 60_000],
    [422, 3 * 60_000],
    [429, 60_000],
    [502, 60_000],
  ])("keeps a %s answer for %d ms", async (status, keepMs) => {
    proxy.mockResolvedValueOnce({ status, body: {} }).mockResolvedValueOnce(composed);
    const { availableGraphCitations } = await import("./ops-graph-availability");
    await availableGraphCitations([run]);
    vi.advanceTimersByTime(keepMs - 1);
    await availableGraphCitations([run]);
    expect(proxy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await availableGraphCitations([run]);
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("retries a failed check after a minute", async () => {
    proxy.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(composed);
    const { availableGraphCitations } = await import("./ops-graph-availability");
    expect((await availableGraphCitations([run])).size).toBe(0);
    vi.advanceTimersByTime(60_001);
    expect((await availableGraphCitations([run])).has(run.citation)).toBe(true);
  });

  it("shares a check that is still in flight", async () => {
    let answer!: (value: unknown) => void;
    proxy.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { availableGraphCitations } = await import("./ops-graph-availability");
    const first = availableGraphCitations([run]);
    const second = availableGraphCitations([run]);
    answer(composed);
    expect((await first).has(run.citation)).toBe(true);
    expect((await second).has(run.citation)).toBe(true);
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it("counts the keep time from when the answer arrives, not when it was asked", async () => {
    let answer!: (value: unknown) => void;
    proxy.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; })).mockResolvedValue(composed);
    const { availableGraphCitations } = await import("./ops-graph-availability");
    const slow = availableGraphCitations([run]);
    vi.advanceTimersByTime(9 * 60_000); // a very slow first answer
    answer(composed);
    await slow;
    vi.advanceTimersByTime(9 * 60_000); // 18 min after asking, 9 after answering
    await availableGraphCitations([run]);
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest focus when a new one arrives at the cap", async () => {
    proxy.mockResolvedValue(composed);
    const { availableGraphCitations } = await import("./ops-graph-availability");
    const cite = (n: number) => ({ citation: `us:statutes/26/${n}`, has_issues: false });
    for (let n = 1; n <= 200; n += 1) await availableGraphCitations([cite(n)]);
    await availableGraphCitations([cite(201)]);
    proxy.mockClear();
    await availableGraphCitations([cite(200)]);
    expect(proxy).not.toHaveBeenCalled(); // the newest is still held
    await availableGraphCitations([cite(1)]);
    expect(proxy).toHaveBeenCalledTimes(1); // the oldest was pushed out
  });

  it("re-checking a held focus never pushes another one out", async () => {
    // Map order: F0 (kept 10 min), B (not composable: kept 3 min), then 198
    // more composable foci — 200 in all, the cap.
    const cite = (n: number) => ({ citation: `us:statutes/26/${n}`, has_issues: false });
    proxy.mockImplementation(async (path: string) =>
      path.endsWith(encodeURIComponent("us:statutes/26/2")) ? { status: 404, body: {} } : composed,
    );
    const { availableGraphCitations } = await import("./ops-graph-availability");
    await availableGraphCitations([cite(1)]);
    await availableGraphCitations([cite(2)]);
    await availableGraphCitations(Array.from({ length: 198 }, (_, index) => cite(index + 3)));
    expect(proxy).toHaveBeenCalledTimes(200);
    // B expires first and is re-checked while the map is full.
    vi.advanceTimersByTime(3 * 60_000 + 1);
    await availableGraphCitations([cite(2)]);
    expect(proxy).toHaveBeenCalledTimes(201);
    // F0 is still held: the re-check replaced B in place of evicting F0.
    await availableGraphCitations([cite(1)]);
    expect(proxy).toHaveBeenCalledTimes(201);
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
