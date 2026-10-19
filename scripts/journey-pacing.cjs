// Builds the scroll pacing table for the Lamplight journey
// (src/components/landing/journey-lamplight/pacing.ts).
//
// It renders the story in small steps on a running dev server, measures
// how much the picture changes per beat of story time, and gives every
// stretch that moves faster than TARGET more scroll, so the whole story
// passes at one steady pace. Slow stretches and holds keep their scroll.
//
// Rebuild it whenever the story's motion or timeline changes, in two
// passes (the second measures along the new scroll path and evens out
// what is left):
//   bun run dev   (in another terminal)
//   node scripts/journey-pacing.cjs http://localhost:3000
//   node scripts/journey-pacing.cjs http://localhost:3000 --refine
// Options: --from <speed.json> reuses a measurement; --save <speed.json>
// keeps one.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

// the steady pace: picture change per beat of scroll (calibrated for the
// paper look, whose ink on light changes more pixels than the night look)
const TARGET = Number(process.env.PACE_TARGET ?? 190);
const TARGET2 = Number(process.env.PACE_TARGET2 ?? 260); // the refining pass (measured at REFINE_STEP)
const REFINE_STEP = 0.02;
// a big camera move changes most of the screen: it gets more scroll, but
// only so much more, so it stays smooth without dragging
const MAX_STRETCH = 3;
const MAX_STRETCH2 = 1.6; // (on top of the first pass)
// each hand-over between scenes gets at least this stretch, whatever the
// picture does (a cross-fade changes little per frame, so measuring alone
// would hurry it). Read from the timeline in captions.ts.
const CUT_MIN = 3.5;
const timeline = (() => {
  const src = fs.readFileSync(path.join(__dirname, "../src/components/landing/journey-lamplight/captions.ts"), "utf8");
  const spans = JSON.parse(src.match(/export const SPANS = (\[[^\]]*\])/)[1]);
  const overlap = Number(src.match(/export const OVERLAP = ([\d.]+)/)[1]);
  let acc = 0;
  const starts = spans.map((x) => ((acc += x), acc - x));
  return { cuts: starts.slice(1).map((st) => [st - overlap, st]) };
})();
// the floor at story time p: CUT_MIN inside a hand-over, easing in and out
// over a quarter beat on either side
const cutFloor = (p) => {
  let f = 1;
  for (const [a, b] of timeline.cuts) {
    const ramp = 0.25;
    const w = p < a ? (p - (a - ramp)) / ramp : p > b ? (b + ramp - p) / ramp : 1;
    if (w > 0) f = Math.max(f, 1 + (CUT_MIN - 1) * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, w))));
  }
  return f;
};
const STEP = 0.01; // measuring step, in beats
const OUT_STEP = 0.02; // table step, in beats
const SMOOTH = 17; // smoothing window, in measuring steps (±0.08 beats)

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function measure(refine = false) {
  const chrome =
    process.env.CHROME_PATH ??
    path.join(
      process.env.HOME,
      ".cache/puppeteer/chrome-headless-shell/mac_arm-148.0.7778.97/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    );
  const browser = await puppeteer.launch({ executablePath: chrome, args: ["--use-angle=metal", "--hide-scrollbars"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
  await page.goto(`${base}/`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.querySelector("#encoder").scrollIntoView();
  });
  await page.waitForFunction(() => typeof window.__jlRender === "function", { timeout: 60000 });
  await page.evaluate(() => window.__jlReady());
  const T = await page.evaluate((refine) => (refine ? window.__jlScrollTotal : window.__jlTotal), refine);
  const v = await page.evaluate(
    async (T, step, refine) => {
      const c = document.querySelector(".jl-canvas");
      const sm = document.createElement("canvas");
      sm.width = 160;
      sm.height = 100;
      const g = sm.getContext("2d", { willReadFrequently: true });
      g.filter = "blur(1px) grayscale(1)";
      let prev = null;
      const out = [];
      for (let P = 0; P <= T + 1e-9; P += step) {
        window.__jlRender(refine ? window.__jlStoryAt(P) : P);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        g.clearRect(0, 0, 160, 100);
        g.drawImage(c, 0, 0, 160, 100);
        const d = g.getImageData(0, 0, 160, 100).data;
        if (prev) {
          let s = 0;
          for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - prev[i]);
          out.push([+P.toFixed(4), s / (d.length / 4) / step]);
        }
        prev = d.slice();
      }
      return out;
    },
    T,
    refine ? REFINE_STEP : STEP,
    refine,
  );
  await browser.close();
  return { T, step: refine ? REFINE_STEP : STEP, v };
}

const smooth = (v, n) => {
  const w = Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (n + 1)));
  const ws = w.reduce((a, b) => a + b, 0);
  const half = Math.floor(n / 2);
  return v.map((_, i) => w.reduce((a, wk, k) => a + wk * v[Math.min(v.length - 1, Math.max(0, i + k - half))], 0) / ws);
};
const file = path.join(__dirname, "../src/components/landing/journey-lamplight/pacing.ts");
const write = (T, target, P, S) => {
  fs.writeFileSync(
    file,
    `// Generated by scripts/journey-pacing.cjs: do not edit by hand.
// Story time P (beats) and the scroll S (beats of scroll) that reaches it.
// Stretches that move faster than the steady pace get more scroll; slow
// stretches and holds keep theirs. Rebuild it after the motion changes.
export const PACE = {
  total: ${+T.toFixed(4)},
  target: ${JSON.stringify(target)},
  P: [${P.join(", ")}],
  S: [${S.join(", ")}],
};
`,
  );
};

