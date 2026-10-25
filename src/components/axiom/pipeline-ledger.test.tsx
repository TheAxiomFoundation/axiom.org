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

  it("opens a section as what it needs: not encoded yet, the next step, the failure that comes back, and every run as a mark", async () => {
    const cause = (i: number) => (i % 3 === 0 ? "complete-source-unit:tests" : `ci: cause ${"abcdefghijkl"[i]}`);
    serve({
      rows: runRows(
        Array.from({ length: 12 }, (_, i) =>
          pipelineAttempt({
            id: `r${i}`,
            run_url: `https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/${i}`,
            citation: "us/statute/7/2015/f",
            jurisdiction: "us",
            dispatched_at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
            encoder_error: cause(i),
            encoder_error_rule: i % 3 === 0 ? "complete-source-unit:tests" : null,
            failure_source: "diagnostics",
          })
        )
      ),
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    const section = await screen.findByRole("button", { name: "Runs of us/statute/7/2015/f" });
    fireEvent.click(section);
    expect(screen.getByText(/^Not encoded yet/)).toHaveTextContent("Not encoded yet · 12 runs since 2026-09-01, none merged");
    const now = screen.getByText("Now").parentElement!;
    expect(now).toHaveTextContent("NowFailed validation: cause lOpen the failed run ↗");
    expect(within(now).getByRole("link", { name: "Open the failed run ↗" })).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/11"
    );
    // Only the failure that came back; the one-off causes stay out.
    const repeats = within(screen.getByText("Keeps failing on").parentElement!).getAllByRole("listitem");
    expect(repeats.map((r) => r.textContent)).toEqual(["Failed validation — Completeness rule: tests (4 runs)latest ↗"]);
    expect(within(repeats[0]).getByRole("link", { name: "latest ↗" })).toHaveAttribute("href", "https://github.com/TheAxiomFoundation/axiom-encode/actions/runs/9");
    // Every run as a mark, oldest first, each opening its run; the journey has the full history.
    const marks = within(screen.getByRole("list", { name: "Every run, oldest first" })).getAllByRole("listitem");
    expect(marks).toHaveLength(12);
    expect(marks[0]).toHaveAttribute("title", "2026-09-01 · Failed validation: Completeness rule: tests");
    expect(marks[0]).toHaveAttribute("data-tone", "failed");
    expect(screen.getByRole("link", { name: "Full history →" })).toHaveAttribute("href", "/ops/journey?citation=us%2Fstatute%2F7%2F2015%2Ff");
    // No count list and no run list; one timeline, of the latest run until a mark picks another.
    expect(screen.queryByRole("list", { name: "Where each run stopped, and why" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
    const latest = screen.getByRole("region", { name: "Latest run" });
    expect(latest).toHaveTextContent(/Failed validation · Sep 12, 10:00 UTC/);
    expect(latest).toHaveTextContent(/Stopped: Failed validation/);
    expect(marks[11]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(marks[0]);
    expect(marks[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Chosen run" })).toHaveTextContent(/Sep 1, 10:00 UTC/);
    expect(screen.queryByRole("region", { name: "Latest run" })).toBeNull();
    fireEvent.click(section);
    expect(screen.queryByText("Now")).toBeNull();
  });

  it("draws the chosen run's stages, its tries and the steps after its PR", async () => {
    serve({
      rows: runRows([
        mergedAttempt({
          id: "t",
          citation: "us/statute/42/416/l",
          jurisdiction: "us",
          setup_seconds: 120,
          encode_seconds: 900,
          publish_seconds: 60,
          tries: [
            { attempt: 1, model: "gpt-6-luna", ms: 37_000, cost: 0.0075, ok: false, error: "statutes/42/416/l.yaml: ci: [complete-source-unit:structure] Source branch (A)" },
            { attempt: 2, model: "gpt-6-sol", ms: 20_000, cost: 0.14, ok: true, error: null },
          ],
        }),
      ]),
    });
    render(<PipelineLedger scope={null} scopeName={null} referenceMs={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: "Runs of us/statute/42/416/l" }));
    const run = screen.getByRole("region", { name: "Latest run" });
    const tries = within(run).getAllByRole("listitem").filter((li) => li.closest("ol")?.getAttribute("aria-label") === "Tries in the encode loop");
    expect(tries.map((t) => t.textContent)).toEqual(["Try 1gpt-6-luna37s<$0.01Completeness rule: structure", "Try 2gpt-6-sol20s$0.14passed"]);
    expect(within(run).getByRole("list", { name: "After the PR" })).toHaveTextContent(/Review/);
    expect(within(run).getByRole("img")).toHaveAccessibleName("Setup 2m, Encode loop 15m, Sign and open the PR 1m");
  });

  it("reads an encoded section in one line, and a module encoded in another run by its next step", async () => {
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
    expect(merged.closest("tr")).toHaveTextContent(/Tests pass/);
    fireEvent.click(merged);
    expect(screen.getByText(/^Encoded/)).toHaveTextContent("Encoded · merged rulespec-us#900 · tests pass");
    expect(screen.queryByText("Now")).toBeNull();
    const marks = within(screen.getByRole("list", { name: "Every run, oldest first" })).getAllByRole("listitem");
    expect(marks.map((m) => m.getAttribute("data-tone"))).toEqual(["failed", "done"]);
    // The latest run, a merge outside the pipeline, links to its PR.
    expect(within(screen.getByRole("region", { name: "Latest run" })).getByRole("link", { name: "PR ↗" })).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/rulespec-us/pull/900"
    );
    fireEvent.click(merged);

    const dependent = screen.getByRole("button", { name: "Runs of us/statute/42/402/q" });
    expect(dependent.closest("tr")).toHaveTextContent(/Failed the compile check/);
    fireEvent.click(dependent);
    expect(screen.getByText("Now").parentElement).toHaveTextContent(/^NowFailed the compile check/);
    expect(screen.queryByText("Keeps failing on")).toBeNull();
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

  it("says how old the runs are, what the statuses mean, names each document, and the next step after a cancellation", async () => {
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
    // The document path is in the title's tooltip, not in the band.
    expect(screen.getByText("INTERNAL REVENUE CODE")).toHaveAttribute("title", "us/statute/26");
    expect(screen.queryByText("us/statute/26")).not.toBeInTheDocument();
    const legend = screen.getByRole("button", { name: "What Status means" });
    fireEvent.click(legend);
    expect(screen.getByRole("note")).toHaveTextContent(/Done: tests pass\..*Going: .*Stopped: /);
    // The latest run was cancelled at approval: that is the next thing to look at.
    fireEvent.click(screen.getByRole("button", { name: "Runs of us/statute/26/32" }));
    expect(screen.getByText(/^Not encoded yet/)).toHaveTextContent("Not encoded yet · 2 runs since 2026-09-20, none merged");
    expect(screen.getByText("Now").parentElement).toHaveTextContent("NowCancelled at approvalOpen the run ↗");
    const marks = within(screen.getByRole("list", { name: "Every run, oldest first" })).getAllByRole("listitem");
    expect(marks.map((m) => m.getAttribute("data-tone"))).toEqual(["failed", "cancelled"]);
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
