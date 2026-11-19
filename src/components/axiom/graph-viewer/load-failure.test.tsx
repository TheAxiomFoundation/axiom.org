import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNAVAILABLE_MESSAGE, type LoadFailure } from "./api";
import { LoadFailureNotice, retryDelaySeconds } from "./load-failure";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const unavailable: LoadFailure = {
  kind: "unavailable",
  message: UNAVAILABLE_MESSAGE,
  reference: "HTTP 503 · mirror_unavailable · request req-123",
};

describe("retry pacing", () => {
  it("retries at once the first time, then waits 2, 4, 8, 16 and at most 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelaySeconds)).toEqual([0, 2, 4, 8, 16, 30, 30]);
  });
});

describe("LoadFailureNotice", () => {
  it("says an outage calmly: a status, the sentence, Retry and one reference line", () => {
    const onRetry = vi.fn();
    render(<LoadFailureNotice failure={unavailable} attempt={0} onRetry={onRetry} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Temporarily unavailable");
    expect(notice).toHaveTextContent(UNAVAILABLE_MESSAGE);
    expect(notice).toHaveTextContent("Reference for support: HTTP 503 · mirror_unavailable · request req-123");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("holds a repeated retry for the backoff, counting down", () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(<LoadFailureNotice failure={unavailable} attempt={1} onRetry={onRetry} />);
    const button = screen.getByRole("button", { name: "Retry in 2 s" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("button", { name: "Retry in 1 s" })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("announces a real error as an alert, with no reference line when there is none", () => {
    render(<LoadFailureNotice failure={{ kind: "client", message: "This rule graph could not be loaded.", reference: null }} attempt={0} onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This rule graph could not be loaded.");
    expect(screen.queryByText(/Reference for support/)).toBeNull();
  });
});
