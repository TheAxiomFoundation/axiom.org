import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_KEY,
  CONTROL_TIMEOUT_MS,
  OVERALL_KEY,
  RATING_KEY,
  SAVE_TIMEOUT_MS,
  TAB_KEY,
  VOTE_KEY,
  enterRun,
  formatValue,
  heldElsewhere,
  holdTab,
  newId,
  nextRev,
  participantId,
  postJson,
  readStored,
  saveJson,
  sendEvent,
  useControl,
  usePoll,
  useResults,
  useTabHold,
  writeStored,
} from "./client";

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
    localStorage.setItem("aspen.overall.v1", "true");
    localStorage.setItem("aspen.participant", "p-1");
    expect(enterRun("phoenix")).toBe(true);
    expect(localStorage.getItem(CHAT_KEY)).toBeNull();
    expect(localStorage.getItem(OVERALL_KEY)).toBeNull();
    expect(localStorage.getItem(VOTE_KEY)).toBeNull();
    expect(localStorage.getItem(RATING_KEY)).toBeNull();
    // A key from an earlier version of the page goes too.
    expect(localStorage.getItem("aspen.overall.v1")).toBeNull();
    expect(localStorage.getItem("aspen.participant")).toBe("p-1");
    expect(readStored("aspen.run")).toBe("phoenix");
  });

  it("records a new run without reporting a drop when nothing was saved", () => {
    writeStored("aspen.run", "rehearsal");
    expect(enterRun("phoenix")).toBe(false);
    expect(readStored("aspen.run")).toBe("phoenix");
  });

  it("never throws when storage is blocked", () => {
    writeStored("aspen.run", "rehearsal");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      if (key === "aspen.run") return JSON.stringify("rehearsal");
      throw new Error("blocked");
    });
    expect(enterRun("phoenix")).toBe(false);
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
      // A poll that answers in time is never aborted later.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      expect(signals[1]?.aborted).toBe(false);
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
    // The room's poll gives up on a stalled request; the results poll never does (a whole run can load slowly).
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: "no-store", signal: expect.any(AbortSignal) });
    expect(CONTROL_TIMEOUT_MS).toBeGreaterThan(4000);
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
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: "no-store" });
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
