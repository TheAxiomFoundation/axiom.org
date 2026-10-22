import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsDashboard } from "./ops-dashboard";
import { groupRecentScopes } from "@/lib/corpus-status";
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
    graph_available: true,
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
    latest_runs: [],
    live_runs: [],
    citation_labels: {},
    ...overrides,
  };
}

const QUEUE: EncodingQueueSummary = {
  queueId: "us-snap-all-states-2026-07",
  kind: "legacy",
  path: "data/encoding-queues/us-snap-all-states-2026-07.json",
  description: "All-state SNAP inventory.",
  paused: true,
  pauseReason: "Awaiting a green tip.",
  pausedSince: null,
  dispatchWorkflow: null,
  total: 17784,
  pending: 17780,
  dispositionCounts: { completed: 3, dispatched: 1 },
  jurisdictionCount: 51,
  blockedNote: null,
  attention: [],
  notStarted: {},
  supersedes: ["us-snap-or-ut-2026-07"],
  frozenSince: "2026-08-05T21:39:46Z",
  inDispatcher: 955,
};

const DISPATCHER: EncodingQueueSummary = {
  ...QUEUE,
  queueId: "us-snap-or-ut-pilot",
  kind: "dispatcher",
  path: "queues/us-snap-or-ut-pilot.json",
  description: null,
  pauseReason: null,
  pausedSince: "2026-07-29T12:00:00Z",
  dispatchWorkflow: { state: "disabled_manually", url: "https://github.com/w/snap-dispatch-queue.yml" },
  total: 955,
  pending: 935,
  dispositionCounts: { skipped: 19, blocked: 1 },
  jurisdictionCount: 2,
  supersedes: [],
  frozenSince: null,
  inDispatcher: null,
};

