import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mergedAttempt } from "@/test/pipeline-attempt";
import { attemptEvents, type PipelineEvent } from "@/lib/axiom/pipeline-events";
import { Waivers } from "./waivers";

const NOW = Date.parse("2026-10-08T00:00:00Z");
const ok = { index_status: "indexed" as const, synced_at: "2026-09-21T10:00:00Z", compile_status: "ok", compile_checked_at: "2026-09-22T03:00:00Z", tests_status: "pass" as const };
const events = attemptEvents(mergedAttempt(ok));

describe("Waivers", () => {
  const waiver = (repo: string, expires: string): PipelineEvent => ({
    ...events[0],
    id: `waiver:${repo}/${expires}`,
    source: "waiver_ledger",
    attrs: { repo, expires_at: expires },
  });

  it("counts waived modules by repo, with the first expiry", () => {
    render(<Waivers events={[waiver("rulespec-us", "2026-11-07"), waiver("rulespec-us", "2026-10-18"), waiver("rulespec-nz", "2026-10-01")]} referenceMs={NOW} />);
    const rows = screen.getAllByRole("row").map((r) => r.textContent);
    expect(rows).toEqual(["RepoWaived modulesFirst expiry", "rulespec-us22026-10-18 (in 10 days)", "rulespec-nz12026-10-01 (7 days ago)"]);
  });

  it("says where waivers come from when the log has none", () => {
    render(<Waivers events={[]} referenceMs={NOW} />);
    expect(screen.getByText(/No waiver rows in the event log/)).toBeTruthy();
  });
});
