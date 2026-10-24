import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RatingCard } from "./answer-feedback";

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
  it("asks one question at a time, moves on with each answer, and goes back", () => {
    render(<RatingCard promptId="p1" />);
    expect(screen.getByText("1 of 4")).toBeInTheDocument();
    expect(screen.getByText("Does it look right?")).toBeInTheDocument();
    expect(screen.queryByText("Would you act on it?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save rating" })).not.toBeInTheDocument();

    // Tapping an answer moves on to the next question; the last one leaves the screen.
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    expect(screen.queryByText("Does it look right?")).not.toBeInTheDocument();
    expect(screen.getByText("Would you act on it?")).toHaveFocus();

    // Back shows the answer already picked.
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("button", { name: "Not sure" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));

    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    expect(screen.getByText("3 of 4")).toBeInTheDocument();
    expect(screen.getByText("What would a resident do next?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save rating" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Call to check" }));
    expect(screen.getByText("4 of 4")).toBeInTheDocument();
    expect(screen.getByText(/What went wrong\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wrong amount" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plain and clear" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Anything the room should know about this answer\?/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save rating" })).toBeEnabled();
  });

  it("leads with what went well for a right answer and offers the rest on request", () => {
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText(/What went well\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plain and clear" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wrong amount" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Something went wrong too?" }));
    expect(screen.getByRole("button", { name: "Wrong amount" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Something went wrong too?" })).not.toBeInTheDocument();
  });

  it("posts the rating and reports success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onRated = vi.fn();
    render(<RatingCard promptId="p1" onRated={onRated} />);

    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Not apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Wrong amount" }));
    fireEvent.click(screen.getByRole("button", { name: "Something went well too?" }));
    fireEvent.click(screen.getByRole("button", { name: "Plain and clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Gave a number" }));
    fireEvent.click(screen.getByRole("button", { name: "Plain and clear" }));
    expect(screen.getByRole("button", { name: "Plain and clear" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByLabelText(/Anything the room should know about this answer\?/), { target: { value: "Missed BBCE" } });

    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("Rating saved. Thank you.")).toBeInTheDocument();
    expect(onRated).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/aspen/rate");
    expect(bodyOf(fetchMock)).toEqual({
      participantId: "p-1",
      promptId: "p1",
      verdict: "wrong",
      wouldAct: "no",
      residentAction: "not-apply",
      wentWell: ["Gave a number"],
      wentWrong: ["Wrong amount"],
      note: "Missed BBCE",
    });
  });

  it("shows a saving state while the request is open", async () => {
    let resolve: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r))));
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => resolve(jsonResponse({ ok: true })));
    expect(await screen.findByText("Rating saved. Thank you.")).toBeInTheDocument();
  });

  it("reports a failed save and keeps the form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "no" }, false)));
    const onRated = vi.fn();
    render(<RatingCard promptId="p1" onRated={onRated} />);
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    // One question at a time, so the resident's "Not sure" is the only one on screen.
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("That didn't save. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save rating" })).toBeEnabled();
    expect(onRated).not.toHaveBeenCalled();
  });

  it("reports a dropped connection as a failed save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Not apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("That didn't save. Try again.")).toBeInTheDocument();
  });
});
