import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_PHONE_INTRO, DISCLOSURE, EVENT, GROUP_QUESTIONS, LOOK_UP, STAGES, USE_CASES } from "@/lib/aspen/content";
import { CHAT_KEY, PLEDGE_KEY, enterRun } from "./client";
import { Agenda, Disclosure, GroupsCard, LookUp, NextStepsForm, SmallGroups, ThankYouContent, VoteCard, WelcomeLanding } from "./stages";

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => data } as unknown as Response;
}

function stubFetch(impl?: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl ?? (async () => jsonResponse({ ok: true })));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function bodies(mock: ReturnType<typeof stubFetch>, path: string) {
  return mock.mock.calls
    .filter(([url]) => url === path)
    .map(([, init]) => JSON.parse(String(init?.body)));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("aspen.participant", "p-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Agenda", () => {
  it("lists every stage, without buttons when nothing can be picked", () => {
    render(<Agenda />);
    expect(screen.getAllByRole("listitem")).toHaveLength(STAGES.length);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.getByText("if the room allows")).toBeInTheDocument();
    for (const stage of STAGES) expect(screen.getByText(stage.agenda)).toBeInTheDocument();
  });

  it("marks the live stage and the stages before it", () => {
    const { container } = render(<Agenda live="reveal" />);
    const live = STAGES.findIndex((st) => st.id === "reveal");
    const items = screen.getAllByRole("listitem");
    expect(within(items[live]).getByText("Now")).toBeInTheDocument();
    expect(screen.getAllByText("Now")).toHaveLength(1);
    const numbers = [...container.querySelectorAll("li span.rounded-full.border-2")];
    expect(numbers[0].className).toContain("bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-paper))]");
    expect(numbers[live].className).toContain("bg-[var(--color-accent)] text-white");
    expect(numbers[live + 1].className).toContain("bg-[var(--color-paper)]");
  });

  it("calls onPick with the tapped stage", () => {
    const onPick = vi.fn();
    render(<Agenda live={null} onPick={onPick} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(STAGES.length);
    fireEvent.click(screen.getByRole("button", { name: /Try it/ }));
    expect(onPick).toHaveBeenCalledWith("try");
  });
});

describe("Disclosure", () => {
  it("opens and closes the details, reporting each opening", () => {
    const onOpen = vi.fn();
    render(<Disclosure onOpen={onOpen} />);
    expect(screen.getByText(DISCLOSURE.short, { exact: false })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "What we keep" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Less" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(DISCLOSURE.details.length);

    fireEvent.click(screen.getByRole("button", { name: "Less" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("works without an onOpen handler", () => {
    render(<Disclosure />);
    fireEvent.click(screen.getByRole("button", { name: "What we keep" }));
    expect(screen.getByText(DISCLOSURE.details[0].title)).toBeInTheDocument();
    expect(screen.getByText(DISCLOSURE.details[0].text)).toBeInTheDocument();
  });
});

describe("WelcomeLanding", () => {
  it("says what this is and starts with one button, without asking who you are", async () => {
    const fetchMock = stubFetch();
    const onStart = vi.fn();
    render(<WelcomeLanding onStart={onStart} />);
    expect(screen.getByRole("heading", { level: 1, name: EVENT.title })).toBeInTheDocument();
    // Just the question and the button: no summary line and no hosts line.
    expect(screen.queryByText(STAGES[0].summary)).not.toBeInTheDocument();
    expect(screen.queryByText(/With Ariel Kennan and Max Ghenis/)).not.toBeInTheDocument();
    expect(EVENT.title).not.toMatch(/your residents/i);
    // No agenda and no profile form on the landing: the stage menu holds the agenda.
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/tonight|evening/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Start: ask the AI/ }));
    expect(onStart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "What we keep" }));
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/aspen/event")).toEqual([
        { participantId: "p-1", kind: "disclosure", payload: { opened: true }, stage: "welcome" },
      ]),
    );
  });
});

