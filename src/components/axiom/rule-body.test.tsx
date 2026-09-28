import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { RuleReference } from "@/lib/supabase";

const { searchParamsRef } = vi.hoisted(() => ({
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    title,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    title?: string;
    className?: string;
  }) => (
    <a href={href} title={title} className={className}>
      {children}
    </a>
  ),
}));

import { RuleBody } from "./rule-body";

const ref = (overrides: {
  start_offset: number;
  end_offset: number;
  other_citation_path: string;
  target_resolved?: boolean;
  other_heading?: string | null;
  /** The body the offsets index into. Sets ``citation_text`` to the
   *  exact slice — the contract real extractor rows follow — so the
   *  ref survives re-anchoring. Omit to model a stale ref whose text
   *  no longer appears in the body. */
  body?: string;
  citation_text?: string;
}): RuleReference => ({
  direction: "outgoing",
  citation_text:
    overrides.citation_text ??
    (overrides.body
      ? overrides.body.slice(overrides.start_offset, overrides.end_offset)
      : "placeholder"),
  pattern_kind: "usc",
  confidence: 1,
  start_offset: overrides.start_offset,
  end_offset: overrides.end_offset,
  other_citation_path: overrides.other_citation_path,
  other_provision_id: overrides.target_resolved === false ? null : "resolved-uuid",
  other_heading: overrides.other_heading ?? null,
  target_resolved: overrides.target_resolved ?? true,
});

