import { afterEach, describe, expect, it } from "vitest";
import {
  compareSpecificity,
  loadSheets,
  mediaMatches,
  resolveStyle,
  resolvedValue,
  specificity,
  splitSelectorList,
} from "./css-cascade";

const wide = { width: 1400, height: 900 };
const narrow = { width: 900, height: 971 };

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
  expect(document.head.querySelectorAll("style")).toHaveLength(0);
});

describe("media queries", () => {
  it("treats max-width and min-width as inclusive bounds", () => {
    expect(mediaMatches("(max-width: 900px)", { width: 900, height: 1 })).toBe(true);
    expect(mediaMatches("(max-width: 900px)", { width: 901, height: 1 })).toBe(false);
    expect(mediaMatches("(min-width: 880px)", { width: 880, height: 1 })).toBe(true);
    expect(mediaMatches("(min-width: 880px)", { width: 879, height: 1 })).toBe(false);
    expect(mediaMatches("(max-height: 600px)", { width: 1, height: 600 })).toBe(true);
    expect(mediaMatches("(min-height: 601px)", { width: 1, height: 600 })).toBe(false);
  });

  it("combines with `and`, lists with commas, negates with `not`", () => {
    const query = "screen and (min-width: 640px) and (max-width: 900px)";
    expect(mediaMatches(query, { width: 700, height: 1 })).toBe(true);
    expect(mediaMatches(query, { width: 901, height: 1 })).toBe(false);
    expect(mediaMatches("print, (max-width: 500px)", { width: 400, height: 1 })).toBe(true);
    expect(mediaMatches("print, (max-width: 500px)", { width: 600, height: 1 })).toBe(false);
    expect(mediaMatches("not all and (max-width: 500px)", { width: 600, height: 1 })).toBe(true);
    expect(mediaMatches("only screen", { width: 600, height: 1 })).toBe(true);
  });

  it("evaluates preference features at their resting defaults", () => {
    expect(mediaMatches("(prefers-reduced-motion: reduce)", wide)).toBe(false);
    expect(mediaMatches("(prefers-reduced-motion: no-preference)", wide)).toBe(true);
    expect(mediaMatches("(prefers-color-scheme: dark)", wide)).toBe(false);
    expect(mediaMatches("(hover: hover)", wide)).toBe(true);
    expect(mediaMatches("(pointer: coarse)", wide)).toBe(false);
  });

  it("refuses features it does not model rather than guessing", () => {
    expect(() => mediaMatches("(orientation: portrait)", wide)).toThrow(/orientation/);
    expect(() => mediaMatches("(max-width: 50em)", wide)).toThrow(/px length/);
    expect(() => mediaMatches("weird", wide)).toThrow(/unsupported media query/);
  });
});

describe("selectors", () => {
  it("splits selector lists only on top-level commas", () => {
    expect(splitSelectorList(".a, .b")).toEqual([".a", ".b"]);
    expect(splitSelectorList(".a:not(.b, .c), [data-x=\"1,2\"] .d")).toEqual([
      ".a:not(.b, .c)",
      '[data-x="1,2"] .d',
    ]);
    expect(splitSelectorList("")).toEqual([]);
  });

  it("scores specificity the way the browser does", () => {
    expect(specificity(".graph-viewer-root .irg-wrap")).toEqual([0, 2, 0]);
    expect(specificity(".graph-viewer-root .app-shell.no-sidebar")).toEqual([0, 3, 0]);
    /* id; .results-cell + :hover + :not(:disabled)'s argument; button */
    expect(specificity("#main button.results-cell:hover:not(:disabled)")).toEqual([1, 3, 1]);
    expect(specificity(".graph-viewer-root *")).toEqual([0, 1, 0]);
    expect(specificity(".graph-viewer-root .irg-wrap[data-lod=\"far\"] .irg-eyebrow")).toEqual([
      0,
      4,
      0,
    ]);
    expect(specificity("main > section::before")).toEqual([0, 0, 3]);
    expect(specificity(":where(.a, .b) .c")).toEqual([0, 1, 0]);
    expect(specificity(":is(#x, .y) .z")).toEqual([1, 1, 0]);
    expect(compareSpecificity([0, 2, 0], [0, 1, 9])).toBeGreaterThan(0);
    expect(compareSpecificity([0, 1, 0], [0, 1, 0])).toBe(0);
  });
});

