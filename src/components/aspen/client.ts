"use client";

import { useEffect, useRef, useState } from "react";
import type { Control } from "@/lib/aspen/types";
import type { RunSummary } from "@/lib/aspen/results";

/** Browser-side plumbing for /aspen: the anonymous participant id, API calls, polling. */

const PARTICIPANT_KEY = "aspen.participant";
const RUN_KEY = "aspen.run";
/** The saved conversation from Try it. It belongs to one run. */
export const CHAT_KEY = "aspen.chat.v1";
/** Set once this device has shared its Rate it answers. It belongs to one run. */
export const OVERALL_KEY = "aspen.overall.v1";
/** The use case this device voted for. It belongs to one run. */
export const VOTE_KEY = "aspen.vote.v1";

let fallbackId: string | null = null;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Older browsers: RFC 4122 v4 from Math.random (identity only, not security).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** This phone's anonymous id, kept in localStorage when it is available. */
export function participantId(): string {
  try {
    const stored = window.localStorage.getItem(PARTICIPANT_KEY);
    if (stored) return stored;
    const id = newId();
    window.localStorage.setItem(PARTICIPANT_KEY, id);
    return id;
  } catch {
    fallbackId ??= newId();
    return fallbackId;
  }
}

export { newId };

/** JSON in localStorage (or sessionStorage); null when absent, unreadable or blocked. */
export function readStored<T>(key: string, session = false): T | null {
  try {
    const raw = (session ? window.sessionStorage : window.localStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown, session = false) {
  try {
    (session ? window.sessionStorage : window.localStorage).setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the page works without it.
  }
}

/**
 * Ties this device's saved chat, Rate it answers and vote to the room's
 * run. When the presenter starts a new run (after a rehearsal), a device
 * that saved them under the old run drops them, so a test phone starts
 * clean at the event. A device with no recorded run adopts the current one
 * and keeps what it has. Returns true when it dropped anything.
 */
export function enterRun(runId: string): boolean {
  const previous = readStored<string>(RUN_KEY);
  if (previous === runId) return false;
  writeStored(RUN_KEY, runId);
  if (previous === null) return false;
  let dropped = false;
  for (const key of [CHAT_KEY, OVERALL_KEY, VOTE_KEY]) {
    try {
      if (window.localStorage.getItem(key) === null) continue;
      window.localStorage.removeItem(key);
      dropped = true;
    } catch {
      // Blocked storage holds nothing to drop.
    }
  }
  return dropped;
}

export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

/** Fire-and-forget activity record; a failure never interrupts the page. */
export function sendEvent(kind: string, payload: Record<string, unknown>, stage?: string) {
  void postJson("/api/aspen/event", { participantId: participantId(), kind, payload, stage }).catch(
    () => undefined,
  );
}

/** Polls a JSON endpoint while `enabled`; keeps the last good value. */
export function usePoll<T>(url: string | null, intervalMs: number): { data: T | null; failed: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as T;
        if (!cancelled && urlRef.current === url) {
          setData(next);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) timer = setTimeout(tick, document.hidden ? intervalMs * 3 : intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [url, intervalMs]);

  return { data, failed };
}

export function useControl(intervalMs = 4000) {
  return usePoll<Control>("/api/aspen/state", intervalMs);
}

export interface ResultsPayload {
  runId: string;
  live: boolean;
  summary: RunSummary;
}

export function useResults(enabled: boolean, intervalMs = 5000, runId?: string) {
  const url = enabled ? `/api/aspen/results${runId ? `?run=${encodeURIComponent(runId)}` : ""}` : null;
  return usePoll<ResultsPayload>(url, intervalMs);
}

/** "$1,234" for numbers, the raw value otherwise. */
export function formatValue(value: unknown, unit?: string | null): string {
  if (typeof value === "number") {
    if (unit === "USD") {
      return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
      });
    }
    return value.toLocaleString("en-US");
  }
  if (value === "holds") return "Yes";
  if (value === "not_holds") return "No";
  if (value === null || value === undefined) return "—";
  return String(value);
}
