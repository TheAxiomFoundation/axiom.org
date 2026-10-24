import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDataStream, summarizeRules, type RulesAnswer, type RulesComputation } from "@/lib/aspen/rules";
import { federalFiscalYear, snapStandardsYears } from "@/lib/aspen/coverage";
import { azSavingsStream } from "@/test/rules-az-savings";
import {
  citationPath,
  formatPeriod,
  outputLabel,
  panelRows,
  RatingCard,
  readRatingDraft,
  RulesCheck,
  rulesCaveats,
  shownValue,
} from "./answer-feedback";
import { RATING_KEY, SAVE_TIMEOUT_MS, formatValue } from "./client";

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data } as unknown as Response;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

const MESSAGES = [{ role: "user" as const, content: "How much SNAP can I get?" }, { role: "assistant" as const, content: "$0" }];

const SNAP_RESULT: RulesAnswer & { latencyMs: number } = {
  text: "**You get $24 a month.** See https://des.az.gov/snap",
  computations: [
    {
      program: "snap",
      displayName: "SNAP",
      period: "2026-10",
      primary: {
        name: "snap",
        label: "Snap",
        value: 24,
        unit: "USD",
        incomplete: false,
        legalId: "us:statutes/7/2017#a",
        semantics: "scalar",
      },
      outputs: [
        {
          name: "snap",
          label: "Snap",
          value: 24,
          unit: "USD",
          incomplete: false,
          legalId: "us:statutes/7/2017#a",
          semantics: "scalar",
        },
        {
          name: "snap_excess_shelter_deduction",
          label: "Snap excess shelter deduction",
          value: 512.5,
          unit: "USD",
          incomplete: true,
          legalId: "us:statutes/7/2014#e",
          semantics: "scalar",
        },
      ],
      disclosures: [],
      standardsYears: [],
      eligibilityTested: true,
    },
  ],
  amount: 24,
  program: "SNAP",
  period: "2026-10",
  incomplete: ["snap standard utility allowance sua"],
  citations: ["us:statutes/7/2017#a", "us:statutes/7/2017#b", "us-az:policies/des/faa5/x#y"],
  errors: [],
  latencyMs: 1200,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("aspen.participant", "p-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("citationPath", () => {
  it("drops the anchor and turns the first colon into a slash", () => {
    expect(citationPath("us-az:policies/des/faa5/x#y")).toBe("us-az/policies/des/faa5/x");
    expect(citationPath("us:statutes/7/2017")).toBe("us/statutes/7/2017");
  });
});

describe("formatPeriod", () => {
  it("spells out a year-month", () => {
    expect(formatPeriod("2026-10")).toBe("October 2026");
    expect(formatPeriod("2027-01")).toBe("January 2027");
  });

  it("leaves other periods unchanged", () => {
    expect(formatPeriod("2026")).toBe("2026");
    expect(formatPeriod(null)).toBeNull();
  });

  it("keeps the raw month when it is out of range", () => {
    expect(formatPeriod("2026-13")).toBe("13 2026");
  });
});

describe("outputLabel", () => {
  it("drops a leading program name and capitalizes", () => {
    expect(outputLabel("Snap excess shelter deduction")).toBe("Excess shelter deduction");
    expect(outputLabel("tanf countable income")).toBe("Countable income");
  });

  it("upper-cases acronyms", () => {
    expect(outputLabel("Snap")).toBe("SNAP");
    expect(outputLabel("standard utility allowance sua")).toBe("Standard utility allowance SUA");
    expect(outputLabel("income as share of fpl")).toBe("Income as share of FPL");
  });
});

