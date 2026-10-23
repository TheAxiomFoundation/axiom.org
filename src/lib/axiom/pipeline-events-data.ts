import { readFile } from "node:fs/promises";
import { getSupabaseRestConfig, readSupabaseRows } from "@/lib/corpus-status";
import { getPipelineAttempts } from "./encoding-pipeline-data";
import { attemptEvents, type PipelineEvent } from "./pipeline-events";
import type { StationTarget } from "./pipeline-flow";

const PAGE_SIZE = 1000;
/** Room for every event of the pipeline's history several times over. */
const MAX_PAGES = 200;

/** Where the events came from: the table, a dev file, or derived from pipeline_attempts in-process. */
export type EventsOrigin = "table" | "file" | "derived";

export interface PipelineEventsResult {
  events: PipelineEvent[];
  origin: EventsOrigin;
  available: boolean;
  error: string | null;
}

/**
 * Every pipeline event. Reads encodings.pipeline_events; while that table is
 * missing or empty (migration not applied, backfill not run) it derives the
 * events from encodings.pipeline_attempts, so the page works either way.
 * The derived log lacks the archived issue lists the backfill adds.
 *
 * In development, AXIOM_OPS_EVENTS_FILE may point at a backfill dry run
 * (`bun scripts/backfill-pipeline-events.mjs --out <file>`).
 */
export async function getPipelineEvents(): Promise<PipelineEventsResult> {
  const file = process.env.AXIOM_OPS_EVENTS_FILE;
  if (file && process.env.NODE_ENV === "development") {
    try {
      const events = JSON.parse(await readFile(file, "utf8")) as PipelineEvent[];
      return { events, origin: "file", available: true, error: null };
    } catch (error) {
      return { events: [], origin: "file", available: false, error: message(error) };
    }
  }

  const config = getSupabaseRestConfig();
  if (config) {
    try {
      const events: PipelineEvent[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const rows = await readSupabaseRows<PipelineEvent>(config, "encodings", "pipeline_events", {
          select: "*",
          order: "id.asc",
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        events.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      if (events.length) return { events, origin: "table", available: true, error: null };
    } catch (error) {
      // PostgREST answers 404 for a table it does not know: derive instead.
      if (!/returned 404/.test(message(error))) {
        return { events: [], origin: "table", available: false, error: message(error) };
      }
    }
  }

  const pipeline = await getPipelineAttempts();
  return {
    events: pipeline.attempts.flatMap(attemptEvents),
    origin: "derived",
    available: pipeline.available,
    error: pipeline.error,
  };
}

/**
 * The events that match a PostgREST filter, from the same source
 * getPipelineEvents would read: the table (filtered there), else the dev
 * file or the derived log (filtered here, `keep` deciding).
 */
async function filteredEvents(filter: Record<string, string>, keep: (e: PipelineEvent) => boolean, derive: () => Promise<PipelineEventsResult>): Promise<PipelineEventsResult> {
  const file = process.env.AXIOM_OPS_EVENTS_FILE;
  if (file && process.env.NODE_ENV === "development") {
    const all = await getPipelineEvents();
    return { ...all, events: all.events.filter(keep) };
  }
  const config = getSupabaseRestConfig();
  if (config) {
    try {
      const events: PipelineEvent[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const rows = await readSupabaseRows<PipelineEvent>(config, "encodings", "pipeline_events", {
          select: "*",
          ...filter,
          order: "id.asc",
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        events.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      // An empty answer may mean the backfill has not run: derive instead.
      if (events.length) return { events, origin: "table", available: true, error: null };
    } catch (error) {
      if (!/returned 404/.test(message(error))) {
        return { events: [], origin: "table", available: false, error: message(error) };
      }
    }
  }
  return derive();
}

/** One citation's events, for the journey: filtered in the table, or derived from that citation's attempts only. */
export async function getCitationEvents(citation: string): Promise<PipelineEventsResult> {
  return filteredEvents(
    { citation: `eq.${citation}` },
    (e) => e.citation === citation,
    async () => {
      const pipeline = await getPipelineAttempts();
      return {
        events: pipeline.attempts.filter((a) => a.citation === citation).flatMap(attemptEvents),
        origin: "derived",
        available: pipeline.available,
        error: pipeline.error,
      };
    }
  );
}

/**
 * The starting targets, as the migration seeds them. Used only while
 * encodings.pipeline_station_targets is not there.
 */
export const SEED_TARGETS: StationTarget[] = [
  { station: "approval", min_yield: 0.9, max_p95_hours: 12, max_wip: 20, sla_hours: 24 },
  { station: "setup", min_yield: 0.9, max_p95_hours: 0.5, max_wip: null, sla_hours: 2 },
  { station: "validate", min_yield: 0.3, max_p95_hours: 1, max_wip: null, sla_hours: 3 },
  { station: "publish", min_yield: 0.95, max_p95_hours: 0.5, max_wip: null, sla_hours: 2 },
  { station: "pr_checks", min_yield: 0.8, max_p95_hours: 6, max_wip: 50, sla_hours: 72 },
  { station: "review", min_yield: 0.5, max_p95_hours: 72, max_wip: 100, sla_hours: 72 },
  { station: "index", min_yield: 0.95, max_p95_hours: 8, max_wip: null, sla_hours: 8 },
  { station: "compile", min_yield: 0.95, max_p95_hours: 36, max_wip: null, sla_hours: 36 },
  { station: "tests", min_yield: 0.9, max_p95_hours: 36, max_wip: null, sla_hours: 36 },
];

export async function getStationTargets(): Promise<{ targets: StationTarget[]; seeded: boolean }> {
  const config = getSupabaseRestConfig();
  if (!config) return { targets: SEED_TARGETS, seeded: true };
  try {
    const rows = await readSupabaseRows<StationTarget>(config, "encodings", "pipeline_station_targets", {
      select: "station,min_yield,max_p95_hours,max_wip,sla_hours,note",
    });
    const targets = rows.map((r) => ({
      ...r,
      min_yield: num(r.min_yield),
      max_p95_hours: num(r.max_p95_hours),
      max_wip: num(r.max_wip),
      sla_hours: num(r.sla_hours),
    }));
    return targets.length ? { targets, seeded: false } : { targets: SEED_TARGETS, seeded: true };
  } catch {
    return { targets: SEED_TARGETS, seeded: true };
  }
}

/** PostgREST returns numeric columns as strings. */
function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
