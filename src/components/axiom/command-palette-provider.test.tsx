import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CommandPaletteProvider,
  useCommandPalette,
} from "./command-palette-provider";

vi.mock("./command-palette", () => ({
  CommandPalette: ({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) => (
    <div data-open={open} data-testid="palette">
      <button type="button" onClick={onClose}>
        close palette
      </button>
    </div>
  ),
}));

function PaletteConsumer() {
  const palette = useCommandPalette();
  return (
    <div>
      <span data-testid="state">{palette.isOpen ? "open" : "closed"}</span>
      <button type="button" onClick={palette.open}>
        open
      </button>
      <button type="button" onClick={palette.close}>
        close
      </button>
    </div>
  );
}

describe("CommandPaletteProvider", () => {
  it("opens and closes the mounted palette through context", () => {
    render(
      <CommandPaletteProvider>
        <PaletteConsumer />
      </CommandPaletteProvider>
    );

    expect(screen.getByTestId("state")).toHaveTextContent("closed");
    expect(screen.getByTestId("palette")).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    expect(screen.getByTestId("palette")).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByRole("button", { name: "close palette" }));
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("ignores the retired ⌘K shortcut — the palette opens only via explicit triggers", () => {
    render(
      <CommandPaletteProvider>
        <PaletteConsumer />
      </CommandPaletteProvider>
    );

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("state")).toHaveTextContent("closed");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("provides a no-op default context outside the provider", () => {
    render(<PaletteConsumer />);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });
});