describe("RuleBody", () => {
  it("renders empty when body is empty", () => {
    const { container } = render(<RuleBody body="" refs={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders plain body when there are no refs", () => {
    render(<RuleBody body="Hello plain world." refs={[]} />);
    expect(screen.getByText("Hello plain world.")).toBeInTheDocument();
    expect(
      screen.queryByRole("link")
    ).not.toBeInTheDocument();
  });

  it("lets each paragraph set its own base direction", () => {
    // Hebrew provisions must lay out right-to-left; dir="auto" picks
    // the direction from the first strong character, so "(א) המס…"
    // reads RTL and English text is unchanged.
    const hebrew = "(א) המס על הכנסתו החייבת של יחיד בשנת המס יהיה כלהלן:";
    const { container } = render(
      <RuleBody body={`${hebrew}\n\nAn English paragraph.`} refs={[]} />
    );
    const paragraphs = Array.from(container.querySelectorAll("p"));
    expect(paragraphs).toHaveLength(2);
    for (const paragraph of paragraphs) {
      expect(paragraph).toHaveAttribute("dir", "auto");
    }
    expect(paragraphs[0]).toHaveTextContent(hebrew);
  });

  it("splices a single citation into the body as a link", () => {
    const body = "See 42 U.S.C. 9902(2) for definitions.";
    const start = body.indexOf("42 U.S.C. 9902(2)");
    const end = start + "42 U.S.C. 9902(2)".length;
    render(
      <RuleBody
        body={body}
        refs={[
          ref({
            start_offset: start,
            end_offset: end,
            other_citation_path: "us/statute/42/9902/2",
            body,
          }),
        ]}
      />
    );
    const link = screen.getByRole("link", { name: "42 U.S.C. 9902(2)" });
    expect(link).toHaveAttribute("href", "/us/statute/42/9902/2");
  });

  it("renders the surrounding plain text in order", () => {
    const body = "See 42 U.S.C. 9902 for rules.";
    const start = body.indexOf("42 U.S.C. 9902");
    const end = start + "42 U.S.C. 9902".length;
    const { container } = render(
      <RuleBody
        body={body}
        refs={[
          ref({
            start_offset: start,
            end_offset: end,
            other_citation_path: "us/statute/42/9902",
            body,
          }),
        ]}
      />
    );
    // Reconstruct the visible text without markup
    const text = container.querySelector("[data-testid='rule-body-inline']")?.textContent;
    expect(text).toBe(body);
  });

  it("styles resolved refs with the accent color and unresolved with dotted underline", () => {
    const body = "First 26 USC 32 and later 99 USC 9999.";
    const ref1Start = body.indexOf("26 USC 32");
    const ref2Start = body.indexOf("99 USC 9999");
    render(
      <RuleBody
        body={body}
        refs={[
          ref({
            start_offset: ref1Start,
            end_offset: ref1Start + "26 USC 32".length,
            other_citation_path: "us/statute/26/32",
            target_resolved: true,
            body,
          }),
          ref({
            start_offset: ref2Start,
            end_offset: ref2Start + "99 USC 9999".length,
            other_citation_path: "us/statute/99/9999",
            target_resolved: false,
            body,
          }),
        ]}
      />
    );
    const resolved = screen.getByRole("link", { name: "26 USC 32" });
    const unresolved = screen.getByRole("link", { name: "99 USC 9999" });
    expect(resolved.className).toMatch(/color-accent/);
    expect(unresolved.className).toMatch(/decoration-dotted/);
    expect(unresolved).toHaveAttribute(
      "title",
      expect.stringContaining("not yet ingested")
    );
  });

  it("includes the target heading in the tooltip when available", () => {
    const body = "See 26 USC 32.";
    const start = body.indexOf("26 USC 32");
    render(
      <RuleBody
        body={body}
        refs={[
          ref({
            start_offset: start,
            end_offset: start + "26 USC 32".length,
            other_citation_path: "us/statute/26/32",
            target_resolved: true,
            other_heading: "Earned income",
            body,
          }),
        ]}
      />
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("title", "us/statute/26/32 — Earned income");
  });

  it("skips refs whose end_offset exceeds the body length", () => {
    render(
      <RuleBody
        body="Short body."
        refs={[
          ref({
            start_offset: 0,
            end_offset: 9999,
            other_citation_path: "us/statute/42/9902",
          }),
        ]}
      />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Short body.")).toBeInTheDocument();
  });

  it("skips refs whose start_offset comes before the cursor (overlapping)", () => {
    // Two refs where the second starts inside the first — splice() keeps
    // only the first and skips the second so the body isn't double-rendered.
    const body = "42 U.S.C. 9902 text here.";
    render(
      <RuleBody
        body={body}
        refs={[
          ref({
            start_offset: 0,
            end_offset: 14,
            other_citation_path: "us/statute/42/9902",
            body,
          }),
          ref({
            start_offset: 5,
            end_offset: 14,
            other_citation_path: "us/statute/42/9902",
            body,
          }),
        ]}
      />
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
  });

  it("skips zero-width refs", () => {
    render(
      <RuleBody
        body="Body text."
        refs={[
          ref({
            start_offset: 4,
            end_offset: 4,
            other_citation_path: "us/statute/42/9902",
          }),
        ]}
      />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("preserves paragraph breaks via pre-wrap", () => {
    const { container } = render(
      <RuleBody body={"Line 1.\n\nLine 2."} refs={[]} />
    );
    const pane = container.querySelector(
      "[data-testid='rule-body-inline']"
    ) as HTMLElement;
    expect(pane).not.toBeNull();
    expect(pane.className).toMatch(/whitespace-pre-wrap/);
  });

  it("renders newline-delimited source paragraphs with vertical spacing", () => {
    const { container } = render(
      <RuleBody
        body={"(3) Repealed.\n(4) For purposes of this article."}
        refs={[]}
      />
    );
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("(3) Repealed.");
    expect(paragraphs[1]).toHaveTextContent(
      "(4) For purposes of this article."
    );
    expect(paragraphs[1].className).toMatch(/mt-5/);
  });

  it("treats hard-wrapped prose lines as one paragraph", () => {
    const { container } = render(
      <RuleBody
        body={
          "Colorado's SNAP rule manual allows the total dollar amount a household is\n" +
          "responsible to pay for dependent care expenses when the care is necessary\n" +
          "for employment, seeking employment, or training."
        }
        refs={[]}
      />
    );
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveTextContent(
      "Colorado's SNAP rule manual allows the total dollar amount a household is responsible to pay for dependent care expenses when the care is necessary for employment, seeking employment, or training."
    );
  });

  it("bolds and separates source labels inside the source text", () => {
    const { container } = render(
      <RuleBody
        body={"(4) For purposes of this article.\nSource: L. 87: Entire part R&RE, p. 1436."}
        refs={[]}
      />
    );
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs[1].className).toMatch(/mt-7/);
    expect(screen.getByText("Source:").closest("strong")).not.toBeNull();
  });

  it("bolds source labels at the start of source text", () => {
    render(
      <RuleBody
        body={"Source: L. 87: Entire part R&RE, p. 1436."}
        refs={[]}
      />
    );
    expect(screen.getByText("Source:").closest("strong")).not.toBeNull();
  });

  it("infers relative Colorado statute section links from citation context", () => {
    render(
      <RuleBody
        body="The rate prescribed by section 39-22-104 applies."
        refs={[]}
        citationPath="us-co/statute/crs/39-22-105"
      />
    );
    const link = screen.getByRole("link", { name: "section 39-22-104" });
    expect(link).toHaveAttribute("href", "/us-co/statute/crs/39-22-104");
    expect(link).toHaveAttribute(
      "title",
      "Inferred link to us-co/statute/crs/39-22-104"
    );
  });

  it("infers relative CFR section links from citation context", () => {
    render(
      <RuleBody
        body="Residents shall be handled in accordance with § 273.11(g)."
        refs={[]}
        citationPath="us/regulation/7/273/3"
      />
    );
    const link = screen.getByRole("link", { name: "§ 273.11(g)" });
    expect(link).toHaveAttribute("href", "/us/regulation/7/273/11/g");
  });

  it("does not duplicate corpus-provided reference links with inferred links", () => {
    const body = "See section 39-22-104 for the rate.";
    const start = body.indexOf("section 39-22-104");
    render(
      <RuleBody
        body={body}
        citationPath="us-co/statute/crs/39-22-105"
        refs={[
          ref({
            start_offset: start,
            end_offset: start + "section 39-22-104".length,
            other_citation_path: "us-co/statute/crs/39-22-104",
            body,
          }),
        ]}
      />
    );
    expect(
      screen.getAllByRole("link", { name: "section 39-22-104" })
    ).toHaveLength(1);
  });

  it("renders markdown table blocks as accessible tables", () => {
    const body = [
      "(1) Percentages",
      "| In the case of an eligible individual with: | The credit percentage is: |",
      "| ------------------------------------------- | ------------------------- |",
      "| 1 qualifying child | 34 |",
      "| 2 qualifying children | 40 |",
      "After table.",
    ].join("\n");

    render(<RuleBody body={body} refs={[]} />);

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    // One direction for the whole block, on the scroll container; the
    // table and its cells inherit it, so a lone Latin cell in a Hebrew
    // table cannot flip out of its column and the scroll starts at the
    // first column.
    expect(table.parentElement).toHaveAttribute("dir", "auto");
    expect(table).not.toHaveAttribute("dir");
    expect(table.querySelector("th[dir], td[dir]")).toBeNull();
    expect(
      screen.getByRole("columnheader", {
        name: "In the case of an eligible individual with:",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1 qualifying child" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "34" })).toBeInTheDocument();
    expect(screen.getByText("(1) Percentages")).toBeInTheDocument();
    expect(screen.getByText("After table.")).toBeInTheDocument();
  });

  it("renders inline markdown table runs from corpus text", () => {
    const body =
      "(1) Percentages The credit percentage shall be determined as follows: " +
      "| In the case of an eligible individual with: | The credit percentage is: | " +
      "| ------------------------------------------- | ------------------------- | " +
      "| 1 qualifying child | 34 | " +
      "| 2 qualifying children | 40 | " +
      "(2) Amounts shall be determined as follows: " +
      "| Children | Amount | " +
      "| -------- | ------ | " +
      "| No qualifying children | $4,220 |";

    render(<RuleBody body={body} refs={[]} />);

    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(screen.getByRole("cell", { name: "2 qualifying children" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "$4,220" })).toBeInTheDocument();
    expect(screen.getByText(/Percentages/)).toBeInTheDocument();
    expect(screen.getByText(/Amounts/)).toBeInTheDocument();
  });

  it("does not treat ordinary pipe text as a table", () => {
    const body = "A | B is legal text, not a markdown table.";
    render(<RuleBody body={body} refs={[]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
  });

  it("preserves citation links inside table cells", () => {
    const body = [
      "| Source | Amount |",
      "| ------ | ------ |",
      "| See 26 USC 32 | $1 |",
    ].join("\n");
    const start = body.indexOf("26 USC 32");

    render(
      <RuleBody
        body={body}
        refs={[
          ref({
            start_offset: start,
            end_offset: start + "26 USC 32".length,
            other_citation_path: "us/statute/26/32",
            body,
          }),
        ]}
      />
    );

    const link = screen.getByRole("link", { name: "26 USC 32" });
    expect(link).toHaveAttribute("href", "/us/statute/26/32");
    expect(link.closest("td")).toHaveTextContent("See 26 USC 32");
  });

  it("sorts unsorted but disjoint refs into offset order", () => {
    // Caller hands us refs in reverse order; splice() must sort them
    // so both are emitted in the right position rather than silently
    // dropping the second as an apparent overlap.
    const body = "First 26 USC 32, then 42 USC 9902.";
    const r1s = body.indexOf("26 USC 32");
    const r2s = body.indexOf("42 USC 9902");
    render(
      <RuleBody
        body={body}
        refs={[
          ref({
            start_offset: r2s,
            end_offset: r2s + "42 USC 9902".length,
            other_citation_path: "us/statute/42/9902",
            body,
          }),
          ref({
            start_offset: r1s,
            end_offset: r1s + "26 USC 32".length,
            other_citation_path: "us/statute/26/32",
            body,
          }),
        ]}
      />
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "26 USC 32",
      "42 USC 9902",
    ]);
  });

  it("renders multiple refs in offset order with plain text between them", () => {
    const body = "See 26 USC 32, 42 USC 9902, and also more.";
    const r1s = body.indexOf("26 USC 32");
    const r2s = body.indexOf("42 USC 9902");
    render(
      <RuleBody
        body={body}
        refs={[
          ref({
            start_offset: r1s,
            end_offset: r1s + "26 USC 32".length,
            other_citation_path: "us/statute/26/32",
            body,
          }),
          ref({
            start_offset: r2s,
            end_offset: r2s + "42 USC 9902".length,
            other_citation_path: "us/statute/42/9902",
            body,
          }),
        ]}
      />
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "26 USC 32",
      "42 USC 9902",
    ]);
  });

  describe("stale stored offsets", () => {
    it("re-anchors refs whose offsets point at the wrong words", () => {
      // Production extractor rows frequently carry offsets computed
      // against an older body revision — the span lands mid-word.
      const body = "Compare with 42 U.S.C. 601 for assistance programs.";
      render(
        <RuleBody
          body={body}
          refs={[
            ref({
              start_offset: 0,
              end_offset: 13,
              other_citation_path: "us/statute/42/601",
              citation_text: "42 U.S.C. 601",
            }),
          ]}
        />
      );
      const link = screen.getByRole("link", { name: "42 U.S.C. 601" });
      expect(link).toHaveAttribute("href", "/us/statute/42/601");
    });

    it("re-anchors refs whose offsets exceed the body length", () => {
      const body = "Refer to 26 U.S.C. 32 here.";
      render(
        <RuleBody
          body={body}
          refs={[
            ref({
              start_offset: 70000,
              end_offset: 70013,
              other_citation_path: "us/statute/26/32",
              citation_text: "26 U.S.C. 32",
            }),
          ]}
        />
      );
      expect(
        screen.getByRole("link", { name: "26 U.S.C. 32" })
      ).toHaveAttribute("href", "/us/statute/26/32");
    });

    it("drops the inline link when the citation text is absent from the body", () => {
      render(
        <RuleBody
          body="This body never mentions the citation."
          refs={[
            ref({
              start_offset: 3,
              end_offset: 16,
              other_citation_path: "us/statute/42/601",
              citation_text: "42 U.S.C. 601",
            }),
          ]}
        />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(
        screen.getByText("This body never mentions the citation.")
      ).toBeInTheDocument();
    });

    it("assigns repeated citation texts to successive occurrences", () => {
      const body = "See section 1931 first and section 1931 again.";
      const refFor = (path: string) =>
        ref({
          start_offset: 90000,
          end_offset: 90012,
          other_citation_path: path,
          citation_text: "section 1931",
        });
      render(
        <RuleBody
          body={body}
          refs={[refFor("us/statute/42/1396u-1"), refFor("us/statute/42/1396u-1")]}
        />
      );
      const links = screen.getAllByRole("link", { name: "section 1931" });
      expect(links).toHaveLength(2);
    });
  });

  describe("inferred reference guards", () => {
    it("does not extend inferred links into prose parentheticals", () => {
      render(
        <RuleBody
          body="See section 911 (relating to citizens or residents living abroad) for details."
          refs={[]}
          citationPath="us/statute/26/32"
        />
      );
      const link = screen.getByRole("link", { name: "section 911" });
      expect(link).toHaveAttribute("href", "/us/statute/26/911");
    });

    it("does not link sections of a different named Act into the current title", () => {
      render(
        <RuleBody
          body="As defined in section 205(c)(2)(B)(i) of the Social Security Act."
          refs={[]}
          citationPath="us/statute/26/32"
        />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("?mark= highlighting", () => {
    it("wraps the marked byte range in a <mark>", () => {
      const body = "This rule refers to earned income credit somewhere.";
      const start = body.indexOf("earned income credit");
      const end = start + "earned income credit".length;
      searchParamsRef.current = new URLSearchParams(`mark=${start}-${end}`);
      const { container } = render(<RuleBody body={body} refs={[]} />);
      const mark = container.querySelector("mark");
      expect(mark?.textContent).toBe("earned income credit");
      searchParamsRef.current = new URLSearchParams();
    });

    it("ignores malformed mark values", () => {
      const body = "Body without any highlight.";
      searchParamsRef.current = new URLSearchParams("mark=abc");
      const { container } = render(<RuleBody body={body} refs={[]} />);
      expect(container.querySelector("mark")).toBeNull();
      searchParamsRef.current = new URLSearchParams();
    });

    it("keeps citation links when the mark overlaps a ref", () => {
      const body = "See 42 U.S.C. 9902 for definitions.";
      const refStart = body.indexOf("42 U.S.C. 9902");
      const refEnd = refStart + "42 U.S.C. 9902".length;
      searchParamsRef.current = new URLSearchParams(
        `mark=${refStart}-${refEnd}`
      );
      render(
        <RuleBody
          body={body}
          refs={[
            ref({
              start_offset: refStart,
              end_offset: refEnd,
              other_citation_path: "us/statute/42/9902",
              body,
            }),
          ]}
        />
      );
      const link = screen.getByRole("link", { name: "42 U.S.C. 9902" });
      expect(link.closest("mark")).not.toBeNull();
      searchParamsRef.current = new URLSearchParams();
    });

    it("keeps the mark at its offsets when they match the mt text", () => {
      const body = "This rule refers to earned income credit somewhere.";
      const start = body.indexOf("earned income credit");
      const end = start + "earned income credit".length;
      searchParamsRef.current = new URLSearchParams(
        `mark=${start}-${end}&mt=${encodeURIComponent("earned income credit")}`
      );
      const { container } = render(<RuleBody body={body} refs={[]} />);
      expect(container.querySelector("mark")?.textContent).toBe(
        "earned income credit"
      );
      searchParamsRef.current = new URLSearchParams();
    });

    it("re-anchors the mark using the mt text when offsets are stale", () => {
      const body = "Intro text. The cited passage mentions 26 U.S.C. 3101 here.";
      // Offsets index a longer, older revision of the body.
      searchParamsRef.current = new URLSearchParams(
        `mark=2553-2567&mt=${encodeURIComponent("26 U.S.C. 3101")}`
      );
      const { container } = render(<RuleBody body={body} refs={[]} />);
      expect(container.querySelector("mark")?.textContent).toBe(
        "26 U.S.C. 3101"
      );
      searchParamsRef.current = new URLSearchParams();
    });

    it("drops the highlight when the mt text is absent instead of marking unrelated words", () => {
      const body = "Short body without the citation.";
      searchParamsRef.current = new URLSearchParams(
        `mark=0-5&mt=${encodeURIComponent("26 U.S.C. 3101")}`
      );
      const { container } = render(<RuleBody body={body} refs={[]} />);
      expect(container.querySelector("mark")).toBeNull();
      searchParamsRef.current = new URLSearchParams();
    });
  });
});

it("marks numeric columns and legal clauses without changing their text", () => {
  searchParamsRef.current = new URLSearchParams();
  const body = "(a) Original clause wording.\n\n| Household | Limit |\n| --- | --- |\n| One person | $1,200 |\n| Two people | $2,400 |";
  render(<RuleBody body={body} refs={[]} />);
  expect(screen.getByText("(a) Original clause wording.").closest("p")).toHaveAttribute("data-clause", "true");
  expect(screen.getByRole("columnheader", { name: "Limit" })).toHaveAttribute("data-numeric", "true");
  expect(screen.getByRole("cell", { name: "$1,200" })).toHaveAttribute("data-numeric", "true");
  expect(screen.getByRole("columnheader", { name: "Household" })).not.toHaveAttribute("data-numeric");
  expect(screen.getByRole("region", { name: "Source table" })).toHaveAttribute("tabindex", "0");
});
