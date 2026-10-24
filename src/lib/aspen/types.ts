/** Row shapes for the Aspen convening tables (supabase/migrations/*_aspen_convening.sql). */

export interface Control {
  runId: string;
  stage: string;
  updatedAt: string | null;
  /** False when no store is configured: the page runs, nothing syncs. */
  live: boolean;
}

export interface ParticipantRow {
  id: string;
  run_id: string;
  perspective?: string | null;
  state?: string | null;
  role?: string | null;
  user_agent?: string | null;
  last_seen_at?: string;
}

export interface PromptRow {
  id: string;
  run_id: string;
  participant_id: string;
  conversation_id: string;
  turn: number;
  created_at?: string;
  stage?: string | null;
  perspective?: string | null;
  household_id?: string | null;
  question_id?: string | null;
  twists?: string[] | null;
  prompt_template?: string | null;
  prompt: string;
  edited?: boolean | null;
  backend?: string | null;
  model?: string | null;
  web_search?: boolean | null;
  answer?: string | null;
  answer_sources?: { url: string; title?: string }[] | null;
  latency_ms?: number | null;
  error?: string | null;
  rated_at?: string | null;
  verdict?: string | null;
  would_act?: string | null;
  resident_action?: string | null;
  went_well?: string[] | null;
  went_wrong?: string[] | null;
  rating_note?: string | null;
  /** The rules check's columns: phones saved them until October 16, 2026 (results.ts SavedCheck); nothing writes them now. */
  rules_requested_at?: string | null;
  rules_answer?: string | null;
  rules_program?: string | null;
  rules_period?: string | null;
  rules_amount?: number | null;
  rules_outputs?: unknown;
  /** Read out of rules_outputs by the run's select (store.ts RUN_PROMPT_SELECT), not a column. */
  rules_program_id?: string | null;
  /** Read out of rules_outputs by the run's select: the check's saved eligibilityTested. */
  rules_eligibility_tested?: boolean | null;
  rules_latency_ms?: number | null;
  rules_error?: string | null;
  post_check_verdict?: string | null;
}

export interface EventRow {
  run_id: string;
  participant_id?: string | null;
  kind: string;
  stage?: string | null;
  payload: Record<string, unknown>;
  created_at?: string;
}

export interface PledgeRow {
  id?: string;
  run_id: string;
  participant_id?: string | null;
  name?: string | null;
  title?: string | null;
  state?: string | null;
  email: string;
  accurate_ai: boolean;
  state_systems: boolean;
  show_state: boolean;
  note?: string | null;
  created_at?: string;
}

/** What the results view may read: never emails, names or participant ids of pledges. */
export interface PublicPledge {
  state: string | null;
  accurate_ai: boolean;
  state_systems: boolean;
  show_state: boolean;
  created_at?: string;
}

export interface RunData {
  participants: ParticipantRow[];
  prompts: PromptRow[];
  events: EventRow[];
  pledges: PublicPledge[];
}
