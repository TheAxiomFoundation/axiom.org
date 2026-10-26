"use client";

import { useEffect, useRef, useState } from "react";
import { newerControl } from "@/lib/aspen/control";
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
/** Whether this device sent the Next steps form, so a reloaded tab shows its thank-you, not a blank form to send twice. It belongs to one run. */
export const PLEDGE_KEY = "aspen.pledge.v1";
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
// How many times enterRun has moved this page from one run to another (runSwitches).
let switches = 0;

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
 * that was in the old run drops what it saved there, so a test phone starts
 * clean at the event. A device with no recorded run adopts the current one
 * and keeps what it has. Returns true when it moved the device from one run
 * to another, whether or not it had anything to drop, so the page starts
 * the new run afresh (aspen-app's runEpoch); and when it dropped anything
 * though it couldn't record the new run (storage full), once.
 */
export function enterRun(runId: string): boolean {
  if (heldElsewhere()) return false;
  const previous = readStored<string>(RUN_KEY);
  if (previous === runId) return false;
  writeStored(RUN_KEY, runId);
  if (previous === null) return false;
  let dropped = false;
  for (const key of [CHAT_KEY, OVERALL_KEY, VOTE_KEY, RATING_KEY, PLEDGE_KEY, ...RETIRED_KEYS]) {
    try {
      if (window.localStorage.getItem(key) === null) continue;
      window.localStorage.removeItem(key);
      dropped = true;
    } catch {
      // Blocked storage holds nothing to drop.
    }
  }
  // A move counts once the new run is recorded: a device that can't record it would otherwise move
  // again at every poll.
  const moved = dropped || readStored<string>(RUN_KEY) === runId;
  if (moved) switches += 1;
  return moved;
}

/** The run this device's saved answers belong to (what enterRun last recorded), or null before it has seen a live one. */
export function currentRun(): string | null {
  const run = readStored<unknown>(RUN_KEY);
  return typeof run === "string" ? run : null;
}

/**
 * A count that goes up each time enterRun moves the device from one run to
 * another, which is when the page remounts what the old run showed
 * (aspen-app's runEpoch). Something that opened under one count and sees
 * another is from a run the device has left, even before the remount
 * reaches it, whether or not that run had saved anything (the review of
 * #376). Adopting a run, on a device that had none, leaves the count alone:
 * what such a device saved, or sent, belongs to the run it adopts.
 */
export function runSwitches(): number {
  return switches;
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

/**
 * Posts JSON and returns the status and the answer's body ({} when the body
 * is not JSON). With `timeoutMs`, a request that neither answers nor fails in
 * time is aborted and rejects, as a dropped connection does, whether it
 * stalls waiting for the answer or while reading it.
 */
export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  timeoutMs?: number,
): Promise<{ ok: boolean; status: number; data: T }> {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const data = (await response.json().catch((error: unknown) => {
      // A body the timeout cuts off is a failed request, not an empty answer.
      if (controller?.signal.aborted) throw error;
      return {};
    })) as T;
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
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

/**
 * How long a poll of the room, or the presenter's move of it, may take before
 * it counts as failed. A request that stalls on venue Wi-Fi then never holds a
 * phone that just joined on Welcome, stops a phone following the room, or
 * keeps the TV from syncing while a move hangs (the reviews of #370).
 */
export const CONTROL_TIMEOUT_MS = 8_000;

/**
 * Polls a JSON endpoint while `enabled`; keeps the last good value. With
 * `timeoutMs`, a request that neither answers nor fails in time is aborted,
 * counts as failed, and the next poll runs on schedule; leaving the page, or
 * a new url, aborts the request in flight and its timer at once. `onData`
 * gets each good value as it arrives, before the next render.
 */
export function usePoll<T>(
  url: string | null,
  intervalMs: number,
  timeoutMs?: number,
  onData?: (data: T) => void,
): { data: T | null; failed: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const urlRef = useRef(url);
  urlRef.current = url;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The request in flight, when it can be aborted, and its timeout.
    let inFlight: { controller: AbortController; abort?: ReturnType<typeof setTimeout> } | null = null;
    const tick = async () => {
      const controller = timeoutMs ? new AbortController() : null;
      const abort = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      inFlight = controller ? { controller, abort } : null;
      try {
        const response = await fetch(url, controller ? { cache: "no-store", signal: controller.signal } : { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        // A body the timeout cuts off throws here, so it counts as failed.
        const next = (await response.json()) as T;
        if (!cancelled && urlRef.current === url) {
          onDataRef.current?.(next);
          setData(next);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        clearTimeout(abort);
        inFlight = null;
      }
      if (!cancelled) timer = setTimeout(tick, document.hidden ? intervalMs * 3 : intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (inFlight) {
        clearTimeout(inFlight.abort);
        inFlight.controller.abort();
      }
    };
  }, [url, intervalMs, timeoutMs]);

  return { data, failed };
}

export function useControl(intervalMs = 4000, onData?: (control: Control) => void) {
  return usePoll<Control>("/api/aspen/state", intervalMs, CONTROL_TIMEOUT_MS, onData);
}

/** The newest live row of the room this device has read, and when (roomFrom). Never dropped with a run's answers. */
const ROOM_KEY = "aspen.room";
/**
 * How long the newest live row a device has read outranks an older one. Each server instance keeps
 * the row it read for two seconds (store.ts readControl), so a poll that reaches another instance can
 * get a row older than one the device already has, for at most that long plus a poll's timeout. Held
 * a minute, never for good: a row someone puts in the store by hand with an older stamp is followed a
 * minute after the newer one was last read.
 */
export const ROOM_HOLD_MS = 60_000;
// The same, on a device whose storage is blocked or full.
let roomInMemory: { row: Control; at: number } | null = null;

function isRow(value: unknown): value is Control {
  const row = value as Partial<Control> | null;
  return (
    typeof row?.runId === "string" &&
    typeof row.stage === "string" &&
    typeof row.live === "boolean" &&
    (row.updatedAt === null || typeof row.updatedAt === "string")
  );
}

/**
 * The row a phone follows, given the one a poll just read: that row, unless it is live and older than
 * a live row this device read in the last ROOM_HOLD_MS (in this tab or another, before a reload or
 * after); then that newer row. So a poll that reaches a server instance still holding an older row
 * never sends a phone back to an earlier stage, or to the run before, where enterRun would drop the
 * answers saved in this one (the review of #376). A row that isn't live (a failed store read) passes
 * through: the phone opens every stage, as it always has without a live room.
 */
export function roomFrom(row: Control, now = Date.now()): Control {
  if (!row.live) return row;
  let held = roomInMemory;
  try {
    const raw = window.localStorage.getItem(ROOM_KEY);
    const saved = raw ? (JSON.parse(raw) as { row?: unknown; at?: unknown }) : null;
    held = saved && isRow(saved.row) && typeof saved.at === "number" ? { row: saved.row, at: saved.at } : roomInMemory;
  } catch {
    // Blocked storage: the row this page read last, if any.
  }
  // A clock set back puts `now` before the stamp, and the row it held no longer counts.
  if (held?.row.live && now >= held.at && now - held.at < ROOM_HOLD_MS && newerControl(held.row, row) === held.row) {
    return held.row;
  }
  const read = { row, at: now };
  try {
    window.localStorage.setItem(ROOM_KEY, JSON.stringify(read));
  } catch {
    roomInMemory = read;
  }
  return row;
}

/** Test hook: forgets the row a page with blocked storage keeps in memory, as a reload does. */
export function _resetRoom() {
  roomInMemory = null;
}

/** The room for a phone: the control polls (useControl), each through roomFrom. */
export function useRoom(intervalMs = 4000): { data: Control | null; failed: boolean } {
  const [room, setRoom] = useState<Control | null>(null);
  const { failed } = useControl(intervalMs, (row) => setRoom(roomFrom(row)));
  return { data: room, failed };
}

export interface ResultsPayload {
  runId: string;
  live: boolean;
  summary: RunSummary;
}

/**
 * How long a results poll may take before it counts as failed: long, since a whole run can load slowly,
 * but not for ever, or one request that stalls on venue Wi-Fi would stop the results updating for good
 * (the review of #376).
 */
export const RESULTS_TIMEOUT_MS = 60_000;

export function useResults(enabled: boolean, intervalMs = 5000, runId?: string) {
  const url = enabled ? `/api/aspen/results${runId ? `?run=${encodeURIComponent(runId)}` : ""}` : null;
  return usePoll<ResultsPayload>(url, intervalMs, RESULTS_TIMEOUT_MS);
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
