import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveEncodingPanel } from "./live-encoding-panel";
import type {
  CorpusStatusArtifact,
  EncodingOpsStatus,
  LiveEncodingRun,
} from "@/lib/corpus-status";

function encodingStatus(
  overrides: Partial<EncodingOpsStatus> = {}
): EncodingOpsStatus {
  return {
    refreshed_at: "2026-07-01T12:00:00.000Z",
    lookback_days: 7,
    run_count: 42,
    recent_run_count: 5,
    issue_run_count: 1,
    active_session_count: 0,
    earliest_run_at: "2026-05-03T23:18:20.000Z",
    latest_runs: [
      {
        id: "enc-1",
        timestamp: "2026-07-01T11:55:00.000Z",
        citation: "C.R.S. 26-2-703",
        total_duration_ms: 125000,
        agent_type: "encoder",
        agent_model: "claude-fable-5",
        data_source: "reviewer_agent",
        has_issues: false,
        session_id: "sdk-1",
        encoder_version: "0.4.2",
      },
    ],
    latest_sessions: [
      {
        id: "sdk-1",
        started_at: "2026-07-01T11:50:00.000Z",
        ended_at: "2026-07-01T11:58:00.000Z",
        model: "claude-fable-5",
        event_count: 18,
        input_tokens: 1200,
        output_tokens: 800,
        estimated_cost_usd: 0.314,
        encoder_version: "0.4.2",
      },
    ],
    latest_source_counts: { reviewer_agent: 1 },
    live_runs: [],
    ...overrides,
  };
}

function liveRun(
  overrides: Partial<LiveEncodingRun> = {}
): LiveEncodingRun {
  return {
    id: "live-1",
    citation: "us/statute/26/32",
    status: "running",
    started_at: "2026-07-01T11:50:00.000Z",
    last_heartbeat_at: "2026-07-01T12:00:20.000Z",
    finished_at: null,
    phase: null,
    attempt: 1,
    backend: "codex",
    model: "gpt-5.5",
    encoder_version: "0.2.1587",
    run_id: null,
    runner: {
      hostname: "mac-a.local",
      username: "pavel",
      platform: "darwin",
      pid: 123,
      is_ci: false,
    },
    ...overrides,
  };
}

