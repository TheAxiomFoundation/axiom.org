// Headless sanity for the corpus-field landing: the field renders the
// whole census as an open world — wheel-zoomable, pannable — with
// computed doors; clicking zooms into the subtree and mounts the
// compose viewer in place, and browser BACK returns to the field.
// Run with the dev server on :3742 (`PORT=3742 bun run dev`).
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
await page.goto("http://localhost:3742/axiom", {
  waitUntil: "networkidle2",
  timeout: 60000,
});

// 1) The field draws the whole census (dot count lives on the field
//    element; the dots themselves are canvas pixels).
await page.waitForFunction(
  () => {
    const field = document.querySelector('[data-testid="corpus-field"]');
    return field && Number(field.getAttribute("data-dot-count")) > 100;
  },
  { timeout: 60000 },
);
const dotCount = await page.evaluate(() =>
  Number(
    document
      .querySelector('[data-testid="corpus-field"]')
      ?.getAttribute("data-dot-count"),
  ),
);
console.log("field dots:", dotCount);

// 2) Aggregated jurisdiction clusters + the computed doors (the
//    census's own top-scored subtrees; must be ≥ 10).
const clusterCount = await page.evaluate(
  () => document.querySelectorAll('[data-testid="corpus-field-cluster"]').length,
);
const highlightCount = await page.evaluate(
  () =>
    document.querySelectorAll('[data-testid="corpus-field-highlight"]').length,
);
console.log("cluster labels:", clusterCount, "· computed doors:", highlightCount);
// Doors are linked-rule scored: the known non-compiling roots (and
// dust modules — unit-tested) must never be doors.
const badDoors = await page.evaluate(() => {
  const banned = ["42%2F1396a%2Fa%2F10", "42%2F415%2Fa", "42%2F415%2Fb", "42%2F415%2Fi"];
  return [
    ...document.querySelectorAll('[data-testid="corpus-field-highlight"]'),
  ].filter((el) =>
    banned.some((fragment) => (el.getAttribute("href") ?? "").endsWith(fragment)),
  ).length;
});
console.log("non-compiling roots offered as doors:", badDoors);
// Doors lead with the humanized headline rule — "… — citation".
const headlineDoors = await page.evaluate(
  () =>
    [...document.querySelectorAll('[data-testid="corpus-field-highlight"]')]
      .filter((el) => (el.textContent ?? "").includes(" — ")).length,
);
console.log("doors with headline names:", headlineDoors);
// The pinned EITC door is always offered ("EITC — 26 USC § 32").
const eitcDoor = await page.evaluate(() =>
  [
    ...document.querySelectorAll('[data-testid="corpus-field-highlight"]'),
  ].some((el) => (el.textContent ?? "").includes("EITC")),
);
console.log("EITC pinned door present:", eitcDoor);

// 3) Presentation: no stat line, no bucket legend — the field is
//    the whole UI. Liveness reads from the data attribute instead.
const statAbsent = await page.evaluate(
  () => !document.querySelector('[data-testid="corpus-field-stats"]'),
);
const legendAbsent = await page.evaluate(
  () =>
    ![...document.querySelectorAll("span")].some((el) =>
      ["statutes", "regulations", "policies"].includes(
        el.textContent?.trim() ?? "",
      ),
    ),
);
const corpusSource = await page.evaluate(() =>
  document
    .querySelector('[data-testid="corpus-field"]')
    ?.getAttribute("data-corpus-source"),
);
console.log(
  "stat line absent:",
  statAbsent,
  "· legend absent:",
  legendAbsent,
  "· source:",
  corpusSource,
);

// 4) The search box (second entry path) is present above the field.
const hasSearch = await page.evaluate(() =>
  Boolean(document.querySelector("#axiom-hero-search")),
);
console.log("hero search present:", hasSearch);

// 4a) Shapes, not circles — at the FITTED overview every module is
//     its graph shape: true census edges are on screen at far zoom,
//     and only source-backed subtrees wear the outline ring (the
//     count must discriminate: more than 500, fewer than all dots).
const readFieldMetrics = () =>
  page.evaluate(() => {
    const field = document.querySelector('[data-testid="corpus-field"]');
    return {
      trueEdges: Number(field?.getAttribute("data-true-edges-drawn") ?? 0),
      outlines: Number(field?.getAttribute("data-outlines-drawn") ?? 0),
      dots: Number(field?.getAttribute("data-dots-drawn") ?? 0),
      labels: Number(field?.getAttribute("data-labels-drawn") ?? 0),
      labelsHeadline: Number(field?.getAttribute("data-labels-headline") ?? 0),
      labelsFallback: Number(field?.getAttribute("data-labels-fallback") ?? 0),
      frameMs: Number(field?.getAttribute("data-frame-ms") ?? NaN),
    };
  });
