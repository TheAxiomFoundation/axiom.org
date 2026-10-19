import type {
  Control,
  EventRow,
  ParticipantRow,
  PledgeRow,
  PromptRow,
  PublicPledge,
  RunData,
} from "./types";

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
  setControl(patch: { runId?: string; stage?: string }): Promise<Control>;
  upsertParticipant(row: ParticipantRow): Promise<void>;
  insertPrompt(row: PromptRow): Promise<void>;
  /** Patches a participant's own prompt; false when no row matched. */
  updatePrompt(id: string, participantId: string, patch: Partial<PromptRow>): Promise<boolean>;
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

  return {
    kind: "supabase",
    async getControl() {
      const rows = await request<ControlRow[]>(
        "aspen_control?id=eq.live&select=run_id,stage,updated_at",
      );
      return toControl(rows[0]);
    },
    async setControl(patch) {
      const body: Record<string, string> = { updated_at: new Date().toISOString() };
      if (patch.runId) body.run_id = patch.runId;
      if (patch.stage) body.stage = patch.stage;
      const rows = await request<ControlRow[]>(
        "aspen_control?id=eq.live&select=run_id,stage,updated_at",
        { method: "PATCH", body, prefer: "return=representation" },
      );
      return toControl(rows[0]);
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
    async updatePrompt(id, participantId, patch) {
      const rows = await request<{ id: string }[]>(
        `aspen_prompts?id=eq.${encodeURIComponent(id)}&participant_id=eq.${encodeURIComponent(participantId)}&select=id`,
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
          `aspen_prompts?${runFilter(runId)}&select=id,run_id,participant_id,conversation_id,turn,created_at,perspective,household_id,question_id,prompt,twists,answer,error,verdict,would_act,resident_action,went_well,went_wrong,rating_note,rules_program,rules_period,rules_amount,post_check_verdict&${order}`,
        ),
        request<EventRow[]>(
          `aspen_events?${runFilter(runId)}&kind=in.(discussion,breakout,survey,vote)&select=run_id,kind,stage,payload,created_at&${order}`,
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
      state.control = {
        ...state.control,
        ...(patch.runId ? { runId: patch.runId } : {}),
        ...(patch.stage ? { stage: patch.stage } : {}),
        updatedAt: now(),
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
    async updatePrompt(id, participantId, patch) {
      const row = state.prompts.get(id);
      if (!row || row.participant_id !== participantId) return false;
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
        prompts: inRun(state.prompts.values()),
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
 * The active run and stage, cached for two seconds per instance so a
 * room of phones polling does not each hit the database. A store error
 * (e.g. the migration has not run yet) falls back to the default run.
 */
export async function readControl(store: AspenStore | null, fresh = false): Promise<Control> {
  if (!store) return { ...DEFAULT_CONTROL };
  if (!fresh && controlCache && Date.now() - controlCache.at < CONTROL_TTL_MS) {
    return controlCache.value;
  }
  try {
    const value = await store.getControl();
    controlCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error("[aspen] control read failed:", error);
    return { ...DEFAULT_CONTROL };
  }
}

/** Writes the control row and refreshes this instance's cache. */
export async function writeControl(
  store: AspenStore,
  patch: { runId?: string; stage?: string },
): Promise<Control> {
  const value = await store.setControl(patch);
  controlCache = { at: Date.now(), value };
  return value;
}

export function _resetControlCache() {
  controlCache = null;
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
