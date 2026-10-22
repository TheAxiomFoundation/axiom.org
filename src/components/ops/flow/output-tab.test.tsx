import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mergedAttempt, outsideAttempt } from "@/test/pipeline-attempt";
import { acceptedSeries, moduleLedger, programIndex, tagPrograms } from "@/lib/axiom/accepted-modules";
import { attemptEvents, type PipelineEvent } from "@/lib/axiom/pipeline-events";
import { OutputTab } from "./output-tab";
import { Waivers } from "./waivers";

const NOW = Date.parse("2026-10-08T00:00:00Z");
const ok = { index_status: "indexed" as const, synced_at: "2026-09-21T10:00:00Z", compile_status: "ok", compile_checked_at: "2026-09-22T03:00:00Z", tests_status: "pass" as const };
const events = tagPrograms(
  [
    mergedAttempt(ok),
    outsideAttempt({ ...ok, citation: "us/policy/usitc/ch01", module_paths: ["us/policies/usitc/ch01.yaml"], pr_merged_at: "2026-10-06T09:00:00Z" }),
    mergedAttempt({ id: "dk", pr_repo: "rulespec-dk", module_paths: ["dk/x.yaml"], index_status: "missing" }),
  ].flatMap(attemptEvents),
  programIndex([{ bundle_id: "us/snap", citation_path: "us/statute/7/2017" }])
);
const ledger = moduleLedger(events);
const series = acceptedSeries(ledger, NOW);

describe("OutputTab", () => {
  it("shows accepted modules per week, by program, and not measured by repo", () => {
    render(<OutputTab series={series} ledger={ledger} program={null} />);
    const [weeks, programs] = screen.getAllByRole("table");
    // Week, accepted, dispatch, dep, by hand, rework, not measured.
    expect(within(weeks).getAllByRole("row").map((r) => [...r.children].map((c) => c.textContent))).toEqual([
      ["Week of", "Accepted", "Dispatch", "Dep", "By hand", "Rework", "Not measured"],
      ["2026-10-05", "1", "0", "0", "1", "0", "0"],
      ["2026-09-28", "0", "0", "0", "0", "0", "0"],
      ["2026-09-21", "1", "1", "0", "0", "0", "1"],
    ]);
    expect(within(programs).getByRole("link", { name: "SNAP" })).toHaveAttribute("href", "/ops?tab=output&program=snap");
    expect(screen.getByText(/rulespec-dk 1/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "us/policies/usitc/ch01.yaml" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fpolicy%2Fusitc%2Fch01");
  });

  it("narrows the weeks and the latest modules to one program", () => {
    render(<OutputTab series={series} ledger={ledger} program="snap" />);
    expect(screen.getByRole("heading", { name: "Accepted modules per week: SNAP" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "us/policies/usitc/ch01.yaml" })).toBeNull();
    expect(screen.getByRole("link", { name: "us/statutes/7/2017/a.yaml" })).toBeTruthy();
  });

  it("says when nothing is accepted yet", () => {
    const empty = { accepted: [], rework: [], not_measured: [], not_accepted: [] };
    render(<OutputTab series={acceptedSeries(empty, NOW)} ledger={empty} program={null} />);
    expect(screen.getByText("No module has been accepted yet.")).toBeTruthy();
  });
});

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
