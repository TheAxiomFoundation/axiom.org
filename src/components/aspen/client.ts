"use client";

import { useEffect, useRef, useState } from "react";
import type { Control } from "@/lib/aspen/types";
import type { RunSummary } from "@/lib/aspen/results";

/** Browser-side plumbing for /aspen: the anonymous participant id, API calls, polling. */

const PARTICIPANT_KEY = "aspen.participant";
const PROFILE_KEY = "aspen.profile";

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

export interface Profile {
  perspective: string | null;
  state: string | null;
  role: string | null;
}

export const EMPTY_PROFILE: Profile = { perspective: null, state: null, role: null };

export function loadProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) } : EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
}

export function saveProfile(profile: Profile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode: the profile still reaches the server.
  }
}

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
