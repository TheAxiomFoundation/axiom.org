import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_KEY,
  EMPTY_PROFILE,
  OVERALL_KEY,
  enterRun,
  formatValue,
  loadProfile,
  newId,
  participantId,
  postJson,
  readStored,
  saveProfile,
  sendEvent,
  useControl,
  usePoll,
  useResults,
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

describe("profile storage", () => {
  it("returns the empty profile when nothing is saved", () => {
    expect(loadProfile()).toEqual(EMPTY_PROFILE);
  });

  it("round-trips a saved profile and fills missing fields", () => {
    saveProfile({ perspective: "caseworker", state: "Arizona", role: null });
    expect(loadProfile()).toEqual({ perspective: "caseworker", state: "Arizona", role: null });
    localStorage.setItem("aspen.profile", JSON.stringify({ state: "Ohio" }));
    expect(loadProfile()).toEqual({ perspective: null, state: "Ohio", role: null });
  });

  it("returns the empty profile for unreadable JSON", () => {
    localStorage.setItem("aspen.profile", "{not json");
    expect(loadProfile()).toEqual(EMPTY_PROFILE);
  });

  it("ignores a storage failure on save", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveProfile({ perspective: "resident", state: null, role: null })).not.toThrow();
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
    localStorage.setItem("aspen.participant", "p-1");
    expect(enterRun("phoenix")).toBe(true);
    expect(localStorage.getItem(CHAT_KEY)).toBeNull();
    expect(localStorage.getItem(OVERALL_KEY)).toBeNull();
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

function PollProbe({ url, interval }: { url: string | null; interval: number }) {
  const { data, failed } = usePoll<{ n: number }>(url, interval);
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
  });
});