const farView = await readFieldMetrics();
console.log(
  "fitted view: true edges:",
  farView.trueEdges,
  "· outlines:",
  farView.outlines,
  "· dots drawn:",
  farView.dots,
  "· labels:",
  farView.labels,
);
await page.screenshot({ path: "/tmp/shape-field.png" });
// The spaced-out overview: footprints breathe, whole US field fitted.
await page.screenshot({ path: "/tmp/field-spaced.png" });
await page.screenshot({ path: "/tmp/field-no-overlap.png" });
await page.screenshot({ path: "/tmp/field-final-fitted.png" });
// The translucent constellation layer, at the fitted view.
await page.screenshot({ path: "/tmp/field-translucent.png" });

// Hard invariant: the layout resolves to ZERO intersecting footprint
// pairs (stamped once per layout by the renderer) — plus the
// document-grouping read (median inter-family gap > intra-family
// gap) and the layout build budget.
const layoutHealth = await page.evaluate(() => {
  const field = document.querySelector('[data-testid="corpus-field"]');
  return {
    overlapPairs: Number(field?.getAttribute("data-overlap-pairs") ?? NaN),
    layoutMs: Number(field?.getAttribute("data-layout-ms") ?? NaN),
    intraGap: Number(field?.getAttribute("data-group-intra-gap") ?? NaN),
    interGap: Number(field?.getAttribute("data-group-inter-gap") ?? NaN),
  };
});
const overlapPairs = layoutHealth.overlapPairs;
const groupsSeparated =
  layoutHealth.interGap > layoutHealth.intraGap && layoutHealth.interGap > 0;
console.log(
  "intersecting footprint pairs:",
  overlapPairs,
  "· layout build:",
  layoutHealth.layoutMs.toFixed(1),
  "ms · group gaps (intra → inter):",
  layoutHealth.intraGap,
  "→",
  layoutHealth.interGap,
);

// Frame-time storm: alternate small wheel zooms so every sample is a
// fresh full redraw, then report the median/p95.
const frameStorm = async (label, steps = 30, delta = 120) => {
  const samples = [];
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel({ deltaY: i % 2 === 0 ? -delta : delta });
    await new Promise((r) => setTimeout(r, 45));
    const { frameMs } = await readFieldMetrics();
    if (Number.isFinite(frameMs)) samples.push(frameMs);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? NaN;
  const p95 = samples[Math.min(Math.floor(samples.length * 0.95), samples.length - 1)] ?? NaN;
  console.log(
    `${label} frame ms — median: ${median?.toFixed(2)} · p95: ${p95?.toFixed(2)} (${samples.length} samples)`,
  );
  return { median, p95 };
};
const fieldBoxEarly = await (
  await page.$('[data-testid="corpus-field"]')
).boundingBox();
await page.mouse.move(
  fieldBoxEarly.x + fieldBoxEarly.width / 2,
  fieldBoxEarly.y + fieldBoxEarly.height / 2,
);
const farFrames = await frameStorm("far zoom");
// Pull the camera back to the fitted overview for the next checks.
await page.evaluate(() =>
  document.querySelector('[data-testid="corpus-field-reset"]')?.click(),
);
await page.waitForFunction(
  () =>
    Number(
      document
        .querySelector('[data-testid="corpus-field"]')
        ?.getAttribute("data-zoom"),
    ) === 1,
  { timeout: 10000 },
);

// 5) Open world: wheel-zoom over the field changes the camera.
const fieldBox = await (await page.$('[data-testid="corpus-field"]')).boundingBox();
const zoomBefore = await page.evaluate(() =>
  Number(
    document
      .querySelector('[data-testid="corpus-field"]')
      ?.getAttribute("data-zoom"),
  ),
);
await page.mouse.move(
  fieldBox.x + fieldBox.width / 2,
  fieldBox.y + fieldBox.height / 2,
);
await page.mouse.wheel({ deltaY: -300 });
await new Promise((r) => setTimeout(r, 300));
const zoomAfterWheel = await page.evaluate(() =>
  Number(
    document
      .querySelector('[data-testid="corpus-field"]')
      ?.getAttribute("data-zoom"),
  ),
);
const lodMid = await page.evaluate(() =>
  document
    .querySelector('[data-testid="corpus-field"]')
    ?.getAttribute("data-lod"),
);
console.log("wheel zoom:", zoomBefore, "→", zoomAfterWheel, "· lod:", lodMid);

