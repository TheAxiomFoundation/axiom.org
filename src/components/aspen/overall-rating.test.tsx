import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverallRating, ScaleRow } from "./overall-rating";

function stubFetch() {
  const mock = vi.fn(
    async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ ok: true, saved: true }) }) as unknown as Response,
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** The events sent, with each payload's save stamp checked (above the one before) and taken off. */
function bodies(mock: ReturnType<typeof stubFetch>) {
  const sent = mock.mock.calls
    .filter(([url]) => url === "/api/aspen/event")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  const revs = sent.map((b) => b.payload.rev);
  expect(revs.every((r, i) => Number.isSafeInteger(r) && (i === 0 || r > revs[i - 1]))).toBe(true);
  return sent.map(({ payload: { rev: _rev, ...payload }, ...rest }) => ({ ...rest, payload }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("aspen.participant", "p-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ScaleRow", () => {
  it("marks the chosen point and reports changes", () => {
    const onChange = vi.fn();
    render(<ScaleRow label="Was clear to a resident" value={3} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Was clear to a resident" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Was clear to a resident: 3 of 5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Was clear to a resident: 4 of 5" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Was clear to a resident: 5 of 5" }));
    expect(onChange).toHaveBeenCalledWith(5);
  });
});

const box = () => screen.getByLabelText(/Where has AI helped your agency, and where has it fallen short\?/);

/** Answers this phone gave earlier: each question opens once the one before it is answered. */
const answered = (saved: Record<string, unknown>) => localStorage.setItem("aspen.overall.v2", JSON.stringify(saved));
/** The first question answered, so the agency scales are open. */
const TRUTH = { truth: "partly" };
/** All three rated too, so the comment box is open. */
const RATED = { truth: "partly", agency: { residents: 1, staff: 2, you: 3 } };

describe("OverallRating", () => {
  it("folds answers given before a new question to one line, and opens them again on a tap", async () => {
    stubFetch();
    answered(RATED);
    render(<OverallRating stage="try" fold />);
    // After Start over, answered questions don't all show again under the new one (Max, Oct 26).
    await waitFor(() => expect(screen.getByText(/Your answers are saved\./)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Partly" })).not.toBeInTheDocument();
    expect(screen.queryByText("How is AI performing overall in your agency?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change them" }));
    expect(screen.getByRole("button", { name: "Partly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "For you: 3 of 5" })).toHaveAttribute("aria-pressed", "true");
    expect(box()).toBeInTheDocument();
  });

  it("keeps questions not yet answered open through a new question, and never folds as the last is answered", async () => {
    stubFetch();
    answered(TRUTH);
    render(<OverallRating stage="try" fold />);
    // Starting over never hides what's left to answer (Ariel, Oct 23).
    expect(await screen.findByRole("button", { name: "For residents: 2 of 5" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "For residents: 2 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For your staff: 2 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For you: 2 of 5" }));
    // All answered under the participant's finger: the comment opens, nothing folds.
    expect(box()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change them" })).not.toBeInTheDocument();
  });

  it("folds on Start over after they're answered, not when a follow-up's answer lands, and stays folded once rated", async () => {
    stubFetch();
    const { rerender } = render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    for (const c of ["For residents", "For your staff", "For you"]) fireEvent.click(screen.getByRole("button", { name: `${c}: 4 of 5` }));
    expect(box()).toBeInTheDocument();
    // A follow-up's answer lands unrated while the comment box is open: nothing folds under the finger.
    rerender(<OverallRating stage="try" fold />);
    expect(box()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change them" })).not.toBeInTheDocument();
    // Start over: a new question.
    rerender(<OverallRating stage="try" fold restarts={1} />);
    expect(screen.getByText(/Your answers are saved\./)).toBeInTheDocument();
    // Its answer rated: still one line, until a tap opens it.
    rerender(<OverallRating stage="try" restarts={1} />);
    expect(screen.getByRole("button", { name: "Change them" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change them" }));
    expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
    // The next Start over folds them again.
    rerender(<OverallRating stage="try" fold restarts={2} />);
    expect(screen.getByRole("button", { name: "Change them" })).toBeInTheDocument();
  });

  it("stays open after Start over while a save failed or a comment waits to save", async () => {
    // A tap that never confirmed, through a reload during a new question: it asks for the tap again.
    stubFetch();
    answered({ ...RATED, unsaved: { discussion: true } });
    const first = render(<OverallRating stage="try" fold />);
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For you: 3 of 5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Change them" })).not.toBeInTheDocument();
    first.unmount();

    // Only the first question's save failed; the comment is saved, so it isn't waiting to save. It still asks for the tap again.
    answered({ ...RATED, comment: "Too slow", unsaved: { survey: true } });
    const second = render(<OverallRating stage="try" fold />);
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Partly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Comment saved" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Change them" })).not.toBeInTheDocument();
    second.unmount();

    // A comment typed but not saved when the participant starts over.
    answered(RATED);
    const { rerender } = render(<OverallRating stage="try" />);
    fireEvent.change(await screen.findByLabelText(/Where has AI helped your agency/), { target: { value: "Helps with forms" } });
    rerender(<OverallRating stage="try" fold restarts={1} />);
    expect(box()).toHaveValue("Helps with forms");
    expect(screen.getByRole("button", { name: "Save comment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change them" })).not.toBeInTheDocument();
  });

  it("stays open without a new question, through a reload, as before", async () => {
    stubFetch();
    answered(RATED);
    render(<OverallRating stage="try" />);
    expect(await screen.findByRole("button", { name: "Partly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Change them" })).not.toBeInTheDocument();
  });

  it("asks one question at a time, and saves each tap as the latest answer", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    expect(screen.getByText(/check an answer against the state's official rules today\?/)).toBeInTheDocument();
    // The agency question opens once the first is answered, and its comment once all three are rated (Michaela, Oct 26).
    expect(screen.queryByText("How is AI performing overall in your agency?")).not.toBeInTheDocument();
    // The 5x5 grid, the misread rules and the evening note are gone (the run-through, Oct 22).
    expect(screen.queryByText(/Got the amount right/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Asset tests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share my ratings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Each answer saves as you tap it.");

    fireEvent.click(screen.getByRole("button", { name: "Partly" }));
    expect(screen.getByRole("button", { name: "Partly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("How is AI performing overall in your agency?")).toBeInTheDocument();
    expect(screen.getByText("1 = Not well · 5 = Very well")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "For residents: 2 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For your staff: 4 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For residents: 3 of 5" }));
    expect(screen.queryByLabelText(/Where has AI helped your agency/)).not.toBeInTheDocument();
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(4));
    expect(bodies(fetchMock)).toEqual([
      { participantId: "p-1", kind: "survey", payload: { question: "source-of-truth", answer: "partly" }, stage: "try" },
      {
        participantId: "p-1",
        kind: "discussion",
        payload: { question: "experience", ratings: { residents: 2 }, topics: [], note: "" },
        stage: "try",
      },
      {
        participantId: "p-1",
        kind: "discussion",
        payload: { question: "experience", ratings: { residents: 2, staff: 4 }, topics: [], note: "" },
        stage: "try",
      },
      {
        participantId: "p-1",
        kind: "discussion",
        payload: { question: "experience", ratings: { residents: 3, staff: 4 }, topics: [], note: "" },
        stage: "try",
      },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("Each answer saves as you tap it.");

    fireEvent.click(screen.getByRole("button", { name: "For you: 4 of 5" }));
    expect(box()).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Saved. You'll see the room's results on the screen.");
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(5));
    expect(bodies(fetchMock)[4].payload.ratings).toEqual({ residents: 3, staff: 4, you: 4 });
  });

  it("sends the comment with the agency ratings, and the ratings after it keep the comment", async () => {
    answered(RATED);
    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    expect(screen.getByText(/Optional and anonymous/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save comment" })).not.toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "   " } });
    expect(screen.queryByRole("button", { name: "Save comment" })).not.toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "  Helps staff find policy; residents get wrong amounts  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    // Not "saved" until the store says so.
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Comment saved" })).toBeDisabled();
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(1));
    expect(bodies(fetchMock)[0]).toEqual({
      participantId: "p-1",
      kind: "discussion",
      payload: { question: "experience", ratings: { residents: 1, staff: 2, you: 3 }, topics: [], note: "Helps staff find policy; residents get wrong amounts" },
      stage: "try",
    });

    fireEvent.click(screen.getByRole("button", { name: "For you: 5 of 5" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(2));
    expect(bodies(fetchMock)[1].payload).toEqual({
      question: "experience",
      ratings: { residents: 1, staff: 2, you: 5 },
      topics: [],
      note: "Helps staff find policy; residents get wrong amounts",
    });

    // Editing the comment offers the save again.
    fireEvent.change(box(), { target: { value: "Helps staff" } });
    expect(screen.getByRole("button", { name: "Save comment" })).toBeEnabled();
  });

  it("takes a saved comment back when the box is cleared, and the ratings after it stop carrying it", async () => {
    answered(RATED);
    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    fireEvent.change(box(), { target: { value: "Residents get wrong amounts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(1));
    // Clearing the box offers to remove it, rather than hiding the button.
    fireEvent.change(box(), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Remove comment" }));
    // Not "removed" until the store says so.
    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(2));
    expect(bodies(fetchMock)[1].payload).toEqual({ question: "experience", ratings: { residents: 1, staff: 2, you: 3 }, topics: [], note: "" });
    // Nothing left to save or show as saved.
    await waitFor(() => expect(screen.queryByRole("button", { name: /comment|removing/i })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "For you: 4 of 5" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(3));
    expect(bodies(fetchMock)[2].payload.note).toBe("");
    // And a reload doesn't bring it back.
    expect(JSON.parse(localStorage.getItem("aspen.overall.v2")!).comment).toBe("");
  });

  it("keeps Remove comment after a removal fails, through a reload, until a removal saves", async () => {
    const ok = { ok: true, status: 200, json: async () => ({ ok: true, saved: true }) } as unknown as Response;
    const fail = { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(fail).mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetchMock);
    answered(RATED);
    const first = render(<OverallRating stage="try" />);
    fireEvent.change(box(), { target: { value: "Residents get wrong amounts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove comment" }));
    // The store still has the comment, so the button stays to send the removal again.
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove comment" })).toBeEnabled();

    // A reload (a locked phone often drops the tab) still says so, and still offers it.
    first.unmount();
    render(<OverallRating stage="try" />);
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove comment" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(bodies(fetchMock as unknown as ReturnType<typeof stubFetch>)[2].payload).toEqual({ question: "experience", ratings: { residents: 1, staff: 2, you: 3 }, topics: [], note: "" });
    await waitFor(() => expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /comment/ })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("aspen.overall.v2")!)).toMatchObject({ comment: "", removing: false, unsaved: { discussion: false } });
  });

  it("keeps another tab's newer answer unconfirmed when this tab's older save lands", async () => {
    // Two tabs on one phone share its stored answers, and each sends its own saves.
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    const tabA = render(<OverallRating stage="try" />);
    const tabB = render(<OverallRating stage="try" />);
    fireEvent.click(within(tabA.container).getByRole("button", { name: "No" }));
    fireEvent.click(within(tabB.container).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    // B's fails, then A's older one lands.
    await act(async () => resolvers[1]({ ok: false, status: 500, json: async () => ({}) } as unknown as Response));
    await act(async () => resolvers[0]({ ok: true, status: 200, json: async () => ({ ok: true, saved: true }) } as unknown as Response));
    expect(JSON.parse(localStorage.getItem("aspen.overall.v2")!)).toMatchObject({ truth: "yes", unsaved: { survey: true } });
    tabA.unmount();
    tabB.unmount();
    render(<OverallRating stage="try" />);
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps another tab's comment removal pending when this tab's older agency save lands", async () => {
    localStorage.setItem("aspen.overall.v2", JSON.stringify({ comment: "Too slow" }));
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    const tabA = render(<OverallRating stage="try" />);
    const tabB = render(<OverallRating stage="try" />);
    fireEvent.click(within(tabA.container).getByRole("button", { name: "For you: 4 of 5" }));
    fireEvent.change(within(tabB.container).getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(within(tabB.container).getByRole("button", { name: "Remove comment" }));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    // B's removal fails, then A's older save, still carrying the comment, lands.
    await act(async () => resolvers[1]({ ok: false, status: 500, json: async () => ({}) } as unknown as Response));
    await act(async () => resolvers[0]({ ok: true, status: 200, json: async () => ({ ok: true, saved: true }) } as unknown as Response));
    expect(JSON.parse(localStorage.getItem("aspen.overall.v2")!)).toMatchObject({ comment: "", removing: true, unsaved: { discussion: true } });
    tabA.unmount();
    tabB.unmount();
    render(<OverallRating stage="try" />);
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove comment" })).toBeEnabled();
  });

  it("says Removing while a retried removal is on its way, not Remove comment", async () => {
    const ok = { ok: true, status: 200, json: async () => ({ ok: true, saved: true }) } as unknown as Response;
    const fail = { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    let retried: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(fail)
      .mockImplementationOnce(() => new Promise<Response>((r) => (retried = r)));
    vi.stubGlobal("fetch", fetchMock);
    answered(RATED);
    render(<OverallRating stage="try" />);
    fireEvent.change(box(), { target: { value: "Residents get wrong amounts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.click(await screen.findByRole("button", { name: "Remove comment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove comment" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
    // Typing during the retry offers to save the new text.
    fireEvent.change(box(), { target: { value: "New text" } });
    expect(screen.getByRole("button", { name: "Save comment" })).toBeEnabled();
    fireEvent.change(box(), { target: { value: "" } });
    await act(async () => retried(ok));
    await waitFor(() => expect(screen.queryByRole("button", { name: /comment|removing/i })).not.toBeInTheDocument());
  });

  it("lets only the latest send of a kind decide whether it saved", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    const answer = (ok: boolean) =>
      ({ ok, status: ok ? 200 : 500, json: async () => (ok ? { ok: true, saved: true } : {}) }) as unknown as Response;
    const stored = () => JSON.parse(localStorage.getItem("aspen.overall.v2")!).unsaved;
    answered(TRUTH);
    render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "For residents: 2 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For residents: 4 of 5" }));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    // The first lands while the second is still on its way: not saved yet, as a reload would see it.
    await act(async () => resolvers[0](answer(true)));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    expect(stored()).toEqual({ discussion: true });
    await act(async () => resolvers[1](answer(true)));
    await waitFor(() => expect(stored()).toEqual({ discussion: false }));

    // An earlier failure, followed by a save that lands, leaves nothing to tap again.
    fireEvent.click(screen.getByRole("button", { name: "For residents: 1 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For residents: 5 of 5" }));
    await waitFor(() => expect(resolvers).toHaveLength(3));
    await act(async () => resolvers[2](answer(false)));
    await waitFor(() => expect(resolvers).toHaveLength(4));
    expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument();
    await act(async () => resolvers[3](answer(true)));
    await waitFor(() => expect(stored()).toEqual({ discussion: false }));
    expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument();
  });

  it("doesn't offer Remove comment for a failed rating when there was never a comment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response));
    answered(TRUTH);
    render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "For you: 3 of 5" }));
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /comment/ })).not.toBeInTheDocument();
  });

  it("after a reload, still says a tap that never confirmed didn't save, until it's tapped again", async () => {
    // A send still on its way when the tab went: the phone can't know it landed.
    const hang = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", hang);
    const first = render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(hang).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem("aspen.overall.v2")!).unsaved).toEqual({ survey: true });
    first.unmount();

    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("aspen.overall.v2")!).unsaved).toEqual({ survey: false });
  });

  it("keeps a failed answer to the first question flagged until that answer saves, whatever saves after it", async () => {
    const fail = { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    const ok = { ok: true, status: 200, json: async () => ({ ok: true, saved: true }) } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValueOnce(fail).mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetchMock);
    render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "Partly" }));
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    // The agency ratings save, but the truth answer still hasn't: no "Saved." yet.
    for (const name of ["For residents: 2 of 5", "For your staff: 3 of 5", "For you: 4 of 5"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await act(async () => {});
    expect(screen.getByText("That didn't save. Tap it again.")).toBeInTheDocument();
    expect(screen.queryByText(/Saved\. You'll see/)).not.toBeInTheDocument();
    // Tapping it again saves it, and only then does the phone say so.
    fireEvent.click(screen.getByRole("button", { name: "Partly" }));
    expect(await screen.findByText(/Saved\. You'll see/)).toBeInTheDocument();
  });

  it("offers the comment again after a failed agency save, which may have carried it", async () => {
    const fail = { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fail));
    answered(RATED);
    render(<OverallRating stage="try" />);
    fireEvent.change(box(), { target: { value: "Staff like it" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    expect(await screen.findByRole("button", { name: "Save comment" })).toBeEnabled();
  });

  it("counts a 200 with saved: false, a store failure, as not saved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, saved: false }) } as unknown as Response));
    render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
  });

  it("sends one event at a time, in the order of the taps", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    const fetchMock = vi.fn(() => new Promise<Response>((r) => resolvers.push(r)));
    vi.stubGlobal("fetch", fetchMock);
    const done = () => resolvers[resolvers.length - 1]({ ok: true, status: 200, json: async () => ({ ok: true, saved: true }) } as unknown as Response);
    answered(TRUTH);
    render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "For residents: 2 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For your staff: 4 of 5" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // A slow first send can't land after the second and count as the latest answer.
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => done());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => done());
  });

  it("says when a tap didn't save, and clears it once the next one does", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, saved: true }) } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument());
  });

  it("reports a dropped connection as a failed save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("That didn't save. Tap it again.")).toBeInTheDocument();
  });

  it("shows this phone's answers again after a reload", async () => {
    localStorage.setItem(
      "aspen.overall.v2",
      JSON.stringify({ truth: "no", agency: { residents: 1, staff: 2, you: 3 }, comment: "Too slow" }),
    );
    stubFetch();
    render(<OverallRating stage="try" />);
    expect(await screen.findByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "For your staff: 2 of 5" })).toHaveAttribute("aria-pressed", "true");
    expect(box()).toHaveValue("Too slow");
    expect(screen.getByRole("button", { name: "Comment saved" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("keeps a comment saved before any rating open after a reload, with the scales above it", async () => {
    // Before one question at a time, a comment could be saved first; a reload must not hide it.
    answered({ comment: "Too slow" });
    stubFetch();
    render(<OverallRating stage="try" />);
    expect(await screen.findByRole("button", { name: "Comment saved" })).toBeDisabled();
    expect(box()).toHaveValue("Too slow");
    expect(screen.getByRole("button", { name: "For you: 3 of 5" })).toHaveAttribute("aria-pressed", "false");
  });

  it("opens the comment only once all three are rated, in any order", () => {
    answered(TRUTH);
    stubFetch();
    render(<OverallRating stage="try" />);
    for (const name of ["For you: 2 of 5", "For residents: 4 of 5"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.queryByLabelText(/Where has AI helped your agency/)).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "For your staff: 1 of 5" }));
    expect(box()).toHaveValue("");
  });

  it("ignores answers saved by the old five-step flow", () => {
    localStorage.setItem("aspen.overall.v1", "true");
    stubFetch();
    render(<OverallRating stage="try" />);
    expect(screen.getByRole("status")).toHaveTextContent("Each answer saves as you tap it.");
  });
});
