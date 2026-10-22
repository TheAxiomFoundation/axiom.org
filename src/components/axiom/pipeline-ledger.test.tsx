import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineLedger } from "./pipeline-ledger";
import { runRows } from "@/lib/axiom/encoding-pipeline-runs";
import { dependentAttempt, mergedAttempt, outsideAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const NOW = Date.parse("2026-09-30T12:00:00Z");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(body: unknown, ok = true) {
  const fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("PipelineLedger", () => {
  it("groups every run of the scope by jurisdiction, document, and section, with names and statuses", async () => {
    const fetch = serve({
      rows: runRows([
        pipelineAttempt({ id: "a1", citation: "us/statute/7/2015/f", jurisdiction: "us", dispatched_at: "2026-09-20T10:00:00Z" }),
        mergedAttempt({ id: "a2", citation: "us/statute/7/2015/f", jurisdiction: "us", dispatched_at: "2026-09-25T10:00:00Z", tests_status: "pass" }),
        pipelineAttempt({ id: "b", citation: "us-la/statute/47/32", jurisdiction: "us-la", encoder_error_rule: "rule-a", failure_source: "diagnostics" }),
      ]),
      labels: { "us/statute/7": "Agriculture", "us/statute/7/2015/f": "Disqualification" },
      bundles: [
        { bundle_id: "us-az/snap", bundle_title: "Arizona SNAP", tier: "screener", tier_index: 1, tier_title: "Screener-level parity", document: "7 USC 2015", citation_path: "us/statute/7/2015" },
      ],
    });
    render(<PipelineLedger scope={{ jurisdiction: "us", only: false }} scopeName="United States" referenceMs={NOW} />);
    expect(screen.getByText("Loading runs…")).toBeInTheDocument();
    const ledger = await screen.findByRole("table");
    expect(fetch).toHaveBeenCalledWith("/ops/runs?j=us");
    expect(screen.getByRole("heading", { name: "Latest encodings" })).toBeInTheDocument();
    expect(screen.getByText(/^United States: every run, grouped by jurisdiction and document/)).toBeInTheDocument();
    expect(within(ledger).getByRole("rowheader", { name: "US Federal" })).toBeInTheDocument();
    expect(within(ledger).getByRole("rowheader", { name: "Louisiana" })).toBeInTheDocument();
    expect(within(ledger).getByText("Agriculture")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: "Runs of us/statute/7/2015/f" }).closest("tr")!;
    expect(row).toHaveTextContent(/2015\/f.*Disqualification.*Tests pass.*2/);
    // The citation opens its runs in place; the row has no link to a separate page.
    expect(within(row).queryByRole("link", { name: "2015/f" })).toBeNull();
    const toggle = within(row).getByRole("button", { name: "Runs of us/statute/7/2015/f" });
    expect(toggle).toHaveTextContent("2015/f");
    // A click anywhere on the row opens it too, and again closes it.
    fireEvent.click(within(row).getByText("Tests pass"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The program bundle and tier the section belongs to.
    expect(within(row).getByRole("link", { name: "Arizona SNAP · Tier 1" })).toHaveAttribute("href", "/ops?tab=programs&bundle=us-az/snap");
    expect(within(screen.getByRole("button", { name: "Runs of us-la/statute/47/32" }).closest("tr")!).queryByRole("link", { name: /SNAP/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Runs of us-la/statute/47/32" }).closest("tr")).toHaveTextContent("Failed validation");
  });

  it("drops down an overview of a section's runs with the latest run's timeline, and every run on request", async () => {
    const cause = (i: number) => (i % 3 === 0 ? "complete-source-unit:tests" : `ci: cause ${"abcdefghijkl"[i]}`);
    // Each "ci: cause x" headline is the message without its source: "cause x".
    serve({
      rows: runRows(
        Array.from({ length: 12 }, (_, i) =>
          pipelineAttempt({
            id: `r${i}`,
            citation: "us/statute/7/2015/f",
            jurisdiction: "us",
            dispatched_at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
            encoder_version: `0.2.${2000 + i}`,
            encoder_error: cause(i),
            encoder_error_rule: i % 3 === 0 ? "complete-source-unit:tests" : null,
            failure_source: "diagnostics",
          })
        )
      ),
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    const section = await screen.findByRole("button", { name: "Runs of us/statute/7/2015/f" });
    expect(screen.getByText(/^Every run, grouped/)).toBeInTheDocument();
    fireEvent.click(section);
    expect(section).toHaveAttribute("aria-expanded", "true");
    // A summary line, then where and why each run stopped (count first), then the latest run.
    expect(screen.getByText("12 runs").parentElement).toHaveTextContent("12 runs · all failed · latest 18d ago");
    const list = (name: string) => within(screen.getByRole("list", { name })).getAllByRole("listitem").map((item) => item.textContent);
    const stops = "Where each run stopped, and why";
    expect(list(stops)).toEqual([
      "4Failed validation — Completeness rule: tests",
      "1Failed validation — cause l",
      "1Failed validation — cause k",
      "1Failed validation — cause i",
      "+5 more",
    ]);
    // "+5 more" opens the rest of the list, and "Show fewer" folds it again.
    fireEvent.click(screen.getByRole("button", { name: "+5 more" }));
    expect(list(stops)).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(list(stops)).toHaveLength(5);
    expect(screen.getByText("Latest run").parentElement).toHaveTextContent("Latest runFailed validation cause ldispatched 18d ago · Run on GitHub ↗");
    // The latest run's timeline shows under the overview, with nothing to open.
    expect(screen.queryByRole("button", { name: /^Timeline of / })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Encode run" })).toBeInTheDocument();
    // Every run opens on the page, one line each, and a line opens its run's timeline.
    const every = screen.getByRole("button", { name: "Show all 12 runs" });
    fireEvent.click(every);
    const lines = within(screen.getByRole("list", { name: "Every run" })).getAllByRole("listitem");
    expect(lines).toHaveLength(12);
    expect(lines[11]).toHaveTextContent("29d ago0.2.2000Failed validationCompleteness rule: tests");
    fireEvent.click(within(lines[11]).getByRole("button", { name: "Timeline of us/statute/7/2015/f, run r0" }));
    expect(screen.getAllByRole("region", { name: "Encode run" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Hide the runs" }));
    expect(screen.queryByRole("list", { name: "Every run" })).not.toBeInTheDocument();
    // Closing the section closes its overview.
    fireEvent.click(section);
    expect(screen.queryByRole("region", { name: "Encode run" })).not.toBeInTheDocument();
  });

  it("shows the latest run's tries in the encode loop", async () => {
    serve({
      rows: runRows([
        pipelineAttempt({
          id: "t",
          citation: "us/statute/42/416/l",
          jurisdiction: "us",
          encode_seconds: 600,
          tries: [
            { attempt: 1, model: "gpt-6-luna", ms: 37_000, cost: 0.0075, ok: false, error: "statutes/42/416/l.yaml: ci: [complete-source-unit:structure] Source branch (A)" },
            { attempt: 2, model: "gpt-6-sol", ms: 20_000, cost: 0.14, ok: false, error: "statutes/42/416/l.yaml: ci: Embedded scalar literal: 5" },
          ],
        }),
      ]),
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: "Runs of us/statute/42/416/l" }));
    expect(screen.getByText("The run").parentElement).toHaveTextContent(/2 tries/);
    const rows = within(screen.getByRole("list", { name: "Inside the encode loop" })).getAllByRole("listitem");
    // The encoder times each try's model call only: the rest of the loop is one row, so the group sums to the loop.
    expect(rows.map((row) => row.textContent)).toEqual([
      "├Try 1 gpt-6-luna 37s <$0.01 Completeness rule: structure",
      "├Try 2 gpt-6-sol 20s $0.14 Embedded scalar literal · stopped the run",
      "└Checks and review 9m 3s between and after the tries, not timed per try; with the tries' model time (57s) the loop's 10m",
    ]);
  });

  it("shows a merge outside the pipeline and a module encoded in another citation's run as runs of their sections", async () => {
    const host = pipelineAttempt({ id: "1001", citation: "us/statute/42/416/l", jurisdiction: "us" });
    serve({
      rows: runRows([
        host,
        // A failed dispatch, then a person's PR merged after it.
        pipelineAttempt({ id: "f", citation: "us/statute/7/2017/a", jurisdiction: "us", dispatched_at: "2026-09-21T10:00:00Z", encoder_error_rule: "rule-a", failure_source: "diagnostics" }),
        outsideAttempt({ citation: "us/statute/7/2017/a", jurisdiction: "us", synced_at: "S", index_status: "indexed", tests_status: "pass" }),
        dependentAttempt({
          jurisdiction: "us",
          tries: [{ attempt: 1, model: "gpt-6-sol", ms: 30_000, cost: 0.2, ok: false, error: "statutes/42/402/q.yaml: compile: failed" }],
        }),
      ]),
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    const merged = await screen.findByRole("button", { name: "Runs of us/statute/7/2017/a" });
    // The section's status follows its latest attempt: the merge.
    expect(merged.closest("tr")).toHaveTextContent(/Tests pass/);
    fireEvent.click(merged);
    expect(screen.getByText("Latest run").parentElement).toHaveTextContent(
      "Latest runMerged outside the pipeline merged 7d ago · by MaxGhenis · rulespec-us#900 · merged"
    );
    expect(screen.queryByRole("link", { name: "Run on GitHub ↗" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 2 runs" }));
    const lines = within(screen.getByRole("list", { name: "Every run" })).getAllByRole("listitem");
    expect(lines[0]).toHaveTextContent("7d agoMerged outside the pipeline · MaxGhenisrulespec-us#900");
    expect(within(lines[0]).getByRole("link", { name: "rulespec-us#900" })).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/rulespec-us/pull/900"
    );
    expect(lines[1]).toHaveTextContent(/Failed validation/);
    fireEvent.click(merged);

    const dependent = screen.getByRole("button", { name: "Runs of us/statute/42/402/q" });
    expect(dependent.closest("tr")).toHaveTextContent(/Failed the compile check/);
    fireEvent.click(dependent);
    const latest = screen.getByText("The run").parentElement!;
    expect(latest).toHaveTextContent(/^The runFailed the compile check/);
    expect(within(latest).getByRole("link", { name: "Encoded in the run for us/statute/42/416/l ↗" })).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/1001"
    );
    // Its own encode loop, on its own clock.
    expect(screen.getByRole("region", { name: "Encode run" })).toHaveTextContent(/Its encode loop/);
  });

  it("shows ten documents at a time", async () => {
    serve({
      rows: runRows(
        Array.from({ length: 12 }, (_, i) =>
          pipelineAttempt({ id: `d${i}`, citation: `us/statute/${i + 1}/100/a`, jurisdiction: "us" })
        )
      ),
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    await screen.findByRole("table");
    expect(screen.getAllByRole("button", { name: /^Runs of / })).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more documents" }));
    expect(screen.getAllByRole("button", { name: /^Runs of / })).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /more documents$/ })).not.toBeInTheDocument();
  });

  it("pages by each document's latest run across jurisdictions", async () => {
    serve({
      rows: runRows([
        ...Array.from({ length: 10 }, (_, i) =>
          pipelineAttempt({ id: `d${i}`, citation: `us/statute/${i + 1}/100/a`, jurisdiction: "us", dispatched_at: `2026-09-${String(i + 15).padStart(2, "0")}T10:00:00Z` })
        ),
        pipelineAttempt({ id: "old", citation: "us/statute/99/100/a", jurisdiction: "us", dispatched_at: "2026-09-01T10:00:00Z" }),
        pipelineAttempt({ id: "nm", citation: "us-nm/statute/7-2-39", jurisdiction: "us-nm", dispatched_at: "2026-09-20T12:00:00Z" }),
      ]),
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    const ledger = await screen.findByRole("table");
    // New Mexico's run is newer than the oldest US documents: it shows on the first page, under its own heading.
    expect(within(ledger).getByRole("rowheader", { name: "New Mexico" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Runs of / })).toHaveLength(10);
    expect(screen.queryByRole("button", { name: "Runs of us/statute/99/100/a" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more documents" }));
    expect(screen.getByRole("button", { name: "Runs of us/statute/99/100/a" })).toBeInTheDocument();
  });

  it("says how old the runs are, what the statuses mean, and names each document with its citation", async () => {
    serve({
      rows: runRows([
        pipelineAttempt({ id: "f", citation: "us/statute/26/32", jurisdiction: "us", dispatched_at: "2026-09-20T10:00:00Z", encoder_error_rule: "rule-a", failure_source: "diagnostics" }),
        pipelineAttempt({ id: "c", citation: "us/statute/26/32", jurisdiction: "us", dispatched_at: "2026-09-21T10:00:00Z", run_conclusion: "cancelled", cancel_stage: "approval" }),
      ]),
      labels: { "us/statute/26": "INTERNAL REVENUE CODE", "us/statute/26/32": "Earned income" },
      documentPaths: { "us/statute/26/32": "us/statute/26" },
      collectedAt: "2026-09-30T11:48:00Z",
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    await screen.findByRole("table");
    expect(screen.getByText("Updated 12m ago.")).toHaveAttribute("title", "2026-09-30T11:48:00Z");
    expect(screen.getByText("INTERNAL REVENUE CODE").parentElement).toHaveTextContent("INTERNAL REVENUE CODEus/statute/26");
    const legend = screen.getByRole("button", { name: "What Status means" });
    fireEvent.click(legend);
    expect(screen.getByRole("note")).toHaveTextContent(/Done: tests pass\..*Going: .*Stopped: /);
    // A failure and a cancellation are not two failures.
    fireEvent.click(screen.getByRole("button", { name: "Runs of us/statute/26/32" }));
    expect(screen.getByText("2 runs").parentElement).toHaveTextContent("2 runs · 1 failed · 1 cancelled · latest 9d ago");
  });

  it("says when it cannot load, and when the scope has no runs", async () => {
    serve({}, false);
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    expect(await screen.findByText("The ledger could not load. Try again later.")).toBeInTheDocument();
    cleanup();
    serve({ rows: [] });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    expect(await screen.findByText("No runs recorded in this scope yet.")).toBeInTheDocument();
  });
});
