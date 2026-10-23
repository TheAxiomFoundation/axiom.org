import { describe, expect, it } from "vitest";
import { busiestRoots, LEGACY_OPS_TABS, opsHref, sharedOpsParams } from "./ops-href";

describe("opsHref", () => {
  it("puts the tab first and keeps every other parameter", () => {
    expect(opsHref({ tab: "bundles", bundle: "us-az/snap", count: "provisions" }, LEGACY_OPS_TABS.bundles)).toBe(
      "/ops?tab=programs&bundle=us-az%2Fsnap&count=provisions"
    );
    expect(opsHref({ tab: "pipeline", j: "us" }, LEGACY_OPS_TABS.pipeline)).toBe("/ops?tab=line&j=us");
    expect(opsHref({ tab: "ledger" }, LEGACY_OPS_TABS.ledger)).toBe("/ops");
    expect(opsHref({ tab: "ledger", j: ["us", "ca"], x: undefined }, "now")).toBe("/ops?j=us&j=ca");
  });
});

describe("sharedOpsParams", () => {
  it("keeps only the scope and the window, first value of each", () => {
    expect(sharedOpsParams({ tab: "line", j: ["us", "ca"], window: "7", station: "validate", only: "1" })).toEqual({ j: "us", only: "1", window: "7" });
    expect(sharedOpsParams({})).toEqual({});
  });
});

describe("busiestRoots", () => {
  it("counts by root jurisdiction, most first, ties by name, up to the limit", () => {
    expect(busiestRoots(["us-co", "us", "dk", null, "ca", "ca-on", "be"], 3)).toEqual(["ca", "us", "be"]);
  });
});
