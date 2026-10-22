import { describe, expect, it, vi } from "vitest";
import OpsFlowRedirect from "./page";

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

async function target(query: Record<string, string>): Promise<string> {
  try {
    await OpsFlowRedirect({ searchParams: Promise.resolve(query) });
  } catch (error) {
    return (error as Error).message.replace(/^redirect:/, "");
  }
  throw new Error("no redirect");
}

describe("/ops/flow redirect", () => {
  it("keeps the window it names, the default one too, and every line parameter", async () => {
    expect(await target({ window: "30", j: "us" })).toBe("/ops?tab=line&window=30&j=us");
    expect(await target({ window: "7", j: "us-co", pop: "runs", station: "validate" })).toBe("/ops?tab=line&window=7&j=us-co&pop=runs&station=validate");
    expect(await target({ window: "90", view: "discovery" })).toBe("/ops?tab=line&window=90&view=discovery");
    expect(await target({})).toBe("/ops?tab=line");
  });

  it("sends a citation or a run to the journey, and programs to the Programs tab", async () => {
    expect(await target({ window: "90", citation: "us/statute/7/2015/f", case: "123" })).toBe("/ops/journey?citation=us%2Fstatute%2F7%2F2015%2Ff&case=123");
    expect(await target({ view: "programs", program: "snap" })).toBe("/ops?tab=programs&program=snap");
    expect(await target({ bundle: "us-or/snap" })).toBe("/ops?tab=programs&bundle=us-or%2Fsnap");
  });
});
