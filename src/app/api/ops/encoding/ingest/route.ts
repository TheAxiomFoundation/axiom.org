import { NextResponse } from "next/server";
import { clientKey, isRateLimited } from "./limiter";

export const dynamic = "force-dynamic";

/**
 * Public, credential-free telemetry ingest for encode runs.
 *
 * Encoders anywhere — including third parties — report live-run presence
 * here without holding any database credentials: the service key stays
 * server-side. Everything written through this route is stamped
 * `runner.reported_via = "public_ingest"` and can only ever touch rows
 * with that stamp, so self-reported telemetry is cleanly separated from
 * rows written directly by trusted environments. The live board is the
 * low-trust, ephemeral layer; the verified encode history remains
 * anchored in signed apply manifests.
 */

const LIVE_ID_RE = /^live-[a-z0-9]{8,32}$/;
const RUN_STATUSES = new Set(["completed", "failed"]);
const MAX_CITATION_LENGTH = 300;
const MAX_FIELD_LENGTH = 120;
const MAX_ATTEMPT = 1000;
/** How a run ended, on finish: machine tokens, never free text. */
const TOKEN_RE = /^[A-Za-z0-9_.:/-]+$/;
const MAX_OUTCOME_STATUS_LENGTH = 64;
const MAX_ERROR_RULE_LENGTH = 160;
/** Hard ceiling on concurrently 'running' self-reported rows — keeps a
 *  spammer from flooding the board even under rotating client keys. */
const MAX_PUBLIC_RUNNING_ROWS = 200;

interface IngestConfig {
  url: string;
  key: string;
}

function getIngestConfig(): IngestConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.AXIOM_OPS_SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

function restHeaders(config: IngestConfig): Record<string, string> {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json",
    "Content-Profile": "encodings",
  };
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function cleanToken(value: unknown, maxLength: number): string | null {
  const text = cleanText(value, maxLength);
  return text && TOKEN_RE.test(text) ? text : null;
}

/**
 * How the encode ended: its outcome status (or aborted, exited,
 * interrupted) and a typed rule (exception:<Class>, exit:<code>, a check
 * id). Invalid values are dropped, like any other optional field.
 */
function cleanOutcome(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const outcome = cleanToken(body.outcome_status, MAX_OUTCOME_STATUS_LENGTH);
  if (outcome) data.outcome_status = outcome;
  const rule = cleanToken(body.error_rule, MAX_ERROR_RULE_LENGTH);
  if (rule) data.error_rule = rule;
  return data;
}

function cleanAttempt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_ATTEMPT) return null;
  return value;
}

function cleanRunState(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const phase = cleanText(body.phase, MAX_FIELD_LENGTH);
  if (phase) data.phase = phase;
  const attempt = cleanAttempt(body.attempt);
  if (attempt !== null) data.attempt = attempt;
  const model = cleanText(body.model, MAX_FIELD_LENGTH);
  if (model) data.model = model;
  return data;
}

/**
 * Whitelist the runner identity fields; everything else is dropped. GitHub
 * run fields are dropped too: here they are self-reported and unverifiable,
 * and CI encodes that carry them write directly with credentials.
 */
function sanitizeRunner(value: unknown): Record<string, unknown> {
  const runner =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const clean: Record<string, unknown> = {};
  for (const field of ["hostname", "username", "platform"] as const) {
    const text = cleanText(runner[field], MAX_FIELD_LENGTH);
    if (text) clean[field] = text;
  }
  if (typeof runner.pid === "number" && Number.isInteger(runner.pid)) {
    clean.pid = runner.pid;
  }
  if (typeof runner.is_ci === "boolean") clean.is_ci = runner.is_ci;
  // Server-stamped provenance: ingest rows are self-reported and may only
  // ever be modified through this route.
  clean.reported_via = "public_ingest";
  return clean;
}

async function countPublicRunningRows(config: IngestConfig): Promise<number> {
  const response = await fetch(
    `${config.url}/rest/v1/live_encoding_runs?select=id&status=eq.running&runner->>reported_via=eq.public_ingest`,
    {
      method: "HEAD",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Accept-Profile": "encodings",
        Prefer: "count=exact",
      },
      cache: "no-store",
    }
  );
  const range = response.headers.get("content-range");
  const total = range?.split("/")[1];
  const count = total ? Number.parseInt(total, 10) : Number.NaN;
  return Number.isNaN(count) ? 0 : count;
}

/** PostgREST's code for a column the table does not have (PGRST204), and Postgres's (42703). */
const MISSING_COLUMN_CODES = new Set(["PGRST204", "42703"]);

