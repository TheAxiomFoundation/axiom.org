import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT, STAGES, type StageId } from "@/lib/aspen/content";
import { EMPTY_SUMMARY, type RunSummary } from "@/lib/aspen/results";
import type { Control } from "@/lib/aspen/types";
import { AspenApp } from "./aspen-app";
import { CHAT_KEY, type SavedChat } from "./chat-window";

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

async function onView(id: StageId) {
  const index = STAGES.findIndex((s) => s.id === id);
  const stage = STAGES[index];
  await waitFor(() => expect(menu()).toHaveTextContent(`${index + 1}/${STAGES.length}${stage.label}`));
  const title = id === "welcome" ? EVENT.title : stage.title;
  expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
}

const nextTo = (id: StageId) =>
  screen.getByRole("button", { name: new RegExp(`^Next${STAGES.find((s) => s.id === id)!.title.replace(/[?]/g, "\\?")}`) });

function storeChat(chat: Partial<SavedChat>) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(chat));
}

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
    return jsonResponse({ ok: true });
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

    expect(screen.queryByRole("button", { name: /The room has moved on/ })).not.toBeInTheDocument();
    expect(await screen.findByText("Answers appear here as people ask.")).toBeInTheDocument();
    // The discussion card is gone: ratings and notes come in through Rate it.
    expect(screen.queryByText("Add to the discussion")).not.toBeInTheDocument();
    expect(screen.getByText(/You haven't asked the AI yet/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/aspen/results")).toBe(true);

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
    render(<AspenApp />);
    await onView("welcome");
    expect(menu()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Session" })).not.toBeInTheDocument();
    fireEvent.click(menu());
    expect(menu()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Session" })).toBeInTheDocument();
    fireEvent.click(menu());
    expect(screen.queryByRole("navigation", { name: "Session" })).not.toBeInTheDocument();
    // Picking a stage closes the menu.
    fireEvent.click(nav().getByRole("button", { name: /At scale/ }));
    await onView("scale");
    expect(screen.queryByRole("navigation", { name: "Session" })).not.toBeInTheDocument();
  });

  it("closes the session menu on a click outside it or on Escape", async () => {
    render(<AspenApp />);
    await onView("welcome");
    fireEvent.click(menu());
    expect(screen.getByRole("navigation", { name: "Session" })).toBeInTheDocument();
    // A click inside the menu keeps it open.
    fireEvent.mouseDown(screen.getByText("The evening", { selector: "nav span" }));
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
      return jsonResponse({ ok: true });
    });
    render(<AspenApp />);
    await onView("reveal");
    expect(screen.getByText("Loading the room's results…")).toBeInTheDocument();
  });

  it("nudges a participant who fell behind, and goes back to the room on request", async () => {
    control.stage = "reveal";
    render(<AspenApp />);
    await onView("reveal");

    fireEvent.click(nav().getByRole("button", { name: /Welcome/ }));
    await onView("welcome");
    expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "welcome", follow: false });

    fireEvent.click(screen.getByRole("button", { name: /The room has moved on to What we saw/ }));
    await onView("reveal");
    expect(screen.queryByRole("button", { name: /The room has moved on/ })).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "reveal", follow: true });
  });

  it("leaves a participant who went ahead alone, and follows again once the room catches up", async () => {
    control.stage = "reveal";
    const { rerender } = render(<AspenApp />);
    await onView("reveal");

    fireEvent.click(nav().getByRole("button", { name: /At scale/ }));
    await onView("scale");
    expect(screen.getByText("41%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /The room has moved on/ })).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "scale", follow: false });

    // The presenter reaches the participant's stage: following resumes.
    control = { ...control, stage: "scale" };
    rerender(<AspenApp />);
    await waitFor(
      () => expect(JSON.parse(sessionStorage.getItem("aspen.view") ?? "null")).toEqual({ view: "scale", follow: true }),
      { timeout: 6000 },
    );
  });

  it("advances with the Next link", async () => {
    control.stage = "reveal";
    render(<AspenApp />);
    await onView("reveal");
    fireEvent.click(nextTo("scale"));
    await onView("scale");
    fireEvent.click(nextTo("foundation"));
    await onView("foundation");
    expect(screen.getByText("One open, validated set of rules")).toBeInTheDocument();
  });

  it("restores the participant's own stage from sessionStorage", async () => {
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "welcome", follow: false }));
    control.stage = "reveal";
    render(<AspenApp />);
    await onView("welcome");
    expect(await screen.findByRole("button", { name: /The room has moved on to What we saw/ })).toBeInTheDocument();
    await onView("welcome");
  });

  it("restores a following phone and then follows the presenter", async () => {
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "groups", follow: true }));
    control.stage = "next";
    render(<AspenApp />);
    await onView("next");
    expect(screen.getByText("I'd like to talk about")).toBeInTheDocument();
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

  it("starts at Welcome, saves the profile and opens Try it", async () => {
    render(<AspenApp />);
    await onView("welcome");
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.getByText("Aspen Institute")).toBeInTheDocument();
    expect(screen.getByText(`${EVENT.place} · ${EVENT.shortDate}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /The room has moved on/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /A caseworker/ }));
    expect(JSON.parse(localStorage.getItem("aspen.profile") ?? "null")).toEqual({
      perspective: "caseworker",
      state: null,
      role: null,
    });
    await waitFor(() =>
      expect(events()).toContainEqual(
        expect.objectContaining({ kind: "profile", payload: { perspective: "caseworker", state: null, role: null } }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Start: ask the AI/ }));
    await onView("try");
    expect(screen.getByRole("button", { name: "A caseworker" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Ask the AI" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "What we keep" }));
    await waitFor(() =>
      expect(events()).toContainEqual(expect.objectContaining({ kind: "disclosure", payload: { opened: true }, stage: "try" })),
    );

    // Switching perspective in the chat updates the profile too.
    fireEvent.click(screen.getByRole("button", { name: "A resident" }));
    expect(JSON.parse(localStorage.getItem("aspen.profile") ?? "null")).toMatchObject({ perspective: "resident" });

    fireEvent.click(screen.getByRole("button", { name: "Back to the start" }));
    await onView("welcome");
  });

  it("opens a stage from the agenda and walks through every later stage", async () => {
    localStorage.setItem("aspen.profile", JSON.stringify({ perspective: null, state: "Arizona", role: null }));
    summary = { ...EMPTY_SUMMARY, prompts: 4, rated: 2 };
    render(<AspenApp />);
    await onView("welcome");

    fireEvent.click(screen.getByRole("button", { name: /Small groups/ }));
    await onView("groups");
    expect(screen.getByRole("button", { name: "Save our ideas" })).toBeInTheDocument();

    fireEvent.click(nextTo("next"));
    await onView("next");
    expect(screen.getByRole("combobox", { name: "State" })).toHaveValue("Arizona");

    fireEvent.click(nextTo("dinner"));
    await onView("dinner");
    expect(await screen.findByText("Tonight, this room")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next/ })).not.toBeInTheDocument();
  });
});

describe("AspenApp thread", () => {
  beforeEach(() => {
    control.live = false;
  });

  it("ties later stages back to the participant's question", async () => {
    storeChat({
      perspective: "resident",
      householdId: "az-savings",
      turns: [
        { key: "u", role: "user", content: "Q" },
        { key: "a", role: "assistant", content: "A", status: "done", promptId: "p" },
      ],
      rated: [],
    });
    render(<AspenApp />);
    fireEvent.click(nav().getByRole("button", { name: /At scale/ }));
    await onView("scale");
    expect(screen.getByText(/every one of the 46 models said it gets \$0/)).toBeInTheDocument();

    fireEvent.click(nav().getByRole("button", { name: /What we saw/ }));
    await onView("reveal");
    expect(screen.getByText(/You asked about “Disabled, with savings”\. Rate the answer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rate my answer →" }));
    await onView("try");
  });

  it("names the participant's own question and a missing rating list", async () => {
    storeChat({
      householdId: "own",
      turns: [
        { key: "u", role: "user", content: "Q" },
        { key: "a", role: "assistant", content: "A", status: "done", promptId: "p" },
      ],
    } as Partial<SavedChat>);
    render(<AspenApp />);
    fireEvent.click(nav().getByRole("button", { name: /Shared foundation/ }));
    await onView("foundation");
    expect(screen.getByText(/Now check the AI's answer about your own question against the encoded rules\./)).toBeInTheDocument();
  });

  it("treats a chat without a user turn or a finished answer as not asked", async () => {
    storeChat({ perspective: "resident", householdId: "az-retiree", turns: [], rated: ["x"] });
    render(<AspenApp />);
    fireEvent.click(nav().getByRole("button", { name: /What we saw/ }));
    await onView("reveal");
    expect(screen.getByText(/You haven't asked the AI yet/)).toBeInTheDocument();
  });

  it("ignores a saved chat without turns", async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify({ householdId: "az-retiree" }));
    render(<AspenApp />);
    fireEvent.click(nav().getByRole("button", { name: /At scale/ }));
    await onView("scale");
    expect(screen.getByText(/You haven't asked the AI yet/)).toBeInTheDocument();
  });
});