// 5a) LOD: pushing past the motif threshold turns dots into
//     miniature graph sketches (data-lod flips to "motif").
await page.mouse.wheel({ deltaY: -600 });
await new Promise((r) => setTimeout(r, 300));
const lodNear = await page.evaluate(() => ({
  lod: document
    .querySelector('[data-testid="corpus-field"]')
    ?.getAttribute("data-lod"),
  zoom: Number(
    document
      .querySelector('[data-testid="corpus-field"]')
      ?.getAttribute("data-zoom"),
  ),
  // TRUE structure edges drawn this frame (v4 census graphs).
  trueEdges: Number(
    document
      .querySelector('[data-testid="corpus-field"]')
      ?.getAttribute("data-true-edges-drawn") ?? 0,
  ),
}));
console.log(
  "near zoom:",
  lodNear.zoom,
  "· lod:",
  lodNear.lod,
  "· true edges drawn:",
  lodNear.trueEdges,
);
await page.screenshot({ path: "/tmp/shape-field-near.png" });
// Two-tier titles: at this zoom the HEADLINE names are out in
// force while citation fallbacks stay few/none (they wait for a
// deeper camera).
const labelTiersMid = await readFieldMetrics();
console.log(
  "labels at mid zoom — headline:",
  labelTiersMid.labelsHeadline,
  "· fallback:",
  labelTiersMid.labelsFallback,
);
await page.screenshot({ path: "/tmp/field-labels.png" });
await page.screenshot({ path: "/tmp/field-final-mid.png" });
await page.screenshot({ path: "/tmp/field-labels-tiered.png" });
const motifFrames = await frameStorm("motif zoom", 30, 200);

// Push the camera in close: BOTH tiers present now.
await page.mouse.wheel({ deltaY: -900 });
await new Promise((r) => setTimeout(r, 400));
const labelTiersClose = await readFieldMetrics();
console.log(
  "labels close in — headline:",
  labelTiersClose.labelsHeadline,
  "· fallback:",
  labelTiersClose.labelsFallback,
);

// 5b) Drag pans the camera.
const txBefore = await page.evaluate(() =>
  Number(
    document
      .querySelector('[data-testid="corpus-field"]')
      ?.getAttribute("data-tx"),
  ),
);
await page.mouse.move(fieldBox.x + 700, fieldBox.y + 300);
await page.mouse.down();
await page.mouse.move(fieldBox.x + 560, fieldBox.y + 260, { steps: 6 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
const txAfterDrag = await page.evaluate(() =>
  Number(
    document
      .querySelector('[data-testid="corpus-field"]')
      ?.getAttribute("data-tx"),
  ),
);
console.log("drag pan tx:", txBefore, "→", txAfterDrag);

// Back to the overview so every door is on screen for the click.
await page.click('[data-testid="corpus-field-reset"]');
await page.waitForFunction(
  () =>
    Number(
      document
        .querySelector('[data-testid="corpus-field"]')
        ?.getAttribute("data-zoom"),
    ) === 1,
  { timeout: 10000 },
);

// 6) Click a door: the camera zooms in and the compose viewer mounts
//    in place, with the URL pushed to the real compose deep link.
const clickedHref = await page.evaluate(() => {
  const doors = [
    ...document.querySelectorAll('[data-testid="corpus-field-highlight"]'),
  ];
  const door = doors[0];
  if (!door) return null;
  const href = door.getAttribute("href");
  door.click();
  return href;
});
console.log("clicked door:", clickedHref);

await page.waitForFunction(
  () => window.location.search.includes("compose="),
  { timeout: 30000 },
);
const zoomAtEnter = await page.evaluate(() =>
  Number(
    document
      .querySelector('[data-testid="corpus-field"]')
      ?.getAttribute("data-zoom"),
  ),
);
await page.waitForSelector(".graph-viewer-root", { timeout: 60000 });
const composeUrl = await page.evaluate(() => window.location.href);
console.log("compose viewer mounted in place:", composeUrl);
console.log("camera zoom at enter:", zoomAtEnter);

// 7) Run-by-root state (informational): the run affordance only
//    appears in compose mode when the API answers the root shape.
await new Promise((r) => setTimeout(r, 5000));
const runToggle = await page.evaluate(() =>
  Boolean(document.querySelector(".run-toggle")),
);
console.log(
  "compose run affordance:",
  runToggle ? "LIVE (root calculate supported)" : "feature-detected off",
);

// 8) The viewer's own way back: the always-visible "← Overview"
//    control returns to the field (viewer unmounts, camera pulls
//    back out) — no browser chrome needed.
await page.waitForSelector('[data-testid="back-to-overview"]', {
  timeout: 30000,
});
// The chip lives in its own slim row ABOVE the graph plane, flush
// with the plane's left edge — frame, not floating chrome.
const chipGeom = await page.evaluate(() => {
  const chip = document
    .querySelector('[data-testid="back-to-overview"]')
    ?.getBoundingClientRect();
  const stage = document
    .querySelector(".graph-stage")
    ?.getBoundingClientRect();
  return chip && stage
    ? {
        chipBottom: chip.bottom,
        chipLeft: chip.left,
        stageTop: stage.top,
        stageLeft: stage.left,
      }
    : null;
});
const chipAboveStage = Boolean(
  chipGeom &&
    chipGeom.chipBottom <= chipGeom.stageTop &&
    Math.abs(chipGeom.chipLeft - chipGeom.stageLeft) < 4,
);
console.log(
  "overview chip above the plane, edge-aligned:",
  chipAboveStage,
  JSON.stringify(chipGeom),
);
await page.click('[data-testid="back-to-overview"]');
await page.waitForFunction(
  () =>
    !document.querySelector(".graph-viewer-root") &&
    Boolean(document.querySelector('[data-testid="corpus-field"]')),
  { timeout: 30000 },
);
const backUrl = await page.evaluate(() => window.location.pathname);
await page.waitForFunction(
  () =>
    Number(
      document
        .querySelector('[data-testid="corpus-field"]')
        ?.getAttribute("data-zoom"),
    ) === 1,
  { timeout: 10000 },
);
console.log(
  "← Overview returned to the field at:",
  backUrl,
  "(camera zoomed out)",
);

// 9) The field mirrors the corpus, live, US-only, one-node-filtered:
//    with :8787 up the count sits above the filtered snapshot (2,892)
//    and well below the unfiltered census (4,392).
const liveField =
  corpusSource === "live" && dotCount > 2892 && dotCount < 4392;
console.log(
  "live mirror (US-only, one-node-filtered):",
  liveField ? `yes (${dotCount} subtrees)` : `NO (${dotCount})`,
);
const landingNonUsClusters = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="corpus-field-cluster"]')]
    .map((el) => el.textContent ?? "")
    .filter((label) => !/^US/.test(label)),
);
console.log("landing non-US clusters:", JSON.stringify(landingNonUsClusters));

