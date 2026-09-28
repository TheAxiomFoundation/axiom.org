"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CorpusStatusArtifact,
  EncodingOpsStatus,
  EncodingStatusRun,
  EncodingStatusSession,
  LiveEncodingRun,
} from "@/lib/corpus-status";

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const CLOCK_TICK_MS = 5_000;
/** A running row whose heartbeat is older than this is presumed dead. */
const STALE_HEARTBEAT_MS = 2 * 60 * 1000;
/** Finished runs stay on the machine board this long after completion. */
const FINISHED_DISPLAY_WINDOW_MS = 60 * 60 * 1000;
/** Stale (presumed dead) runs drop off the board this long after their last heartbeat. */
const STALE_DISPLAY_WINDOW_MS = 60 * 60 * 1000;

interface LiveEncodingPanelProps {
  initial: CorpusStatusArtifact<EncodingOpsStatus>;
  pollIntervalMs?: number;
}

type PillTone = "good" | "warn" | "bad" | "neutral";

export function LiveEncodingPanel({
  initial,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: LiveEncodingPanelProps) {
  const [artifact, setArtifact] = useState(initial);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch("/api/ops/encoding", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Encoding status endpoint returned ${response.status}`);
      }
      const next = (await response.json()) as CorpusStatusArtifact<EncodingOpsStatus>;
      setArtifact((current) => (next.value ? next : { ...next, value: current.value }));
      setLastUpdatedAt(Date.now());
    } catch (error) {
      setArtifact((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
      setLastUpdatedAt(Date.now());
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollIntervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollIntervalMs, refresh]);

  const status = artifact.value;
  const activeSessions = status?.active_session_count ?? null;
  // Reference clock for heartbeat freshness: the client clock once hydrated,
  // otherwise the report's own timestamp so server and client markup match.
  const referenceMs =
    now ?? (status ? Date.parse(status.refreshed_at) : Number.NaN);
  const machineGroups = groupLiveRunsByMachine(
    status?.live_runs ?? [],
    referenceMs
  );
  const liveRunCount = countRuns(machineGroups, "live");
  const liveMachineCount = machineGroups.filter((group) =>
    group.runs.some((entry) => entry.state === "live")
  ).length;
  const staleRunCount = countRuns(machineGroups, "stale");
  const isLive = liveRunCount > 0 || (activeSessions ?? 0) > 0;

  return (
    <div className="mt-3 border border-[var(--color-rule)] rounded-md bg-[var(--color-paper-elevated)]">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--color-rule)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`relative flex h-2.5 w-2.5 ${isLive ? "" : "opacity-60"}`}
            aria-hidden="true"
          >
            {isLive && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-60" />
            )}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                isLive
                  ? "bg-[var(--color-success)]"
                  : "bg-[var(--color-ink-muted)]"
              }`}
            />
          </span>
          <span className="text-sm font-medium text-[var(--color-ink)]">
            {headline(liveRunCount, liveMachineCount, staleRunCount, activeSessions)}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
          {freshnessLabel(now, lastUpdatedAt, status?.refreshed_at ?? null)} ·
          refreshes every {Math.round(pollIntervalMs / 1000)}s
        </span>
      </div>

      {artifact.error && (
        <div className="border-b border-[var(--color-rule)] bg-[rgba(180,83,9,0.07)] px-4 py-2 text-xs text-[var(--color-warning)]">
          Live refresh degraded: {artifact.error}
        </div>
      )}

      {status ? (
        <>
          <dl className="grid grid-cols-2 gap-px border-b border-[var(--color-rule)] bg-[var(--color-rule)] md:grid-cols-4">
            <LiveMetric
              label={`Runs last ${status.lookback_days}d`}
              value={formatNullableNumber(status.recent_run_count)}
            />
            <LiveMetric
              label="Active sessions"
              value={formatNullableNumber(status.active_session_count)}
            />
            <LiveMetric
              label="Runs with issues"
              value={formatNullableNumber(status.issue_run_count)}
            />
            <LiveMetric
              label="Runs recorded"
              value={formatNullableNumber(status.run_count)}
              hint={
                status.earliest_run_at
                  ? `telemetry since ${formatUtcDay(status.earliest_run_at)}`
                  : undefined
              }
            />
          </dl>

          {machineGroups.length > 0 && (
            <div className="border-b border-[var(--color-rule)]">
              <h3 className="px-4 pt-3 pb-2 font-mono text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                Machines
              </h3>
              <div className="grid grid-cols-1 gap-px border-t border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-2 xl:grid-cols-3">
                {machineGroups.map((group) => (
                  <MachineCard
                    key={group.key}
                    group={group}
                    referenceMs={referenceMs}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-[var(--color-rule-subtle)] text-[var(--color-ink-muted)]">
                  <tr className="font-mono text-[10px] uppercase tracking-wider">
                    <th className="text-left font-medium px-4 py-3">Citation</th>
                    <th className="text-left font-medium px-4 py-3">Source</th>
                    <th className="text-left font-medium px-4 py-3">Model</th>
                    <th className="text-right font-medium px-4 py-3">Duration</th>
                    <th className="text-left font-medium px-4 py-3">Issues</th>
                    <th className="text-left font-medium px-4 py-3">Run</th>
                  </tr>
                </thead>
                <tbody>
                  {status.latest_runs.length > 0 ? (
                    status.latest_runs.map((run) => (
                      <LiveEncodingRunRow key={run.id} run={run} />
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-[var(--color-ink-secondary)]"
                      >
                        No encoding runs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <aside className="border-t border-[var(--color-rule)] p-4 xl:border-l xl:border-t-0">
              <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                SDK Sessions
              </h3>
              <div className="mt-2 divide-y divide-[var(--color-rule)]">
                {status.latest_sessions.length > 0 ? (
                  status.latest_sessions.slice(0, 5).map((session) => (
                    <LiveEncodingSessionRow key={session.id} session={session} />
                  ))
                ) : (
                  <p className="py-3 text-sm text-[var(--color-ink-secondary)]">
                    No SDK sessions recorded yet.
                  </p>
                )}
              </div>
              <h3 className="mt-4 font-mono text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">
                Latest Sources
              </h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                {Object.entries(status.latest_source_counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([source, count]) => (
                    <div
                      key={source}
                      className="flex items-center justify-between gap-3"
                    >
                      <dt className="text-[var(--color-ink-secondary)]">
                        {labelize(source)}
                      </dt>
                      <dd className="font-mono text-xs tnum text-[var(--color-ink)]">
                        {formatNumber(count)}
                      </dd>
                    </div>
                  ))}
                {Object.keys(status.latest_source_counts).length === 0 && (
                  <div className="text-[var(--color-ink-secondary)]">
                    No source mix recorded yet.
                  </div>
                )}
              </dl>
            </aside>
          </div>
        </>
      ) : (
        <div className="p-5 text-sm text-[var(--color-ink-secondary)]">
          Encoding telemetry is unavailable from Supabase.
        </div>
      )}
    </div>
  );
}

type LiveRunState = "live" | "stale" | "completed" | "failed";

interface MachineRunEntry {
  run: LiveEncodingRun;
  state: LiveRunState;
}

interface MachineGroup {
  key: string;
  hostname: string;
  username: string | null;
  isCi: boolean;
  runs: MachineRunEntry[];
}

function headline(
  liveRunCount: number,
  liveMachineCount: number,
  staleRunCount: number,
  activeSessions: number | null
): string {
  if (liveRunCount > 0) {
    const machines =
      liveMachineCount === 1 ? "1 machine" : `${liveMachineCount} machines`;
    return `${liveRunCount} encode${liveRunCount === 1 ? "" : "s"} running on ${machines}`;
  }
  if (staleRunCount > 0) {
    return `${staleRunCount} encode${staleRunCount === 1 ? "" : "s"} stalled — heartbeat lost`;
  }
  if (activeSessions == null) return "Session status unavailable";
  if (activeSessions > 0) {
    return `${formatNumber(activeSessions)} encoding session${activeSessions === 1 ? "" : "s"} running now`;
  }
  return "No encoding sessions running";
}

function classifyLiveRun(run: LiveEncodingRun, referenceMs: number): LiveRunState {
  if (run.status === "running") {
    const heartbeatMs = Date.parse(run.last_heartbeat_at);
    if (
      !Number.isNaN(heartbeatMs) &&
      !Number.isNaN(referenceMs) &&
      referenceMs - heartbeatMs > STALE_HEARTBEAT_MS
    ) {
      return "stale";
    }
    return "live";
  }
  return run.status === "failed" ? "failed" : "completed";
}

function groupLiveRunsByMachine(
  liveRuns: LiveEncodingRun[],
  referenceMs: number
): MachineGroup[] {
  const groups = new Map<string, MachineGroup>();
  for (const run of liveRuns) {
    const state = classifyLiveRun(run, referenceMs);
    // Finished and long-dead runs age off the board; live rows never do.
    if (state === "completed" || state === "failed") {
      const finishedMs = Date.parse(run.finished_at ?? run.last_heartbeat_at);
      if (
        Number.isNaN(finishedMs) ||
        Number.isNaN(referenceMs) ||
        referenceMs - finishedMs > FINISHED_DISPLAY_WINDOW_MS
      ) {
        continue;
      }
    } else if (state === "stale") {
      const heartbeatMs = Date.parse(run.last_heartbeat_at);
      if (
        Number.isNaN(heartbeatMs) ||
        Number.isNaN(referenceMs) ||
        referenceMs - heartbeatMs > STALE_DISPLAY_WINDOW_MS
      ) {
        continue;
      }
    }
    const hostname = run.runner?.hostname || "Unknown machine";
    const username = run.runner?.username || null;
    const key = `${hostname}|${username ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        hostname,
        username,
        isCi: run.runner?.is_ci === true,
        runs: [],
      };
      groups.set(key, group);
    }
    group.runs.push({ run, state });
  }
  const stateRank: Record<LiveRunState, number> = {
    live: 0,
    stale: 1,
    failed: 2,
    completed: 3,
  };
  const result = [...groups.values()];
  for (const group of result) {
    group.runs.sort(
      (a, b) =>
        stateRank[a.state] - stateRank[b.state] ||
        stringCompareDesc(a.run.started_at, b.run.started_at)
    );
  }
  result.sort(
    (a, b) =>
      stateRank[a.runs[0].state] - stateRank[b.runs[0].state] ||
      stringCompareDesc(a.runs[0].run.started_at, b.runs[0].run.started_at)
  );
  return result;
}

function countRuns(groups: MachineGroup[], state: LiveRunState): number {
  return groups.reduce(
    (total, group) =>
      total + group.runs.filter((entry) => entry.state === state).length,
    0
  );
}

function stringCompareDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

function MachineCard({
  group,
  referenceMs,
}: {
  group: MachineGroup;
  referenceMs: number;
}) {
  return (
    <div className="bg-[var(--color-paper-elevated)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-[var(--color-ink)]">
            {group.hostname}
          </div>
          {group.username && (
            <div className="mt-0.5 font-mono text-[10px] text-[var(--color-ink-muted)]">
              {group.username}
              {group.isCi ? " · CI" : ""}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {group.runs.map(({ run, state }) => (
          <MachineRunRow
            key={run.id}
            run={run}
            state={state}
            referenceMs={referenceMs}
          />
        ))}
      </div>
    </div>
  );
}

function MachineRunRow({
  run,
  state,
  referenceMs,
}: {
  run: LiveEncodingRun;
  state: LiveRunState;
  referenceMs: number;
}) {
  const startedMs = Date.parse(run.started_at);
  const endMs =
    state === "live"
      ? referenceMs
      : Date.parse(run.finished_at ?? run.last_heartbeat_at);
  const elapsed =
    Number.isNaN(startedMs) || Number.isNaN(endMs)
      ? null
      : Math.max(0, endMs - startedMs);
  const heartbeatMs = Date.parse(run.last_heartbeat_at);
  const heartbeatAge =
    Number.isNaN(heartbeatMs) || Number.isNaN(referenceMs)
      ? null
      : Math.max(0, referenceMs - heartbeatMs);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 truncate text-sm font-medium text-[var(--color-ink)]">
          {run.citation}
        </div>
        <LivePill label={liveRunPillLabel(state)} tone={liveRunPillTone(state)} />
      </div>
      <div className="mt-1 text-xs text-[var(--color-ink-secondary)]">
        {run.model ?? "Unknown model"}
        {run.attempt != null && run.attempt > 1 ? ` · attempt ${run.attempt}` : ""}
        {elapsed != null ? ` · ${formatDuration(elapsed)}` : ""}
        {run.runner?.reported_via === "public_ingest" ? " · self-reported" : ""}
      </div>
      {state === "stale" && heartbeatAge != null && (
        <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-error)]">
          last heartbeat {formatDuration(heartbeatAge)} ago
        </div>
      )}
    </div>
  );
}

function liveRunPillLabel(state: LiveRunState): string {
  if (state === "live") return "Encoding";
  if (state === "stale") return "Stale";
  if (state === "failed") return "Failed";
  return "Completed";
}

function liveRunPillTone(state: LiveRunState): PillTone {
  if (state === "live") return "good";
  if (state === "stale") return "bad";
  if (state === "failed") return "warn";
  return "neutral";
}

function LiveMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-[var(--color-paper-elevated)] p-3">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-semibold tnum text-[var(--color-ink)]">
        {value}
        {hint && (
          <span className="mt-0.5 block text-[10px] font-normal text-[var(--color-ink-muted)]">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

function LiveEncodingRunRow({ run }: { run: EncodingStatusRun }) {
  return (
    <tr className="border-t border-[var(--color-rule)]">
      <td className="px-4 py-3">
        <div className="max-w-[320px] truncate font-medium text-[var(--color-ink)]">
          {run.citation ?? run.id}
        </div>
        {run.encoder_version && (
          <div className="mt-1 font-mono text-[10px] uppercase text-[var(--color-ink-muted)]">
            encoder {run.encoder_version}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-[var(--color-ink-secondary)]">
        {labelize(run.data_source)}
      </td>
      <td className="px-4 py-3 text-[var(--color-ink-secondary)]">
        {run.agent_model ?? run.agent_type ?? "-"}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs tnum">
        {formatDuration(run.total_duration_ms)}
      </td>
      <td className="px-4 py-3">
        <LivePill
          label={run.has_issues ? "Check" : "Clear"}
          tone={run.has_issues ? "warn" : "good"}
        />
      </td>
      <td className="px-4 py-3 font-mono text-xs text-[var(--color-ink-muted)]">
        {formatUtcShortDate(run.timestamp)}
      </td>
    </tr>
  );
}

function LiveEncodingSessionRow({ session }: { session: EncodingStatusSession }) {
  const running = session.ended_at == null;
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-[var(--color-ink)]">
            {session.id}
          </div>
          <div className="mt-1 text-xs text-[var(--color-ink-secondary)]">
            {session.model ?? "Unknown model"} /{" "}
            {formatUtcShortDate(session.started_at)}
          </div>
        </div>
        <LivePill
          label={running ? "Running" : "Finished"}
          tone={running ? "good" : "neutral"}
        />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        <div>
          <dt>Events</dt>
          <dd className="mt-1 tnum text-[var(--color-ink)]">
            {formatNumber(session.event_count)}
          </dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd className="mt-1 tnum text-[var(--color-ink)]">
            {formatNumber(session.input_tokens + session.output_tokens)}
          </dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd className="mt-1 tnum text-[var(--color-ink)]">
            {formatCost(session.estimated_cost_usd)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function LivePill({ label, tone }: { label: string; tone: PillTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${pillClass(tone)}`}
    >
      {label}
    </span>
  );
}

function pillClass(tone: PillTone): string {
  if (tone === "good") {
    return "border-[rgba(22,101,52,0.25)] bg-[rgba(22,101,52,0.08)] text-[var(--color-success)]";
  }
  if (tone === "warn") {
    return "border-[rgba(180,83,9,0.3)] bg-[rgba(180,83,9,0.08)] text-[var(--color-warning)]";
  }
  if (tone === "bad") {
    return "border-[rgba(153,27,27,0.3)] bg-[rgba(153,27,27,0.08)] text-[var(--color-error)]";
  }
  return "border-[var(--color-rule)] bg-[var(--color-rule-subtle)] text-[var(--color-ink-muted)]";
}

function freshnessLabel(
  now: number | null,
  lastUpdatedAt: number | null,
  refreshedAt: string | null
): string {
  // Before the client clock starts (server render + hydration), fall back to
  // the report's own timestamp so server and client markup match.
  if (now == null) {
    return refreshedAt ? `as of ${formatUtcShortDate(refreshedAt)}` : "awaiting data";
  }
  const reference =
    lastUpdatedAt ?? (refreshedAt ? Date.parse(refreshedAt) : null);
  if (reference == null || Number.isNaN(reference)) return "awaiting data";
  const seconds = Math.max(0, Math.round((now - reference) / 1000));
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  return `updated ${Math.round(minutes / 60)}h ago`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatNullableNumber(value: number | null): string {
  return value == null ? "-" : formatNumber(value);
}

function formatUtcShortDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function formatUtcDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDuration(value: number | null): string {
  if (value == null) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function formatCost(value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 3 : 2,
    maximumFractionDigits: value < 1 ? 3 : 2,
  }).format(value);
}

function labelize(value: string | null): string {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ");
}
