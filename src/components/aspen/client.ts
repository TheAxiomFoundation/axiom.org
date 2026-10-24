"use client";

import { useEffect, useRef, useState } from "react";
import type { Control } from "@/lib/aspen/types";
import type { RunSummary } from "@/lib/aspen/results";

/** Browser-side plumbing for /aspen: the anonymous participant id, API calls, polling. */

const PARTICIPANT_KEY = "aspen.participant";
const RUN_KEY = "aspen.run";
/** The saved conversation from Try it. It belongs to one run. */
export const CHAT_KEY = "aspen.chat.v1";
/** This device's overall answers (source of truth, agency rating and comment), saved as tapped. It belongs to one run. */
export const OVERALL_KEY = "aspen.overall.v2";
/** The use case this device voted for. It belongs to one run. */
export const VOTE_KEY = "aspen.vote.v1";
/** Ratings in progress, by prompt id, so a reloaded tab reopens a card where it was. It belongs to one run. */
export const RATING_KEY = "aspen.rating.v1";
/** Keys from earlier versions of the page, dropped with the rest at a new run. */
const RETIRED_KEYS = ["aspen.overall.v1"];
/** The last save stamp this device used (nextRev). Never dropped, so stamps keep going up across runs. */
const REV_KEY = "aspen.rev";
/** The participant's text size: kept on the phone, never sent anywhere. */
export const TEXT_SIZE_KEY = "aspen.textSize.v1";
/** The tab on this device that keeps its answers (holdTab). */
export const TAB_KEY = "aspen.tab";

let fallbackId: string | null = null;
let lastRev = 0;
// This page load's own name, for saveMark and holdTab.
const TAB = Math.random().toString(36).slice(2);
// Whether this page means to keep the device's answers (holdTab); the presenter's page never does.
let claimed = false;
// Whether its claim is written, so other tabs can see it.
let holding = false;

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
  // A tab another one has taken over leaves the answers to it; stamps still only go up.
  if (!session && key !== REV_KEY && heldElsewhere()) return;
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
  if (heldElsewhere()) return false;
  const previous = readStored<string>(RUN_KEY);
  if (previous === runId) return false;
  writeStored(RUN_KEY, runId);
  if (previous === null) return false;
  let dropped = false;
  for (const key of [CHAT_KEY, OVERALL_KEY, VOTE_KEY, RATING_KEY, ...RETIRED_KEYS]) {
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

/**
 * A stamp for one save, taken at the tap: its time in milliseconds, but
 * always above the last stamp this device used (in any tab), so taps carry
 * stamps in the order they were made even if the clock steps back. The rate
 * route keeps a rating only over an older stamp, and the results count each
 * person's highest-stamped answer, so a slow save that lands after a newer
 * one never replaces it.
 */
export function nextRev(now = Date.now()): number {
  const stored = readStored<unknown>(REV_KEY);
  const floor = Math.max(lastRev, typeof stored === "number" && Number.isSafeInteger(stored) ? stored : 0);
  lastRev = Math.max(Math.floor(now), floor + 1);
  writeStored(REV_KEY, lastRev);
  return lastRev;
}

/**
 * Makes this tab the one that keeps the device's answers. Every tab writes
 * its whole conversation, ratings and answers as it changes them, so two
 * tabs writing at once would overwrite each other's newer answers. The
 * participant's page holds the device when it opens; a tab another one has
 * taken over stops writing and offers to take it back (useTabHold).
 */
export function holdTab() {
  claimed = true;
  try {
    window.localStorage.setItem(TAB_KEY, JSON.stringify(TAB));
    holding = true;
  } catch {
    // Storage this tab can't write can't be shared either: it carries on as if it were the only tab.
    holding = false;
  }
}

/**
 * Whether this page held the device's answers and another tab has since
 * taken them. When nothing holds them (storage was cleared), this page takes
 * them again, so two tabs never both carry on writing. A claim storage
 * refused is tried again each time, so once storage works this page holds,
 * as it would have when it opened.
 */
export function heldElsewhere(): boolean {
  if (!claimed) return false;
  if (!holding) {
    holdTab();
    return false;
  }
  const holder = readStored<unknown>(TAB_KEY);
  if (typeof holder !== "string") {
    holdTab();
    return false;
  }
  return holder !== TAB;
}

/**
 * Holds the device's answers while the participant's page is open, and says
 * when another tab takes them: on the storage event, and again whenever this
 * tab comes back into view, as a phone may not wake a background tab for the
 * event. Taking them back reloads the page, so it starts from what the other
 * tab saved.
 */
export function useTabHold(): { elsewhere: boolean; takeBack: () => void } {
  const [elsewhere, setElsewhere] = useState(false);
  useEffect(() => {
    holdTab();
    const check = () => setElsewhere(heldElsewhere());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TAB_KEY || e.key === null) check();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return {
    elsewhere,
    takeBack: () => {
      holdTab();
      window.location.reload();
    },
  };
}

/**
 * One save's name across every tab on this device: its stamp and its tab.
 * Two tabs share a stamp only if each takes one before it sees the other's,
 * and their saves still have different names, so a tab can tell whether the
 * answer stored on the phone is still the one its save sent.
 */
export function saveMark(rev: number): string {
  return `${rev}:${TAB}`;
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

/** How long a save may take before it counts as failed, so one stalled request never holds up the taps after it. */
export const SAVE_TIMEOUT_MS = 10_000;

/**
 * Posts one save and says whether the store kept it: only the route's own
 * `saved: true` counts. A timeout (while waiting or while reading the
 * answer), a dropped connection, an error status, an unreadable answer and a
 * store failure (`saved: false`) all count as not saved. It never throws.
 */
export async function saveJson(url: string, body: unknown, timeoutMs = SAVE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // A body the timeout cuts off throws here, so it counts as not saved.
    const data = (await response.json()) as { saved?: unknown } | null;
    return response.ok && data?.saved === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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
