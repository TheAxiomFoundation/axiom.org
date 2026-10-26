import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetRoom,
  CHAT_KEY,
  CONTROL_TIMEOUT_MS,
  OVERALL_KEY,
  PLEDGE_KEY,
  RATING_KEY,
  RESULTS_TIMEOUT_MS,
  ROOM_HOLD_MS,
  SAVE_TIMEOUT_MS,
  TAB_KEY,
  VOTE_KEY,
  currentRun,
  enterRun,
  formatValue,
  heldElsewhere,
  holdTab,
  newId,
  nextRev,
  participantId,
  postJson,
  readStored,
  roomFrom,
  runSwitches,
  saveJson,
  sendEvent,
  useControl,
  usePoll,
  useResults,
  useTabHold,
  writeStored,
} from "./client";

import type { Control } from "@/lib/aspen/types";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(data: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => data } as unknown as Response;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("participantId", () => {
  it("creates one id and keeps it in localStorage", () => {
    const first = participantId();
    expect(first).toMatch(UUID_V4);
    expect(localStorage.getItem("aspen.participant")).toBe(first);
    expect(participantId()).toBe(first);
  });

  it("returns the stored id when one exists", () => {
    localStorage.setItem("aspen.participant", "stored-id");
    expect(participantId()).toBe("stored-id");
  });

  it("falls back to one in-memory id when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const first = participantId();
    expect(first).toMatch(UUID_V4);
    expect(participantId()).toBe(first);
  });
});

describe("newId", () => {
  it("uses crypto.randomUUID when it exists", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(newId()).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  });

  it("builds a v4 id from Math.random without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {});
    const ids = new Set(Array.from({ length: 20 }, () => newId()));
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("readStored / writeStored", () => {
  it("reads and writes JSON in localStorage", () => {
    writeStored("k", { a: 1 });
    expect(localStorage.getItem("k")).toBe('{"a":1}');
    expect(readStored<{ a: number }>("k")).toEqual({ a: 1 });
    expect(sessionStorage.getItem("k")).toBeNull();
  });

  it("uses sessionStorage when the session flag is set", () => {
    writeStored("k", [1, 2], true);
    expect(sessionStorage.getItem("k")).toBe("[1,2]");
    expect(localStorage.getItem("k")).toBeNull();
    expect(readStored("k", true)).toEqual([1, 2]);
    expect(readStored("k")).toBeNull();
  });

  it("returns null for absent or garbled values", () => {
    expect(readStored("missing")).toBeNull();
    localStorage.setItem("bad", "{oops");
    expect(readStored("bad")).toBeNull();
  });

  it("swallows a write failure", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeStored("k", 1)).not.toThrow();
  });
});