describe("RatingCard", () => {
  const ok = () => vi.fn().mockResolvedValue(jsonResponse({ ok: true, saved: true }));

  it("asks two things: how it looks, with optional tags and a note, then what a resident would do", async () => {
    vi.stubGlobal("fetch", ok());
    render(<RatingCard promptId="p1" />);
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Does it look right?")).toBeInTheDocument();
    // "Would you act on it?" is gone (the run-through, Oct 22).
    expect(screen.queryByText("Would you act on it?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
    // Nothing else until there is a verdict.
    expect(screen.queryByText(/What went wrong\?/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    expect(screen.getByRole("button", { name: "Not sure" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/What went wrong\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wrong amount" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plain and clear" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Anything the room should know about this answer\?/)).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(screen.getByText("What would a resident do next?")).toHaveFocus();
    expect(screen.queryByText("Does it look right?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save rating" })).not.toBeInTheDocument();

    // Back shows the verdict already picked.
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("button", { name: "Not sure" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("leads with what went well for a right answer and offers the rest on request", () => {
    vi.stubGlobal("fetch", ok());
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    expect(screen.getByText(/What went well\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plain and clear" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wrong amount" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Something went wrong too?" }));
    expect(screen.getByRole("button", { name: "Wrong amount" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Something went wrong too?" })).not.toBeInTheDocument();
  });

  it("saves the whole rating with every tap, and calls onRated once the resident's next step saves", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    const onRated = vi.fn();
    render(<RatingCard promptId="p1" onRated={onRated} />);

    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/aspen/rate");
    expect(bodyOf(fetchMock, 0)).toEqual({
      participantId: "p-1",
      promptId: "p1",
      verdict: "wrong",
      residentAction: null,
      wentWell: [],
      wentWrong: [],
      note: "",
      rev: expect.any(Number),
    });

    fireEvent.click(screen.getByRole("button", { name: "Wrong amount" }));
    fireEvent.click(screen.getByRole("button", { name: "Something went well too?" }));
    fireEvent.click(screen.getByRole("button", { name: "Plain and clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Gave a number" }));
    // A second tap takes a tag back off.
    fireEvent.click(screen.getByRole("button", { name: "Plain and clear" }));
    expect(screen.getByRole("button", { name: "Plain and clear" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(bodyOf(fetchMock, 4)).toMatchObject({ wentWell: ["Gave a number"], wentWrong: ["Wrong amount"], note: "" });

    // Typing doesn't save; Next saves the note.
    fireEvent.change(screen.getByLabelText(/Anything the room should know about this answer\?/), { target: { value: "  Missed BBCE " } });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(bodyOf(fetchMock, 5)).toMatchObject({ note: "Missed BBCE", residentAction: null });
    expect(onRated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Not apply" }));
    await waitFor(() => expect(onRated).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock, 6)).toEqual({
      participantId: "p-1",
      promptId: "p1",
      verdict: "wrong",
      residentAction: "not-apply",
      wentWell: ["Gave a number"],
      wentWrong: ["Wrong amount"],
      note: "Missed BBCE",
      rev: expect.any(Number),
    });
    // Each save's stamp is above the one before, so the server can order them whatever order they arrive in.
    const revs = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string).rev as number);
    expect(revs.every((r, i) => i === 0 || r > revs[i - 1])).toBe(true);
    // The retired question is never sent, so a new rating can't carry an old answer.
    expect(fetchMock.mock.calls.every((c) => !("wouldAct" in JSON.parse(c[1].body as string)))).toBe(true);
  });

  it("doesn't save the note again on Next when it hasn't changed", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends one save at a time, in the order of the taps", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((r) => resolvers.push(r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "Wrong amount" }));
    fireEvent.click(screen.getByRole("button", { name: "Too vague" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // The second waits for the first, so a slow first save can't land last and undo a tag.
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolvers[0](jsonResponse({ ok: true, saved: true })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => resolvers[1](jsonResponse({ ok: true, saved: true })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(bodyOf(fetchMock, 1).wentWrong).toEqual(["Wrong amount"]);
    expect(bodyOf(fetchMock, 2).wentWrong).toEqual(["Wrong amount", "Too vague"]);
    await act(async () => resolvers[2](jsonResponse({ ok: true, saved: true })));
  });

  it("says when a save fails, keeps the choice, and saves on the next tap", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, saved: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "no" }, false))
      .mockResolvedValue(jsonResponse({ ok: true, saved: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onRated = vi.fn();
    render(<RatingCard promptId="p1" onRated={onRated} />);
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Call to check" }));
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call to check" })).toHaveAttribute("aria-pressed", "true");
    expect(onRated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Call to check" }));
    await waitFor(() => expect(onRated).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument();
  });

  it("reports a dropped connection as a failed save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
  });

  it("reports a store failure as a failed save, in a region a screen reader announces", async () => {
    // The route answers 200 with saved: false when the database write fails.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, saved: false })));
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    const line = await screen.findByText("That didn't save. Tap it again.");
    expect(line).toHaveAttribute("aria-live", "polite");
  });

  it("gives up on a save that never answers, says so, and sends the tap waiting behind it", async () => {
    vi.useFakeTimers();
    try {
      // A request that stalls until it is aborted.
      const stall = (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      const fetchMock = vi.fn().mockImplementationOnce(stall).mockImplementationOnce(stall).mockResolvedValue(jsonResponse({ ok: true, saved: true }));
      vi.stubGlobal("fetch", fetchMock);
      render(<RatingCard promptId="p1" />);
      fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
      await act(async () => {});
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTime(SAVE_TIMEOUT_MS));
      expect(screen.getByText("That didn't save. Tap it again.")).toBeInTheDocument();

      // A second save stalls too, with a tap queued behind it: the queue moves on once it gives up.
      fireEvent.click(screen.getByRole("button", { name: "Wrong amount" }));
      fireEvent.click(screen.getByRole("button", { name: "Too vague" }));
      await act(async () => {});
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await act(async () => vi.advanceTimersByTime(SAVE_TIMEOUT_MS));
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(bodyOf(fetchMock, 2).wentWrong).toEqual(["Wrong amount", "Too vague"]);
      expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reopens where it was after a reload, so the next tap keeps the note and tags already saved", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "Wrong amount" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Ignored BBCE " } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(bodyOf(fetchMock, 2).note).toBe("Ignored BBCE");
    // The tab reloads: a locked phone often drops it during the TV moments.
    first.unmount();
    render(<RatingCard promptId="p1" />);
    expect(await screen.findByText("2 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(bodyOf(fetchMock, 3)).toMatchObject({
      verdict: "wrong",
      residentAction: "apply",
      wentWrong: ["Wrong amount"],
      note: "Ignored BBCE",
    });
    // Back on the first step, the choices are as they were.
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("button", { name: "Looks wrong" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox")).toHaveValue("Ignored BBCE");
  });

  it("reopens a card whose last save never confirmed saying so, and the next tap saves it and moves on", async () => {
    localStorage.setItem(
      RATING_KEY,
      JSON.stringify({ p1: { rating: { verdict: "wrong", residentAction: "apply", wentWell: [], wentWrong: [], note: "" }, step: 1, unsaved: true } }),
    );
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    const onRated = vi.fn();
    render(<RatingCard promptId="p1" onRated={onRated} />);
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toHaveAttribute("aria-pressed", "true");
    expect(onRated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onRated).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument();
    expect(readRatingDraft("p1")?.unsaved).toBe(false);
  });

  it("marks the draft unsaved while a save is on its way, and saved once the latest one lands", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "Wrong amount" }));
    expect(readRatingDraft("p1")?.unsaved).toBe(true);
    await waitFor(() => expect(resolvers).toHaveLength(1));
    // The first lands but the second is still on its way: still unsaved.
    await act(async () => resolvers[0](jsonResponse({ ok: true, saved: true })));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    expect(readRatingDraft("p1")?.unsaved).toBe(true);
    await act(async () => resolvers[1](jsonResponse({ ok: true, saved: true })));
    await waitFor(() => expect(readRatingDraft("p1")?.unsaved).toBe(false));
    expect(readRatingDraft("p1")?.rating.wentWrong).toEqual(["Wrong amount"]);
  });

  it("moves on only once the latest tap saves, not an earlier one that lands first", async () => {
    localStorage.setItem(
      RATING_KEY,
      JSON.stringify({ p1: { rating: { verdict: "wrong", residentAction: null, wentWell: [], wentWrong: [], note: "" }, step: 1 } }),
    );
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    const onRated = vi.fn();
    render(<RatingCard promptId="p1" onRated={onRated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Not apply" }));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => resolvers[0](jsonResponse({ ok: true, saved: true })));
    expect(onRated).not.toHaveBeenCalled();
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => resolvers[1](jsonResponse({}, false)));
    expect(onRated).not.toHaveBeenCalled();
    expect(screen.getByText("That didn't save. Tap it again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not apply" }));
    await waitFor(() => expect(resolvers).toHaveLength(3));
    await act(async () => resolvers[2](jsonResponse({ ok: true, saved: true })));
    expect(onRated).toHaveBeenCalledTimes(1);
  });

  it("keeps another tab's newer answer when this tab's older save lands, so a reload still asks for it", async () => {
    // Two tabs on one phone share its stored drafts, and each sends its own saves.
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    const tabA = render(<RatingCard promptId="p1" />);
    const tabB = render(<RatingCard promptId="p1" />);
    fireEvent.click(within(tabA.container).getByRole("button", { name: "Looks wrong" }));
    fireEvent.click(within(tabB.container).getByRole("button", { name: "Looks right" }));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    // B's fails, then A's older one lands: each tab says what happened to its own.
    await act(async () => resolvers[1](jsonResponse({}, false)));
    await act(async () => resolvers[0](jsonResponse({ ok: true, saved: true })));
    expect(within(tabA.container).queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument();
    expect(within(tabB.container).getByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(readRatingDraft("p1")).toMatchObject({ rating: { verdict: "right" }, unsaved: true });
    tabA.unmount();
    tabB.unmount();
    render(<RatingCard promptId="p1" />);
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Looks right" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets a save still on its way confirm the draft after another tab opens the card and types in it", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    const tabA = render(<RatingCard promptId="p1" />);
    fireEvent.click(within(tabA.container).getByRole("button", { name: "Looks wrong" }));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    // A second tab opens the card while A's save is on its way, and types a note without saving it.
    const tabB = render(<RatingCard promptId="p1" />);
    fireEvent.change(await within(tabB.container).findByLabelText(/Anything the room should know/), { target: { value: "Check BBCE" } });
    await act(async () => resolvers[0](jsonResponse({ ok: true, saved: true })));
    expect(readRatingDraft("p1")).toMatchObject({ rating: { verdict: "wrong", note: "Check BBCE" }, unsaved: false });
  });

  it("keeps each answer's card apart, and ignores a draft it can't read", () => {
    localStorage.setItem(
      RATING_KEY,
      JSON.stringify({
        p1: { rating: { verdict: "right", residentAction: null, wentWell: ["Clear"], wentWrong: [], note: "Good" }, step: 0, unsaved: true },
        p2: { rating: "garbage", step: 1 },
        p3: { rating: { verdict: 7, wentWell: "Clear", note: 3 }, step: 1 },
      }),
    );
    expect(readRatingDraft("p1")).toEqual({
      rating: { verdict: "right", residentAction: null, wentWell: ["Clear"], wentWrong: [], note: "Good" },
      step: 0,
      unsaved: true,
    });
    expect(readRatingDraft("p2")).toBeNull();
    // Wrong types become empty, and a draft without a verdict reopens on the first step.
    expect(readRatingDraft("p3")).toEqual({
      rating: { verdict: null, residentAction: null, wentWell: [], wentWrong: [], note: "" },
      step: 0,
      unsaved: false,
    });
    expect(readRatingDraft("p4")).toBeNull();
  });
});

describe("RulesCheck", () => {
  it("shows the locked line until the presenter unlocks it", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p1" messages={MESSAGES} unlocked={false} />);
    expect(screen.getByText(/later in the session, you'll check this answer/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs the check and shows the rules answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SNAP_RESULT));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p1" messages={MESSAGES} unlocked />);

    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/aspen/rules");
    expect(bodyOf(fetchMock)).toEqual({ participantId: "p-1", promptId: "p1", messages: MESSAGES });

    expect(screen.getByText("a month").parentElement).toHaveTextContent(/^\$24a month$/);
    expect(screen.getByText("SNAP · for October 2026")).toBeInTheDocument();

    const outputs = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("$"));
    expect(outputs.map((li) => li.textContent)).toEqual([
      "SNAP$24",
      "Excess shelter deduction(still being encoded)$512.50",
    ]);

    expect(
      screen.getByText(/Not final: the rules release marks Standard utility allowance SUA as still being/),
    ).toBeInTheDocument();

    expect(screen.getAllByText("us/statutes/7/2017")).toHaveLength(1);
    expect(screen.getByText("us-az/policies/des/faa5/x")).toBeInTheDocument();

    expect(screen.queryByText("You get $24 a month.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the full rules answer" }));
    expect(screen.getByText("You get $24 a month.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "des.az.gov/snap" })).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Hide the full rules answer" }));
    expect(screen.queryByText("You get $24 a month.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "It matched" }));
    expect(screen.getByRole("button", { name: "It matched" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/aspen/rate");
    expect(bodyOf(fetchMock, 1)).toEqual({ participantId: "p-1", promptId: "p1", postCheck: "match" });
  });

  it("keeps the post-check choice when saving it fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAP_RESULT))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p1" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    fireEvent.click(await screen.findByRole("button", { name: "It was wrong" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "It was wrong" })).toHaveAttribute("aria-pressed", "true");
  });

  it("labels several programs and shows a dash without a primary amount", async () => {
    const result: RulesAnswer = {
      text: "Two programs.",
      computations: [
        {
          program: "ctc",
          displayName: "Child Tax Credit",
          period: "2026",
          primary: null,
          outputs: [
            { name: "ctc", label: "Ctc", value: 4400, unit: "USD", incomplete: false, legalId: null, semantics: "scalar" },
          ],
          disclosures: [],
          standardsYears: [],
          eligibilityTested: true,
        },
        {
          program: "eitc",
          displayName: "EITC",
          period: "2026",
          primary: null,
          outputs: [
            {
              name: "eitc_eligible",
              label: "Eitc eligible",
              value: "not_holds",
              unit: null,
              incomplete: false,
              legalId: null,
              semantics: "judgment",
            },
          ],
          disclosures: [],
          standardsYears: [],
          eligibilityTested: true,
        },
      ],
      amount: null,
      program: null,
      period: "2026",
      incomplete: [],
      citations: [],
      errors: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(result)));
    render(<RulesCheck promptId="p2" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(screen.queryByText("a month")).not.toBeInTheDocument();
    expect(screen.getByText("for 2026")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("Child Tax Credit: CTC$4,400");
    expect(items).toContain("EITC: EligibleNo");
    expect(screen.queryByText("Rules used")).not.toBeInTheDocument();
    expect(screen.queryByText(/Not final/)).not.toBeInTheDocument();
  });

  it("does not say 'a month' for a yearly dollar amount", async () => {
    const result: RulesAnswer = {
      ...SNAP_RESULT,
      computations: [{ ...SNAP_RESULT.computations[0], outputs: [SNAP_RESULT.computations[0].outputs[0]] }],
      period: "2026",
      program: null,
      incomplete: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(result)));
    render(<RulesCheck promptId="p3" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("$24")).toBeInTheDocument();
    expect(screen.queryByText("a month")).not.toBeInTheDocument();
    expect(screen.queryByText("SNAP$24")).not.toBeInTheDocument();
  });

  it("says so honestly when no calculation ran", async () => {
    const result: RulesAnswer = {
      text: "I could not compute this.",
      computations: [],
      amount: null,
      program: null,
      period: null,
      incomplete: [],
      citations: [],
      errors: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(result)));
    render(<RulesCheck promptId="p4" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText(/answered without running a calculation/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("reports a failed check and lets the participant retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "upstream" }, false))
      .mockResolvedValueOnce(jsonResponse({ error: "rules chatbot unavailable" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(SNAP_RESULT));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p5" messages={MESSAGES} unlocked />);

    for (let attempt = 0; attempt < 3; attempt++) {
      fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
      expect(await screen.findByText("The rules check didn't finish. Try again.")).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("can run the check again from the result", async () => {
    let second: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAP_RESULT))
      .mockReturnValueOnce(new Promise<Response>((r) => (second = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p6" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run the check again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Reading the household…");
    await act(async () => second(jsonResponse(SNAP_RESULT)));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("steps through the progress lines while the check runs", async () => {
    vi.useFakeTimers();
    let resolve: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r))));
    render(<RulesCheck promptId="p7" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    const status = () => within(screen.getByRole("status"));
    expect(status().getByText("Reading the household…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(status().getByText("Finding the program's rules…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(status().getByText("Running the encoded rules…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3500 * 5);
    });
    expect(status().getByText("Writing up the answer…")).toBeInTheDocument();
    await act(async () => {
      resolve(jsonResponse(SNAP_RESULT));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("What the encoded rules say")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the recorded Arizona answer as an amount if eligible, never as an eligibility verdict", async () => {
    const recorded = summarizeRules(parseDataStream(azSavingsStream()));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...recorded, latencyMs: 9000 })));
    render(<RulesCheck promptId="p8" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();

    expect(screen.getByText("a month if eligible").parentElement).toHaveTextContent(/^\$24a month if eligible$/);
    expect(screen.getByText("Arizona SNAP · for October 2026")).toBeInTheDocument();
    // The note shows without opening the full answer.
    expect(screen.getByRole("note")).toHaveTextContent(
      "Not an eligibility determination: Axiom's Arizona SNAP rules don't test eligibility yet. Read this as the amount if eligible.",
    );
    expect(
      screen.getByText(
        "Uses FY2026 SNAP standards, but October 2026 falls under FY2027 standards (from October 1, 2026), which Axiom hasn't encoded yet. The amount may differ.",
      ),
    ).toBeInTheDocument();

    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    // No yes/no verdict at all: one row says eligibility wasn't tested, right under the benefit.
    expect(rows.slice(0, 2)).toEqual(["Benefit$24", "EligibilityNot tested"]);
    expect(rows.some((row) => /^Eligible/.test(row ?? ""))).toBe(false);
    expect(rows).toContain("Maximum allotment$298");
    expect(rows.some((row) => /Yes$|No$/.test(row ?? ""))).toBe(false);
    // finbot's own wording of both limits is replaced, not repeated.
    expect(screen.queryByRole("list", { name: "Notes on this check" })).not.toBeInTheDocument();
    expect(screen.queryByText(/every household shows as eligible/)).not.toBeInTheDocument();
  });

  it("lists the chatbot's other limits, and says nothing about standards that match the period", async () => {
    const ny: RulesAnswer = {
      ...SNAP_RESULT,
      period: "2026-03",
      computations: [
        {
          ...SNAP_RESULT.computations[0],
          program: "us-ny-snap",
          period: "2026-03",
          outputs: [
            ...SNAP_RESULT.computations[0].outputs,
            { name: "snap_eligible", label: "Snap eligible", value: "holds", unit: null, incomplete: false, legalId: null, semantics: "judgment" },
          ],
          disclosures: [
            "SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet.",
            "New York: the household's earned-income input was set from the earnings given (has earned income).",
          ],
          standardsYears: [2026],
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(ny)));
    render(<RulesCheck promptId="p9" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    const notes = await screen.findByRole("list", { name: "Notes on this check" });
    expect(within(notes).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "New York: the household's earned-income input was set from the earnings given (has earned income).",
    ]);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/SNAP standards/)).not.toBeInTheDocument();
    expect(screen.getByText("a month").parentElement).toHaveTextContent(/^\$24a month$/);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toContain("EligibleYes");
  });

  it("reads rules results saved before the panel knew about limits", async () => {
    const old = {
      ...SNAP_RESULT,
      computations: [{ ...SNAP_RESULT.computations[0], disclosures: undefined, standardsYears: undefined }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(old)));
    render(<RulesCheck promptId="p10" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("rules panel values and caveats", () => {
  const AZ_NOTE =
    "Axiom's Arizona SNAP encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".";
  const FY_NOTE =
    "SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet.";
  const ANNUAL_FY_NOTES = ["Arizona SNAP", "New York SNAP"].map(
    (name) => `${name} figures use FY2026 standards; the FY2027 update due October 1, 2026 is not encoded yet, so amounts from that date may differ from current law.`,
  );
  const output = (name: string, value: unknown, semantics: string | null, unit: string | null = null) => ({
    name,
    label: name.replace(/_/g, " "),
    value,
    unit,
    incomplete: false,
    legalId: null,
    semantics,
  });
  const check = (program: string, period: string | null, extra: Partial<RulesComputation> = {}): RulesComputation => ({
    program,
    displayName: program === "us-az-snap" ? "Arizona SNAP" : "New York SNAP",
    period,
    primary: null,
    outputs: [
      output("snap_benefit", 24, "scalar", "USD"),
      output("snap_eligible", "holds", "judgment"),
      output("snap_resource_eligible", "not_holds", "judgment"),
      output("snap_standard_gross_income_eligible", "holds", null),
      output("snap_net_income", 2329, "scalar", "USD"),
    ],
    disclosures: [],
    standardsYears: [],
    eligibilityTested: program !== "us-az-snap",
    ...extra,
  });

  it("never shows a yes/no verdict, sub-tests included, for rules that don't test eligibility", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("us-az-snap", "us-ny-snap"),
        fc.array(
          fc.record({
            name: fc.constantFrom("snap_eligible", "snap_resource_eligible", "snap_benefit", "x"),
            value: fc.oneof(fc.constantFrom("holds", "not_holds"), fc.integer({ min: 0, max: 900 })),
            semantics: fc.constantFrom("judgment", "scalar", null),
          }),
          { maxLength: 6 },
        ),
        (program, outs) => {
          const c = check(program, "2026-10", { outputs: outs.map((o) => output(o.name, o.value, o.semantics)) });
          const rows = panelRows(c);
          const verdicts = rows.filter((r) => r.value === "Yes" || r.value === "No");
          if (program === "us-az-snap") {
            expect(verdicts).toEqual([]);
            expect(rows.filter((r) => r.value === "Not tested")).toHaveLength(1);
            for (const o of c.outputs) if (o.value === "holds" || o.value === "not_holds") expect(shownValue(o, c)).toBe("Not tested");
          } else {
            expect(verdicts).toHaveLength(c.outputs.filter((o) => o.value === "holds" || o.value === "not_holds").length);
            expect(rows.some((r) => r.value === "Not tested")).toBe(false);
          }
        },
      ),
    );
  });

  it("shows amounts as computed for every program", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000, max: 10_000 }), fc.constantFrom("us-az-snap", "us-ny-snap"), (value, program) => {
        expect(shownValue(output("snap_benefit", value, "scalar", "USD"), check(program, "2026-10"))).toBe(formatValue(value, "USD"));
      }),
    );
    expect(panelRows(check("us-ny-snap", "2026-10")).map((r) => [r.label, r.value])).toEqual([
      ["Benefit", "$24"],
      ["Eligible", "Yes"],
      ["Resource eligible", "No"],
      ["Standard gross income eligible", "Yes"],
      ["Net income", "$2,329"],
    ]);
  });

  it("states each caveat once across computations", () => {
    const az = check("us-az-snap", "2026-10", { disclosures: ["Something else.", AZ_NOTE, FY_NOTE], standardsYears: [2025, 2026] });
    const caveats = rulesCaveats({ computations: [az, { ...az }] });
    expect(caveats.eligibility).toHaveLength(1);
    expect(caveats.standards).toEqual([
      "Uses FY2025 and FY2026 SNAP standards, but October 2026 falls under FY2027 standards (from October 1, 2026), which Axiom hasn't encoded yet. The amount may differ.",
    ]);
    expect(caveats.other).toEqual(["Something else."]);
  });

  it("states the standards year for a check saved without standardsYears (GPT-6.1 Sol, round 4)", () => {
    const old = check("us-ny-snap", "2026-10", { disclosures: [FY_NOTE], standardsYears: undefined });
    expect(rulesCaveats({ computations: [old] })).toEqual({
      eligibility: [],
      standards: [
        "Uses FY2026 SNAP standards, but October 2026 falls under FY2027 standards (from October 1, 2026), which Axiom hasn't encoded yet. The amount may differ.",
      ],
      other: [],
    });
    // Cited years that disagree with finbot's sentence: the sentence stays, so nothing is lost.
    const disagree = check("us-ny-snap", "2026-10", { disclosures: [FY_NOTE], standardsYears: [2025] });
    expect(rulesCaveats({ computations: [disagree] }).other).toEqual([FY_NOTE]);
  });

  it("states the annual-update caveat once for saved and older computation shapes", () => {
    for (const program of ["us-az-snap", "us-ny-snap"]) {
      const template = check(program, "2026-10");
      const note = ANNUAL_FY_NOTES.find((text) => text.startsWith(`${template.displayName} figures use`))!;
      for (const standardsYears of [[2026], undefined]) {
        const caveats = rulesCaveats({ computations: [{ ...template, disclosures: [note], standardsYears }] });
        expect(caveats.standards).toEqual([
          "Uses FY2026 SNAP standards, but October 2026 falls under FY2027 standards (from October 1, 2026), which Axiom hasn't encoded yet. The amount may differ.",
        ]);
        expect(caveats.other).toEqual([]);
      }
    }
  });

  it("keeps the standards note for a yearly or missing period", () => {
    for (const period of ["2026", null]) {
      const caveats = rulesCaveats({ computations: [check("us-ny-snap", period, { disclosures: [FY_NOTE], standardsYears: [2026] })] });
      expect(caveats.standards).toEqual([]);
      expect(caveats.other).toEqual([FY_NOTE]);
    }
  });

  it("does not label another program's fiscal-year disclosure as SNAP standards", () => {
    const note = ANNUAL_FY_NOTES[0].replace("Arizona SNAP", "Arizona TANF");
    const computation = {
      ...check("us-az-tanf", "2026-10"), displayName: "Arizona TANF",
      disclosures: [note], standardsYears: undefined,
    };
    expect(rulesCaveats({ computations: [computation] })).toEqual({
      eligibility: [], standards: [], other: [note],
    });
  });

  it("never drops a disclosure without saying the same thing itself", () => {
    const disclosure = fc.oneof(
      fc.constantFrom(
        AZ_NOTE,
        `${AZ_NOTE} Shelter costs are not included.`,
        "Arizona SNAP rules do not test eligibility yet. Shelter costs are not included in this amount.",
        "Axiom's Arizona SNAP encoding omits shelter costs. This encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".",
        "Not an eligibility determination: Axiom's Arizona SNAP rules don't test eligibility yet. Read this as the amount if eligible.",
        FY_NOTE,
        `${FY_NOTE} More.`,
        ...ANNUAL_FY_NOTES,
        ...ANNUAL_FY_NOTES.map((note) => `${note} Shelter caps also changed.`),
        ...ANNUAL_FY_NOTES.map((note) => `Shelter caps also changed. ${note}`),
        "Other note.",
      ),
      fc.string(),
    );
    fc.assert(
      fc.property(
        fc.constantFrom("us-az-snap", "us-ny-snap"),
        fc.constantFrom("2026-03", "2026-10", "2027-11", "2026", null),
        fc.array(disclosure, { maxLength: 5 }),
        fc.array(fc.integer({ min: 2025, max: 2028 }), { maxLength: 2 }),
        fc.constantFrom(true, false, undefined),
        fc.boolean(),
        (program, period, disclosures, cited, eligibilityTested, saved) => {
          // A check saved without standardsYears (an older shape) must lose nothing either.
          const standardsYears = saved ? snapYears(cited, disclosures) : undefined;
          const c = check(program, period, { disclosures, eligibilityTested, standardsYears });
          const caveats = rulesCaveats({ computations: [c] });
          for (const d of disclosures) {
            if (caveats.other.includes(d)) continue;
            if (d === FY_NOTE || ANNUAL_FY_NOTES.includes(d)) {
              if (d !== FY_NOTE) expect(d.startsWith(`${c.displayName} figures use`)).toBe(true);
              // Only for a month. These notes say FY2026 standards were used; unless the month is in
              // FY2026 itself, the panel's own line must say FY2026 (and "not encoded" for FY2027).
              const due = federalFiscalYear(period);
              expect(due).not.toBeNull();
              if (due !== 2026) {
                expect(caveats.standards).toHaveLength(1);
                expect(caveats.standards[0]).toContain("FY2026");
                if (due === 2027) expect(caveats.standards[0]).toMatch(/hasn't encoded yet/);
              }
            } else if (d === AZ_NOTE) {
              // finbot's whole eligibility sentence: the panel's note replaces it.
              expect(caveats.eligibility).toHaveLength(1);
            } else {
              // Anything else dropped is word for word one of the panel's own lines, shown once.
              expect([...caveats.eligibility, ...caveats.standards]).toContain(d);
            }
          }
        },
      ),
      // Pure functions: enough runs to hit the rarer combinations (cited years against finbot's sentence).
      { numRuns: 1000 },
    );
  });
});

function snapYears(cited: number[], disclosures: string[]): number[] {
  return snapStandardsYears(
    cited.map((y) => `us:policies/usda/snap/fy-${y}-cola/deductions#x`),
    disclosures,
  );
}
