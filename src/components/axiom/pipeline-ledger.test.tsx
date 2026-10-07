import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineLedger } from "./pipeline-ledger";
import { runRows } from "@/lib/axiom/encoding-pipeline-runs";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

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
    expect(within(row).getByRole("link", { name: "2015/f" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fstatute%2F7%2F2015%2Ff");
    // The program bundle and tier the section belongs to.
    expect(within(row).getByRole("link", { name: "Arizona SNAP · Tier 1" })).toHaveAttribute("href", "/ops/bundles/us-az/snap");
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
    expect(screen.getByText("12 runs").parentElement).toHaveTextContent("12 runsall failedlatest 18d ago");
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
    expect(screen.getByText("Latest run").parentElement).toHaveTextContent("Latest run18d agoFailed validationcause l");
    // The latest run's timeline shows under the overview, with nothing to open.
    expect(screen.queryByRole("button", { name: /^Timeline of / })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Encode run" })).toBeInTheDocument();
    // Every run opens on the page, one line each, and a line opens its run's timeline.
    const every = screen.getByRole("button", { name: "Show all 12 runs" });
    fireEvent.click(every);
    const lines = within(screen.getByRole("list", { name: "Every run" })).getAllByRole("listitem");
    expect(lines).toHaveLength(12);
    expect(lines[11]).toHaveTextContent("▸29d ago0.2.2000Failed validationCompleteness rule: tests");
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
    expect(screen.getByText("Latest run").parentElement).toHaveTextContent(/2 tries/);
    const tries = within(screen.getByRole("list", { name: "Tries in the encode loop" })).getAllByRole("listitem");
    expect(tries.map((row) => row.textContent)).toEqual([
      "1gpt-6-luna37s<$0.01Completeness rule: structure",
      "2gpt-6-sol20s$0.14Embedded scalar literal",
    ]);
    expect(screen.getByText(/^model time 57s of the 10m loop; the rest is checks and review$/)).toBeInTheDocument();
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