describe("enterRun", () => {
  it("adopts the run on a device with no recorded run and keeps what it saved", () => {
    localStorage.setItem(CHAT_KEY, "{}");
    expect(enterRun("rehearsal")).toBe(false);
    expect(readStored("aspen.run")).toBe("rehearsal");
    expect(localStorage.getItem(CHAT_KEY)).toBe("{}");
  });

  it("does nothing while the run stays the same", () => {
    writeStored("aspen.run", "phoenix");
    localStorage.setItem(OVERALL_KEY, "true");
    expect(enterRun("phoenix")).toBe(false);
    expect(localStorage.getItem(OVERALL_KEY)).toBe("true");
  });

  it("drops the old run's chat and shared ratings when the run changes", () => {
    writeStored("aspen.run", "rehearsal");
    localStorage.setItem(CHAT_KEY, "{}");
    localStorage.setItem(OVERALL_KEY, "true");
    localStorage.setItem(VOTE_KEY, JSON.stringify("project"));
    localStorage.setItem(RATING_KEY, "{}");
    localStorage.setItem(PLEDGE_KEY, "true");
    localStorage.setItem("aspen.overall.v1", "true");
    localStorage.setItem("aspen.participant", "p-1");
    expect(enterRun("phoenix")).toBe(true);
    expect(localStorage.getItem(CHAT_KEY)).toBeNull();
    expect(localStorage.getItem(OVERALL_KEY)).toBeNull();
    expect(localStorage.getItem(VOTE_KEY)).toBeNull();
    expect(localStorage.getItem(RATING_KEY)).toBeNull();
    expect(localStorage.getItem(PLEDGE_KEY)).toBeNull();
    // A key from an earlier version of the page goes too.
    expect(localStorage.getItem("aspen.overall.v1")).toBeNull();
    expect(localStorage.getItem("aspen.participant")).toBe("p-1");
    expect(readStored("aspen.run")).toBe("phoenix");
  });

  it("records a new run, and reports the move, even when nothing was saved to drop", () => {
    writeStored("aspen.run", "rehearsal");
    const before = runSwitches();
    expect(enterRun("phoenix")).toBe(true);
    expect(readStored("aspen.run")).toBe("phoenix");
    expect(runSwitches()).toBe(before + 1);
    expect(enterRun("phoenix")).toBe(false);
    expect(runSwitches()).toBe(before + 1);
  });

  it("never throws when storage is blocked, and moves no more than once when it can't record the run", () => {
    writeStored("aspen.run", "rehearsal");
    localStorage.setItem(CHAT_KEY, "{}");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      if (key === "aspen.run") return JSON.stringify("rehearsal");
      throw new Error("blocked");
    });
    expect(enterRun("phoenix")).toBe(false);
    vi.restoreAllMocks();
    // Storage full: the run can't be recorded. It drops the old run's answers once, and doesn't move again
    // at the next poll.
    writeStored("aspen.run", "rehearsal");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const before = runSwitches();
    expect(enterRun("phoenix")).toBe(true);
    expect(localStorage.getItem(CHAT_KEY)).toBeNull();
    expect(enterRun("phoenix")).toBe(false);
    expect(runSwitches()).toBe(before + 1);
  });

  it("names the device's run, or none", () => {
    expect(currentRun()).toBeNull();
    enterRun("phoenix");
    expect(currentRun()).toBe("phoenix");
    localStorage.setItem("aspen.run", JSON.stringify(7));
    expect(currentRun()).toBeNull();
  });

  it("counts a run switch exactly when it moves the device to another run, so what the old run showed knows it", () => {
    // Invariants, for any sequence of runs entered and answers saved: the count goes up by one when
    // enterRun reports a move and is otherwise unchanged; a move is from one run to another, whether
    // or not anything was saved, and drops what was; the device's run is the last one entered; and what
    // is saved on it after a switch was saved after that switch.
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constantFrom("rehearsal", "phoenix", "tucson").map((run) => ({ run })), fc.constant({ save: true })), {
          maxLength: 20,
        }),
        (steps) => {
          localStorage.clear();
          let entered: string | null = null;
          for (const step of steps) {
            const before = runSwitches();
            if ("save" in step) {
              writeStored(CHAT_KEY, { runId: currentRun() });
              expect(runSwitches()).toBe(before);
              continue;
            }
            const saved = localStorage.getItem(CHAT_KEY) !== null;
            const moved = enterRun(step.run);
            expect(runSwitches()).toBe(before + (moved ? 1 : 0));
            // A move from one run to another drops what was saved; adopting a first run, or staying, is no move.
            expect(moved).toBe(entered !== null && entered !== step.run);
            if (moved) expect(localStorage.getItem(CHAT_KEY)).toBeNull();
            else expect(localStorage.getItem(CHAT_KEY) !== null).toBe(saved);
            entered = step.run;
            expect(currentRun()).toBe(entered);
            const chat = readStored<{ runId: string | null }>(CHAT_KEY);
            if (chat) expect([null, entered]).toContain(chat.runId);
          }
        },
      ),
    );
  });
});

