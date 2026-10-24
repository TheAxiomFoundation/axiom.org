import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("OverallRating", () => {
  it("asks both questions on one screen, and saves each tap as the latest answer", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    expect(screen.getByText(/check an answer against the state's official rules today\?/)).toBeInTheDocument();
    expect(screen.getByText("How is AI performing overall in your agency?")).toBeInTheDocument();
    expect(screen.getByText("1 = Not well · 5 = Very well")).toBeInTheDocument();
    // The 5x5 grid, the misread rules and the evening note are gone (the run-through, Oct 22).
    expect(screen.queryByText(/Got the amount right/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Asset tests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share my ratings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Each answer saves as you tap it.");

    fireEvent.click(screen.getByRole("button", { name: "Partly" }));
    expect(screen.getByRole("button", { name: "Partly" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "For residents: 2 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For your staff: 4 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For residents: 3 of 5" }));
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
    expect(screen.getByRole("status")).toHaveTextContent("Saved. You'll see the room's results on the screen.");
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(5));
    expect(bodies(fetchMock)[4].payload.ratings).toEqual({ residents: 3, staff: 4, you: 4 });
  });

  it("sends the comment with the agency ratings, and the ratings after it keep the comment", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    expect(screen.getByText(/Optional and anonymous/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save comment" })).not.toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "   " } });
    expect(screen.queryByRole("button", { name: "Save comment" })).not.toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "  Helps staff find policy; residents get wrong amounts  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    expect(screen.getByRole("button", { name: "Comment saved" })).toBeDisabled();
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(1));
    expect(bodies(fetchMock)[0]).toEqual({
      participantId: "p-1",
      kind: "discussion",
      payload: { question: "experience", ratings: {}, topics: [], note: "Helps staff find policy; residents get wrong amounts" },
      stage: "try",
    });

    fireEvent.click(screen.getByRole("button", { name: "For you: 5 of 5" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(2));
    expect(bodies(fetchMock)[1].payload).toEqual({
      question: "experience",
      ratings: { you: 5 },
      topics: [],
      note: "Helps staff find policy; residents get wrong amounts",
    });

    // Editing the comment offers the save again.
    fireEvent.change(box(), { target: { value: "Helps staff" } });
    expect(screen.getByRole("button", { name: "Save comment" })).toBeEnabled();
  });

  it("takes a saved comment back when the box is cleared, and the ratings after it stop carrying it", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    fireEvent.change(box(), { target: { value: "Residents get wrong amounts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(1));
    // Clearing the box offers to remove it, rather than hiding the button.
    fireEvent.change(box(), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Remove comment" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(2));
    expect(bodies(fetchMock)[1].payload).toEqual({ question: "experience", ratings: {}, topics: [], note: "" });
    // Nothing left to save or show as saved.
    expect(screen.queryByRole("button", { name: /comment/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "For you: 3 of 5" }));
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
    expect(bodies(fetchMock as unknown as ReturnType<typeof stubFetch>)[2].payload).toEqual({ question: "experience", ratings: {}, topics: [], note: "" });
    await waitFor(() => expect(screen.queryByText("That didn't save. Tap it again.")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /comment/ })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("aspen.overall.v2")!)).toMatchObject({ comment: "", removing: false, unsaved: { discussion: false } });
  });

  it("lets only the latest send of a kind decide whether it saved", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => resolvers.push(r))));
    const answer = (ok: boolean) =>
      ({ ok, status: ok ? 200 : 500, json: async () => (ok ? { ok: true, saved: true } : {}) }) as unknown as Response;
    const stored = () => JSON.parse(localStorage.getItem("aspen.overall.v2")!).unsaved;
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

  it("ignores answers saved by the old five-step flow", () => {
    localStorage.setItem("aspen.overall.v1", "true");
    stubFetch();
    render(<OverallRating stage="try" />);
    expect(screen.getByRole("status")).toHaveTextContent("Each answer saves as you tap it.");
  });
});