describe("VoteCard", () => {
  it("sends one vote and remembers it", async () => {
    const fetchMock = stubFetch();
    const { unmount } = render(<VoteCard stage="vote" />);
    const vote = screen.getByRole("button", { name: "Vote" });
    expect(vote).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /See and trace the rules/ }));
    const project = screen.getByRole("button", { name: /Project policy changes/ });
    fireEvent.click(project);
    expect(project).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(vote);
    expect(screen.getByText(/You voted:/)).toHaveTextContent("✓You voted: Project policy changes");
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/aspen/event")).toEqual([
        { participantId: "p-1", kind: "vote", payload: { useCase: "project" }, stage: "vote" },
      ]),
    );
    unmount();
    // Back on the stage later, the vote is still there and cannot be cast twice.
    render(<VoteCard stage="vote" />);
    expect(await screen.findByText(/You voted:/)).toHaveTextContent("Project policy changes");
    expect(screen.queryByRole("button", { name: "Vote" })).not.toBeInTheDocument();
  });

  it("offers the four choices, one per group, testing cases against the rules among them", async () => {
    const fetchMock = stubFetch();
    render(<VoteCard stage="vote" />);
    const choices = within(screen.getByRole("group", { name: "Pick one" })).getAllByRole("button");
    expect(choices.map((b) => b.querySelector("span")?.textContent)).toEqual(USE_CASES.map((u) => u.label));
    expect(choices).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /Create application interfaces/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Test cases against the rules/ }));
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    expect(screen.getByText(/You voted:/)).toHaveTextContent("Test cases against the rules");
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/aspen/event")).toEqual([
        { participantId: "p-1", kind: "vote", payload: { useCase: "test" }, stage: "vote" },
      ]),
    );
  });

  it("ignores a stored vote it does not know", () => {
    localStorage.setItem("aspen.vote.v1", JSON.stringify("bogus"));
    render(<VoteCard stage="vote" />);
    expect(screen.getByRole("button", { name: "Vote" })).toBeDisabled();
  });

  // Every row of two is full: only the last of an odd number of choices spans both columns.
  function spans(group: HTMLElement) {
    // One column on a phone, two from 640px.
    expect(group.className).toMatch(/(^| )grid( |$)/);
    expect(group.className).toContain("sm:grid-cols-2");
    return within(group).getAllByRole("button").map((b) => b.className.split(" ").includes("sm:col-span-2"));
  }

  it("lets an odd last choice take the whole row in two columns, so it never sits alone in half of one", async () => {
    // Four choices today (one per group), so every row is full and none spans.
    render(<VoteCard stage="vote" />);
    expect(spans(screen.getByRole("group", { name: "Pick one" }))).toEqual(USE_CASES.map(() => false));
    cleanup();
    // The same card with three choices: the third takes the whole row.
    vi.resetModules();
    vi.doMock("@/lib/aspen/content", async (original) => {
      const content = await original<typeof import("@/lib/aspen/content")>();
      return { ...content, USE_CASES: content.USE_CASES.slice(0, 3) };
    });
    try {
      const { VoteCard: ThreeChoices } = await import("./stages");
      render(<ThreeChoices stage="vote" />);
      expect(spans(screen.getByRole("group", { name: "Pick one" }))).toEqual([false, false, true]);
    } finally {
      vi.doUnmock("@/lib/aspen/content");
      vi.resetModules();
    }
  });
});

