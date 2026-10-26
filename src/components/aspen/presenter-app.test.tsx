import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_HEADING,
  GOLDEN_A,
  ONE_SET_GROUPS,
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
  STAGES,
  type StageId,
} from "@/lib/aspen/content";
import { EMPTY_SUMMARY, summarizeRun, type RunSummary } from "@/lib/aspen/results";
import type { Control, RunData } from "@/lib/aspen/types";
import { CAPTIONS, STORY_LABEL } from "@/components/landing/journey-lamplight/captions";
import { createMemoryStore, createSupabaseStore } from "@/lib/aspen/store";
import { CONTROL_TIMEOUT_MS } from "./client";
import { newerControl } from "@/lib/aspen/control";
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

// Like fetch, each read parses a fresh copy: a poll of a row that hasn't changed is still a new object.
function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 401, json: async () => JSON.parse(JSON.stringify(data)) } as unknown as Response;
}

interface Server {
  control: Control;
  summary: RunSummary;
  /** Overrides the POST /api/aspen/state answer. */
  post?: (body: Partial<Control>, init?: RequestInit) => Promise<Response>;
  /** Overrides the GET /api/aspen/state answer. */
  get?: () => Promise<Response>;
}

function setup(
  options: {
    stage?: StageId;
    live?: boolean;
    summary?: RunSummary;
    joinPassword?: string | null;
    noPoll?: boolean;
    get?: () => Promise<Response>;
  } = {},
) {
  const server: Server = {
    control: { runId: "r1", stage: options.stage ?? "welcome", live: options.live ?? true, updatedAt: null },
    summary: options.summary ?? SUMMARY,
    get: options.get ?? (options.noPoll ? () => new Promise<Response>(() => {}) : undefined),
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/aspen/results")) {
      return jsonResponse({ runId: server.control.runId, live: true, summary: server.summary });
    }
    if (url === "/api/aspen/state" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Partial<Control>;
      if (server.post) return server.post(body, init);
      server.control = { ...server.control, ...body };
      return jsonResponse(server.control);
    }
    if (url === "/api/aspen/state") {
      return server.get ? server.get() : jsonResponse(server.control);
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  // Each move's body, without the run it names (`inRun`), which its own tests check.
  const bodies = () =>
    fetchMock.mock.calls
      .filter(([url, init]) => url === "/api/aspen/state" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as Partial<Control> & { inRun?: string });
  const posts = () => bodies().map(({ inRun: _inRun, ...body }) => body);
  const view = render(
    <PresenterApp joinPassword={options.joinPassword === undefined ? "phoenix-2026" : options.joinPassword} />,
  );
  return { server, fetchMock, posts, bodies, ...view };
}

async function onStage(id: StageId) {
  const stage = STAGES.find((s) => s.id === id)!;
  // Next steps opens on the tiers, under their own heading (Oct 26).
  const title = id === "welcome" ? EVENT.title : id === "next" ? BUILD_HEADING : stage.title;
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

  it("shows a move at once before the first poll lands, and goes back to Welcome if it fails", async () => {
    const { server, posts } = setup({ noPoll: true });
    let settle: (r: Response) => void = () => {};
    server.post = () => new Promise<Response>((resolve) => (settle = resolve));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    expect(posts()).toEqual([{ stage: "scale" }]);
    await onStage("scale");
    expect(screen.getByText("Run …")).toBeInTheDocument();
    await act(async () => settle(jsonResponse({ error: "No." }, false)));
    // With no read of the room yet, the TV is back where it started.
    await onStage("welcome");
    expect(screen.getByText("No.")).toBeInTheDocument();
  });

  it("goes on from the first move when the arrow is pressed twice before the first poll and the move's answer", async () => {
    const { server, posts } = setup({ noPoll: true });
    const pending: { body: Partial<Control>; resolve: (r: Response) => void }[] = [];
    server.post = (body) => new Promise<Response>((resolve) => pending.push({ body, resolve }));
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(posts()).toEqual([{ stage: "try" }, { stage: "reveal" }]);
    await onStage("reveal");
    await act(async () => {
      for (const [i, move] of pending.entries()) {
        server.control = { ...server.control, ...move.body, updatedAt: `2026-10-27T01:00:0${i + 1}Z` };
        move.resolve(jsonResponse(server.control));
      }
    });
    await onStage("reveal");
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("shows an error banner when the stage does not change, and puts the TV back on the stage the phones have", async () => {
    const { server, posts } = setup();
    await screen.findByText("Run r1");
    const generic = "The stage did not change. Check the connection.";

    server.post = async () => jsonResponse({ error: "Presenter sign-in expired." }, false);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText("Presenter sign-in expired.")).toBeInTheDocument();
    // The store kept Welcome, so the TV is back on it: it never stays on a stage the phones didn't get.
    await onStage("welcome");

    server.post = async () => {
      throw new Error("offline");
    };
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(await screen.findByText(generic)).toBeInTheDocument();
    await onStage("welcome");

    server.post = undefined;
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    await waitFor(() => expect(screen.queryByText(/The stage did not change/)).not.toBeInTheDocument());
    await onStage("try");

    server.post = async () => jsonResponse({}, false);
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(await screen.findByText(generic)).toBeInTheDocument();
    await onStage("try");

    // An answer that isn't a control row says nothing about the store, so it doesn't count as saved either.
    server.post = undefined;
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    await onStage("scale");
    expect(screen.queryByText(/The stage did not change/)).not.toBeInTheDocument();
    server.post = async () => jsonResponse({ saved: true });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Small groups" }));
    expect(await screen.findByText(generic)).toBeInTheDocument();
    await onStage("scale");
    expect(posts().map((p) => p.stage)).toEqual(["try", "try", "try", "welcome", "scale", "groups"]);
  });

  it("puts the TV back on the slide it left when a move to the next stage fails, so the next press tries again", async () => {
    const { server, posts } = setup({ stage: "reveal" });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();

    let refuse: () => void = () => {};
    server.post = () => new Promise<Response>((resolve) => (refuse = () => resolve(jsonResponse({ error: "Presenter sign-in expired." }, false))));
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    // At once, the TV shows the move, and the arrows step through the new stage's slides...
    await onStage("scale");
    expect(screen.getByText("1/7")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/7")).toBeInTheDocument();
    // ...and when the store refuses it, the slide it left: the reveal's last, not its first.
    await act(async () => refuse());
    expect(await screen.findByText("Presenter sign-in expired.")).toBeInTheDocument();
    await onStage("reveal");
    expect(screen.getByText("2/2")).toBeInTheDocument();

    server.post = undefined;
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("scale");
    expect(screen.getByText("1/7")).toBeInTheDocument();
    // Back from the stage's first slide, refused, lands where it was too.
    server.post = async () => jsonResponse({ error: "No." }, false);
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(await screen.findByText("No.")).toBeInTheDocument();
    await onStage("scale");
    expect(screen.getByText("1/7")).toBeInTheDocument();
    expect(posts()).toEqual([{ stage: "scale" }, { stage: "scale" }, { stage: "reveal" }]);
  });

  it("starts the stage it left at its first slide when it comes back later, once the move away saved", async () => {
    const { posts } = setup({ stage: "reveal" });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("scale");
    await waitFor(() => expect(posts()).toEqual([{ stage: "scale" }]));
    await act(async () => {});
    expect(screen.getByText("1/7")).toBeInTheDocument();
    // Back by its button: the room's results first, as for any other stage, not the slide it left.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "What we saw" }));
    await onStage("reveal");
    await act(async () => {});
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("starts a stage at its first slide when its button brings the room back, after a button took it away", async () => {
    const { posts } = setup({ stage: "reveal" });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
    fireEvent.click(nav().getByRole("button", { name: "At scale" }));
    await onStage("scale");
    await waitFor(() => expect(posts()).toEqual([{ stage: "scale" }]));
    await act(async () => {});
    fireEvent.click(nav().getByRole("button", { name: "What we saw" }));
    await onStage("reveal");
    await act(async () => {});
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("starts a stage at its first slide when another screen moves the room back to it", async () => {
    const { server, fetchMock, posts } = setup({ stage: "reveal" });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    await onStage("scale");
    await waitFor(() => expect(posts()).toEqual([{ stage: "scale" }]));
    await act(async () => {});
    server.control = { runId: "r1", stage: "reveal", live: true, updatedAt: "2026-10-27T00:40:00Z" };
    const polls = () => fetchMock.mock.calls.filter(([url, init]) => url === "/api/aspen/state" && !init?.method).length;
    const seen = polls();
    await waitFor(() => expect(polls()).toBeGreaterThan(seen), { timeout: 8000 });
    await onStage("reveal");
    expect(screen.getByText("1/2")).toBeInTheDocument();
  }, 15_000);

  it("goes back to the stage before a new run the store refused", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { server } = setup({ stage: "reveal" });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    server.post = async () => jsonResponse({ error: "Send a stage or a runId." }, false);
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "phoenix" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText("Send a stage or a runId.")).toBeInTheDocument();
    await onStage("reveal");
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("Run r1")).toBeInTheDocument();
  });

  it("goes back to the slide it left before its first read, when the moves settle the room there", async () => {
    const { server } = setup({ noPoll: true });
    const pending: { body: Partial<Control>; resolve: (r: Response) => void }[] = [];
    server.post = (body) => new Promise<Response>((resolve) => pending.push({ body, resolve }));
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Welcome" }));
    await onStage("welcome");
    // Try it and What we saw save; Welcome doesn't. No poll has answered yet.
    await act(async () => {
      for (const [i, move] of pending.slice(0, 2).entries()) {
        server.control = { ...server.control, ...move.body, updatedAt: `2026-10-27T01:00:0${i + 1}Z` };
        move.resolve(jsonResponse(server.control));
      }
      pending[2].resolve(jsonResponse({ error: "No." }, false));
    });
    await onStage("reveal");
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("sends Start run once the moves before it settle, and the moves after it once it has", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { server, posts } = setup({ stage: "reveal" });
    await onStage("reveal");
    const pending: ((r: Response) => void)[] = [];
    server.post = () => new Promise<Response>((resolve) => pending.push(resolve));
    const stamped = (body: Partial<Control>, second: number) =>
      jsonResponse({ ...server.control, ...body, updatedAt: `2026-10-27T01:00:0${second}Z` });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Small groups" }));
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await onStage("welcome");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    await onStage("scale");
    // Start run waits for the move before it, and the move after it waits for Start run.
    expect(posts()).toEqual([{ stage: "groups" }]);
    await act(async () => pending[0](stamped({ stage: "groups" }, 1)));
    expect(posts()).toEqual([{ stage: "groups" }, { runId: "r2", stage: "welcome" }]);
    await onStage("scale");
    await act(async () => pending[1](stamped({ runId: "r2", stage: "welcome" }, 2)));
    expect(posts()).toEqual([{ stage: "groups" }, { runId: "r2", stage: "welcome" }, { stage: "scale" }]);
    await onStage("scale");
    // The move after it fails, so the TV shows what the store holds: the new run, on Welcome.
    await act(async () => pending[2](jsonResponse({ error: "No." }, false)));
    await onStage("welcome");
    expect(screen.getByText("Run r2")).toBeInTheDocument();
  });

  it("sends a move after a Start run that failed, once it has, and the moves after that at once", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { server, posts } = setup({ stage: "reveal" });
    await onStage("reveal");
    let refuse: (r: Response) => void = () => {};
    server.post = () => new Promise<Response>((resolve) => (refuse = resolve));
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    server.post = undefined;
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Try it" }));
    expect(posts()).toEqual([{ runId: "r2", stage: "welcome" }]);
    await act(async () => refuse(jsonResponse({ error: "No." }, false)));
    expect(posts()).toEqual([{ runId: "r2", stage: "welcome" }, { stage: "try" }]);
    await onStage("try");
    expect(screen.getByText("Run r1")).toBeInTheDocument();
    // With Start run settled, nothing holds a move back.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    expect(posts()).toEqual([{ runId: "r2", stage: "welcome" }, { stage: "try" }, { stage: "scale" }]);
    await onStage("scale");
  });

  it("shows the new run, and polls its results, once Start run saves, while the move after it is still in flight", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { server, posts, fetchMock } = setup({ stage: "reveal" });
    await onStage("reveal");
    const pending: ((r: Response) => void)[] = [];
    server.post = () => new Promise<Response>((resolve) => pending.push(resolve));
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    await onStage("scale");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText(/^2\/\d+$/)).toBeInTheDocument();
    const asked = (run: string) => fetchMock.mock.calls.some(([url]) => url === `/api/aspen/results?run=${run}`);
    expect(screen.getByText("Run r1")).toBeInTheDocument();
    expect(asked("r2")).toBe(false);
    // Start run saves; At scale is sent, and still in flight. The polls still read r1's row, unstamped.
    await act(async () => pending[0](jsonResponse({ runId: "r2", stage: "welcome", live: true, updatedAt: "2026-10-27T01:00:01Z" })));
    expect(posts()).toEqual([{ runId: "r2", stage: "welcome" }, { stage: "scale" }]);
    expect(screen.getByText("Run r2")).toBeInTheDocument();
    await waitFor(() => expect(asked("r2")).toBe(true));
    await onStage("scale");
    expect(screen.getByText(/^2\/\d+$/)).toBeInTheDocument();
    // At scale saves: the TV stays on the slide the presenter chose.
    await act(async () => pending[1](jsonResponse({ runId: "r2", stage: "scale", live: true, updatedAt: "2026-10-27T01:00:02Z" })));
    await onStage("scale");
    expect(screen.getByText(/^2\/\d+$/)).toBeInTheDocument();
    expect(screen.getByText("Run r2")).toBeInTheDocument();
  });

  it("keeps the new run when a stage is clicked while Start run's write is held, against the Supabase store", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-27T01:00:00.000Z"));
      // PostgREST, holding each write until the test lands it, and applying it only when its filter matches.
      let row = { run_id: "r1", stage: "reveal", updated_at: "2026-10-27T01:00:00.000Z" };
      const writes: (() => void)[] = [];
      const database = (async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "PATCH") return new Response(JSON.stringify([row]));
        const patch = JSON.parse(String(init.body));
        const before = new URL(String(url)).searchParams.get("updated_at")!.replace(/^lt\./, "");
        return new Promise<Response>((resolve) =>
          writes.push(() => {
            const applies = Date.parse(row.updated_at) < Date.parse(before);
            if (applies) row = { ...row, ...patch };
            resolve(new Response(JSON.stringify(applies ? [row] : [])));
          }),
        );
      }) as typeof fetch;
      const store = createSupabaseStore({ url: "https://db.example", key: "service" }, database);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { server, posts } = setup({ get: async () => jsonResponse(await store.getControl()) });
      server.post = async (body) => jsonResponse(await store.setControl(body));
      const flush = () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      await flush();
      expect(screen.getByText("Run r1")).toBeInTheDocument();
      vi.setSystemTime(new Date("2026-10-27T01:00:01.000Z"));
      fireEvent.click(screen.getByRole("button", { name: "New run" }));
      fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "r2" } });
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      vi.setSystemTime(new Date("2026-10-27T01:00:02.000Z"));
      fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Try it" }));
      await flush();
      // Try it waits for Start run, so its write can't reach the row first.
      expect(writes).toHaveLength(1);
      expect(posts()).toEqual([{ runId: "r2", stage: "welcome" }]);
      vi.setSystemTime(new Date("2026-10-27T01:00:03.000Z"));
      await act(async () => {
        writes[0]();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(writes).toHaveLength(2);
      await act(async () => {
        writes[1]();
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(row).toMatchObject({ run_id: "r2", stage: "try" });
      expect(screen.getByText("Run r2")).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Stages" }).querySelector('[aria-current="step"]')).toHaveTextContent("Try it");
      expect(screen.queryByText(/The stage did not change/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends Start run once more when a move the TV gave up on reaches the Supabase store first", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-27T01:00:00.000Z"));
      let row = { run_id: "r1", stage: "reveal", updated_at: "2026-10-27T01:00:00.000Z" };
      const writes: (() => void)[] = [];
      const database = (async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "PATCH") return new Response(JSON.stringify([row]));
        const patch = JSON.parse(String(init.body));
        const before = new URL(String(url)).searchParams.get("updated_at")!.replace(/^lt\./, "");
        return new Promise<Response>((resolve) =>
          writes.push(() => {
            const applies = Date.parse(row.updated_at) < Date.parse(before);
            if (applies) row = { ...row, ...patch };
            resolve(new Response(JSON.stringify(applies ? [row] : [])));
          }),
        );
      }) as typeof fetch;
      const store = createSupabaseStore({ url: "https://db.example", key: "service" }, database);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { server, posts } = setup({ get: async () => jsonResponse(await store.getControl()) });
      // The route: a request it has taken, whose handler stalls before it stamps the write until the test
      // lets it on (a cold start, a busy instance). The TV giving up on the request doesn't stop it.
      const taken: (() => void)[] = [];
      server.post = (body, init) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          taken.push(() => void store.setControl(body).then((value) => resolve(jsonResponse(value))));
        });
      const flush = () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      await flush();
      fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
      fireEvent.click(screen.getByRole("button", { name: "New run" }));
      fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "aspen" } });
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      await flush();
      expect(posts()).toEqual([{ stage: "scale" }]);
      // The TV gives up on At scale at 8 s, and Start run goes. Its handler stamps it first; the stalled
      // one wakes after, stamps At scale later, and its write lands first.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS);
      });
      expect(posts()).toEqual([{ stage: "scale" }, { runId: "aspen", stage: "welcome" }]);
      taken[1]();
      await flush();
      vi.setSystemTime(Date.now() + 200);
      taken[0]();
      await flush();
      await act(async () => writes[1]());
      await act(async () => writes[0]());
      await flush();
      expect(row).toMatchObject({ run_id: "r1", stage: "scale" });
      // The store answered Start run with the row, still on r1: the TV sends it once more, and it lands.
      expect(posts()).toEqual([{ stage: "scale" }, { runId: "aspen", stage: "welcome" }, { runId: "aspen", stage: "welcome" }]);
      vi.setSystemTime(Date.now() + 100);
      taken[2]();
      await flush();
      await act(async () => writes[2]());
      await flush();
      expect(row).toMatchObject({ run_id: "aspen", stage: "welcome" });
      expect(screen.getByText("Run aspen")).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Stages" }).querySelector('[aria-current="step"]')).toHaveTextContent("Welcome");
      expect(screen.queryByText(/did not start/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a move the TV gave up on out of the run Start run then started, against the Supabase store", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-27T01:00:00.000Z"));
      let row = { run_id: "rehearsal", stage: "welcome", updated_at: "2026-10-27T01:00:00.000Z" };
      const database = (async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "PATCH") return new Response(JSON.stringify([row]));
        const patch = JSON.parse(String(init.body));
        const query = new URL(String(url)).searchParams;
        const before = query.get("updated_at")!.replace(/^lt\./, "");
        const run = query.get("run_id");
        const applies = Date.parse(row.updated_at) < Date.parse(before) && (run === null || run === `eq.${row.run_id}`);
        if (applies) row = { ...row, ...patch };
        return new Response(JSON.stringify(applies ? [row] : []));
      }) as typeof fetch;
      const store = createSupabaseStore({ url: "https://db.example", key: "service" }, database);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { server, bodies } = setup({ get: async () => jsonResponse(await store.getControl()) });
      // The route: a request whose handler stalls before it stamps the write, until the test lets it on.
      const taken: (() => void)[] = [];
      server.post = (body, init) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          taken.push(() => void store.setControl(body).then((value) => resolve(jsonResponse(value))));
        });
      const flush = () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      await flush();
      fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Try it" }));
      fireEvent.click(screen.getByRole("button", { name: "New run" }));
      fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "live" } });
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS);
      });
      // The TV gave up on Try it and sent Start run, which saves. Then Try it's handler wakes, a second
      // later: its write is stamped after Start run's, but it was made in the rehearsal.
      expect(bodies()).toEqual([
        { stage: "try", inRun: "rehearsal" },
        { runId: "live", stage: "welcome", inRun: "rehearsal" },
      ]);
      taken[1]();
      await flush();
      vi.setSystemTime(Date.now() + 1000);
      taken[0]();
      await flush();
      expect(row).toMatchObject({ run_id: "live", stage: "welcome" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(row).toMatchObject({ run_id: "live", stage: "welcome" });
      expect(screen.getByText("Run live")).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Stages" }).querySelector('[aria-current="step"]')).toHaveTextContent("Welcome");
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the run each move is made in, once it has read one, and the new run once Start run has saved", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { bodies } = setup();
    const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
    // Before its first read the TV knows no run, so the move names none.
    fireEvent.click(nav().getByRole("button", { name: "Try it" }));
    await screen.findByText("Run r1");
    fireEvent.click(nav().getByRole("button", { name: "What we saw" }));
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    fireEvent.click(nav().getByRole("button", { name: "At scale" }));
    await waitFor(() => expect(bodies()).toHaveLength(4));
    expect(bodies()).toEqual([
      { stage: "try" },
      { stage: "reveal", inRun: "r1" },
      { runId: "r2", stage: "welcome", inRun: "r1" },
      { stage: "scale", inRun: "r2" },
    ]);
    await onStage("scale");
    expect(screen.getByText("Run r2")).toBeInTheDocument();
  });

  it("says the stage did not change when the room had moved to a run the TV hadn't heard of yet", async () => {
    const { server, bodies } = setup({ stage: "reveal" });
    await screen.findByText("Run r1");
    // Another screen started r2; the store refuses a move made in r1 and answers with its row.
    server.post = async () => jsonResponse({ runId: "r2", stage: "welcome", live: true, updatedAt: "2026-10-27T01:00:02Z" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    expect(await screen.findByText("The room is on run r2 now, so the stage did not change.")).toBeInTheDocument();
    expect(bodies()).toEqual([{ stage: "scale", inRun: "r1" }]);
    await onStage("welcome");
    expect(screen.getByText("Run r2")).toBeInTheDocument();
  });

  it("says the run did not start when its second try is beaten too, and sends it no third time", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { server, posts } = setup({ stage: "reveal" });
    await screen.findByText("Run r1");
    // Each try is beaten by a stage-only write (another screen's, or one the TV gave up on).
    const beaten = [
      { runId: "r1", stage: "scale", live: true, updatedAt: "2026-10-27T01:00:02Z" },
      { runId: "r1", stage: "try", live: true, updatedAt: "2026-10-27T01:00:04Z" },
    ];
    server.post = async () => jsonResponse(beaten[posts().length - 1]);
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "aspen" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText("Run aspen did not start: the room is on run r1.")).toBeInTheDocument();
    expect(posts()).toEqual([{ runId: "aspen", stage: "welcome" }, { runId: "aspen", stage: "welcome" }]);
    await onStage("try");
    expect(screen.getByText("Run r1")).toBeInTheDocument();
  });

  it("says the run did not start, and doesn't send it again, when another screen's run switch beat it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { server, posts } = setup({ stage: "reveal" });
    await screen.findByText("Run r1");
    server.post = async () => jsonResponse({ runId: "other", stage: "welcome", live: true, updatedAt: "2026-10-27T01:00:02Z" });
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "aspen" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByText("Run aspen did not start: the room is on run other.")).toBeInTheDocument();
    expect(posts()).toEqual([{ runId: "aspen", stage: "welcome" }]);
    expect(screen.getByText("Run other")).toBeInTheDocument();
    await onStage("welcome");
  });

  it("counts a poll that arrives with the last moves' answers before they settle, and goes back to its slide", async () => {
    vi.useFakeTimers();
    try {
      const { server } = setup({ stage: "reveal" });
      const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.getByText("2/2")).toBeInTheDocument();
      const pending: ((r: Response) => void)[] = [];
      server.post = () => new Promise<Response>((resolve) => pending.push(resolve));
      fireEvent.click(nav().getByRole("button", { name: "Small groups" }));
      fireEvent.click(nav().getByRole("button", { name: "At scale" }));
      let poll: (r: Response) => void = () => {};
      server.get = () => new Promise<Response>((resolve) => (poll = resolve));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      // Another screen moved the room back to What we saw after both writes. Its poll, then both
      // answers, arrive before React renders again.
      await act(async () => {
        poll(jsonResponse({ runId: "r1", stage: "reveal", live: true, updatedAt: "2026-10-27T01:00:03Z" }));
        pending[0](jsonResponse({ runId: "r1", stage: "groups", live: true, updatedAt: "2026-10-27T01:00:01Z" }));
        pending[1](jsonResponse({ runId: "r1", stage: "scale", live: true, updatedAt: "2026-10-27T01:00:02Z" }));
      });
      expect(nav().getByRole("button", { current: "step" })).toHaveTextContent("What we saw");
      expect(screen.getByText("2/2")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to a slide chosen while Start run was in flight, in the new run, when a move after it fails", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { server, posts } = setup();
      const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
      const flush = () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      await flush();
      const pending: ((r: Response) => void)[] = [];
      server.post = () => new Promise<Response>((resolve) => pending.push(resolve));
      const row = (runId: string, stage: StageId, second: number) =>
        jsonResponse({ runId, stage, live: true, updatedAt: `2026-10-27T01:00:0${second}Z` });
      fireEvent.click(screen.getByRole("button", { name: "New run" }));
      fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "r2" } });
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      fireEvent.click(nav().getByRole("button", { name: "What we saw" }));
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.getByText("2/2")).toBeInTheDocument();
      fireEvent.click(nav().getByRole("button", { name: "At scale" }));
      // Start run saves, then What we saw, in r2; At scale is refused.
      await act(async () => pending[0](row("r2", "welcome", 1)));
      expect(posts()).toEqual([{ runId: "r2", stage: "welcome" }, { stage: "reveal" }, { stage: "scale" }]);
      await act(async () => pending[1](row("r2", "reveal", 2)));
      await act(async () => pending[2](jsonResponse({ error: "No." }, false)));
      expect(screen.getByText("Run r2")).toBeInTheDocument();
      expect(nav().getByRole("button", { current: "step" })).toHaveTextContent("What we saw");
      expect(screen.getByText("2/2")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to a slide chosen while Start run was in flight, in the old run, when Start run fails", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { server, posts } = setup();
      const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const pending: ((r: Response) => void)[] = [];
      server.post = () => new Promise<Response>((resolve) => pending.push(resolve));
      fireEvent.click(screen.getByRole("button", { name: "New run" }));
      fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "r2" } });
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      fireEvent.click(nav().getByRole("button", { name: "What we saw" }));
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      fireEvent.click(nav().getByRole("button", { name: "At scale" }));
      // Start run is refused; What we saw then saves in r1, and At scale is refused.
      await act(async () => pending[0](jsonResponse({ error: "No." }, false)));
      expect(posts()).toEqual([{ runId: "r2", stage: "welcome" }, { stage: "reveal" }, { stage: "scale" }]);
      await act(async () => pending[1](jsonResponse({ runId: "r1", stage: "reveal", live: true, updatedAt: "2026-10-27T01:00:01Z" })));
      await act(async () => pending[2](jsonResponse({ error: "No." }, false)));
      expect(screen.getByText("Run r1")).toBeInTheDocument();
      expect(nav().getByRole("button", { current: "step" })).toHaveTextContent("What we saw");
      expect(screen.getByText("2/2")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a new run's stage at its first slide, not at the slide it showed there in the old run", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { server } = setup({ stage: "reveal" });
      server.control = { ...server.control, updatedAt: "2026-10-27T01:00:00Z" };
      const flush = () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      await flush();
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.getByText("2/2")).toBeInTheDocument();
      // Start run saves, but its answer is slow; meanwhile another screen moves the new run to What we saw.
      let answer: (r: Response) => void = () => {};
      server.post = (body) => {
        server.control = { ...server.control, ...body, updatedAt: "2026-10-27T01:00:01Z" };
        return new Promise<Response>((resolve) => (answer = resolve));
      };
      fireEvent.click(screen.getByRole("button", { name: "New run" }));
      fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: "r2" } });
      fireEvent.click(screen.getByRole("button", { name: "Start run" }));
      await flush();
      const saved = { ...server.control };
      server.control = { ...server.control, stage: "reveal", updatedAt: "2026-10-27T01:00:02Z" };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      await act(async () => {
        answer(jsonResponse(saved));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Run r2")).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Stages" }).querySelector('[aria-current="step"]')).toHaveTextContent("What we saw");
      expect(screen.getByText("1/2")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the stage the phones read after the clock steps back, with the memory store", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime("2026-10-27T01:00:02Z");
      const store = createMemoryStore();
      await store.setControl({ stage: "try" });
      const { server } = setup({ get: async () => jsonResponse(await store.getControl()) });
      server.post = async (body) => jsonResponse(await store.setControl(body));
      const shown = () => screen.getByRole("navigation", { name: "Stages" }).querySelector('[aria-current="step"]')?.textContent;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(shown()).toBe("Try it");
      vi.setSystemTime("2026-10-27T01:00:01Z");
      fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
      // Two polls later, past the route's two-second cache, the TV still shows what the store holds.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(await store.getControl()).toMatchObject({ stage: "scale" });
      expect(shown()).toBe("At scale");
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to the slide it left when a stage button's move fails, even after the arrows stepped on", async () => {
    const { server } = setup({ stage: "reveal" });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
    let refuse: () => void = () => {};
    server.post = () => new Promise<Response>((resolve) => (refuse = () => resolve(jsonResponse({ error: "No." }, false))));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    await onStage("scale");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/7");
    await act(async () => refuse());
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
  });

  it.each([
    ["the newer", [1, 0]],
    ["the older", [0, 1]],
  ])("goes back to the slide it was on before two moves that both failed, %s failing first", async (_, order) => {
    const { server } = setup({ stage: "groups" });
    await onStage("groups");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
    const refusals: (() => void)[] = [];
    server.post = () => new Promise<Response>((resolve) => refusals.push(() => resolve(jsonResponse({ error: "No." }, false))));
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("next");
    // Next steps is two slides: the arrows step through them before moving the room again.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("dinner");
    // Whichever fails first, the other is still in flight, so the TV stays on the newer's stage.
    await act(async () => refusals[order[0]]());
    await onStage("dinner");
    await act(async () => refusals[order[1]]());
    await onStage("groups");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
  });

  it("keeps the slide the presenter chose when the moves fail on the stage still on screen", async () => {
    const { server } = setup({ stage: "reveal" });
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("1/2");
    const refusals: (() => void)[] = [];
    server.post = () => new Promise<Response>((resolve) => refusals.push(() => resolve(jsonResponse({ error: "No." }, false))));
    const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
    fireEvent.click(nav().getByRole("button", { name: "At scale" }));
    await onStage("scale");
    fireEvent.click(nav().getByRole("button", { name: "What we saw" }));
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("1/2");
    // Back on What we saw while both moves are in flight, the presenter steps to its second slide...
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
    // ...and when both fail, the store's stage is the one on screen, so the slide stays where they put it.
    await act(async () => refusals.forEach((refuse) => refuse()));
    expect(await screen.findByText("No.")).toBeInTheDocument();
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
  });

  it("goes back to the slide it last showed on the stage the store ends on, when a later move fails", async () => {
    const { server } = setup({ stage: "scale" });
    await onStage("scale");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("1/7");
    const answers: ((r: Response) => void)[] = [];
    server.post = () => new Promise<Response>((resolve) => answers.push(resolve));
    // Back to What we saw, which opens on its last slide...
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
    // ...then on to At scale by its button, while that move is still in flight.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "At scale" }));
    await onStage("scale");
    // The first saves and the second is refused: the store holds What we saw, and the TV goes back to the
    // slide it last showed there, not to the one it showed before the moves began.
    server.control = { runId: "r1", stage: "reveal", live: true, updatedAt: "2026-10-27T00:31:00Z" };
    await act(async () => answers[0](jsonResponse(server.control)));
    await act(async () => answers[1](jsonResponse({ error: "No." }, false)));
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
  });

  it("goes back to the slide it showed last on a stage the moves left more than once", async () => {
    const { server } = setup({ stage: "reveal" });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const refusals: (() => void)[] = [];
    server.post = () => new Promise<Response>((resolve) => refusals.push(() => resolve(jsonResponse({ error: "No." }, false))));
    const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
    // Away from What we saw at 2/2, back to it by its button (so at 1/2), and away again: all in flight.
    fireEvent.click(nav().getByRole("button", { name: "At scale" }));
    await onStage("scale");
    fireEvent.click(nav().getByRole("button", { name: "What we saw" }));
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("1/2");
    fireEvent.click(nav().getByRole("button", { name: "At scale" }));
    await onStage("scale");
    await act(async () => refusals.forEach((refuse) => refuse()));
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("1/2");
  });

  it("opens on its first slide a stage another screen moved the room to while a move was in flight", async () => {
    const { server, fetchMock } = setup({ stage: "reveal" });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByLabelText("Slide")).toHaveTextContent("2/2");
    // Off What we saw at 2/2, saved; that slide is from a move that settled, so it is forgotten.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Small groups" }));
    await onStage("groups");
    await act(async () => {});
    let refuse: () => void = () => {};
    server.post = () => new Promise<Response>((resolve) => (refuse = () => resolve(jsonResponse({ error: "No." }, false))));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: "Next steps" }));
    await onStage("next");
    // Meanwhile another screen moves the room back to What we saw, and a poll brings that newer row.
    server.control = { runId: "r1", stage: "reveal", live: true, updatedAt: "2026-10-27T00:40:00Z" };
    const polls = () => fetchMock.mock.calls.filter(([url, init]) => url === "/api/aspen/state" && !init?.method).length;
    const seen = polls();
    await waitFor(() => expect(polls()).toBeGreaterThan(seen + 1), { timeout: 8000 });
    await onStage("next");
    await act(async () => refuse());
    await onStage("reveal");
    expect(screen.getByLabelText("Slide")).toHaveTextContent("1/2");
  }, 15_000);

  it("ends where the phones are when two moves' writes reach the store in either order", async () => {
    // The real Supabase store over a PostgREST that holds each write until the test lets it land, and
    // applies it only where its filter matches, as PostgREST does.
    const dbResponse = (rows: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows) }) as unknown as Response;
    const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
    for (const order of [
      [1, 0],
      [0, 1],
    ]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-27T00:30:00.000Z"));
      let row = { run_id: "r1", stage: "welcome", updated_at: "2026-10-27T00:30:00.000Z" };
      const writes: (() => void)[] = [];
      const database = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "PATCH") return dbResponse([row]);
        const patch = JSON.parse(String(init.body));
        const older = new URL(String(url)).searchParams.get("updated_at")?.replace(/^lt\./, "");
        return new Promise<Response>((resolve) =>
          writes.push(() => {
            const matches = older === undefined || row.updated_at < older;
            if (matches) row = { ...row, ...patch };
            resolve(dbResponse(matches ? [row] : []));
          }),
        );
      });
      const store = createSupabaseStore({ url: "https://db.example", key: "service" }, database as unknown as typeof fetch);
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).startsWith("/api/aspen/results")) return jsonResponse({ runId: "r1", live: true, summary: EMPTY_SUMMARY });
          if (init?.method === "POST") return jsonResponse(await store.setControl(JSON.parse(String(init.body))));
          return jsonResponse(await store.getControl());
        }),
      );
      const view = render(<PresenterApp joinPassword={null} />);
      try {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        vi.setSystemTime(new Date("2026-10-27T00:30:01.000Z"));
        fireEvent.click(nav().getByRole("button", { name: "Try it" }));
        vi.setSystemTime(new Date("2026-10-27T00:30:02.000Z"));
        fireEvent.click(nav().getByRole("button", { name: "At scale" }));
        expect(writes).toHaveLength(2);
        for (const i of order) {
          await act(async () => {
            writes[i]();
            await vi.advanceTimersByTimeAsync(0);
          });
        }
        // The later press holds the row, whichever write landed last, and the TV shows it, now and after
        // the room's polls.
        expect(row.stage).toBe("scale");
        const current = () => nav().getByRole("button", { current: "step" }).textContent;
        expect(current()).toBe("At scale");
        await act(async () => {
          await vi.advanceTimersByTimeAsync(9000);
        });
        expect(current()).toBe("At scale");
      } finally {
        view.unmount();
        vi.useRealTimers();
      }
    }
  });

  it("while two moves are in flight, shows the newer; once both settle, the newest row the store answered with", async () => {
    const { server } = setup();
    await screen.findByText("Run r1");
    const nav = () => within(screen.getByRole("navigation", { name: "Stages" }));
    let pending: { body: Partial<Control>; resolve: (r: Response) => void; reject: (e: Error) => void }[] = [];
    server.post = (body) => new Promise<Response>((resolve, reject) => pending.push({ body, resolve, reject }));
    const control = (stage: StageId, second: number): Control => ({ runId: "r1", stage, live: true, updatedAt: `2026-10-27T00:31:0${second}Z` });
    const row = (stage: StageId, second: number) => jsonResponse(control(stage, second));

    // The first saves while the second is still in flight: the TV stays on the second, the newest move.
    // (The room's polls, meanwhile, read what the store will hold once both land.)
    server.control = control("try", 1);
    fireEvent.click(nav().getByRole("button", { name: "Try it" }));
    fireEvent.click(nav().getByRole("button", { name: "At scale" }));
    await onStage("scale");
    await act(async () => pending[0].resolve(row("try", 1)));
    await onStage("scale");
    // The second fails: the TV shows what the store holds, the first move's row.
    await act(async () => pending[1].reject(new Error("offline")));
    await onStage("try");
    expect(screen.getByText("The stage did not change. Check the connection.")).toBeInTheDocument();

    // Both save, but the older move's write reached the store last (a later stamp): that is what the
    // phones get, so the TV ends there too.
    pending = [];
    server.control = control("reveal", 3);
    fireEvent.click(nav().getByRole("button", { name: "What we saw" }));
    fireEvent.click(nav().getByRole("button", { name: "Small groups" }));
    await onStage("groups");
    await act(async () => pending[1].resolve(row("groups", 2)));
    await onStage("groups");
    expect(screen.queryByText(/The stage did not change/)).not.toBeInTheDocument();
    await act(async () => pending[0].resolve(row("reveal", 3)));
    await onStage("reveal");

    // And when the newer move's write is the later one, the TV keeps it, whichever answer lands last.
    pending = [];
    server.control = control("dinner", 5);
    fireEvent.click(nav().getByRole("button", { name: "Next steps" }));
    fireEvent.click(nav().getByRole("button", { name: "Thank you" }));
    await act(async () => pending[1].resolve(row("dinner", 5)));
    await act(async () => pending[0].resolve(row("next", 4)));
    await onStage("dinner");
  });

  it("gives up on a move that hangs, puts the TV back, and lets the room's polls through again", async () => {
    vi.useFakeTimers();
    try {
      const { server } = setup();
      const shown = () =>
        screen.getByRole("navigation", { name: "Stages" }).querySelector('[aria-current="step"]')?.textContent;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Run r1")).toBeInTheDocument();
      let signal: AbortSignal | undefined;
      server.post = (_body, init) =>
        new Promise<Response>((_, reject) => {
          // Like fetch on a stalled connection: it ends only when aborted.
          signal = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(shown()).toBe("Try it");
      // Polls keep coming while the move hangs; the store still says Welcome, but the move holds the TV.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS - 1);
      });
      expect(shown()).toBe("Try it");
      expect(signal?.aborted).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(signal?.aborted).toBe(true);
      expect(shown()).toBe("Welcome");
      expect(screen.getByText("The stage did not change. Check the connection.")).toBeInTheDocument();
      // The TV follows the room again: another screen moved it.
      server.control = { runId: "r1", stage: "reveal", live: true, updatedAt: "2026-10-27T00:40:00Z" };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(shown()).toBe("What we saw");
    } finally {
      vi.useRealTimers();
    }
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
    expect(screen.getByText("1/7")).toBeInTheDocument();

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
    await waitFor(() => expect(screen.getByText("1/7")).toBeInTheDocument(), { timeout: 12_000 });
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
    // The statement waits for the last build of the rules, 5/7, under the one set of rules.
    expect(screen.queryByText(/reducing cost, duplication and error at once/)).not.toBeInTheDocument();
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText(/reducing cost, duplication and error at once/)).not.toHaveClass("invisible");
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

  it("asks the shared foundation's question, builds in the room's answer, then shows the rules and plays the journey", async () => {
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
    const question = STAGES.find((st) => st.id === "foundation")!.title;
    // 1/7: the question on its own, as the slide's only heading (Oct 26).
    expect(screen.getByText("1/7")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: question })).toBeInTheDocument();
    // "all" stands out in bold rust.
    expect(within(screen.getByRole("heading", { level: 1 })).getByText("all").tagName).toBe("STRONG");
    expect(within(screen.getByRole("heading", { level: 1 })).getByText("all")).toHaveClass("text-[var(--color-accent)]");
    expect(screen.queryByText(/In this room/)).not.toBeInTheDocument();
    expect(screen.queryByText("One open set of rules")).not.toBeInTheDocument();
    expect(screen.queryByText(/Next: how we build it/)).not.toBeInTheDocument();

    // 2/7: the same question, with the room's answer building in below it.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/7")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: question })).toBeInTheDocument();
    // About whether a resident, screener or AI can check, as the question asked; not about the people in the room.
    await waitFor(() =>
      expect(screen.getByText(/In this room/)).toHaveTextContent("In this room, 5 of 6 say a resident, screener or AI can't fully check"),
    );
    expect(screen.getByText(/In this room/)).toHaveClass("aspen-build");
    // With the answers in, 1/7 still holds the question alone.
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(screen.getByText("1/7")).toBeInTheDocument();
    expect(screen.queryByText(/In this room/)).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText(/In this room/)).toBeInTheDocument();

    // 3/7 to 5/7: one open set of rules, then what it powers, built one group at a time (Oct 26):
    // not only AI tools, but government tools and navigation tools too.
    const [ai, government, navigation] = ONE_SET_GROUPS;
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("3/7")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText("One open set of rules")).toBeInTheDocument();
    expect(screen.getByText(ai.label).closest("li")).toHaveClass("aspen-build");
    expect(screen.queryByText(government.label)).not.toBeInTheDocument();
    expect(screen.queryByText(navigation.label)).not.toBeInTheDocument();
    // The statement holds its place, hidden, until the last build.
    expect(screen.getByText(/reducing cost, duplication and error at once/).closest("p")).toHaveClass("invisible");
    expect(screen.queryByText(/In this room/)).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("4/7")).toBeInTheDocument();
    expect(screen.getByText(ai.label).closest("li")).not.toHaveClass("aspen-build");
    expect(screen.getByText(government.label).closest("li")).toHaveClass("aspen-build");
    expect(screen.queryByText(navigation.label)).not.toBeInTheDocument();
    expect(screen.getByText(/reducing cost, duplication and error at once/).closest("p")).toHaveClass("invisible");

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("5/7")).toBeInTheDocument();
    for (const g of ONE_SET_GROUPS) expect(screen.getByText(g.detail)).toBeInTheDocument();
    expect(screen.getByText(navigation.label).closest("li")).toHaveClass("aspen-build");
    expect(screen.getByText(/reducing cost, duplication and error at once/).closest("p")).not.toHaveClass("invisible");
    // The one set of rules sits in an open box, never a dark one (Oct 26).
    expect(document.querySelector('[data-testid="slide"] .bg-\\[var\\(--color-ink\\)\\]')).toBeNull();
    expect(screen.getByText("One open set of rules").parentElement).toHaveClass("bg-[var(--color-accent-light)]");
    expect(screen.queryByText(/Next: how we build it/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: SAME_RULES.heading })).not.toBeInTheDocument();

    // The homepage's journey plays over the slide; Space pauses it instead of moving on.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("6/7")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "From the law as written to running code" })).toBeInTheDocument();
    const stage = document.querySelector("[data-aspen-overlay] .jl-stage");
    expect(stage).not.toBeNull();
    expect(within(stage as HTMLElement).getByRole("img", { name: STORY_LABEL })).toBeInTheDocument();
    for (const c of CAPTIONS) expect(within(stage as HTMLElement).getByText(c.title)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: " " });
    expect(screen.getByText("6/7")).toBeInTheDocument();
    expect(screen.getByText("Paused: Space plays on")).toBeInTheDocument();

    // After the journey, what the rules enable: governments alone, then a prompt into Small groups (Oct 26).
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("7/7")).toBeInTheDocument();
    expect(document.querySelector(".jl-stage")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "What does one set of open rules enable for governments?" })).toBeInTheDocument();
    // The heading names governments, so the boxes carry no label and no ticks.
    expect(screen.queryByText(SAME_RULES.governments.label)).not.toBeInTheDocument();
    for (const use of SAME_RULES.governments.uses) expect(screen.getByText(use).querySelector("svg")).toBeNull();
    for (const a of SAME_RULES.audiences) expect(screen.queryByText(a.label)).not.toBeInTheDocument();
    // The cross-references read as words, in boxes; no graph and no dark box (Oct 26).
    expect(screen.queryByText("How the rules cross-reference")).not.toBeInTheDocument();
    expect(screen.getByText(/TANF to SNAP, SSI to Medicaid, SNAP to school meals and WIC/)).toBeInTheDocument();
    expect(document.querySelector('[data-testid="slide"] .bg-\\[var\\(--color-ink\\)\\]')).toBeNull();
    expect(screen.getByText(SAME_RULES.prompt)).toBeInTheDocument();
    // The tiers wait for Next steps, after the room's own ideas.
    expect(screen.queryByRole("heading", { level: 1, name: BUILD_HEADING })).not.toBeInTheDocument();

    // What it enables is the stage's last slide: the next moves the room on to Small groups.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("groups");
  });

  it("leaves out the room's answer on the shared foundation when nobody gave one", async () => {
    setup({ stage: "foundation", summary: EMPTY_SUMMARY });
    await onStage("foundation");
    expect(screen.queryByText(/In this room/)).not.toBeInTheDocument();
    // 2/7 is the question alone until anyone answers.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/7")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: STAGES.find((st) => st.id === "foundation")!.title })).toBeInTheDocument();
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

  it("opens next steps on how the rules get built, then the ask and the form, without the Silver A ask (Oct 26)", async () => {
    const { posts } = setup({ stage: "next" });
    await onStage("next");
    // 1/2: the tiers, from screener parity to Gold A, after the room's own ideas in Small groups.
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: BUILD_HEADING })).toBeInTheDocument();
    for (const tier of GOLDEN_A) expect(screen.getByText(tier.name)).toBeInTheDocument();
    expect(screen.getByText("Rules from public documents")).toBeInTheDocument();
    expect(screen.queryByText(NEXT_STEPS.ask)).not.toBeInTheDocument();
    expect(screen.queryByText("Tell us if your state wants to go further.")).not.toBeInTheDocument();

    // 2/2: the ask and the form.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText(NEXT_STEPS.ask)).toBeInTheDocument();
    for (const o of NEXT_STEPS.options) expect(screen.getByText(o.label)).toBeInTheDocument();
    // The Silver A ask, deleted with its slide, never comes back.
    expect(screen.queryByText("Validate and open rules with us")).not.toBeInTheDocument();
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
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
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

describe("newerControl", () => {
  const stamp = fc.option(
    fc.integer({ min: 0, max: 59 }).map((n) => `2026-10-27T00:${String(n).padStart(2, "0")}:00Z`),
    { nil: null },
  );
  const row = fc.record({
    runId: fc.constantFrom("rehearsal", "phoenix"),
    stage: fc.constantFrom(...STAGES.map((s) => s.id)),
    live: fc.boolean(),
    updatedAt: stamp,
  });
  /** The order newerControl keeps: live over not live, then the later stamp, a missing one first. */
  const rank = (c: Control) => `${c.live ? 1 : 0}|${c.updatedAt ?? ""}`;

  it("keeps one of the two: the answer unless the held row is newer, and the answer on a tie", () => {
    fc.assert(
      fc.property(fc.option(row, { nil: null }), row, (held, answer) => {
        const kept = newerControl(held, answer);
        expect([held, answer]).toContain(kept);
        if (!held) expect(kept).toBe(answer);
        else expect(kept).toBe(rank(answer) < rank(held) ? held : answer);
        // A live room never takes a not-live answer (a failed store read), and never goes back in time.
        if (held?.live) expect(kept.live).toBe(true);
        if (held?.live && answer.live && held.updatedAt && answer.updatedAt) {
          expect(kept.updatedAt).toBe(held.updatedAt > answer.updatedAt ? held.updatedAt : answer.updatedAt);
        }
        expect(newerControl(kept, kept)).toBe(kept);
      }),
    );
  });

  it("ends on the same, newest row whatever order the store's answers land in", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(row, { selector: rank, minLength: 1, maxLength: 8 })
          .chain((rows) => fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }))),
        ([rows, shuffled]) => {
          const fold = (list: Control[]) => list.reduce<Control | null>((held, c) => newerControl(held, c), null);
          const newest = [...rows].sort((a, b) => (rank(a) < rank(b) ? -1 : 1)).at(-1);
          expect(fold(rows)).toBe(newest);
          expect(fold(shuffled)).toBe(newest);
        },
      ),
    );
  });
});

