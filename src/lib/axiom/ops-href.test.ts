import { describe, expect, it } from "vitest";
import { LEGACY_OPS_TABS, opsHref } from "./ops-href";

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
