import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPush = vi.fn();

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

// Mock getJurisdictionCounts
const mockGetJurisdictionCounts = vi.fn();

vi.mock("@/lib/tree-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tree-data")>();
  return {
    ...actual,
    getJurisdictionCounts: (...args: unknown[]) =>
      mockGetJurisdictionCounts(...args),
  };
});

// Mock supabase
vi.mock("@/lib/supabase", () => ({
  supabaseCorpus: { from: vi.fn() },
  supabase: { from: vi.fn() },
}));

import { JurisdictionPicker } from "./jurisdiction-picker";

describe("JurisdictionPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockGetJurisdictionCounts.mockReturnValue(new Promise(() => {})); // never resolves
    render(<JurisdictionPicker />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.getByText("Choose a jurisdiction")).toBeInTheDocument();
  });

  it("renders jurisdiction cards with counts", async () => {
    const counts = new Map([
      ["us", 50000],
      ["us-oh", 10000],
      ["uk", 1500],
      ["ca", 2000],
    ]);
    mockGetJurisdictionCounts.mockResolvedValue(counts);

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    expect(screen.getByText("US Federal")).toBeInTheDocument();
    expect(screen.getByText("50,000 rules")).toBeInTheDocument();
    expect(screen.getByText("Ohio")).toBeInTheDocument();
    expect(screen.getByText("10,000 rules")).toBeInTheDocument();
    expect(screen.getByText("United Kingdom")).toBeInTheDocument();
    expect(screen.getByText("1,500 rules")).toBeInTheDocument();
    expect(screen.getByText("Canada")).toBeInTheDocument();
    expect(screen.getByText("2,000 rules")).toBeInTheDocument();
  });

  it("labels Israel and Illinois from their distinct seed slugs", async () => {
    const counts = new Map([
      ["il", 42],
      ["us-il", 7],
    ]);
    mockGetJurisdictionCounts.mockResolvedValue(counts);

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    expect(screen.getByText("Israel")).toBeInTheDocument();
    expect(screen.getByText("42 rules")).toBeInTheDocument();
    expect(screen.getByText("Illinois")).toBeInTheDocument();
    expect(screen.getByText("7 rules")).toBeInTheDocument();
  });

  it("hides Israel until its pilot corpus is ingested", async () => {
    mockGetJurisdictionCounts.mockResolvedValue(new Map([["us", 50000]]));

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    expect(screen.getByText("US Federal")).toBeInTheDocument();
    expect(screen.queryByText("Israel")).not.toBeInTheDocument();
  });

  it("filters out jurisdictions with zero rules", async () => {
    const counts = new Map([
      ["us", 50000],
      ["us-oh", 0],
      ["uk", 0],
      ["ca", 0],
    ]);
    mockGetJurisdictionCounts.mockResolvedValue(counts);

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    expect(screen.getByText("US Federal")).toBeInTheDocument();
    expect(screen.queryByText("Ohio")).not.toBeInTheDocument();
    expect(screen.queryByText("United Kingdom")).not.toBeInTheDocument();
    expect(screen.queryByText("Canada")).not.toBeInTheDocument();
  });

  it("shows empty state when all counts are zero", async () => {
    mockGetJurisdictionCounts.mockResolvedValue(new Map());

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    expect(screen.getByText("No jurisdictions found.")).toBeInTheDocument();
  });

  it("navigates on card click", async () => {
    const counts = new Map([
      ["us", 100],
      ["uk", 50],
    ]);
    mockGetJurisdictionCounts.mockResolvedValue(counts);

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByText("US Federal"));
    expect(mockPush).toHaveBeenCalledWith("/us");
  });

  it("navigates on Enter key", async () => {
    const counts = new Map([["uk", 50]]);
    mockGetJurisdictionCounts.mockResolvedValue(counts);

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    fireEvent.keyDown(screen.getByText("United Kingdom"), {
      key: "Enter",
    });
    expect(mockPush).toHaveBeenCalledWith("/uk");
  });

  it("navigates on Space key", async () => {
    const counts = new Map([["uk", 50]]);
    mockGetJurisdictionCounts.mockResolvedValue(counts);

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    fireEvent.keyDown(screen.getByText("United Kingdom"), {
      key: " ",
    });
    expect(mockPush).toHaveBeenCalledWith("/uk");
  });

  it("does not navigate on other keys", async () => {
    const counts = new Map([["uk", 50]]);
    mockGetJurisdictionCounts.mockResolvedValue(counts);

    render(<JurisdictionPicker />);

    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument()
    );

    fireEvent.keyDown(screen.getByText("United Kingdom"), {
      key: "Tab",
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