describe("SmallGroups", () => {
  it("puts the vote and the group's idea on one screen, in that order", () => {
    stubFetch();
    render(<SmallGroups stage="groups" />);
    const vote = screen.getByRole("heading", { level: 2, name: "Vote" });
    const talk = screen.getByRole("heading", { level: 2, name: "Talk it through" });
    expect(vote.compareDocumentPosition(talk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fill it in for my group" })).toBeInTheDocument();
  });

  it("starts the group's pick from a vote cast on the same screen", () => {
    stubFetch();
    render(<SmallGroups stage="groups" />);
    fireEvent.click(screen.getByRole("button", { name: /Test cases against the rules/ }));
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill it in for my group" }));
    expect(screen.getByRole("combobox", { name: "Your group's pick" })).toHaveValue("test");
  });
});

describe("GroupsCard", () => {
  /** One person per group fills it in, so the form opens on a tap. */
  const openForm = () => fireEvent.click(screen.getByRole("button", { name: "Fill it in for my group" }));

  it("keeps the form closed until someone fills it in for the group", () => {
    stubFetch();
    render(<GroupsCard stage="groups" />);
    expect(screen.getByText(GROUP_PHONE_INTRO)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Your group's pick" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share with the room" })).not.toBeInTheDocument();
    openForm();
    expect(screen.queryByRole("button", { name: "Fill it in for my group" })).not.toBeInTheDocument();
    // The button is gone, so focus moves to the form it opened rather than falling to the page.
    const form = screen.getByRole("group", { name: "Your group" });
    expect(document.activeElement).toBe(form);
    expect(form).toContainElement(screen.getByRole("combobox", { name: "Your group's pick" }));
    expect(form).toContainElement(screen.getByRole("button", { name: "Share with the room" }));
  });

  it("shares the group's best idea with the room, more than once", async () => {
    const fetchMock = stubFetch();
    render(<GroupsCard stage="groups" />);
    openForm();
    const share = screen.getByRole("button", { name: "Share with the room" });
    expect(share).toBeDisabled();

    // One menu for the group's pick, not a second row of chips.
    const pick = screen.getByRole("combobox", { name: "Your group's pick" });
    expect(pick).toHaveValue("");
    fireEvent.change(pick, { target: { value: "project" } });
    // A use case alone is not an idea.
    expect(share).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /What would you build first\?/ }), {
      target: { value: "Model the shelter cap" },
    });
    fireEvent.click(share);
    expect(screen.getByText("Shared. It's on the big screen.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /What would you build first\?/ })).toHaveValue("");

    // "Not decided" clears it.
    fireEvent.change(pick, { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: /What would you build first\?/ }), { target: { value: "Train staff" } });
    fireEvent.click(share);
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/aspen/event")).toEqual([
        { participantId: "p-1", kind: "breakout", payload: { useCase: "project", note: "Model the shelter cap", who: "", trust: "", raised: "" }, stage: "groups" },
        { participantId: "p-1", kind: "breakout", payload: { useCase: null, note: "Train staff", who: "", trust: "", raised: "" }, stage: "groups" },
      ]),
    );
  });

  it("starts the group's pick from this phone's own vote", () => {
    stubFetch();
    localStorage.setItem("aspen.vote.v1", JSON.stringify("flows"));
    render(<GroupsCard stage="groups" />);
    openForm();
    expect(screen.getByRole("combobox", { name: "Your group's pick" })).toHaveValue("flows");
  });

  it("asks the three questions, one box each, and shares all three", async () => {
    const fetchMock = stubFetch();
    render(<GroupsCard stage="groups" />);
    openForm();
    for (const q of GROUP_QUESTIONS) expect(screen.getByRole("textbox", { name: new RegExp(q.label.replace(/[?,]/g, ".")) })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Who would use it/ }), { target: { value: "Caseworkers on intake" } });
    fireEvent.change(screen.getByRole("textbox", { name: /trust it/ }), { target: { value: "Our policy unit signs off" } });
    fireEvent.click(screen.getByRole("button", { name: "Share with the room" }));
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/aspen/event")).toEqual([
        {
          participantId: "p-1",
          kind: "breakout",
          payload: { useCase: null, note: "", who: "Caseworkers on intake", trust: "Our policy unit signs off", raised: "" },
          stage: "groups",
        },
      ]),
    );
  });

  it("keeps what else the group raised, with or without an idea", async () => {
    const fetchMock = stubFetch();
    render(<GroupsCard stage="groups" />);
    openForm();
    const share = screen.getByRole("button", { name: "Share with the room" });
    const raised = screen.getByRole("textbox", { name: /Anything else your group raised\?/ });
    expect(raised).toHaveAttribute("placeholder", "Barriers, what your workforce would need, open questions");
    fireEvent.change(raised, { target: { value: "Union rules on new tools" } });
    // What the group raised is enough to share, even without an idea.
    expect(share).toBeEnabled();
    fireEvent.click(share);
    expect(raised).toHaveValue("");
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/aspen/event")).toEqual([
        { participantId: "p-1", kind: "breakout", payload: { useCase: null, note: "", who: "", trust: "", raised: "Union rules on new tools" }, stage: "groups" },
      ]),
    );
  });
});

