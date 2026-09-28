import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// The compose viewer is heavy (React Flow + runtime fetches); the
// overlay only needs to prove it mounts, so stub the dynamic import.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MockComposeViewer() {
      return <div data-testid="mock-compose-viewer" />;
    },
}));

import { CorpusField } from "./corpus-field";
import {
  humanizeCitation,
  humanizeRuleName,
} from "@/components/axiom/graph-viewer/citations";
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  HIGHLIGHT_COUNT,
  buildFieldLayout,
  computeFieldHighlights,
  filterViewModules,
  highlightScore,
} from "@/lib/axiom/corpus-field";
import corpusSubtrees from "@/lib/axiom/corpus-subtrees.json";

const VIEW_MODULES = filterViewModules(corpusSubtrees.modules);

/** The component's own layout: door labels included — with the hard
 *  no-overlap pass, positions depend on door floor radii, so tests
 *  must aim at the SAME layout the canvas draws. */
function componentLayout() {
  const labels = new Map(
    computeFieldHighlights(VIEW_MODULES).map((module) => [
      module.target,
      module.headlineRule
        ? `${humanizeRuleName(module.headlineRule)} — ${humanizeCitation(module.target)}`
        : humanizeCitation(module.target),
    ])
  );
  return buildFieldLayout(VIEW_MODULES, labels);
}

async function renderField() {
  const view = render(<CorpusField />);
  // The census loads through a dynamic import — wait for the field.
  await waitFor(() =>
    expect(
      screen.getByTestId("corpus-field").getAttribute("data-dot-count")
    ).not.toBe("0")
  );
  return view;
}

/** Point the pointer math at real dots: jsdom's zero-size rects are
 *  replaced with a rect matching the field's aspect (1 css px = 1
 *  field unit). */
function stubFieldRect() {
  const container = screen.getByTestId("corpus-field");
  container.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: FIELD_WIDTH,
      height: FIELD_HEIGHT,
      right: FIELD_WIDTH,
      bottom: FIELD_HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return container;
}

function canvasEl() {
  return screen.getByRole("img") as HTMLCanvasElement;
}

/** jsdom has no PointerEvent — dispatch MouseEvents with pointer
 *  types so React's onPointer* handlers get real coordinates. */
