/* The rule canvas keeps a usable height at every viewport width.

   The graph hangs from a chain of percentage heights: .graph-viewer-root
   (100vh) → .app-shell → .viewer-panel → .graph-stage → .irg-wrap →
   .irg-canvas → React Flow's inline height:100%. One `height: auto`
   anywhere in that chain and every percentage below it resolves
   against nothing: .irg-wrap becomes its 2px of border, React Flow
   is 0px tall, and the graph vanishes while its nodes still sit in
   the DOM with their layout transforms. That is what a fresh load at
   900×971 did (styles.css's ≤900px block set the shell and panel to
   auto for a stacked side-panel layout this app no longer renders,
   and its 70vh floor lost to plane.css, which loads last).

   This suite resolves the real sheets, in the order viewer-app.tsx
   loads them, for the real element chain at each width — the
   cascade a browser would apply, minus layout. The pixel version is
   `bun scripts/graph-viewport-check.mjs` against a running server
   (see README.md). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSheets, resolveStyle, type StyleRule, type Viewport } from "./css-cascade";

const here = join(process.cwd(), "src/components/axiom/graph-viewer");

/* The sheets in the order the viewer loads them — read from the
   import lines, so a reordering shows up here as a cascade change. */
function viewerSheetOrder(): string[] {
  const source = readFileSync(join(here, "viewer-app.tsx"), "utf8");
  return [...source.matchAll(/^import\s+"\.\/([\w-]+\.css)";$/gm)].map((m) => m[1]);
}

function loadViewerSheets(): StyleRule[] {
  return loadSheets(
    viewerSheetOrder().map((name) => ({
      name,
      css: readFileSync(join(here, name), "utf8"),
    })),
  );
}

type Chain = {
  root: HTMLElement;
  shell: HTMLElement;
  panel: HTMLElement;
  stage: HTMLElement;
  wrap: HTMLElement;
  canvas: HTMLElement;
  flow: HTMLElement;
  notice: HTMLElement;
  minimap: HTMLElement;
  toolbar: HTMLElement;
};

/* The compose view's element chain as viewer-app.tsx and
   InteractiveRuleGraph.tsx render it (class names only — this is a
   cascade check, not a render). */
function mountChain(): Chain {
  const make = (tag: string, className: string) => {
    const el = document.createElement(tag);
    el.className = className;
    return el;
  };
  const root = make("div", "graph-viewer-root");
  const notice = make("div", "small-screen-notice");
  const shell = make("main", "app-shell no-sidebar");
  const panel = make("section", "viewer-panel");
  const controls = make("div", "top-controls");
  const stage = make("div", "graph-stage");
  const wrap = make("div", "irg-wrap");
  const bar = make("div", "irg-controls-bar");
  const toolbar = make("div", "irg-toolbar");
  const canvas = make("div", "irg-canvas");
  const flow = make("div", "react-flow light");
  const minimap = make("div", "react-flow__minimap");
  flow.setAttribute("style", "width: 100%; height: 100%;");
  bar.appendChild(toolbar);
  flow.appendChild(minimap);
  canvas.appendChild(flow);
  wrap.append(bar, canvas);
  stage.appendChild(wrap);
  panel.append(controls, stage);
  shell.appendChild(panel);
  root.append(notice, shell);
  document.body.appendChild(root);
  return { root, shell, panel, stage, wrap, canvas, flow, notice, minimap, toolbar };
}

const VIEWPORTS: Array<Viewport & { label: string }> = [
  { label: "desktop 1400×900", width: 1400, height: 900 },
  { label: "laptop 940×971", width: 940, height: 971 },
  { label: "just above the breakpoint 901×971", width: 901, height: 971 },
  { label: "the report 900×971", width: 900, height: 971 },
  { label: "just above the phone notice 821×900", width: 821, height: 900 },
  { label: "phone notice boundary 820×900", width: 820, height: 900 },
  { label: "phone layout boundary 640×900", width: 640, height: 900 },
  { label: "phone 390×844", width: 390, height: 844 },
];

const rules = loadViewerSheets();

afterEach(() => {
  document.body.innerHTML = "";
});

describe("viewer stylesheet order", () => {
  it("loads the scoped upstream sheets first and the app's own plane.css last", () => {
    expect(viewerSheetOrder()).toEqual(["styles.css", "graph-styles.css", "plane.css"]);
  });
});