describe("postJson", () => {
  it("posts JSON and returns ok, status and data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hello: "world" }, true, 201));
    vi.stubGlobal("fetch", fetchMock);
    const result = await postJson("/api/x", { a: 1 });
    expect(result).toEqual({ ok: true, status: 201, data: { hello: "world" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
  });

  it("returns empty data when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error("html")) }),
    );
    expect(await postJson("/api/x", {})).toEqual({ ok: false, status: 502, data: {} });
  });

  it("with a timeout, aborts a request that stalls and rejects, as a dropped connection does", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: RequestInit) => {
          signal = init.signal ?? undefined;
          // Like fetch, it only ends when it is aborted.
          return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
        }),
      );
      const result = postJson("/x", {}, 5000);
      const settled = vi.fn();
      result.then(settled, settled);
      await vi.advanceTimersByTimeAsync(4999);
      expect(signal?.aborted).toBe(false);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      await expect(result).rejects.toThrow("aborted");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with a timeout, rejects when the timeout cuts off the answer's body, rather than reading it as empty", async () => {
    vi.useFakeTimers();
    try {
      // The headers come back at once; the body stalls until the request is aborted.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve, reject) => {
              setTimeout(() => resolve({ stage: "try" }), 10_000);
              init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            }),
        })),
      );
      const result = postJson("/x", {}, 5000);
      result.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(result).rejects.toThrow("aborted");
    } finally {
      vi.useRealTimers();
    }
  });

  it("with a timeout, answers in time as without one, and never aborts the request afterwards", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          signal = init.signal ?? undefined;
          return jsonResponse({ stage: "try" });
        }),
      );
      expect(await postJson("/x", { a: 1 }, 5000)).toEqual({ ok: true, status: 200, data: { stage: "try" } });
      // Its timer is gone: a full timeout later the request was never aborted.
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(5001);
      expect(signal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sendEvent", () => {
  it("posts the event with the participant id", async () => {
    localStorage.setItem("aspen.participant", "p-1");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    sendEvent("chip", { householdId: "az-retiree" }, "try");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/aspen/event");
    expect(JSON.parse(init.body)).toEqual({
      participantId: "p-1",
      kind: "chip",
      payload: { householdId: "az-retiree" },
      stage: "try",
    });
  });

  it("never throws when the request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    expect(() => sendEvent("x", {})).not.toThrow();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});

describe("formatValue", () => {
  it("formats dollars without cents for whole numbers", () => {
    expect(formatValue(1234, "USD")).toBe("$1,234");
  });

  it("keeps cents for fractional dollars", () => {
    expect(formatValue(12.5, "USD")).toBe("$12.50");
  });

  it("formats plain numbers with grouping", () => {
    expect(formatValue(1234567)).toBe("1,234,567");
    expect(formatValue(3, "people")).toBe("3");
  });

  it("maps truth values and blanks", () => {
    expect(formatValue("holds")).toBe("Yes");
    expect(formatValue("not_holds")).toBe("No");
    expect(formatValue(null)).toBe("—");
    expect(formatValue(undefined)).toBe("—");
  });

  it("returns other values as strings", () => {
    expect(formatValue("eligible")).toBe("eligible");
    expect(formatValue(true)).toBe("true");
  });
});

function PollProbe({ url, interval, timeout }: { url: string | null; interval: number; timeout?: number }) {
  const { data, failed } = usePoll<{ n: number }>(url, interval, timeout);
  return (
    <p>
      <span data-testid="data">{data ? String(data.n) : "none"}</span>
      <span data-testid="failed">{failed ? "failed" : "ok"}</span>
    </p>
  );
}

describe("usePoll", () => {
  it("does nothing without a url", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PollProbe url={null} interval={10} />);
    expect(screen.getByTestId("data")).toHaveTextContent("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the last good value when a later poll fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ n: 1 }))
      .mockResolvedValueOnce(jsonResponse({ error: "down" }, false, 503))
      .mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<PollProbe url="/api/poll" interval={5} />);
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("1"));
    await waitFor(() => expect(screen.getByTestId("failed")).toHaveTextContent("failed"));
    expect(screen.getByTestId("data")).toHaveTextContent("1");
    expect(fetchMock).toHaveBeenCalledWith("/api/poll", { cache: "no-store" });
    unmount();
  });

  it("clears a failure on the next good poll", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(jsonResponse({ n: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PollProbe url="/api/poll" interval={5} />);
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("2"));
    expect(screen.getByTestId("failed")).toHaveTextContent("ok");
  });

  it("polls three times slower while the page is hidden", async () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ n: 3 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<PollProbe url="/api/poll" interval={1000} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      hidden.mockRestore();
      vi.useRealTimers();
    }
  });

  it("counts a poll that hangs past the timeout as failed, and polls again on schedule", async () => {
    vi.useFakeTimers();
    const signals: (AbortSignal | undefined)[] = [];
    const fetchMock = vi
      .fn((_url: string, init: RequestInit) => {
        signals.push(init.signal ?? undefined);
        return Promise.resolve(jsonResponse({ n: 4 }));
      })
      // The first request stalls: like fetch, it only ends when it is aborted.
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        signals.push(init.signal ?? undefined);
        return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<PollProbe url="/api/poll" interval={1000} timeout={5000} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4999);
      });
      expect(screen.getByTestId("failed")).toHaveTextContent("ok");
      expect(signals[0]?.aborted).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(signals[0]?.aborted).toBe(true);
      expect(screen.getByTestId("failed")).toHaveTextContent("failed");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("data")).toHaveTextContent("4");
      expect(screen.getByTestId("failed")).toHaveTextContent("ok");
      // A poll that answers in time is never aborted later: a whole timeout past it, its timer is gone.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000 + 1);
      });
      expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
      expect(signals[1]?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the request in flight, and clears its timer, when the page leaves", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signals.push(init.signal!);
        return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      }),
    );
    try {
      const { unmount } = render(<PollProbe url="/api/poll" interval={1000} timeout={5000} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(signals).toHaveLength(1);
      expect(signals[0].aborted).toBe(false);
      unmount();
      expect(signals[0].aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      // Nothing runs after it: no new request, and no state update on the unmounted probe.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(signals).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands each good value to onData as it arrives, before the next render, and none from a url it left", async () => {
    const answers: Record<string, (r: Response) => void> = {};
    vi.stubGlobal("fetch", vi.fn((url: string) => new Promise<Response>((resolve) => (answers[url] = resolve))));
    const seen: { n: number; rendered: string | null }[] = [];
    function Probe({ url }: { url: string }) {
      const { data } = usePoll<{ n: number }>(url, 1000, undefined, (value) =>
        seen.push({ n: value.n, rendered: screen.getByTestId("data").textContent }),
      );
      return <span data-testid="data">{data ? String(data.n) : "none"}</span>;
    }
    const { rerender } = render(<Probe url="/api/a" />);
    rerender(<Probe url="/api/b" />);
    // Without a timeout nothing aborts the old url's request; its answer still comes, and is dropped.
    await act(async () => {
      answers["/api/a"](jsonResponse({ n: 1 }));
      answers["/api/b"](jsonResponse({ n: 2 }));
    });
    expect(seen).toEqual([{ n: 2, rendered: "none" }]);
    expect(screen.getByTestId("data")).toHaveTextContent("2");
  });

  it("aborts the request for the old url when the url changes", async () => {
    vi.useFakeTimers();
    const requests: { url: string; signal: AbortSignal }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        requests.push({ url, signal: init.signal! });
        return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      }),
    );
    try {
      const { rerender, unmount } = render(<PollProbe url="/api/a" interval={1000} timeout={5000} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      rerender(<PollProbe url="/api/b" interval={1000} timeout={5000} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(requests.map((r) => [r.url, r.signal.aborted])).toEqual([
        ["/api/a", true],
        ["/api/b", false],
      ]);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a response that lands after unmount", async () => {
    let resolve: (value: Response) => void = () => {};
    let reject: (reason: Error) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)))
      .mockReturnValueOnce(new Promise<Response>((_, r) => (reject = r)));
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<PollProbe url="/api/a" interval={5} />);
    first.unmount();
    await act(async () => {
      resolve(jsonResponse({ n: 9 }));
    });
    const second = render(<PollProbe url="/api/b" interval={5} />);
    second.unmount();
    await act(async () => {
      reject(new Error("late"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function ControlProbe() {
  const { data } = useControl(10_000);
  return <span data-testid="stage">{data?.stage ?? "none"}</span>;
}

function ResultsProbe({ enabled, runId }: { enabled: boolean; runId?: string }) {
  const { data } = useResults(enabled, 10_000, runId);
  return <span data-testid="run">{data?.runId ?? "none"}</span>;
}

describe("useControl / useResults", () => {
  it("polls the stage endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ runId: "r", stage: "try", live: true, updatedAt: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ControlProbe />);
    await waitFor(() => expect(screen.getByTestId("stage")).toHaveTextContent("try"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/aspen/state");
    // The room's poll gives up on a stalled request; the results poll does too, but only after a minute
    // (a whole run can load slowly).
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: "no-store", signal: expect.any(AbortSignal) });
    expect(CONTROL_TIMEOUT_MS).toBeGreaterThan(4000);
    expect(RESULTS_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("polls results only when enabled, with an encoded run id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ runId: "run 1", live: true, summary: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<ResultsProbe enabled={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(<ResultsProbe enabled runId="run 1" />);
    await waitFor(() => expect(screen.getByTestId("run")).toHaveTextContent("run 1"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/aspen/results?run=run%201");
  });

  it("polls the current run without a run id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ runId: "default", live: false, summary: {} }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ResultsProbe enabled />);
    await waitFor(() => expect(screen.getByTestId("run")).toHaveTextContent("default"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/aspen/results");
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: "no-store", signal: expect.any(AbortSignal) });
  });
});

describe("roomFrom", () => {
  const T0 = Date.parse("2026-10-27T01:00:00.000Z");
  const row = (runId: string, stage: string, second: number | null, live = true): Control => ({
    runId,
    stage,
    live,
    updatedAt: second === null ? null : `2026-10-27T01:00:${String(second).padStart(2, "0")}.000Z`,
  });
  beforeEach(() => _resetRoom());

  it("follows the newest live row it read in the last minute over an older one, across a reload", () => {
    const event = row("event", "groups", 2);
    expect(roomFrom(row("rehearsal", "welcome", 1), T0)).toEqual(row("rehearsal", "welcome", 1));
    expect(roomFrom(event, T0 + 100)).toEqual(event);
    // Another server instance still holds the rehearsal's row for its two seconds.
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 + 500)).toEqual(event);
    // A reload reads the row back from storage.
    _resetRoom();
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 + 600)).toEqual(event);
    // A failed store read, not live, passes through, and leaves the held row as it was.
    expect(roomFrom(row("rehearsal", "welcome", null, false), T0 + 700)).toEqual(row("rehearsal", "welcome", null, false));
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 + 800)).toEqual(event);
    // Held a minute from when it was last read, then an older row is the room's again.
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 + 100 + ROOM_HOLD_MS - 1)).toEqual(event);
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 + 100 + ROOM_HOLD_MS)).toEqual(row("rehearsal", "welcome", 1));
  });

  it("holds nothing when the clock has gone back past the read, or what it saved is unreadable", () => {
    const event = row("event", "groups", 2);
    roomFrom(event, T0);
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 - 1)).toEqual(row("rehearsal", "welcome", 1));
    roomFrom(event, T0);
    localStorage.setItem("aspen.room", "{not json");
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 + 1)).toEqual(row("rehearsal", "welcome", 1));
    localStorage.setItem("aspen.room", JSON.stringify({ row: { runId: "event" }, at: T0 }));
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 + 2)).toEqual(row("rehearsal", "welcome", 1));
  });

  it("keeps the newest live row in memory when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const event = row("event", "groups", 2);
    expect(roomFrom(event, T0)).toEqual(event);
    expect(roomFrom(row("rehearsal", "welcome", 1), T0 + 500)).toEqual(event);
  });

  it("never goes back to a row older than a live one it read in the last minute, and otherwise follows each read", () => {
    const read = fc.record({
      runId: fc.constantFrom("rehearsal", "event"),
      stage: fc.constantFrom("welcome", "try", "groups"),
      live: fc.boolean(),
      second: fc.option(fc.integer({ min: 0, max: 59 }), { nil: null }),
      // Time since the last read: mostly within the hold, sometimes past it.
      after: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: 5_000 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 2 * ROOM_HOLD_MS }) }),
      // A reload between this read and the last: the page's memory goes, its storage stays.
      reload: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(read, { minLength: 1, maxLength: 30 }), fc.boolean(), (reads, blocked) => {
        localStorage.clear();
        _resetRoom();
        vi.restoreAllMocks();
        if (blocked) {
          vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
          });
          vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
          });
        }
        const stamp = (c: Control) => c.updatedAt ?? "";
        // Each live row the phone followed as read (not held), and when.
        const followed: { row: Control; at: number }[] = [];
        let now = T0;
        for (const r of reads) {
          now += r.after;
          // Blocked storage keeps the row only in the page's memory, which a reload empties.
          if (r.reload && blocked) {
            _resetRoom();
            followed.length = 0;
          }
          const incoming = row(r.runId, r.stage, r.second, r.live);
          const out = roomFrom(incoming, now);
          const recent = followed.filter((f) => now - f.at < ROOM_HOLD_MS);
          const newer = recent.filter((f) => stamp(f.row) > stamp(incoming));
          if (!incoming.live || newer.length === 0) {
            // A row not live, or one no older than every live row followed in the last minute, is followed.
            expect(out).toEqual(incoming);
          } else {
            // Otherwise the phone stays on a newer row it followed in the last minute: never an older one.
            expect(out.live).toBe(true);
            expect(recent.map((f) => f.row)).toContainEqual(out);
            for (const f of recent) expect(stamp(out) >= stamp(f.row)).toBe(true);
          }
          if (incoming.live && out === incoming) followed.push({ row: incoming, at: now });
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("saveJson", () => {
  const respond = (ok: boolean, data: unknown) => ({ ok, status: ok ? 200 : 500, json: async () => data }) as unknown as Response;

  it("is true only when the server says it kept the save", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, { ok: true, saved: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await saveJson("/api/aspen/event", { a: 1 })).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/aspen/event", expect.objectContaining({ method: "POST", body: '{"a":1}' }));
    // Only the store's own yes counts: an answer that doesn't say is not a save.
    fetchMock.mockResolvedValue(respond(true, { ok: true }));
    expect(await saveJson("/x", {})).toBe(false);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => null } as unknown as Response);
    expect(await saveJson("/x", {})).toBe(false);
  });

  it("is false for a store failure, an error status, an unreadable body with an error, or a dropped connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(true, { ok: true, saved: false })));
    expect(await saveJson("/x", {})).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(false, { error: "no" })));
    expect(await saveJson("/x", {})).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("html") } } as unknown as Response));
    expect(await saveJson("/x", {})).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await saveJson("/x", {})).toBe(false);
  });

  it("gives up after the timeout, by aborting the request", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: RequestInit) => {
          signal = init.signal ?? undefined;
          return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
        }),
      );
      const result = saveJson("/x", {});
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      expect(await result).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a save whose answer the timeout cuts off as not saved, whatever the answer would have said", async () => {
    vi.useFakeTimers();
    try {
      // The headers come back at once; the body stalls until the request is aborted.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve, reject) => {
              setTimeout(() => resolve({ ok: true, saved: true }), SAVE_TIMEOUT_MS * 2);
              init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            }),
        })),
      );
      const result = saveJson("/x", {});
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
      expect(await result).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("nextRev", () => {
  beforeEach(() => localStorage.clear());

  it("only goes up, whatever the clock says, and is at least the tap's time", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 4e12 }), { minLength: 1, maxLength: 30 }), (clock) => {
        let last = -Infinity;
        for (const now of clock) {
          const rev = nextRev(now);
          expect(Number.isSafeInteger(rev)).toBe(true);
          expect(rev).toBeGreaterThan(last);
          expect(rev).toBeGreaterThanOrEqual(now);
          last = rev;
        }
      }),
    );
  });

  it("starts above the stamp another tab or an earlier page load left, and ignores one it can't read", () => {
    localStorage.setItem("aspen.rev", JSON.stringify(9e12));
    expect(nextRev(1)).toBe(9e12 + 1);
    expect(JSON.parse(localStorage.getItem("aspen.rev")!)).toBe(9e12 + 1);
    localStorage.setItem("aspen.rev", JSON.stringify("soon"));
    // Still above the last stamp this page used.
    expect(nextRev(1)).toBe(9e12 + 2);
  });

  it("names each save by its stamp and its tab, so two tabs that stamp alike still tell their saves apart", async () => {
    vi.resetModules();
    const tabA = await import("./client");
    vi.resetModules();
    const tabB = await import("./client");
    // Each takes a stamp before it sees the other's, so they share it.
    localStorage.setItem("aspen.rev", JSON.stringify(9e12));
    const a = tabA.nextRev(1);
    localStorage.setItem("aspen.rev", JSON.stringify(9e12));
    const b = tabB.nextRev(1);
    expect(a).toBe(b);
    expect(tabA.saveMark(a)).not.toBe(tabB.saveMark(b));
    expect(tabA.saveMark(a)).toBe(tabA.saveMark(a));
    expect(tabA.saveMark(a)).not.toBe(tabA.saveMark(a + 1));
  });

  it("keeps a new run's stamps going up, since enterRun leaves the stamp alone", () => {
    const before = nextRev(5e12);
    localStorage.setItem("aspen.run", JSON.stringify("rehearsal"));
    enterRun("phoenix");
    expect(localStorage.getItem("aspen.rev")).not.toBeNull();
    expect(nextRev(1)).toBeGreaterThan(before);
  });
});