// 10) The launcher: its first view IS the field. Cold /axiom/graph
//     opens on the embedded open-world corpus field (US-only stat),
//     with the list picker one toggle away — no program cards ever.
const picker = await browser.newPage();
picker.on("pageerror", (e) => console.log("PICKER PAGE ERROR:", e.message));
await picker.setViewport({ width: 1500, height: 950 });
await picker.goto("http://localhost:3742/axiom/graph", {
  waitUntil: "networkidle2",
  timeout: 60000,
});
await picker.waitForSelector('[data-testid="launcher-field"]', {
  timeout: 60000,
});
await picker.waitForFunction(
  () => {
    const field = document.querySelector(
      '[data-testid="launcher-field"] [data-testid="corpus-field"]',
    );
    return field && Number(field.getAttribute("data-dot-count")) > 100;
  },
  { timeout: 60000 },
);
const launcherFieldState = await picker.evaluate(() => {
  const canvas = document.querySelector(
    '[data-testid="launcher-field"] canvas',
  );
  const rect = canvas?.getBoundingClientRect();
  const controls = document
    .querySelector('[data-testid="launcher-controls"]')
    ?.getBoundingClientRect();
  return {
    dotCount: Number(
      document
        .querySelector(
          '[data-testid="launcher-field"] [data-testid="corpus-field"]',
        )
        ?.getAttribute("data-dot-count"),
    ),
    source: document
      .querySelector('[data-testid="launcher-field"] [data-testid="corpus-field"]')
      ?.getAttribute("data-corpus-source"),
    statAbsent: !document.querySelector('[data-testid="corpus-field-stats"]'),
    // Full-bleed: the field canvas covers ≥ ~80% of the viewport.
    canvasViewportShare: rect
      ? (rect.width * rect.height) / (window.innerWidth * window.innerHeight)
      : 0,
    // The control cluster floats top-right over the field.
    controlsTopRight: Boolean(
      controls &&
        controls.top < 160 &&
        controls.right > window.innerWidth * 0.7,
    ),
    nonUsClusters: [
      ...document.querySelectorAll(
        '[data-testid="launcher-field"] [data-testid="corpus-field-cluster"]',
      ),
    ]
      .map((el) => el.textContent ?? "")
      .filter((label) => !/^US/.test(label)),
    searchPresent: Boolean(
      document.querySelector('[data-testid="picker-search"]'),
    ),
    programCards: document.querySelectorAll(
      ".plane-launcher-card, .plane-launcher-grid, .constellation, .constellation-summit",
    ).length,
    copyGone: !document.querySelector(
      ".plane-launcher-title, .plane-launcher-sub",
    ),
    // The instruction line is gone — the launcher needs no verb.
    eyebrowGone:
      !document.querySelector(".launcher-eyebrow") &&
      !(document.body.innerText ?? "").includes(
        "it opens as a graph",
      ),
    overlapPairs: Number(
      document
        .querySelector(
          '[data-testid="launcher-field"] [data-testid="corpus-field"]',
        )
        ?.getAttribute("data-overlap-pairs") ?? NaN,
    ),
    fieldChipActive:
      document
        .querySelector('[data-testid="launcher-mode-field"]')
        ?.getAttribute("aria-selected") === "true",
  };
});
console.log("launcher field:", JSON.stringify(launcherFieldState));

