import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPANS, TOTAL } from "./captions";
import { createDirector, type Director } from "./director";

// MOCK rendering kit and scenes: jsdom has no WebGL. Each scene is empty, and
// the test decides which ones fail to build, and which it holds to settle later.
// The MOCK renderer and pipelines log every call, and set apart the calls made
// on them after their dispose().
const kit = vi.hoisted(() => {
  const kit = {
    fail: new Set<number>(),
    hold: new Set<number>(),
    held: new Map<number, { resolve: () => void; reject: (e: Error) => void }>(),
    made: [] as number[],
    textures: new Map<number, number>(), // how many MOCK textures a scene carries
    latency: new Map<number, { ready: number; compile: number }>(), // ms a scene's assets and compiles take
    calls: [] as string[],
    late: [] as string[],
    pipelines: 0,
    // runs inside each call, so a test can dispose in the middle of a build
    during: null as ((call: string) => void) | null,
    log(gone: boolean, call: string) {
      kit.calls.push(call);
      if (gone) kit.late.push(call);
      kit.during?.(call);
    },
  };
  return kit;
});
vi.mock("../style-frames/kit", async () => {
  const THREE = await import("three");
  const wait = (ms: number) => (ms ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
  return {
    THEME: { paper: false },
    loadFonts: async () => {},
    makeRenderer: () => {
      let gone = false;
      const log = (call: string) => kit.log(gone, call);
      return {
        setPixelRatio: () => log("setPixelRatio"),
        setSize: () => log("setSize"),
        initTexture: (t: { userData: { scene: number } }) => log(`initTexture ${t.userData.scene}`),
        compileAsync: async (sc: { userData: { mock: string; index: number } }) => {
          log(`compileAsync ${sc.userData.mock}`);
          await wait(kit.latency.get(sc.userData.index)?.compile ?? 0);
        },
        render: () => log("render"),
        setRenderTarget: () => log("setRenderTarget"),
        getContext: () => (log("getContext"), { finish() {} }),
        dispose: () => {
          log("dispose");
          gone = true;
        },
      };
    },
    Pipeline: class {
      texture = null;
      gone = false;
      composer = {
        dispose: () => {
          kit.log(this.gone, "composer.dispose");
          this.gone = true;
        },
      };
      constructor() {
        kit.pipelines++;
      }
      render(b: { scene: { userData: { mock: string } } }) {
        kit.log(this.gone, `pipeline.render ${b.scene.userData.mock}`);
      }
      setSize() {
        kit.log(this.gone, "pipeline.setSize");
      }
    },
    createBeat: (build: { index: number }) => {
      const i = build.index;
      kit.made.push(i);
      const camera = new THREE.PerspectiveCamera();
      Object.assign(camera.userData, { basePos: new THREE.Vector3(), baseQuat: new THREE.Quaternion(), baseFocus: 8 });
      const ready = kit.hold.has(i)
        ? new Promise<void>((resolve, reject) => kit.held.set(i, { resolve, reject }))
        : wait(kit.latency.get(i)?.ready ?? 0).then(() => {
            if (kit.fail.has(i)) throw new Error(`MOCK: scene ${i} failed`);
          });
      const scene = new THREE.Scene();
      Object.assign(scene.userData, { mock: `${i} scene`, index: i });
      const fx = new THREE.Scene();
      Object.assign(fx.userData, { mock: `${i} fx`, index: i });
      for (let k = 0; k < (kit.textures.get(i) ?? 0); k++) {
        const map = new THREE.Texture();
        map.userData.scene = i;
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map })));
      }
      return { ready, camera, scene, fx, labels: [], links: [], look: {} };
    },
    fitCamera() {},
    placeLabels() {},
    lightLink() {},
  };
});
vi.mock("./beats", async () => {
  const { SPANS } = await import("./captions");
  return { SCENES: SPANS.map((_, index) => ({ build: { index }, beats: 1 })) };
});

// MOCK idle moments and animation frames, for the tests that take the time
// over: nothing queued runs until the test runs it
const idles: Array<() => void> = [];
const frames = new Map<number, (t: number) => void>();
function takeTime() {
  let id = 0;
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => idles.push(cb));
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => (frames.set(++id, cb), id));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
}

