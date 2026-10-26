import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_PHONE_INTRO, DISCLOSURE, EVENT, GROUP_QUESTIONS, LOOK_UP, STAGES } from "@/lib/aspen/content";
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

  it("ignores a stored vote it does not know", () => {
    localStorage.setItem("aspen.vote.v1", JSON.stringify("bogus"));
    render(<VoteCard stage="vote" />);
    expect(screen.getByRole("button", { name: "Vote" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Share with the room" })).toBeInTheDocument();
  });
});

describe("GroupsCard", () => {
  it("shares the group's best idea with the room, more than once", async () => {
    const fetchMock = stubFetch();
    render(<GroupsCard stage="groups" />);
    expect(screen.getByText(GROUP_PHONE_INTRO)).toBeInTheDocument();
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
    expect(screen.getByRole("combobox", { name: "Your group's pick" })).toHaveValue("flows");
  });

  it("asks the three questions, one box each, and shares all three", async () => {
    const fetchMock = stubFetch();
    render(<GroupsCard stage="groups" />);
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
    render(<NextStepsForm />);
    // Just an email and a note: Aspen's roster already has each leader's name, title and state.
    expect(screen.getAllByRole("textbox").map((el) => el.getAttribute("type") ?? "textarea")).toEqual(["email", "textarea"]);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /Accurate AI answers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    resolve(jsonResponse({ ok: true }));
    expect(await screen.findByText("Thank you.")).toBeInTheDocument();
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
    render(<NextStepsForm />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
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