function artifact(
  value: EncodingOpsStatus | null,
  error: string | null = null
): CorpusStatusArtifact<EncodingOpsStatus> {
  return {
    key: "supabase://encodings.encoding_runs",
    source: value ? "supabase" : null,
    value,
    error,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LiveEncodingPanel", () => {
  it("renders the initial server-fetched encoding status", () => {
    render(<LiveEncodingPanel initial={artifact(encodingStatus())} />);

    expect(
      screen.getByText(/no encoding sessions running/i)
    ).toBeInTheDocument();
    expect(screen.getByText("C.R.S. 26-2-703")).toBeInTheDocument();
    expect(screen.getByText("sdk-1")).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.getByText(/refreshes every 30s/i)).toBeInTheDocument();
    expect(
      screen.getByText(/telemetry since May 3, 2026/i)
    ).toBeInTheDocument();
  });

  it("shows active sessions as running now", () => {
    render(
      <LiveEncodingPanel
        initial={artifact(
          encodingStatus({
            active_session_count: 2,
            latest_sessions: [
              {
                ...encodingStatus().latest_sessions[0],
                ended_at: null,
              },
            ],
          })
        )}
      />
    );

    expect(
      screen.getByText(/2 encoding sessions running now/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("polls the encoding endpoint and applies fresh data", async () => {
    vi.useFakeTimers();
    const updated = artifact(
      encodingStatus({
        active_session_count: 1,
        latest_runs: [
          {
            ...encodingStatus().latest_runs[0],
            id: "enc-2",
            citation: "7 CFR 273.9",
          },
        ],
      })
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => updated,
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LiveEncodingPanel
        initial={artifact(encodingStatus())}
        pollIntervalMs={1000}
      />
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/ops/encoding", {
      cache: "no-store",
    });
    expect(screen.getByText("7 CFR 273.9")).toBeInTheDocument();
    expect(
      screen.getByText(/1 encoding session running now/i)
    ).toBeInTheDocument();
  });

  it("keeps the last good data and surfaces the error when a poll fails", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LiveEncodingPanel
        initial={artifact(encodingStatus())}
        pollIntervalMs={1000}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(screen.getByText("C.R.S. 26-2-703")).toBeInTheDocument();
    expect(
      screen.getByText(/encoding status endpoint returned 502/i)
    ).toBeInTheDocument();
  });

  it("refreshes immediately when the tab becomes visible again", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => artifact(encodingStatus({ active_session_count: 3 })),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LiveEncodingPanel
        initial={artifact(encodingStatus())}
        pollIntervalMs={60_000}
      />
    );

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/3 encoding sessions running now/i)
    ).toBeInTheDocument();
  });

  it("formats durations, costs, and missing metadata across runs", () => {
    render(
      <LiveEncodingPanel
        initial={artifact(
          encodingStatus({
            latest_runs: [
              {
                ...encodingStatus().latest_runs[0],
                id: "enc-ms",
                citation: null,
                total_duration_ms: 500,
                agent_model: null,
                agent_type: null,
                data_source: null,
                has_issues: true,
                encoder_version: null,
              },
              {
                ...encodingStatus().latest_runs[0],
                id: "enc-sec",
                citation: "7 CFR 273.10",
                total_duration_ms: 42_500,
              },
            ],
            latest_sessions: [
              {
                ...encodingStatus().latest_sessions[0],
                id: "sdk-costly",
                model: null,
                estimated_cost_usd: 12.5,
              },
            ],
            latest_source_counts: {},
          })
        )}
      />
    );

    expect(screen.getByText("enc-ms")).toBeInTheDocument();
    expect(screen.getByText("500ms")).toBeInTheDocument();
    expect(screen.getByText("42.5s")).toBeInTheDocument();
    expect(screen.getByText("Check")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText(/Unknown model/)).toBeInTheDocument();
    expect(screen.getByText("No source mix recorded yet.")).toBeInTheDocument();
  });

  it("renders empty run and session states", () => {
    render(
      <LiveEncodingPanel
        initial={artifact(
          encodingStatus({
            run_count: 0,
            recent_run_count: null,
            issue_run_count: null,
            active_session_count: null,
            earliest_run_at: null,
            latest_runs: [],
            latest_sessions: [],
            latest_source_counts: {},
          })
        )}
      />
    );

    expect(screen.getByText("No encoding runs recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("No SDK sessions recorded yet.")).toBeInTheDocument();
    expect(screen.getByText(/session status unavailable/i)).toBeInTheDocument();
  });

  it("groups live runs by machine and counts them in the headline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:30.000Z"));
    render(
      <LiveEncodingPanel
        initial={artifact(
          encodingStatus({
            live_runs: [
              liveRun(),
              liveRun({
                id: "live-2",
                citation: "nz/statute/social-security/23",
                attempt: 2,
                model: "gpt-5.5-max",
                runner: {
                  hostname: "linux-ci",
                  username: "runner",
                  platform: "linux",
                  pid: 9,
                  is_ci: true,
                },
              }),
            ],
          })
        )}
      />
    );

    expect(
      screen.getByText(/2 encodes running on 2 machines/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Machines")).toBeInTheDocument();
    expect(screen.getByText("mac-a.local")).toBeInTheDocument();
    expect(screen.getByText("linux-ci")).toBeInTheDocument();
    expect(screen.getByText(/runner\s*· CI/)).toBeInTheDocument();
    expect(screen.getAllByText("Encoding")).toHaveLength(2);
    expect(screen.getByText("us/statute/26/32")).toBeInTheDocument();
    expect(screen.getByText(/attempt 2/)).toBeInTheDocument();
    // Elapsed for a live run tracks the clock: started 11:50:00, now 12:00:30.
    expect(screen.getAllByText(/10m 30s/)).toHaveLength(2);
  });

  it("flags running rows with lost heartbeats as stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:30.000Z"));
    render(
      <LiveEncodingPanel
        initial={artifact(
          encodingStatus({
            live_runs: [
              liveRun({
                last_heartbeat_at: "2026-07-01T11:55:00.000Z",
              }),
            ],
          })
        )}
      />
    );

    expect(
      screen.getByText(/1 encode stalled — heartbeat lost/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/last heartbeat 5m 30s ago/i)).toBeInTheDocument();
  });

  it("drops stale rows an hour after their last heartbeat", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:30.000Z"));
    render(
      <LiveEncodingPanel
        initial={artifact(
          encodingStatus({
            live_runs: [
              liveRun({
                id: "live-long-dead",
                citation: "us/statute/26/long-dead",
                last_heartbeat_at: "2026-07-01T10:45:00.000Z",
              }),
            ],
          })
        )}
      />
    );

    expect(screen.queryByText("us/statute/26/long-dead")).not.toBeInTheDocument();
    expect(screen.queryByText("Machines")).not.toBeInTheDocument();
    expect(
      screen.getByText(/no encoding sessions running/i)
    ).toBeInTheDocument();
  });

  it("shows recently finished runs and ages out old ones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:30.000Z"));
    render(
      <LiveEncodingPanel
        initial={artifact(
          encodingStatus({
            live_runs: [
              liveRun({
                id: "live-done",
                citation: "us/statute/26/151",
                status: "completed",
                finished_at: "2026-07-01T11:45:00.000Z",
                last_heartbeat_at: "2026-07-01T11:45:00.000Z",
                run_id: "run-1",
              }),
              liveRun({
                id: "live-old",
                citation: "us/statute/26/ancient",
                status: "failed",
                finished_at: "2026-07-01T10:30:00.000Z",
                last_heartbeat_at: "2026-07-01T10:30:00.000Z",
              }),
            ],
          })
        )}
      />
    );

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("us/statute/26/151")).toBeInTheDocument();
    expect(screen.queryByText("us/statute/26/ancient")).not.toBeInTheDocument();
    // No running rows → the headline falls back to session state.
    expect(
      screen.getByText(/no encoding sessions running/i)
    ).toBeInTheDocument();
  });

  it("renders the unavailable state when there is no data at all", () => {
    render(
      <LiveEncodingPanel
        initial={artifact(null, "NEXT_PUBLIC_SUPABASE_URL is not configured")}
      />
    );

    expect(
      screen.getByText(/encoding telemetry is unavailable/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/NEXT_PUBLIC_SUPABASE_URL is not configured/i)
    ).toBeInTheDocument();
  });
});