const unhandled = vi.fn();
beforeEach(() => {
  kit.fail.clear();
  kit.hold.clear();
  kit.held.clear();
  kit.made.length = 0;
  kit.textures.clear();
  kit.latency.clear();
  kit.calls.length = 0;
  kit.late.length = 0;
  kit.pipelines = 0;
  kit.during = null;
  process.on("unhandledRejection", unhandled);
});
afterEach(() => {
  process.off("unhandledRejection", unhandled);
  unhandled.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  idles.length = 0;
  frames.clear();
  document.body.replaceChildren();
});

function stage() {
  const canvas = document.createElement("canvas");
  const box = document.createElement("div");
  box.append(canvas);
  document.body.append(box);
  return { canvas, overlays: SPANS.map(() => document.createElement("div")) };
}

function make(opts: { onError?: (e: unknown) => void; canvas?: HTMLCanvasElement; overlays?: HTMLElement[] } = {}) {
  const where = opts.canvas ? { canvas: opts.canvas, overlays: opts.overlays! } : stage();
  return createDirector({ ...where, width: 800, height: 450, paper: true, onError: opts.onError });
}

/** Lets idle builds, timers and rejections run their course. */
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
/** Runs the oldest queued idle moment, and lets what it starts settle. */
const idleStep = async () => {
  idles.shift()?.();
  await settle(20);
};
const runIdle = async () => {
  for (let n = 0; idles.length && n < 50; n++) await idleStep();
};
const runFrame = async (t: number) => {
  const due = [...frames.values()];
  frames.clear();
  due.forEach((f) => f(t));
  await settle(20);
};
/** Runs fn inside the first renderer or pipeline call logged as `call`. */
const at = (call: string, fn: () => void) => {
  kit.during = (c) => {
    if (c !== call) return;
    kit.during = null;
    fn();
  };
};

/**
 * Spies on what a director sets up on its canvas and the window; the check it
 * returns asserts that all of it was let go.
 */
function watch(canvas: HTMLCanvasElement) {
  takeTime();
  const setInterval = vi.spyOn(window, "setInterval");
  const clearInterval = vi.spyOn(window, "clearInterval");
  const on = vi.spyOn(canvas, "addEventListener");
  const off = vi.spyOn(canvas, "removeEventListener");
  return () => {
    expect(setInterval).toHaveBeenCalled();
    for (const { value } of setInterval.mock.results) expect(clearInterval).toHaveBeenCalledWith(value);
    expect(on).toHaveBeenCalled();
    for (const [type, fn] of on.mock.calls) expect(off).toHaveBeenCalledWith(type, fn);
    expect(frames.size).toBe(0);
    expect(kit.calls.filter((c) => c === "dispose")).toHaveLength(1);
    expect(kit.pipelines).toBeGreaterThan(0);
    expect(kit.calls.filter((c) => c === "composer.dispose")).toHaveLength(kit.pipelines);
    expect(canvas.parentElement!.querySelector(".jl-tip")).toBeNull();
  };
}