// One-node subtrees are gone from every surface: searching for a
// known single-rule module finds nothing.
await picker.type(
  '[data-testid="picker-search"]',
  "chapter-02-application-processing/211",
);
await picker.waitForSelector(".picker-empty", { timeout: 15000 });
const oneNodeAbsent = await picker.evaluate(
  () => document.querySelectorAll('[data-testid="picker-result"]').length === 0,
);
console.log("one-node module searchable:", !oneNodeAbsent ? "YES (bad)" : "no");
await picker.evaluate(() => {
  const input = document.querySelector('[data-testid="picker-search"]');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

// Toggle → List: doors appear, the field steps aside.
await picker.click('[data-testid="launcher-mode-list"]');
await picker.waitForSelector('[data-testid="picker-door"]', {
  timeout: 15000,
});
const pickerState = await picker.evaluate(() => ({
  programCards: document.querySelectorAll(
    ".plane-launcher-card, .plane-launcher-grid, .constellation, .constellation-summit",
  ).length,
  doors: document.querySelectorAll('[data-testid="picker-door"]').length,
  fieldGone: !document.querySelector('[data-testid="launcher-field"]'),
}));
console.log(
  "list mode: program cards:",
  pickerState.programCards,
  "· doors:",
  pickerState.doors,
  "· field stepped aside:",
  pickerState.fieldGone,
);

// The list is COMPLETE: every subtree the field shows, rendered in
// slabs — the total rides a data attribute, scrolling appends rows.
const listStats = await picker.evaluate(() => {
  const list = document.querySelector('[data-testid="picker-list"]');
  return {
    total: Number(list?.getAttribute("data-list-total") ?? 0),
    rendered: Number(list?.getAttribute("data-list-rendered") ?? 0),
  };
});
await picker.evaluate(() => {
  const scroller = document.querySelector(".plane-launcher");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
});
await new Promise((r) => setTimeout(r, 800));
const listAfterScroll = await picker.evaluate(() => {
  const list = document.querySelector('[data-testid="picker-list"]');
  return Number(list?.getAttribute("data-list-rendered") ?? 0);
});
console.log(
  "complete list: total:",
  listStats.total,
  "· rendered before scroll:",
  listStats.rendered,
  "· after scroll:",
  listAfterScroll,
);
await picker.screenshot({ path: "/tmp/list-complete.png" });

// Nationwide / States scope: the segmented control cuts the list to
// the federal corpus or the us-XX corpora, composing with search.
await picker.evaluate(() => {
  const scroller = document.querySelector(".plane-launcher");
  if (scroller) scroller.scrollTop = 0;
});
await picker.click('[data-testid="list-scope-states"]');
await new Promise((r) => setTimeout(r, 400));
const statesScope = await picker.evaluate(() => {
  const rows = [
    ...document.querySelectorAll('[data-testid="picker-list-row"]'),
  ];
  return {
    total: Number(
      document
        .querySelector('[data-testid="picker-list"]')
        ?.getAttribute("data-list-total") ?? 0,
    ),
    rows: rows.length,
    nonState: rows.filter(
      (row) => !/^us-/.test(row.getAttribute("data-jurisdiction") ?? ""),
    ).length,
  };
});
await picker.screenshot({ path: "/tmp/list-filter.png" });

// The state picker: under States, narrow to ONE state — real names,
// only states the corpus carries; every row obeys the pick.
const stateOptions = await picker.evaluate(() =>
  [...document.querySelectorAll('[data-testid="list-state-select"] option')]
    .map((option) => ({ value: option.value, label: option.textContent })),
);
const iowaOption = stateOptions.find((option) => option.label === "Iowa");
await picker.select('[data-testid="list-state-select"]', "us-ia");
await new Promise((r) => setTimeout(r, 500));
const stateCut = await picker.evaluate(() => {
  const rows = [
    ...document.querySelectorAll('[data-testid="picker-list-row"]'),
  ];
  const doors = [
    ...document.querySelectorAll('[data-testid="picker-door"]'),
  ];
  return {
    total: Number(
      document
        .querySelector('[data-testid="picker-list"]')
        ?.getAttribute("data-list-total") ?? 0,
    ),
    rows: rows.length,
    offState: rows.filter(
      (row) => row.getAttribute("data-jurisdiction") !== "us-ia",
    ).length,
    doorCount: doors.length,
    offStateDoors: doors.filter(
      (door) => !(door.textContent ?? "").includes("US-IA"),
    ).length,
  };
});
console.log(
  "state picker — Iowa option:",
  Boolean(iowaOption),
  "· cut:",
  JSON.stringify(stateCut),
);
await picker.screenshot({ path: "/tmp/list-state-picker.png" });
// Back to every state before the scope sums check.
await picker.select('[data-testid="list-state-select"]', "all");
await new Promise((r) => setTimeout(r, 300));
await picker.click('[data-testid="list-scope-nationwide"]');
await new Promise((r) => setTimeout(r, 400));
const nationwideScope = await picker.evaluate(() => {
  const rows = [
    ...document.querySelectorAll('[data-testid="picker-list-row"]'),
  ];
  return {
    total: Number(
      document
        .querySelector('[data-testid="picker-list"]')
        ?.getAttribute("data-list-total") ?? 0,
    ),
    rows: rows.length,
    nonFederal: rows.filter(
      (row) => row.getAttribute("data-jurisdiction") !== "us",
    ).length,
  };
});
await picker.click('[data-testid="list-scope-all"]');
await new Promise((r) => setTimeout(r, 400));
console.log(
  "scope — states:",
  JSON.stringify(statesScope),
  "· nationwide:",
  JSON.stringify(nationwideScope),
  "· sums to all:",
  statesScope.total + nationwideScope.total === listStats.total,
);

// Pipeline / composition modules are excluded app-side: searching
// for one finds nothing in the complete list.
await picker.type('[data-testid="picker-search"]', "pilot_liability_pipeline");
await new Promise((r) => setTimeout(r, 500));
const pipelineTotal = await picker.evaluate(() =>
  Number(
    document
      .querySelector('[data-testid="picker-list"]')
      ?.getAttribute("data-list-total") ?? NaN,
  ),
);
console.log("pipeline targets in the list:", pipelineTotal);
await picker.evaluate(() => {
  const input = document.querySelector('[data-testid="picker-search"]');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));

// Search "273.10" → pick → the compose viewer opens for that root.
await picker.type('[data-testid="picker-search"]', "273.10");
await picker.waitForSelector('[data-testid="picker-result"]', {
  timeout: 15000,
});
const pickedLabel = await picker.evaluate(() => {
  const result = document.querySelector('[data-testid="picker-result"]');
  const label = result?.textContent ?? null;
  result?.click();
  return label;
});
console.log("picked:", pickedLabel?.slice(0, 60));
await picker.waitForFunction(
  () => window.location.search.includes("compose="),
  { timeout: 30000 },
);
// Root-first: the opening flight lands on the subtree's true root
// and the inspector opens on it.
await picker.waitForSelector(".node-inspector-title", { timeout: 60000 });
const composeState = await picker.evaluate(() => ({
  inspector:
    document.querySelector(".node-inspector-title")?.textContent ?? "",
  topMetaAbsent: !document.querySelector(".top-meta"),
}));
const pickerComposeUrl = await picker.evaluate(() => window.location.href);
console.log("picker → compose viewer:", pickerComposeUrl);
console.log(
  "root inspector:",
  composeState.inspector,
  "· top-meta absent:",
  composeState.topMetaAbsent,
);

// 10b) Editable facts, end to end: run on defaults, then TYPE a fact
//      — the outputs must change and the sheet must echo the input.
await picker.waitForSelector(".run-toggle", { timeout: 60000 });
await picker.click(".run-toggle");
await picker.waitForSelector(".run-button", { timeout: 15000 });
await picker.click(".run-button");
await picker.waitForSelector(".results-sheet", { timeout: 60000 });
const baseline = await picker.evaluate(
  () =>
    [...document.querySelectorAll(".results-cell")].map(
      (el) => el.textContent,
    ),
);
// The sheet slides in — evaluate-click so animation can't move the
// button out from under a trusted click.
await new Promise((r) => setTimeout(r, 800));
await picker.evaluate(() =>
  document.querySelector(".results-edit-inputs")?.click(),
);
await picker.waitForSelector(".run-overview-search", { timeout: 30000 });
await picker.type(".run-overview-search", "gross monthly earned");
await picker.waitForSelector(".run-picker-row", { timeout: 15000 });
await picker.evaluate(() =>
  document.querySelector(".run-picker-row")?.click(),
);
await picker.waitForSelector(".scenario-field input", { timeout: 15000 });
await picker.type(".scenario-field input", "2000");
await picker.evaluate(() =>
  document.querySelector(".run-button")?.click(),
);
await picker.waitForFunction(
  () => !document.querySelector(".run-spinner"),
  { timeout: 60000 },
);
await picker.waitForSelector(".results-sheet", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const afterFact = await picker.evaluate(() => ({
  cells: [...document.querySelectorAll(".results-cell")].map(
    (el) => el.textContent,
  ),
  echo:
    document.querySelector('[data-testid="results-inputs"]')?.textContent ??
    "",
  note:
    [...document.querySelectorAll(".results-note")]
      .map((el) => el.textContent)
      .join(" ") ?? "",
}));
const outputsChanged =
  JSON.stringify(afterFact.cells) !== JSON.stringify(baseline);
const factEchoed =
  /Gross Monthly Earned Income/i.test(afterFact.echo) &&
  afterFact.echo.includes("2,000");
const answeredLine = /1 of \d+ inputs answered/.test(afterFact.note);
console.log(
  "typed fact: outputs changed:",
  outputsChanged,
  "· echoed:",
  factEchoed,
  "· answered line:",
  answeredLine,
);
console.log("echo:", afterFact.echo.slice(0, 90));

// 10c) Explicit runs ONLY: editing a value after a run fires
//      nothing — the sheet goes STALE ("values changed — Run
//      again"); outputs move only when Run is clicked.
await picker.evaluate(() => {
  const input = document.querySelector(".results-adjust-field input");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, "1500");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
// Well past the 700ms debounce: if an auto-run were still wired,
// the spinner (or fresh cells) would betray it here.
await new Promise((r) => setTimeout(r, 1600));
const staleState = await picker.evaluate(() => ({
  cells: [...document.querySelectorAll(".results-cell")].map(
    (el) => el.textContent,
  ),
  stale: Boolean(document.querySelector('[data-testid="results-stale"]')),
  spinner: Boolean(document.querySelector(".run-spinner")),
}));
const noAutoRun =
  JSON.stringify(staleState.cells) === JSON.stringify(afterFact.cells) &&
  staleState.stale &&
  !staleState.spinner;
console.log(
  "explicit runs only: outputs frozen:",
  JSON.stringify(staleState.cells) === JSON.stringify(afterFact.cells),
  "· stale indicator:",
  staleState.stale,
  "· no spinner:",
  !staleState.spinner,
);
await picker.screenshot({ path: "/tmp/run-stale-state.png" });
// The explicit click consumes the edits: outputs move, stale clears.
await picker.evaluate(() =>
  document.querySelector(".results-rerun")?.click(),
);
await picker.waitForFunction(
  () => !document.querySelector(".run-spinner"),
  { timeout: 60000 },
);
await picker.waitForSelector(".results-sheet", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const afterRerun = await picker.evaluate(() => ({
  cells: [...document.querySelectorAll(".results-cell")].map(
    (el) => el.textContent,
  ),
  stale: Boolean(document.querySelector('[data-testid="results-stale"]')),
}));
const rerunApplied =
  JSON.stringify(afterRerun.cells) !== JSON.stringify(staleState.cells) &&
  !afterRerun.stale;
console.log(
  "explicit rerun: outputs changed:",
  JSON.stringify(afterRerun.cells) !== JSON.stringify(staleState.cells),
  "· stale cleared:",
  !afterRerun.stale,
);

// 11) /app parity: the same compose deep link through the /app
//     rewrite mounts the same viewer with the same run affordance.
const appPage = await browser.newPage();
await appPage.setViewport({ width: 1500, height: 950 });
await appPage.goto(
  "http://localhost:3742/app?compose=us%3Aregulations%2F7-cfr%2F273%2F10",
  { waitUntil: "networkidle2", timeout: 60000 },
);
await appPage.waitForSelector(".graph-viewer-root", { timeout: 60000 });
let appRunToggle = false;
try {
  await appPage.waitForSelector(".run-toggle", { timeout: 30000 });
  appRunToggle = true;
} catch {
  appRunToggle = false;
}
// The parity surface carries the same way back to the overview.
const appBackButton = await appPage.evaluate(() =>
  Boolean(document.querySelector('[data-testid="back-to-overview"]')),
);
console.log(
  "/app compose parity: viewer mounted · run affordance:",
  appRunToggle ? "LIVE" : "absent",
  "· back-to-overview:",
  appBackButton,
);
// Clicking it lands on the /app field launcher in place (the /app
// route IS the launcher), with the deep-link param stripped.
await appPage.click('[data-testid="back-to-overview"]');
await appPage.waitForSelector(
  '[data-testid="launcher-field"] [data-testid="corpus-field"]',
  { timeout: 30000 },
);
const appBackState = await appPage.evaluate(() => ({
  path: window.location.pathname,
  composeGone: !new URL(window.location.href).searchParams.get("compose"),
}));
console.log("/app ← Overview:", JSON.stringify(appBackState));

// 12) Honest run refusal: 42/1396a/a/10 compiles to nothing (engine
//     #133) — the viewer must show the API's message, not silence.
const blockedPage = await browser.newPage();
await blockedPage.setViewport({ width: 1500, height: 950 });
await blockedPage.goto(
  "http://localhost:3742/axiom/graph?compose=us%3Astatutes%2F42%2F1396a%2Fa%2F10",
  { waitUntil: "networkidle2", timeout: 60000 },
);
await blockedPage.waitForSelector(".run-blocked", { timeout: 60000 });
const blockedText = await blockedPage.evaluate(
  () => document.querySelector(".run-blocked")?.textContent ?? "",
);
console.log("run-blocked state:", blockedText.slice(0, 110) + "…");
const blockedHonest =
  /execute yet/.test(blockedText) && blockedText.length > 60;

console.log(
  "frame-time report — far zoom median:",
  farFrames.median?.toFixed(2),
  "ms · motif zoom median:",
  motifFrames.median?.toFixed(2),
  "ms",
);

const pass =
  dotCount > 100 &&
  clusterCount > 5 &&
  highlightCount >= 10 &&
  badDoors === 0 &&
  statAbsent &&
  legendAbsent &&
  hasSearch &&
  // Shapes at far zoom: the fitted overview draws real structure,
  // and the source outline discriminates.
  farView.trueEdges > 200 &&
  farView.outlines > 500 &&
  farView.outlines < farView.dots &&
  zoomAfterWheel > zoomBefore &&
  lodNear.lod === "motif" &&
  lodNear.trueEdges >= 20 &&
  headlineDoors >= 5 &&
  // Pinned EITC door, two-tier subtree titles, frame budget.
  eitcDoor &&
  labelTiersMid.labelsHeadline > 10 &&
  labelTiersMid.labelsFallback < labelTiersMid.labelsHeadline &&
  labelTiersClose.labelsHeadline > 0 &&
  labelTiersClose.labelsFallback > 0 &&
  farFrames.median < 8 &&
  // Hard no-overlap: zero intersecting footprint pairs, both hosts.
  overlapPairs === 0 &&
  launcherFieldState.overlapPairs === 0 &&
  // Document constellations: families sit clearly apart, and the
  // grouped layout still builds inside its budget.
  groupsSeparated &&
  layoutHealth.layoutMs < 800 &&
  // The instruction line is gone.
  launcherFieldState.eyebrowGone &&
  // The overview chip sits above the plane, left-edge aligned.
  chipAboveStage &&
  // The complete list: > 1000 subtrees, slabs append on scroll.
  listStats.total > 1000 &&
  listAfterScroll > listStats.rendered &&
  // Nationwide / States scope: clean cuts that sum to the whole.
  statesScope.total > 0 &&
  statesScope.nonState === 0 &&
  statesScope.rows > 0 &&
  nationwideScope.total > 0 &&
  nationwideScope.nonFederal === 0 &&
  nationwideScope.rows > 0 &&
  statesScope.total + nationwideScope.total === listStats.total &&
  // The state picker: real names, and one state cuts everything.
  Boolean(iowaOption) &&
  stateCut.total > 0 &&
  stateCut.total < statesScope.total &&
  stateCut.rows > 0 &&
  stateCut.offState === 0 &&
  stateCut.doorCount > 0 &&
  stateCut.offStateDoors === 0 &&
  // App-side pipeline exclusion: none reachable in the list.
  pipelineTotal === 0 &&
  txAfterDrag !== txBefore &&
  Boolean(clickedHref) &&
  composeUrl.includes("compose=") &&
  zoomAtEnter > 1 &&
  backUrl.endsWith("/axiom") &&
  liveField &&
  landingNonUsClusters.length === 0 &&
  launcherFieldState.dotCount > 2892 &&
  launcherFieldState.source === "live" &&
  launcherFieldState.statAbsent &&
  launcherFieldState.canvasViewportShare >= 0.8 &&
  launcherFieldState.controlsTopRight &&
  launcherFieldState.copyGone &&
  launcherFieldState.nonUsClusters.length === 0 &&
  launcherFieldState.searchPresent &&
  launcherFieldState.programCards === 0 &&
  launcherFieldState.fieldChipActive &&
  oneNodeAbsent &&
  pickerState.programCards === 0 &&
  pickerState.doors >= 10 &&
  pickerState.fieldGone &&
  pickerComposeUrl.includes("compose=") &&
  /allotment/i.test(composeState.inspector) &&
  composeState.topMetaAbsent &&
  outputsChanged &&
  factEchoed &&
  answeredLine &&
  // Explicit runs only: post-run edits freeze outputs and flag the
  // sheet stale until Run is clicked.
  noAutoRun &&
  rerunApplied &&
  appRunToggle &&
  appBackButton &&
  appBackState.path === "/app" &&
  appBackState.composeGone &&
  blockedHonest;
console.log(
  pass
    ? "PASS: state picker, tiered titles, translucent field, full echo, explicit runs only"
    : "FAIL",
);
await browser.close();
process.exit(pass ? 0 : 1);