const SCOPE = {
  jurisdiction: "dk",
  document_class: "statute",
  version: "2026-08-04-dk-full-parity-tier1",
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
        recentPlaces={[]}
      />,
    );
    expect(screen.getByText(/Encoding now — 1 machine/i)).toBeInTheDocument();
    expect(screen.getByText(/Mississippi — Rate of tax/)).toBeInTheDocument();
    expect(screen.getByText(/in progress · started/)).toBeInTheDocument();
  });

  it("shows a ledger the page passes in place of the one from encoder records", () => {
    const props = {
      initialStatus: status({}),
      encodingError: null,
      queues: [],
      recentPlaces: [],
    };
    render(<OpsDashboard {...props} />);
    expect(screen.getByRole("heading", { name: "Latest encodings" })).toBeInTheDocument();
    cleanup();
    render(<OpsDashboard {...props} ledger={<section aria-label="Every run" />} />);
    expect(screen.queryByRole("heading", { name: "Latest encodings" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Every run" })).toBeInTheDocument();
  });

  it("shows four tabs as links, the headline on every tab, and one tab's body at a time", () => {
    const props = {
      initialStatus: status({}),
      encodingError: null,
      queues: [],
      recentPlaces: [],
      headline: <section aria-label="Accepted modules" />,
      ledger: <section aria-label="Every run" />,
      panel: <section aria-label="The encoding line" />,
    };
    render(<OpsDashboard {...props} />);
    const tabs = screen.getByRole("navigation", { name: "Operations" });
    expect(within(tabs).getAllByRole("link").map((t) => [t.textContent, t.getAttribute("href")])).toEqual([
      ["Now", "/ops"],
      ["Line", "/ops?tab=line"],
      ["Output", "/ops?tab=output"],
      ["Programs", "/ops?tab=programs"],
    ]);
    expect(within(tabs).getByRole("link", { name: "Now" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "Accepted modules" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Every run" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "The encoding line" })).not.toBeInTheDocument();
    cleanup();
    render(<OpsDashboard {...props} initialTab="line" />);
    expect(screen.getByRole("region", { name: "Accepted modules" })).toBeVisible();
    expect(screen.getByRole("region", { name: "The encoding line" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Every run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Live encoding activity" })).not.toBeInTheDocument();
  });

  it("shows the workflows strip under the fleet box on the Now tab", () => {
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[]}
        recentPlaces={[]}
        workflows={<section aria-label="Workflows" />}
      />,
    );
    const fleet = screen.getByRole("region", { name: "Live encoding activity" });
    const strip = screen.getByRole("region", { name: "Workflows" });
    const tabs = screen.getByRole("navigation", { name: "Operations" });
    expect(strip).toBeVisible();
    expect(fleet.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.compareDocumentPosition(fleet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows stalled runs when the heartbeat dies", () => {
    render(
      <OpsDashboard
        initialStatus={status({
          live_runs: [liveRun({ last_heartbeat_at: "2026-08-11T11:30:00Z" })],
        })}
        encodingError={null}
        queues={[]}
        recentPlaces={[]}
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
              attempt: 4,
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
        recentPlaces={[]}
      />,
    );
    expect(
      screen.getByText(/Recently active — 2 runs finished in the last hour/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^failed after 4 attempts 20m ago/)).toBeInTheDocument();
    expect(screen.queryByText(/in progress/)).not.toBeInTheDocument();
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
        recentPlaces={[]}
      />,
    );
    expect(
      screen.getByText(/Idle — no machines encoding/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Last encode/i)).toBeInTheDocument();
    expect(within(screen.getByText(/Last encode/i).parentElement!).getByText("completed")).toBeInTheDocument();

    // A failed last encode is over, not "in progress".
    cleanup();
    render(
      <OpsDashboard
        initialStatus={status({
          live_runs: [
            liveRun({
              status: "failed",
              attempt: 4,
              started_at: "2026-08-11T08:00:00Z",
              last_heartbeat_at: "2026-08-11T08:05:00Z",
              finished_at: "2026-08-11T08:05:00Z",
            }),
          ],
        })}
        encodingError={null}
        queues={[]}
        recentPlaces={[]}
      />,
    );
    expect(screen.getByText(/Idle — no machines encoding/i)).toBeInTheDocument();
    const lastEncode = screen.getByText(/Last encode/i).parentElement!;
    expect(within(lastEncode).getByText("failed after 4 attempts")).toBeInTheDocument();
    expect(within(lastEncode).queryByText(/in progress/)).not.toBeInTheDocument();

    cleanup();
    render(
      <OpsDashboard
        initialStatus={null}
        encodingError="supabase down"
        queues={[]}
        recentPlaces={[]}
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
        recentPlaces={[]}
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
        recentPlaces={[]}
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
        recentPlaces={[]}
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
        recentPlaces={[]}
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
        recentPlaces={[]}
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
        recentPlaces={[]}
      />,
    );
    expect(screen.getByText(/No encodings recorded yet/)).toBeInTheDocument();
  });

  it("renders a dispatcher queue's pending count, progress without skips, and how long it is paused", () => {
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[DISPATCHER]}
        recentPlaces={[]}
      />,
    );
    expect(screen.getByText("Queued work")).toBeInTheDocument();
    expect(screen.getByText("us-snap-or-ut-pilot")).toBeInTheDocument();
    // Skipped items were never dispatched, so they are not progress.
    expect(screen.getByText("1 of 955 dispositioned · 2 jurisdictions")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "us-snap-or-ut-pilot: 1 of 955 items dispositioned" })).toBeInTheDocument();
    const line = screen.getByText(/^935 pending · 19 skipped · 1 blocked/);
    expect(line).toHaveTextContent("935 pending · 19 skipped · 1 blocked · paused 13d · dispatch workflow disabled");
    expect(within(line).getByRole("link", { name: "dispatch workflow disabled" })).toHaveAttribute(
      "href",
      "https://github.com/w/snap-dispatch-queue.yml",
    );
    expect(screen.queryByText(/Paused$/)).not.toBeInTheDocument();
  });

  it("says a paused dispatcher queue's stated reason, and nothing when it runs", () => {
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[
          { ...DISPATCHER, pauseReason: "Awaiting a green tip.", dispatchWorkflow: null },
          { ...DISPATCHER, queueId: "running", paused: false, pausedSince: null, dispatchWorkflow: { state: "active", url: "u" } },
        ]}
        recentPlaces={[]}
      />,
    );
    expect(screen.getAllByText(/^935 pending/).map((line) => line.textContent)).toEqual([
      "935 pending · 19 skipped · 1 blocked · paused 13d — Awaiting a green tip",
      "935 pending · 19 skipped · 1 blocked",
    ]);
    expect(screen.queryByRole("link", { name: "dispatch workflow disabled" })).not.toBeInTheDocument();
  });

  it("renders an earlier inventory as frozen, with how many of its items a live queue holds", () => {
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[DISPATCHER, QUEUE, { ...QUEUE, queueId: "nowhere", frozenSince: null, inDispatcher: 0, jurisdictionCount: 1 }]}
        recentPlaces={[]}
      />,
    );
    expect(screen.getByText("inventory, frozen since Aug 5, 2026")).toBeInTheDocument();
    expect(screen.getByText("51 jurisdictions")).toBeInTheDocument();
    expect(
      screen.getByText("17,784 items, 955 of them in the dispatcher, the rest in no live queue"),
    ).toBeInTheDocument();
    expect(screen.getByText("17,784 items, none of them in a live queue")).toBeInTheDocument();
    expect(screen.getByText("inventory")).toBeInTheDocument();
    // Its frozen statuses, progress, and pause note are not shown.
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.queryByText(/of 17,784 dispositioned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/3 completed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Awaiting a green tip/)).not.toBeInTheDocument();
    cleanup();
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[{ ...QUEUE, inDispatcher: 17784 }]}
        recentPlaces={[]}
      />,
    );
    expect(screen.getByText("17,784 items, all of them in the dispatcher")).toBeInTheDocument();
  });

  it("renders recently ingested scopes with jurisdiction names", () => {
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[]}
        recentPlaces={groupRecentScopes([SCOPE])}
      />,
    );
    expect(screen.getByText("Recently ingested")).toBeInTheDocument();
    expect(screen.getByText("Denmark")).toBeInTheDocument();
    expect(screen.queryByText(/\bscopes?\b/)).not.toBeInTheDocument();
    expect(screen.getByText("Aug 4")).toBeInTheDocument();
    expect(screen.getByText("statute")).toBeInTheDocument();
    expect(screen.getByText("2026-08-04-dk-full-parity-tier1")).toBeInTheDocument();
  });

  it("groups scopes by place, then by date, and folds places past the first six", () => {
    const { container } = render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[]}
        recentPlaces={groupRecentScopes([
          { jurisdiction: "us-co", document_class: "regulation", version: "2026-10-12-w7-regulation-co" },
          { jurisdiction: "us", document_class: "statute", version: "2026-10-12-w7-usc-26" },
          { jurisdiction: "us", document_class: "statute", version: "2026-10-12-w7-usc-42" },
          { jurisdiction: "us", document_class: "guidance", version: "2026-10-12-w7-irs-pubs" },
          { jurisdiction: "us-co", document_class: "statute", version: "2026-10-06-w6-statute-co" },
          { jurisdiction: "uk-wakefield", document_class: "policy", version: "2026-09-05-uk-councils" },
          ...["us-ak", "us-al", "us-ar", "us-az"].map((jurisdiction) => ({
            jurisdiction,
            document_class: "form",
            version: `2026-09-01-forms-${jurisdiction}`,
          })),
        ])}
      />,
    );
    const places = [...container.querySelectorAll('[role="listitem"] > p:first-child')].map(
      (p) => p.textContent,
    );
    // US Federal first on its tie with Colorado; Arkansas is the seventh place, folded.
    expect(places).toEqual([
      "US Federal",
      "Colorado",
      "United Kingdom",
      "Alabama",
      "Alaska",
      "Arizona",
      "Arkansas",
    ]);
    expect(screen.getByText("2 statutes, guidance")).toBeInTheDocument();
    expect(screen.getByText("Wakefield")).toBeInTheDocument();
    expect(screen.getByText("Show 1 more place")).toBeInTheDocument();
    const colorado = screen.getByText("Colorado").closest('[role="listitem"]') as HTMLElement;
    expect(within(colorado).getByText("Oct 12")).toBeInTheDocument();
    expect(within(colorado).getByText("Oct 6")).toBeInTheDocument();
  });

  it("names Israel from the jurisdictions seed, not a dashboard-local entry", () => {
    // The feed's names come from the jurisdictions seed, so seeding "il"
    // labels the ops surfaces too — no second copy to drift.
    render(
      <OpsDashboard
        initialStatus={status({})}
        encodingError={null}
        queues={[]}
        recentPlaces={groupRecentScopes([
          {
            jurisdiction: "il",
            document_class: "statute",
            version: "2026-09-06-il-pilot",
          },
        ])}
      />,
    );
    expect(screen.getByText("Israel")).toBeInTheDocument();
    expect(screen.queryByText("il")).not.toBeInTheDocument();
  });

  it("polls only while the page is visible, and catches up on return", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: status({}) }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const setVisibility = (next: DocumentVisibilityState) => {
      visibility = next;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    try {
      const { unmount } = render(
        <OpsDashboard
          initialStatus={status({})}
          encodingError={null}
          queues={[]}
          recentPlaces={[]}
        />,
      );
      vi.advanceTimersByTime(30_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Hidden for ten minutes and a bit (returning mid-interval): no polls.
      setVisibility("hidden");
      vi.advanceTimersByTime(10 * 60_000 + 15_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Back: one catch-up refresh, and the interval restarts from here, so
      // the next poll is a full interval later rather than moments after.
      setVisibility("visible");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith("/api/ops/encoding");
      vi.advanceTimersByTime(29_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Flicking away and back within seconds does not refresh again.
      vi.advanceTimersByTime(2_000);
      setVisibility("hidden");
      setVisibility("visible");
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Hiding the tab, whenever it happens, never fetches.
      vi.advanceTimersByTime(20_000);
      setVisibility("hidden");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      setVisibility("visible");
      expect(fetchMock).toHaveBeenCalledTimes(4);

      // After unmount, neither the interval nor the listener fires.
      unmount();
      setVisibility("hidden");
      vi.advanceTimersByTime(60_000);
      setVisibility("visible");
      vi.advanceTimersByTime(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });
});