describe("holdTab", () => {
  it("leaves the device's answers to a tab that took them over, but keeps its own tab's state and its stamps going up", () => {
    // Before this page holds the device (the presenter's page never does), another tab's hold changes nothing.
    localStorage.setItem(TAB_KEY, JSON.stringify("other-tab"));
    expect(heldElsewhere()).toBe(false);
    writeStored(OVERALL_KEY, { truth: "yes" });
    expect(readStored(OVERALL_KEY)).toEqual({ truth: "yes" });

    holdTab();
    expect(heldElsewhere()).toBe(false);
    writeStored(OVERALL_KEY, { truth: "no" });
    expect(readStored(OVERALL_KEY)).toEqual({ truth: "no" });

    // Another tab takes over: this one writes no answers and drops nothing at a new run.
    localStorage.setItem(TAB_KEY, JSON.stringify("other-tab"));
    expect(heldElsewhere()).toBe(true);
    writeStored(OVERALL_KEY, { truth: "unsure" });
    expect(readStored(OVERALL_KEY)).toEqual({ truth: "no" });
    localStorage.setItem("aspen.run", JSON.stringify("rehearsal"));
    expect(enterRun("phoenix")).toBe(false);
    expect(readStored(OVERALL_KEY)).toEqual({ truth: "no" });
    expect(readStored("aspen.run")).toBe("rehearsal");
    // This tab's own state still saves, and its stamps still go up.
    writeStored("aspen.view", { view: "try" }, true);
    expect(readStored("aspen.view", true)).toEqual({ view: "try" });
    const rev = nextRev(1);
    expect(JSON.parse(localStorage.getItem("aspen.rev")!)).toBe(rev);

    // Taking it back lets it write again.
    holdTab();
    writeStored(OVERALL_KEY, { truth: "unsure" });
    expect(readStored(OVERALL_KEY)).toEqual({ truth: "unsure" });
  });

  it("says when another tab takes over, from the storage event or on coming back into view, and takes it back with a reload", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const { result } = renderHook(() => useTabHold());
    const mine = localStorage.getItem(TAB_KEY);
    expect(mine).not.toBeNull();
    expect(result.current.elsewhere).toBe(false);

    localStorage.setItem(TAB_KEY, JSON.stringify("other-tab"));
    // Another key changing says nothing about the hold.
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: CHAT_KEY })));
    expect(result.current.elsewhere).toBe(false);
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: TAB_KEY })));
    expect(result.current.elsewhere).toBe(true);

    act(() => result.current.takeBack());
    expect(localStorage.getItem(TAB_KEY)).toBe(mine);
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.elsewhere).toBe(false);

    // A phone may not wake a background tab for the storage event: coming back into view checks too.
    localStorage.setItem(TAB_KEY, JSON.stringify("third-tab"));
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(result.current.elsewhere).toBe(true);
    // Storage cleared everywhere: nobody holds it, so this tab takes it again,
    // and a tab that takes it after that stops this one, as before.
    localStorage.clear();
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: null })));
    expect(result.current.elsewhere).toBe(false);
    expect(localStorage.getItem(TAB_KEY)).toBe(mine);
    localStorage.setItem(TAB_KEY, JSON.stringify("fourth-tab"));
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: TAB_KEY })));
    expect(result.current.elsewhere).toBe(true);
  });

  it("carries on as the only tab when it can't write the hold, rather than stopping", () => {
    // An earlier visit left its hold, and now the phone refuses writes (a full quota).
    localStorage.setItem(TAB_KEY, JSON.stringify("tab-from-an-earlier-visit"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useTabHold());
    expect(heldElsewhere()).toBe(false);
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(result.current.elsewhere).toBe(false);
  });

  it("takes the hold once storage works again, so it stops writing when another tab takes over after that", () => {
    // Another tab holds the device, and this one opens while the phone refuses writes.
    localStorage.setItem(TAB_KEY, JSON.stringify("other-tab"));
    const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderHook(() => useTabHold());
    expect(heldElsewhere()).toBe(false);
    expect(localStorage.getItem(TAB_KEY)).toBe(JSON.stringify("other-tab"));

    // Storage works again: this tab's next write takes the hold before it writes.
    refuse.mockRestore();
    writeStored(OVERALL_KEY, { truth: "yes" });
    const mine = localStorage.getItem(TAB_KEY);
    expect(mine).not.toBe(JSON.stringify("other-tab"));
    expect(JSON.parse(mine!)).toEqual(expect.any(String));
    expect(readStored(OVERALL_KEY)).toEqual({ truth: "yes" });

    // From then on it is one tab of two again: when the other takes over, this one writes nothing.
    localStorage.setItem(TAB_KEY, JSON.stringify("other-tab"));
    expect(heldElsewhere()).toBe(true);
    writeStored(OVERALL_KEY, { truth: "no" });
    expect(readStored(OVERALL_KEY)).toEqual({ truth: "yes" });
  });
});
