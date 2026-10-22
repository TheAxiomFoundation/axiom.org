import { describe, expect, it, vi } from "vitest";
import { mergedAttempt } from "@/test/pipeline-attempt";
import { attemptEvents, type PipelineEvent } from "./pipeline-events";
import { eventDeadlines, loadAccepted, parseWindow } from "./pipeline-flow-data";
import { getBundleIndex } from "./program-bundles-data";

vi.mock("./program-bundles-data", () => ({ getBundleIndex: vi.fn() }));

const NOW = Date.parse("2026-10-21T00:00:00Z");

function ev(overrides: Partial<PipelineEvent>): PipelineEvent {
  return {
    id: "x",
    case_id: "c",
    citation: "us/a",
    jurisdiction: "us",
    station: "tests",
    kind: "wait",
    at: "2026-10-21T00:00:00Z",
    duration_ms: null,
    outcome: null,
    try_no: null,
    rule_id: null,
    message: null,
    actor: null,
    cost_usd: null,
    encoder_version: null,
    source: "pipeline_attempts",
    ref_url: null,
    attrs: {},
    ...overrides,
  };
}

describe("parseWindow", () => {
  it("takes 7, 30 or 90 days and falls back to 30", () => {
    expect(parseWindow("7")).toBe(7);
    expect(parseWindow(["90"])).toBe(90);
    expect(parseWindow("12")).toBe(30);
    expect(parseWindow(undefined)).toBe(30);
  });
});

describe("eventDeadlines", () => {
  it("groups waivers by repo and expiry, and dates the first failure bundles to expire", () => {
    const deadlines = eventDeadlines(
      [
        ev({ id: "w1", case_id: "waiver:rulespec-us/a", source: "waiver_ledger", attrs: { expires_at: "2026-12-21", repo: "rulespec-us" } }),
        ev({ id: "w2", case_id: "waiver:rulespec-us/b", source: "waiver_ledger", attrs: { expires_at: "2026-12-21", repo: "rulespec-us" } }),
        ev({ id: "b1", case_id: "1", source: "failure_bundle", kind: "issue", attrs: { bundle_expires_at: "2026-11-02T03:00:00Z" } }),
        ev({ id: "b2", case_id: "2", source: "failure_bundle", kind: "issue", attrs: { bundle_expires_at: "2026-11-05T03:00:00Z" } }),
        ev({ id: "b3", case_id: "3", source: "failure_bundle", kind: "issue", attrs: { bundle_expires_at: "2026-10-01T03:00:00Z" } }),
      ],
      NOW
    );
    expect(deadlines).toEqual([
      expect.objectContaining({ label: "2 rulespec-us validation waivers expire", at: "2026-12-21T00:00:00.000Z" }),
      expect.objectContaining({ label: "2 failure bundles start to expire on GitHub (archive them)", at: "2026-11-02T03:00:00.000Z" }),
    ]);
  });
});

describe("loadAccepted", () => {
  const events = attemptEvents(
    mergedAttempt({ index_status: "indexed", synced_at: "2026-09-21T10:00:00Z", compile_status: "ok", compile_checked_at: "2026-09-22T03:00:00Z", tests_status: "pass" })
  );

  it("looks up the programs of untagged accepted modules in the bundle tables", async () => {
    vi.mocked(getBundleIndex).mockResolvedValueOnce([
      { bundle_id: "us/snap", bundle_title: "SNAP", tier: "full", tier_index: 2, tier_title: "Full", document: "7 USC 2017", citation_path: "us/statute/7/2017" },
    ]);
    const accepted = await loadAccepted(events, NOW);
    expect(getBundleIndex).toHaveBeenCalledWith(["us/statute/7/2017/a"]);
    expect(accepted.modules[0].programs).toEqual(["snap"]);
    expect(accepted.totals.programs).toEqual({ snap: { pipeline: 1, hand: 0 } });
  });

  it("keeps them untagged when the lookup finds nothing", async () => {
    vi.mocked(getBundleIndex).mockResolvedValueOnce([]);
    expect((await loadAccepted(events, NOW)).programs).toEqual(["untagged"]);
  });
});