describe("resolveStyle", () => {
  it("later sheets win ties, more specific selectors win regardless of order, !important wins over both", () => {
    const host = mount('<div class="root"><p class="a b">x</p></div>');
    const target = host.querySelector("p")!;
    const rules = loadSheets([
      {
        name: "first.css",
        css: ".root .a { color: red; margin: 1px !important; padding: 1px; }",
      },
      {
        name: "second.css",
        css: ".root .a.b { padding: 2px; } .root .a { color: blue; margin: 2px; }",
      },
    ]);
    const winners = resolveStyle(rules, target, wide);
    expect(winners.get("color")).toMatchObject({ value: "blue", sheet: "second.css" });
    expect(winners.get("padding")).toMatchObject({
      value: "2px",
      selector: ".root .a.b",
      specificity: [0, 3, 0],
    });
    expect(winners.get("margin")).toMatchObject({
      value: "1px",
      important: true,
      sheet: "first.css",
    });
  });

  it("applies @media blocks for the viewport that matches, and only then", () => {
    const host = mount('<div class="root"><p class="a">x</p></div>');
    const target = host.querySelector("p")!;
    const rules = loadSheets([
      {
        name: "sheet.css",
        css: ".root .a { height: 100%; } @media (max-width: 900px) { .root .a { height: auto; } }",
      },
    ]);
    expect(resolvedValue(rules, target, wide, "height")).toBe("100%");
    expect(resolvedValue(rules, target, narrow, "height")).toBe("auto");
    expect(resolveStyle(rules, target, narrow).get("height")?.media).toEqual([
      "(max-width: 900px)",
    ]);
  });

  it("lets a later unconditional rule override an earlier @media rule of equal specificity", () => {
    /* The shape of the 900px canvas collapse: a responsive floor in an
       early sheet, re-pinned by a later sheet that never looked at
       the viewport. */
    const host = mount('<div class="root"><p class="a">x</p></div>');
    const target = host.querySelector("p")!;
    const rules = loadSheets([
      {
        name: "early.css",
        css: "@media (max-width: 900px) { .root .a { min-height: 70vh; } }",
      },
      { name: "late.css", css: ".root .a { min-height: 0; }" },
    ]);
    expect(resolveStyle(rules, target, narrow).get("min-height")).toMatchObject({
      value: "0px",
      sheet: "late.css",
    });
  });

  it("uses the most specific matching selector of a list and ignores state pseudo-classes", () => {
    const host = mount('<div class="root"><p class="a">x</p></div>');
    const target = host.querySelector("p")!;
    const rules = loadSheets([
      {
        name: "sheet.css",
        css: ".zzz, .root .a { color: red; } .a:hover { color: green; } .a { color: gray; }",
      },
    ]);
    expect(resolveStyle(rules, target, wide).get("color")).toMatchObject({
      value: "red",
      selector: ".root .a",
    });
  });

  it("nests media conditions and skips @keyframes", () => {
    const host = mount('<div class="root"><p class="a">x</p></div>');
    const target = host.querySelector("p")!;
    const rules = loadSheets([
      {
        name: "sheet.css",
        css: [
          "@keyframes spin { to { transform: rotate(1turn); } }",
          "@media (max-width: 900px) { @media (max-height: 800px) { .root .a { color: red; } } }",
        ].join("\n"),
      },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].media).toEqual(["(max-width: 900px)", "(max-height: 800px)"]);
    expect(resolvedValue(rules, target, { width: 900, height: 800 }, "color")).toBe("red");
    expect(resolvedValue(rules, target, { width: 900, height: 801 }, "color")).toBeUndefined();
  });
});
