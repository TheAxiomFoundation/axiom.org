import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnswerText, parseBlocks, renderInline } from "./answer-text";

describe("parseBlocks", () => {
  it("joins wrapped lines into one paragraph and splits on blank lines", () => {
    expect(parseBlocks("First line\nsecond line\n\nNext paragraph")).toEqual([
      { type: "p", text: "First line second line" },
      { type: "p", text: "Next paragraph" },
    ]);
  });

  it("normalizes CRLF line endings", () => {
    expect(parseBlocks("One\r\nTwo")).toEqual([{ type: "p", text: "One Two" }]);
  });

  it("reads headings, bullets and numbered lists", () => {
    expect(parseBlocks("## Summary\n- one\n* two\n• three\n1. first\n2) second")).toEqual([
      { type: "h", text: "Summary" },
      { type: "ul", items: ["one", "two", "three"] },
      { type: "ol", items: ["first", "second"] },
    ]);
  });

  it("adds an indented line to the previous list item", () => {
    expect(parseBlocks("- item one\n  continues here\n1. numbered\n   more")).toEqual([
      { type: "ul", items: ["item one continues here"] },
      { type: "ol", items: ["numbered more"] },
    ]);
  });

  it("treats an indented line after a paragraph as part of the paragraph", () => {
    expect(parseBlocks("Intro\n  indented")).toEqual([{ type: "p", text: "Intro indented" }]);
  });

  it("parses a table and skips its separator row", () => {
    expect(parseBlocks("Before\n| Item | Amount |\n| --- | :---: |\n| Rent | $900 |\nAfter")).toEqual([
      { type: "p", text: "Before" },
      {
        type: "table",
        rows: [
          ["Item", "Amount"],
          ["Rent", "$900"],
        ],
      },
      { type: "p", text: "After" },
    ]);
  });

  it("returns no blocks for blank input", () => {
    expect(parseBlocks("\n  \n")).toEqual([]);
  });
});

describe("renderInline", () => {
  it("returns plain text unchanged", () => {
    expect(renderInline("just text")).toEqual(["just text"]);
  });
});

describe("AnswerText", () => {
  it("renders headings, lists, tables, bold and links", () => {
    const text = [
      "### What you can get",
      "You may get **$24** a month.",
      "",
      "- Apply at [Arizona DES](https://des.az.gov/snap)",
      "- Or see https://www.fns.usda.gov/snap/",
      "",
      "1. Gather documents",
      "2. Apply online",
      "",
      "| Program | Amount |",
      "|---|---|",
      "| SNAP | **$24** |",
    ].join("\n");
    const { container } = render(<AnswerText text={text} />);

    expect(screen.getByText("What you can get")).toHaveClass("font-semibold");
    expect(container.querySelectorAll("strong")).toHaveLength(2);
    expect(container.querySelector("ul")).toHaveClass("list-disc");
    expect(container.querySelector("ol")).toHaveClass("list-decimal");
    expect(container.querySelectorAll("li")).toHaveLength(4);

    const named = screen.getByRole("link", { name: "Arizona DES" });
    expect(named).toHaveAttribute("href", "https://des.az.gov/snap");
    expect(named).toHaveAttribute("rel", "noopener noreferrer");
    expect(named).toHaveAttribute("target", "_blank");

    const bare = screen.getByRole("link", { name: "fns.usda.gov/snap" });
    expect(bare).toHaveAttribute("href", "https://www.fns.usda.gov/snap/");
    expect(bare).toHaveAttribute("rel", "noopener noreferrer");

    expect(screen.getByRole("columnheader", { name: "Program" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "SNAP" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("uses the given class name, or a default", () => {
    const { container, rerender } = render(<AnswerText text="Hello" className="custom" />);
    expect(container.firstChild).toHaveClass("custom");
    rerender(<AnswerText text="Hello" />);
    expect(container.firstChild).toHaveClass("flex", "flex-col", "gap-3");
  });

  it("never renders raw HTML from the model", () => {
    const { container } = render(<AnswerText text={'<img src=x onerror="alert(1)"> and <b>bold</b>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)"> and <b>bold</b>');
  });

  it("keeps text around inline marks in order", () => {
    const { container } = render(<AnswerText text="Before **mid** after" />);
    expect(container.querySelector("p")?.innerHTML).toBe("Before <strong>mid</strong> after");
  });
});
