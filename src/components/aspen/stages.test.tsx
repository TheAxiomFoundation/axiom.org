import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BREAKOUT_PROMPT, DISCLOSURE, EVENT, GOLDEN_A, ONE_SET_OF_RULES, STAGES } from "@/lib/aspen/content";
import { countWord, snapQcTotals } from "@/lib/verification-evidence";
import {
  Agenda,
  Disclosure,
  FoundationContent,
  GoldenContent,
  GroupsCard,
  NextStepsForm,
  PolicyBenchContent,
  SmallGroups,
  ThankYouContent,
  VoteCard,
  WelcomeLanding,
  YourThread,
  type ThreadQuestion,
} from "./stages";

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
    expect(screen.getByText(DISCLOSURE.details[0])).toBeInTheDocument();
  });
});

describe("WelcomeLanding", () => {
  it("says what this is and starts with one button, without asking who you are", async () => {
    const fetchMock = stubFetch();
    const onStart = vi.fn();
    render(<WelcomeLanding onStart={onStart} />);
    expect(screen.getByRole("heading", { level: 1, name: EVENT.title })).toBeInTheDocument();
    expect(screen.getByText(STAGES[0].summary)).toBeInTheDocument();
    expect(screen.getByText(`With ${EVENT.hosts}`)).toBeInTheDocument();
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

describe("YourThread", () => {
  const asked: ThreadQuestion = {
    householdId: "az-retiree",
    householdLabel: "Retiree in Phoenix",
    perspective: "resident",
    asked: true,
    rated: true,
  };

  it("renders nothing outside the stages after Try it", () => {
    for (const stage of ["welcome", "try", "groups", "next", "dinner"] as const) {
      const { container, unmount } = render(<YourThread stage={stage} thread={asked} onOpen={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("asks people who haven't asked yet to try", () => {
    const onOpen = vi.fn();
    render(<YourThread stage="reveal" thread={null} onOpen={onOpen} />);
    expect(screen.getByText(/You haven't asked the AI yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask the AI →" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("points a rated answer at the results", () => {
    render(<YourThread stage="reveal" thread={asked} onOpen={vi.fn()} />);
    expect(
      screen.getByText("You asked about “Retiree in Phoenix”. Your rating is in the results below."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("asks for a rating on an unrated answer to the participant's own question", () => {
    const onOpen = vi.fn();
    render(
      <YourThread
        stage="reveal"
        thread={{ ...asked, householdId: null, householdLabel: null, rated: false }}
        onOpen={onOpen}
      />,
    );
    expect(
      screen.getByText("You asked about your own question. Rate the answer so it counts in the results below."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rate my answer →" }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("ties the Arizona household to PolicyBench at scale", () => {
    render(
      <YourThread
        stage="scale"
        thread={{ ...asked, householdId: "az-savings", householdLabel: "Disabled, with savings" }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(/every one of the 46 models said it gets \$0/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ties other households to the results at scale", () => {
    render(<YourThread stage="scale" thread={asked} onOpen={vi.fn()} />);
    expect(screen.getByText(/Here is how AI does on households like it, at scale\./)).toBeInTheDocument();
  });

  it("sends people to check their answer on the shared foundation", () => {
    const onOpen = vi.fn();
    render(<YourThread stage="foundation" thread={asked} onOpen={onOpen} />);
    expect(
      screen.getByText("Now check the AI's answer about “Retiree in Phoenix” against the encoded rules."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check my answer →" }));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe("VoteCard", () => {
  it("sends one vote and remembers it", async () => {
    const fetchMock = stubFetch();
    const { unmount } = render(<VoteCard stage="vote" />);
    const vote = screen.getByRole("button", { name: "Vote" });
    expect(vote).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /See and edit the rules/ }));
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
    const vote = screen.getByRole("heading", { name: "1Vote" });
    const talk = screen.getByRole("heading", { name: "2Talk it through" });
    expect(vote.compareDocumentPosition(talk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share with the room" })).toBeInTheDocument();
  });
});

describe("GroupsCard", () => {
  it("shares the group's best idea with the room, more than once", async () => {
    const fetchMock = stubFetch();
    render(<GroupsCard stage="groups" />);
    expect(screen.getByText(BREAKOUT_PROMPT)).toBeInTheDocument();
    const share = screen.getByRole("button", { name: "Share with the room" });
    expect(share).toBeDisabled();

    const project = screen.getByRole("button", { name: "Project policy changes" });
    fireEvent.click(project);
    expect(project).toHaveAttribute("aria-pressed", "true");
    // A use case alone is not an idea.
    expect(share).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Your group's best idea/ }), {
      target: { value: "Model the shelter cap" },
    });
    fireEvent.click(share);
    expect(screen.getByText("Shared. It's on the big screen.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Your group's best idea/ })).toHaveValue("");

    // Tapping the use case again clears it.
    fireEvent.click(project);
    expect(project).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByRole("textbox", { name: /Your group's best idea/ }), { target: { value: "Train staff" } });
    fireEvent.click(share);
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/aspen/event")).toEqual([
        { participantId: "p-1", kind: "breakout", payload: { useCase: "project", note: "Model the shelter cap" }, stage: "groups" },
        { participantId: "p-1", kind: "breakout", payload: { useCase: null, note: "Train staff" }, stage: "groups" },
      ]),
    );
  });
});

describe("NextStepsForm", () => {
  function fill() {
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Ada" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Director" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "ada@az.gov" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Call me" } });
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
    expect(screen.getByRole("combobox", { name: "State" })).toHaveValue("");
    fill();
    fireEvent.change(screen.getByRole("combobox", { name: "State" }), { target: { value: "Nevada" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Accurate AI answers/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Show my state on the screen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    resolve(jsonResponse({ ok: true }));
    expect(await screen.findByText("Thank you.")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(EVENT.contactEmail))).toBeInTheDocument();
    expect(bodies(fetchMock, "/api/aspen/pledge")[0]).toEqual({
      participantId: "p-1",
      name: "Ada",
      title: "Director",
      state: "Nevada",
      email: "ada@az.gov",
      accurateAi: true,
      stateSystems: false,
      showState: false,
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
  it("thanks the room and links onward, without the room's numbers", () => {
    render(<ThankYouContent />);
    expect(screen.getByText(/Thank you to the Aspen Institute/)).toBeInTheDocument();
    expect(screen.queryByText(/ready to go further|questions asked/)).not.toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://axiom.org/gallery/chatbot",
      "https://policybench.org",
      "https://axiom.org",
    ]);
    for (const link of links) expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("PolicyBenchContent", () => {
  it("shows the one number and the Arizona household every model got wrong", () => {
    render(<PolicyBenchContent />);
    expect(screen.getByText("41%")).toBeInTheDocument();
    expect(screen.getByText("242 of 591 answers, from 46 models.")).toBeInTheDocument();
    expect(screen.getByText(/An Arizona household · 46 of 46 models said \$0/)).toBeInTheDocument();
    expect(screen.getByText("The rules: eligible, $24 a month.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "policybench.org" })).toHaveAttribute("href", "https://policybench.org");
  });
});

describe("FoundationContent and GoldenContent", () => {
  it("shows one set of rules powering every use, with the SNAP QC replay", () => {
    render(<FoundationContent />);
    const qc = snapQcTotals();
    expect(screen.getByText("One open, validated set of rules")).toBeInTheDocument();
    for (const use of ONE_SET_OF_RULES) expect(screen.getByText(use.label)).toBeInTheDocument();
    expect(screen.getByText("SNAP benefit math already checks out.")).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`from ${countWord(qc.states)} states \\(${qc.households.toLocaleString("en-US")} households\\)`),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What it takes for a state" })).toBeInTheDocument();
    expect(screen.getByText("Gold A")).toBeInTheDocument();
  });

  it("lists the three validation tiers", () => {
    render(<GoldenContent />);
    for (const tier of GOLDEN_A) {
      expect(screen.getByText(tier.tier)).toBeInTheDocument();
      expect(screen.getByText(tier.name)).toBeInTheDocument();
      expect(screen.getByText(tier.gets)).toBeInTheDocument();
      expect(screen.getByText(tier.takes)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Your state gets")).toHaveLength(3);
  });
});
