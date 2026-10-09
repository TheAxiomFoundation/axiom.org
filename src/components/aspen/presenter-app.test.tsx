import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BREAKOUT_PROMPT, DISCUSSION_QUESTIONS, EVENT, GOLDEN_A, NEXT_STEPS, STAGES, type StageId } from "@/lib/aspen/content";
import { EMPTY_SUMMARY, summarizeRun, type RunSummary } from "@/lib/aspen/results";
import type { Control, RunData } from "@/lib/aspen/types";
import { PresenterApp } from "./presenter-app";

const DATA: RunData = {
  participants: [{ id: "a", run_id: "r1", perspective: "resident", state: "Arizona" }],
  prompts: [
    {
      id: "p1",
      run_id: "r1",
      participant_id: "a",
      conversation_id: "c1",
      turn: 0,
      created_at: "2026-10-26T18:00:00Z",
      perspective: "resident",
      household_id: "az-retiree",
      prompt: "How much SNAP can I get?",
      answer: "About $0.",
      verdict: "wrong",
      rules_program: "SNAP",
      rules_amount: 24,
      post_check_verdict: "wrong",
    },
  ],
  events: [
    { run_id: "r1", kind: "discussion", payload: { question: "performance", topics: ["Asset tests"], note: "Too confident" } },
    { run_id: "r1", kind: "discussion", payload: { question: "unknown", note: "A loose note" } },
    { run_id: "r1", kind: "breakout", payload: { useCase: "see-edit", note: "Show staff the rules" } },
    { run_id: "r1", kind: "breakout", payload: { useCase: "elsewhere", note: "Something else" } },
    { run_id: "r1", kind: "vote", payload: { useCase: "project" } },
    { run_id: "r1", kind: "vote", payload: { useCase: "project" } },
  ],
  pledges: [
    { state: "Arizona", accurate_ai: true, state_systems: false, show_state: true },
    { state: "Ohio", accurate_ai: false, state_systems: true, show_state: true },
  ],
};

const SUMMARY = summarizeRun(DATA);

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 401, json: async () => data } as unknown as Response;
}

interface Server {
  control: Control;
  summary: RunSummary;
  /** Overrides the POST /api/aspen/state answer. */
  post?: (body: Partial<Control>) => Promise<Response>;
  /** Overrides the GET /api/aspen/state answer. */
  get?: () => Promise<Response>;
}

