import type {
  Control,
  EventRow,
  ParticipantRow,
  PledgeRow,
  PromptRow,
  PublicPledge,
  RunData,
} from "./types";
import { newerControl } from "./control";

/**
 * Storage for the Aspen convening page. Production writes to the
 * corpus Supabase project's public schema (tables aspen_*, RLS on, no
 * policies) with the server-side service key, so the anon key that ships
 * to browsers can neither read nor write them. ASPEN_STORE=memory keeps
 * everything in this process instead: for local development and offline
 * rehearsals, never for production (each serverless instance would hold
 * its own copy).
 */
export interface AspenStore {
  kind: "supabase" | "memory";
  getControl(): Promise<Control>;
  /**
   * Moves the room to a stage, or starts a run, or both. With `inRun`, the run
   * the move was made in, only while the room is still in that run: a move the
   * presenter gave up on that reaches the store after a run switch changes
   * nothing. Answers with the row as it is after.
   */
  setControl(patch: { runId?: string; stage?: string; inRun?: string }): Promise<Control>;
  upsertParticipant(row: ParticipantRow): Promise<void>;
  insertPrompt(row: PromptRow): Promise<void>;
  /**
   * Patches a participant's own prompt; false when no row matched. With
   * `ratedAt`, it applies only over a rating stamped before it, in the same
   * update, so a slow save that arrives after a newer one changes nothing.
   */
  updatePrompt(id: string, participantId: string, patch: Partial<PromptRow>, ratedAt?: string): Promise<boolean>;
  insertEvent(row: EventRow): Promise<void>;
  insertPledge(row: PledgeRow): Promise<void>;
  loadRun(runId: string): Promise<RunData>;
}

export const DEFAULT_CONTROL: Control = {
  runId: "rehearsal",
  stage: "welcome",
  updatedAt: null,
  live: false,
};

const RUN_LIMIT = 5000;

/**
 * The prompt fields the room's results read, for both stores, so a field
 * the Supabase select leaves out is missing in a memory-store rehearsal
 * too, not only in production. The rules check's program id and saved
 * eligibility verdict come out of rules_outputs by JSON path (PostgREST
 * `->` keeps JSON, `->>` gives text), so the results poll doesn't ship
 * every saved computation.
 */
const RUN_PROMPT_COLUMNS = [
  "id",
  "run_id",
  "participant_id",
  "conversation_id",
  "turn",
  "created_at",
  "perspective",
  "household_id",
  "question_id",
  "prompt",
  "twists",
  "answer",
  "error",
  "verdict",
  "would_act",
  "resident_action",
  "went_well",
  "went_wrong",
  "rating_note",
  "rules_program",
  "rules_period",
  "rules_amount",
  "post_check_verdict",
] as const satisfies readonly (keyof PromptRow)[];

const RUN_PROMPT_PATHS = [
  { alias: "rules_program_id", column: "rules_outputs", index: 0, key: "program", text: true },
  { alias: "rules_eligibility_tested", column: "rules_outputs", index: 0, key: "eligibilityTested", text: false },
] as const satisfies readonly { alias: keyof PromptRow; column: keyof PromptRow; index: number; key: string; text: boolean }[];

export const RUN_PROMPT_SELECT = [
  ...RUN_PROMPT_COLUMNS,
  ...RUN_PROMPT_PATHS.map((p) => `${p.alias}:${p.column}->${p.index}${p.text ? "->>" : "->"}${p.key}`),
].join(",");

/** A stored prompt as RUN_PROMPT_SELECT returns it from PostgREST: those fields only, null when absent. */
export function projectRunPrompt(row: PromptRow): PromptRow {
  const out: Record<string, unknown> = {};
  for (const column of RUN_PROMPT_COLUMNS) out[column] = row[column] ?? null;
  for (const path of RUN_PROMPT_PATHS) {
    const list = row[path.column];
    const item: unknown = Array.isArray(list) ? list[path.index] : undefined;
    const value = item && typeof item === "object" ? (item as Record<string, unknown>)[path.key] : undefined;
    out[path.alias] =
      value === undefined || value === null ? null : path.text && typeof value !== "string" ? JSON.stringify(value) : value;
  }
  return out as unknown as PromptRow;
}

// ---------------------------------------------------------------------------
// Supabase (PostgREST)
// ---------------------------------------------------------------------------

interface SupabaseConfig {
  url: string;
  key: string;
}

function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // The same server-only service key the ops telemetry ingest uses.
  const key = process.env.AXIOM_OPS_SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

interface ControlRow {
  run_id: string;
  stage: string;
  updated_at: string | null;
}

function toControl(row: ControlRow | undefined): Control {
  if (!row) return { ...DEFAULT_CONTROL };
  return { runId: row.run_id, stage: row.stage, updatedAt: row.updated_at, live: true };
}

