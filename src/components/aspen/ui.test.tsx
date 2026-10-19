import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BarRow, Bars, Card, Chip, Eyebrow, StageHeading, Stat } from "./ui";

const widthOf = (label: string) =>
  (screen.getByTitle(label).nextElementSibling?.firstElementChild as HTMLElement).style.width;

describe("Chip", () => {
  it("reflects its pressed state and reports clicks", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Chip onClick={onClick}>Yes</Chip>);
    const chip = screen.getByRole("button", { name: "Yes" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Chip selected className="extra" onClick={onClick}>
        Yes
      </Chip>,
    );
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveClass("extra", "text-white");
  });

  it("can be disabled", () => {
    const onClick = vi.fn();
    render(
      <Chip disabled onClick={onClick}>
        No
      </Chip>,
    );
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("text pieces", () => {
  it("renders an eyebrow, a card and a stat", () => {
    render(
      <Card className="custom-card">
        <Eyebrow className="custom-eyebrow">Label</Eyebrow>
        <Stat value={42} label="people" />
      </Card>,
    );
    expect(screen.getByText("Label")).toHaveClass("custom-eyebrow");
    expect(screen.getByText("Label").parentElement).toHaveClass("custom-card");
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("people")).toBeInTheDocument();
  });

  it("renders a stage heading with and without a summary", () => {
    const { rerender } = render(<StageHeading eyebrow="02 · Try it" title="Ask the AI" summary="Start here." />);
    expect(screen.getByRole("heading", { level: 1, name: "Ask the AI" })).toBeInTheDocument();
    expect(screen.getByText("02 · Try it")).toBeInTheDocument();
    expect(screen.getByText("Start here.")).toBeInTheDocument();
    rerender(<StageHeading eyebrow="02 · Try it" title="Ask the AI" />);
    expect(screen.queryByText("Start here.")).not.toBeInTheDocument();
  });
});

describe("BarRow", () => {
  it("scales the bar to the max, with a visible floor for small counts", () => {
    render(
      <div>
        <BarRow label="Big" count={50} max={50} tone="good" />
        <BarRow label="Tiny" count={1} max={100} tone="bad" />
        <BarRow label="None" count={0} max={100} tone="ink" />
        <BarRow label="Empty max" count={0} max={0} />
      </div>,
    );
    expect(widthOf("Big")).toBe("100%");
    expect(widthOf("Tiny")).toBe("4%");
    expect(widthOf("None")).toBe("0%");
    expect(widthOf("Empty max")).toBe("0%");
    expect((screen.getByTitle("Big").nextElementSibling?.firstElementChild as HTMLElement).style.background).toBe(
      "var(--color-success)",
    );
    expect((screen.getByTitle("Tiny").nextElementSibling?.firstElementChild as HTMLElement).style.background).toBe(
      "var(--color-error)",
    );
  });
});

describe("Bars", () => {
  const items = [
    { id: "a", label: "Alpha", count: 5 },
    { id: "b", label: "Beta", count: 0 },
    { id: "c", label: "Gamma", count: 2 },
  ];

  it("shows every item without a limit, zeros included", () => {
    render(<Bars items={items} />);
    expect(screen.getByTitle("Alpha")).toBeInTheDocument();
    expect(screen.getByTitle("Beta")).toBeInTheDocument();
    expect(screen.getByTitle("Gamma")).toBeInTheDocument();
  });

  it("with a limit, shows only the first items that have a count", () => {
    render(<Bars items={items} limit={2} />);
    expect(screen.getByTitle("Alpha")).toBeInTheDocument();
    expect(screen.queryByTitle("Beta")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Gamma")).not.toBeInTheDocument();
  });

  it("shows the empty text when every count is zero", () => {
    const { rerender } = render(<Bars items={[{ id: "a", label: "Alpha", count: 0 }]} />);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
    rerender(<Bars items={[]} empty="Pick topics from your phone." />);
    expect(screen.getByText("Pick topics from your phone.")).toBeInTheDocument();
  });
});
