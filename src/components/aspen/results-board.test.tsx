import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EMPTY_SUMMARY, summarizeRun, type RunSummary } from "@/lib/aspen/results";
import type { RunData } from "@/lib/aspen/types";
import { ResultsBoard, ResultsCounts } from "./results-board";

const RUN = "phoenix";

const DATA: RunData = {
  participants: [
    { id: "a", run_id: RUN, perspective: "resident", state: "Arizona" },
    { id: "b", run_id: RUN, perspective: "caseworker", state: "Ohio" },
    { id: "c", run_id: RUN, perspective: "resident" },
  ],
  prompts: [
    {
      id: "p1",
      run_id: RUN,
      participant_id: "a",
      conversation_id: "c1",
      turn: 0,
      created_at: "2026-10-26T18:01:00Z",
      perspective: "resident",
      household_id: "az-savings",
      prompt: "I live in Phoenix. How much SNAP can I get?",
      answer: "You would not qualify because of your savings.",
      verdict: "wrong",
      would_act: "no",
      went_well: ["Plain and clear"],
      went_wrong: ["Said I don't qualify", "Wrong rule or limit"],
      rules_program: "SNAP",
      rules_amount: 24,
      post_check_verdict: "wrong",
    },
    {
      id: "p2",
      run_id: RUN,
      participant_id: "b",
      conversation_id: "c2",
      turn: 0,
      created_at: "2026-10-26T18:03:00Z",
      perspective: "caseworker",
      household_id: "ga-ctc",
      prompt: "How much CTC should they get?",
      answer: "$4,400",
      verdict: "right",
      would_act: "yes",
      went_well: ["Gave a number"],
    },
    {
      id: "p3",
      run_id: RUN,
      participant_id: "c",
      conversation_id: "c3",
      turn: 0,
      created_at: "2026-10-26T18:05:00Z",
      prompt: "Can I get WIC?",
      answer: "Maybe.",
      verdict: "meh",
    },
    {
      id: "p5",
      run_id: RUN,
      participant_id: "a",
      conversation_id: "c5",
      turn: 0,
      created_at: "2026-10-26T18:07:00Z",
      perspective: "resident",
      household_id: "az-retiree",
      twists: ["gig"],
      prompt: "I drive for an app too. How much SNAP?",
      answer: "**About $120** a month.",
      verdict: "unsure",
      would_act: "maybe",
      rating_note: "Sounded sure, but it skipped my utilities",
    },
    {
      id: "p4",
      run_id: RUN,
      participant_id: "c",
      conversation_id: "c3",
      turn: 1,
      created_at: "2026-10-26T18:06:00Z",
      prompt: "Unanswered follow-up",
    },
  ],
  events: [],
  pledges: [],
};

const SUMMARY = summarizeRun(DATA);

describe("ResultsCounts", () => {
  it("shows people, questions and ratings", () => {
    render(<ResultsCounts summary={SUMMARY} />);
    expect(screen.getByText("people").previousSibling).toHaveTextContent("3");
    expect(screen.getByText("questions").previousSibling).toHaveTextContent("4");
    expect(screen.getByText("answers rated").previousSibling).toHaveTextContent("4");
  });
});

