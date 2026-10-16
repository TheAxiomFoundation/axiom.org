import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  await waitFor(() => expect(menu()).toHaveTextContent(`${stage.label}${index + 1} of ${STAGES.length}`));
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
    expect(screen.getByText("42%")).toBeInTheDocument();
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

  it("starts at Welcome without asking who you are, and opens Try it", async () => {
    render(<AspenApp />);
    await onView("welcome");
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.getByText("Aspen Institute")).toBeInTheDocument();
    expect(screen.getByText(`${EVENT.place} · ${EVENT.shortDate}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /The room has moved on/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Start: ask the AI/ }));
    await onView("try");
    // Who you ask as is picked in the chat itself, a resident to start.
    expect(screen.getByRole("button", { name: "A resident" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Ask the AI" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Share with the room" })).toBeInTheDocument();

    fireEvent.click(nextTo("next"));
    await onView("next");
    expect(screen.getByRole("combobox", { name: "State" })).toHaveValue("");

    fireEvent.click(nextTo("dinner"));
    await onView("dinner");
    expect(screen.getByText("To the Aspen Institute and to every leader in the room.")).toBeInTheDocument();
    // The thank-you is its own page: no stage summary above it.
    expect(screen.queryByText(STAGES.find((st) => st.id === "dinner")!.summary)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to your question" }));
    await onView("try");
  });

  it("clears the 'ratings are in' line when a new question starts, and keeps Next open", async () => {
    storeChat({
      perspective: "resident",
      householdId: "az-retiree",
      turns: [
        { key: "u", role: "user", content: "Q" },
        { key: "a", role: "assistant", content: "A", status: "done", promptId: "p" },
      ],
      rated: ["p"],
    });
    localStorage.setItem("aspen.overall.v1", "true");
    render(<AspenApp />);
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    expect(await screen.findByText(/Your ratings are in/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Start over/ })[0]);
    await waitFor(() => expect(screen.queryByText(/Your ratings are in/)).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "One more: how did AI do overall?" })).not.toBeInTheDocument();
    // The earlier rated answer still counts for the Next link.
    expect(nextTo("reveal")).toBeEnabled();
  });

  it("hides the overall questions after a new question until the new answer is rated, if not yet shared", async () => {
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
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    expect(await screen.findByRole("heading", { name: "One more: how did AI do overall?" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Start over/ })[0]);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "One more: how did AI do overall?" })).not.toBeInTheDocument(),
    );
  });

  it("asks how AI did overall right under the chat, once the answer is rated", async () => {
    render(<AspenApp />);
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    // No overall questions before the answer is rated.
    expect(screen.queryByRole("heading", { name: "One more: how did AI do overall?" })).not.toBeInTheDocument();
    cleanup();

    storeChat({
      perspective: "resident",
      householdId: "az-retiree",
      turns: [
        { key: "u", role: "user", content: "Q" },
        { key: "a", role: "assistant", content: "A", status: "done", promptId: "p" },
      ],
      rated: ["p"],
    });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AspenApp />);
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    expect(await screen.findByRole("heading", { name: "One more: how did AI do overall?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next: how did AI do overall\?/ }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    fireEvent.click(screen.getByRole("button", { name: "Got the amount right: 2 of 5" }));
    // One step at a time, Continue to the end, then share.
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Share my ratings" }));
    expect(await screen.findByText(/Your ratings are in/)).toBeInTheDocument();
    await waitFor(() =>
      expect(events()).toContainEqual(
        expect.objectContaining({ kind: "discussion", stage: "try", payload: expect.objectContaining({ question: "performance" }) }),
      ),
    );
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
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
    expect(screen.getByText(/every one of the 50 models said it gets \$0/)).toBeInTheDocument();

    fireEvent.click(nav().getByRole("button", { name: /What we saw/ }));
    await onView("reveal");
    // What we saw opens with what you contributed: your question, and the rating still to do.
    expect(screen.getByText("You asked about “Disabled, with savings”.")).toBeInTheDocument();
    expect(screen.getByText("You haven't rated an answer yet.")).toBeInTheDocument();
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
    // The rules check is in the chatbot demo now; the foundation just recalls the question.
    expect(screen.getByText("You asked about your own question.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check my answer/ })).not.toBeInTheDocument();
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

describe("AspenApp after a new run", () => {
  const asked: Partial<SavedChat> = {
    perspective: "resident",
    householdId: "az-savings",
    turns: [
      { key: "u", role: "user", content: "Q" },
      { key: "a", role: "assistant", content: "A", status: "done", promptId: "p" },
    ],
    rated: [],
  };

  it("drops a rehearsal's chat and shared ratings, and follows the room again", async () => {
    localStorage.setItem("aspen.run", JSON.stringify("rehearsal"));
    localStorage.setItem("aspen.overall.v1", "true");
    storeChat(asked);
    sessionStorage.setItem("aspen.view", JSON.stringify({ view: "scale", follow: false }));
    render(<AspenApp />);

    await onView("welcome");
    await waitFor(() => expect(localStorage.getItem("aspen.run")).toBe(JSON.stringify("phoenix")));
    expect(JSON.parse(localStorage.getItem(CHAT_KEY) ?? "{}").turns).toEqual([]);

    fireEvent.click(nav().getByRole("button", { name: /What we saw/ }));
    await onView("reveal");
    expect(screen.getByText(/You haven't asked the AI yet/)).toBeInTheDocument();

    // The shared-ratings flag is gone too, so the overall rating can be given again.
    expect(localStorage.getItem("aspen.overall.v1")).toBeNull();
  });

  it("keeps the chat while the run stays the same", async () => {
    localStorage.setItem("aspen.run", JSON.stringify("phoenix"));
    storeChat(asked);
    render(<AspenApp />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/aspen/state")).toBe(true));
    fireEvent.click(nav().getByRole("button", { name: /What we saw/ }));
    await onView("reveal");
    // What we saw opens with what you contributed: your question, and the rating still to do.
    expect(screen.getByText("You asked about “Disabled, with savings”.")).toBeInTheDocument();
    expect(screen.getByText("You haven't rated an answer yet.")).toBeInTheDocument();
  });

  it("keeps the chat when the control row is not live (a database error)", async () => {
    control = { runId: "rehearsal", stage: "welcome", live: false, updatedAt: null };
    localStorage.setItem("aspen.run", JSON.stringify("phoenix"));
    storeChat(asked);
    render(<AspenApp />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/aspen/state")).toBe(true));
    fireEvent.click(nav().getByRole("button", { name: /What we saw/ }));
    await onView("reveal");
    // What we saw opens with what you contributed: your question, and the rating still to do.
    expect(screen.getByText("You asked about “Disabled, with savings”.")).toBeInTheDocument();
    expect(screen.getByText("You haven't rated an answer yet.")).toBeInTheDocument();
    expect(localStorage.getItem("aspen.run")).toBe(JSON.stringify("phoenix"));
  });
});
