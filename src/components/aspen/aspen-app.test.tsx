import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT, LOOK_UP, STAGES, USE_CASES, type StageId } from "@/lib/aspen/content";
import { EMPTY_SUMMARY, type RunSummary } from "@/lib/aspen/results";
import type { Control } from "@/lib/aspen/types";
import { AspenApp } from "./aspen-app";
import { CHAT_KEY, type SavedChat } from "./chat-window";
import { OVERALL_KEY, PLEDGE_KEY, VOTE_KEY, _resetRoom, currentRun } from "./client";

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data } as unknown as Response;
}

let control: Control;
let summary: RunSummary;
let fetchMock: ReturnType<typeof vi.fn>;

function events() {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/aspen/event")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function menu() {
  return document.querySelector('[aria-controls="aspen-stages"]') as HTMLElement;
}

/** Opens the session menu (if it is closed) and searches inside it. */
function nav() {
  if (menu().getAttribute("aria-expanded") !== "true") fireEvent.click(menu());
  return within(screen.getByRole("navigation", { name: "Session" }));
}

/** Waits for the phone's first poll of the room to land: until then only Welcome is open. */
async function roomAnswered() {
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/aspen/state")).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function onView(id: StageId) {
  await roomAnswered();
  const index = STAGES.findIndex((s) => s.id === id);
  const stage = STAGES[index];
  await waitFor(() => expect(menu()).toHaveTextContent(`${stage.label}${index + 1} of ${STAGES.length}`));
  const title = id === "welcome" ? EVENT.title : stage.title;
  expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
}

/** The Next button to a stage, open or waiting for the room. */
const nextTo = (id: StageId) =>
  screen.getByRole("button", {
    name: new RegExp(`^(Next|Up next, when the room gets there)${STAGES.find((s) => s.id === id)!.title.replace(/[?]/g, "\\?")}`),
  });

function storeChat(chat: Partial<SavedChat>) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(chat));
}

/** The phone's card while the room looks at the TV. */
const lookUp = () => within(screen.getByRole("region", { name: LOOK_UP.heading }));