async function refine() {
  const cur = fs.readFileSync(file, "utf8");
  const grab = (k) => JSON.parse(cur.match(new RegExp(`${k}: (\\[[^\\]]*\\])`))[1]);
  const P = grab("P");
  const S = grab("S");
  const total = +cur.match(/total: ([\d.]+)/)[1];
  const data = opt("--from") ? JSON.parse(fs.readFileSync(opt("--from"), "utf8")) : await measure(true);
  if (opt("--save")) fs.writeFileSync(opt("--save"), JSON.stringify(data));
  const vs = smooth(data.v.map((x) => x[1]), 9);
  // new scroll at each old scroll point
  const at = [0];
  for (let i = 0; i < vs.length; i++) at.push(at[i] + Math.min(MAX_STRETCH2, Math.max(1, vs[i] / TARGET2)) * data.step);
  const s2 = (s) => {
    const x = s / data.step;
    const i = Math.min(at.length - 2, Math.max(0, Math.floor(x)));
    return at[i] + (at[i + 1] - at[i]) * (x - i);
  };
  const S2 = S.map((s) => +s2(s).toFixed(4));
  write(total, `${TARGET} then ${TARGET2}`, P, S2);
  console.log(`refined: ${S[S.length - 1].toFixed(2)} → ${S2[S2.length - 1].toFixed(2)} beats of scroll`);
}

(async () => {
  if (args.includes("--refine")) return refine();
  const data = opt("--from") ? JSON.parse(fs.readFileSync(opt("--from"), "utf8")) : await measure();
  if (opt("--save")) fs.writeFileSync(opt("--save"), JSON.stringify(data));
  const { T, step } = data;
  const v = data.v.map((x) => x[1]);
  // smooth the speed (a Hann window), then stretch only what is too fast
  const vs = smooth(v, SMOOTH);
  const stretch = vs.map((x, i) => Math.max(cutFloor((i + 0.5) * step), Math.min(MAX_STRETCH, Math.max(1, x / TARGET))));
  // cumulative scroll (in scroll beats) at each table point of story time
  const P = [];
  const S = [];
  let acc = 0;
  let next = 0;
  for (let i = 0; i <= stretch.length; i++) {
    const at = i * step;
    if (at >= next - 1e-9) {
      P.push(+at.toFixed(3));
      S.push(+acc.toFixed(4));
      next += OUT_STEP;
    }
    if (i < stretch.length) acc += stretch[i] * step;
  }
  if (P[P.length - 1] < T) {
    P.push(+T.toFixed(3));
    S.push(+acc.toFixed(4));
  }
  write(T, TARGET, P, S);
  console.log(`story ${T.toFixed(2)} beats → ${acc.toFixed(2)} beats of scroll; table ${P.length} points → ${path.relative(process.cwd(), file)}`);
})();
