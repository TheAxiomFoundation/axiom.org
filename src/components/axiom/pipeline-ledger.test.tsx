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
    expect(screen.getByRole("button", { name: "Runs of us-la/statute/47/32" }).closest("tr")).toHaveTextContent("Validation rules");
  });

  it("drops down a section's ten newest runs, each with its timeline, and links to the rest", async () => {
    serve({
      rows: runRows(
        Array.from({ length: 12 }, (_, i) =>
          pipelineAttempt({
            id: `r${i}`,
            citation: "us/statute/7/2015/f",
            jurisdiction: "us",
            dispatched_at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
            run_conclusion: i === 11 ? "success" : "failure",
          })
        )
      ),
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    const section = await screen.findByRole("button", { name: "Runs of us/statute/7/2015/f" });
    expect(screen.getByText(/^Every run, grouped/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Timeline of / })).not.toBeInTheDocument();
    fireEvent.click(section);
    expect(section).toHaveAttribute("aria-expanded", "true");
    const runs = screen.getAllByRole("button", { name: /^Timeline of / });
    expect(runs).toHaveLength(10);
    expect(runs[0]).toHaveAccessibleName("Timeline of us/statute/7/2015/f, run r11");
    expect(screen.getByRole("link", { name: "All 12 runs, each with its timeline" })).toHaveAttribute(
      "href",
      "/ops/journey?citation=us%2Fstatute%2F7%2F2015%2Ff"
    );
    fireEvent.click(runs[0]);
    expect(screen.getByRole("region", { name: "Encode run" })).toBeInTheDocument();
    fireEvent.click(runs[0]);
    expect(screen.queryByRole("region", { name: "Encode run" })).not.toBeInTheDocument();
    // Closing the section closes its runs.
    fireEvent.click(section);
    expect(screen.queryByRole("button", { name: /^Timeline of / })).not.toBeInTheDocument();
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