describe("the journey's director", () => {
  it("reports a scene that fails after the first, once, builds the others, and leaves no rejection unhandled", async () => {
    kit.fail.add(2);
    const onError = vi.fn();
    const d = await make({ onError });
    await vi.waitFor(() => expect(kit.made).toHaveLength(SPANS.length), { timeout: 3000 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((onError.mock.calls[0][0] as Error).message).toBe("MOCK: scene 2 failed");
    // Drawing the failed scene asks for it again, which neither reports it again nor rejects unhandled.
    d.jump(TOTAL / 2);
    d.setProgress(TOTAL);
    await settle(200);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
    d.dispose();
  });

  it("rejects, without reporting, when the first scene can't be built", async () => {
    kit.fail.add(0);
    const onError = vi.fn();
    await expect(make({ onError })).rejects.toThrow("MOCK: scene 0 failed");
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("logs a later scene's failure where nothing listens for it", async () => {
    kit.fail.add(3);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await make();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("journey: a scene could not be built", expect.any(Error)), { timeout: 3000 });
    expect(unhandled).not.toHaveBeenCalled();
    d.dispose();
  });

  it("reports nothing for a scene that fails once it's disposed", async () => {
    kit.hold.add(1);
    const onError = vi.fn();
    const d = await make({ onError });
    await vi.waitFor(() => expect(kit.held.has(1)).toBe(true), { timeout: 3000 });
    d.dispose();
    kit.held.get(1)!.reject(new Error("MOCK: scene 1 failed late"));
    await settle(100);
    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("the journey's director lets go of what it set up", () => {
  it("on dispose()", async () => {
    const { canvas, overlays } = stage();
    const released = watch(canvas);
    const d = await make({ canvas, overlays });
    d.dispose();
    released();
  });

  it("when the first scene can't be built, as its start rejects", async () => {
    kit.hold.add(0);
    const { canvas, overlays } = stage();
    const released = watch(canvas);
    const started = make({ canvas, overlays });
    await settle(10);
    expect(kit.held.has(0)).toBe(true);
    // the reader's pointer crosses the canvas while the first scene builds: a frame is queued
    canvas.dispatchEvent(new MouseEvent("pointermove"));
    expect(frames.size).toBe(1);
    kit.held.get(0)!.reject(new Error("MOCK: scene 0 failed"));
    await expect(started).rejects.toThrow("MOCK: scene 0 failed");
    released();
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("the journey's director, once disposed", () => {
  it("doesn't build a scene that was queued ahead of the reader", async () => {
    takeTime();
    const d = await make();
    // the first frame asks for the next scene in an idle moment
    await runFrame(1000);
    expect(kit.calls).toContain("render");
    expect(idles.length).toBeGreaterThan(1);
    d.dispose();
    await runIdle();
    expect(kit.made).toEqual([0]);
    expect(kit.late).toEqual([]);
  });

  it("stops building the scenes in the background", async () => {
    // no frame runs, so only the background builds wait for idle moments
    takeTime();
    const d = await make();
    await idleStep(); // scene 0, already built at the start
    await idleStep(); // scene 1
    expect(kit.made).toEqual([0, 1]);
    expect(idles).toHaveLength(1); // waits to build scene 2
    d.dispose();
    await runIdle();
    expect(kit.made).toEqual([0, 1]);
    expect(kit.late).toEqual([]);
  });

  // where in a scene's build the director is disposed, and what lets the build go on
  const MID_BUILD: Array<[string, (d: Director) => (() => void) | void]> = [
    [
      "while it waits for its assets",
      (d) => {
        kit.hold.add(1);
        return () => {
          expect(kit.held.has(1)).toBe(true);
          d.dispose();
          kit.held.get(1)!.resolve();
        };
      },
    ],
    [
      "between two of its texture uploads",
      (d) => {
        kit.textures.set(1, 2);
        // the first upload runs past the 8 ms slice, so the build yields after it
        at("initTexture 1", () => {
          d.dispose();
          const t = performance.now();
          while (performance.now() - t < 10);
        });
      },
    ],
    ["as its meshes compile", (d) => at("compileAsync 1 scene", () => d.dispose())],
    ["as its particles compile", (d) => at("compileAsync 1 fx", () => d.dispose())],
  ];
  it.each(MID_BUILD)("stops a build in flight %s, before it touches the renderer again", async (_, arm) => {
    takeTime();
    const onError = vi.fn();
    const d = await make({ onError });
    const release = arm(d);
    await idleStep(); // scene 0, already built at the start
    await idleStep(); // scene 1 starts
    release?.();
    await settle();
    expect(kit.calls).toContain("dispose");
    expect(kit.made).toEqual([0, 1]);
    expect(kit.late).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("draws nothing", async () => {
    takeTime();
    const d = await make();
    d.jump(0.5);
    expect(kit.calls).toContain("render");
    d.dispose();
    d.jump(1);
    d.setProgress(2);
    await runFrame(1000);
    expect(kit.late).toEqual([]);
  });

  it.each<[string, (d: Director) => unknown]>([
    ["resize", (d) => d.resize(640, 360)],
    ["profile", (d) => d.profile([0, 1])],
    ["prepareAll", (d) => d.prepareAll()],
  ])("does nothing on %s", async (_, call) => {
    takeTime();
    const d = await make();
    d.dispose();
    await call(d);
    await runIdle();
    expect(kit.made).toEqual([0]);
    expect(kit.late).toEqual([]);
  });

  // the reader's actions, as the homepage and the slide make them
  const action = fc.oneof(
    fc.record({ kind: fc.constant("frame" as const), ms: fc.integer({ min: 1, max: 120 }) }),
    fc.record({ kind: fc.constantFrom("idle" as const, "profile" as const, "prepareAll" as const) }),
    fc.record({ kind: fc.constantFrom("setProgress" as const, "jump" as const), p: fc.double({ min: -1, max: TOTAL + 1, noNaN: true }) }),
    fc.record({ kind: fc.constant("resize" as const), w: fc.integer({ min: 1, max: 2400 }) }),
    fc.record({ kind: fc.constantFrom("pointermove" as const, "pointerleave" as const, "click" as const) }),
  );
  it("touches nothing after dispose(), wherever it comes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(action, { maxLength: 30 }),
        fc.array(action, { maxLength: 10 }),
        // dispose as soon as the n-th renderer or pipeline call after the start returns (at the next
        // await of whatever made it: nothing in a call disposes the director), if before the actions run out
        fc.option(fc.nat({ max: 300 }), { nil: null }),
        fc.subarray([1, 2, 3, 4, 5]),
        fc.array(fc.nat({ max: 4 }), { minLength: SPANS.length, maxLength: SPANS.length }),
        // so that a dispose between two actions can find a build waiting on its assets or a compile
        fc.array(fc.record({ ready: fc.nat({ max: 4 }), compile: fc.nat({ max: 3 }) }), { minLength: SPANS.length, maxLength: SPANS.length }),
        async (before, after, inCall, failing, textures, latency) => {
          kit.fail.clear();
          kit.made.length = kit.calls.length = kit.late.length = 0;
          failing.forEach((i) => kit.fail.add(i));
          textures.forEach((n, i) => kit.textures.set(i, n));
          latency.forEach((l, i) => kit.latency.set(i, l));
          idles.length = 0;
          frames.clear();
          takeTime();
          let clock = 0;
          vi.spyOn(performance, "now").mockImplementation(() => clock);
          const onError = vi.fn();
          const { canvas, overlays } = stage();
          const d = await make({ canvas, overlays, onError });
          let then: { made: number; reported: number } | null = null;
          const dispose = () => {
            if (then) return;
            then = { made: kit.made.length, reported: onError.mock.calls.length };
            d.dispose();
          };
          const start = kit.calls.length;
          let queued = false;
          kit.during = (c) => {
            if (c.startsWith("initTexture")) clock += 3; // uploads take time, so builds yield
            if (queued || inCall === null || kit.calls.length - start <= inCall) return;
            queued = true;
            queueMicrotask(dispose);
          };
          const run = async (a: (typeof before)[number]) => {
            if (a.kind === "frame") {
              clock += a.ms;
              const due = [...frames.values()];
              frames.clear();
              due.forEach((f) => f(clock));
            } else if (a.kind === "idle") idles.shift()?.();
            else if (a.kind === "setProgress" || a.kind === "jump") d[a.kind](a.p);
            else if (a.kind === "resize") d.resize(a.w, Math.max(1, Math.round(a.w * 0.56)));
            else if (a.kind === "profile") d.profile([0, TOTAL / 2]);
            else if (a.kind === "prepareAll") void d.prepareAll().catch(() => undefined);
            else canvas.dispatchEvent(new MouseEvent(a.kind));
            await settle(1);
          };
          for (const a of before) await run(a);
          dispose();
          for (const a of after) await run(a);
          // whatever is still queued gets its chance
          await runIdle();
          await run({ kind: "frame", ms: 16 });
          await settle(20);
          expect(kit.late).toEqual([]);
          expect(kit.made).toHaveLength(then!.made);
          expect(onError).toHaveBeenCalledTimes(then!.reported);
          expect(unhandled).not.toHaveBeenCalled();
          document.body.replaceChildren();
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});