export function createSupabaseStore(
  config: SupabaseConfig,
  fetchImpl: typeof fetch = fetch,
): AspenStore {
  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown; prefer?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
    };
    if (init.prefer) headers.Prefer = init.prefer;
    const response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`aspen store ${init.method ?? "GET"} ${path.split("?")[0]}: ${response.status} ${detail.slice(0, 200)}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  const runFilter = (runId: string) => `run_id=eq.${encodeURIComponent(runId)}`;

  async function getControl(): Promise<Control> {
    const rows = await request<ControlRow[]>("aspen_control?id=eq.live&select=run_id,stage,updated_at");
    return toControl(rows[0]);
  }

  return {
    kind: "supabase",
    getControl,
    async setControl(patch) {
      const updatedAt = new Date().toISOString();
      const body: Record<string, string> = { updated_at: updatedAt };
      if (patch.runId) body.run_id = patch.runId;
      if (patch.stage) body.stage = patch.stage;
      // Only over an older row, checked in the same update: two moves whose writes land out of order
      // leave the row on the later one, so the row always holds the newest stamp, which is how the TV
      // orders rows (control.ts newerControl; the review of #376). A write a later one already
      // beat changes nothing and answers with the row as it is. That holds for the whole write: a run
      // switch that a later stage-only move beat to the row keeps the old run, so the presenter sends
      // no move across a run switch, and sends a run switch beaten that way once more (presenter-app's
      // move). With `inRun`, the same update also checks the row is still in that run, so a move that
      // reaches the store after a run switch, though the presenter gave up on it before sending the
      // switch, changes nothing (the review of #376).
      const inRun = patch.inRun ? `&run_id=eq.${encodeURIComponent(patch.inRun)}` : "";
      const rows = await request<ControlRow[]>(
        `aspen_control?id=eq.live&updated_at=lt.${encodeURIComponent(updatedAt)}${inRun}&select=run_id,stage,updated_at`,
        { method: "PATCH", body, prefer: "return=representation" },
      );
      return rows[0] ? toControl(rows[0]) : getControl();
    },
    async upsertParticipant(row) {
      await request("aspen_participants?on_conflict=id", {
        method: "POST",
        body: { ...row, last_seen_at: new Date().toISOString() },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    },
    async insertPrompt(row) {
      await request("aspen_prompts", { method: "POST", body: row, prefer: "return=minimal" });
    },
    async updatePrompt(id, participantId, patch, ratedAt) {
      // PostgREST's or=() takes a value with dots or colons only in double quotes.
      const older = ratedAt ? `&or=${encodeURIComponent(`(rated_at.is.null,rated_at.lt."${ratedAt}")`)}` : "";
      const rows = await request<{ id: string }[]>(
        `aspen_prompts?id=eq.${encodeURIComponent(id)}&participant_id=eq.${encodeURIComponent(participantId)}${older}&select=id`,
        { method: "PATCH", body: patch, prefer: "return=representation" },
      );
      return rows.length > 0;
    },
    async insertEvent(row) {
      await request("aspen_events", { method: "POST", body: row, prefer: "return=minimal" });
    },
    async insertPledge(row) {
      await request("aspen_pledges", { method: "POST", body: row, prefer: "return=minimal" });
    },
    async loadRun(runId) {
      const order = `order=created_at.asc&limit=${RUN_LIMIT}`;
      const [participants, prompts, events, pledges] = await Promise.all([
        request<ParticipantRow[]>(
          `aspen_participants?${runFilter(runId)}&select=id,run_id,perspective,state,role&order=created_at.asc&limit=${RUN_LIMIT}`,
        ),
        request<PromptRow[]>(
          `aspen_prompts?${runFilter(runId)}&select=${RUN_PROMPT_SELECT}&${order}`,
        ),
        request<EventRow[]>(
          // Ties in time fall back to insert order, so each person's latest answer is the same on every read.
          `aspen_events?${runFilter(runId)}&kind=in.(discussion,breakout,survey,vote)&select=run_id,participant_id,kind,stage,payload,created_at&order=created_at.asc,id.asc&limit=${RUN_LIMIT}`,
        ),
        request<PublicPledge[]>(
          `aspen_pledges?${runFilter(runId)}&select=state,accurate_ai,state_systems,show_state,created_at&${order}`,
        ),
      ]);
      return { participants, prompts, events, pledges };
    },
  };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

interface MemoryState {
  control: Control;
  participants: Map<string, ParticipantRow>;
  prompts: Map<string, PromptRow>;
  events: EventRow[];
  pledges: PledgeRow[];
}

function freshMemory(): MemoryState {
  return {
    control: { ...DEFAULT_CONTROL, live: true },
    participants: new Map(),
    prompts: new Map(),
    events: [],
    pledges: [],
  };
}

export function createMemoryStore(state: MemoryState = freshMemory()): AspenStore {
  const now = () => new Date().toISOString();
  return {
    kind: "memory",
    async getControl() {
      return { ...state.control };
    },
    async setControl(patch) {
      if (patch.inRun && patch.inRun !== state.control.runId) return { ...state.control };
      // Each write is stamped after the one before, even when the clock steps back, so the TV takes
      // the newest write for the newest row (control.ts newerControl), as the phones do.
      const last = Date.parse(state.control.updatedAt ?? "") || 0;
      state.control = {
        ...state.control,
        ...(patch.runId ? { runId: patch.runId } : {}),
        ...(patch.stage ? { stage: patch.stage } : {}),
        updatedAt: new Date(Math.max(Date.now(), last + 1)).toISOString(),
      };
      return { ...state.control };
    },
    async upsertParticipant(row) {
      const existing = state.participants.get(row.id);
      const merged: ParticipantRow = { ...existing, last_seen_at: now() } as ParticipantRow;
      for (const [key, value] of Object.entries(row)) {
        if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
      }
      state.participants.set(row.id, merged);
    },
    async insertPrompt(row) {
      state.prompts.set(row.id, { created_at: now(), ...row });
    },
    async updatePrompt(id, participantId, patch, ratedAt) {
      const row = state.prompts.get(id);
      if (!row || row.participant_id !== participantId) return false;
      if (ratedAt && row.rated_at && !(Date.parse(row.rated_at) < Date.parse(ratedAt))) return false;
      state.prompts.set(id, { ...row, ...patch });
      return true;
    },
    async insertEvent(row) {
      state.events.push({ created_at: now(), ...row });
    },
    async insertPledge(row) {
      state.pledges.push({ created_at: now(), ...row });
    },
    async loadRun(runId) {
      const inRun = <T extends { run_id: string }>(rows: Iterable<T>) =>
        [...rows].filter((r) => r.run_id === runId);
      return {
        participants: inRun(state.participants.values()),
        prompts: inRun(state.prompts.values()).map(projectRunPrompt),
        events: inRun(state.events).filter((e) => ["discussion", "breakout", "survey", "vote"].includes(e.kind)),
        pledges: inRun(state.pledges).map(({ state: st, accurate_ai, state_systems, show_state, created_at }) => ({
          state: st ?? null,
          accurate_ai,
          state_systems,
          show_state,
          created_at,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const globalForStore = globalThis as unknown as { __aspenMemoryStore?: AspenStore };

/** The configured store, or null when the page runs without persistence. */
export function getStore(): AspenStore | null {
  if (process.env.ASPEN_STORE === "memory") {
    globalForStore.__aspenMemoryStore ??= createMemoryStore();
    return globalForStore.__aspenMemoryStore;
  }
  const config = supabaseConfig();
  return config ? createSupabaseStore(config) : null;
}

/** Test hook. */
export function _resetMemoryStore() {
  globalForStore.__aspenMemoryStore = undefined;
}

let controlCache: { at: number; value: Control } | null = null;
const CONTROL_TTL_MS = 2000;

/**
 * Keeps the newer of the cached row and one the store answered with
 * (newerControl), aged from when it was asked for. So a read that started
 * before a write and answers after it never puts the older row back over the
 * write's, which would send the phones polling this instance back to the old
 * run and drop what they saved in the new one (the review of #376). Returns
 * the row kept.
 */
function remember(asked: number, value: Control): Control {
  const kept = newerControl(controlCache?.value ?? null, value);
  if (kept === value) controlCache = { at: asked, value };
  return kept;
}

// This instance's read of the store in flight, if any: when it was asked for, and its answer. Like the
// cache, it is the instance's, not a store object's: each request builds its own store (getStore).
let controlRead: { asked: number; value: Promise<Control> } | null = null;

/**
 * The active run and stage, cached for two seconds per instance so a
 * room of phones polling does not each hit the database: the newest row
 * this instance has read or written. A store error (e.g. the migration
 * has not run yet) falls back to the default run.
 *
 * A read asked for while this instance's last read of the store is still
 * in flight, under two seconds after that one was asked for, takes its
 * answer: a row no older than the cache could serve. So a slow store,
 * whose answers would age out of the cache as they arrive, still gets one
 * read at a time from each instance, not one per phone (the review of #376).
 */
export async function readControl(store: AspenStore | null, fresh = false): Promise<Control> {
  if (!store) return { ...DEFAULT_CONTROL };
  const asked = Date.now();
  if (!fresh && controlCache && asked - controlCache.at < CONTROL_TTL_MS) {
    return controlCache.value;
  }
  if (!fresh && controlRead && asked - controlRead.asked < CONTROL_TTL_MS) {
    return controlRead.value;
  }
  const value = (async () => {
    try {
      return remember(asked, await store.getControl());
    } catch (error) {
      console.error("[aspen] control read failed:", error);
      return { ...DEFAULT_CONTROL };
    }
  })();
  const read = { asked, value };
  controlRead = read;
  void value.finally(() => {
    if (controlRead === read) controlRead = null;
  });
  return value;
}

/** Writes the control row, answers with the store's answer, and keeps it in this instance's cache if it is the newest. */
export async function writeControl(
  store: AspenStore,
  patch: { runId?: string; stage?: string; inRun?: string },
): Promise<Control> {
  const asked = Date.now();
  const value = await store.setControl(patch);
  remember(asked, value);
  return value;
}

export function _resetControlCache() {
  controlCache = null;
  controlRead = null;
}

/** Runs a write and logs instead of throwing: a failed save never breaks the room's session. */
export async function safely<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(`[aspen] ${label} failed:`, error);
    return null;
  }
}
