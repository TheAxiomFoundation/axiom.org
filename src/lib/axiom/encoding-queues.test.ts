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
      description: "All-state inventory.",
      pauseReason: "Awaiting review.",
      total: 5,
      pending: 3,
      dispositionCounts: { completed: 1, dispatched: 1 },
      jurisdictionCount: 3,
    });
  });

  it("returns null for empty or unidentified queues", () => {
    expect(summarizeQueue({ items: [{ status: "pending" }] })).toBeNull();
    expect(summarizeQueue({ queue_id: "q", items: [] })).toBeNull();
    expect(summarizeQueue({ queue_id: "q" })).toBeNull();
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
  const queue = (pending: number, pauseReason: string | null): EncodingQueueSummary => ({
    queueId: `q-${pending}`,
    description: null,
    pauseReason,
    total: pending,
    pending,
    dispositionCounts: {},
    jurisdictionCount: 1,
  });

  it("sums pending items and reports a pause only when every queue is paused", () => {
    expect(queuedSummary([])).toBeNull();
    expect(queuedSummary([queue(3, "Awaiting a tip."), queue(4, "Other.")])).toEqual({
      pending: 7,
      queues: 2,
      pausedReason: "Awaiting a tip.",
    });
    expect(queuedSummary([queue(3, "Awaiting a tip."), queue(4, null)])?.pausedReason).toBeNull();
  });
});
