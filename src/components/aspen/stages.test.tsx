import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCLOSURE, EVENT, GOLDEN_A, ONE_SET_OF_RULES, STAGES } from "@/lib/aspen/content";
import { EMPTY_SUMMARY, type RunSummary } from "@/lib/aspen/results";
import { countWord, snapQcTotals } from "@/lib/verification-evidence";
import { EMPTY_PROFILE } from "./client";
import {
  Agenda,
  Disclosure,
  FoundationContent,
  GoldenContent,
  GroupsCard,
  NextStepsForm,
  PolicyBenchContent,
  ProfileForm,
  ThankYouContent,
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

describe("ProfileForm", () => {
  it("reports perspective, state and role changes", () => {
    const onChange = vi.fn();
    const profile = { perspective: "resident", state: "Arizona", role: null };
    render(<ProfileForm profile={profile} onChange={onChange} />);

    expect(screen.getByRole("button", { name: /A resident/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /A caseworker/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: /Start: ask the AI/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /A caseworker/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...profile, perspective: "caseworker" });

    const state = screen.getByRole("combobox", { name: /Your state/ });
    expect(state).toHaveValue("Arizona");
    fireEvent.change(state, { target: { value: "Ohio" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...profile, state: "Ohio" });
    fireEvent.change(state, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...profile, state: null });

    const role = screen.getByRole("combobox", { name: /Your role/ });
    expect(role).toHaveValue("");
    fireEvent.change(role, { target: { value: "Other" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...profile, role: "Other" });
    fireEvent.change(role, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...profile, role: null });
  });

  it("shows the start button when onDone is given", () => {
    const onDone = vi.fn();
    render(<ProfileForm profile={EMPTY_PROFILE} onChange={vi.fn()} onDone={onDone} />);
    expect(screen.getByRole("combobox", { name: /Your state/ })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /Start: ask the AI/ }));
    expect(onDone).toHaveBeenCalledTimes(1);
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
  it("shows the hero and the agenda before 'Start here'", () => {
    stubFetch();
    render(<WelcomeLanding profile={EMPTY_PROFILE} live={null} onProfile={vi.fn()} onStart={vi.fn()} onPick={vi.fn()} />);
    const hero = screen.getByRole("heading", { level: 1, name: EVENT.title });
    const agenda = screen.getByRole("heading", { level: 2, name: "The evening" });
    const start = screen.getByRole("heading", { level: 2, name: /^Start here · Tonight, ask as$/ });
    expect(hero.compareDocumentPosition(agenda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agenda.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(new RegExp(EVENT.date))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`With ${EVENT.hosts}`))).toBeInTheDocument();
    // The landing's agenda is two short threads (1–4, 5–8) of labels, without the description lines.
    expect(screen.queryByText(STAGES[1].agenda)).not.toBeInTheDocument();
    const threads = agenda.parentElement!.querySelectorAll("ol");
    expect(threads).toHaveLength(2);
    expect(threads[0]).toHaveTextContent(/^1Welcome2Try it3Rate it4What we saw5At scale$/);
    expect(threads[1].querySelectorAll("li")).toHaveLength(4);
    // The start form is the compact one: no descriptions, labels for screen readers only.
    expect(screen.queryByText("Asking for yourself.")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Your state" })).toBeInTheDocument();
    expect(screen.getByText("Your state (optional)")).toHaveClass("sr-only");
    expect(screen.getByText("Tonight, ask as", { selector: "legend" })).toHaveClass("sr-only");
  });

  it("wires the agenda, the profile form and the disclosure", async () => {
    const fetchMock = stubFetch();
    const onProfile = vi.fn();
    const onStart = vi.fn();
    const onPick = vi.fn();
    render(<WelcomeLanding profile={EMPTY_PROFILE} live="scale" onProfile={onProfile} onStart={onStart} onPick={onPick} />);

    expect(screen.getByText("Now")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /At scale/ }));
    expect(onPick).toHaveBeenCalledWith("scale");

    fireEvent.click(screen.getByRole("button", { name: /A caseworker/ }));
    expect(onProfile).toHaveBeenCalledWith({ ...EMPTY_PROFILE, perspective: "caseworker" });

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

describe("GroupsCard", () => {
  it("saves the group's use case and ideas", async () => {
    const fetchMock = stubFetch();
    render(<GroupsCard stage="groups" />);
    const save = screen.getByRole("button", { name: "Save our ideas" });
    expect(save).toBeDisabled();

    const project = screen.getByRole("button", { name: /Project policy changes/ });
    fireEvent.click(project);
    expect(project).toHaveAttribute("aria-pressed", "true");
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    await waitFor(() =>
      expect(bodies(fetchMock, "/api/aspen/event")[0]).toEqual({
        participantId: "p-1",
        kind: "breakout",
        payload: { useCase: "project", note: "" },
        stage: "groups",
      }),
    );

    fireEvent.change(screen.getByPlaceholderText("Your group's ideas"), { target: { value: "Train staff" } });
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("can save ideas without a use case", () => {
    stubFetch();
    render(<GroupsCard stage="groups" />);
    fireEvent.change(screen.getByPlaceholderText("Your group's ideas"), { target: { value: "Screeners" } });
    expect(screen.getByRole("button", { name: "Save our ideas" })).toBeEnabled();
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
    render(<NextStepsForm profile={EMPTY_PROFILE} />);
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
    render(<NextStepsForm profile={{ perspective: null, state: "Arizona", role: null }} />);
    expect(screen.getByRole("combobox", { name: "State" })).toHaveValue("Arizona");
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
    render(<NextStepsForm profile={EMPTY_PROFILE} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("falls back to a generic error when the request fails", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    render(<NextStepsForm profile={EMPTY_PROFILE} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("That didn't send. Try again.")).toBeInTheDocument();
  });

  it("falls back to a generic error when the server gives no reason", async () => {
    stubFetch(async () => jsonResponse({}, false));
    render(<NextStepsForm profile={EMPTY_PROFILE} />);
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /State systems/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("That didn't send. Try again.")).toBeInTheDocument();
  });
});

describe("ThankYouContent", () => {
  const withPrompts = (states: string[]): RunSummary => ({
    ...EMPTY_SUMMARY,
    prompts: 12,
    rated: 7,
    pledges: { ...EMPTY_SUMMARY.pledges, states },
  });

  it("thanks the room and links onward without a summary", () => {
    render(<ThankYouContent />);
    expect(screen.queryByText("Tonight, this room")).not.toBeInTheDocument();
    expect(screen.getByText(/Thank you to the Aspen Institute/)).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://axiom.org/gallery/chatbot",
      "https://policybench.org",
      "https://axiom.org",
    ]);
    for (const link of links) expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("hides the room's numbers when nobody asked", () => {
    render(<ThankYouContent summary={EMPTY_SUMMARY} />);
    expect(screen.queryByText("Tonight, this room")).not.toBeInTheDocument();
  });

  it("shows questions and ratings without a states column when no state pledged", () => {
    render(<ThankYouContent summary={withPrompts([])} />);
    expect(screen.getByText("Tonight, this room")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText(/ready to go further/)).not.toBeInTheDocument();
  });

  it("counts one state in the singular and several in the plural", () => {
    const { rerender } = render(<ThankYouContent summary={withPrompts(["Arizona"])} />);
    expect(screen.getByText("state ready to go further")).toBeInTheDocument();
    rerender(<ThankYouContent summary={withPrompts(["Arizona", "Ohio"])} />);
    expect(screen.getByText("states ready to go further")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("PolicyBenchContent", () => {
  it("shows the wrongful-denial shares and the Arizona case", () => {
    render(<PolicyBenchContent />);
    expect(screen.getByText("41%")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("242 of 591 answers from 46 models, for 13 households that qualify.")).toBeInTheDocument();
    expect(screen.getByText(/An Arizona household · 46 of 46 models said \$0/)).toBeInTheDocument();
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
