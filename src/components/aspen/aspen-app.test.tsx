import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT, LOOK_UP, STAGES, type StageId } from "@/lib/aspen/content";
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

    expect(screen.queryByRole("button", { name: /The room has moved on/ })).not.toBeInTheDocument();
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
    expect(lookUp().getByText(LOOK_UP.foundation.empty)).toBeInTheDocument();
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
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    expect(await screen.findByRole("heading", { name: "Two more, about your agency" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Start over/ })[0]);
    // Starting over never hides them (Ariel, Oct 23), and the earlier rated answer still opens Next.
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask the AI" })).toBeDisabled());
    expect(screen.getByRole("heading", { name: "Two more, about your agency" })).toBeInTheDocument();
    expect(nextTo("reveal")).toBeEnabled();
  });

  it("asks the two agency questions right under the chat, once the answer is rated", async () => {
    render(<AspenApp />);
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    // Nothing before the answer is rated.
    expect(screen.queryByRole("heading", { name: "Two more, about your agency" })).not.toBeInTheDocument();
    cleanup();

    storeChat(RATED_CHAT);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AspenApp />);
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
    render(<AspenApp />);

    await onView("welcome");
    await waitFor(() => expect(localStorage.getItem("aspen.run")).toBe(JSON.stringify("phoenix")));
    expect(JSON.parse(localStorage.getItem(CHAT_KEY) ?? "{}").turns).toEqual([]);

    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
    await onView("try");
    expect(screen.queryByText("The answer for the couple")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask the AI" })).toBeDisabled();

    // The overall answers are gone too, so they can be given again.
    expect(localStorage.getItem("aspen.overall.v2")).toBeNull();
  });

  it("keeps the chat while the run stays the same", async () => {
    localStorage.setItem("aspen.run", JSON.stringify("phoenix"));
    storeChat(asked);
    render(<AspenApp />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/aspen/state")).toBe(true));
    fireEvent.click(nav().getByRole("button", { name: /Try it/ }));
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
});
