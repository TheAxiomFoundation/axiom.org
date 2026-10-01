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
    });
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
    });
    expect(queuedSummary([queue(3, "Awaiting a tip."), queue(4, null)])?.pausedReason).toBeNull();
  });

  it("counts only dispatcher queues once one exists", () => {
    expect(
      queuedSummary([
        queue(935, null, "dispatcher", { blocked: 19, dispatched: 1, in_review: 2 }),
        queue(17784, "Awaiting a tip."),
      ])
    ).toEqual({ pending: 935, queues: 1, inFlight: 1, blocked: 19, blockedNote: null, pausedReason: null });
    const noted = (note: string, count: number) => ({
      ...queue(1, null, "dispatcher", { blocked: count }),
      blockedNote: { note, count },
    });
    expect(queuedSummary([noted("a", 2), noted("b", 5)])?.blockedNote).toEqual({ note: "b", count: 5 });
  });
});
