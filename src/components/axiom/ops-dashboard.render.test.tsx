import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsDashboard } from "./ops-dashboard";
import type {
  EncodingOpsStatus,
  EncodingStatusRun,
  LiveEncodingRun,
} from "@/lib/corpus-status";
import type { EncodingQueueSummary } from "@/lib/axiom/encoding-queues";

const NOW = Date.parse("2026-08-11T12:00:00Z");

function run(overrides: Partial<EncodingStatusRun>): EncodingStatusRun {
  return {
    id: "run-1",
    timestamp: "2026-08-11T10:00:00Z",
    citation: "us:statutes/26/24",
    total_duration_ms: 1000,
    agent_type: "agentic:encoder",
    agent_model: "test",
    data_source: "apply_manifest",
    has_issues: false,
    session_id: null,
    encoder_version: "0.2.1670",
    ...overrides,
  };
}

function liveRun(overrides: Partial<LiveEncodingRun>): LiveEncodingRun {
  return {
    id: "live-1",
    citation: "us-ms/statute/27-7-5",
    status: "running",
    started_at: "2026-08-11T11:55:00Z",
    last_heartbeat_at: "2026-08-11T11:59:40Z",
    finished_at: null,
    phase: null,
    attempt: 1,
    backend: "openai",
    model: "gpt",
    encoder_version: "0.2.1670",
    run_id: null,
    runner: { hostname: "runner-1", reported_via: "public_ingest" },
    ...overrides,
  };
}

function status(overrides: Partial<EncodingOpsStatus>): EncodingOpsStatus {
  return {
    refreshed_at: new Date(NOW).toISOString(),
    lookback_days: 7,
    run_count: 100,
    recent_run_count: 5,
    issue_run_count: 2,
    active_session_count: 0,
    earliest_run_at: "2026-05-03T00:00:00Z",
    latest_runs: [],
    latest_sessions: [],
    latest_source_counts: {},
    live_runs: [],
    citation_labels: {},
    ...overrides,
  };
}

const QUEUE: EncodingQueueSummary = {
  queueId: "us-snap-all-states-2026-07",
  description: "All-state SNAP inventory.",
  pauseReason: "Awaiting a green tip.",
  total: 17784,
  pending: 17780,
  dispositionCounts: { completed: 3, dispatched: 1 },
  jurisdictionCount: 51,
};

const SCOPE = {
  jurisdiction: "dk",
  document_class: "statute",
  version: "2026-08-04-dk-full-parity-tier1",
  synced_at: "2026-08-08T00:00:00Z",
};

