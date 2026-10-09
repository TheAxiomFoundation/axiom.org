import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverallRating, ScaleRow } from "./overall-rating";

function stubFetch() {
  const mock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as unknown as Response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function bodies(mock: ReturnType<typeof stubFetch>) {
  return mock.mock.calls
    .filter(([url]) => url === "/api/aspen/event")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
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

describe("OverallRating", () => {
  it("rates both scales and shares one event per rated question", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    expect(screen.getByText("1 = Not at all · 5 = Fully")).toBeInTheDocument();
    expect(screen.getByText("1 = Mostly a problem · 5 = Mostly a help")).toBeInTheDocument();
    const share = screen.getByRole("button", { name: "Share my ratings" });
    expect(share).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Got the amount right: 2 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Got the amount right: 3 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Admitted what it didn't know: 1 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "For your staff: 4 of 5" }));
    expect(share).toBeEnabled();
    fireEvent.click(share);

    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(2));
    expect(bodies(fetchMock)).toEqual([
      {
        participantId: "p-1",
        kind: "discussion",
        payload: { question: "performance", ratings: { amount: 3, uncertainty: 1 }, topics: [], note: "" },
        stage: "try",
      },
      {
        participantId: "p-1",
        kind: "discussion",
        payload: { question: "experience", ratings: { staff: 4 }, topics: [], note: "" },
        stage: "try",
      },
    ]);
    expect(screen.getByText(/Your ratings are in/)).toBeInTheDocument();
    expect(localStorage.getItem("aspen.overall.v1")).toBe("true");
  });

  it("shares a note on its own, as a note about the evening", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="rate" />);
    const share = screen.getByRole("button", { name: "Share my ratings" });
    fireEvent.change(screen.getByLabelText(/What should the room hear\?/), { target: { value: "   " } });
    expect(share).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What should the room hear\?/), { target: { value: "Staff already use it for policy lookups" } });
    expect(share).toBeEnabled();
    fireEvent.click(share);
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(1));
    expect(bodies(fetchMock)[0]).toEqual({
      participantId: "p-1",
      kind: "discussion",
      payload: { question: null, ratings: {}, topics: [], note: "Staff already use it for policy lookups" },
      stage: "rate",
    });
  });

  it("sends the note alongside the ratings", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="rate" />);
    fireEvent.click(screen.getByRole("button", { name: "Was clear to a resident: 4 of 5" }));
    fireEvent.change(screen.getByLabelText(/What should the room hear\?/), { target: { value: "Clear but wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Share my ratings" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(2));
    expect(bodies(fetchMock).map((b) => b.payload.question)).toEqual(["performance", null]);
  });

  it("shares the source-of-truth answer and the misread rules", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="rate" />);
    const yes = screen.getByRole("button", { name: "Partly" });
    fireEvent.click(yes);
    expect(yes).toHaveAttribute("aria-pressed", "true");
    const assets = screen.getByRole("button", { name: "Asset tests" });
    fireEvent.click(assets);
    fireEvent.click(screen.getByRole("button", { name: "Benefit cliffs" }));
    fireEvent.click(assets);
    expect(assets).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Share my ratings" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(2));
    expect(bodies(fetchMock)).toEqual([
      { participantId: "p-1", kind: "survey", payload: { question: "source-of-truth", answer: "partly" }, stage: "rate" },
      {
        participantId: "p-1",
        kind: "discussion",
        payload: { question: "misunderstood", topics: ["Benefit cliffs"], ratings: {}, note: "" },
        stage: "rate",
      },
    ]);
  });

  it("skips a question nobody rated", async () => {
    const fetchMock = stubFetch();
    render(<OverallRating stage="try" />);
    fireEvent.click(screen.getByRole("button", { name: "For residents: 2 of 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Share my ratings" }));
    await waitFor(() => expect(bodies(fetchMock)).toHaveLength(1));
    expect(bodies(fetchMock)[0].payload).toMatchObject({ question: "experience", ratings: { residents: 2 } });
  });

  it("shows the thank-you once a phone has shared", async () => {
    localStorage.setItem("aspen.overall.v1", "true");
    stubFetch();
    render(<OverallRating stage="try" />);
    expect(await screen.findByText(/Your ratings are in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share my ratings" })).not.toBeInTheDocument();
  });
});