describe.each(VIEWPORTS)("canvas height chain at $label", (viewport) => {
  it("keeps every link a percentage of a viewport-pinned root", () => {
    const chain = mountChain();
    const value = (el: Element, prop: string) => resolveStyle(rules, el, viewport).get(prop)?.value;

    expect(value(chain.root, "height")).toBe("100vh");
    expect(value(chain.root, "overflow")).toBe("hidden");
    expect(value(chain.shell, "display")).toBe("grid");
    expect(value(chain.shell, "height")).toBe("100%");
    expect(value(chain.panel, "display")).toBe("grid");
    expect(value(chain.panel, "grid-template-rows")).toBe("auto minmax(0, 1fr)");
    expect(value(chain.panel, "height")).toBe("100%");
    expect(value(chain.panel, "min-height")).toBe("0px");
    expect(value(chain.stage, "grid-row")).toBe("2");
    expect(value(chain.stage, "min-height")).toBe("0px");
    expect(value(chain.wrap, "grid-row")).toBe("2");
    expect(value(chain.wrap, "height")).toBe("100%");
    expect(value(chain.wrap, "display")).toBe("flex");
    expect(value(chain.wrap, "flex-direction")).toBe("column");
    expect(value(chain.canvas, "flex")).toMatch(/^1( 1 0%)?$/);
    expect(value(chain.canvas, "min-height")).toBe("0px");

    /* The collapse signature: no `auto` anywhere above the canvas. */
    const heights = [chain.root, chain.shell, chain.panel, chain.wrap].map((el) =>
      value(el, "height"),
    );
    expect(heights).not.toContain("auto");
    expect(heights).not.toContain(undefined);
  });

  it("keeps the wrap's floor from the sheet that loads last", () => {
    /* plane.css re-pins min-height:0 so the wrap can shrink inside
       minmax(0, 1fr). styles.css's ≤900px `min-height: 70vh` never
       reaches the page — the chain, not a floor, is what keeps the
       canvas tall. Pin that so a future floor is added on purpose. */
    const chain = mountChain();
    const floor = resolveStyle(rules, chain.wrap, viewport).get("min-height");
    expect(floor).toMatchObject({ value: "0px", sheet: "plane.css" });
  });
});

describe("the ≤900px override", () => {
  it("comes from plane.css, scoped to the narrow range", () => {
    const chain = mountChain();
    for (const el of [chain.shell, chain.panel]) {
      const narrow = resolveStyle(rules, el, { width: 900, height: 971 }).get("height");
      expect(narrow).toMatchObject({
        value: "100%",
        sheet: "plane.css",
        media: ["(max-width: 900px)"],
      });
      const wide = resolveStyle(rules, el, { width: 901, height: 971 }).get("height");
      expect(wide).toMatchObject({ value: "100%", sheet: "styles.css", media: [] });
    }
  });

  it("beats the upstream sheet's height:auto that would otherwise win at 900px", () => {
    /* Drop plane.css and the chain breaks exactly as reported — the
       upstream ≤900px block is still there, still overridden. */
    const chain = mountChain();
    const upstreamOnly = rules.filter((rule) => rule.sheet !== "plane.css");
    const viewport = { width: 900, height: 971 };
    expect(resolveStyle(upstreamOnly, chain.shell, viewport).get("height")?.value).toBe("auto");
    expect(resolveStyle(upstreamOnly, chain.panel, viewport).get("height")?.value).toBe("auto");
    expect(resolveStyle(upstreamOnly, chain.shell, { width: 901, height: 971 }).get("height")?.value).toBe(
      "100%",
    );
  });
});

describe("phone layout", () => {
  it("shows the small-screen notice over the canvas at 820px and below only", () => {
    const chain = mountChain();
    for (const width of [820, 640, 390]) {
      const winners = resolveStyle(rules, chain.notice, { width, height: 900 });
      expect(winners.get("position")?.value, `${width}px`).toBe("fixed");
      expect(winners.get("inset")?.value ?? winners.get("top")?.value, `${width}px`).toBeDefined();
    }
    for (const width of [821, 900, 1400]) {
      const winners = resolveStyle(rules, chain.notice, { width, height: 900 });
      expect(winners.get("position")?.value, `${width}px`).not.toBe("fixed");
    }
  });

  it("keeps the ≤640px canvas adjustments: no minimap, wrapping toolbar", () => {
    const chain = mountChain();
    for (const width of [640, 390]) {
      expect(
        resolveStyle(rules, chain.minimap, { width, height: 900 }).get("display")?.value,
        `${width}px`,
      ).toBe("none");
      expect(
        resolveStyle(rules, chain.toolbar, { width, height: 900 }).get("flex-wrap")?.value,
        `${width}px`,
      ).toBe("wrap");
    }
    for (const width of [641, 900]) {
      expect(
        resolveStyle(rules, chain.minimap, { width, height: 900 }).get("display")?.value,
        `${width}px`,
      ).not.toBe("none");
      expect(
        resolveStyle(rules, chain.toolbar, { width, height: 900 }).get("flex-wrap")?.value,
        `${width}px`,
      ).not.toBe("wrap");
    }
  });
});
