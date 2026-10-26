import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_HEADING,
  GOLDEN_A,
  ONE_SET_OF_RULES,
  BREAKOUT_PROMPT,
  GROUP_QUESTIONS,
  DISCUSSION_QUESTIONS,
  EVENT,
  EXAMPLE_HOUSEHOLD,
  FRONT_DOOR,
  liveDemoUrl,
  NEXT_STEPS,
  RATING_SCALES,
  SAME_RULES,
  WHAT_MODELS_MISS,
  ENGINE_PILOT,
  WHERE_MODELS_BREAK,
  SILVER_ASK,
  STAGES,
  type StageId,
} from "@/lib/aspen/content";
import { EMPTY_SUMMARY, summarizeRun, type RunSummary } from "@/lib/aspen/results";
import type { Control, RunData } from "@/lib/aspen/types";
import { CAPTIONS, STORY_LABEL } from "@/components/landing/journey-lamplight/captions";
import { forwardsFromFrame, nextPage, notApplyNote, pageRange, PresenterApp } from "./presenter-app";

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
    { run_id: "r1", kind: "breakout", payload: { useCase: "flows", note: "", raised: "Training time for staff" } },
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
    expect(screen.getByText(`With your hosts: ${EVENT.presenters}`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(EVENT.coverDate))).toBeInTheDocument();
    // The logo stands in for the organization name, on the slide and in the controls.
    expect(screen.getAllByRole("img", { name: "Axiom Foundation" }).length).toBeGreaterThanOrEqual(2);
    // How many joined sits in its own box beside the join panel.
    await waitFor(() => expect(screen.getByText("Joined").nextElementSibling).toHaveTextContent("1"));
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
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New run name" }), { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(posts()).toEqual([]);
  });

  it("still moves with the arrows and a clicker's page keys after a button was clicked", async () => {
    const { posts } = setup();
    await screen.findByText("Run r1");
    const next = screen.getByRole("button", { name: "Next slide" });

    // Space and Enter press the focused button, once, as the browser does; the slides don't also move.
    expect(fireEvent.keyDown(next, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(next, { key: "Enter" })).toBe(true);
    expect(posts()).toEqual([]);
    fireEvent.keyDown(next, { key: "ArrowRight" });
    await onStage("try");
    fireEvent.keyDown(next, { key: "PageUp" });
    await onStage("welcome");
    fireEvent.keyDown(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Thank you" }), { key: "PageDown" });
    await onStage("try");
    expect(posts()).toEqual([{ stage: "try" }, { stage: "welcome" }, { stage: "try" }]);
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
    expect(screen.getByText("1/2")).toBeInTheDocument();

    // What we saw: the room's results, then AI in their agencies. The 5x5 grid's slide is gone (Oct 23).
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText(RATING_SCALES.experience!.title)).toBeInTheDocument();
    expect(screen.queryByText(RATING_SCALES.performance!.title)).not.toBeInTheDocument();
    expect(posts()).toEqual([]);

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("scale");
    expect(screen.getByText("1/7")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    // A household, not a family: four of the five minimum-benefit households are one person.
    expect(screen.getByText(/of AI answers told a household that qualifies for SNAP it would get/)).toBeInTheDocument();
    expect(screen.getByText(STAGES.find((st) => st.id === "scale")!.summary)).toBeInTheDocument();

    // At scale: the share, then Max's household, chart, what the models miss, the front door and the tool pilot.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/7")).toBeInTheDocument();
    expect(screen.getByText(EXAMPLE_HOUSEHOLD.title)).toBeInTheDocument();
    // The summary shows on the first slide only.
    expect(screen.queryByText(STAGES.find((st) => st.id === "scale")!.summary)).not.toBeInTheDocument();
    // What the models miss comes straight after the household it explains (the dry run, Oct 25).
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("3/7")).toBeInTheDocument();
    for (const q of WHAT_MODELS_MISS.quotes) expect(screen.getByText(q.model)).toBeInTheDocument();
    // The Arizona review flag is gone: the example moved to Connecticut (d1919).
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("4/7")).toBeInTheDocument();
    expect(screen.getByText(WHERE_MODELS_BREAK.title)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("5/7")).toBeInTheDocument();
    // The last slide turns the stage from the problem to the fix.
    expect(screen.getByRole("heading", { level: 1, name: FRONT_DOOR.heading })).toBeInTheDocument();
    expect(screen.getByText(FRONT_DOOR.title)).toBeInTheDocument();
    // Max's original diagram, with no closing line under it.
    expect(screen.getByRole("img", { name: /ask an AI model what the law says/i })).toBeInTheDocument();
    expect(screen.queryByText(/it has to get the rules right/)).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("6/7")).toBeInTheDocument();
    // PolicyBench's pilot: each model with web search, and with our rules engine too; the change in accuracy and in cost (the dry run, Oct 25).
    expect(screen.getByRole("heading", { level: 1, name: FRONT_DOOR.heading })).toBeInTheDocument();
    expect(screen.getByText(ENGINE_PILOT.title)).toBeInTheDocument();
    const pilot = screen.getByRole("table", { name: new RegExp(`^${ENGINE_PILOT.title}`) });
    const rows = within(pilot).getAllByRole("row").slice(1);
    // One cell each: the model, both shares, the change with its interval, and the cost change with both costs.
    expect(rows.map((r) => [...r.querySelectorAll("th, td")].map((c) => c.textContent))).toEqual([
      ["GPT-6 Luna", "Web search: 55%Web search and our rules engine: 77%", "+22 points95%: +14 to +29", "\u221286%$0.056 to $0.008"],
      ["Claude Sonnet 5.5", "Web search: 59%Web search and our rules engine: 97%", "+38 points95%: +31 to +44", "\u221230%$0.112 to $0.078"],
      ["Gemini 3.5 Flash-Lite", "Web search: 23%Web search and our rules engine: 55%", "+32 points95%: +25 to +39", "\u221291%$0.343 to $0.031"],
    ]);
    expect(screen.getByText(ENGINE_PILOT.measures)).toBeInTheDocument();
    expect(screen.getByText(ENGINE_PILOT.source)).toBeInTheDocument();
    // The October 14–15 tool pilot is gone, and so is PolicyEngine's name.
    expect(screen.queryByText(/amounts still wrong with the tool/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PolicyEngine/)).not.toBeInTheDocument();
    // The demo's own link stays with the demo, At scale's last slide.
    expect(screen.queryByRole("link", { name: /Open demo in a new tab/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("7/7")).toBeInTheDocument();
    // The live chatbot, in compare mode with the demo's question filled in.
    const demo = screen.getByTitle(/Live chatbot demo/);
    expect(demo.getAttribute("src")).toMatch(/^https:\/\/axiom\.org\/gallery\/chatbot\?compare=1&q=What's%20the%20maximum%20monthly%20TANF/);
    expect(demo.getAttribute("src")).not.toMatch(/go=1/);
    expect(screen.getByRole("link", { name: /Open demo in a new tab/ })).toHaveAttribute("href", liveDemoUrl());
    expect(posts()).toEqual([{ stage: "scale" }]);

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("foundation");
    expect(screen.getByText("1/4")).toBeInTheDocument();

    // Back from a stage's first slide lands on the last slide of the stage before.
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByText("7/7")).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1, name: FRONT_DOOR.heading })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(screen.getByText("6/7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(screen.getByText("5/7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(screen.getByText("4/7")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: STAGES.find((st) => st.id === "scale")!.title })).toBeInTheDocument();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(screen.getByText("1/7")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await onStage("reveal");
    // Back onto the reveal lands on its last slide.
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(posts()).toEqual([{ stage: "scale" }, { stage: "foundation" }, { stage: "scale" }, { stage: "reveal" }]);
  });

  it("fills the window with the live demo on Full screen, keeping the same frame, until Exit or Escape", async () => {
    setup({ stage: "scale" });
    await onStage("scale");
    for (let i = 0; i < 6; i++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("7/7")).toBeInTheDocument();
    const frame = screen.getByTitle(/Live chatbot demo/);
    expect(frame.className).toContain("z-30");
    expect(screen.queryByRole("button", { name: "Exit full screen" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    // The same frame, so the conversation in it carries over; it covers the window, with a way back above it.
    expect(screen.getByTitle(/Live chatbot demo/)).toBe(frame);
    expect(frame.className).toContain("z-50");
    expect(frame.style.width).toBe("100vw");
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(frame.className).toContain("z-30");
    expect(screen.queryByRole("button", { name: "Exit full screen" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(frame.className).toContain("z-30");
    expect(screen.getByTitle(/Live chatbot demo/)).toBe(frame);
  });

  it("hears Escape and the clicker inside the live demo, once the presenter has clicked into it", async () => {
    setup({ stage: "scale" });
    await onStage("scale");
    for (let i = 0; i < 6; i++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const frame = screen.getByTitle(/Live chatbot demo/) as HTMLIFrameElement;
    // The demo is served from axiom.org, so the deck can listen in its window.
    fireEvent.load(frame);
    const inner = frame.contentWindow as Window & typeof globalThis;
    const press = (key: string) => {
      const event = new inner.KeyboardEvent("keydown", { key, cancelable: true });
      act(() => {
        inner.dispatchEvent(event);
      });
      return event;
    };
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(frame.className).toContain("z-50");
    press("Escape");
    expect(frame.className).toContain("z-30");
    // Space stays with the demo (it scrolls the answer); the clicker's page key moves the deck on.
    expect(press(" ").defaultPrevented).toBe(false);
    expect(screen.getByText("7/7")).toBeInTheDocument();
    expect(press("PageDown").defaultPrevented).toBe(true);
    await onStage("foundation");
  });

  it("keeps the slide, and the live demo, when a poll falls back to the default run", async () => {
    const { server, fetchMock } = setup({ stage: "scale" });
    await onStage("scale");
    for (let i = 0; i < 6; i++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const frame = screen.getByTitle(/Live chatbot demo/);
    const polls = () => fetchMock.mock.calls.filter(([url, init]) => url === "/api/aspen/state" && !init?.method).length;
    // A failed store read answers with the default run, not live.
    server.control = { runId: "rehearsal", stage: "welcome", live: false, updatedAt: null };
    const seen = polls();
    await waitFor(() => expect(polls()).toBeGreaterThan(seen + 1), { timeout: 12_000 });
    expect(screen.getByText("7/7")).toBeInTheDocument();
    expect(screen.getByTitle(/Live chatbot demo/)).toBe(frame);
    expect(screen.queryByText(/Run rehearsal/)).not.toBeInTheDocument();
    // When the store answers again, the room's own moves come through.
    server.control = { runId: "r1", stage: "foundation", live: true, updatedAt: "2026-10-26T01:00:00Z" };
    await waitFor(() => expect(screen.getByText("1/4")).toBeInTheDocument(), { timeout: 12_000 });
    await onStage("foundation");
  }, 30_000);

  it("shows no review flag on What the models miss (At scale 3/7), even with ?review", async () => {
    window.history.pushState({}, "", "/aspen/present?review");
    try {
      setup({ stage: "scale" });
      await onStage("scale");
      for (let i = 0; i < 2; i++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.getByText("3/7")).toBeInTheDocument();
      expect(screen.getByText(WHAT_MODELS_MISS.title)).toBeInTheDocument();
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", "/");
    }
  });
});

describe("PresenterApp stages", () => {
  it.each(STAGES.map((s) => s.id))("renders the %s stage", async (id) => {
    setup({ stage: id });
    await onStage(id);
    if (id !== "welcome" && id !== "dinner") {
      const index = STAGES.findIndex((s) => s.id === id);
      // No eyebrow over the heading (the dry run, Oct 25).
      expect(screen.queryByText(`${String(index + 1).padStart(2, "0")} · ${STAGES[index].label}`)).not.toBeInTheDocument();
      if (STAGES[index].summary) expect(screen.getByText(STAGES[index].summary)).toBeInTheDocument();
    }
  });

  it("drops the summary line under the shared foundation heading", async () => {
    setup({ stage: "foundation" });
    await onStage("foundation");
    expect(screen.queryByText(/Every tool rebuilds your rules on its own/)).not.toBeInTheDocument();
    expect(screen.getByText(/reducing cost, duplication and error at once/)).toBeInTheDocument();
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

  it("shows the overall ratings coming in on the second reveal slide", async () => {
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
            categories: [{ id: "amount", label: "Got the amount right", average: 4, count: 9 }],
          },
          {
            question: "experience",
            label: "How is AI performing overall in your agency?",
            low: "Not well",
            high: "Very well",
            categories: [{ id: "staff", label: "For your staff", average: 2, count }],
          },
        ],
      },
    });
    setup({ stage: "reveal", summary: scale(3) });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText(/rated AI overall/)).toHaveTextContent("3 people have rated AI overall"));
    expect(screen.getByText("2.0")).toBeInTheDocument();
    // The scale's ends sit under the ends of the bar, in the bar's column (the dry run, Oct 25).
    const low = screen.getByText("1 · Not well");
    expect(screen.getByText("Very well · 5").parentElement).toBe(low.parentElement);
    expect(low.parentElement).toHaveClass("col-start-2");
    // Old ratings of the retired grid never show or count.
    expect(screen.queryByText("Got the amount right")).not.toBeInTheDocument();
    cleanup();
    setup({ stage: "reveal", summary: scale(1) });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText(/rated AI overall/)).toHaveTextContent("1 person has rated AI overall"));
  });

  it("counts zero ratings before anyone rates", async () => {
    setup({ stage: "reveal", summary: EMPTY_SUMMARY });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText(/rated AI overall/)).toHaveTextContent("0 people have rated AI overall");
  });

  it("puts the answers that would send a resident the wrong way on the reveal", async () => {
    const harmful = summarizeRun({
      ...DATA,
      prompts: [{ ...DATA.prompts[0], would_act: "yes", resident_action: "not-apply" }],
    });
    setup({ stage: "reveal", summary: harmful });
    await onStage("reveal");
    await waitFor(() => expect(screen.getByText("answers looked right").previousSibling).toHaveTextContent("0 of 1"));
    expect(screen.getByText("looked wrong or unsure, yet a resident would act on them").previousSibling).toHaveTextContent("1");
    const stop = screen.getByText("would stop a resident from applying");
    expect(stop.previousSibling).toHaveTextContent("1");
    expect(stop.nextSibling).toHaveTextContent("1 of them qualifies.");
    expect(screen.getByText("What would a resident do next?")).toBeInTheDocument();
    // Phones stay quiet in What we saw, so the answers to talk about are on the screen.
    expect(screen.getByText("Answers worth discussing")).toBeInTheDocument();
    expect(screen.getByText("Looked wrong, yet acted on")).toBeInTheDocument();
    expect(screen.getByText("About $0.")).toBeInTheDocument();
    expect(screen.queryByText("To discuss")).not.toBeInTheDocument();
  });

  it("shows the two answers most worth discussing, with what people said, and the questions before any", async () => {
    const at = (m: number) => `2026-10-26T18:0${m}:00Z`;
    // Not checked against the rules, so each reason comes from the rating alone.
    const base = { ...DATA.prompts[0], post_check_verdict: null };
    const answers = summarizeRun({
      ...DATA,
      prompts: [
        { ...base, id: "q1", conversation_id: "q1", created_at: at(1), verdict: "unsure", rating_note: "Not sure about the asset test", answer: "Maybe $50." },
        { ...base, id: "q2", conversation_id: "q2", created_at: at(2), verdict: "wrong", resident_action: "not-apply", went_wrong: ["Wrong amount", "Said I don't qualify"], answer: "You don't qualify." },
        { ...base, id: "q3", conversation_id: "q3", created_at: at(3), verdict: "right", answer: "About $24." },
        { ...base, id: "q4", conversation_id: "q4", created_at: at(4), verdict: "wrong", rating_note: "Ignored BBCE", answer: "Over the limit." },
      ],
    });
    setup({ stage: "reveal", summary: answers });
    await onStage("reveal");
    const panel = (await screen.findByText("Answers worth discussing")).parentElement!;
    const items = within(panel).getAllByRole("listitem");
    // At most two, most harmful first: a convincing wrong answer, then a wrong one with a note.
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Looked wrong, yet acted on · Retiree in Phoenix");
    expect(items[0]).toHaveTextContent("Wrong amount · Said I don't qualify");
    expect(items[0]).toHaveTextContent("The AI: You don't qualify.");
    expect(items[1]).toHaveTextContent("Looked wrong");
    expect(within(items[1]).getByText("Ignored BBCE").tagName).toBe("Q");
    expect(screen.queryByText("About $24.")).not.toBeInTheDocument();
    cleanup();

    // "Not sure" and acted on says so, rather than calling the answer wrong.
    setup({
      stage: "reveal",
      summary: summarizeRun({ ...DATA, prompts: [{ ...base, verdict: "unsure", resident_action: "apply", answer: "Maybe $50." }] }),
    });
    await onStage("reveal");
    const unsure = within((await screen.findByText("Answers worth discussing")).parentElement!).getAllByRole("listitem");
    expect(unsure[0]).toHaveTextContent("Not sure, yet acted on · Retiree in Phoenix");
    expect(screen.queryByText(/Looked wrong, yet/)).not.toBeInTheDocument();
    cleanup();

    // Rated, but nothing flagged: the spoken questions instead, without the agency one (it has its own slide).
    setup({ stage: "reveal", summary: summarizeRun({ ...DATA, prompts: [{ ...base, verdict: "right" }] }) });
    await onStage("reveal");
    expect(await screen.findByText("To discuss")).toBeInTheDocument();
    for (const q of DISCUSSION_QUESTIONS) {
      if (q.id === "experience") expect(screen.queryByText(q.label)).not.toBeInTheDocument();
      else expect(screen.getByText(q.label)).toBeInTheDocument();
    }
  });

  it("counts an amount from rules that don't test eligibility apart from households that qualify", () => {
    expect(notApplyNote({ wouldNotApplyEligible: 0, wouldNotApplyIfEligible: 0 })).toBeNull();
    expect(notApplyNote({ wouldNotApplyEligible: 2, wouldNotApplyIfEligible: 0 })).toBe("2 of them qualify.");
    expect(notApplyNote({ wouldNotApplyEligible: 1, wouldNotApplyIfEligible: 0 })).toBe("1 of them qualifies.");
    expect(notApplyNote({ wouldNotApplyEligible: 0, wouldNotApplyIfEligible: 1 })).toBe(
      "For 1 of them, the rules give an amount but don't test eligibility yet.",
    );
    expect(notApplyNote({ wouldNotApplyEligible: 2, wouldNotApplyIfEligible: 3 })).toBe(
      "2 of them qualify. For 3 more, the rules give an amount but don't test eligibility yet.",
    );
  });

  it("keeps an Arizona rules amount conditional on eligibility in the reveal", async () => {
    const harmful = summarizeRun({
      ...DATA,
      prompts: [{
        ...DATA.prompts[0],
        household_id: "ct-couple",
        rules_program: "Arizona SNAP",
        rules_outputs: [{ program: "us-az-snap", eligibilityTested: false }],
        resident_action: "not-apply",
      }],
    });
    setup({ stage: "reveal", summary: harmful });
    await onStage("reveal");
    await waitFor(() => expect(screen.getByText("would stop a resident from applying").previousSibling).toHaveTextContent("1"));
    expect(screen.getByText("For 1 of them, the rules give an amount but don't test eligibility yet.")).toBeInTheDocument();
    expect(screen.queryByText(/of them qualif/)).not.toBeInTheDocument();
  });

  it("labels the monthly standards beside both annual references, and shows every model's answer", async () => {
    setup({ stage: "scale" });
    await onStage("scale");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/7")).toBeInTheDocument();
    // The big number and the one tile that matched it.
    expect(screen.getAllByText("$288")).toHaveLength(2);
    // The panel label says "SNAP for 2026", so the big number doesn't repeat the year (Pavel's review).
    expect(screen.queryByText("in 2026")).not.toBeInTheDocument();
    expect(screen.getByText(/\$24 a month under the benchmark's July 2026 rules \(FY2026 standards\)\./)).toBeInTheDocument();
    // "The true benefit", with an asterisk to the note on which rules (the dry run, Oct 25).
    expect(screen.getByText("The true benefit*")).toBeInTheDocument();
    expect(screen.getByText(/^\*The reference answer in PolicyBench, our benchmark: \$24 a month/)).toBeInTheDocument();
    expect(screen.getByText(/The minimum rose to \$25 on October 1, so 2026 comes to \$291 under current law\./)).toBeInTheDocument();
    expect(screen.getByText("from 42 of 49 AI models · 1 matched exactly")).toBeInTheDocument();
    expect(screen.getByText("Each model's answer for the year, one per model")).toBeInTheDocument();
    // One tile per model: 42 at $0, the one right answer, four at FY2025's $23 a month, and one that didn't parse.
    const tiles = within(screen.getByRole("group", { name: /^50 models: 42 said \$0, 1 said \$288, 6 gave other amounts, 1 gave no answer$/ })).getAllByRole("listitem");
    expect(tiles).toHaveLength(50);
    expect(tiles.filter((t) => t.textContent === "$0")).toHaveLength(42);
    expect(tiles.filter((t) => t.textContent?.startsWith("$288"))).toHaveLength(1);
    expect(tiles.filter((t) => t.textContent === "$276")).toHaveLength(4);
    expect(tiles.filter((t) => t.textContent === "$5,160")).toHaveLength(1);
    expect(tiles.filter((t) => t.textContent?.includes("no answer"))).toHaveLength(1);
    // The one exact answer stands out, and a screen reader hears why.
    const exact = tiles.find((t) => t.textContent?.startsWith("$288"))!;
    expect(exact).toHaveTextContent("$288, matches the reference");
    const other = tiles.find((t) => t.textContent === "$276")!;
    expect(exact.className).toContain("bg-[var(--color-accent-light)]");
    expect(exact.className).toContain("font-semibold");
    expect(other.className).not.toContain("color-accent");

    // What the models miss, next: the rule alone, with no amount, since the room knows BBCE (the dry run, Oct 25).
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("3/7")).toBeInTheDocument();
    expect(screen.getByText(WHAT_MODELS_MISS.rule)).toBeInTheDocument();
    expect(screen.getByText(/so they skip the net income test both models used\. They qualify\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/\$288/)).not.toBeInTheDocument();
    expect(screen.queryByText(/a month under the benchmark's July 2026 rules/)).not.toBeInTheDocument();
    expect(screen.getByText("7 CFR 273.2(j)(2) · USDA FNA BBCE chart, June 2026 · PolicyBench, Oct 14, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/Arizona/)).not.toBeInTheDocument();
  });

  it("keeps the plain labels when no answer would send a resident the wrong way", async () => {
    setup({ stage: "reveal" });
    await onStage("reveal");
    await waitFor(() => expect(screen.getByText("would stop a resident from applying").previousSibling).toHaveTextContent("0"));
    expect(screen.getByText("would stop a resident from applying").nextSibling).toBeNull();
  });

  it("waits for ratings on the reveal", async () => {
    setup({ stage: "reveal", summary: EMPTY_SUMMARY });
    await onStage("reveal");
    expect(screen.getByText("Results appear here as people rate their answers.")).toBeInTheDocument();
    expect(screen.queryByText("To discuss")).not.toBeInTheDocument();
  });

  it("opens the shared foundation with the room's own answer, then plays the journey", async () => {
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
    // A title slide, then the journey, which shows how the rules get built and what they power (the dry run, Oct 25).
    expect(screen.getByText("1/4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: STAGES.find((st) => st.id === "foundation")!.title })).toBeInTheDocument();
    // About whether a resident, screener or AI can check, as the question asked; not about the people in the room.
    await waitFor(() =>
      expect(screen.getByText(/In this room/)).toHaveTextContent("In this room, 5 of 6 say a resident, screener or AI can't fully check"),
    );
    expect(screen.getByText(/Next: how we build it, from the law as written to running code, and what it can power\./)).toBeInTheDocument();
    // The one set of rules waits until after the journey.
    expect(screen.queryByText("One open, validated set of rules")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: SAME_RULES.heading })).not.toBeInTheDocument();

    // The homepage's journey plays over the slide; Space pauses it instead of moving on.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "From the law as written to running code" })).toBeInTheDocument();
    const stage = document.querySelector("[data-aspen-overlay] .jl-stage");
    expect(stage).not.toBeNull();
    expect(within(stage as HTMLElement).getByRole("img", { name: STORY_LABEL })).toBeInTheDocument();
    for (const c of CAPTIONS) expect(within(stage as HTMLElement).getByText(c.title)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: " " });
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(screen.getByText("Paused: Space plays on")).toBeInTheDocument();

    // After the journey, the one set of rules, readable on the TV: the journey's last scenes are small (Oct 26).
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(document.querySelector(".jl-stage")).toBeNull();
    expect(screen.getByText("One open, validated set of rules")).toBeInTheDocument();
    for (const use of ONE_SET_OF_RULES) expect(screen.getByText(use.label)).toBeInTheDocument();

    // Then the tiers, from screener parity to Gold A.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("4/4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: BUILD_HEADING })).toBeInTheDocument();
    for (const tier of GOLDEN_A) expect(screen.getByText(tier.name)).toBeInTheDocument();

    // The tiers are the stage's last slide: the next moves the room on.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("groups");
  });

  it("leaves out the room's answer on the shared foundation when nobody gave one", async () => {
    setup({ stage: "foundation", summary: EMPTY_SUMMARY });
    await onStage("foundation");
    expect(screen.queryByText(/In this room/)).not.toBeInTheDocument();
  });

  it("shows the votes as they come in, on the first small-groups slide", async () => {
    setup({ stage: "groups" });
    await onStage("groups");
    expect(screen.getByText("1/2")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/· vote on your phone/)).toHaveTextContent("2 votes · vote on your phone"));
    expect(screen.getByTitle("Project policy changes").nextSibling?.nextSibling).toHaveTextContent("2");
  });

  it("waits for votes, and counts one in the singular", async () => {
    setup({ stage: "groups", summary: EMPTY_SUMMARY });
    await onStage("groups");
    expect(screen.getByText("Votes appear here as people vote.")).toBeInTheDocument();
    cleanup();
    setup({ stage: "groups", summary: summarizeRun({ ...DATA, events: [DATA.events.find((e) => e.kind === "vote")!] }) });
    await waitFor(() => expect(screen.getByText(/· vote on your phone/)).toHaveTextContent("1 vote · vote on your phone"));
  });

  it("shows the ideas groups share back, on the second small-groups slide", async () => {
    setup({ stage: "groups" });
    await onStage("groups");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText(BREAKOUT_PROMPT)).toBeInTheDocument();
    expect(await screen.findByText("Show staff the rules")).toBeInTheDocument();
    expect(screen.getByText("See and trace the rules")).toBeInTheDocument();
    expect(screen.getAllByText("Group idea").length).toBeGreaterThan(0);
    for (const q of GROUP_QUESTIONS) expect(screen.getByText(q.label)).toBeInTheDocument();
    // A group that only raised something still gets a card.
    expect(screen.getByText("Training time for staff")).toBeInTheDocument();
    // Clicking a card fills the slide with that group's answers; Escape goes back.
    fireEvent.click(screen.getByRole("button", { name: "Report back: Build caseworker flows" }));
    const dialog = screen.getByRole("dialog", { name: "Report back: Build caseworker flows" });
    expect(dialog).toHaveTextContent("Also raised: Training time for staff");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sizes the idea cards to the number of groups, and fits at most six", async () => {
    const withIdeas = (n: number) =>
      summarizeRun({
        ...DATA,
        events: Array.from({ length: n }, (_, i) => ({
          run_id: "r1",
          kind: "breakout",
          payload: { useCase: "see-edit", note: `Idea ${i + 1}` },
        })),
      });
    for (const [n, rows, clamp] of [
      [1, 1, "line-clamp-3"],
      [2, 1, "line-clamp-3"],
      [3, 2, "line-clamp-3"],
      [4, 2, "line-clamp-3"],
      [5, 3, "line-clamp-2"],
      [6, 3, "line-clamp-2"],
      [8, 3, "line-clamp-2"],
    ] as const) {
      cleanup();
      setup({ stage: "groups", summary: withIdeas(n) });
      await onStage("groups");
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      // Newest first, so the latest idea leads.
      const first = await screen.findByText(`Idea ${n}`);
      const list = first.closest("ul")!;
      expect(list.style.gridTemplateRows).toBe(`repeat(${rows}, minmax(0, 1fr))`);
      expect(within(list).getAllByRole("listitem")).toHaveLength(Math.min(n, 6));
      expect(first.className).toContain(clamp);
    }
  });

  it("waits for the groups' ideas", async () => {
    setup({ stage: "groups", summary: EMPTY_SUMMARY });
    await onStage("groups");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("Ideas appear here as groups share them.")).toBeInTheDocument();
  });

  it("shows next steps as one slide, the ask and the form, without the Silver A ask (Oct 26)", async () => {
    const { posts } = setup({ stage: "next" });
    await onStage("next");
    expect(screen.getByText(NEXT_STEPS.ask)).toBeInTheDocument();
    for (const o of NEXT_STEPS.options) expect(screen.getByText(o.label)).toBeInTheDocument();
    expect(screen.queryByText(SILVER_ASK.title)).not.toBeInTheDocument();
    expect(screen.queryByText("Tell us if your state wants to go further.")).not.toBeInTheDocument();
    expect(screen.queryByText("1/2")).not.toBeInTheDocument();
    expect(posts()).toEqual([]);
  });

  it("shows the join QR code on the welcome slide", async () => {
    setup({ stage: "welcome" });
    await onStage("welcome");
    expect(screen.getByRole("img", { name: "QR code for axiom.org/aspen" })).toBeInTheDocument();
  });

  it("asks for next steps without putting counts on the screen", async () => {
    setup({ stage: "next" });
    await onStage("next");
    expect(screen.getByText(NEXT_STEPS.ask)).toBeInTheDocument();
    for (const o of NEXT_STEPS.options) expect(screen.getByText(o.label)).toBeInTheDocument();
    expect(screen.getByText(/Fill in the short form on your phone/)).toBeInTheDocument();
    expect(screen.queryByText("people")).not.toBeInTheDocument();
    // Nothing from the pledges goes on the screen, and there's no control to show it.
    expect(screen.queryByText("Ohio")).not.toBeInTheDocument();
    expect(screen.queryByText("Arizona")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /states/i })).not.toBeInTheDocument();
  });

  it("shows each PolicyBench slide's source, without the PolicyEngine disclosure", async () => {
    setup({ stage: "scale" });
    await onStage("scale");
    // Slides 2 to 4 are Max's PolicyBench slides: the household, what the models miss on it, then where they break.
    for (const source of [EXAMPLE_HOUSEHOLD.source, WHAT_MODELS_MISS.sources, WHERE_MODELS_BREAK.source]) {
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.getByText(source)).toBeInTheDocument();
      expect(screen.queryByText(/CEO of both/)).not.toBeInTheDocument();
    }
  });

  it("keeps agency comments hidden until the presenter shows them", async () => {
    const withComments = summarizeRun({
      ...DATA,
      events: [
        ...DATA.events,
        { run_id: "r1", kind: "discussion", payload: { question: "experience", ratings: { staff: 4 }, note: "Helps staff, confuses residents" } },
      ],
    });
    setup({ stage: "reveal", summary: withComments });
    await onStage("reveal");
    expect(screen.queryByRole("button", { name: "Show agency comments" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("How is AI performing overall in your agency?")).toBeInTheDocument());
    expect(screen.queryByText("Helps staff, confuses residents")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show agency comments" }));
    expect(screen.getByText("Helps staff, confuses residents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide agency comments" }));
    expect(screen.queryByText("Helps staff, confuses residents")).not.toBeInTheDocument();
  });

  it("turns the answers worth discussing two at a time, and agency comments four at a time, so each gets its turn", async () => {
    const at = (m: number) => `2026-10-26T18:0${m}:00Z`;
    const base = { ...DATA.prompts[0], post_check_verdict: null };
    const many = summarizeRun({
      ...DATA,
      prompts: [
        { ...base, id: "q1", conversation_id: "q1", created_at: at(1), verdict: "wrong", rating_note: "First note", answer: "One." },
        { ...base, id: "q2", conversation_id: "q2", created_at: at(2), verdict: "wrong", rating_note: "Second note", answer: "Two." },
        { ...base, id: "q3", conversation_id: "q3", created_at: at(3), verdict: "wrong", rating_note: "Third note", answer: "Three." },
      ],
      events: [
        ...DATA.events,
        ...Array.from({ length: 6 }, (_, i) => ({
          run_id: "r1",
          kind: "discussion",
          payload: { question: "experience", ratings: { staff: 3 }, note: `Agency comment ${i + 1}` },
        })),
      ],
    });
    const answers = () => within(screen.getByText("Answers worth discussing").parentElement!).getAllByRole("listitem");
    const turn = () =>
      act(() => {
        vi.advanceTimersByTime(12_000);
      });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setup({ stage: "reveal", summary: many });
      await onStage("reveal");
      await waitFor(() => expect(answers()).toHaveLength(2));
      const first = answers().map((li) => li.textContent);
      expect(screen.getByText("Answers worth discussing")).toHaveTextContent("Answers worth discussing · 1\u20132 of 3");
      turn();
      expect(answers()).toHaveLength(1);
      expect(screen.getByText("Answers worth discussing")).toHaveTextContent("3 of 3");
      expect(first).not.toContain(answers()[0].textContent);
      turn();
      expect(answers().map((li) => li.textContent)).toEqual(first);

      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.getByText("2/2")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show agency comments" }));
      // Newest first, four on screen, then the rest, then back round.
      const shown = () => [6, 5, 4, 3, 2, 1].filter((n) => screen.queryByText(`Agency comment ${n}`));
      expect(shown()).toEqual([6, 5, 4, 3]);
      expect(screen.getByText("Comments 1\u20134 of 6")).toBeInTheDocument();
      turn();
      expect(shown()).toEqual([2, 1]);
      expect(screen.getByText("Comments 5\u20136 of 6")).toBeInTheDocument();
      turn();
      expect(shown()).toEqual([6, 5, 4, 3]);
      turn();
      // Hidden and shown again, they start over at the first four.
      fireEvent.click(screen.getByRole("button", { name: "Hide agency comments" }));
      fireEvent.click(screen.getByRole("button", { name: "Show agency comments" }));
      expect(shown()).toEqual([6, 5, 4, 3]);
    } finally {
      vi.useRealTimers();
    }
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

describe("rotating pages", () => {
  it("visits every item exactly once per cycle, from any page, and stays put while everything fits", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 1, max: 8 }), fc.nat(), (count, size, n) => {
        const pages = Math.max(1, Math.ceil(count / size));
        const start = n % pages;
        const seen: number[] = [];
        let page = start;
        for (let t = 0; t < pages; t++) {
          expect(page).toBeGreaterThanOrEqual(0);
          expect(page).toBeLessThan(pages);
          for (let i = page * size; i < Math.min(count, (page + 1) * size); i++) seen.push(i);
          page = nextPage(page, count, size);
        }
        // Back where it started, having shown each item once.
        expect(page).toBe(start);
        expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
        if (count <= size) expect(nextPage(start, count, size)).toBe(0);
      }),
    );
  });

  it("counts a page past the end, after the list shrank, as the last", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 8 }), fc.nat(50), (count, size, extra) => {
        const pages = Math.ceil(count / size);
        expect(nextPage(pages - 1 + extra, count, size)).toBe(nextPage(pages - 1, count, size));
      }),
    );
  });

  it("passes on only Escape, a clicker's page keys, and the arrows when not typing, from the live demo", () => {
    const key = (k: string, tagName?: string, mods: Partial<KeyboardEvent> = {}) =>
      ({ key: k, target: tagName ? { tagName } : null, altKey: false, ctrlKey: false, metaKey: false, ...mods }) as unknown as KeyboardEvent;
    expect(forwardsFromFrame(key("Escape", "TEXTAREA"))).toBe(true);
    expect(forwardsFromFrame(key("PageDown", "TEXTAREA"))).toBe(true);
    expect(forwardsFromFrame(key("PageUp"))).toBe(true);
    expect(forwardsFromFrame(key("ArrowRight", "BODY"))).toBe(true);
    expect(forwardsFromFrame(key("ArrowLeft", "TEXTAREA"))).toBe(false);
    expect(forwardsFromFrame(key("ArrowRight", "INPUT"))).toBe(false);
    expect(forwardsFromFrame(key(" ", "BODY"))).toBe(false);
    expect(forwardsFromFrame(key("Enter", "BUTTON"))).toBe(false);
    expect(forwardsFromFrame(key("ArrowDown"))).toBe(false);
    expect(forwardsFromFrame(key("PageDown", undefined, { metaKey: true }))).toBe(false);
  });

  it("names the items a page shows", () => {
    expect(pageRange(0, 4, 9)).toBe("1\u20134 of 9");
    expect(pageRange(2, 4, 9)).toBe("9 of 9");
    expect(pageRange(1, 2, 4)).toBe("3\u20134 of 4");
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

    // The form stays folded away until opened.
    expect(screen.queryByRole("textbox", { name: "New run name" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
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
    // Starting folds the form away again; reopened, it starts empty.
    expect(screen.queryByRole("textbox", { name: "New run name" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    expect(screen.getByRole("textbox", { name: "New run name" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Start run" })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "New run name" })).not.toBeInTheDocument();
  });
});
