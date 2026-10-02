import { describe, expect, it } from "vitest";
import {
  queuedSummary,
  summarizeQueue,
  type EncodingQueueSummary,
} from "./encoding-queues";

describe("summarizeQueue", () => {
  it("aggregates pending, dispositions, and jurisdictions", () => {
    expect(
      summarizeQueue({
        queue_id: "q",
        description: " All-state inventory. ",
        pause_reason: "Awaiting review.",
        items: [
          { status: "pending", jurisdiction: "us-ak" },
          { status: "pending", jurisdiction: "us-al" },
          { status: "completed", jurisdiction: "us-ak" },
          { status: "dispatched", jurisdiction: "us-co" },
          { jurisdiction: "us-co" },
        ],
      })
    ).toEqual({
      queueId: "q",
      kind: "legacy",
      description: "All-state inventory.",
      pauseReason: "Awaiting review.",
      total: 5,
      pending: 3,
      dispositionCounts: { completed: 1, dispatched: 1 },
      jurisdictionCount: 3,
      blockedNote: null,
      attention: [],
      notStarted: {},
    });
  });

  it("lists a dispatcher queue's blocked, open, and retrying items and counts the untouched", () => {
    const run = (n: number, result?: string, note?: string) => ({
      dispatched_at: `2026-10-01T0${n}:00:00Z`,
      run_url: `https://github.com/x/runs/${n}`,
      ...(result ? { result } : {}),
      ...(note ? { note } : {}),
    });
    const summary = summarizeQueue({
      schema: "axiom-encode/snap-dispatch-queue/v1",
      queue_id: "pilot",
      items: [
        { citation: "us-or/a", label: " Section A ", jurisdiction: "us-or", status: "blocked", note: "skipped for the pilot: Oregon Chapter 1", attempts: [] },
        { citation: "us-or/page-26", label: "Page 26", jurisdiction: "us-or", status: "blocked", note: "skipped for the pilot", attempts: [] },
        { citation: "us-or/b", jurisdiction: "us-or", status: "blocked", attempts: [run(1, "stale-cancelled", "rulespec main moved")] },
        { citation: "us-or/h", jurisdiction: "us-or", status: "blocked", note: "failed 2 times; last at Queue job: Encode step", attempts: [run(5, "failure")] },
        { citation: "us-ut/c", jurisdiction: "us-ut", status: "dispatched", attempts: [run(2)] },
        { citation: "us-ut/d", jurisdiction: "us-ut", status: "pending", attempts: [run(3, "failure", "Queue job: Encode, review, validate, and apply")] },
        { citation: "us-ut/i", jurisdiction: "us-ut", status: "pending", attempts: [run(6, "timed_out")] },
        { citation: "us-ut/j", jurisdiction: "us-ut", status: "pending", attempts: [run(7, "lost")] },
        { citation: "us-ut/e", jurisdiction: "us-ut", status: "in_review", attempts: [run(4, "success")], pr: { url: "https://github.com/x/pull/1" } },
        { citation: "us-or/f", jurisdiction: "us-or", status: "pending" },
        { citation: "us-or/g", status: "pending", attempts: [] },
        { status: "blocked" },
      ],
    });
    expect(summary?.attention).toEqual([
      { queueId: "pilot", citation: "us-or/a", label: "Section A", state: "blocked", why: "skipped for the pilot: Oregon Chapter 1", attempts: 0, lastAt: null, runUrl: null, prUrl: null },
      { queueId: "pilot", citation: "us-or/page-26", label: null, state: "blocked", why: "skipped for the pilot", attempts: 0, lastAt: null, runUrl: null, prUrl: null },
      { queueId: "pilot", citation: "us-or/b", label: null, state: "blocked", why: "Stale cancelled: rulespec main moved", attempts: 1, lastAt: "2026-10-01T01:00:00Z", runUrl: "https://github.com/x/runs/1", prUrl: null },
      { queueId: "pilot", citation: "us-or/h", label: null, state: "blocked", why: "failed 2 times; last at Encode step", attempts: 1, lastAt: "2026-10-01T05:00:00Z", runUrl: "https://github.com/x/runs/5", prUrl: null },
      { queueId: "pilot", citation: "us-ut/c", label: null, state: "dispatched", why: null, attempts: 1, lastAt: "2026-10-01T02:00:00Z", runUrl: "https://github.com/x/runs/2", prUrl: null },
      { queueId: "pilot", citation: "us-ut/d", label: null, state: "retrying", why: "Failed at Encode, review, validate, and apply", attempts: 1, lastAt: "2026-10-01T03:00:00Z", runUrl: "https://github.com/x/runs/3", prUrl: null },
      { queueId: "pilot", citation: "us-ut/i", label: null, state: "retrying", why: "Failed", attempts: 1, lastAt: "2026-10-01T06:00:00Z", runUrl: "https://github.com/x/runs/6", prUrl: null },
      { queueId: "pilot", citation: "us-ut/j", label: null, state: "retrying", why: "Lost", attempts: 1, lastAt: "2026-10-01T07:00:00Z", runUrl: "https://github.com/x/runs/7", prUrl: null },
    ]);
    expect(summary?.notStarted).toEqual({ "us-or": 1, other: 1 });
  });

  it("lists at most 100 items of each state per queue", () => {
    const summary = summarizeQueue({
      schema: "axiom-encode/snap-dispatch-queue/v1",
      queue_id: "big",
      items: Array.from({ length: 120 }, (_, i) => ({ citation: `us/${i}`, status: "blocked" })),
    });
    expect(summary?.attention).toHaveLength(100);
    expect(summary?.dispositionCounts.blocked).toBe(120);
  });

  it("returns null for empty or unidentified queues", () => {
    expect(summarizeQueue({ items: [{ status: "pending" }] })).toBeNull();
    expect(summarizeQueue({ queue_id: "q", items: [] })).toBeNull();
    expect(summarizeQueue({ queue_id: "q" })).toBeNull();
  });

  it("reads a dispatcher queue's kind and paused state", () => {
    const dispatcher = {
      schema: "axiom-encode/snap-dispatch-queue/v1",
      queue_id: "us-snap-or-ut-pilot",
      items: [{ status: "pending" }, { status: "blocked" }, { status: "dispatched" }],
    };
    expect(summarizeQueue({ ...dispatcher, state: "active" })).toMatchObject({
      kind: "dispatcher",
      pauseReason: null,
      dispositionCounts: { blocked: 1, dispatched: 1 },
      blockedNote: null,
    });
    expect(
      summarizeQueue({
        ...dispatcher,
        items: [
          { status: "blocked", note: "skipped for the pilot" },
          { status: "blocked", note: " skipped for the pilot " },
          { status: "blocked", note: "failed twice" },
          { status: "pending", note: "ignored" },
        ],
      })?.blockedNote
    ).toEqual({ note: "skipped for the pilot", count: 2 });
    expect(summarizeQueue({ ...dispatcher, state: "paused" })?.pauseReason).toBe("Paused");
    expect(summarizeQueue({ queue_id: "q", state: "paused", items: [{}] })).toMatchObject({
      kind: "legacy",
      pauseReason: null,
    });
  });

  it("treats a blank pause reason as active", () => {
    expect(
      summarizeQueue({
        queue_id: "q",
        pause_reason: "  ",
        items: [{ status: "pending" }],
      })?.pauseReason
    ).toBeNull();
  });
});