const RATED_CHAT: Partial<SavedChat> = {
  perspective: "resident",
  householdId: "az-retiree",
  turns: [
    { key: "u", role: "user", content: "Q" },
    { key: "a", role: "assistant", content: "A", status: "done", promptId: "p" },
  ],
  rated: ["p"],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("aspen.participant", "p-1");
  control = { runId: "phoenix", stage: "welcome", live: true, updatedAt: null };
  summary = EMPTY_SUMMARY;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/aspen/state") return jsonResponse(control);
    if (url.startsWith("/api/aspen/results")) return jsonResponse({ runId: control.runId, live: true, summary });
    return jsonResponse({ ok: true, saved: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AspenApp following the presenter", () => {
  it("follows the presenter's stage and shows the room's results on the reveal", async () => {
    control.stage = "reveal";
    render(<AspenApp />);
    await onView("reveal");

    expect(screen.queryByRole("button", { name: /Jump to where the room is/ })).not.toBeInTheDocument();
    // The phone points at the TV; nobody has rated yet, so there's no number (the run-through, Oct 22).
    expect(lookUp().getByText(LOOK_UP.reveal.empty)).toBeInTheDocument();
    expect(lookUp().getByText(LOOK_UP.later)).toBeInTheDocument();
    expect(screen.queryByText("Add to the discussion")).not.toBeInTheDocument();
    expect(screen.queryByText(/You haven't asked the AI yet/)).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/aspen/results")).toBe(true));

    const live = nav().getByRole("button", { name: /What we saw/ });
    expect(live).toHaveAttribute("aria-current", "step");
    expect(within(live).getByText("Now")).toBeInTheDocument();
    expect(within(live).getByText("You are here")).toBeInTheDocument();

    await waitFor(() =>
      expect(events()).toContainEqual({
        participantId: "p-1",
        kind: "stage_view",
        payload: { stage: "reveal", followed: true },
        stage: "reveal",
      }),
    );
    expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "reveal", follow: true });
  });

  it("opens and closes the session menu", async () => {
    control.stage = "scale";
    render(<AspenApp />);
    await onView("scale");
    expect(menu()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Session" })).not.toBeInTheDocument();
    fireEvent.click(menu());
    expect(menu()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Session" })).toBeInTheDocument();
    fireEvent.click(menu());
    expect(screen.queryByRole("navigation", { name: "Session" })).not.toBeInTheDocument();
    // Picking a stage closes the menu.
    fireEvent.click(menu());
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    expect(screen.queryByRole("navigation", { name: "Session" })).not.toBeInTheDocument();
  });

  it("closes the session menu on a click outside it or on Escape", async () => {
    render(<AspenApp />);
    await onView("welcome");
    fireEvent.click(menu());
    expect(screen.getByRole("navigation", { name: "Session" })).toBeInTheDocument();
    // A click inside the menu keeps it open.
    fireEvent.mouseDown(screen.getByText("Agenda", { selector: "nav span" }));
    expect(screen.getByRole("navigation", { name: "Session" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("navigation", { name: "Session" })).not.toBeInTheDocument();

    fireEvent.click(menu());
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("navigation", { name: "Session" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Session" })).not.toBeInTheDocument();
    expect(menu()).toHaveFocus();
  });

  it("shows a loading line until the results arrive", async () => {
    control.stage = "reveal";
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/aspen/state") return jsonResponse(control);
      if (url.startsWith("/api/aspen/results")) return new Promise<Response>(() => {});
      return jsonResponse({ ok: true, saved: true });
    });
    render(<AspenApp />);
    await onView("reveal");
    // Until the results arrive the card says where to look, with no number.
    expect(lookUp().getByText(LOOK_UP.reveal.empty)).toBeInTheDocument();
    expect(lookUp().queryByText(LOOK_UP.reveal.label)).not.toBeInTheDocument();
  });

  it("shows the room's number on the phone while the TV shows What we saw and Shared foundation", async () => {
    control.live = false;
    summary = {
      ...EMPTY_SUMMARY,
      viability: { ...EMPTY_SUMMARY.viability, rated: 9, right: 4 },
      sourceOfTruth: [
        { id: "yes", label: "Yes", count: 2 },
        { id: "partly", label: "Partly", count: 5 },
        { id: "no", label: "No", count: 3 },
      ],
    };
    render(<AspenApp />);
    await roomAnswered();
    fireEvent.click(nav().getByRole("button", { name: /What we saw/ }));
    await onView("reveal");
    expect(await screen.findByText("4 of 9")).toBeInTheDocument();
    expect(lookUp().getByText(LOOK_UP.reveal.label)).toBeInTheDocument();

    fireEvent.click(nav().getByRole("button", { name: /At scale/ }));
    await onView("scale");
    expect(lookUp().getByText("42%")).toBeInTheDocument();
    expect(lookUp().getByText(LOOK_UP.scale.label)).toBeInTheDocument();

    fireEvent.click(nav().getByRole("button", { name: /Shared foundation/ }));
    await onView("foundation");
    // "Partly" counts: they can't fully check an answer.
    expect(await screen.findByText("8 of 10")).toBeInTheDocument();
    expect(lookUp().getByText(LOOK_UP.foundation.label)).toBeInTheDocument();
  });

  it("nudges a participant who fell behind, and goes back to the room on request", async () => {
    control.stage = "reveal";
    render(<AspenApp />);
    await onView("reveal");

    fireEvent.click(nav().getByRole("button", { name: /Welcome/ }));
    await onView("welcome");
    expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "welcome", follow: false });

    fireEvent.click(screen.getByRole("button", { name: /Jump to where the room is: What we saw/ }));
    await onView("reveal");
    expect(screen.queryByRole("button", { name: /Jump to where the room is/ })).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "reveal", follow: true });
  });

  it("keeps a participant from going past the room, and opens each stage as the room gets there", async () => {
    // The dry run, Oct 25: phones never run ahead of the presenter.
    control.stage = "reveal";
    const { rerender } = render(<AspenApp />);
    await onView("reveal");

    fireEvent.click(menu());
    const later = nav().getByRole("button", { name: /At scale/ });
    expect(later).toBeDisabled();
    expect(later).toHaveAccessibleName(/opens when the room gets there/);
    expect(nav().getByRole("button", { name: /Try it/ })).toBeEnabled();
    fireEvent.click(later);
    expect(screen.getByRole("navigation", { name: "Session" })).toBeInTheDocument();
    await onView("reveal");
    fireEvent.click(menu());
    // The Next button names the stage but waits for the room.
    const next = nextTo("scale");
    expect(next).toBeDisabled();
    expect(next).toHaveTextContent("Up next, when the room gets there");

    // The presenter moves on: the phone follows, and the next stage still waits.
    control = { ...control, stage: "scale" };
    rerender(<AspenApp />);
    // The phone polls the room's stage every few seconds.
    await waitFor(
      () => expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "scale", follow: true }),
      { timeout: 6000 },
    );
    await onView("scale");
    expect(nextTo("foundation")).toBeDisabled();
  });

  it("brings a phone that was past the room back to it, and keeps Forward from going past it", async () => {
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "groups", follow: false }));
    control.stage = "reveal";
    render(<AspenApp />);
    await onView("reveal");
    expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "reveal", follow: true });
    // A history entry past the room lands on the room's stage instead, without ever opening it.
    const views = () => events().filter((e) => e.kind === "stage_view");
    const before = views().length;
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { aspenStage: "next" } }));
    });
    await onView("reveal");
    expect(views().slice(before).map((e) => e.payload.stage)).not.toContain("next");
    expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "reveal", follow: true });
  });

  it("keeps a phone that just joined on Welcome until its first poll of the room lands", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/aspen/state") return new Promise<Response>((resolve) => (answer = resolve));
      if (url.startsWith("/api/aspen/results")) return jsonResponse({ runId: control.runId, live: true, summary });
      return jsonResponse({ ok: true, saved: true });
    });
    control = { ...control, live: false };
    render(<AspenApp />);
    // Before the room answers, nothing past Welcome opens, even though no presenter turns out to be live.
    expect(screen.getByRole("button", { name: /Start: ask the AI/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Start: ask the AI/ }));
    expect(screen.getByRole("heading", { level: 1, name: EVENT.title })).toBeInTheDocument();
    await act(async () => answer(jsonResponse(control)));
    await waitFor(() => expect(screen.getByRole("button", { name: /Start: ask the AI/ })).toBeEnabled());
  });

  it("opens every stage when the phone can't reach the room", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/aspen/state") throw new Error("offline");
      if (url.startsWith("/api/aspen/results")) return jsonResponse({ runId: control.runId, live: true, summary });
      return jsonResponse({ ok: true, saved: true });
    });
    render(<AspenApp />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Start: ask the AI/ })).toBeEnabled());
  });

  it("waits on the welcome page until the session starts, and opens every stage without a live presenter", async () => {
    const { rerender } = render(<AspenApp />);
    await onView("welcome");
    expect(screen.getByRole("button", { name: /Start: ask the AI/ })).toBeDisabled();
    expect(screen.getByText("This opens when the session starts.")).toBeInTheDocument();
    // No live control row (a database error): nothing waits, so the page still works.
    control = { ...control, live: false };
    rerender(<AspenApp />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Start: ask the AI/ })).toBeEnabled(), { timeout: 6000 });
    fireEvent.click(menu());
    expect(nav().getByRole("button", { name: /Thank you/ })).toBeEnabled();
  });

  it("advances with the Next link", async () => {
    // Behind the room, Next moves on until it reaches the room's stage.
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "reveal", follow: false }));
    control.stage = "foundation";
    render(<AspenApp />);
    await onView("reveal");
    fireEvent.click(nextTo("scale"));
    await onView("scale");
    fireEvent.click(nextTo("foundation"));
    await onView("foundation");
    expect(lookUp().getByText(LOOK_UP.foundation.empty)).toBeInTheDocument();
  });

  it("restores the participant's own stage from sessionStorage", async () => {
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "welcome", follow: false }));
    control.stage = "reveal";
    render(<AspenApp />);
    await onView("welcome");
    expect(await screen.findByRole("button", { name: /Jump to where the room is: What we saw/ })).toBeInTheDocument();
    await onView("welcome");
  });

  it("restores a following phone and then follows the presenter", async () => {
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "groups", follow: true }));
    control.stage = "next";
    render(<AspenApp />);
    await onView("next");
    // The form is always in the page now, so only a role query (which skips hidden content) says it shows.
    expect(screen.getByRole("group", { name: "I'd like to talk about" })).toBeInTheDocument();
  });

  it("keeps a phone on an unsent Next steps form when the room moves to Thank you (Pavel, Oct 26)", async () => {
    control.stage = "next";
    const { rerender } = render(<AspenApp />);
    await onView("next");
    const email = () => screen.getByRole("textbox", { name: "Email" });
    fireEvent.change(email(), { target: { value: "ada@az.gov" } });

    // The room moves on: once the poll lands, the banner offers the jump, and the form stays put.
    control = { ...control, stage: "dinner" };
    rerender(<AspenApp />);
    expect(await screen.findByRole("button", { name: /Jump to where the room is: Thank you/ }, { timeout: 6000 })).toBeInTheDocument();
    await onView("next");
    expect(email()).toHaveValue("ada@az.gov");

    // A trip to Thank you and back keeps what was typed.
    fireEvent.click(screen.getByRole("button", { name: /Jump to where the room is: Thank you/ }));
    await onView("dinner");
    fireEvent.click(screen.getByRole("button", { name: "Back to Next steps" }));
    await onView("next");
    expect(email()).toHaveValue("ada@az.gov");
  });

  it("follows the room to Thank you once the Next steps form is sent", async () => {
    control.stage = "next";
    const { rerender } = render(<AspenApp />);
    await onView("next");
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Thank you.")).toBeInTheDocument();

    control = { ...control, stage: "dinner" };
    rerender(<AspenApp />);
    await waitFor(
      () => expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "dinner", follow: true }),
      { timeout: 6000 },
    );
    await onView("dinner");
  });

  it("doesn't let a send from the old run, answered after a new run starts, count as the new run's", async () => {
    // The review of #376: a rehearsal send whose answer came after Start run marked the live run's
    // form as sent, so the phone left it for Thank you, and a reload showed the old thank-you.
    control.stage = "next";
    storeChat({ turns: [] });
    const { rerender } = render(<AspenApp />);
    await onView("next");
    // The pledge's answer is held; the rest answers as beforeEach's does.
    let answer: (r: Response) => void = () => {};
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/aspen/pledge") return new Promise<Response>((resolve) => (answer = resolve));
      if (url === "/api/aspen/state") return jsonResponse(control);
      if (url.startsWith("/api/aspen/results")) return jsonResponse({ runId: control.runId, live: true, summary });
      return jsonResponse({ ok: true, saved: true });
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();

    // Start run: the phone drops the old run's chat and starts the new run at Welcome.
    control = { ...control, runId: "live", stage: "welcome" };
    rerender(<AspenApp />);
    await waitFor(() => expect(localStorage.getItem("aspen.run")).toBe(JSON.stringify("live")), { timeout: 6000 });
    await act(async () => answer(jsonResponse({ ok: true })));
    expect(localStorage.getItem(PLEDGE_KEY)).toBeNull();

    // The new run reaches Next steps: a blank form, and the phone keeps it when the room moves on.
    control = { ...control, stage: "next" };
    rerender(<AspenApp />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Email" })).toBeVisible(), { timeout: 6000 });
    await onView("next");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.queryByText("Thank you.")).not.toBeInTheDocument();
    control = { ...control, stage: "dinner" };
    rerender(<AspenApp />);
    expect(await screen.findByRole("button", { name: /Jump to where the room is: Thank you/ }, { timeout: 6000 })).toBeInTheDocument();
    await onView("next");
    expect(localStorage.getItem(PLEDGE_KEY)).toBeNull();
  });

  it("starts a new run's pledge form blank on a phone whose storage is blocked, whatever the old run's form hears back", async () => {
    vi.useFakeTimers();
    const flush = (ms = 0) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    // Its local storage blocked, the phone keeps its run in memory (client.ts recordedRun).
    const { getItem, setItem, removeItem } = Storage.prototype;
    const blocked = (storage: Storage) => {
      if (storage === localStorage) throw new DOMException("Storage blocked", "SecurityError");
    };
    try {
      vi.setSystemTime(new Date("2026-10-27T01:00:00.000Z"));
      _resetRoom();
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
        blocked(this);
        return getItem.call(this, key);
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        blocked(this);
        return setItem.call(this, key, value);
      });
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
        blocked(this);
        return removeItem.call(this, key);
      });
      control = { runId: "rehearsal", stage: "next", live: true, updatedAt: "2026-10-27T01:00:00.000Z" };
      let receipt: (r: Response) => void = () => {};
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/aspen/state") return jsonResponse(control);
        // The store kept this pledge in the rehearsal; only its answer is slow.
        if (url === "/api/aspen/pledge") return new Promise<Response>((resolve) => (receipt = resolve));
        return jsonResponse({ ok: true, saved: true });
      });
      render(<AspenApp />);
      await flush();
      fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "rehearsal@example.gov" } });
      fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await flush();
      expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();

      // Start run, then the rehearsal's answer, then the event reaches Next steps.
      control = { ...control, runId: "event", stage: "welcome", updatedAt: "2026-10-27T01:00:01.000Z" };
      await flush(4000);
      expect(currentRun()).toBe("event");
      await act(async () => receipt(jsonResponse({ ok: true })));
      control = { ...control, stage: "next", updatedAt: "2026-10-27T01:00:05.000Z" };
      await flush(4000);
      // The event needs its own pledge (the review of #376).
      expect(screen.queryByText("Thank you.")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      _resetRoom();
    }
  });

  it("keeps the form's thank-you up when a held phone sends", async () => {
    control.stage = "next";
    const { rerender } = render(<AspenApp />);
    await onView("next");
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    control = { ...control, stage: "dinner" };
    rerender(<AspenApp />);
    expect(await screen.findByRole("button", { name: /Jump to where the room is: Thank you/ }, { timeout: 6000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Thank you.")).toBeInTheDocument();
    // Another poll of the room lands, and the phone still shows its thank-you.
    const polls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/aspen/state").length;
    const sent = polls();
    await waitFor(() => expect(polls()).toBeGreaterThan(sent), { timeout: 6000 });
    await onView("next");
    expect(screen.getByText("Thank you.")).toBeInTheDocument();
  });

  it("sends a reloaded phone that already sent the form on to Thank you with the room", async () => {
    localStorage.setItem("aspen.run", JSON.stringify("phoenix"));
    localStorage.setItem(PLEDGE_KEY, "true");
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "next", follow: true }));
    control.stage = "dinner";
    render(<AspenApp />);
    await onView("dinner");
    // Back on Next steps, it shows the thank-you, not a blank form.
    fireEvent.click(screen.getByRole("button", { name: "Back to Next steps" }));
    await onView("next");
    expect(screen.getByText("Thank you.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
  });

  it("starts a held form over when the presenter starts a new run", async () => {
    control.stage = "next";
    const { rerender } = render(<AspenApp />);
    await onView("next");
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
    control = { ...control, stage: "dinner" };
    rerender(<AspenApp />);
    expect(await screen.findByRole("button", { name: /Jump to where the room is: Thank you/ }, { timeout: 6000 })).toBeInTheDocument();

    // New run puts the room back at Welcome, and the phone goes with it.
    control = { ...control, runId: "phoenix-2", stage: "welcome" };
    rerender(<AspenApp />);
    await waitFor(
      () => expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "welcome", follow: true }),
      { timeout: 6000 },
    );
    control = { ...control, stage: "next" };
    rerender(<AspenApp />);
    await waitFor(
      () => expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "next", follow: true }),
      { timeout: 6000 },
    );
    await onView("next");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
  });

  it("holds a phone that sent in the old run on the new run's form", async () => {
    control.stage = "next";
    const { rerender } = render(<AspenApp />);
    await onView("next");
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Thank you.")).toBeInTheDocument();

    const moveRoom = async (next: Partial<Control>) => {
      control = { ...control, ...next };
      rerender(<AspenApp />);
      await waitFor(
        () => expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: control.stage, follow: true }),
        { timeout: 6000 },
      );
    };
    await moveRoom({ runId: "phoenix-2", stage: "welcome" });
    await moveRoom({ stage: "next" });
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");

    // The rehearsal's send doesn't count in the new run: the blank form holds the phone.
    control = { ...control, stage: "dinner" };
    rerender(<AspenApp />);
    expect(await screen.findByRole("button", { name: /Jump to where the room is: Thank you/ }, { timeout: 6000 })).toBeInTheDocument();
    await onView("next");
  });

  it("still follows the room from Next steps to any stage but Thank you", async () => {
    control.stage = "next";
    const { rerender } = render(<AspenApp />);
    await onView("next");
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });

    // The presenter steps back: the phone goes with the room, and the form keeps its email for later.
    control = { ...control, stage: "groups" };
    rerender(<AspenApp />);
    await waitFor(
      () => expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "groups", follow: true }),
      { timeout: 6000 },
    );
    await onView("groups");
    control = { ...control, stage: "next" };
    rerender(<AspenApp />);
    await waitFor(
      () => expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "next", follow: true }),
      { timeout: 6000 },
    );
    await onView("next");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ada@az.gov");
  });

  it("ignores a stored stage it does not know", async () => {
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "lobby", follow: false }));
    control.live = false;
    render(<AspenApp />);
    await onView("welcome");
  });
});

