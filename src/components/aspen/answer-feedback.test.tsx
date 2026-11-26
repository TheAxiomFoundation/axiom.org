import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RatingCard, readRatingDraft } from "./answer-feedback";
import { RATING_KEY, SAVE_TIMEOUT_MS, TAB_KEY, holdTab } from "./client";

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data } as unknown as Response;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("aspen.participant", "p-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  it("writes nothing once another tab has taken over, so it never overwrites that tab's newer failed answer", async () => {
    holdTab();
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    // Another tab takes over, and its Looks right fails.
    const theirs = { rating: { verdict: "right", residentAction: null, wentWell: [], wentWrong: [], note: "" }, step: 0, unsaved: true, pending: "9:other-tab" };
    localStorage.setItem(TAB_KEY, JSON.stringify("other-tab"));
    localStorage.setItem(RATING_KEY, JSON.stringify({ p1: theirs }));
    // This tab's older save lands, and then this tab moves on with Next.
    await act(async () => resolvers[0](jsonResponse({ ok: true, saved: true })));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(readRatingDraft("p1")).toEqual(theirs);
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