describe("OpsDashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval"] });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows running machines on the docket with names and status", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          live_runs: [liveRun({})],
          citation_labels: {
            "us-ms/statute/27-7-5": "Rate of tax",
          },
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(screen.getByText(/Encoding now — 1 machine/i)).toBeInTheDocument();
    expect(screen.getByText(/Mississippi — Rate of tax/)).toBeInTheDocument();
    expect(screen.getByText(/in progress · started/)).toBeInTheDocument();
  });

  it("shows stalled runs when the heartbeat dies", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          live_runs: [liveRun({ last_heartbeat_at: "2026-08-11T11:30:00Z" })],
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(screen.getByText(/stalled · last heartbeat/)).toBeInTheDocument();
  });

  it("shows recently finished runs when nothing is running", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          live_runs: [
            liveRun({
              status: "failed",
              finished_at: "2026-08-11T11:40:00Z",
            }),
            liveRun({
              id: "live-2",
              status: "completed",
              finished_at: "2026-08-11T11:45:00Z",
            }),
          ],
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(
      screen.getByText(/Recently active — 2 runs finished in the last hour/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/in progress · last attempt/)).toBeInTheDocument();
    expect(screen.getByText(/completed 15m ago/)).toBeInTheDocument();
  });

  it("falls back to the newest closed run when idle, and reports errors", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          live_runs: [
            liveRun({
              status: "completed",
              started_at: "2026-08-11T08:00:00Z",
              last_heartbeat_at: "2026-08-11T08:05:00Z",
              finished_at: "2026-08-11T08:05:00Z",
            }),
          ],
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(
      screen.getByText(/Idle — no machines encoding/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Last encode/i)).toBeInTheDocument();

    cleanup();
    render(
      <OpsDashboard
        initialStatus={null}
        encodingError="supabase down"
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(
      screen.getByText(/Encoding telemetry is unavailable — supabase down/),
    ).toBeInTheDocument();
  });

  it("renders the ledger table grouped by document with statuses and links", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          latest_runs: [
            run({ id: "a", citation: "us:statutes/26/24" }),
            run({
              id: "b",
              citation: "us:statutes/26/32",
              has_issues: true,
              timestamp: "2026-08-11T09:00:00Z",
            }),
          ],
          live_runs: [
            liveRun({
              id: "live-f",
              citation: "us-ky/statute/krs/141.020",
              status: "failed",
              finished_at: "2026-08-11T11:00:00Z",
              last_heartbeat_at: "2026-08-11T11:00:00Z",
            }),
          ],
          citation_labels: {
            "us/statute/26": "INTERNAL REVENUE CODE",
            "us/statute/26/24": "Child tax credit",
          },
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    // Document bands: jurisdiction — name, path right-aligned.
    expect(screen.getByText("US Federal")).toBeInTheDocument();
    expect(screen.getByText(/INTERNAL REVENUE CODE/)).toBeInTheDocument();
    expect(screen.queryByText("statute/26")).not.toBeInTheDocument();
    // Kentucky appears on both the docket (recently failed) and its band.
    expect(screen.getAllByText("Kentucky").length).toBeGreaterThan(0);
    // Recorded completion links to the compose graph viewer.
    const link = screen.getByRole("link", { name: /24/ });
    expect(link.getAttribute("href")).toContain("compose=");
    // Statuses: completed, flagged (recorded issues), in progress (live failure).
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("flagged")).toBeInTheDocument();
    expect(screen.getByText("in progress")).toBeInTheDocument();
    expect(screen.getByText("Child tax credit")).toBeInTheDocument();
  });

  it("groups interleaved documents under jurisdiction headings and names Germany", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          latest_runs: [
            run({
              id: "de-new",
              citation: "de:statutes/bgb/126",
              timestamp: "2026-08-11T11:00:00Z",
            }),
            run({
              id: "us-new",
              citation: "us:statutes/26/24",
              timestamp: "2026-08-11T10:00:00Z",
            }),
            run({
              id: "de-old",
              citation: "de:statutes/sgb-9-2018/2",
              timestamp: "2026-08-11T09:00:00Z",
            }),
            run({
              id: "us-old",
              citation: "us:regulations/7/273",
              timestamp: "2026-08-11T08:00:00Z",
            }),
          ],
          citation_labels: {
            "de/statute/bgb": "Civil Code",
            "de/statute/sgb-9-2018": "Social Code IX",
            "us/statute/26": "Internal Revenue Code",
            "us/regulation/7": "Agriculture regulations",
          },
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    const table = screen.getByRole("table");
    const headings = [...table.querySelectorAll('th[scope="rowgroup"]')];
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Germany",
      "US Federal",
    ]);
    const content = table.textContent!;
    expect(content.indexOf("Social Code IX")).toBeLessThan(
      content.indexOf("US Federal"),
    );
    expect(content.indexOf("Internal Revenue Code")).toBeLessThan(
      content.indexOf("Agriculture regulations"),
    );
    expect(screen.getAllByRole("cell", { name: "1" })).toHaveLength(4);
  });

  it("shows the IRS document title without its internal path", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          latest_runs: [
            run({ citation: "us:guidance/irs/rev-proc-2025-32/page-15" }),
          ],
          citation_labels: {
            "us/guidance/irs/rev-proc-2025-32": "Rev. Proc. 2025-32",
          },
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(screen.getByText("Rev. Proc. 2025-32")).toBeInTheDocument();
    expect(
      screen.queryByText("guidance/irs/rev-proc-2025-32"),
    ).not.toBeInTheDocument();
  });

  it("separates documents below an agency folder using corpus roots", () => {
    const folder = "us/guidance/agency/office";
    const first = `${folder}/first-publication`;
    const second = `${folder}/second-publication`;
    const firstCitation = first.replace("/", ":") + "/page-2";
    const secondCitation = second.replace("/", ":");
    render(
      <OpsDashboard
        initialStatus={status({
          latest_runs: [
            run({ id: "a", citation: firstCitation }),
            run({ id: "b", citation: secondCitation }),
          ],
          citation_document_paths: {
            [firstCitation]: first,
            [secondCitation]: second,
          },
          citation_labels: {
            [first]: "First official title",
            [second]: "Second official title",
          },
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(screen.getByText("First official title")).toBeInTheDocument();
    expect(screen.getByText("Second official title")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "page-2" })).toBeInTheDocument();
    expect(
      screen.queryByText("guidance/agency/office"),
    ).not.toBeInTheDocument();
  });

  it("uses a distinct document identifier when title metadata is missing", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          latest_runs: [run({ citation: "de:statutes/bgb/1" })],
        })}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(screen.getByText("BGB")).toHaveAttribute(
      "title",
      "Document identifier; source title not yet indexed",
    );
    expect(
      screen.queryByText("Document title unavailable"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("statute/bgb")).not.toBeInTheDocument();
  });

  it("shows the empty-ledger message when nothing is recorded", () => {
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[]}
        recentScopes={[]}
      />,
    );
    expect(screen.getByText(/No encodings recorded yet/)).toBeInTheDocument();
  });

  it("renders queues with progress, dispositions, and pause reasons", () => {
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[QUEUE]}
        recentScopes={[]}
      />,
    );
    expect(screen.getByText("Queued work")).toBeInTheDocument();
    expect(screen.getByText("us-snap-all-states-2026-07")).toBeInTheDocument();
    expect(
      screen.getByText(/4 of 17,784 dispositioned · 51 jurisdictions/),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 completed · 1 dispatched/)).toBeInTheDocument();
    expect(
      screen.getByText(/paused — Awaiting a green tip/),
    ).toBeInTheDocument();
  });

  it("renders recently ingested scopes with jurisdiction names", () => {
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[]}
        recentScopes={[SCOPE]}
      />,
    );
    expect(screen.getByText("Recently ingested")).toBeInTheDocument();
    expect(screen.getByText("Denmark")).toBeInTheDocument();
    expect(screen.getByText("statutes")).toBeInTheDocument();
    expect(
      screen.getByText("2026-08-04-dk-full-parity-tier1"),
    ).toBeInTheDocument();
  });

  it("names Israel from the jurisdictions seed, not a dashboard-local entry", () => {
    // JURISDICTION_NAMES spreads JURISDICTIONS_SEED, so seeding "il"
    // labels the ops surfaces too — no second copy to drift.
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[]}
        recentScopes={[
          {
            jurisdiction: "il",
            document_class: "statute",
            version: "2026-09-06-il-pilot",
            synced_at: "2026-09-06T00:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("Israel")).toBeInTheDocument();
    expect(screen.queryByText("il")).not.toBeInTheDocument();
  });
});