describe("queuedSummary", () => {
  const queue = (
    pending: number,
    pauseReason: string | null,
    kind: EncodingQueueSummary["kind"] = "legacy",
    dispositionCounts: Record<string, number> = {}
  ): EncodingQueueSummary => ({
    queueId: `q-${pending}`,
    kind,
    description: null,
    pauseReason,
    total: pending,
    pending,
    dispositionCounts,
    jurisdictionCount: 1,
    blockedNote: null,
    attention: [],
    notStarted: {},
  });

  it("sums pending items and reports a pause only when every queue is paused", () => {
    expect(queuedSummary([])).toBeNull();
    expect(queuedSummary([queue(3, "Awaiting a tip."), queue(4, "Other.")])).toEqual({
      pending: 7,
      queues: 2,
      inFlight: 0,
      blocked: 0,
      blockedNote: null,
      pausedReason: "Awaiting a tip.",
      items: [],
      notStarted: [],
    });
    expect(queuedSummary([queue(3, "Awaiting a tip."), queue(4, null)])?.pausedReason).toBeNull();
  });

  it("counts only dispatcher queues once one exists", () => {
    expect(
      queuedSummary([
        queue(935, null, "dispatcher", { blocked: 19, dispatched: 1, in_review: 2 }),
        queue(17784, "Awaiting a tip."),
      ])
    ).toMatchObject({ pending: 935, queues: 1, inFlight: 1, blocked: 19, blockedNote: null, pausedReason: null });
    const noted = (note: string, count: number) => ({
      ...queue(1, null, "dispatcher", { blocked: count }),
      blockedNote: { note, count },
    });
    expect(queuedSummary([noted("a", 2), noted("b", 5)])?.blockedNote).toEqual({ note: "b", count: 5 });
  });

  it("orders items blocked, open, retrying, oldest first, and sums untouched items by jurisdiction", () => {
    const item = (citation: string, state: "blocked" | "dispatched" | "retrying", lastAt: string | null) => ({
      queueId: "q",
      citation,
      label: null,
      state,
      why: null,
      attempts: 1,
      lastAt,
      runUrl: null,
      prUrl: null,
    });
    const summary = queuedSummary([
      { ...queue(5, null, "dispatcher"), attention: [item("r", "retrying", "2026-10-01"), item("b2", "blocked", "2026-09-30")], notStarted: { "us-or": 3, "us-ut": 1 } },
      { ...queue(5, null, "dispatcher"), attention: [item("d", "dispatched", "2026-10-01"), item("b1", "blocked", null)], notStarted: { "us-ut": 4 } },
    ]);
    expect(summary?.items.map((i) => i.citation)).toEqual(["b1", "b2", "d", "r"]);
    expect(summary?.notStarted).toEqual([
      { jurisdiction: "us-ut", count: 5 },
      { jurisdiction: "us-or", count: 3 },
    ]);
  });
});