function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number
) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, {
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

const zoomOf = () =>
  Number(screen.getByTestId("corpus-field").getAttribute("data-zoom"));
const txOf = () =>
  Number(screen.getByTestId("corpus-field").getAttribute("data-tx"));

describe("CorpusField", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/axiom");
  });

  it("renders every VIEW subtree (US, multi-node) as a field dot", async () => {
    await renderField();
    const field = screen.getByTestId("corpus-field");
    expect(Number(field.getAttribute("data-dot-count"))).toBe(
      VIEW_MODULES.length
    );
    // One-node subtrees are gone entirely, not dust.
    expect(VIEW_MODULES.length).toBeLessThan(corpusSubtrees.modules.length);
  });

  it("shows the computed doors — the census's own top-scored subtrees", async () => {
    await renderField();
    const doors = screen.getAllByTestId("corpus-field-highlight");
    const expected = computeFieldHighlights(VIEW_MODULES);
    // Size-based picks plus the pinned doors (EITC).
    expect(expected.length).toBeGreaterThanOrEqual(HIGHLIGHT_COUNT);
    expect(doors).toHaveLength(expected.length);
    // The pinned EITC door is always offered, headline first.
    expect(
      doors.some((el) => el.textContent === "EITC — 26 USC § 32")
    ).toBe(true);
    const hrefs = new Set(doors.map((el) => el.getAttribute("href")));
    for (const module of expected) {
      expect(hrefs).toContain(
        `/axiom/graph?compose=${encodeURIComponent(module.target)}`
      );
    }
    // Labels lead with the humanized headline rule, citation second.
    const best = [...expected].sort(
      (a, b) => highlightScore(b) - highlightScore(a)
    )[0]!;
    const expectedLabel = best.headlineRule
      ? `${humanizeRuleName(best.headlineRule)} — ${humanizeCitation(best.target)}`
      : humanizeCitation(best.target);
    expect(doors.some((el) => el.textContent === expectedLabel)).toBe(true);
    const headlined = expected.find((m) => m.headlineRule)!;
    expect(
      doors.some((el) =>
        el.textContent?.startsWith(humanizeRuleName(headlined.headlineRule!))
      )
    ).toBe(true);
  });

  it("labels the large jurisdiction clusters", async () => {
    await renderField();
    const labels = screen
      .getAllByTestId("corpus-field-cluster")
      .map((el) => el.textContent);
    expect(labels).toContain("US · Federal");
    expect(labels).toContain("US · CO");
    expect(labels.length).toBeGreaterThan(5);
  });

  it("shows no stat line and no bucket legend — the field is the whole UI", async () => {
    // No live endpoint in jsdom — the loader falls back to the snapshot.
    await renderField();
    expect(screen.queryByTestId("corpus-field-stats")).toBeNull();
    expect(screen.queryByText("statutes")).toBeNull();
    expect(screen.queryByText("regulations")).toBeNull();
    expect(screen.queryByText("policies")).toBeNull();
    expect(
      screen.getByTestId("corpus-field").getAttribute("data-corpus-source")
    ).toBe("snapshot");
  });

  it("mirrors the live corpus US-only: new US law appears, non-US mirror entries never render", async () => {
    const live = [
      ...corpusSubtrees.modules.map((m) => ({
        target: m.target,
        jurisdiction: m.jurisdiction,
        bucket: m.bucket,
      })),
      {
        target: "us-pr:statutes/13/30171",
        jurisdiction: "us-pr",
        bucket: "statutes",
      },
      {
        target: "be:policies/euromod_benefit_income_list",
        jurisdiction: "be",
        bucket: "policies",
      },
      {
        target: "uk:statutes/universal-credit/1",
        jurisdiction: "uk",
        bucket: "statutes",
      },
    ];
    const usCount = VIEW_MODULES.length + 1;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          data: { count: live.length, subtrees: live },
        }),
      })
    );
    try {
      render(<CorpusField />);
      await waitFor(() =>
        expect(
          screen.getByTestId("corpus-field").getAttribute("data-corpus-source")
        ).toBe("live")
      );
      const field = screen.getByTestId("corpus-field");
      expect(Number(field.getAttribute("data-dot-count"))).toBe(usCount);
      // No non-US territory labels either.
      const labels = screen
        .getAllByTestId("corpus-field-cluster")
        .map((el) => el.textContent);
      expect(labels.some((label) => /UK|BE/.test(label ?? ""))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("embedded mode: picking calls onPick instead of mounting the viewer or touching the URL", async () => {
    const onPick = vi.fn();
    render(<CorpusField onPick={onPick} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("corpus-field").getAttribute("data-dot-count")
      ).not.toBe("0")
    );
    stubFieldRect();
    const layout = componentLayout();
    const dot = layout.dots.find(
      (d) => !d.highlightLabel && !d.dust && d.ruleCount > 5
    )!;
    fireEvent.click(canvasEl(), { clientX: dot.x, clientY: dot.y });
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(dot.target));
    expect(screen.queryByTestId("corpus-field-overlay")).toBeNull();
    expect(window.location.pathname).toBe("/axiom");

    // A door click routes through onPick too.
    fireEvent.click(screen.getAllByTestId("corpus-field-highlight")[0]!);
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(window.location.pathname).toBe("/axiom");
  });

  it("zooms on wheel, anchored under the pointer, and offers a reset", async () => {
    await renderField();
    stubFieldRect();
    expect(zoomOf()).toBe(1);
    fireEvent.wheel(canvasEl(), {
      deltaY: -400,
      clientX: 500,
      clientY: 220,
    });
    expect(zoomOf()).toBeGreaterThan(1);
    // Reset returns to the whole corpus (reduced-motion test env
    // jumps instantly).
    fireEvent.click(screen.getByTestId("corpus-field-reset"));
    expect(zoomOf()).toBe(1);
  });

  it("pans on drag and suppresses the click that ends the drag", async () => {
    await renderField();
    stubFieldRect();
    const canvas = canvasEl();
    fireEvent.wheel(canvas, { deltaY: -600, clientX: 500, clientY: 220 });
    const beforeTx = txOf();
    firePointer(canvas, "pointerdown", 500, 220);
    firePointer(canvas, "pointermove", 460, 200);
    firePointer(canvas, "pointerup", 460, 200);
    expect(txOf()).not.toBe(beforeTx);
    // The drag's trailing click chooses nothing.
    fireEvent.click(canvas, { clientX: 460, clientY: 200 });
    expect(screen.queryByTestId("corpus-field-overlay")).toBeNull();
  });

  it("hover shows a humanized tooltip through the transform", async () => {
    await renderField();
    stubFieldRect();
    const layout = componentLayout();
    const dot = layout.dots.find(
      (d) => !d.highlightLabel && !d.dust && d.ruleCount > 5 && d.headlineRule
    )!;
    fireEvent.mouseMove(canvasEl(), { clientX: dot.x, clientY: dot.y });
    const tooltip = await screen.findByTestId("corpus-field-tooltip");
    expect(tooltip.textContent).toContain(humanizeCitation(dot.target));
    // The headline rule leads the tooltip where the census names one.
    expect(tooltip.textContent).toContain(
      humanizeRuleName(dot.headlineRule!)
    );
    // Deliberately no rule-count/bucket line — the tooltip names the
    // program and its citation, nothing quantitative.
    expect(tooltip.textContent).not.toContain(`${dot.ruleCount} rules`);
    fireEvent.mouseLeave(canvasEl());
    expect(screen.queryByTestId("corpus-field-tooltip")).toBeNull();
  });

  it("click zooms into the subtree and mounts the compose viewer in place; BACK returns and zooms out", async () => {
    await renderField();
    stubFieldRect();
    const layout = componentLayout();
    const dot = layout.dots.find(
      (d) => !d.highlightLabel && !d.dust && d.ruleCount > 5
    )!;

    fireEvent.click(canvasEl(), { clientX: dot.x, clientY: dot.y });
    // Reduced-motion test env: the camera jumps, the overlay mounts.
    await screen.findByTestId("corpus-field-overlay");
    expect(screen.getByTestId("mock-compose-viewer")).toBeInTheDocument();
    expect(zoomOf()).toBeGreaterThan(1);
    // The URL is the honest compose deep link.
    expect(window.location.pathname).toContain("/axiom/graph");
    expect(window.location.search).toContain(
      `compose=${encodeURIComponent(dot.target)}`
    );

    // BACK: pop the compose entry — viewer unmounts, camera pulls out.
    window.history.replaceState({}, "", "/axiom");
    fireEvent.popState(window);
    await waitFor(() =>
      expect(screen.queryByTestId("corpus-field-overlay")).toBeNull()
    );
    expect(zoomOf()).toBe(1);
  });

  it("a door click zooms in instead of navigating away", async () => {
    await renderField();
    stubFieldRect();
    const door = screen.getAllByTestId("corpus-field-highlight")[0]!;
    const href = door.getAttribute("href")!;
    fireEvent.click(door);
    await screen.findByTestId("corpus-field-overlay");
    expect(zoomOf()).toBeGreaterThan(1);
    expect(window.location.pathname + window.location.search).toBe(href);
  });

  it("FORWARD (popstate onto a compose URL) reopens the viewer", async () => {
    await renderField();
    window.history.replaceState(
      {},
      "",
      "/axiom/graph?compose=us%3Astatutes%2F26%2F21"
    );
    fireEvent.popState(window);
    await screen.findByTestId("corpus-field-overlay");
  });

  it("ignores pointer math when the field has no size (jsdom default)", async () => {
    await renderField();
    fireEvent.click(canvasEl(), { clientX: 10, clientY: 10 });
    expect(screen.queryByTestId("corpus-field-overlay")).toBeNull();
  });
});