function setup(
  options: { stage?: StageId; live?: boolean; summary?: RunSummary; joinPassword?: string | null; noPoll?: boolean } = {},
) {
  const server: Server = {
    control: { runId: "r1", stage: options.stage ?? "welcome", live: options.live ?? true, updatedAt: null },
    summary: options.summary ?? SUMMARY,
    get: options.noPoll ? () => new Promise<Response>(() => {}) : undefined,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/aspen/results")) {
      return jsonResponse({ runId: server.control.runId, live: true, summary: server.summary });
    }
    if (url === "/api/aspen/state" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Partial<Control>;
      if (server.post) return server.post(body);
      server.control = { ...server.control, ...body };
      return jsonResponse(server.control);
    }
    if (url === "/api/aspen/state") {
      return server.get ? server.get() : jsonResponse(server.control);
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const posts = () =>
    fetchMock.mock.calls
      .filter(([url, init]) => url === "/api/aspen/state" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
  const view = render(
    <PresenterApp joinPassword={options.joinPassword === undefined ? "phoenix-2026" : options.joinPassword} />,
  );
  return { server, fetchMock, posts, ...view };
}

async function onStage(id: StageId) {
  const stage = STAGES.find((s) => s.id === id)!;
  const title = id === "welcome" ? EVENT.title : stage.title;
  await waitFor(() =>
    expect(screen.getByRole("navigation", { name: "Stages" }).querySelector('[aria-current="step"]')).toHaveTextContent(
      stage.label,
    ),
  );
  expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PresenterApp welcome", () => {
  it("shows the join URL, the password and how many joined", async () => {
    setup();
    expect(await screen.findByText("Run r1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: EVENT.title })).toBeInTheDocument();
    expect(screen.getByText(EVENT.joinUrl)).toBeInTheDocument();
    expect(screen.getByText("phoenix-2026")).toHaveClass("font-mono");
    expect(screen.getByText(`With ${EVENT.hosts}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/joined/)).toHaveTextContent("1 joined"));
  });

  it("leaves out the password when there is none and flags a run without a store", async () => {
    setup({ joinPassword: null, live: false });
    expect(await screen.findByText(/not syncing \(no store\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Password:/)).not.toBeInTheDocument();
  });

  it("shows a placeholder run before the first poll and no count before anyone joins", () => {
    setup({ noPoll: true, summary: EMPTY_SUMMARY });
    expect(screen.getByText("Run …")).toBeInTheDocument();
    expect(screen.queryByText(/joined/)).not.toBeInTheDocument();
  });
});

describe("PresenterApp navigation", () => {
  it("keeps a saved move when an older poll lands after it", async () => {
    let resolveGet: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/api/aspen/results")) {
          return Promise.resolve(jsonResponse({ runId: "r1", live: true, summary: EMPTY_SUMMARY }));
        }
        if (init?.method === "POST") {
          return Promise.resolve(
            jsonResponse({ runId: "r1", stage: "try", live: true, updatedAt: "2026-10-26T18:00:02Z" }),
          );
        }
        return new Promise<Response>((resolve) => {
          resolveGet = resolve;
        });
      }),
    );
    render(<PresenterApp joinPassword={null} />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("try");
    resolveGet(jsonResponse({ runId: "r1", stage: "welcome", live: true, updatedAt: "2026-10-26T18:00:01Z" }));
    await new Promise((r) => setTimeout(r, 20));
    await onStage("try");
  });

  it("moves the room with the arrow, page and space keys", async () => {
    const { posts } = setup();
    await screen.findByText("Run r1");

    expect(fireEvent.keyDown(document.body, { key: "ArrowRight" })).toBe(false);
    await onStage("try");
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await onStage("welcome");
    fireEvent.keyDown(document.body, { key: "PageDown" });
    await onStage("try");
    fireEvent.keyDown(document.body, { key: "PageUp" });
    await onStage("welcome");
    fireEvent.keyDown(document.body, { key: " " });
    await onStage("try");
    expect(posts()).toEqual([
      { stage: "try" },
      { stage: "welcome" },
      { stage: "try" },
      { stage: "welcome" },
      { stage: "try" },
    ]);
  });

  it("ignores other keys, keys typed into fields, and moves past either end", async () => {
    const { posts } = setup();
    await screen.findByText("Run r1");

    expect(fireEvent.keyDown(document.body, { key: "a" })).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New run name" }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Next slide" }), { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(posts()).toEqual([]);
  });

  it("moves with the buttons and the stage menu", async () => {
    const { posts } = setup();
    await screen.findByText("Run r1");

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    await onStage("try");
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    await onStage("welcome");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Thank you" }));
    await onStage("dinner");
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(posts()).toEqual([{ stage: "try" }, { stage: "welcome" }, { stage: "dinner" }]);
  });

  it("moves before the first poll lands", async () => {
    const { posts } = setup({ noPoll: true });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("try");
    expect(posts()).toEqual([{ stage: "try" }]);
  });

  it("shows an error banner when the stage does not change", async () => {
    const { server } = setup();
    await screen.findByText("Run r1");

    server.post = async () => jsonResponse({ error: "Presenter sign-in expired." }, false);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText("Presenter sign-in expired.")).toBeInTheDocument();

    server.post = async () => {
      throw new Error("offline");
    };
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(await screen.findByText("The stage did not change. Check the connection.")).toBeInTheDocument();

    server.post = async () => jsonResponse({}, false);
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(await screen.findByText("The stage did not change. Check the connection.")).toBeInTheDocument();

    server.post = undefined;
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    await onStage("scale");
    expect(screen.queryByText(/The stage did not change/)).not.toBeInTheDocument();
  });

  it("steps through the slides of a stage before it moves the room", async () => {
    const { posts } = setup({ stage: "reveal" });
    await onStage("reveal");

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("scale");
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("41%")).toBeInTheDocument();
    expect(screen.getByText(STAGES.find((st) => st.id === "scale")!.summary)).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("46 of 46 AI models said")).toBeInTheDocument();
    expect(screen.getByText("$24")).toBeInTheDocument();
    // The summary shows on the first slide only.
    expect(screen.queryByText(STAGES.find((st) => st.id === "scale")!.summary)).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("foundation");
    expect(screen.getByText("1/2")).toBeInTheDocument();

    // Back from a stage's first slide lands on the last slide of the stage before.
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await onStage("scale");
    expect(screen.getByText("2/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await onStage("reveal");
    expect(posts()).toEqual([{ stage: "scale" }, { stage: "foundation" }, { stage: "scale" }, { stage: "reveal" }]);
  });
});

describe("PresenterApp stages", () => {
  it.each(STAGES.map((s) => s.id))("renders the %s stage", async (id) => {
    setup({ stage: id });
    await onStage(id);
    if (id !== "welcome" && id !== "dinner") {
      const index = STAGES.findIndex((s) => s.id === id);
      expect(screen.getByText(`${String(index + 1).padStart(2, "0")} · ${STAGES[index].label}`)).toBeInTheDocument();
      expect(screen.getByText(STAGES[index].summary)).toBeInTheDocument();
    }
  });

  it("shows the join details, the counts and the households people picked during Try it", async () => {
    setup({ stage: "try" });
    await onStage("try");
    expect(screen.getByText(EVENT.joinUrl)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("questions asked").previousSibling).toHaveTextContent("1"));
    expect(screen.getByText("answers rated").previousSibling).toHaveTextContent("1");
    expect(screen.getByTitle("Retiree in Phoenix")).toBeInTheDocument();
  });

  it("waits for picks during Try it", async () => {
    setup({ stage: "try", summary: EMPTY_SUMMARY });
    await onStage("try");
    expect(await screen.findByText("Picks appear here as people ask.")).toBeInTheDocument();
  });

  it("shows the ratings coming in on Rate it", async () => {
    const scale = (count: number): RunSummary => ({
      ...EMPTY_SUMMARY,
      discussion: {
        ...EMPTY_SUMMARY.discussion,
        scales: [
          {
            question: "performance",
            label: "How did the AI do?",
            low: "Not at all",
            high: "Fully",
            categories: [{ id: "amount", label: "Got the amount right", average: 2, count }],
          },
        ],
      },
    });
    setup({ stage: "rate", summary: scale(3) });
    await onStage("rate");
    await waitFor(() => expect(screen.getByText(/rated so far/)).toHaveTextContent("3 people have rated so far"));
    expect(screen.getByText("2.0")).toBeInTheDocument();
    cleanup();
    setup({ stage: "rate", summary: scale(1) });
    await waitFor(() => expect(screen.getByText(/rated so far/)).toHaveTextContent("1 person has rated so far"));
  });

  it("counts zero ratings before anyone rates", async () => {
    setup({ stage: "rate", summary: EMPTY_SUMMARY });
    await onStage("rate");
    expect(screen.getByText(/rated so far/)).toHaveTextContent("0 people have rated so far");
  });

  it("puts the answers that would send a resident the wrong way on the reveal", async () => {
    const harmful = summarizeRun({
      ...DATA,
      prompts: [{ ...DATA.prompts[0], would_act: "yes", resident_action: "not-apply" }],
    });
    setup({ stage: "reveal", summary: harmful });
    await onStage("reveal");
    await waitFor(() => expect(screen.getByText("answers looked right").previousSibling).toHaveTextContent("0 of 1"));
    expect(screen.getByText("looked wrong, yet people would act on them").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("would stop a resident from applying. 1 of them qualify.").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("What would a resident do next?")).toBeInTheDocument();
    expect(screen.getByText("To discuss")).toBeInTheDocument();
    for (const q of DISCUSSION_QUESTIONS) expect(screen.getByText(q.label)).toBeInTheDocument();
  });

  it("keeps the plain labels when no answer would send a resident the wrong way", async () => {
    setup({ stage: "reveal" });
    await onStage("reveal");
    await waitFor(() => expect(screen.getByText("would stop a resident from applying").previousSibling).toHaveTextContent("0"));
  });

  it("waits for ratings on the reveal", async () => {
    setup({ stage: "reveal", summary: EMPTY_SUMMARY });
    await onStage("reveal");
    expect(screen.getByText("Results appear here as people rate their answers.")).toBeInTheDocument();
    expect(screen.queryByText("To discuss")).not.toBeInTheDocument();
  });

  it("shows the room's own answer on the shared foundation, then what it takes", async () => {
    setup({
      stage: "foundation",
      summary: {
        ...EMPTY_SUMMARY,
        sourceOfTruth: [
          { id: "yes", label: "Yes", count: 1 },
          { id: "partly", label: "Partly", count: 2 },
          { id: "no", label: "No", count: 3 },
        ],
      },
    });
    await onStage("foundation");
    expect(screen.getByText("One open, validated set of rules")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/In this room/)).toHaveTextContent("In this room, 5 of 6 can't fully check"));
    expect(screen.getByText(/SNAP benefit math already checks out/)).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("What it takes for a state")).toBeInTheDocument();
    for (const tier of GOLDEN_A) expect(screen.getByText(tier.name)).toBeInTheDocument();
  });

  it("leaves out the room's answer on the shared foundation when nobody gave one", async () => {
    setup({ stage: "foundation", summary: EMPTY_SUMMARY });
    await onStage("foundation");
    expect(screen.queryByText(/In this room/)).not.toBeInTheDocument();
  });

  it("shows the votes as they come in", async () => {
    setup({ stage: "vote" });
    await onStage("vote");
    await waitFor(() => expect(screen.getByText(/· vote on your phone/)).toHaveTextContent("2 votes · vote on your phone"));
    expect(screen.getByTitle("Project policy changes").nextSibling?.nextSibling).toHaveTextContent("2");
  });

  it("waits for votes, and counts one in the singular", async () => {
    setup({ stage: "vote", summary: EMPTY_SUMMARY });
    await onStage("vote");
    expect(screen.getByText("Votes appear here as people vote.")).toBeInTheDocument();
    cleanup();
    setup({ stage: "vote", summary: summarizeRun({ ...DATA, events: [DATA.events[4]] }) });
    await waitFor(() => expect(screen.getByText(/· vote on your phone/)).toHaveTextContent("1 vote · vote on your phone"));
  });

  it("shows the ideas groups share back", async () => {
    setup({ stage: "groups" });
    await onStage("groups");
    expect(screen.getByText(BREAKOUT_PROMPT)).toBeInTheDocument();
    expect(await screen.findByText("Show staff the rules")).toBeInTheDocument();
    expect(screen.getByText("See and edit the rules")).toBeInTheDocument();
    expect(screen.getByText("Idea")).toBeInTheDocument();
  });

  it("waits for the groups' ideas", async () => {
    setup({ stage: "groups", summary: EMPTY_SUMMARY });
    await onStage("groups");
    expect(screen.getByText("Ideas appear here as groups share them.")).toBeInTheDocument();
  });

  it("asks for next steps without putting counts on the screen", async () => {
    setup({ stage: "next" });
    await onStage("next");
    expect(screen.getByText(NEXT_STEPS.ask)).toBeInTheDocument();
    for (const o of NEXT_STEPS.options) expect(screen.getByText(o.label)).toBeInTheDocument();
    expect(screen.getByText(/Fill in the short form on your phone/)).toBeInTheDocument();
    expect(screen.queryByText("people")).not.toBeInTheDocument();
    expect(screen.queryByText("Ohio")).not.toBeInTheDocument();

    // The presenter decides whether to show the states, from the controls.
    fireEvent.click(screen.getByRole("button", { name: "Show the states going further" }));
    expect(await screen.findByText("Arizona")).toBeInTheDocument();
    expect(screen.getByText("Ohio")).toBeInTheDocument();
    expect(screen.queryByText(/Fill in the short form/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide the states" }));
    expect(screen.queryByText("Ohio")).not.toBeInTheDocument();
  });

  it("offers the states only on next steps", async () => {
    setup({ stage: "vote" });
    await onStage("vote");
    expect(screen.queryByRole("button", { name: "Show the states going further" })).not.toBeInTheDocument();
  });

  it("thanks the room at dinner, without numbers", async () => {
    setup({ stage: "dinner" });
    await onStage("dinner");
    expect(screen.getByText(/To the Aspen Institute and to every leader in the room/)).toBeInTheDocument();
    expect(screen.getByText(`${EVENT.hosts} · ${EVENT.contactEmail}`)).toBeInTheDocument();
    expect(screen.queryByText(/ready to go further/)).not.toBeInTheDocument();
  });

  it("falls back to Welcome for an unknown stage", async () => {
    setup({ stage: "intermission" as StageId });
    await screen.findByText("Run r1");
    await onStage("welcome");
  });
});

describe("PresenterApp controls", () => {
  it("fades the controls when the mouse rests and brings them back on movement", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = setup();
      const bar = () => screen.getByRole("navigation", { name: "Stages" }).parentElement as HTMLElement;
      expect(bar().className).toContain("opacity-100");
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(bar().className).toContain("opacity-0");
      act(() => {
        fireEvent.mouseMove(window);
      });
      expect(bar().className).toContain("opacity-100");
      act(() => {
        fireEvent.mouseMove(window);
        vi.advanceTimersByTime(3000);
      });
      expect(bar().className).toContain("opacity-0");
      const remove = vi.spyOn(window, "removeEventListener");
      unmount();
      expect(remove).toHaveBeenCalledWith("mousemove", expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws the progress thread to the current stage", async () => {
    const { container } = setup({ stage: "scale" });
    await screen.findByText("Run r1");
    const fill = container.querySelector('[aria-hidden="true"].h-\\[6px\\] > div') as HTMLElement;
    expect(fill.style.width).toBe(`${((STAGES.findIndex((st) => st.id === "scale") + 1) / STAGES.length) * 100}%`);
  });

  it("scales the 16:9 slide to fit the window", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    try {
      Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
      setup();
      // 1024 / 1600 is tighter than 768 / 900.
      expect(screen.getByTestId("slide").style.transform).toBe("scale(0.64)");
      act(() => {
        Object.assign(window, { innerWidth: 1920, innerHeight: 1080 });
        window.dispatchEvent(new Event("resize"));
      });
      expect(screen.getByTestId("slide").style.transform).toBe("scale(1.2)");
    } finally {
      Object.assign(window, { innerWidth: width, innerHeight: height });
    }
  });
});

describe("PresenterApp new run", () => {
  it("cleans the run name and asks before starting", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { posts } = setup({ stage: "next" });
    await onStage("next");
    fireEvent.click(screen.getByRole("button", { name: "Show the states going further" }));

    const start = screen.getByRole("button", { name: "Start run" });
    expect(start).toBeDisabled();
    const input = screen.getByRole("textbox", { name: "New run name" });
    fireEvent.change(input, { target: { value: "Phoenix 2!" } });
    expect(input).toHaveValue("phoenix2");

    fireEvent.click(start);
    expect(confirm).toHaveBeenCalledWith('Start run "phoenix2" and move everyone to Welcome?');
    expect(posts()).toEqual([]);
    expect(input).toHaveValue("phoenix2");

    confirm.mockReturnValue(true);
    fireEvent.click(start);
    await screen.findByText("Run phoenix2");
    await onStage("welcome");
    expect(posts()).toEqual([{ runId: "phoenix2", stage: "welcome" }]);
    expect(input).toHaveValue("");
    expect(start).toBeDisabled();

    // The states hide again for the new run.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Next steps" }));
    await onStage("next");
    expect(screen.getByRole("button", { name: "Show the states going further" })).toBeInTheDocument();
  });
});
