import { describe, expect, it } from "vitest";
import {
  queuedSummary,
  scopeQueued,
  summarizeQueue,
  type EncodingQueueSummary,
  type QueuedSummary,
} from "./encoding-queues";

describe("summarizeQueue", () => {
  it("aggregates pending, dispositions, and jurisdictions", () => {
    expect(
      summarizeQueue({
        queue_id: "q",
        description: " All-state inventory. ",
        pause_reason: "Awaiting review.",
        supersedes: ["q-old", 3 as unknown as string],
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
      path: null,
      description: "All-state inventory.",
      paused: true,
      pauseReason: "Awaiting review.",
      pausedSince: null,
      dispatchWorkflow: null,
      total: 5,
      pending: 3,
      dispositionCounts: { completed: 1, dispatched: 1 },
      jurisdictionCount: 3,
      blockedNote: null,
      attention: [],
      notStarted: {},
      supersedes: ["q-old"],
      frozenSince: null,
      inDispatcher: null,
    });
  });

  it("lists a dispatcher queue's blocked, skipped, open, and retrying items and counts the untouched", () => {
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
        // Never dispatched and set aside: skipped, not blocked.
        { citation: "us-or/a", label: " Section A ", jurisdiction: "us-or", status: "blocked", note: "skipped for the pilot: Oregon Chapter 1", attempts: [] },
        { citation: "us-or/page-26", label: "Page 26", jurisdiction: "us-or", status: "blocked", note: "Skipped for the pilot" },
        { citation: "us-or/k", jurisdiction: "us-or", status: "skipped" },
        // Blocked without a run, for another reason: still needs a person.
        { citation: "us-or/l", jurisdiction: "us-or", status: "blocked", note: "PR closed unmerged", attempts: [] },
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
    const idle = { attempts: 0, lastAt: null, runUrl: null, prUrl: null };
    expect(summary?.attention).toEqual([
      { queueId: "pilot", citation: "us-or/a", label: "Section A", state: "skipped", why: "skipped for the pilot: Oregon Chapter 1", ...idle },
      { queueId: "pilot", citation: "us-or/page-26", label: null, state: "skipped", why: "Skipped for the pilot", ...idle },
      { queueId: "pilot", citation: "us-or/k", label: null, state: "skipped", why: null, ...idle },
      { queueId: "pilot", citation: "us-or/l", label: null, state: "blocked", why: "PR closed unmerged", ...idle },
      { queueId: "pilot", citation: "us-or/b", label: null, state: "blocked", why: "Stale cancelled: rulespec main moved", attempts: 1, lastAt: "2026-10-01T01:00:00Z", runUrl: "https://github.com/x/runs/1", prUrl: null },
      { queueId: "pilot", citation: "us-or/h", label: null, state: "blocked", why: "failed 2 times; last at Encode step", attempts: 1, lastAt: "2026-10-01T05:00:00Z", runUrl: "https://github.com/x/runs/5", prUrl: null },
      { queueId: "pilot", citation: "us-ut/c", label: null, state: "dispatched", why: null, attempts: 1, lastAt: "2026-10-01T02:00:00Z", runUrl: "https://github.com/x/runs/2", prUrl: null },
      { queueId: "pilot", citation: "us-ut/d", label: null, state: "retrying", why: "Failed at Encode, review, validate, and apply", attempts: 1, lastAt: "2026-10-01T03:00:00Z", runUrl: "https://github.com/x/runs/3", prUrl: null },
      { queueId: "pilot", citation: "us-ut/i", label: null, state: "retrying", why: "Failed", attempts: 1, lastAt: "2026-10-01T06:00:00Z", runUrl: "https://github.com/x/runs/6", prUrl: null },
      { queueId: "pilot", citation: "us-ut/j", label: null, state: "retrying", why: "Lost", attempts: 1, lastAt: "2026-10-01T07:00:00Z", runUrl: "https://github.com/x/runs/7", prUrl: null },
    ]);
    expect(summary?.notStarted).toEqual({ "us-or": 1, other: 1 });
    expect(summary?.dispositionCounts).toEqual({ skipped: 3, blocked: 4, dispatched: 1, in_review: 1 });
    expect(summary?.pending).toBe(5);
    // The note names the step alone, as each item does.
    expect(summary?.blockedNote).toEqual({ note: "PR closed unmerged", count: 1 });
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

  it("reads a dispatcher queue's kind and paused state, and counts skips apart from blocked notes", () => {
    const dispatcher = {
      schema: "axiom-encode/snap-dispatch-queue/v1",
      queue_id: "us-snap-or-ut-pilot",
      updated_at: "2026-10-01T15:17:36Z",
      items: [{ status: "pending" }, { status: "blocked" }, { status: "dispatched" }],
    };
    expect(summarizeQueue({ ...dispatcher, state: "active" })).toMatchObject({
      kind: "dispatcher",
      paused: false,
      pauseReason: null,
      pausedSince: null,
      dispositionCounts: { blocked: 1, dispatched: 1 },
      blockedNote: null,
    });
    const tried = [{ dispatched_at: "2026-10-01T00:00:00Z", result: "failure" }];
    expect(
      summarizeQueue({
        ...dispatcher,
        items: [
          { status: "blocked", note: "skipped for the pilot" },
          { status: "blocked", note: " skipped for the pilot " },
          { status: "blocked", note: "failed 2 times; last at Queue job: Encode step", attempts: tried },
          { status: "blocked", note: "failed 2 times; last at Other job: Encode step", attempts: tried },
          { status: "blocked", note: "budget used up", attempts: tried },
          { status: "pending", note: "ignored" },
        ],
      })
    ).toMatchObject({
      dispositionCounts: { skipped: 2, blocked: 3 },
      blockedNote: { note: "failed 2 times; last at Encode step", count: 2 },
    });
    // A paused queue that states no reason is paused, without a made-up one.
    expect(summarizeQueue({ ...dispatcher, state: "paused" })).toMatchObject({
      paused: true,
      pauseReason: null,
      pausedSince: "2026-10-01T15:17:36Z",
    });
    expect(summarizeQueue({ ...dispatcher, state: "paused", pause_reason: "Rulespec main moved." })).toMatchObject({
      paused: true,
      pauseReason: "Rulespec main moved.",
    });
    // An inventory's own state says nothing about dispatch.
    expect(summarizeQueue({ queue_id: "q", state: "paused", items: [{ status: "blocked", note: "skipped" }] })).toMatchObject({
      kind: "legacy",
      paused: false,
      pauseReason: null,
      dispositionCounts: { blocked: 1 },
    });
  });

  it("treats a blank pause reason as active", () => {
    expect(
      summarizeQueue({
        queue_id: "q",
        pause_reason: "  ",
        items: [{ status: "pending" }],
      })
    ).toMatchObject({ paused: false, pauseReason: null });
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
    path: null,
    description: null,
    paused: pauseReason !== null,
    pauseReason,
    pausedSince: null,
    dispatchWorkflow: null,
    total: pending,
    pending,
    dispositionCounts,
    jurisdictionCount: 1,
    blockedNote: null,
    attention: [],
    notStarted: {},
    supersedes: [],
    frozenSince: null,
    inDispatcher: null,
  });

  it("sums pending items and reports a pause only when every queue is paused", () => {
    expect(queuedSummary([])).toBeNull();
    expect(queuedSummary([queue(3, "Awaiting a tip."), queue(4, "Other.")])).toEqual({
      pending: 7,
      queues: 2,
      inFlight: 0,
      blocked: 0,
      skipped: 0,
      blockedNote: null,
      paused: true,
      pausedReason: "Awaiting a tip.",
      pausedSince: null,
      dispatchDisabled: false,
      items: [],
      notStarted: [],
    });
    expect(queuedSummary([queue(3, "Awaiting a tip."), queue(4, null)])).toMatchObject({ paused: false, pausedReason: null });
  });

  it("counts only dispatcher queues once one exists, skips apart from blocked", () => {
    expect(
      queuedSummary([
        queue(935, null, "dispatcher", { blocked: 1, skipped: 19, dispatched: 1, in_review: 2 }),
        queue(17784, "Awaiting a tip."),
      ])
    ).toMatchObject({ pending: 935, queues: 1, inFlight: 1, blocked: 1, skipped: 19, blockedNote: null, paused: false });
    const noted = (note: string, count: number) => ({
      ...queue(1, null, "dispatcher", { blocked: count }),
      blockedNote: { note, count },
    });
    expect(queuedSummary([noted("a", 2), noted("b", 5)])?.blockedNote).toEqual({ note: "b", count: 5 });
  });

  it("says how long the queues have been paused and whether the dispatch workflow is disabled", () => {
    const paused = (since: string, workflow: string | null): EncodingQueueSummary => ({
      ...queue(5, null, "dispatcher"),
      paused: true,
      pausedSince: since,
      dispatchWorkflow: workflow ? { state: workflow, url: "https://github.com/w" } : null,
    });
    expect(
      queuedSummary([paused("2026-10-01T15:17:36Z", "disabled_manually"), paused("2026-10-02T00:00:00Z", "disabled_manually")])
    ).toMatchObject({ paused: true, pausedReason: null, pausedSince: "2026-10-02T00:00:00Z", dispatchDisabled: true });
    expect(queuedSummary([paused("2026-10-01T15:17:36Z", "active")])).toMatchObject({ dispatchDisabled: false });
    // A disabled workflow is worth saying even while the queue is active.
    expect(queuedSummary([{ ...paused("x", "disabled_manually"), paused: false }])).toMatchObject({
      paused: false,
      pausedSince: null,
      dispatchDisabled: true,
    });
  });

  it("orders items blocked, open, retrying, skipped, oldest first, and sums untouched items by jurisdiction", () => {
    const item = (citation: string, state: "blocked" | "skipped" | "dispatched" | "retrying", lastAt: string | null) => ({
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
      {
        ...queue(5, null, "dispatcher"),
        attention: [item("s", "skipped", null), item("r", "retrying", "2026-10-01"), item("b2", "blocked", "2026-09-30")],
        notStarted: { "us-or": 3, "us-ut": 1 },
      },
      { ...queue(5, null, "dispatcher"), attention: [item("d", "dispatched", "2026-10-01"), item("b1", "blocked", null)], notStarted: { "us-ut": 4 } },
    ]);
    expect(summary?.items.map((i) => i.citation)).toEqual(["b1", "b2", "d", "r", "s"]);
    expect(summary?.notStarted).toEqual([
      { jurisdiction: "us-ut", count: 5 },
      { jurisdiction: "us-or", count: 3 },
    ]);
  });
});

describe("scopeQueued", () => {
  const item = (citation: string, state: "blocked" | "skipped" | "dispatched" | "retrying", why: string | null = null) => ({
    queueId: "q",
    citation,
    label: null,
    state,
    why,
    attempts: 1,
    lastAt: null,
    runUrl: null,
    prUrl: null,
  });
  const queued: QueuedSummary = {
    pending: 950,
    queues: 1,
    inFlight: 1,
    blocked: 3,
    skipped: 2,
    blockedNote: { note: "failed twice", count: 2 },
    paused: true,
    pausedReason: null,
    pausedSince: "2026-10-01T15:17:36Z",
    dispatchDisabled: true,
    items: [
      item("us-or/a", "skipped", "skipped"),
      item("us-or/b", "skipped", "skipped"),
      item("us-or/x", "blocked", "failed twice"),
      item("us-ut/c", "blocked", "failed twice"),
      item("us-ut/d", "dispatched"),
      item("us-ut/e", "retrying"),
      item("us-ut/f", "blocked"),
    ],
    notStarted: [
      { jurisdiction: "us-or", count: 561 },
      { jurisdiction: "us-ut", count: 371 },
    ],
  };

  it("recounts the queue from the items one scope keeps", () => {
    expect(scopeQueued(null, () => true)).toBeNull();
    expect(scopeQueued(queued, (j) => j === "us-ut")).toEqual({
      ...queued,
      pending: 372,
      inFlight: 1,
      blocked: 2,
      skipped: 0,
      blockedNote: { note: "failed twice", count: 1 },
      items: queued.items.slice(3),
      notStarted: [{ jurisdiction: "us-ut", count: 371 }],
    });
    expect(scopeQueued(queued, (j) => j === "us-or")).toMatchObject({ skipped: 2, blocked: 1 });
    expect(scopeQueued(queued, (j) => j === "dk")).toMatchObject({
      pending: 0,
      blocked: 0,
      skipped: 0,
      blockedNote: null,
      paused: true,
      pausedSince: "2026-10-01T15:17:36Z",
    });
  });
});
