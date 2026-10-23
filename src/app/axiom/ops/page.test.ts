import { describe, expect, it, vi } from "vitest";
import AxiomOpsRedirect from "./page";

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

async function target(query: Record<string, string>): Promise<string> {
  try {
    await AxiomOpsRedirect({ searchParams: Promise.resolve(query) });
  } catch (error) {
    return (error as Error).message.replace(/^redirect:/, "");
  }
  throw new Error("no redirect");
}

describe("/axiom/ops redirect", () => {
  it("lands on /ops with its tab, old tab names mapped in one hop", async () => {
    expect(await target({})).toBe("/ops");
    expect(await target({ tab: "output" })).toBe("/ops?tab=output");
    expect(await target({ tab: "bundles", bundle: "us-az/snap" })).toBe("/ops?tab=programs&bundle=us-az%2Fsnap");
    expect(await target({ tab: "ledger", j: "us" })).toBe("/ops?j=us");
    expect(await target({ tab: "nonsense" })).toBe("/ops");
  });
});
