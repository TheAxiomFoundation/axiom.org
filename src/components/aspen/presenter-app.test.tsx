import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BREAKOUT_PROMPT,
  GROUP_QUESTIONS,
  DISCUSSION_QUESTIONS,
  EVENT,
  GOLDEN_A,
  AZ_HOUSEHOLD,
  AZ_SCENARIO_REVIEW,
  BUILD_HEADING,
  FRONT_DOOR,
  liveDemoUrl,
  NEXT_STEPS,
  RATING_SCALES,
  SAME_RULES,
  WHAT_MODELS_MISS,
  WHERE_MODELS_BREAK,
  SILVER_ASK,
  STAGES,
  type StageId,
} from "@/lib/aspen/content";
import { EMPTY_SUMMARY, summarizeRun, type RunSummary } from "@/lib/aspen/results";
import type { Control, RunData } from "@/lib/aspen/types";
import { notApplyLabel, PresenterApp } from "./presenter-app";

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
    expect(screen.getByText("1/3")).toBeInTheDocument();

    // What we saw: the room's results, how the AI did, then AI in their agencies.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText(RATING_SCALES.performance!.title)).toBeInTheDocument();
    expect(screen.queryByText(RATING_SCALES.experience!.title)).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(screen.getByText("How is AI performing overall in your agency?")).toBeInTheDocument();
    expect(screen.queryByText(RATING_SCALES.performance!.title)).not.toBeInTheDocument();
    expect(posts()).toEqual([]);

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("scale");
    expect(screen.getByText("1/6")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText(STAGES.find((st) => st.id === "scale")!.summary)).toBeInTheDocument();

    // At scale: the share, then Max's household, chart, what the models miss and the front door.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/6")).toBeInTheDocument();
    expect(screen.getByText(AZ_HOUSEHOLD.title)).toBeInTheDocument();
    // The summary shows on the first slide only.
    expect(screen.queryByText(STAGES.find((st) => st.id === "scale")!.summary)).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("3/6")).toBeInTheDocument();
    expect(screen.getByText(WHERE_MODELS_BREAK.title)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("4/6")).toBeInTheDocument();
    for (const q of WHAT_MODELS_MISS.quotes) expect(screen.getByText(q.model)).toBeInTheDocument();
    // The review flag stays off the room's screen.
    expect(screen.queryByText(AZ_SCENARIO_REVIEW.question)).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("5/6")).toBeInTheDocument();
    // The last slide turns the stage from the problem to the fix.
    expect(screen.getByRole("heading", { level: 1, name: FRONT_DOOR.heading })).toBeInTheDocument();
    expect(screen.getByText(FRONT_DOOR.title)).toBeInTheDocument();
    // Max's original diagram, with no closing line under it.
    expect(screen.getByRole("img", { name: /ask an AI model what the law says/i })).toBeInTheDocument();
    expect(screen.queryByText(/it has to get the rules right/)).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("6/6")).toBeInTheDocument();
    // The live chatbot, in compare mode with the demo's Fresno question filled in.
    const demo = screen.getByTitle(/Live chatbot demo/);
    expect(demo.getAttribute("src")).toMatch(/^https:\/\/axiom\.org\/gallery\/chatbot\?compare=1&q=I/);
    expect(demo.getAttribute("src")).not.toMatch(/go=1/);
    expect(screen.getByRole("link", { name: /Open demo in a new tab/ })).toHaveAttribute("href", liveDemoUrl());
    expect(posts()).toEqual([{ stage: "scale" }]);

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await onStage("foundation");
    expect(screen.getByText("1/3")).toBeInTheDocument();

    // Back from a stage's first slide lands on the last slide of the stage before.
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByText("6/6")).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1, name: FRONT_DOOR.heading })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(screen.getByText("5/6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(screen.getByText("4/6")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: STAGES.find((st) => st.id === "scale")!.title })).toBeInTheDocument();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(screen.getByText("1/6")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await onStage("reveal");
    // Back onto the reveal lands on its last slide.
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(posts()).toEqual([{ stage: "scale" }, { stage: "foundation" }, { stage: "scale" }, { stage: "reveal" }]);
  });

  it("flags the Arizona scenario for review on At scale 4/6 only with ?review", async () => {
    window.history.pushState({}, "", "/aspen/present?review");
    try {
      setup({ stage: "scale" });
      await onStage("scale");
      for (let i = 0; i < 3; i++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.getByText("4/6")).toBeInTheDocument();
      expect(screen.getByRole("note")).toHaveTextContent(AZ_SCENARIO_REVIEW.question);
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(screen.queryByText(AZ_SCENARIO_REVIEW.question)).not.toBeInTheDocument();
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
      expect(screen.getByText(`${String(index + 1).padStart(2, "0")} · ${STAGES[index].label}`)).toBeInTheDocument();
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
            categories: [{ id: "amount", label: "Got the amount right", average: 2, count }],
          },
        ],
      },
    });
    setup({ stage: "reveal", summary: scale(3) });
    await onStage("reveal");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText(/rated AI overall/)).toHaveTextContent("3 people have rated AI overall"));
    expect(screen.getByText("2.0")).toBeInTheDocument();
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
    expect(screen.getByText("looked wrong, yet people would act on them").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("would stop a resident from applying. 1 of them qualifies.").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("What would a resident do next?")).toBeInTheDocument();
    expect(screen.getByText("To discuss")).toBeInTheDocument();
    // The agency question has its own slide, so the list leaves it out.
    for (const q of DISCUSSION_QUESTIONS) {
      if (q.id === "experience") expect(screen.queryByText(q.label)).not.toBeInTheDocument();
      else expect(screen.getByText(q.label)).toBeInTheDocument();
    }
  });

  it("counts an amount from rules that don't test eligibility apart from households that qualify", () => {
    expect(notApplyLabel({ wouldNotApplyEligible: 0, wouldNotApplyIfEligible: 0 })).toBe("would stop a resident from applying");
    expect(notApplyLabel({ wouldNotApplyEligible: 2, wouldNotApplyIfEligible: 0 })).toBe(
      "would stop a resident from applying. 2 of them qualify.",
    );
    expect(notApplyLabel({ wouldNotApplyEligible: 1, wouldNotApplyIfEligible: 0 })).toBe(
      "would stop a resident from applying. 1 of them qualifies.",
    );
    expect(notApplyLabel({ wouldNotApplyEligible: 0, wouldNotApplyIfEligible: 1 })).toBe(
      "would stop a resident from applying. For 1 of them, the rules give an amount but don't test eligibility yet.",
    );
    expect(notApplyLabel({ wouldNotApplyEligible: 2, wouldNotApplyIfEligible: 3 })).toBe(
      "would stop a resident from applying. 2 of them qualify. For 3 more, the rules give an amount but don't test eligibility yet.",
    );
  });

  it("keeps an Arizona rules amount conditional on eligibility in the reveal", async () => {
    const harmful = summarizeRun({
      ...DATA,
      prompts: [{
        ...DATA.prompts[0],
        household_id: "az-savings",
        rules_program: "Arizona SNAP",
        rules_outputs: [{ program: "us-az-snap", eligibilityTested: false }],
        resident_action: "not-apply",
      }],
    });
    setup({ stage: "reveal", summary: harmful });
    await onStage("reveal");
    await waitFor(() => expect(screen.getByText(
      "would stop a resident from applying. For 1 of them, the rules give an amount but don't test eligibility yet.",
    ).previousSibling).toHaveTextContent("1"));
    expect(screen.queryByText(/of them qualif/)).not.toBeInTheDocument();
  });

  it("labels the monthly standards beside both annual Arizona references", async () => {
    setup({ stage: "scale" });
    await onStage("scale");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/6")).toBeInTheDocument();
    expect(screen.getByText("$240")).toBeInTheDocument();
    expect(screen.getByText(/\$24 a month under FY2026 standards/)).toHaveTextContent("PolicyEngine's reference in PolicyBench");
    expect(screen.getByText(/The minimum benefit rose to \$25 on October 1, 2026\./)).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("4/6")).toBeInTheDocument();
    expect(screen.getByText("$240")).toBeInTheDocument();
    expect(screen.getByText(/\$24 a month under FY2026 standards/)).toHaveTextContent("PolicyEngine's reference in PolicyBench");
    expect(screen.getByText(/The minimum benefit rose to \$25 on October 1, 2026\./)).toBeInTheDocument();
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
    for (const trait of [
      "Every value cites the provision it comes from",
      "Every change carries its effective date",
      "Every release is versioned, so you can see what changed",
    ]) {
      expect(screen.getByText(trait)).toBeInTheDocument();
    }
    expect(screen.queryByText("One source of truth")).not.toBeInTheDocument();
    expect(screen.queryByText(/SNAP benefit math already checks out/)).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { level: 1, name: SAME_RULES.heading })).toBeInTheDocument();
    expect(screen.getByText(SAME_RULES.governments.label)).toBeInTheDocument();
    for (const use of SAME_RULES.governments.uses) expect(screen.getByText(use)).toBeInTheDocument();
    for (const a of SAME_RULES.audiences) expect(screen.getByText(a.label)).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { level: 1, name: BUILD_HEADING })).toBeInTheDocument();
    for (const tier of GOLDEN_A) expect(screen.getByText(tier.name)).toBeInTheDocument();
    expect(screen.queryByText("Bronze A")).not.toBeInTheDocument();
    expect(screen.getByText("Rules from public documents")).toBeInTheDocument();
    // Silver and Gold A read as in the core deck.
    expect(screen.getByText("Government validation")).toBeInTheDocument();
    expect(screen.getByText("Government system runs on Axiom")).toBeInTheDocument();
    expect(screen.getByText(/This is the ultimate goal: all systems can run off the same rules/)).toBeInTheDocument();
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
    expect(screen.getByText("See and edit the rules")).toBeInTheDocument();
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

  it("waits for the groups' ideas", async () => {
    setup({ stage: "groups", summary: EMPTY_SUMMARY });
    await onStage("groups");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("Ideas appear here as groups share them.")).toBeInTheDocument();
  });

  it("opens next steps on the ask: what Silver A takes, and what it never asks for", async () => {
    const { posts } = setup({ stage: "next" });
    await onStage("next");
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText(SILVER_ASK.title)).toBeInTheDocument();
    for (const t of SILVER_ASK.takes) expect(screen.getByText(t)).toBeInTheDocument();
    for (const g of SILVER_ASK.guardrails) expect(screen.getByText(g)).toBeInTheDocument();
    expect(screen.queryByText(NEXT_STEPS.ask)).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText(NEXT_STEPS.ask)).toBeInTheDocument();
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
    // Slides 2 to 4 are Max's PolicyBench slides.
    for (const source of [AZ_HOUSEHOLD.source, WHERE_MODELS_BREAK.source, WHAT_MODELS_MISS.sources]) {
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
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("3/3")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("How is AI performing overall in your agency?")).toBeInTheDocument());
    expect(screen.queryByText("Helps staff, confuses residents")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show agency comments" }));
    expect(screen.getByText("Helps staff, confuses residents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide agency comments" }));
    expect(screen.queryByText("Helps staff, confuses residents")).not.toBeInTheDocument();
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
