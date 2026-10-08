import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BREAKOUT_PROMPT, EVENT, HOUSEHOLDS, STAGES, type StageId } from "@/lib/aspen/content";
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
  it("shows the join URL, the password, the counts and the agenda", async () => {
    setup();
    expect(await screen.findByText("Run r1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: EVENT.title })).toBeInTheDocument();
    expect(screen.getByText(EVENT.joinUrl)).toBeInTheDocument();
    expect(screen.getByText("phoenix-2026")).toHaveClass("font-mono");
    expect(screen.getByText(`Tonight · ${EVENT.place}`)).toBeInTheDocument();
    // The welcome slide carries the compact agenda: every stage label, the live one marked.
    for (const stage of STAGES) expect(screen.getAllByText(stage.label).length).toBeGreaterThan(0);
    expect(screen.queryByText(STAGES[1].agenda)).not.toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("people").previousSibling).toHaveTextContent("1"));
  });

  it("leaves out the password when there is none and flags a run without a store", async () => {
    setup({ joinPassword: null, live: false });
    expect(await screen.findByText(/not syncing \(no store\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Password:/)).not.toBeInTheDocument();
  });

  it("shows a placeholder run before the first poll and counts from an empty summary", () => {
    setup({ noPoll: true });
    expect(screen.getByText("Run …")).toBeInTheDocument();
    expect(screen.getByText("people").previousSibling).toHaveTextContent("0");
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
    fireEvent.keyDown(screen.getByRole("button", { name: "Next stage" }), { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Previous stage" }));
    expect(posts()).toEqual([]);
  });

  it("moves with the buttons and the stage menu", async () => {
    const { posts } = setup();
    await screen.findByText("Run r1");

    fireEvent.click(screen.getByRole("button", { name: "Next stage" }));
    await onStage("try");
    fireEvent.click(screen.getByRole("button", { name: "Previous stage" }));
    await onStage("welcome");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Thank you" }));
    await onStage("dinner");
    fireEvent.click(screen.getByRole("button", { name: "Next stage" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next stage" }));
    expect(await screen.findByText("The stage did not change. Check the connection.")).toBeInTheDocument();

    server.post = async () => jsonResponse({}, false);
    fireEvent.click(screen.getByRole("button", { name: "Previous stage" }));
    expect(await screen.findByText("The stage did not change. Check the connection.")).toBeInTheDocument();

    server.post = undefined;
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    await onStage("scale");
    expect(screen.queryByText(/The stage did not change/)).not.toBeInTheDocument();
  });
});

describe("PresenterApp stages", () => {
  it.each(STAGES.map((s) => s.id))("renders the %s stage", async (id) => {
    setup({ stage: id });
    await onStage(id);
    if (id !== "welcome") {
      const index = STAGES.findIndex((s) => s.id === id);
      const label = STAGES[index].label;
      expect(screen.getByText(`${String(index + 1).padStart(2, "0")} · ${label}`)).toBeInTheDocument();
      expect(screen.getByText(STAGES[index].summary)).toBeInTheDocument();
    }
  });

  it("toggles presenter notes on the households during Try it", async () => {
    setup({ stage: "try" });
    await onStage("try");
    await screen.findByText("How much SNAP can I get?");
    expect(screen.getByText(EVENT.joinUrl)).toBeInTheDocument();
    expect(screen.queryByText(HOUSEHOLDS[0].why)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show presenter notes on the households" }));
    for (const h of HOUSEHOLDS) expect(screen.getByText(h.why)).toBeInTheDocument();
    expect(screen.getByText(`${HOUSEHOLDS[0].label}:`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide presenter notes on the households" }));
    expect(screen.queryByText(HOUSEHOLDS[0].why)).not.toBeInTheDocument();
  });

  it("shows the room's results and discussion notes on the reveal", async () => {
    setup({ stage: "reveal" });
    await onStage("reveal");
    expect(await screen.findByText("Too confident")).toBeInTheDocument();
    expect(screen.getByText("To discuss")).toBeInTheDocument();
    expect(screen.getByText("A loose note").previousSibling).toHaveTextContent("From the room");
    expect(screen.getByText("Too confident").previousSibling).toHaveTextContent("How well did the AI answers perform?");
    // The misread rules show once, in the results.
    expect(screen.getAllByTitle("Asset tests")).toHaveLength(1);
    // The reveal board is framed for discussion.
    expect(screen.getByRole("heading", { name: "Could a resident act on these answers?" })).toBeInTheDocument();
  });

  it("shows the ratings coming in on Rate it", async () => {
    const withScales: RunSummary = {
      ...EMPTY_SUMMARY,
      discussion: {
        ...EMPTY_SUMMARY.discussion,
        scales: [
          {
            question: "performance",
            label: "How well did the AI answers perform?",
            low: "Not at all",
            high: "Fully",
            categories: [{ id: "amount", label: "Got the amount right", average: 2, count: 3 }],
          },
        ],
      },
    };
    setup({ stage: "rate", summary: withScales });
    await onStage("rate");
    expect(screen.getByText("ratings in so far").previousSibling).toHaveTextContent("3");
    expect(screen.getByText("2.0")).toBeInTheDocument();
  });

  it("counts zero ratings before anyone rates", async () => {
    setup({ stage: "rate", summary: EMPTY_SUMMARY });
    await onStage("rate");
    expect(screen.getByText("ratings in so far").previousSibling).toHaveTextContent("0");
  });

  it("shows the discussion questions on the reveal before anyone rates", async () => {
    setup({ stage: "reveal", summary: EMPTY_SUMMARY });
    await onStage("reveal");
    expect(await screen.findByText("To discuss")).toBeInTheDocument();
    expect(screen.queryByText("Pick topics from your phone.")).not.toBeInTheDocument();
  });

  it("shows the source-of-truth answers on the shared foundation", async () => {
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
    expect(screen.getByText(/said a resident, a screener or an AI can't fully check an answer/)).toHaveTextContent("5 of 6");
  });

  it("counts one checked answer in the singular on the shared foundation", async () => {
    setup({ stage: "foundation" });
    await onStage("foundation");
    expect(
      await screen.findByText("The room checked 1 answer against the rules. Next to the rules, the AI's answer was:"),
    ).toBeInTheDocument();
    expect(screen.getByTitle("It was wrong")).toBeInTheDocument();
  });

  it("uses the plural for several checked answers and hides the card when none are", async () => {
    setup({ stage: "foundation", summary: { ...SUMMARY, checked: 3 } });
    expect(
      await screen.findByText("The room checked 3 answers against the rules. Next to the rules, the AI's answer was:"),
    ).toBeInTheDocument();
  });

  it("leaves out the checked card when nobody checked", async () => {
    setup({ stage: "foundation", summary: EMPTY_SUMMARY });
    await onStage("foundation");
    await waitFor(() => expect(screen.getByText("One open, validated set of rules")).toBeInTheDocument());
    expect(screen.queryByText(/The room checked/)).not.toBeInTheDocument();
  });

  it("shows the small groups' use cases and ideas", async () => {
    setup({ stage: "groups" });
    await onStage("groups");
    expect(screen.getByText(BREAKOUT_PROMPT)).toBeInTheDocument();
    expect(await screen.findByText("Show staff the rules")).toBeInTheDocument();
    expect(screen.getByText("See and edit the rules", { selector: "li span" })).toBeInTheDocument();
    expect(screen.getByText("Ideas")).toBeInTheDocument();
  });

  it("reveals the states going further on next steps", async () => {
    setup({ stage: "next" });
    await onStage("next");
    await waitFor(() => expect(screen.getByText("states").previousSibling).toHaveTextContent("2"));
    expect(screen.getByText("people").previousSibling).toHaveTextContent("2");
    expect(screen.getByTitle("Accurate AI answers")).toBeInTheDocument();
    expect(screen.queryByText("Ohio")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal the states going further" }));
    expect(screen.getByText("Arizona")).toBeInTheDocument();
    expect(screen.getByText("Ohio")).toBeInTheDocument();
  });

  it("says so when no state has pledged yet", async () => {
    setup({ stage: "next", summary: EMPTY_SUMMARY });
    await onStage("next");
    fireEvent.click(screen.getByRole("button", { name: "Reveal the states going further" }));
    expect(screen.getByText("No states yet.")).toBeInTheDocument();
  });

  it("thanks the room with its numbers at dinner", async () => {
    setup({ stage: "dinner" });
    await onStage("dinner");
    expect(await screen.findByText("Tonight, this room")).toBeInTheDocument();
    expect(screen.getByText("states ready to go further")).toBeInTheDocument();
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
    const fill = container.querySelector('[aria-hidden="true"].h-\\[3px\\] > div') as HTMLElement;
    expect(fill.style.width).toBe(`${((STAGES.findIndex((st) => st.id === "scale") + 1) / STAGES.length) * 100}%`);
  });
});

describe("PresenterApp new run", () => {
  it("cleans the run name and asks before starting", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { posts } = setup({ stage: "next" });
    await onStage("next");
    fireEvent.click(screen.getByRole("button", { name: "Reveal the states going further" }));

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

    // The reveal resets for the new run.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Next steps" }));
    await onStage("next");
    expect(screen.getByRole("button", { name: "Reveal the states going further" })).toBeInTheDocument();
  });
});