describe("NextStepsForm", () => {
  function fill() {
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Note/ }), { target: { value: "Call me" } });
  }

  it("stays disabled until an email and a topic are given", () => {
    stubFetch();
    render(<NextStepsForm />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
    expect(send).toBeDisabled();
    const systems = screen.getByRole("checkbox", { name: /State systems/ });
    fireEvent.click(systems);
    expect(send).toBeEnabled();
    fireEvent.click(systems);
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Accurate AI answers/ }));
    expect(send).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "   " } });
    expect(send).toBeDisabled();
  });

  it("sends the pledge and thanks the participant", async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    const onSent = vi.fn();
    render(<NextStepsForm onSent={onSent} />);
    // Just an email and a note: Aspen's roster already has each leader's name, title and state.
    expect(screen.getAllByRole("textbox").map((el) => el.getAttribute("type") ?? "textarea")).toEqual(["email", "textarea"]);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /Accurate AI answers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(onSent).not.toHaveBeenCalled();
    resolve(jsonResponse({ ok: true }));
    expect(await screen.findByText("Thank you.")).toBeInTheDocument();
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PLEDGE_KEY)).toBe("true");
    expect(screen.getByText(new RegExp(EVENT.contactEmail))).toBeInTheDocument();
    expect(bodies(fetchMock, "/api/aspen/pledge")[0]).toEqual({
      participantId: "p-1",
      email: "ada@az.gov",
      accurateAi: true,
      stateSystems: false,
      note: "Call me",
    });
  });

  it("shows the server's error message", async () => {
    stubFetch(async () => jsonResponse({ error: "Enter a valid email." }, false));
    const onSent = vi.fn();
    render(<NextStepsForm onSent={onSent} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    expect(onSent).not.toHaveBeenCalled();
    expect(localStorage.getItem(PLEDGE_KEY)).toBeNull();
  });

  it("shows the thank-you, not a blank form, in a tab reloaded after sending", async () => {
    // iOS reloads a tab left in the background; a blank form there invites a second send.
    const fetchMock = stubFetch();
    localStorage.setItem(PLEDGE_KEY, "true");
    const onSent = vi.fn();
    render(<NextStepsForm onSent={onSent} />);
    expect(await screen.findByText("Thank you.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a generic error when the request fails", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    render(<NextStepsForm />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("That didn't send. Try again.")).toBeInTheDocument();
  });

  it("falls back to a generic error when the server gives no reason", async () => {
    stubFetch(async () => jsonResponse({}, false));
    render(<NextStepsForm />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("That didn't send. Try again.")).toBeInTheDocument();
  });

  it.each([
    ["drops what the phone saved", true],
    ["finds nothing saved to drop", false],
  ])("doesn't count a send answered after the room moved to another run that %s", async (_label, saved) => {
    enterRun("r1");
    let resolve: (r: Response) => void = () => {};
    stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    const onSent = vi.fn();
    render(<NextStepsForm onSent={onSent} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    if (saved) localStorage.setItem(CHAT_KEY, "{}");
    // A move to another run, whether or not it had anything to drop.
    expect(enterRun("r2")).toBe(true);
    await act(async () => resolve(jsonResponse({ ok: true })));
    // The form is the new run's to send: no thank-you, no mark, nothing to let the phone leave it.
    expect(await screen.findByRole("button", { name: "Send" })).toBeEnabled();
    expect(screen.queryByText("Thank you.")).not.toBeInTheDocument();
    expect(onSent).not.toHaveBeenCalled();
    expect(localStorage.getItem(PLEDGE_KEY)).toBeNull();
  });

  it("doesn't count a send answered after the room left its run, dropping what the phone saved, and came back", async () => {
    enterRun("r1");
    let resolve: (r: Response) => void = () => {};
    stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    const onSent = vi.fn();
    render(<NextStepsForm onSent={onSent} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    // The room starts r2, which drops the phone's chat (and remounts the page's form), then goes back to r1.
    localStorage.setItem(CHAT_KEY, "{}");
    expect(enterRun("r2")).toBe(true);
    expect(enterRun("r1")).toBe(true);
    await act(async () => resolve(jsonResponse({ ok: true })));
    expect(await screen.findByRole("button", { name: "Send" })).toBeEnabled();
    expect(onSent).not.toHaveBeenCalled();
    expect(localStorage.getItem(PLEDGE_KEY)).toBeNull();
  });

  it("doesn't count a send made before the phone had a run, answered after it adopted one and moved to another", async () => {
    let resolve: (r: Response) => void = () => {};
    stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    const onSent = vi.fn();
    render(<NextStepsForm onSent={onSent} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    // The send belongs to the first run the phone adopts, not to the one after it, though nothing was saved.
    expect(enterRun("r1")).toBe(false);
    expect(enterRun("r2")).toBe(true);
    await act(async () => resolve(jsonResponse({ ok: true })));
    expect(await screen.findByRole("button", { name: "Send" })).toBeEnabled();
    expect(onSent).not.toHaveBeenCalled();
    expect(localStorage.getItem(PLEDGE_KEY)).toBeNull();
  });

  it("sends nothing from a tap on the old run's form that lands before the page remounts it", async () => {
    enterRun("rehearsal");
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    const onSent = vi.fn();
    render(<NextStepsForm onSent={onSent} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    // The page's run effect moves the device to the live run; the remount it queues hasn't come yet.
    expect(enterRun("live")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    expect(onSent).not.toHaveBeenCalled();
    expect(localStorage.getItem(PLEDGE_KEY)).toBeNull();
  });

  it("counts a send answered after the phone adopts the room's first run", async () => {
    let resolve: (r: Response) => void = () => {};
    stubFetch(() => new Promise<Response>((r) => (resolve = r)));
    const onSent = vi.fn();
    render(<NextStepsForm onSent={onSent} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(enterRun("r1")).toBe(false);
    await act(async () => resolve(jsonResponse({ ok: true })));
    expect(await screen.findByText("Thank you.")).toBeInTheDocument();
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PLEDGE_KEY)).toBe("true");
  });

  /**
   * For any order of sends, their answers (ok or not), run switches (dropping what the phone saved, or
   * nothing) and reloads, on a phone that starts in a run or in none yet, it is marked as sent (the
   * stored mark, the page's `pledged` and the form's thank-you) exactly when a send made in the run it
   * is in now was answered ok while it was still there, with no run switch in between, whether or not
   * the switch dropped anything. Adopting a first run is not a switch: a send made before it counts in
   * the run adopted. The page here does what aspen-app does: a switch remounts the form and clears
   * `pledged`.
   */
  it("marks the phone as sent only for a send answered ok in the run it was made in, in any order", async () => {
    const command = fc.oneof(
      { weight: 3, arbitrary: fc.constant({ kind: "send" as const }) },
      { weight: 3, arbitrary: fc.record({ kind: fc.constant("answer" as const), pick: fc.nat(), ok: fc.boolean() }) },
      { weight: 2, arbitrary: fc.record({ kind: fc.constant("run" as const), run: fc.constantFrom("r1", "r2", "r3"), saved: fc.boolean() }) },
      { weight: 1, arbitrary: fc.constant({ kind: "reload" as const }) },
    );
    const flush = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.array(command, { minLength: 1, maxLength: 14 }), async (inRun, commands) => {
        cleanup();
        localStorage.clear();
        localStorage.setItem("aspen.participant", "p-1");
        if (inRun) enterRun("r1");
        // The model: the run the phone is in (null before it has one), how many times it has moved from
        // one run to another, and whether this run's form is sent.
        let run: string | null = inRun ? "r1" : null;
        let generation = 0;
        let sent = false;
        const held: { resolve: (r: Response) => void; generation: number }[] = [];
        stubFetch(() => new Promise<Response>((resolve) => held.push({ resolve, generation })));
        let pledged = false;
        let epoch = 0;
        const form = () => <NextStepsForm key={epoch} onSent={() => (pledged = true)} />;
        const page = render(form());
        await flush();
        for (const c of commands) {
          if (c.kind === "send") {
            const send = screen.queryByRole("button", { name: "Send" });
            if (!send) continue;
            fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
            const topic = screen.getByRole("checkbox", { name: /State systems/ }) as HTMLInputElement;
            if (!topic.checked) fireEvent.click(topic);
            fireEvent.click(screen.getByRole("button", { name: "Send" }));
          } else if (c.kind === "answer") {
            if (held.length === 0) continue;
            const [send] = held.splice(c.pick % held.length, 1);
            if (c.ok && send.generation === generation) sent = true;
            send.resolve(jsonResponse(c.ok ? { ok: true } : { error: "No." }, c.ok));
          } else if (c.kind === "run") {
            if (c.saved) localStorage.setItem(CHAT_KEY, "{}");
            // A first run is adopted, dropping nothing; a different one is a move, and drops whatever the
            // phone saved.
            const moves = run !== null && c.run !== run;
            expect(enterRun(c.run)).toBe(moves);
            if (moves) {
              expect(localStorage.getItem(CHAT_KEY)).toBeNull();
              generation += 1;
              epoch += 1;
              pledged = false;
              page.rerender(form());
            }
            if (run !== null && c.run !== run) sent = false;
            run = c.run;
          } else {
            // A reload: the page and its requests in flight are gone, and the form reads the mark.
            held.length = 0;
            pledged = false;
            epoch += 1;
            page.rerender(form());
          }
          await flush();
          expect(localStorage.getItem(PLEDGE_KEY)).toBe(sent ? "true" : null);
          expect(pledged).toBe(sent);
          expect(screen.queryByText("Thank you.") !== null).toBe(sent);
        }
      }),
      { numRuns: 300 },
    );
  }, 300_000);
});

describe("ThankYouContent", () => {
  it("thanks the room once, then shows where to go next and how to reach us", () => {
    const onReturn = vi.fn();
    render(<ThankYouContent onReturn={onReturn} />);
    expect(screen.getByRole("heading", { level: 1, name: "Thank you" })).toBeInTheDocument();
    expect(screen.getByText("To the Aspen Institute and to every leader in the room.")).toBeInTheDocument();
    expect(screen.getByText("Enjoy dinner.")).toBeInTheDocument();
    expect(screen.queryByText(/ready to go further|questions asked/)).not.toBeInTheDocument();
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("target") === "_blank");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://axiom.org/gallery/chatbot",
      "https://policybench.org",
      "https://axiom.org",
    ]);
    for (const link of links) expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /Try the rules chatbot/ })).toHaveTextContent(
      "Ask the same question, answered by the encoded rules.",
    );
    expect(screen.getByRole("link", { name: /The Axiom Foundation/ })).toHaveTextContent("Open, cited rules that states can validate.");
    expect(screen.getByRole("link", { name: EVENT.contactEmail })).toHaveAttribute("href", `mailto:${EVENT.contactEmail}`);
    fireEvent.click(screen.getByRole("button", { name: "Back to your question" }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("leaves out the way back when there is none", () => {
    render(<ThankYouContent />);
    expect(screen.queryByRole("button", { name: "Back to your question" })).not.toBeInTheDocument();
  });
});

describe("LookUp", () => {
  it("points at the TV with the room's number and says when the phone comes back", () => {
    render(<LookUp stat="4 of 9" label={LOOK_UP.reveal.label} />);
    const card = within(screen.getByRole("region", { name: LOOK_UP.heading }));
    expect(card.getByText("4 of 9")).toBeInTheDocument();
    expect(card.getByText(LOOK_UP.reveal.label)).toBeInTheDocument();
    expect(card.getByText(LOOK_UP.later)).toBeInTheDocument();
    // Nothing to tap: everyone looks up.
    expect(card.queryAllByRole("button")).toHaveLength(0);
  });

  it("says where to look when there's no number yet", () => {
    render(<LookUp stat={null} label={LOOK_UP.reveal.empty} />);
    const card = within(screen.getByRole("region", { name: LOOK_UP.heading }));
    expect(card.getByText(LOOK_UP.reveal.empty)).toBeInTheDocument();
    expect(card.queryByText(/\d+ of \d+/)).not.toBeInTheDocument();
  });
});