describe("PresenterApp moves, for any order of outcomes", () => {
  // The stages a test moves between; Shared foundation loads the journey's three.js chunk, so it sits out.
  const TARGETS = STAGES.filter((s) => s.id !== "foundation");
  type Outcome = "saved" | "slow" | "refused" | "dropped" | "lost";
  const outcome = fc.constantFrom<Outcome>("saved", "slow", "refused", "dropped", "lost");
  // Weighted toward the arrows and settling, which reach the slides a failed move must put back.
  const command = fc.oneof(
    { weight: 2, arbitrary: fc.record({ kind: fc.constant("move" as const), to: fc.integer({ min: 0, max: TARGETS.length - 1 }) }) },
    { weight: 3, arbitrary: fc.record({ kind: fc.constant("arrow" as const), delta: fc.constantFrom(-1, 1) }) },
    { weight: 3, arbitrary: fc.record({ kind: fc.constant("settle" as const), pick: fc.nat(), outcome }) },
    // A poll may read a row the store held before: an instance's two-second cache, or a read that
    // started before a write landed.
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("poll" as const), stale: fc.option(fc.nat(), { nil: null }) }) },
    // Another presenter screen moves the room, or starts a run: a write the TV did not make, stamped after
    // every move so far.
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant("other" as const), to: fc.integer({ min: 0, max: TARGETS.length - 1 }), run: fc.boolean() }),
    },
    // Start run: a new run, and the room to Welcome.
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("run" as const) }) },
    // A move the TV gave up on reaches the store after all: with the stamp the server gave it when the TV
    // sent it, or, if the server stalled before stamping it, with one from now.
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("ghost" as const), pick: fc.nat(), stalled: fc.boolean() }) },
  );

  /**
   * Invariants, for any sequence of stage buttons, arrows, Start runs, moves from another screen and
   * polls of the room (some reading a row the store held before), the first read landing at once or
   * only after the moves have begun, and any order and mix of outcomes (saved; saved with its answer
   * coming later, after newer rows; refused; dropped before the store; saved but its answer lost; timed
   * out, after three polls, and then maybe reaching the store anyway, stamped when it was sent or later),
   * each write stamped when the server takes it and landing in any order, and the store keeping a write,
   * whole, only over an older row and only in the run it names (store.ts setControl):
   * 1. while any move is in flight, the TV shows the newest move's stage, whatever the polls say, and
   *    whether or not it has read the room yet;
   * 2. once none is, it shows the newest row the store answered with, never a stage no write saved (or
   *    Welcome, if the store has answered with none);
   * 3. one poll later, it shows what the store holds, which is what the phones show;
   * 4. when the last move settles, the TV keeps its slide if the store's stage is the one on screen;
   *    otherwise it shows the slide it last showed on that stage as the moves left it, if it showed it in
   *    the run the store ends on (or before it had read any run, or while the run switch that started that
   *    run was in flight), or else the stage's first;
   * 5. a stage button shows its stage from the first slide (its own stage's button changes nothing),
   *    and so does a poll that brings another stage while no move is in flight; a poll that leaves the
   *    stage leaves the slide;
   * 6. no write crosses a run switch: Start run is sent only when no other move is in flight, and no
   *    move is sent while it is; each move names the run the TV made it in, the newest row's, once it has
   *    read one, so a move it gave up on can't land in a run started after it; and a run switch the store
   *    refuses is one that another screen's write, or a move the TV gave up on, beat;
   * 7. the run on screen is always the newest row's the store answered with, moves in flight or not
   *    (none before the first answer);
   * 8. a run switch the store answers with a row still on the run it left is sent once more, and only
   *    once; one that doesn't start, after that or because another run beat it, says so, naming the run
   *    on screen.
   */
  it("shows the newest move in flight, then the store's newest answer, then the store", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.useFakeTimers();
    const flush = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    const shown = () =>
      STAGES.find(
        (s) => s.label === screen.getByRole("navigation", { name: "Stages" }).querySelector('[aria-current="step"]')?.textContent,
      )?.id;
    // What the TV shows: the stage, and "k/n" on a stage of more than one slide.
    const view = () => ({ stage: shown(), slide: screen.queryByLabelText("Slide")?.textContent ?? null });
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...TARGETS.map((s) => s.id)),
          fc.array(command, { minLength: 1, maxLength: 14 }),
          fc.array(outcome, { minLength: 42, maxLength: 42 }),
          // Whether the TV's first read of the room lands only at the first poll, after the moves before it.
          fc.boolean(),
          async (first, commands, finals, late) => {
          let clock = 0;
          const at = () => `2026-10-27T01:00:${String(clock).padStart(2, "0")}Z`;
          // The store, and every row it answered the TV with (polls, and moves whether or not they won).
          let store: Control = { runId: "r1", stage: first, live: true, updatedAt: at() };
          const answered: Control[] = late ? [] : [store];
          // The newest row the store has answered with, or none yet.
          const newestAnswered = (): Control | undefined =>
            answered.length === 0 ? undefined : answered.reduce((a, b) => ((b.updatedAt ?? "") >= (a.updatedAt ?? "") ? b : a));
          // Every row the store has held, and the one the next poll reads instead of the store's, if any.
          const held: Control[] = [store];
          let stale: number | null = null;
          // The first read, while the test holds it.
          let firstRead: (() => void) | null = null;
          let reads = 0;
          type Sent = {
            stage: StageId;
            runId?: string;
            stamp: string;
            beaten: boolean;
            // A slow move's answer, once its write has landed: the row as it was then.
            answer?: Control;
            // The run the TV showed when it sent the move, which the move names (6), and, for a run switch,
            // whether it is the second try (8).
            from: string | null;
            inRun?: string;
            retry: boolean;
            resolve: (r: Response) => void;
            reject: (e: Error) => void;
          };
          const pending: Sent[] = [];
          // Moves the TV gave up on that haven't reached the store, and may yet.
          const ghosts: Sent[] = [];
          // The run switch the TV should send once more, until it does (8).
          let retrying: Sent | null = null;
          // Moves the TV has made, and those settled: some wait to be sent (6).
          let made = 0;
          let done = 0;
          const inFlight = () => made - done;
          let runs = 0;
          const crossed: string[] = [];
          // Moves that named another run than the one the TV showed when it sent them (6).
          const misnamed: string[] = [];
          // Whether the store takes a write: only over an older row, and only in the run it names.
          const takes = (move: Sent, stamp: string) => (store.updatedAt ?? "") < stamp && (!move.inRun || move.inRun === store.runId);
          let newestMove: StageId | null = null;
          // While moves are in flight, the slide the TV last showed on each stage they left, and the run it
          // showed it in: the run of the newest row the store had answered with, if any, and the run a run
          // switch in flight then starts, if any (4).
          const left = new Map<string | undefined, { run: string | null; next: string | null; slide: string | null }>();
          let switchingTo: string | null = null;
          vi.stubGlobal(
            "fetch",
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
              const url = String(input);
              if (url.startsWith("/api/aspen/results")) return jsonResponse({ runId: "r1", live: true, summary: EMPTY_SUMMARY });
              if (init?.method === "POST") {
                const { stage, runId, inRun } = JSON.parse(String(init.body)) as { stage: StageId; runId?: string; inRun?: string };
                if (runId ? pending.length > 0 : pending.some((p) => p.runId)) crossed.push(runId ?? stage);
                // The server stamps the write when it takes it; when the write lands is up to the test.
                clock += 1;
                const retry = retrying !== null && runId === retrying.runId;
                if (retry) retrying = null;
                const from = newestAnswered()?.runId ?? null;
                if ((inRun ?? null) !== from) misnamed.push(`${runId ?? stage} in ${inRun}, not ${from}`);
                return new Promise<Response>((resolve, reject) => {
                  const move: Sent = { stage, runId, stamp: at(), beaten: false, from, inRun, retry, resolve, reject };
                  pending.push(move);
                  // Like fetch, a move the timeout aborts fails; the server may still take it (ghost).
                  init.signal?.addEventListener("abort", () => {
                    if (pending.includes(move)) {
                      pending.splice(pending.indexOf(move), 1);
                      done += 1;
                      if (move.runId !== undefined && move.runId === switchingTo) switchingTo = null;
                      if (!move.answer) ghosts.push(move);
                    }
                    reject(new Error("aborted"));
                  });
                });
              }
              const row = stale === null ? store : held[stale % held.length];
              reads += 1;
              if (late && reads === 1) {
                return new Promise<Response>((resolve) => {
                  firstRead = () => {
                    answered.push(row);
                    resolve(jsonResponse(row));
                  };
                });
              }
              answered.push(row);
              return jsonResponse(row);
            }),
          );
          const page = render(<PresenterApp joinPassword={null} />);
          // The held first read lands, and its answer reaches the TV, before the clock moves on.
          const landFirstRead = () => {
            firstRead?.();
            firstRead = null;
          };
          try {
            await flush();
            expect(shown()).toBe(late ? "welcome" : first);
            const leave = (at: { stage: StageId | undefined; slide: string | null }) =>
              left.set(at.stage, { run: newestAnswered()?.runId ?? null, next: switchingTo, slide: at.slide });
            const check = () => {
              expect(crossed).toEqual([]);
              expect(misnamed).toEqual([]);
              expect(screen.getByText(`Run ${newestAnswered()?.runId ?? "…"}`)).toBeInTheDocument();
              if (inFlight() > 0) expect(shown()).toBe(newestMove);
              else expect(shown()).toBe(newestAnswered()?.stage ?? "welcome");
            };
            const settle = async (index: number, how: Outcome) => {
              const onScreen = view();
              const [move] = pending.splice(index, 1);
              // The row the store answers the TV with, if the answer reaches it.
              let answer: Control | null = null;
              if (move.answer) {
                // A slow move's answer arrives at last, with the row as it was when its write landed:
                // polls and other answers may have brought newer rows since.
                answer = move.answer;
              } else {
                // A write lands, whole, only over an older row; either way the store answers with its row.
                if (how === "saved" || how === "slow" || how === "lost") {
                  if (takes(move, move.stamp)) {
                    store = { ...store, stage: move.stage, ...(move.runId ? { runId: move.runId } : {}), updatedAt: move.stamp };
                    held.push(store);
                  } else if (move.runId) {
                    // Refused: beaten by a write the TV wasn't waiting on, or the room left the run the switch
                    // named for one the TV hadn't heard of (a switch of its own whose answer was lost).
                    expect(move.beaten || (move.inRun !== undefined && move.inRun !== store.runId)).toBe(true);
                  }
                }
                if (how === "slow") {
                  // Its answer comes at a later settle, still in flight until then.
                  move.answer = store;
                  pending.splice(index, 0, move);
                  return;
                }
                if (how === "saved") answer = store;
              }
              // A run switch answered with a row still on the run it left goes once more, the first time (8).
              const missed = answer !== null && move.runId !== undefined && answer.runId !== move.runId;
              const again = missed && !move.retry && move.from !== null && answer!.runId === move.from;
              if (again) retrying = move;
              else {
                done += 1;
                if (move.runId !== undefined && move.runId === switchingTo) switchingTo = null;
              }
              if (answer) {
                answered.push(answer);
                move.resolve(jsonResponse(answer));
              } else if (how === "refused") move.resolve(jsonResponse({ error: "No." }, false));
              else move.reject(new Error(how));
              await flush();
              if (again) expect(retrying).toBeNull();
              else if (missed && newestAnswered()!.runId !== move.runId) {
                expect(screen.getByText(`Run ${move.runId} did not start: the room is on run ${newestAnswered()!.runId}.`)).toBeInTheDocument();
              } else if (answer && !move.runId && move.inRun && answer.runId !== move.inRun) {
                expect(screen.getByText(`The room is on run ${newestAnswered()!.runId} now, so the stage did not change.`)).toBeInTheDocument();
              }
              if (inFlight() === 0) {
                const row = newestAnswered();
                const landed = row?.stage ?? "welcome";
                const last = left.get(landed);
                const now = view();
                if (landed === onScreen.stage) expect(now.slide).toBe(onScreen.slide);
                else if (last && (last.run === null || last.run === row?.runId || last.next === row?.runId)) expect(now.slide).toBe(last.slide);
                else expect(now.slide ?? "1/").toMatch(/^1\//);
                left.clear();
              }
            };
            for (const c of commands) {
              if (c.kind === "move") {
                const before = view();
                leave(before);
                newestMove = TARGETS[c.to].id;
                made += 1;
                fireEvent.click(within(screen.getByRole("navigation", { name: "Stages" })).getByRole("button", { name: TARGETS[c.to].label }));
                await flush();
                if (newestMove !== before.stage) expect(view().slide ?? "1/").toMatch(/^1\//);
                else expect(view()).toEqual(before);
              } else if (c.kind === "arrow") {
                const before = view();
                const [k, n] = (before.slide ?? "1/1").split("/").map(Number);
                const crosses = c.delta > 0 ? k === n : k === 1;
                const next = STAGES[STAGES.findIndex((s) => s.id === before.stage) + c.delta];
                // Past the first or last stage the arrows do nothing; into Shared foundation, the journey loads.
                if (crosses && (!next || next.id === "foundation")) continue;
                if (crosses) {
                  leave(before);
                  newestMove = next.id;
                  made += 1;
                }
                fireEvent.keyDown(document.body, { key: c.delta > 0 ? "ArrowRight" : "ArrowLeft" });
                await flush();
                if (!crosses) expect(view()).toEqual({ stage: before.stage, slide: `${k + c.delta}/${n}` });
              } else if (c.kind === "run") {
                const before = view();
                leave(before);
                newestMove = "welcome";
                made += 1;
                runs += 1;
                switchingTo = `run${runs}`;
                fireEvent.click(screen.getByRole("button", { name: "New run" }));
                fireEvent.change(screen.getByRole("textbox", { name: "New run name" }), { target: { value: `run${runs}` } });
                fireEvent.click(screen.getByRole("button", { name: "Start run" }));
                await flush();
                expect(view()).toEqual({ stage: "welcome", slide: null });
              } else if (c.kind === "ghost") {
                if (ghosts.length === 0) continue;
                const [ghost] = ghosts.splice(c.pick % ghosts.length, 1);
                if (c.stalled) clock += 1;
                const stamp = c.stalled ? at() : ghost.stamp;
                if (takes(ghost, stamp)) {
                  // A run switch beats every move in flight: they name the run it left.
                  for (const p of pending) if (p.stamp < stamp || (ghost.runId && ghost.runId !== store.runId)) p.beaten = true;
                  store = { ...store, stage: ghost.stage, ...(ghost.runId ? { runId: ghost.runId } : {}), updatedAt: stamp };
                  held.push(store);
                }
              } else if (c.kind === "other") {
                clock += 1;
                store = c.run
                  ? { ...store, runId: `other${clock}`, stage: "welcome", updatedAt: at() }
                  : { ...store, stage: TARGETS[c.to].id, updatedAt: at() };
                held.push(store);
                for (const p of pending) p.beaten = true;
              } else if (c.kind === "poll") {
                const before = view();
                const quiet = inFlight() === 0;
                const unread = answered.length === 0;
                stale = c.stale;
                await act(async () => {
                  landFirstRead();
                  await vi.advanceTimersByTimeAsync(3000);
                });
                stale = null;
                // Moves the timeout gave up on leave the TV where the store's answers put it.
                if (inFlight() === 0) left.clear();
                if (quiet && !unread && view().stage !== before.stage) expect(view().slide ?? "1/").toMatch(/^1\//);
                else if (quiet && !unread) expect(view()).toEqual(before);
              } else if (pending.length > 0) {
                await settle(c.pick % pending.length, c.outcome);
              }
              check();
            }
            for (const how of finals) {
              if (pending.length === 0) break;
              await settle(0, how);
              check();
            }
            expect(inFlight()).toBe(0);
            // The next poll brings the store's row, so the TV agrees with the phones.
            await act(async () => {
              landFirstRead();
              await vi.advanceTimersByTimeAsync(3000);
            });
            expect(shown()).toBe(store.stage);
            expect(screen.getByText(`Run ${store.runId}`)).toBeInTheDocument();
          } finally {
            page.unmount();
          }
          },
        ),
        { numRuns: 200 },
      );
    } finally {
      vi.useRealTimers();
    }
    // About 15 s on a quiet machine; on a shared, loaded host it has taken over 120 s (the reviews of #376).
  }, 600_000);
});
