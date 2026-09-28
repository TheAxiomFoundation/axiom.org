import { describe, expect, it } from "vitest";
import { summarizeQueue } from "./encoding-queues";

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