describe("AspenApp without a live presenter", () => {
  beforeEach(() => {
    control.live = false;
    control.stage = "reveal";
  });

  it("starts at Welcome without asking who you are, and opens Try it", async () => {
    render(<AspenApp />);
    await onView("welcome");
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.getByText("Aspen Institute")).toBeInTheDocument();
    expect(screen.getByText(`${EVENT.place} · ${EVENT.shortDate}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jump to where the room is/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Start: ask the AI/ }));
    await onView("try");
    // Who you ask as is picked in the chat itself, a resident to start.
    expect(screen.getByRole("button", { name: "A resident" })).toHaveAttribute("aria-pressed", "true");
    // Then a household; the box and Ask the AI wait for one (Michaela, Oct 26).
    expect(screen.getByRole("group", { name: "Households" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask the AI" })).not.toBeInTheDocument();
    // Try it ends with a rated answer: Next waits for one.
    const next = screen.getByRole("button", { name: /^Next/ });
    expect(next).toBeDisabled();
    expect(next).toHaveTextContent("Rate your answer to continue");

    fireEvent.click(screen.getByRole("button", { name: "What we keep" }));
    await waitFor(() =>
      expect(events()).toContainEqual(expect.objectContaining({ kind: "disclosure", payload: { opened: true }, stage: "try" })),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to the start" }));
    await onView("welcome");
  });

  it("opens Next from Try it once an answer is rated", async () => {
    storeChat({
      perspective: "resident",
      householdId: "az-retiree",
      turns: [
        { key: "u", role: "user", content: "Q" },
        { key: "a", role: "assistant", content: "A", status: "done", promptId: "p" },
      ],
      rated: ["p"],
    });
    render(<AspenApp />);
    await roomAnswered();
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    await waitFor(() => expect(nextTo("reveal")).toBeEnabled());
    fireEvent.click(nextTo("reveal"));
    await onView("reveal");
  });

  it("goes one stage back with the small back button", async () => {
    render(<AspenApp />);
    await onView("welcome");
    // The landing is the first stage: only the logo leads back to it.
    expect(screen.queryByRole("button", { name: /^Back to (?!the start)/ })).not.toBeInTheDocument();
    fireEvent.click(nav().getByRole("button", { name: /At scale/ }));
    await onView("scale");
    fireEvent.click(screen.getByRole("button", { name: "Back to What we saw" }));
    await onView("reveal");
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    fireEvent.click(screen.getByRole("button", { name: "Back to Welcome" }));
    await onView("welcome");
  });

  it("goes back to the last stage it opened with the browser's Back button", async () => {
    render(<AspenApp />);
    await onView("welcome");
    expect(window.history.state).toMatchObject({ aspenStage: "welcome" });
    fireEvent.click(screen.getByRole("button", { name: /Start: ask the AI/ }));
    await onView("try");
    expect(window.history.state).toMatchObject({ aspenStage: "try" });
    fireEvent.click(nav().getByRole("button", { name: /At scale/ }));
    await onView("scale");

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { aspenStage: "try" } }));
    });
    await onView("try");
    // An entry that is not ours (e.g. from the router) changes nothing.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { other: true } }));
    });
    await onView("try");
  });

  it("walks from the small groups through next steps to the thank-you", async () => {
    render(<AspenApp />);
    await onView("welcome");

    fireEvent.click(nav().getByRole("button", { name: /Small groups/ }));
    await onView("groups");
    // The vote and the group's idea share one screen.
    expect(screen.getByRole("button", { name: "Vote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fill it in for my group" })).toBeInTheDocument();

    fireEvent.click(nextTo("next"));
    await onView("next");
    // Just an email: Aspen's roster has each leader's name, title and state.
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.queryByRole("combobox", { name: "State" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();

    fireEvent.click(nextTo("dinner"));
    await onView("dinner");
    expect(screen.getByText("To the Aspen Institute and to every leader in the room.")).toBeInTheDocument();
    // The thank-you is its own page: no stage summary above it.
    expect(screen.queryByText(STAGES.find((st) => st.id === "dinner")!.summary)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to your question" }));
    await onView("try");
  });

  it("keeps the two agency questions open after Start over, and Next open", async () => {
    storeChat(RATED_CHAT);
    render(<AspenApp />);
    await roomAnswered();
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    expect(await screen.findByRole("heading", { name: "Two more, about your agency" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Start over/ })[0]);
    // Starting over never hides them (Ariel, Oct 23), and the earlier rated answer still opens Next.
    await waitFor(() => expect(screen.getByRole("group", { name: "Households" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Two more, about your agency" })).toBeInTheDocument();
    // Not yet answered, so they stay open to answer.
    expect(screen.getByRole("button", { name: "Partly" })).toBeInTheDocument();
    expect(nextTo("reveal")).toBeEnabled();
  });

  it("folds the answered agency questions to one line after Start over, and opens them on a tap", async () => {
    storeChat(RATED_CHAT);
    localStorage.setItem(OVERALL_KEY, JSON.stringify({ truth: "partly", agency: { residents: 2, staff: 2, you: 3 } }));
    render(<AspenApp />);
    await roomAnswered();
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    // Under the rated answer they show as answered.
    expect(await screen.findByRole("button", { name: "Partly" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getAllByRole("button", { name: /^Start over/ })[0]);
    // A new question isn't followed by every question at once (Max, Oct 26); Next stays open.
    await waitFor(() => expect(screen.getByText(/Your answers are saved\./)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Partly" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Two more, about your agency" })).toBeInTheDocument();
    expect(nextTo("reveal")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Change them" }));
    expect(screen.getByRole("button", { name: "Partly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "For you: 3 of 5" })).toHaveAttribute("aria-pressed", "true");
  });

  it("asks the two agency questions right under the chat, once the answer is rated", async () => {
    render(<AspenApp />);
    await roomAnswered();
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    // Nothing before the answer is rated.
    expect(screen.queryByRole("heading", { name: "Two more, about your agency" })).not.toBeInTheDocument();
    cleanup();

    storeChat(RATED_CHAT);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AspenApp />);
    await roomAnswered();
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    expect(await screen.findByRole("heading", { name: "Two more, about your agency" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next: two more, about your agency/ }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    fireEvent.click(screen.getByRole("button", { name: "Partly" }));
    fireEvent.click(screen.getByRole("button", { name: "For residents: 2 of 5" }));
    await waitFor(() =>
      expect(events()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "survey", stage: "try", payload: { question: "source-of-truth", answer: "partly", rev: expect.any(Number) } }),
          expect.objectContaining({
            kind: "discussion",
            stage: "try",
            payload: expect.objectContaining({ question: "experience", ratings: { residents: 2 } }),
          }),
        ]),
      ),
    );
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe("AspenApp look-up moments", () => {
  beforeEach(() => {
    control.live = false;
  });

  it("shows the same card whether or not this phone asked, with no thread back to Try it", async () => {
    storeChat({ ...RATED_CHAT, householdId: "ct-couple", rated: [] });
    render(<AspenApp />);
    await roomAnswered();
    fireEvent.click(nav().getByRole("button", { name: /At scale/ }));
    await onView("scale");
    expect(lookUp().getByText("42%")).toBeInTheDocument();
    // The thread cards are gone from the phone (the run-through, Oct 22).
    expect(screen.queryByText(/You asked about/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rate my answer →" })).not.toBeInTheDocument();

    fireEvent.click(nav().getByRole("button", { name: /Shared foundation/ }));
    await onView("foundation");
    expect(lookUp().getByText(LOOK_UP.foundation.empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check my answer/ })).not.toBeInTheDocument();
  });

  it("asks nothing on the phone during the TV stages", async () => {
    for (const id of ["reveal", "scale", "foundation"] as const) {
      cleanup();
      render(<AspenApp />);
      await roomAnswered();
      const label = STAGES.find((st) => st.id === id)!.label;
      fireEvent.click(nav().getByRole("button", { name: new RegExp(label) }));
      await onView(id);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("button", { pressed: false })).toHaveLength(0);
    }
  });
});

describe("AspenApp after a new run", () => {
  const asked: Partial<SavedChat> = {
    perspective: "resident",
    householdId: "ct-couple",
    turns: [
      { key: "u", role: "user", content: "Q" },
      { key: "a", role: "assistant", content: "The answer for the couple", status: "done", promptId: "p" },
    ],
    rated: [],
  };

  it("drops a rehearsal's chat and shared ratings, and follows the room again", async () => {
    localStorage.setItem("aspen.run", JSON.stringify("rehearsal"));
    localStorage.setItem("aspen.overall.v2", JSON.stringify({ truth: "no" }));
    storeChat(asked);
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "scale", follow: false }));
    control.stage = "try";
    render(<AspenApp />);

    // The new run starts this phone clean and puts it back with the room.
    await onView("try");
    await waitFor(() => expect(localStorage.getItem("aspen.run")).toBe(JSON.stringify("phoenix")));
    // The run is recorded as the old chat is dropped; the chat saves its empty conversation a render or two later.
    await waitFor(() => expect(JSON.parse(localStorage.getItem(CHAT_KEY) ?? "{}").turns).toEqual([]));
    expect(screen.queryByText("The answer for the couple")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Households" })).toBeInTheDocument();

    // The overall answers are gone too, so they can be given again.
    expect(localStorage.getItem("aspen.overall.v2")).toBeNull();
  });

  it("keeps the chat while the run stays the same", async () => {
    localStorage.setItem("aspen.run", JSON.stringify("phoenix"));
    storeChat(asked);
    control.stage = "try";
    render(<AspenApp />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/aspen/state")).toBe(true));
    await onView("try");
    // The conversation is still there, waiting for its rating.
    expect(await screen.findByText("The answer for the couple")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Your verdict" })).toBeInTheDocument();
  });

  it("keeps the chat when the control row is not live (a database error)", async () => {
    control = { runId: "rehearsal", stage: "welcome", live: false, updatedAt: null };
    localStorage.setItem("aspen.run", JSON.stringify("phoenix"));
    storeChat(asked);
    render(<AspenApp />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/aspen/state")).toBe(true));
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    // The conversation is still there, waiting for its rating.
    expect(await screen.findByText("The answer for the couple")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Your verdict" })).toBeInTheDocument();
    expect(localStorage.getItem("aspen.run")).toBe(JSON.stringify("phoenix"));
  });

  it.each([
    { clock: "as it was", reload: 500 },
    // A phone whose clock ran fast, corrected on the reload: 700 ms before it followed the event (the review of #376).
    { clock: "corrected back", reload: -500 },
  ])("keeps this run's vote when a reload's first poll reaches a server instance still holding the run before, the phone's clock $clock", async ({ reload }) => {
    vi.useFakeTimers();
    const flush = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    try {
      const start = Date.parse("2026-10-27T01:00:00.000Z");
      vi.setSystemTime(start);
      // Two server instances, each with its own two-second cache of the room (store.ts readControl).
      vi.resetModules();
      const instanceA = await import("@/lib/aspen/store");
      vi.resetModules();
      const instanceB = await import("@/lib/aspen/store");
      // One database: an update applies only over an older row, in the run it names.
      let row = { run_id: "rehearsal", stage: "welcome", updated_at: "2026-10-27T00:59:59.000Z" };
      const database = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const query = new URL(String(input)).searchParams;
        if (init?.method === "PATCH") {
          const before = query.get("updated_at")!.replace(/^lt\./, "");
          const inRun = query.get("run_id");
          if (!(Date.parse(row.updated_at) < Date.parse(before) && (inRun === null || inRun === `eq.${row.run_id}`))) {
            return new Response(JSON.stringify([]));
          }
          row = { ...row, ...JSON.parse(String(init.body)) };
        }
        return new Response(JSON.stringify([{ ...row }]));
      }) as typeof fetch;
      const store = instanceA.createSupabaseStore({ url: "https://db.example", key: "service" }, database);
      // B reads the rehearsal's row, and serves it until 01:00:02.
      await instanceB.readControl(store);
      vi.setSystemTime(start + 100);
      await instanceA.writeControl(store, { runId: "event", stage: "welcome", inRun: "rehearsal" });
      vi.setSystemTime(start + 200);
      await instanceA.writeControl(store, { stage: "groups", inRun: "event" });
      let serving = instanceA;
      fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
        String(input) === "/api/aspen/state" ? jsonResponse(await serving.readControl(store)) : jsonResponse({ ok: true, saved: true }),
      );

      // A phone joins the event, opens Small groups with the room, and votes.
      const first = render(<AspenApp />);
      await flush();
      expect(currentRun()).toBe("event");
      fireEvent.click(within(screen.getByRole("group", { name: "Pick one" })).getByRole("button", { name: new RegExp(`^${USE_CASES[0].label}`) }));
      fireEvent.click(screen.getByRole("button", { name: "Vote" }));
      await flush();
      expect(localStorage.getItem(VOTE_KEY)).toBe(JSON.stringify(USE_CASES[0].id));
      first.unmount();

      // It reloads, and its first poll reaches B, whose cache still holds the rehearsal. (The instances share
      // the test's clock: with it set back, B's cache holds as it would 500 ms on.)
      vi.setSystemTime(start + reload);
      serving = instanceB;
      render(<AspenApp />);
      await flush();
      expect(currentRun()).toBe("event");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(currentRun()).toBe("event");
      expect(localStorage.getItem(VOTE_KEY)).toBe(JSON.stringify(USE_CASES[0].id));
      expect(screen.getByText("You voted:")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.resetModules();
    }
  });

  it("keeps this run's vote across a reload when storage was too full to keep the room's row until the old chat went", async () => {
    vi.useFakeTimers();
    const flush = (ms = 0) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    try {
      const start = Date.parse("2026-10-27T01:00:00.000Z");
      vi.setSystemTime(start);
      _resetRoom();
      // Two server instances, each with its own two-second cache of the room (store.ts readControl).
      vi.resetModules();
      const instanceA = await import("@/lib/aspen/store");
      vi.resetModules();
      const instanceB = await import("@/lib/aspen/store");
      let row = { run_id: "r0", stage: "try", updated_at: "2026-10-27T00:59:59.000Z" };
      const database = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const query = new URL(String(input)).searchParams;
        if (init?.method === "PATCH") {
          const before = query.get("updated_at")!.replace(/^lt\./, "");
          const inRun = query.get("run_id");
          if (!(Date.parse(row.updated_at) < Date.parse(before) && (inRun === null || inRun === `eq.${row.run_id}`))) {
            return new Response(JSON.stringify([]));
          }
          row = { ...row, ...JSON.parse(String(init.body)) };
        }
        return new Response(JSON.stringify([{ ...row }]));
      }) as typeof fetch;
      const store = instanceA.createSupabaseStore({ url: "https://db.example", key: "service" }, database);
      // The phone was in r0, on Try it, with a chat; B reads r0's row and serves it until 01:00:02.
      localStorage.setItem("aspen.room", JSON.stringify({ row: { runId: "r0", stage: "try", live: true, updatedAt: row.updated_at }, at: start }));
      localStorage.setItem("aspen.run", JSON.stringify("r0"));
      storeChat({ turns: [], draft: "x".repeat(1000) } as Partial<SavedChat>);
      await instanceB.readControl(store);
      vi.setSystemTime(start + 100);
      await instanceA.writeControl(store, { runId: "r1", stage: "welcome", inRun: "r0" });
      vi.setSystemTime(start + 200);
      await instanceA.writeControl(store, { stage: "groups", inRun: "r1" });
      let serving = instanceA;
      fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
        String(input) === "/api/aspen/state" ? jsonResponse(await serving.readControl(store)) : jsonResponse({ ok: true, saved: true }),
      );
      // Storage is too full for r1's row (a longer stage than r0's) until the old chat goes.
      const { setItem, removeItem } = Storage.prototype;
      let full = true;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        if (full && key === "aspen.room") throw new DOMException("No room", "QuotaExceededError");
        return setItem.call(this, key, value);
      });
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
        if (key === CHAT_KEY) full = false;
        return removeItem.call(this, key);
      });

      // The phone follows the room into r1's Small groups and votes.
      const first = render(<AspenApp />);
      await flush();
      expect(currentRun()).toBe("r1");
      fireEvent.click(within(screen.getByRole("group", { name: "Pick one" })).getByRole("button", { name: new RegExp(`^${USE_CASES[0].label}`) }));
      fireEvent.click(screen.getByRole("button", { name: "Vote" }));
      await flush();
      expect(localStorage.getItem(VOTE_KEY)).toBe(JSON.stringify(USE_CASES[0].id));
      first.unmount();

      // It reloads, its memory gone, and its first poll reaches B (the review of #376).
      _resetRoom();
      vi.setSystemTime(start + 500);
      serving = instanceB;
      render(<AspenApp />);
      await flush();
      expect(currentRun()).toBe("r1");
      await flush(4000);
      expect(currentRun()).toBe("r1");
      expect(localStorage.getItem(VOTE_KEY)).toBe(JSON.stringify(USE_CASES[0].id));
      expect(screen.getByText("You voted:")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.resetModules();
      _resetRoom();
    }
  });
});

describe("AspenApp in two tabs", () => {
  it("stops a tab another one has taken over, and takes it back with a reload", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<AspenApp />);
    await onView("welcome");
    const mine = localStorage.getItem("aspen.tab");
    expect(mine).not.toBeNull();

    localStorage.setItem("aspen.tab", JSON.stringify("other-tab"));
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: "aspen.tab" })));
    expect(await screen.findByRole("heading", { name: "This page is open in another tab" })).toBeInTheDocument();
    // Nothing behind it can be tapped.
    expect(screen.queryByRole("button", { name: "Back to the start" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use this tab" }));
    expect(localStorage.getItem("aspen.tab")).toBe(mine);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