/** A refused write, with the error code of PostgREST's answer when it gave one. */
class IngestWriteError extends Error {
  constructor(
    status: number,
    readonly code: string | null
  ) {
    super(`Supabase returned ${status}`);
  }
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { code?: unknown } | null;
    return typeof body?.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/** Update an ingest-stamped row; any status predicate is atomic with the write. */
async function updateIngestRow(
  config: IngestConfig,
  id: string,
  data: Record<string, unknown>,
  requiredStatus?: "running"
): Promise<boolean> {
  const statusFilter = requiredStatus ? `&status=eq.${requiredStatus}` : "";
  const response = await fetch(
    `${config.url}/rest/v1/live_encoding_runs?id=eq.${encodeURIComponent(id)}&runner->>reported_via=eq.public_ingest${statusFilter}`,
    {
      method: "PATCH",
      headers: { ...restHeaders(config), Prefer: "return=representation" },
      body: JSON.stringify(data),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new IngestWriteError(response.status, await errorCode(response));
  }
  const rows = (await response.json()) as unknown[];
  return rows.length > 0;
}

export async function POST(request: Request) {
  const config = getIngestConfig();
  if (!config) {
    return NextResponse.json({ error: "ingest_unconfigured" }, { status: 503 });
  }
  if (isRateLimited(clientKey(request))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const op = body.op;
  const id = typeof body.id === "string" ? body.id : "";
  if (!LIVE_ID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const now = new Date().toISOString();

  try {
    if (op === "start") {
      const citation = cleanText(body.citation, MAX_CITATION_LENGTH);
      if (!citation) {
        return NextResponse.json({ error: "invalid_citation" }, { status: 400 });
      }
      if ((await countPublicRunningRows(config)) >= MAX_PUBLIC_RUNNING_ROWS) {
        return NextResponse.json({ error: "board_full" }, { status: 429 });
      }
      const row: Record<string, unknown> = {
        id,
        citation,
        status: "running",
        // Server clock only — client clocks are not trusted.
        started_at: now,
        last_heartbeat_at: now,
        backend: cleanText(body.backend, MAX_FIELD_LENGTH),
        model: cleanText(body.model, MAX_FIELD_LENGTH),
        attempt: cleanAttempt(body.attempt) ?? 1,
        encoder_version: cleanText(body.encoder_version, MAX_FIELD_LENGTH),
        // Encoders open a run already in its first phase (resolve).
        phase: cleanText(body.phase, MAX_FIELD_LENGTH),
        runner: sanitizeRunner(body.runner),
      };
      const response = await fetch(`${config.url}/rest/v1/live_encoding_runs`, {
        method: "POST",
        headers: restHeaders(config),
        body: JSON.stringify(row),
        cache: "no-store",
      });
      if (response.status === 409) {
        return NextResponse.json({ error: "duplicate_id" }, { status: 409 });
      }
      if (!response.ok) {
        throw new Error(`Supabase returned ${response.status}`);
      }
      return new NextResponse(null, { status: 204 });
    }

    if (op === "heartbeat") {
      const data = { last_heartbeat_at: now, ...cleanRunState(body) };
      // A heartbeat can arrive after finish even if the client sent it first.
      const matched = await updateIngestRow(config, id, data, "running");
      if (!matched) {
        return NextResponse.json({ error: "unknown_run" }, { status: 404 });
      }
      return new NextResponse(null, { status: 204 });
    }

    if (op === "finish") {
      const status = typeof body.status === "string" ? body.status : "";
      if (!RUN_STATUSES.has(status)) {
        return NextResponse.json({ error: "invalid_status" }, { status: 400 });
      }
      const data: Record<string, unknown> = {
        status,
        finished_at: now,
        last_heartbeat_at: now,
        ...cleanRunState(body),
      };
      const runId = cleanText(body.run_id, MAX_FIELD_LENGTH);
      if (runId) data.run_id = runId;
      const outcome = cleanOutcome(body);
      let matched: boolean;
      try {
        matched = await updateIngestRow(config, id, { ...data, ...outcome });
      } catch (error) {
        // The table does not have the columns yet (outcome_status and
        // error_rule arrive by migration): write the finish without them,
        // so it is never lost. Any other refusal fails as before.
        const missingColumn =
          error instanceof IngestWriteError && error.code !== null && MISSING_COLUMN_CODES.has(error.code);
        if (!missingColumn || Object.keys(outcome).length === 0) throw error;
        matched = await updateIngestRow(config, id, data);
      }
      if (!matched) {
        return NextResponse.json({ error: "unknown_run" }, { status: 404 });
      }
      return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json({ error: "invalid_op" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "ingest_failed" }, { status: 502 });
  }
}