describe("ResultsBoard", () => {
  it("frames the reveal around whether residents could act on the answers", () => {
    render(<ResultsBoard summary={SUMMARY} />);
    expect(screen.getByRole("heading", { name: "Could a resident act on these answers?" })).toBeInTheDocument();
    expect(screen.getByText("Would you let a resident act on what they got?")).toBeInTheDocument();
    expect(screen.getAllByText("Ask the room").length).toBeGreaterThan(1);
    const statement = screen.getByText(/answers looked right\. People would act on/);
    expect(statement).toHaveTextContent("1 of 4 answers looked right. People would act on 2.");
    // p5 looked unsure, yet its person might act on it. (The first match is the count's label; the spotlight badge repeats it.)
    expect(screen.getAllByText("Wrong but convincing")[0].nextSibling).toHaveTextContent("1");
  });

  it("breaks the answers down by household, detail and perspective", () => {
    render(<ResultsBoard summary={SUMMARY} />);
    expect(screen.getByRole("heading", { name: "Where the answers broke down" })).toBeInTheDocument();
    const row = (label: string) => screen.getByTitle(label).parentElement as HTMLElement;
    expect(row("Disabled, with savings")).toHaveTextContent("1 of 1");
    expect(row("+ Gig income")).toHaveTextContent("0 of 1");
    expect(row("Asked as a caseworker")).toHaveTextContent("0 of 1");
    expect(screen.getByText("What went wrong")).toBeInTheDocument();
    expect(screen.getByTitle("Said I don't qualify")).toBeInTheDocument();
  });

  it("spotlights the riskiest answers with what people said about them", () => {
    render(<ResultsBoard summary={SUMMARY} />);
    const cards = within(screen.getByRole("heading", { name: "Answers worth discussing" }).closest("section") as HTMLElement).getAllByRole("listitem");
    expect(within(cards[0]).getByText("Wrong but convincing")).toBeInTheDocument();
    expect(within(cards[0]).getByText("With: Gig income")).toBeInTheDocument();
    expect(within(cards[0]).getByText("About $120 a month.")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Sounded sure, but it skipped my utilities")).toBeInTheDocument();
    expect(within(cards[0]).getByText(/Might act on it/)).toBeInTheDocument();
    expect(within(cards[1]).getByText("Wrong against the rules")).toBeInTheDocument();
    expect(within(cards[1]).getByText("$24")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Said I don't qualify · Wrong rule or limit")).toBeInTheDocument();
    expect(within(cards[1]).getByText(/Would not act on it/)).toBeInTheDocument();
  });

  it("shows how it felt and the room's own words", () => {
    const withScales: RunSummary = {
      ...SUMMARY,
      discussion: {
        ...SUMMARY.discussion,
        scales: [
          {
            question: "performance",
            label: "How well did the AI answers perform?",
            low: "Not at all",
            high: "Fully",
            categories: [
              { id: "amount", label: "Got the amount right", average: 2.5, count: 4 },
              { id: "sources", label: "Showed where the answer came from", average: null, count: 0 },
            ],
          },
          {
            question: "experience",
            label: "How has your agency experienced AI so far, with clients and with staff?",
            low: "Mostly a problem",
            high: "Mostly a help",
            categories: [{ id: "staff", label: "For your staff", average: null, count: 0 }],
          },
        ],
      },
    };
    render(<ResultsBoard summary={withScales} wide />);
    expect(screen.getByRole("heading", { name: "How it felt" })).toBeInTheDocument();
    expect(screen.getByText("2.5")).toBeInTheDocument();
    // A scale nobody has rated stays hidden.
    expect(screen.queryByText(/How has your agency experienced AI/)).not.toBeInTheDocument();
    expect(screen.getByText("What went well")).toBeInTheDocument();
    const words = screen.getByRole("heading", { name: "In their words" }).closest("section") as HTMLElement;
    expect(within(words).getByText("Sounded sure, but it skipped my utilities")).toBeInTheDocument();
  });

  it("counts answers that would stop a resident from applying, and the rules people misread", () => {
    const harmful = summarizeRun({
      ...DATA,
      prompts: [
        { ...DATA.prompts[0], resident_action: "not-apply" },
        { ...DATA.prompts[1], resident_action: "apply" },
      ],
      events: [{ run_id: RUN, kind: "discussion", payload: { question: "misunderstood", topics: ["Asset tests"] } }],
    });
    render(<ResultsBoard summary={harmful} />);
    expect(screen.getByText("What would a resident do next?")).toBeInTheDocument();
    const card = screen.getByText("Would not apply").parentElement as HTMLElement;
    expect(card).toHaveTextContent("1answers would lead a resident not to apply. 1 of those households qualify under the encoded rules.");
    expect(screen.getByText("Rules the room says people misread")).toBeInTheDocument();
    expect(screen.getByTitle("Asset tests")).toBeInTheDocument();
  });

  it("shows the source-of-truth answers under how it felt", () => {
    render(
      <ResultsBoard
        summary={{
          ...EMPTY_SUMMARY,
          sourceOfTruth: [
            { id: "yes", label: "Yes", count: 0 },
            { id: "partly", label: "Partly", count: 1 },
            { id: "no", label: "No", count: 1 },
          ],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "How it felt" })).toBeInTheDocument();
    expect(screen.getByText("Checking answers today")).toBeInTheDocument();
    expect(screen.getByText(/can't\s+fully check an answer/)).toHaveTextContent("2 of 2");
  });

  it("shows the scales alone when ratings come in before any answer is rated", () => {
    const scalesOnly: RunSummary = {
      ...EMPTY_SUMMARY,
      discussion: {
        ...EMPTY_SUMMARY.discussion,
        scales: [
          {
            question: "performance",
            label: "How well did the AI answers perform?",
            low: "Not at all",
            high: "Fully",
            categories: [{ id: "amount", label: "Got the amount right", average: 4, count: 1 }],
          },
        ],
      },
    };
    render(<ResultsBoard summary={scalesOnly} />);
    expect(screen.getByRole("heading", { name: "How it felt" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Could a resident act on these answers?" })).not.toBeInTheDocument();
    expect(screen.queryByText("What went well")).not.toBeInTheDocument();
  });

  it("leaves out the problems card when nobody tagged one, and the spotlight when nothing went wrong", () => {
    const calm = summarizeRun({ ...DATA, prompts: [DATA.prompts[1]] });
    render(<ResultsBoard summary={calm} />);
    expect(screen.queryByText("What went wrong")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Answers worth discussing" })).not.toBeInTheDocument();
    expect(screen.getByText("Wrong but convincing").nextSibling).toHaveTextContent("0");
  });

  it("shows only the counts and an invitation before anyone has rated", () => {
    render(<ResultsBoard summary={EMPTY_SUMMARY} wide />);
    expect(screen.queryByRole("heading", { name: "Could a resident act on these answers?" })).not.toBeInTheDocument();
    expect(screen.getByText("Answers appear here as people ask.")).toBeInTheDocument();
  });
});
